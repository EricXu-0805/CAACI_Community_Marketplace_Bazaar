-- Read-only post-deploy verification for
-- 20260722145042_harden_last_active_owner_revoke.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '30s';

DO $verify$
DECLARE
  guard_oid oid := pg_catalog.to_regprocedure(
    'public.admin_assert_token_revoke_allowed(uuid,uuid)'
  );
  trigger_function_oid oid := pg_catalog.to_regprocedure(
    'public.admin_protect_recovery_tokens()'
  );
  identity_oid oid := pg_catalog.to_regprocedure(
    'public.admin_token_identity_safe(text,text)'
  );
  recoverable_oid oid := pg_catalog.to_regprocedure(
    'public.admin_owner_token_recoverable(uuid,text,timestamptz,timestamptz,timestamptz,text,text)'
  );
  compatibility_recoverable_oid oid := pg_catalog.to_regprocedure(
    'public.admin_owner_token_recoverable(uuid,text,timestamptz,timestamptz,timestamptz)'
  );
  identity_write_oid oid := pg_catalog.to_regprocedure(
    'public.admin_validate_token_identity_write()'
  );
  authorization_v1_oid oid := pg_catalog.to_regprocedure(
    'public.admin_token_authorization(text)'
  );
  authorization_v2_oid oid := pg_catalog.to_regprocedure(
    'public.admin_token_authorization_v2(text)'
  );
  reconcile_oid oid := pg_catalog.to_regprocedure(
    'public.admin_reconcile_issued_token(text)'
  );
  inventory_oid oid := pg_catalog.to_regprocedure(
    'public.admin_token_inventory()'
  );
  routine_oid oid;
  guard_source text;
  trigger_source text;
  identity_source text;
  recoverable_source text;
  compatibility_recoverable_source text;
  identity_write_source text;
  authorization_v1_source text;
  authorization_v2_source text;
  reconcile_source text;
  inventory_source text;
  guard_recovery_predicate_count integer;
  trigger_recovery_predicate_count integer;
  active_owner_issuers bigint;
  recoverable_owner_issuers bigint;
  migration_recorded boolean;
BEGIN
  IF guard_oid IS NULL
     OR trigger_function_oid IS NULL
     OR identity_oid IS NULL
     OR recoverable_oid IS NULL
     OR compatibility_recoverable_oid IS NULL
     OR identity_write_oid IS NULL
     OR authorization_v1_oid IS NULL
     OR authorization_v2_oid IS NULL
     OR reconcile_oid IS NULL
     OR inventory_oid IS NULL THEN
    RAISE EXCEPTION
      'verify_failed: owner continuity/identity functions are missing';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid IN (guard_oid, trigger_function_oid)
       AND (
         routine.proowner <> pg_catalog.to_regrole('postgres')::oid
         OR NOT routine.prosecdef
         OR routine.provolatile <> 'v'
         OR routine.proconfig IS DISTINCT FROM
            ARRAY['search_path=pg_catalog']::text[]
       )
  ) THEN
    RAISE EXCEPTION
      'verify_failed: owner continuity guard owner/security/path drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid IN (
       identity_oid,
       recoverable_oid,
       compatibility_recoverable_oid
     )
       AND (
         routine.proowner <> pg_catalog.to_regrole('postgres')::oid
         OR routine.prosecdef
         OR routine.proconfig IS DISTINCT FROM
            ARRAY['search_path=pg_catalog']::text[]
       )
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = identity_oid
       AND routine.provolatile = 'i'
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid IN (recoverable_oid, compatibility_recoverable_oid)
       AND routine.provolatile <> 'v'
  ) THEN
    RAISE EXCEPTION
      'verify_failed: identity/recovery predicate owner/path/volatility drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid IN (
       identity_write_oid,
       authorization_v1_oid,
       authorization_v2_oid,
       reconcile_oid,
       inventory_oid
     )
       AND (
         routine.proowner <> pg_catalog.to_regrole('postgres')::oid
         OR NOT routine.prosecdef
         OR routine.proconfig IS DISTINCT FROM
            ARRAY['search_path=pg_catalog']::text[]
       )
  ) THEN
    RAISE EXCEPTION
      'verify_failed: identity write/read boundary owner/security/path drifted';
  END IF;

  IF pg_catalog.has_function_privilege('anon', guard_oid, 'EXECUTE')
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
      'verify_failed: internal owner continuity guard is API-executable';
  END IF;

  FOREACH routine_oid IN ARRAY ARRAY[
    identity_oid,
    recoverable_oid,
    compatibility_recoverable_oid,
    identity_write_oid
  ]::oid[] LOOP
    IF pg_catalog.has_function_privilege('anon', routine_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege(
         'authenticated', routine_oid, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'service_role', routine_oid, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION
        'verify_failed: internal identity/recovery function is API-executable: %',
        routine_oid::pg_catalog.regprocedure;
    END IF;
  END LOOP;

  FOREACH routine_oid IN ARRAY ARRAY[
    authorization_v1_oid,
    authorization_v2_oid,
    reconcile_oid,
    inventory_oid
  ]::oid[] LOOP
    IF pg_catalog.has_function_privilege('anon', routine_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege(
         'authenticated', routine_oid, 'EXECUTE'
       )
       OR NOT pg_catalog.has_function_privilege(
         'service_role', routine_oid, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION
        'verify_failed: service-only token function ACL drifted: %',
        routine_oid::pg_catalog.regprocedure;
    END IF;
  END LOOP;

  SELECT routine.prosrc
    INTO guard_source
    FROM pg_catalog.pg_proc AS routine
   WHERE routine.oid = guard_oid;
  SELECT routine.prosrc
    INTO trigger_source
    FROM pg_catalog.pg_proc AS routine
   WHERE routine.oid = trigger_function_oid;
  SELECT routine.prosrc INTO identity_source
    FROM pg_catalog.pg_proc AS routine WHERE routine.oid = identity_oid;
  SELECT routine.prosrc INTO recoverable_source
    FROM pg_catalog.pg_proc AS routine WHERE routine.oid = recoverable_oid;
  SELECT routine.prosrc INTO compatibility_recoverable_source
    FROM pg_catalog.pg_proc AS routine
   WHERE routine.oid = compatibility_recoverable_oid;
  SELECT routine.prosrc INTO identity_write_source
    FROM pg_catalog.pg_proc AS routine WHERE routine.oid = identity_write_oid;
  SELECT routine.prosrc INTO authorization_v1_source
    FROM pg_catalog.pg_proc AS routine WHERE routine.oid = authorization_v1_oid;
  SELECT routine.prosrc INTO authorization_v2_source
    FROM pg_catalog.pg_proc AS routine WHERE routine.oid = authorization_v2_oid;
  SELECT routine.prosrc INTO reconcile_source
    FROM pg_catalog.pg_proc AS routine WHERE routine.oid = reconcile_oid;
  SELECT routine.prosrc INTO inventory_source
    FROM pg_catalog.pg_proc AS routine WHERE routine.oid = inventory_oid;

  IF pg_catalog.strpos(identity_source, '[[:cntrl:]]') = 0
     OR pg_catalog.strpos(identity_source, E'\\061C') = 0
     OR pg_catalog.strpos(identity_source, E'\\200E') = 0
     OR pg_catalog.strpos(identity_source, E'\\200F') = 0
     OR pg_catalog.strpos(identity_source, E'\\202A') = 0
     OR pg_catalog.strpos(identity_source, E'\\202E') = 0
     OR pg_catalog.strpos(identity_source, E'\\2066') = 0
     OR pg_catalog.strpos(identity_source, E'\\2069') = 0
     OR pg_catalog.strpos(
       identity_source,
       'length(p_admin_name) BETWEEN 1 AND 100'
     ) = 0
     OR pg_catalog.strpos(
       identity_source,
       'length(p_admin_email) BETWEEN 3 AND 200'
     ) = 0
     OR pg_catalog.strpos(identity_source, 'strpos(p_admin_email, ''@'')') = 0
     OR pg_catalog.strpos(
       recoverable_source,
       'admin_token_identity_safe(p_admin_name, p_admin_email)'
     ) = 0
     OR pg_catalog.strpos(
       compatibility_recoverable_source,
       'bool_and('
     ) = 0
     OR pg_catalog.strpos(
       compatibility_recoverable_source,
       'admin_token_identity_safe('
     ) = 0
     OR pg_catalog.strpos(
       identity_write_source,
       'NEW.revoked_at IS NULL'
     ) = 0
     OR pg_catalog.strpos(
       identity_write_source,
       'admin_token_identity_unsafe'
     ) = 0 THEN
    RAISE EXCEPTION
      'verify_failed: administrator token identity predicate/write guard drifted';
  END IF;

  IF pg_catalog.strpos(
       authorization_v1_source,
       'admin_token_identity_safe('
     ) = 0
     OR pg_catalog.strpos(
       authorization_v2_source,
       'admin_token_identity_safe('
     ) = 0
     OR pg_catalog.strpos(
       reconcile_source,
       'admin_token_identity_safe('
     ) = 0
     OR pg_catalog.strpos(inventory_source, '[unsafe identity]') = 0
     OR pg_catalog.strpos(inventory_source, 'unsafe@invalid.local') = 0
     OR pg_catalog.strpos(inventory_source, 'THEN token.last_used_at') = 0
     OR pg_catalog.strpos(inventory_source, 'ELSE NULL') = 0 THEN
    RAISE EXCEPTION
      'verify_failed: token authorize/reconcile/inventory identity boundary drifted';
  END IF;

  guard_recovery_predicate_count := (
    pg_catalog.length(guard_source)
    - pg_catalog.length(
      pg_catalog.replace(
        guard_source,
        'admin_owner_token_recoverable(',
        ''
      )
    )
  ) / pg_catalog.length('admin_owner_token_recoverable(');

  -- The target must use the broad active-owner predicate. Only a different
  -- replacement is allowed to use the stricter 24-hour/last-used predicate.
  IF pg_catalog.strpos(
       guard_source,
       'target_is_active_owner := target_admin_id IS NOT NULL'
     ) = 0
     OR pg_catalog.strpos(guard_source, 'target_role = ''owner''') = 0
     OR pg_catalog.strpos(
       guard_source,
       'target_expires_at > check_time'
     ) = 0
     OR pg_catalog.strpos(
       guard_source,
       'IF target_is_active_owner'
     ) = 0
     OR pg_catalog.strpos(
       guard_source,
       'owner_token.id <> p_target_token_id'
     ) = 0
     OR pg_catalog.strpos(
       guard_source,
       'owner_profile.id = owner_token.admin_id'
     ) = 0
     OR pg_catalog.strpos(
       guard_source,
       'admin_token_identity_safe('
     ) = 0
     OR guard_recovery_predicate_count <> 1
     OR pg_catalog.strpos(guard_source, 'target_last_used_at') > 0 THEN
    RAISE EXCEPTION
      'verify_failed: exact-revoke active-owner continuity source drifted';
  END IF;

  trigger_recovery_predicate_count := (
    pg_catalog.length(trigger_source)
    - pg_catalog.length(
      pg_catalog.replace(
        trigger_source,
        'admin_owner_token_recoverable(',
        ''
      )
    )
  ) / pg_catalog.length('admin_owner_token_recoverable(');

  IF pg_catalog.strpos(
       trigger_source,
       'old_was_active_owner := old_was_active AND OLD.role = ''owner'''
     ) = 0
     OR pg_catalog.strpos(
       trigger_source,
       'new_is_active_owner := new_is_active AND NEW.role = ''owner'''
     ) = 0
     OR pg_catalog.strpos(trigger_source, 'NOT new_is_active_owner') = 0
     OR pg_catalog.strpos(
       trigger_source,
       'old_was_recoverable_owner AND NOT new_is_recoverable_owner'
     ) = 0
     OR pg_catalog.strpos(trigger_source, 'other_owner.id <> OLD.id') = 0
     OR pg_catalog.strpos(
       trigger_source,
       'owner_profile.id = other_owner.admin_id'
     ) = 0
     OR pg_catalog.strpos(
       trigger_source,
       'admin_token_identity_safe('
     ) = 0
     OR trigger_recovery_predicate_count <> 3 THEN
    RAISE EXCEPTION
      'verify_failed: table-boundary owner continuity source drifted';
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
       AND (
         pg_catalog.pg_get_triggerdef(trigger_row.oid) ILIKE
           '%BEFORE DELETE OR UPDATE OF admin_id, revoked_at, expires_at, role ON public.admin_tokens%'
         OR pg_catalog.pg_get_triggerdef(trigger_row.oid) ILIKE
           '%BEFORE DELETE OR UPDATE OF admin_id, revoked_at, expires_at, last_used_at, role ON public.admin_tokens%'
       )
  ) THEN
    RAISE EXCEPTION
      'verify_failed: owner continuity row-trigger topology drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid =
           'public.admin_tokens'::pg_catalog.regclass
       AND trigger_row.tgname = 'admin_tokens_01_validate_active_identity'
       AND NOT trigger_row.tgisinternal
       AND trigger_row.tgenabled = 'O'
       AND trigger_row.tgfoid = identity_write_oid
       AND trigger_row.tgtype = 23
       AND pg_catalog.pg_get_triggerdef(trigger_row.oid) ILIKE
           '%BEFORE INSERT OR UPDATE OF admin_name, admin_email, revoked_at ON public.admin_tokens%'
  ) THEN
    RAISE EXCEPTION
      'verify_failed: active token identity write-trigger topology drifted';
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
      'verify_failed: administrator lifecycle capability matrix drifted';
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
        AND EXISTS (
          SELECT 1
            FROM public.profiles AS owner_profile
           WHERE owner_profile.id = token.admin_id
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
    IF NOT migration_recorded THEN
      RAISE EXCEPTION
        'verify_failed: migration ledger lacks 20260722145042_harden_last_active_owner_revoke';
    END IF;
  END IF;
END;
$verify$;

SELECT
  routine.oid::pg_catalog.regprocedure AS function_signature,
  pg_catalog.pg_get_userbyid(routine.proowner) AS function_owner,
  routine.prosecdef AS security_definer,
  routine.provolatile,
  routine.proconfig,
  routine.proacl
FROM pg_catalog.pg_proc AS routine
WHERE routine.oid IN (
  pg_catalog.to_regprocedure(
    'public.admin_assert_token_revoke_allowed(uuid,uuid)'
  ),
  pg_catalog.to_regprocedure('public.admin_protect_recovery_tokens()'),
  pg_catalog.to_regprocedure('public.admin_token_identity_safe(text,text)'),
  pg_catalog.to_regprocedure(
    'public.admin_owner_token_recoverable(uuid,text,timestamptz,timestamptz,timestamptz,text,text)'
  ),
  pg_catalog.to_regprocedure(
    'public.admin_owner_token_recoverable(uuid,text,timestamptz,timestamptz,timestamptz)'
  ),
  pg_catalog.to_regprocedure('public.admin_validate_token_identity_write()'),
  pg_catalog.to_regprocedure('public.admin_token_authorization(text)'),
  pg_catalog.to_regprocedure('public.admin_token_authorization_v2(text)'),
  pg_catalog.to_regprocedure('public.admin_reconcile_issued_token(text)'),
  pg_catalog.to_regprocedure('public.admin_token_inventory()')
)
ORDER BY routine.oid::pg_catalog.regprocedure::text;

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
  ) AS active_owner_tokens,
  pg_catalog.count(*) FILTER (
    WHERE public.admin_owner_token_recoverable(
      token.admin_id,
      token.role,
      token.revoked_at,
      token.expires_at,
      token.last_used_at
    )
  ) AS recoverable_owner_tokens
FROM public.admin_tokens AS token;

ROLLBACK;
