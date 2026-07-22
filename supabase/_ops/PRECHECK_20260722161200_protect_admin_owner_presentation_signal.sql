-- Read-only production preflight for
-- 20260722161200_protect_admin_owner_presentation_signal.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $precheck$
DECLARE
  trigger_function_oid oid := pg_catalog.to_regprocedure(
    'public.admin_protect_recovery_tokens()'
  );
  trigger_source text;
  active_owner_issuers bigint;
  recoverable_owner_issuers bigint;
  owner_tail_recorded boolean := false;
  invalid_auth_tail_recorded boolean := false;
  presentation_tail_recorded boolean := false;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'precheck_failed: owner presentation migration must run as postgres, got %',
      current_user;
  END IF;

  IF pg_catalog.to_regclass('public.admin_tokens') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR trigger_function_oid IS NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_owner_token_recoverable(uuid,text,timestamptz,timestamptz,timestamptz,text,text)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'precheck_failed: owner presentation prerequisites are incomplete';
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
      'precheck_failed: owner recovery guard source/security context drifted';
  END IF;

  IF pg_catalog.has_function_privilege(
       'anon', trigger_function_oid, 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'authenticated', trigger_function_oid, 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'service_role', trigger_function_oid, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'precheck_failed: owner recovery trigger function is API-executable';
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
           '%BEFORE DELETE OR UPDATE OF admin_id, revoked_at, expires_at, role ON public.admin_tokens%'
       AND pg_catalog.pg_get_triggerdef(trigger_row.oid) NOT ILIKE
           '%last_used_at%'
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: expected predecessor trigger topology drifted';
  END IF;

  IF NOT pg_catalog.pg_try_advisory_xact_lock(20260718180000::bigint)
     OR NOT pg_catalog.pg_try_advisory_xact_lock(20260718190000::bigint) THEN
    RAISE EXCEPTION
      'precheck_failed: administrator lifecycle lock namespace is busy';
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
      'precheck_failed: target lacks an active and recoverable owner issuer (active %, recoverable %)',
      active_owner_issuers,
      recoverable_owner_issuers;
  END IF;

  IF pg_catalog.to_regclass(
       'supabase_migrations.schema_migrations'
     ) IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: Supabase migration ledger is missing';
  END IF;

  EXECUTE
    'SELECT
       EXISTS (
         SELECT 1 FROM supabase_migrations.schema_migrations
          WHERE version = $1 OR name = $2
       ),
       EXISTS (
         SELECT 1 FROM supabase_migrations.schema_migrations
          WHERE version = $3 OR name = $4
       ),
       EXISTS (
         SELECT 1 FROM supabase_migrations.schema_migrations
          WHERE version = $5 OR name = $6
       )'
    INTO
      owner_tail_recorded,
      invalid_auth_tail_recorded,
      presentation_tail_recorded
    USING
      '20260722145042',
      '20260722145042_harden_last_active_owner_revoke',
      '20260722152000',
      '20260722152000_harden_admin_invalid_auth_amplification',
      '20260722161200',
      '20260722161200_protect_admin_owner_presentation_signal';

  IF NOT owner_tail_recorded OR NOT invalid_auth_tail_recorded THEN
    RAISE EXCEPTION
      'precheck_failed: ordered 145042/152000 prerequisite ledger rows are missing';
  END IF;
  IF presentation_tail_recorded THEN
    RAISE EXCEPTION
      'precheck_failed: migration ledger already contains 20260722161200_protect_admin_owner_presentation_signal';
  END IF;

  RAISE NOTICE
    'owner presentation precheck: active owner issuers %, recoverable owner issuers %',
    active_owner_issuers,
    recoverable_owner_issuers;
END;
$precheck$;

ROLLBACK;
