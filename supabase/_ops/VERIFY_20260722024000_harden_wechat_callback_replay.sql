-- Read-only verification for
-- 20260722024000_harden_wechat_callback_replay.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;

DO $verify$
DECLARE
  receipt_oid oid;
  receipt_owner oid;
  media_oid oid;
  media_owner oid;
  media_primary_key_columns text[];
  function_oid regprocedure;
  routine_definition record;
  expected_return_type regtype;
  direct_public_count integer;
  api_effective_count integer;
  inherited_count integer;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION 'verify_failed: PostgreSQL 16 or newer is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS required(role_name)
    WHERE pg_catalog.to_regrole(required.role_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'verify_failed: API role missing';
  END IF;

  SELECT relation.oid, relation.relowner
  INTO receipt_oid, receipt_owner
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'wechat_callback_receipts'
    AND relation.relkind = 'r'
    AND relation.relrowsecurity
    AND NOT relation.relforcerowsecurity;

  IF receipt_oid IS NULL THEN
    RAISE EXCEPTION 'verify_failed: receipt table/RLS contract missing';
  END IF;

  SELECT relation.oid, relation.relowner
  INTO media_oid, media_owner
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'wechat_media_checks'
    AND relation.relkind = 'r'
    AND relation.relrowsecurity;

  IF media_oid IS NULL OR EXISTS (
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
    RAISE EXCEPTION 'verify_failed: exact media mapping contract missing';
  END IF;

  SELECT pg_catalog.array_agg(attribute.attname ORDER BY key_column.ordinality)
  INTO media_primary_key_columns
  FROM pg_catalog.pg_constraint AS constraint_row
  CROSS JOIN LATERAL pg_catalog.unnest(constraint_row.conkey)
    WITH ORDINALITY AS key_column(attnum, ordinality)
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = constraint_row.conrelid
   AND attribute.attnum = key_column.attnum
  WHERE constraint_row.conrelid = media_oid
    AND constraint_row.contype = 'p';

  IF media_primary_key_columns IS DISTINCT FROM ARRAY['trace_id']::text[]
     OR media_owner IS NULL
     OR NOT pg_catalog.has_table_privilege(
       receipt_owner, media_oid, 'SELECT,DELETE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: mapping key/owner privilege drift';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('event_key', 'text', true),
      ('payload_sha256', 'text', true),
      ('callback_timestamp', 'bigint', true),
      ('state', 'text', true),
      ('claim_token', 'uuid', false),
      ('lease_expires_at', 'timestamp with time zone', false),
      ('attempt_count', 'integer', true),
      ('created_at', 'timestamp with time zone', true),
      ('updated_at', 'timestamp with time zone', true),
      ('completed_at', 'timestamp with time zone', false)
    ) AS required(column_name, type_name, not_null)
    LEFT JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = receipt_oid
     AND attribute.attname = required.column_name
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND attribute.atttypid = pg_catalog.to_regtype(required.type_name)
     AND attribute.attnotnull = required.not_null
    WHERE attribute.attname IS NULL
  ) OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = receipt_oid
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) <> 10 THEN
    RAISE EXCEPTION 'verify_failed: exact receipt column contract drift';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
      attribute.attname::text ORDER BY key_column.ordinality
    )
    FROM pg_catalog.pg_constraint AS constraint_row
    CROSS JOIN LATERAL pg_catalog.unnest(constraint_row.conkey)
      WITH ORDINALITY AS key_column(attnum, ordinality)
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = constraint_row.conrelid
     AND attribute.attnum = key_column.attnum
    WHERE constraint_row.conrelid = receipt_oid
      AND constraint_row.contype = 'p'
  ) IS DISTINCT FROM ARRAY['event_key']::text[]
  OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('wechat_callback_receipts_event_key_check'),
      ('wechat_callback_receipts_payload_sha256_check'),
      ('wechat_callback_receipts_timestamp_check'),
      ('wechat_callback_receipts_attempt_count_check'),
      ('wechat_callback_receipts_time_order_check'),
      ('wechat_callback_receipts_state_check')
    ) AS required(constraint_name)
    LEFT JOIN pg_catalog.pg_constraint AS constraint_row
      ON constraint_row.conrelid = receipt_oid
     AND constraint_row.conname = required.constraint_name
     AND constraint_row.contype = 'c'
     AND constraint_row.convalidated
    WHERE constraint_row.oid IS NULL
  ) OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = receipt_oid
  ) <> 7 OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('wechat_callback_receipts_event_key_check', 'event_key', 'wxa_media_check'),
      ('wechat_callback_receipts_payload_sha256_check', 'payload_sha256', '^[0-9a-f]{64}$'),
      ('wechat_callback_receipts_timestamp_check', 'callback_timestamp', '> 0'),
      ('wechat_callback_receipts_attempt_count_check', 'attempt_count', '1000000'),
      ('wechat_callback_receipts_time_order_check', 'updated_at', 'completed_at'),
      ('wechat_callback_receipts_state_check', 'processing', 'retryable')
    ) AS expected(constraint_name, required_fragment_a, required_fragment_b)
    JOIN pg_catalog.pg_constraint AS constraint_row
      ON constraint_row.conrelid = receipt_oid
     AND constraint_row.conname = expected.constraint_name
    WHERE pg_catalog.strpos(
            pg_catalog.pg_get_constraintdef(constraint_row.oid),
            expected.required_fragment_a
          ) = 0
       OR pg_catalog.strpos(
            pg_catalog.pg_get_constraintdef(constraint_row.oid),
            expected.required_fragment_b
          ) = 0
  ) THEN
    RAISE EXCEPTION 'verify_failed: receipt key/check contract drift';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_index AS index_row
    WHERE index_row.indrelid = receipt_oid
  ) <> 3 OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = index_row.indexrelid
    WHERE index_row.indrelid = receipt_oid
      AND index_relation.relname =
        'wechat_callback_receipts_completed_retention_idx'
      AND index_row.indisvalid
      AND index_row.indisready
      AND NOT index_row.indisunique
      AND index_row.indkey::text = '10 1'
      AND pg_catalog.lower(pg_catalog.regexp_replace(
            pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid),
            '[[:space:]]+', '', 'g'
          )) = '(state=''completed''::text)'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = index_row.indexrelid
    WHERE index_row.indrelid = receipt_oid
      AND index_relation.relname =
        'wechat_callback_receipts_pending_retention_idx'
      AND index_row.indisvalid
      AND index_row.indisready
      AND NOT index_row.indisunique
      AND index_row.indkey::text = '9 1'
      AND pg_catalog.lower(pg_catalog.regexp_replace(
            pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid),
            '[[:space:]]+', '', 'g'
          )) = '(state<>''completed''::text)'
  ) THEN
    RAISE EXCEPTION 'verify_failed: exact receipt retention index drift';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = receipt_oid
  ) THEN
    RAISE EXCEPTION 'verify_failed: deny-all receipt table acquired a policy';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO direct_public_count
  FROM pg_catalog.pg_class AS relation
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
  ) AS acl
  WHERE relation.oid = receipt_oid
    AND acl.grantee = 0
    AND acl.privilege_type IN (
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
      'TRIGGER', 'MAINTAIN'
    );

  SELECT pg_catalog.count(*)::integer
  INTO api_effective_count
  FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
    AS api_role(role_name)
  CROSS JOIN LATERAL pg_catalog.unnest(
    CASE
      WHEN pg_catalog.current_setting('server_version_num')::integer >= 170000
        THEN ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
          'TRIGGER', 'MAINTAIN'
        ]::text[]
      ELSE ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
        'TRIGGER'
      ]::text[]
    END
  ) AS requested(privilege_name)
  WHERE pg_catalog.has_table_privilege(
    api_role.role_name,
    receipt_oid,
    requested.privilege_name
  );

  IF direct_public_count <> 0 OR api_effective_count <> 0 OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
    WHERE attribute.attrelid = receipt_oid
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND (
        acl.grantee = 0
        OR acl.grantee IN (
          pg_catalog.to_regrole('anon')::oid,
          pg_catalog.to_regrole('authenticated')::oid,
          pg_catalog.to_regrole('service_role')::oid
        )
      )
  ) THEN
    RAISE EXCEPTION 'verify_failed: receipt table/column ACL drift';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
      AND routine.proname IN (
        'claim_wechat_callback_receipt',
        'complete_wechat_callback_receipt',
        'release_wechat_callback_receipt'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'verify_failed: callback receipt RPC identity/overload drift';
  END IF;

  FOREACH function_oid IN ARRAY ARRAY[
    'public.claim_wechat_callback_receipt(text,text,bigint,uuid)'::pg_catalog.regprocedure,
    'public.complete_wechat_callback_receipt(text,text,uuid,text)'::pg_catalog.regprocedure,
    'public.release_wechat_callback_receipt(text,text,uuid)'::pg_catalog.regprocedure
  ] LOOP
    expected_return_type := CASE
      WHEN function_oid =
        'public.claim_wechat_callback_receipt(text,text,bigint,uuid)'::pg_catalog.regprocedure
        THEN 'text'::pg_catalog.regtype
      ELSE 'boolean'::pg_catalog.regtype
    END;

    SELECT
      routine.prosecdef,
      routine.proconfig,
      routine.proowner,
      routine.prorettype,
      routine.provolatile,
      routine.proparallel,
      routine.prosrc,
      routine.proargnames
    INTO STRICT routine_definition
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = function_oid;

    IF NOT routine_definition.prosecdef
       OR routine_definition.proconfig IS DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
       OR routine_definition.proowner IS DISTINCT FROM receipt_owner
       OR routine_definition.prorettype IS DISTINCT FROM expected_return_type
       OR routine_definition.provolatile IS DISTINCT FROM 'v'::"char"
       OR routine_definition.proparallel IS DISTINCT FROM 'u'::"char"
       OR routine_definition.proargnames IS DISTINCT FROM (CASE
         WHEN function_oid =
           'public.claim_wechat_callback_receipt(text,text,bigint,uuid)'::pg_catalog.regprocedure
           THEN ARRAY[
             'event_key_in', 'payload_sha256_in',
             'callback_timestamp_in', 'claim_token_in'
           ]::text[]
         WHEN function_oid =
           'public.complete_wechat_callback_receipt(text,text,uuid,text)'::pg_catalog.regprocedure
           THEN ARRAY[
             'event_key_in', 'payload_sha256_in',
             'claim_token_in', 'trace_id_in'
           ]::text[]
         ELSE ARRAY[
           'event_key_in', 'payload_sha256_in', 'claim_token_in'
         ]::text[]
       END)
       OR pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege(
         'authenticated', function_oid, 'EXECUTE'
       )
       OR NOT pg_catalog.has_function_privilege(
         'service_role', function_oid, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'service_role', function_oid, 'EXECUTE WITH GRANT OPTION'
       ) THEN
      RAISE EXCEPTION 'verify_failed: callback RPC contract drift: %', function_oid;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
      ) AS acl
      WHERE routine.oid = function_oid
        AND acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'verify_failed: PUBLIC can execute callback RPC: %', function_oid;
    END IF;

    SELECT pg_catalog.count(*)::integer
    INTO inherited_count
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS api_role(role_name)
    CROSS JOIN pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
    ) AS acl
    WHERE routine.oid = function_oid
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee <> 0
      AND acl.grantee <> pg_catalog.to_regrole(api_role.role_name)::oid
      AND pg_catalog.pg_has_role(
        pg_catalog.to_regrole(api_role.role_name), acl.grantee, 'MEMBER'
      );

    IF inherited_count <> 0 THEN
      RAISE EXCEPTION 'verify_failed: inherited callback RPC ACL drift: %',
        function_oid;
    END IF;
  END LOOP;

  IF pg_catalog.strpos(
       (SELECT routine.prosrc FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid =
          'public.claim_wechat_callback_receipt(text,text,bigint,uuid)'::pg_catalog.regprocedure),
       'now_epoch - 300'
     ) = 0
     OR pg_catalog.strpos(
       (SELECT routine.prosrc FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid =
          'public.claim_wechat_callback_receipt(text,text,bigint,uuid)'::pg_catalog.regprocedure),
       'now_epoch + 60'
     ) = 0
     OR pg_catalog.strpos(
       (SELECT routine.prosrc FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid =
          'public.claim_wechat_callback_receipt(text,text,bigint,uuid)'::pg_catalog.regprocedure),
       'inserted_count = 1'
     ) = 0
     OR pg_catalog.strpos(
       (SELECT routine.prosrc FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid =
          'public.claim_wechat_callback_receipt(text,text,bigint,uuid)'::pg_catalog.regprocedure),
       'FOR UPDATE SKIP LOCKED'
     ) = 0
     OR pg_catalog.strpos(
       (SELECT routine.prosrc FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid =
          'public.complete_wechat_callback_receipt(text,text,uuid,text)'::pg_catalog.regprocedure),
       'DELETE FROM public.wechat_media_checks'
     ) = 0 THEN
    RAISE EXCEPTION 'verify_failed: freshness/atomic cleanup body drift';
  END IF;
END;
$verify$;

SELECT
  relation.oid::pg_catalog.regclass AS receipt_table,
  relation.relrowsecurity AS rls_enabled,
  relation.relforcerowsecurity AS rls_forced,
  relation.relacl
FROM pg_catalog.pg_class AS relation
WHERE relation.oid =
  'public.wechat_callback_receipts'::pg_catalog.regclass;

SELECT
  routine.oid::pg_catalog.regprocedure AS function_signature,
  routine.proargnames AS parameter_names,
  routine.prosecdef AS security_definer,
  routine.proconfig,
  routine.proacl,
  pg_catalog.has_function_privilege(
    'anon', routine.oid, 'EXECUTE'
  ) AS anon_execute,
  pg_catalog.has_function_privilege(
    'authenticated', routine.oid, 'EXECUTE'
  ) AS authenticated_execute,
  pg_catalog.has_function_privilege(
    'service_role', routine.oid, 'EXECUTE'
  ) AS service_role_execute
FROM pg_catalog.pg_proc AS routine
WHERE routine.oid IN (
  'public.claim_wechat_callback_receipt(text,text,bigint,uuid)'::pg_catalog.regprocedure,
  'public.complete_wechat_callback_receipt(text,text,uuid,text)'::pg_catalog.regprocedure,
  'public.release_wechat_callback_receipt(text,text,uuid)'::pg_catalog.regprocedure
)
ORDER BY routine.oid::pg_catalog.regprocedure::text;

ROLLBACK;
