-- Read-only post-deploy verification for
-- 20260722161200_protect_admin_owner_presentation_signal.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '30s';

DO $verify$
DECLARE
  trigger_function_oid oid := pg_catalog.to_regprocedure(
    'public.admin_protect_recovery_tokens()'
  );
  trigger_source text;
  active_owner_issuers bigint;
  recoverable_owner_issuers bigint;
  migration_record_count bigint := 0;
BEGIN
  IF trigger_function_oid IS NULL THEN
    RAISE EXCEPTION 'verify_failed: owner recovery trigger function is missing';
  END IF;

  SELECT routine.prosrc
    INTO trigger_source
    FROM pg_catalog.pg_proc AS routine
   WHERE routine.oid = trigger_function_oid
     AND routine.proowner = pg_catalog.to_regrole('postgres')::oid
     AND routine.prosecdef
     AND routine.provolatile = 'v'
     AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[];

  IF trigger_source IS NULL
     OR pg_catalog.strpos(
       trigger_source,
       'old_was_recoverable_owner AND NOT new_is_recoverable_owner'
     ) = 0
     OR pg_catalog.strpos(
       trigger_source,
       'MESSAGE = ''last_active_owner_token'''
     ) = 0 THEN
    RAISE EXCEPTION
      'verify_failed: owner recovery guard source/security context drifted';
  END IF;

  IF pg_catalog.has_function_privilege(
       'anon', trigger_function_oid, 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'authenticated', trigger_function_oid, 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'service_role', trigger_function_oid, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'verify_failed: owner recovery trigger function is API-executable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid =
           'public.admin_tokens'::pg_catalog.regclass
       AND trigger_row.tgname = 'admin_tokens_protect_recovery'
       AND NOT trigger_row.tgisinternal
       AND trigger_row.tgenabled = 'O'
       AND trigger_row.tgfoid = trigger_function_oid
       AND trigger_row.tgtype = 27
       AND pg_catalog.pg_get_triggerdef(trigger_row.oid) ILIKE
           '%BEFORE DELETE OR UPDATE OF admin_id, revoked_at, expires_at, last_used_at, role ON public.admin_tokens%'
  ) THEN
    RAISE EXCEPTION
      'verify_failed: last_used_at owner recovery trigger topology drifted';
  END IF;

  SELECT
    pg_catalog.count(*) FILTER (
      WHERE token.role = 'owner'
        AND token.admin_id IS NOT NULL
        AND token.revoked_at IS NULL
        AND (
          token.expires_at IS NULL
          OR token.expires_at > pg_catalog.clock_timestamp()
        )
        AND public.admin_token_identity_safe(
          token.admin_name,
          token.admin_email
        )
        AND EXISTS (
          SELECT 1
            FROM public.profiles AS profile
           WHERE profile.id = token.admin_id
        )
    ),
    pg_catalog.count(*) FILTER (
      WHERE public.admin_owner_token_recoverable(
        token.admin_id,
        token.role,
        token.revoked_at,
        token.expires_at,
        token.last_used_at,
        token.admin_name,
        token.admin_email
      )
        AND EXISTS (
          SELECT 1
            FROM public.profiles AS profile
           WHERE profile.id = token.admin_id
        )
    )
    INTO active_owner_issuers, recoverable_owner_issuers
    FROM public.admin_tokens AS token;

  IF active_owner_issuers < 1 OR recoverable_owner_issuers < 1 THEN
    RAISE EXCEPTION
      'verify_failed: deployment lacks an active and recoverable owner issuer (active %, recoverable %)',
      active_owner_issuers,
      recoverable_owner_issuers;
  END IF;

  IF pg_catalog.to_regclass(
       'supabase_migrations.schema_migrations'
     ) IS NULL THEN
    RAISE EXCEPTION 'verify_failed: Supabase migration ledger is missing';
  END IF;

  EXECUTE
    'SELECT count(*)
       FROM supabase_migrations.schema_migrations
      WHERE version = $1 OR name = $2'
    INTO migration_record_count
    USING
      '20260722161200',
      '20260722161200_protect_admin_owner_presentation_signal';

  IF migration_record_count <> 1 THEN
    RAISE EXCEPTION
      'verify_failed: expected exactly one 20260722161200_protect_admin_owner_presentation_signal ledger row, found %',
      migration_record_count;
  END IF;
END;
$verify$;

SELECT
  trigger_row.tgname,
  pg_catalog.pg_get_triggerdef(trigger_row.oid) AS trigger_definition
FROM pg_catalog.pg_trigger AS trigger_row
WHERE trigger_row.tgrelid = 'public.admin_tokens'::pg_catalog.regclass
  AND trigger_row.tgname = 'admin_tokens_protect_recovery'
  AND NOT trigger_row.tgisinternal;

ROLLBACK;
