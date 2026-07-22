-- LOCAL/STAGING ONLY — NEVER PRODUCTION.
-- Rollback-only execution regression for
-- 20260722081141_harden_authenticated_function_surface.sql.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '2min';

DO $rpc_surface_contract$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'regression_failed: default ACL probe must run as postgres, got %',
      current_user;
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.mark_onboarded(text,text,text)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.record_consent(text)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.submit_appeal(text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'regression_failed: stale RPC overload remains';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.mark_onboarded(text,text,uuid,text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.record_consent(text,uuid)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.submit_appeal(text,uuid,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'regression_failed: expected-account RPC is missing';
  END IF;
END;
$rpc_surface_contract$;

-- This function is created after the migration, so its ACL is a functional
-- proof of the hardened default-privilege composition rather than a catalog
-- snapshot of the ALTER DEFAULT PRIVILEGES statements.
CREATE FUNCTION public.caaci_default_acl_probe_20260722081141()
RETURNS integer
LANGUAGE sql
SET search_path = pg_catalog
AS 'SELECT 1';

DO $default_acl_contract$
DECLARE
  probe_oid oid := pg_catalog.to_regprocedure(
    'public.caaci_default_acl_probe_20260722081141()'
  );
BEGIN
  IF probe_oid IS NULL THEN
    RAISE EXCEPTION 'regression_failed: default ACL probe was not created';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
       current_user, probe_oid, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'regression_failed: probe owner lost EXECUTE';
  END IF;
  IF pg_catalog.has_function_privilege('anon', probe_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'authenticated', probe_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', probe_oid, 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS routine
       CROSS JOIN LATERAL pg_catalog.aclexplode(
         COALESCE(
           routine.proacl,
           pg_catalog.acldefault('f', routine.proowner)
         )
       ) AS acl
       WHERE routine.oid = probe_oid
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'regression_failed: new public function is API executable by default';
  END IF;
END;
$default_acl_contract$;

DROP FUNCTION public.caaci_default_acl_probe_20260722081141();

ROLLBACK;
