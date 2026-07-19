-- Read-only structural verification for
-- 20260718150000_ephemeral_data_retention.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  rpc_oid oid := pg_catalog.to_regprocedure(
    'public.run_ephemeral_data_retention()'
  );
  rpc_source text;
  required_fragment text;
  index_name text;
BEGIN
  IF rpc_oid IS NULL THEN
    RAISE EXCEPTION 'verify_failed: retention RPC missing';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_proc AS function
    WHERE function.pronamespace = 'public'::pg_catalog.regnamespace
      AND function.proname = 'run_ephemeral_data_retention'
  ) <> 1 THEN
    RAISE EXCEPTION 'verify_failed: unexpected retention RPC overload';
  END IF;

  SELECT function.prosrc
  INTO STRICT rpc_source
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid = rpc_oid;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = rpc_oid
      AND function.prokind = 'f'
      AND function.prosecdef
      AND function.provolatile = 'v'
      AND function.pronargs = 0
      AND function.prorettype = 'record'::pg_catalog.regtype
      AND COALESCE(function.proconfig, ARRAY[]::text[])
        @> ARRAY['search_path=pg_catalog']::text[]
      AND function.proargnames = ARRAY[
        'edge_rate_limits_deleted',
        'illini_verifications_deleted',
        'wechat_media_checks_deleted',
        'has_more'
      ]::text[]
  ) THEN
    RAISE EXCEPTION 'verify_failed: retention RPC shape/security contract';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
    ) AS function_acl
    WHERE function.oid = rpc_oid
      AND function_acl.grantee = 0
      AND function_acl.privilege_type = 'EXECUTE'
  )
     OR pg_catalog.has_function_privilege('anon', rpc_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', rpc_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', rpc_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'verify_failed: retention RPC ACL is not service-role-only';
  END IF;

  FOREACH required_fragment IN ARRAY ARRAY[
    'pg_catalog.pg_try_advisory_xact_lock(1128358729, 1)',
    'v_batch_limit constant integer := 1000',
    'public.edge_rate_limits',
    'public.illini_verifications',
    'public.wechat_media_checks',
    'interval ''7 days''',
    'for update skip locked',
    'limit v_batch_limit'
  ]::text[] LOOP
    IF pg_catalog.strpos(
      pg_catalog.lower(rpc_source),
      pg_catalog.lower(required_fragment)
    ) = 0 THEN
      RAISE EXCEPTION
        'verify_failed: retention RPC missing contract fragment %',
        required_fragment;
    END IF;
  END LOOP;

  IF pg_catalog.strpos(pg_catalog.upper(rpc_source), 'EXECUTE ') > 0 THEN
    RAISE EXCEPTION 'verify_failed: retention RPC must not use dynamic SQL';
  END IF;

  FOREACH index_name IN ARRAY ARRAY[
    'edge_rate_limits_window_start_idx',
    'illini_verifications_expires_at_idx',
    'wechat_media_checks_retention_idx'
  ]::text[] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS index_relation
      JOIN pg_catalog.pg_index AS index_definition
        ON index_definition.indexrelid = index_relation.oid
      WHERE index_relation.relnamespace = 'public'::pg_catalog.regnamespace
        AND index_relation.relname = index_name
        AND index_relation.relkind = 'i'
        AND index_definition.indisvalid
        AND index_definition.indisready
    ) THEN
      RAISE EXCEPTION 'verify_failed: retention index % missing/invalid', index_name;
    END IF;
  END LOOP;
END
$verify$;

SELECT
  function.oid::regprocedure AS function_signature,
  function.prosecdef AS is_security_definer,
  function.proconfig,
  pg_catalog.has_function_privilege(
    'anon', function.oid, 'EXECUTE'
  ) AS anon_execute,
  pg_catalog.has_function_privilege(
    'authenticated', function.oid, 'EXECUTE'
  ) AS authenticated_execute,
  pg_catalog.has_function_privilege(
    'service_role', function.oid, 'EXECUTE'
  ) AS service_role_execute,
  pg_catalog.pg_get_functiondef(function.oid) AS definition
FROM pg_catalog.pg_proc AS function
WHERE function.oid = pg_catalog.to_regprocedure(
  'public.run_ephemeral_data_retention()'
);

SELECT
  index_relation.relname AS index_name,
  index_definition.indisvalid,
  pg_catalog.pg_get_indexdef(index_relation.oid) AS definition
FROM pg_catalog.pg_class AS index_relation
JOIN pg_catalog.pg_index AS index_definition
  ON index_definition.indexrelid = index_relation.oid
WHERE index_relation.oid IN (
  'public.edge_rate_limits_window_start_idx'::pg_catalog.regclass,
  'public.illini_verifications_expires_at_idx'::pg_catalog.regclass,
  'public.wechat_media_checks_retention_idx'::pg_catalog.regclass
)
ORDER BY index_relation.relname;

ROLLBACK;
