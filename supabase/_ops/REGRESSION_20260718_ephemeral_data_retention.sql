-- Isolated/local behavioral regression for
-- 20260718150000_ephemeral_data_retention.sql.
-- NEVER run against production. Every fixture mutation is rolled back.

\set ON_ERROR_STOP on

BEGIN;

DO $acl$
DECLARE
  rpc_oid oid := pg_catalog.to_regprocedure(
    'public.run_ephemeral_data_retention()'
  );
BEGIN
  IF rpc_oid IS NULL
     OR pg_catalog.has_function_privilege('anon', rpc_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', rpc_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', rpc_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'regression_failed: retention RPC ACL';
  END IF;
END
$acl$;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (
    '98200000-0000-4000-8000-000000000001',
    'retention-expired@example.test',
    '{"nickname":"Retention Expired"}'::jsonb
  ),
  (
    '98200000-0000-4000-8000-000000000002',
    'retention-live@example.test',
    '{"nickname":"Retention Live"}'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  raw_user_meta_data = EXCLUDED.raw_user_meta_data;

DELETE FROM public.edge_rate_limits
WHERE bucket LIKE 'retention-regression:%';
DELETE FROM public.illini_verifications
WHERE user_id IN (
  '98200000-0000-4000-8000-000000000001',
  '98200000-0000-4000-8000-000000000002'
);
DELETE FROM public.wechat_media_checks
WHERE trace_id LIKE 'retention-regression:%';

-- 1001 eligible rows prove the fixed 1000-row table cap and has_more signal.
INSERT INTO public.edge_rate_limits (bucket, count, window_start)
SELECT
  'retention-regression:expired:' || pg_catalog.lpad(series::text, 4, '0'),
  1,
  '1900-01-01 00:00:00+00'::timestamptz
FROM pg_catalog.generate_series(1, 1001) AS series;

INSERT INTO public.edge_rate_limits (bucket, count, window_start) VALUES
  ('retention-regression:live', 1, pg_catalog.clock_timestamp());

INSERT INTO public.illini_verifications (
  user_id,
  email,
  code_hash,
  expires_at
) VALUES
  (
    '98200000-0000-4000-8000-000000000001',
    'expired@illinois.edu',
    pg_catalog.repeat('a', 64),
    '1900-01-01 00:00:00+00'::timestamptz
  ),
  (
    '98200000-0000-4000-8000-000000000002',
    'live@illinois.edu',
    pg_catalog.repeat('b', 64),
    pg_catalog.clock_timestamp() + interval '10 minutes'
  );

INSERT INTO public.wechat_media_checks (
  trace_id,
  bucket,
  storage_path,
  user_id,
  created_at
) VALUES
  (
    'retention-regression:expired',
    'item-images',
    'retention/expired.jpg',
    NULL,
    '1900-01-01 00:00:00+00'::timestamptz
  ),
  (
    'retention-regression:live',
    'item-images',
    'retention/live.jpg',
    NULL,
    pg_catalog.clock_timestamp()
  );

SET LOCAL ROLE service_role;

DO $test$
DECLARE
  result record;
BEGIN
  SELECT * INTO STRICT result
  FROM public.run_ephemeral_data_retention();

  IF result.edge_rate_limits_deleted <> 1000 THEN
    RAISE EXCEPTION
      'regression_failed: expected fixed edge batch 1000, got %',
      result.edge_rate_limits_deleted;
  END IF;
  IF result.illini_verifications_deleted < 1
     OR result.illini_verifications_deleted > 1000
     OR result.wechat_media_checks_deleted < 1
     OR result.wechat_media_checks_deleted > 1000 THEN
    RAISE EXCEPTION 'regression_failed: bounded secondary deletion counts';
  END IF;
  IF result.has_more IS NOT TRUE THEN
    RAISE EXCEPTION 'regression_failed: expected eligible backlog signal';
  END IF;
END
$test$;

RESET ROLE;

DO $verify$
DECLARE
  expired_edge_rows integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
  INTO expired_edge_rows
  FROM public.edge_rate_limits
  WHERE bucket LIKE 'retention-regression:expired:%';

  IF expired_edge_rows <> 1 THEN
    RAISE EXCEPTION
      'regression_failed: expected one expired edge row after batch, got %',
      expired_edge_rows;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.edge_rate_limits
    WHERE bucket = 'retention-regression:live'
  ) THEN
    RAISE EXCEPTION 'regression_failed: live edge bucket was deleted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.illini_verifications
    WHERE user_id = '98200000-0000-4000-8000-000000000001'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.illini_verifications
    WHERE user_id = '98200000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'regression_failed: Illini expiry boundary';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.wechat_media_checks
    WHERE trace_id = 'retention-regression:expired'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.wechat_media_checks
    WHERE trace_id = 'retention-regression:live'
  ) THEN
    RAISE EXCEPTION 'regression_failed: WeChat seven-day boundary';
  END IF;
END
$verify$;

ROLLBACK;
