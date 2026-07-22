-- Read-only production preflight for
-- 20260722145042_harden_last_active_owner_revoke.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $precheck$
DECLARE
  guard_oid oid := pg_catalog.to_regprocedure(
    'public.admin_assert_token_revoke_allowed(uuid,uuid)'
  );
  trigger_function_oid oid := pg_catalog.to_regprocedure(
    'public.admin_protect_recovery_tokens()'
  );
  active_owner_issuers bigint;
  recoverable_owner_issuers bigint;
  migration_recorded boolean := false;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'precheck_failed: owner continuity migration must run as postgres, got %',
      current_user;
  END IF;

  IF pg_catalog.to_regclass('public.admin_tokens') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass(
       'public.admin_role_action_capabilities'
     ) IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: administrator token schema is incomplete';
  END IF;

  IF guard_oid IS NULL OR trigger_function_oid IS NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_owner_token_recoverable(uuid,text,timestamptz,timestamptz,timestamptz)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_execute_mutation(text,uuid,text,text,jsonb)'
     ) IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: administrator lifecycle functions are incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid IN (guard_oid, trigger_function_oid)
       AND (
         routine.proowner <> pg_catalog.to_regrole('postgres')::oid
         OR NOT routine.prosecdef
         OR routine.proconfig IS DISTINCT FROM
            ARRAY['search_path=pg_catalog']::text[]
       )
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: recovery guard owner/security/search_path drifted';
  END IF;

  IF pg_catalog.has_function_privilege(
       'anon', guard_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', guard_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', guard_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', trigger_function_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', trigger_function_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', trigger_function_oid, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'precheck_failed: internal recovery guard is executable by an API role';
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
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: recovery row-trigger topology drifted';
  END IF;

  -- Fail before the DDL window rather than waiting behind a live control-plane
  -- mutation. These transaction locks are released by the final ROLLBACK.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(20260718180000::bigint)
     OR NOT pg_catalog.pg_try_advisory_xact_lock(20260718190000::bigint) THEN
    RAISE EXCEPTION
      'precheck_failed: administrator lifecycle lock namespace is busy';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_role_action_capabilities AS capability
     WHERE capability.admin_role = 'security_admin'
       AND capability.action = 'revoke_token'
  ) OR NOT EXISTS (
    SELECT 1
      FROM public.admin_role_action_capabilities AS capability
     WHERE capability.admin_role = 'security_admin'
       AND capability.action = 'revoke_admin_tokens'
  ) OR NOT EXISTS (
    SELECT 1
      FROM public.admin_role_action_capabilities AS capability
     WHERE capability.admin_role = 'owner'
       AND capability.action = 'issue_token'
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: lifecycle capability matrix drifted';
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
        AND token.identity_safe
        AND EXISTS (
          SELECT 1
            FROM public.profiles AS owner_profile
           WHERE owner_profile.id = token.admin_id
        )
    ),
    pg_catalog.count(*) FILTER (
      WHERE public.admin_owner_token_recoverable(
        token.admin_id,
        token.role,
        token.revoked_at,
        token.expires_at,
        token.last_used_at
      )
        AND token.identity_safe
        AND EXISTS (
          SELECT 1
            FROM public.profiles AS owner_profile
           WHERE owner_profile.id = token.admin_id
        )
    )
    INTO active_owner_issuers, recoverable_owner_issuers
    FROM (
      SELECT raw_token.*,
             raw_token.admin_name IS NOT NULL
               AND pg_catalog.length(raw_token.admin_name) BETWEEN 1 AND 100
               AND raw_token.admin_name !~ '[[:cntrl:]]'
               AND raw_token.admin_email IS NOT NULL
               AND pg_catalog.length(raw_token.admin_email) BETWEEN 3 AND 200
               AND pg_catalog.strpos(raw_token.admin_email, '@') > 0
               AND raw_token.admin_email !~ '[[:cntrl:]]'
               AND NOT EXISTS (
                 SELECT 1
                   FROM pg_catalog.unnest(ARRAY[
                     U&'\061C', U&'\200E', U&'\200F', U&'\202A',
                     U&'\202B', U&'\202C', U&'\202D', U&'\202E',
                     U&'\2066', U&'\2067', U&'\2068', U&'\2069'
                   ]::text[]) AS unsafe(codepoint)
                  WHERE pg_catalog.strpos(
                          raw_token.admin_name,
                          unsafe.codepoint
                        ) > 0
                     OR pg_catalog.strpos(
                          raw_token.admin_email,
                          unsafe.codepoint
                        ) > 0
               ) AS identity_safe
        FROM public.admin_tokens AS raw_token
    ) AS token;

  IF active_owner_issuers < 1 OR recoverable_owner_issuers < 1 THEN
    RAISE EXCEPTION
      'precheck_failed: target already lacks an active and recoverable owner issuer (active %, recoverable %); stop and use the external break-glass procedure',
      active_owner_issuers,
      recoverable_owner_issuers;
  END IF;

  -- Supabase CLI preserves the filename timestamp as `version`; the hosted
  -- apply_migration API assigns its own ledger timestamp and preserves the
  -- reviewed migration stem in `name`. Refuse a replay under either identity.
  IF pg_catalog.to_regclass(
       'supabase_migrations.schema_migrations'
     ) IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1
           FROM supabase_migrations.schema_migrations
          WHERE version = $1 OR name = $2
       )'
      INTO migration_recorded
      USING
        '20260722145042',
        '20260722145042_harden_last_active_owner_revoke';
    IF migration_recorded THEN
      RAISE EXCEPTION
        'precheck_failed: migration ledger already contains 20260722145042_harden_last_active_owner_revoke';
    END IF;
  END IF;

  RAISE NOTICE
    'owner continuity precheck: active owner issuers %, recoverable owner issuers %',
    active_owner_issuers,
    recoverable_owner_issuers;
END;
$precheck$;

SELECT
  routine.oid::pg_catalog.regprocedure AS function_signature,
  pg_catalog.pg_get_userbyid(routine.proowner) AS function_owner,
  routine.prosecdef AS security_definer,
  routine.proconfig,
  routine.proacl
FROM pg_catalog.pg_proc AS routine
WHERE routine.oid IN (
  pg_catalog.to_regprocedure(
    'public.admin_assert_token_revoke_allowed(uuid,uuid)'
  ),
  pg_catalog.to_regprocedure('public.admin_protect_recovery_tokens()')
)
ORDER BY routine.oid::pg_catalog.regprocedure::text;

ROLLBACK;
