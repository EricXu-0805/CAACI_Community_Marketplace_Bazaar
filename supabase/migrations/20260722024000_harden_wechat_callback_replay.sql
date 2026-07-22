-- Durable event-level idempotency for WeChat media verdict callbacks.
--
-- IMPORTANT: WeChat plaintext `signature` authenticates only the configured
-- token + timestamp + nonce. It does not authenticate or encrypt the JSON
-- body. This ledger therefore limits duplicate side effects but does not turn
-- plaintext callbacks into authenticated payloads. Production asynchronous
-- media moderation remains gated on WeChat compatible/security mode using
-- msg_signature + Encrypt and a real-provider retry canary.
--
-- A validated wxa_media_check trace_id becomes the stable event key. The
-- payload digest covers only canonical business fields (Event, trace_id,
-- suggest), so a provider retry with a new query signature or reordered JSON
-- remains the same event. A different verdict for one trace is a conflict.

BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $guard$
DECLARE
  media_oid oid := pg_catalog.to_regclass('public.wechat_media_checks');
  media_owner oid;
  primary_key_columns text[];
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION 'wechat_callback_replay_requires_postgresql_16'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS required(role_name)
    WHERE pg_catalog.to_regrole(required.role_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'wechat_callback_replay_api_role_missing'
      USING ERRCODE = '55000';
  END IF;

  SELECT relation.relowner
  INTO media_owner
  FROM pg_catalog.pg_class AS relation
  WHERE relation.oid = media_oid
    AND relation.relkind = 'r'
    AND relation.relrowsecurity;

  IF media_owner IS NULL OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('trace_id', 'text', true),
      ('bucket', 'text', true),
      ('storage_path', 'text', true),
      ('user_id', 'uuid', false),
      ('created_at', 'timestamp with time zone', true)
    ) AS required(column_name, type_name, not_null)
    LEFT JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = media_oid
     AND attribute.attname = required.column_name
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND attribute.atttypid = pg_catalog.to_regtype(required.type_name)
     AND attribute.attnotnull = required.not_null
    WHERE attribute.attname IS NULL
  ) THEN
    RAISE EXCEPTION 'wechat_callback_replay_media_mapping_contract_missing'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.array_agg(attribute.attname ORDER BY key_column.ordinality)
  INTO primary_key_columns
  FROM pg_catalog.pg_constraint AS constraint_row
  CROSS JOIN LATERAL pg_catalog.unnest(constraint_row.conkey)
    WITH ORDINALITY AS key_column(attnum, ordinality)
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = constraint_row.conrelid
   AND attribute.attnum = key_column.attnum
  WHERE constraint_row.conrelid = media_oid
    AND constraint_row.contype = 'p';

  IF primary_key_columns IS DISTINCT FROM ARRAY['trace_id']::text[]
     OR NOT pg_catalog.has_table_privilege(
       current_user, media_oid, 'SELECT,DELETE'
     ) THEN
    RAISE EXCEPTION 'wechat_callback_replay_media_mapping_key_or_owner_privilege_missing'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regclass('public.wechat_callback_receipts') IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS routine
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = routine.pronamespace
       WHERE namespace.nspname = 'public'
         AND routine.proname IN (
           'claim_wechat_callback_receipt',
           'complete_wechat_callback_receipt',
           'release_wechat_callback_receipt'
         )
     ) THEN
    RAISE EXCEPTION 'wechat_callback_replay_target_already_exists'
      USING ERRCODE = '55000';
  END IF;
END;
$guard$;

CREATE TABLE public.wechat_callback_receipts (
  event_key text PRIMARY KEY,
  payload_sha256 text NOT NULL,
  callback_timestamp bigint NOT NULL,
  state text NOT NULL DEFAULT 'processing',
  claim_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT wechat_callback_receipts_event_key_check
    CHECK (event_key ~ '^wxa_media_check:[A-Za-z0-9_-]{4,128}$'),
  CONSTRAINT wechat_callback_receipts_payload_sha256_check
    CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT wechat_callback_receipts_timestamp_check
    CHECK (callback_timestamp > 0),
  CONSTRAINT wechat_callback_receipts_attempt_count_check
    CHECK (attempt_count BETWEEN 1 AND 1000000),
  CONSTRAINT wechat_callback_receipts_time_order_check
    CHECK (
      updated_at >= created_at
      AND (completed_at IS NULL OR completed_at >= created_at)
    ),
  CONSTRAINT wechat_callback_receipts_state_check
    CHECK (
      (state = 'processing' AND claim_token IS NOT NULL
       AND lease_expires_at IS NOT NULL AND completed_at IS NULL)
      OR (state = 'retryable' AND claim_token IS NULL
          AND lease_expires_at IS NULL AND completed_at IS NULL)
      OR (state = 'completed' AND claim_token IS NULL
          AND lease_expires_at IS NULL AND completed_at IS NOT NULL)
    )
);

ALTER TABLE public.wechat_callback_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.wechat_callback_receipts
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX wechat_callback_receipts_completed_retention_idx
  ON public.wechat_callback_receipts (completed_at, event_key)
  WHERE state = 'completed';
CREATE INDEX wechat_callback_receipts_pending_retention_idx
  ON public.wechat_callback_receipts (updated_at, event_key)
  WHERE state <> 'completed';

COMMENT ON TABLE public.wechat_callback_receipts IS
  'Service-only event idempotency ledger. Plaintext WeChat signatures do not authenticate callback bodies.';
COMMENT ON COLUMN public.wechat_callback_receipts.event_key IS
  'Validated wxa_media_check identity: wxa_media_check:<trace_id>.';
COMMENT ON COLUMN public.wechat_callback_receipts.payload_sha256 IS
  'SHA-256 over canonical Event, trace_id and suggest fields; never raw callback bytes.';

CREATE FUNCTION public.claim_wechat_callback_receipt(
  event_key_in text,
  payload_sha256_in text,
  callback_timestamp_in bigint,
  claim_token_in uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  now_value timestamptz := pg_catalog.clock_timestamp();
  now_epoch bigint := pg_catalog.floor(EXTRACT(epoch FROM now_value))::bigint;
  existing public.wechat_callback_receipts%ROWTYPE;
  inserted_count integer := 0;
BEGIN
  IF event_key_in IS NULL
     OR event_key_in !~ '^wxa_media_check:[A-Za-z0-9_-]{4,128}$'
     OR payload_sha256_in IS NULL
     OR payload_sha256_in !~ '^[0-9a-f]{64}$'
     OR callback_timestamp_in IS NULL
     OR callback_timestamp_in <= 0
     OR claim_token_in IS NULL THEN
    RETURN 'invalid';
  END IF;

  LOOP
    SELECT receipt.*
    INTO existing
    FROM public.wechat_callback_receipts AS receipt
    WHERE receipt.event_key = event_key_in
    FOR UPDATE;

    IF FOUND THEN
      IF existing.payload_sha256 IS DISTINCT FROM payload_sha256_in THEN
        RETURN 'conflict';
      END IF;
      IF existing.state = 'completed' THEN
        RETURN 'completed';
      END IF;
      -- Stale retries never acquire/reacquire a lease and never write.
      IF callback_timestamp_in < now_epoch - 300
         OR callback_timestamp_in > now_epoch + 60 THEN
        RETURN 'stale';
      END IF;
      IF existing.state = 'processing'
         AND existing.claim_token = claim_token_in THEN
        RETURN 'claimed';
      END IF;
      IF existing.state = 'processing'
         AND existing.lease_expires_at > now_value THEN
        RETURN 'busy';
      END IF;
      IF existing.state IN ('processing', 'retryable') THEN
        UPDATE public.wechat_callback_receipts AS receipt
        SET state = 'processing',
            claim_token = claim_token_in,
            lease_expires_at = now_value + interval '2 minutes',
            attempt_count = receipt.attempt_count + 1,
            updated_at = GREATEST(now_value, receipt.updated_at)
        WHERE receipt.event_key = event_key_in;
        RETURN 'claimed';
      END IF;
      RETURN 'invalid';
    END IF;

    IF callback_timestamp_in < now_epoch - 300
       OR callback_timestamp_in > now_epoch + 60 THEN
      RETURN 'stale';
    END IF;

    INSERT INTO public.wechat_callback_receipts (
      event_key, payload_sha256, callback_timestamp, state, claim_token,
      lease_expires_at, attempt_count, created_at, updated_at
    ) VALUES (
      event_key_in, payload_sha256_in, callback_timestamp_in, 'processing',
      claim_token_in, now_value + interval '2 minutes', 1, now_value, now_value
    ) ON CONFLICT (event_key) DO NOTHING;
    GET DIAGNOSTICS inserted_count = ROW_COUNT;

    IF inserted_count = 1 THEN
      -- Retention runs only after a fresh first claim was inserted. Completed,
      -- busy, conflicting and stale retries take no cleanup write locks.
      WITH candidates AS (
        SELECT receipt.event_key
        FROM public.wechat_callback_receipts AS receipt
        WHERE receipt.event_key <> event_key_in
          AND (
            (receipt.state = 'completed'
             AND receipt.completed_at < now_value - interval '30 days')
            OR (receipt.state <> 'completed'
                AND receipt.updated_at < now_value - interval '30 days'
                AND (receipt.lease_expires_at IS NULL
                     OR receipt.lease_expires_at <= now_value))
          )
        ORDER BY COALESCE(receipt.completed_at, receipt.updated_at),
                 receipt.event_key
        LIMIT 100
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM public.wechat_callback_receipts AS receipt
      USING candidates
      WHERE receipt.event_key = candidates.event_key;
      RETURN 'claimed';
    END IF;
    -- A concurrent insert won the primary key; lock and classify it above.
  END LOOP;
END;
$function$;

CREATE FUNCTION public.complete_wechat_callback_receipt(
  event_key_in text,
  payload_sha256_in text,
  claim_token_in uuid,
  trace_id_in text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  changed_count integer := 0;
  now_value timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF event_key_in IS NULL
     OR payload_sha256_in IS NULL
     OR payload_sha256_in !~ '^[0-9a-f]{64}$'
     OR claim_token_in IS NULL
     OR trace_id_in IS NULL
     OR trace_id_in !~ '^[A-Za-z0-9_-]{4,128}$'
     OR event_key_in IS DISTINCT FROM 'wxa_media_check:' || trace_id_in THEN
    RETURN false;
  END IF;

  PERFORM receipt.event_key
  FROM public.wechat_callback_receipts AS receipt
  WHERE receipt.event_key = event_key_in
    AND receipt.payload_sha256 = payload_sha256_in
    AND receipt.state = 'processing'
    AND receipt.claim_token = claim_token_in
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  -- trace_id is the mapping PK, so a DB-first mixed window may delete zero or
  -- one row, never more. Risky callers must validate mapping ownership/path
  -- and successfully delete (or confirm absence of) Storage before this RPC.
  DELETE FROM public.wechat_media_checks AS media
  WHERE media.trace_id = trace_id_in;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count NOT IN (0, 1) THEN
    RAISE EXCEPTION 'wechat_callback_media_mapping_cardinality_changed'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.wechat_callback_receipts AS receipt
  SET state = 'completed', claim_token = NULL, lease_expires_at = NULL,
      updated_at = GREATEST(now_value, receipt.updated_at),
      completed_at = GREATEST(now_value, receipt.created_at)
  WHERE receipt.event_key = event_key_in
    AND receipt.payload_sha256 = payload_sha256_in
    AND receipt.state = 'processing'
    AND receipt.claim_token = claim_token_in;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 1 THEN
    RAISE EXCEPTION 'wechat_callback_completion_changed'
      USING ERRCODE = '40001';
  END IF;
  RETURN true;
END;
$function$;

CREATE FUNCTION public.release_wechat_callback_receipt(
  event_key_in text,
  payload_sha256_in text,
  claim_token_in uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  changed_count integer := 0;
  now_value timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF event_key_in IS NULL
     OR event_key_in !~ '^wxa_media_check:[A-Za-z0-9_-]{4,128}$'
     OR payload_sha256_in IS NULL
     OR payload_sha256_in !~ '^[0-9a-f]{64}$'
     OR claim_token_in IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.wechat_callback_receipts AS receipt
  SET state = 'retryable', claim_token = NULL, lease_expires_at = NULL,
      updated_at = GREATEST(now_value, receipt.updated_at)
  WHERE receipt.event_key = event_key_in
    AND receipt.payload_sha256 = payload_sha256_in
    AND receipt.state = 'processing'
    AND receipt.claim_token = claim_token_in;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  RETURN changed_count = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_wechat_callback_receipt(text, text, bigint, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_wechat_callback_receipt(text, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_wechat_callback_receipt(text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_wechat_callback_receipt(text, text, bigint, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_wechat_callback_receipt(text, text, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_wechat_callback_receipt(text, text, uuid)
  TO service_role;

DO $postcondition$
DECLARE
  receipt_owner oid;
  function_oid regprocedure;
BEGIN
  SELECT relation.relowner INTO STRICT receipt_owner
  FROM pg_catalog.pg_class AS relation
  WHERE relation.oid = 'public.wechat_callback_receipts'::pg_catalog.regclass;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS api_role(role_name)
    CROSS JOIN LATERAL pg_catalog.unnest(
      ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]
    ) AS requested(privilege_name)
    WHERE pg_catalog.has_table_privilege(
      api_role.role_name, 'public.wechat_callback_receipts', requested.privilege_name
    )
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'public.wechat_callback_receipts'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION 'wechat_callback_receipt_table_acl_postcondition_failed'
      USING ERRCODE = '55000';
  END IF;

  FOREACH function_oid IN ARRAY ARRAY[
    'public.claim_wechat_callback_receipt(text,text,bigint,uuid)'::pg_catalog.regprocedure,
    'public.complete_wechat_callback_receipt(text,text,uuid,text)'::pg_catalog.regprocedure,
    'public.release_wechat_callback_receipt(text,text,uuid)'::pg_catalog.regprocedure
  ] LOOP
    IF (SELECT routine.proowner FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = function_oid) IS DISTINCT FROM receipt_owner
       OR pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', function_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege(
         'service_role', function_oid, 'EXECUTE WITH GRANT OPTION'
       ) THEN
      RAISE EXCEPTION 'wechat_callback_receipt_rpc_postcondition_failed: %',
        function_oid USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$postcondition$;

NOTIFY pgrst, 'reload schema';
COMMIT;
