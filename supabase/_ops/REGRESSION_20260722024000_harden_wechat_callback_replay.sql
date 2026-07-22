-- Isolated rollback-only regression for 20260722024000.
-- NEVER run against production. Use disposable PostgreSQL 16/17 only.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL search_path = pg_catalog;

DO $catalog_privilege_contract$
DECLARE
  function_oid regprocedure;
BEGIN
  -- Catalog-only denial checks: do not invoke denied SECURITY DEFINER helpers
  -- under API roles in PG17 regression environments.
  IF pg_catalog.has_table_privilege(
       'service_role', 'public.wechat_callback_receipts', 'SELECT'
     ) OR pg_catalog.has_table_privilege(
       'anon', 'public.wechat_callback_receipts', 'SELECT'
     ) OR pg_catalog.has_table_privilege(
       'authenticated', 'public.wechat_callback_receipts', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'callback receipt table ACL regression';
  END IF;

  FOREACH function_oid IN ARRAY ARRAY[
    'public.claim_wechat_callback_receipt(text,text,bigint,uuid)'::pg_catalog.regprocedure,
    'public.complete_wechat_callback_receipt(text,text,uuid,text)'::pg_catalog.regprocedure,
    'public.release_wechat_callback_receipt(text,text,uuid)'::pg_catalog.regprocedure
  ] LOOP
    IF pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'callback RPC ACL regression: %', function_oid;
    END IF;
  END LOOP;
END;
$catalog_privilege_contract$;

INSERT INTO public.wechat_media_checks (
  trace_id, bucket, storage_path, user_id
) VALUES
  ('callback-regression-success', 'item-images', 'items/regression/success.jpg', NULL),
  ('callback-regression-atomic', 'item-images', 'items/regression/atomic.jpg', NULL);

SET LOCAL ROLE service_role;
DO $freshness_identity_and_completion$
DECLARE
  now_epoch bigint := pg_catalog.floor(
    EXTRACT(epoch FROM pg_catalog.clock_timestamp())
  )::bigint;
  result text;
BEGIN
  result := public.claim_wechat_callback_receipt(
    'wxa_media_check:callback-regression-stale', pg_catalog.repeat('d', 64),
    now_epoch - 301, 'dddddddd-dddd-4ddd-8ddd-dddddddddd01'::uuid
  );
  IF result <> 'stale' THEN
    RAISE EXCEPTION 'past freshness boundary escaped: %', result;
  END IF;
  result := public.claim_wechat_callback_receipt(
    'wxa_media_check:callback-regression-future', pg_catalog.repeat('d', 64),
    now_epoch + 61, 'dddddddd-dddd-4ddd-8ddd-dddddddddd02'::uuid
  );
  IF result <> 'stale' THEN
    RAISE EXCEPTION 'future freshness boundary escaped: %', result;
  END IF;

  result := public.claim_wechat_callback_receipt(
    'wxa_media_check:callback-regression-success', pg_catalog.repeat('a', 64),
    now_epoch, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  );
  IF result <> 'claimed' THEN
    RAISE EXCEPTION 'fresh callback was not claimed: %', result;
  END IF;

  -- Equivalent concurrent delivery: same event/payload under a distinct query
  -- signature becomes busy, without incrementing or rewriting the receipt.
  result := public.claim_wechat_callback_receipt(
    'wxa_media_check:callback-regression-success', pg_catalog.repeat('a', 64),
    now_epoch + 1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'::uuid
  );
  IF result <> 'busy' THEN
    RAISE EXCEPTION 'concurrent equivalent event was not busy: %', result;
  END IF;

  result := public.claim_wechat_callback_receipt(
    'wxa_media_check:callback-regression-success', pg_catalog.repeat('b', 64),
    now_epoch + 1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac'::uuid
  );
  IF result <> 'conflict' THEN
    RAISE EXCEPTION 'same event/different verdict digest was not conflict: %', result;
  END IF;

  IF NOT public.complete_wechat_callback_receipt(
    'wxa_media_check:callback-regression-success', pg_catalog.repeat('a', 64),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    'callback-regression-success'
  ) THEN
    RAISE EXCEPTION 'receipt/mapping atomic completion failed';
  END IF;

  result := public.claim_wechat_callback_receipt(
    'wxa_media_check:callback-regression-success', pg_catalog.repeat('a', 64),
    1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad'::uuid
  );
  IF result <> 'completed' THEN
    RAISE EXCEPTION 'completed event retry was not acknowledged: %', result;
  END IF;
END;
$freshness_identity_and_completion$;
RESET ROLE;

-- Insert an old row only after the first fresh claim has completed. The next
-- completed retry and stale first delivery must not opportunistically purge it.
INSERT INTO public.wechat_callback_receipts (
  event_key, payload_sha256, callback_timestamp, state, attempt_count,
  created_at, updated_at, completed_at
) VALUES (
  'wxa_media_check:callback-regression-old', pg_catalog.repeat('f', 64), 1,
  'completed', 1, pg_catalog.clock_timestamp() - interval '40 days',
  pg_catalog.clock_timestamp() - interval '40 days',
  pg_catalog.clock_timestamp() - interval '40 days'
);

SET LOCAL ROLE service_role;
DO $repeat_and_stale_do_not_cleanup$
DECLARE
  result text;
BEGIN
  result := public.claim_wechat_callback_receipt(
    'wxa_media_check:callback-regression-success', pg_catalog.repeat('a', 64),
    1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae'::uuid
  );
  IF result <> 'completed' THEN
    RAISE EXCEPTION 'completed retry changed state: %', result;
  END IF;
  result := public.claim_wechat_callback_receipt(
    'wxa_media_check:callback-regression-stale-again', pg_catalog.repeat('d', 64),
    1, 'dddddddd-dddd-4ddd-8ddd-dddddddddd03'::uuid
  );
  IF result <> 'stale' THEN
    RAISE EXCEPTION 'stale retry changed state: %', result;
  END IF;
END;
$repeat_and_stale_do_not_cleanup$;
RESET ROLE;

DO $no_write_retry_contract$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.wechat_callback_receipts AS receipt
    WHERE receipt.event_key IN (
      'wxa_media_check:callback-regression-stale',
      'wxa_media_check:callback-regression-future',
      'wxa_media_check:callback-regression-stale-again'
    )
  ) OR NOT EXISTS (
    SELECT 1 FROM public.wechat_callback_receipts AS receipt
    WHERE receipt.event_key = 'wxa_media_check:callback-regression-success'
      AND receipt.state = 'completed'
      AND receipt.attempt_count = 1
  ) OR NOT EXISTS (
    SELECT 1 FROM public.wechat_callback_receipts AS receipt
    WHERE receipt.event_key = 'wxa_media_check:callback-regression-old'
  ) OR EXISTS (
    SELECT 1 FROM public.wechat_media_checks AS media
    WHERE media.trace_id = 'callback-regression-success'
  ) THEN
    RAISE EXCEPTION 'stale/repeat no-write or completion contract failed';
  END IF;
END;
$no_write_retry_contract$;

-- A fresh first insert is the only path that performs bounded retention.
SET LOCAL ROLE service_role;
DO $fresh_insert_runs_retention$
DECLARE
  now_epoch bigint := pg_catalog.floor(
    EXTRACT(epoch FROM pg_catalog.clock_timestamp())
  )::bigint;
BEGIN
  IF public.claim_wechat_callback_receipt(
    'wxa_media_check:callback-regression-no-mapping', pg_catalog.repeat('c', 64),
    now_epoch, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid
  ) <> 'claimed' THEN
    RAISE EXCEPTION 'fresh retention claim failed';
  END IF;
  IF NOT public.complete_wechat_callback_receipt(
    'wxa_media_check:callback-regression-no-mapping', pg_catalog.repeat('c', 64),
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
    'callback-regression-no-mapping'
  ) THEN
    RAISE EXCEPTION 'zero-row mixed-window mapping completion failed';
  END IF;
END;
$fresh_insert_runs_retention$;
RESET ROLE;

DO $retention_result$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.wechat_callback_receipts AS receipt
    WHERE receipt.event_key = 'wxa_media_check:callback-regression-old'
  ) THEN
    RAISE EXCEPTION 'fresh insert did not run bounded retention';
  END IF;
END;
$retention_result$;

-- Atomic rollback: mapping DELETE and receipt completion must both roll back.
SET LOCAL ROLE service_role;
DO $prepare_atomic_failure$
DECLARE
  now_epoch bigint := pg_catalog.floor(
    EXTRACT(epoch FROM pg_catalog.clock_timestamp())
  )::bigint;
BEGIN
  IF public.claim_wechat_callback_receipt(
    'wxa_media_check:callback-regression-atomic', pg_catalog.repeat('e', 64),
    now_epoch, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid
  ) <> 'claimed' THEN
    RAISE EXCEPTION 'atomic rollback fixture claim failed';
  END IF;
END;
$prepare_atomic_failure$;
RESET ROLE;

CREATE FUNCTION pg_temp.fail_wechat_callback_completion()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $trigger$
BEGIN
  IF NEW.state = 'completed' THEN
    RAISE EXCEPTION 'synthetic_completion_failure';
  END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER wechat_callback_regression_fail_completion
  BEFORE UPDATE ON public.wechat_callback_receipts
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_wechat_callback_completion();

SET LOCAL ROLE service_role;
DO $atomic_failure_rolls_back$
DECLARE
  failed boolean := false;
BEGIN
  BEGIN
    PERFORM public.complete_wechat_callback_receipt(
      'wxa_media_check:callback-regression-atomic', pg_catalog.repeat('e', 64),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid,
      'callback-regression-atomic'
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM = 'synthetic_completion_failure' THEN failed := true; ELSE RAISE; END IF;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'synthetic completion failure did not fire'; END IF;
END;
$atomic_failure_rolls_back$;
RESET ROLE;

DO $atomic_failure_preserved_both_rows$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.wechat_media_checks AS media
    WHERE media.trace_id = 'callback-regression-atomic'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.wechat_callback_receipts AS receipt
    WHERE receipt.event_key = 'wxa_media_check:callback-regression-atomic'
      AND receipt.state = 'processing'
  ) THEN
    RAISE EXCEPTION 'atomic completion failure left a partial commit';
  END IF;
END;
$atomic_failure_preserved_both_rows$;

DROP TRIGGER wechat_callback_regression_fail_completion
  ON public.wechat_callback_receipts;

SET LOCAL ROLE service_role;
DO $atomic_retry_completes$
BEGIN
  IF NOT public.complete_wechat_callback_receipt(
    'wxa_media_check:callback-regression-atomic', pg_catalog.repeat('e', 64),
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid,
    'callback-regression-atomic'
  ) THEN
    RAISE EXCEPTION 'atomic completion retry failed';
  END IF;
END;
$atomic_retry_completes$;
RESET ROLE;

ROLLBACK;
