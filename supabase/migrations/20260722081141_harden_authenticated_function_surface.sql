-- =============================================================================
-- Retire stale authenticated RPC overloads and fail closed for future
-- postgres-owned functions created in the public API schema.
--
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default.  Supabase's
-- public-schema default ACL also carried explicit grants for its API roles.
-- The global PUBLIC revoke and schema-specific API-role revoke are both
-- required: a per-schema revoke cannot undo the built-in global default.
-- Existing functions are intentionally unchanged except for the three legacy
-- overloads whose expected-account replacements are already used by the app.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $migration_precheck$
DECLARE
  routine_oid oid;
  dependent_count bigint;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'function-surface hardening must run as postgres, got %', current_user;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS required(role_name)
    WHERE pg_catalog.to_regrole(required.role_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'required Supabase API role is missing';
  END IF;

  FOREACH routine_oid IN ARRAY ARRAY[
    pg_catalog.to_regprocedure('public.mark_onboarded(text,text,text)'),
    pg_catalog.to_regprocedure('public.record_consent(text)'),
    pg_catalog.to_regprocedure('public.submit_appeal(text)')
  ]
  LOOP
    IF routine_oid IS NULL THEN
      RAISE EXCEPTION 'legacy authenticated RPC prerequisite is missing';
    END IF;

    SELECT pg_catalog.count(*)
    INTO dependent_count
    FROM pg_catalog.pg_depend AS dependency
    WHERE dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
      AND dependency.refobjid = routine_oid
      AND dependency.deptype NOT IN ('i', 'e');

    IF dependent_count <> 0 THEN
      RAISE EXCEPTION
        'legacy RPC % still has % database dependents',
        routine_oid::pg_catalog.regprocedure,
        dependent_count;
    END IF;
  END LOOP;

  IF pg_catalog.to_regprocedure(
       'public.mark_onboarded(text,text,uuid,text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.record_consent(text,uuid)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.submit_appeal(text,uuid,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'expected-account authenticated RPC replacement is missing';
  END IF;
END;
$migration_precheck$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role;

DROP FUNCTION public.mark_onboarded(text, text, text);
DROP FUNCTION public.record_consent(text);
DROP FUNCTION public.submit_appeal(text);

NOTIFY pgrst, 'reload schema';

COMMIT;
