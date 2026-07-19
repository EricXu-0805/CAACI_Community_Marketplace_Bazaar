-- Read-only post-deploy verification for the rolling submit-appeal boundary.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  intent_rpc oid := pg_catalog.to_regprocedure(
    'public.submit_appeal(text,uuid,uuid)'
  );
  legacy_rpc oid := pg_catalog.to_regprocedure('public.submit_appeal(text)');
  intent_source text;
  legacy_source text;
BEGIN
  IF intent_rpc IS NULL OR legacy_rpc IS NULL THEN
    RAISE EXCEPTION 'verify_failed: rolling submit_appeal RPC missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = intent_rpc
      AND function.prokind = 'f'
      AND function.prosecdef
      AND function.provolatile = 'v'
      AND function.prorettype = 'void'::pg_catalog.regtype
      AND function.proargnames = ARRAY[
        'note_in',
        'expected_user_id_in',
        'expected_suspension_id_in'
      ]::text[]
      AND COALESCE(function.proconfig, ARRAY[]::text[])
        @> ARRAY['search_path=pg_catalog']::text[]
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = legacy_rpc
      AND function.prokind = 'f'
      AND function.prosecdef
      AND function.provolatile = 'v'
      AND function.prorettype = 'void'::pg_catalog.regtype
      AND function.proargnames = ARRAY['note_in']::text[]
      AND COALESCE(function.proconfig, ARRAY[]::text[])
        @> ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION 'verify_failed: submit_appeal function shape/security mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES (intent_rpc), (legacy_rpc)) AS required_rpc(rpc)
    WHERE NOT pg_catalog.has_function_privilege(
            'authenticated', required_rpc.rpc, 'EXECUTE'
          )
       OR pg_catalog.has_function_privilege(
            'anon', required_rpc.rpc, 'EXECUTE'
          )
       OR pg_catalog.has_function_privilege(
            'service_role', required_rpc.rpc, 'EXECUTE'
          )
       OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc AS function
            CROSS JOIN LATERAL pg_catalog.aclexplode(
              COALESCE(
                function.proacl,
                pg_catalog.acldefault('f', function.proowner)
              )
            ) AS function_acl
            WHERE function.oid = required_rpc.rpc
              AND function_acl.grantee = 0
              AND function_acl.privilege_type = 'EXECUTE'
          )
  ) THEN
    RAISE EXCEPTION 'verify_failed: rolling submit_appeal RPC ACL mismatch';
  END IF;

  SELECT function.prosrc INTO intent_source
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid = intent_rpc;

  IF pg_catalog.strpos(intent_source, 'account_changed') = 0
     OR pg_catalog.strpos(intent_source, 'expected_suspension_id_in') = 0
     OR pg_catalog.strpos(intent_source, 'appeal_unavailable') = 0
     OR pg_catalog.strpos(intent_source, 'appeal_note IS NULL') = 0
     OR pg_catalog.strpos(intent_source, 'RETURNING suspension.id') = 0 THEN
    RAISE EXCEPTION 'verify_failed: submit_appeal atomic intent guard missing';
  END IF;

  SELECT function.prosrc INTO legacy_source
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid = legacy_rpc;

  IF pg_catalog.strpos(legacy_source, 'caller_id uuid := auth.uid()') = 0
     OR pg_catalog.strpos(legacy_source, 'invalid_appeal_length') = 0
     OR pg_catalog.strpos(legacy_source, 'newest_suspension.lifted_at IS NULL') = 0
     OR pg_catalog.strpos(legacy_source, 'newest_suspension.appeal_note') <> 0
     OR pg_catalog.strpos(legacy_source, 'suspension.appeal_note IS NULL') = 0
     OR pg_catalog.strpos(legacy_source, 'ORDER BY newest_suspension.created_at DESC') = 0
     OR pg_catalog.strpos(legacy_source, 'RETURNING suspension.id') = 0
     OR pg_catalog.strpos(legacy_source, 'appeal_unavailable') = 0 THEN
    RAISE EXCEPTION 'verify_failed: legacy submit_appeal atomic first-write guard missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS overload
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = overload.pronamespace
    WHERE namespace.nspname = 'public'
      AND overload.proname = 'submit_appeal'
      AND overload.oid NOT IN (intent_rpc, legacy_rpc)
      AND (
        pg_catalog.has_function_privilege('anon', overload.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege(
          'authenticated', overload.oid, 'EXECUTE'
        )
        OR pg_catalog.has_function_privilege(
          'service_role', overload.oid, 'EXECUTE'
        )
      )
  ) THEN
    RAISE EXCEPTION 'verify_failed: unexpected submit_appeal overload is API-callable';
  END IF;
END
$verify$;

SELECT
  function.oid::pg_catalog.regprocedure AS function_name,
  function.prosecdef AS security_definer,
  function.proconfig AS fixed_config,
  pg_catalog.has_function_privilege('anon', function.oid, 'EXECUTE') AS anon_execute,
  pg_catalog.has_function_privilege('authenticated', function.oid, 'EXECUTE') AS authenticated_execute,
  pg_catalog.has_function_privilege('service_role', function.oid, 'EXECUTE') AS service_role_execute
FROM pg_catalog.pg_proc AS function
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = function.pronamespace
WHERE namespace.nspname = 'public'
  AND function.proname = 'submit_appeal'
ORDER BY function.oid::pg_catalog.regprocedure::text;

ROLLBACK;
