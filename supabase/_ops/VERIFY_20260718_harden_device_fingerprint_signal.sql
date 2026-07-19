-- Read-only post-deploy verification for the advisory fingerprint boundary.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  record_rpc oid := pg_catalog.to_regprocedure(
    'public.record_fingerprint(text,text)'
  );
  ban_rpc oid := pg_catalog.to_regprocedure(
    'public.apply_ban_level(uuid,smallint,text,text,integer)'
  );
  record_source text;
  ban_source text;
BEGIN
  IF record_rpc IS NULL OR ban_rpc IS NULL THEN
    RAISE EXCEPTION 'verify_failed: fingerprint RPCs missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = record_rpc
      AND function.prokind = 'f'
      AND function.prosecdef
      AND function.provolatile = 'v'
      AND function.prorettype = 'void'::pg_catalog.regtype
      AND function.proargnames = ARRAY['fp_hash_in', 'ua_snippet_in']::text[]
      AND COALESCE(function.proconfig, ARRAY[]::text[])
        @> ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION 'verify_failed: record_fingerprint shape mismatch';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'authenticated', record_rpc, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', record_rpc, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', record_rpc, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS function
       CROSS JOIN LATERAL pg_catalog.aclexplode(
         COALESCE(
           function.proacl,
           pg_catalog.acldefault('f', function.proowner)
         )
       ) AS function_acl
       WHERE function.oid = record_rpc
         AND function_acl.grantee = 0
         AND function_acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: record_fingerprint ACL mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = ban_rpc
      AND function.prokind = 'f'
      AND function.prosecdef
      AND function.provolatile = 'v'
      AND function.prorettype = 'uuid'::pg_catalog.regtype
      AND COALESCE(function.proconfig, ARRAY[]::text[])
        @> ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION 'verify_failed: apply_ban_level shape mismatch';
  END IF;

  IF NOT pg_catalog.has_function_privilege('service_role', ban_rpc, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', ban_rpc, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', ban_rpc, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS function
       CROSS JOIN LATERAL pg_catalog.aclexplode(
         COALESCE(
           function.proacl,
           pg_catalog.acldefault('f', function.proowner)
         )
       ) AS function_acl
       WHERE function.oid = ban_rpc
         AND function_acl.grantee = 0
         AND function_acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: apply_ban_level ACL mismatch';
  END IF;

  SELECT function.prosrc INTO record_source
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid = record_rpc;

  IF pg_catalog.strpos(record_source, '^[0-9a-f]{64}$') = 0
     OR pg_catalog.strpos(record_source, 'unique_hash_count >= 20') = 0
     OR pg_catalog.strpos(record_source, 'pg_advisory_xact_lock') = 0
     OR pg_catalog.strpos(record_source, '5 minutes') = 0 THEN
    RAISE EXCEPTION 'verify_failed: strict fingerprint bounds missing';
  END IF;

  SELECT function.prosrc INTO ban_source
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid = ban_rpc;

  IF pg_catalog.strpos(ban_source, 'manual_review_only') = 0
     OR pg_catalog.strpos(ban_source, 'linked_fingerprint_candidates') = 0
     OR pg_catalog.strpos(ban_source, 'SET shadow_banned = true') > 0
     OR pg_catalog.strpos(ban_source, 'FOR alt_id IN') > 0 THEN
    RAISE EXCEPTION 'verify_failed: automatic fingerprint sanction remains';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.device_fingerprints'::regclass
      AND constraint_row.conname = 'device_fingerprints_fp_hash_sha256_chk'
      AND constraint_row.contype = 'c'
      AND NOT constraint_row.convalidated
      AND pg_catalog.pg_get_expr(
        constraint_row.conbin,
        constraint_row.conrelid
      ) = '(fp_hash ~ ''^[0-9a-f]{64}$''::text)'
  ) THEN
    RAISE EXCEPTION 'verify_failed: exact NOT VALID SHA-256 constraint missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.device_fingerprints'::regclass
      AND relation.relrowsecurity
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'device_fingerprints'
      AND policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND (
        'public' = ANY (policy.roles)
        OR 'anon' = ANY (policy.roles)
        OR 'authenticated' = ANY (policy.roles)
      )
  ) THEN
    RAISE EXCEPTION 'verify_failed: direct client fingerprint write boundary';
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
  AND function.proname IN ('record_fingerprint', 'apply_ban_level')
ORDER BY function.oid::pg_catalog.regprocedure::text;

ROLLBACK;
