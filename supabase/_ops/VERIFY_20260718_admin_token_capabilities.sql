-- Read-only post-deploy verification for administrator token capabilities.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  capability_hook oid := pg_catalog.to_regprocedure(
    'public.admin_assert_mutation_capability(uuid,text)'
  );
  revoke_hook oid := pg_catalog.to_regprocedure(
    'public.admin_assert_token_revoke_allowed(uuid,uuid)'
  );
  recovery_trigger_function oid := pg_catalog.to_regprocedure(
    'public.admin_protect_recovery_tokens()'
  );
  audit_function oid := pg_catalog.to_regprocedure(
    'public.record_audit(text,uuid,uuid,jsonb)'
  );
  authorization_function oid := pg_catalog.to_regprocedure(
    'public.admin_token_authorization(text)'
  );
  inventory_function oid := pg_catalog.to_regprocedure(
    'public.admin_token_inventory()'
  );
  owner_recoverable_function oid := pg_catalog.to_regprocedure(
    'public.admin_owner_token_recoverable(uuid,text,timestamptz,timestamptz,timestamptz)'
  );
  token_statement_lock_function oid := pg_catalog.to_regprocedure(
    'public.admin_lock_token_recovery_mutation()'
  );
  wrapper_source text;
  capability_source text;
  revoke_source text;
  recovery_source text;
  audit_source text;
  owner_recoverable_source text;
  authorization_source text;
  token_statement_lock_source text;
  inventory_result text;
  default_expression text;
  role_check text;
BEGIN
  IF pg_catalog.to_regclass(
    'public.admin_role_action_capabilities'
  ) IS NULL THEN
    RAISE EXCEPTION 'verify_failed: role/action capability table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS column_row
     WHERE column_row.attrelid = 'public.admin_tokens'::pg_catalog.regclass
       AND column_row.attname = 'role'
       AND column_row.atttypid = 'text'::pg_catalog.regtype
       AND column_row.attnotnull
       AND column_row.attnum > 0
       AND NOT column_row.attisdropped
  ) OR EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.role IS NULL
        OR token.role NOT IN ('operator', 'security_admin', 'owner')
  ) THEN
    RAISE EXCEPTION 'verify_failed: token role type/allowlist/nullability drifted';
  END IF;

  SELECT pg_catalog.pg_get_expr(
           default_row.adbin,
           default_row.adrelid
         )
    INTO default_expression
    FROM pg_catalog.pg_attrdef AS default_row
    JOIN pg_catalog.pg_attribute AS column_row
      ON column_row.attrelid = default_row.adrelid
     AND column_row.attnum = default_row.adnum
   WHERE default_row.adrelid = 'public.admin_tokens'::pg_catalog.regclass
     AND column_row.attname = 'role';
  IF default_expression IS NULL
     OR pg_catalog.strpos(default_expression, 'operator') = 0 THEN
    RAISE EXCEPTION 'verify_failed: token role default is not operator';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
    INTO role_check
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid = 'public.admin_tokens'::pg_catalog.regclass
     AND constraint_row.conname = 'admin_tokens_role_check'
     AND constraint_row.contype = 'c'
     AND constraint_row.convalidated;
  IF role_check IS NULL
     OR pg_catalog.strpos(role_check, 'operator') = 0
     OR pg_catalog.strpos(role_check, 'security_admin') = 0
     OR pg_catalog.strpos(role_check, 'owner') = 0 THEN
    RAISE EXCEPTION 'verify_failed: token role check constraint missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public.admin_role_action_capabilities'::pg_catalog.regclass
       AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'verify_failed: capability table RLS disabled';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'service_role',
       'public.admin_role_action_capabilities',
       'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'service_role',
       'public.admin_role_action_capabilities',
       'INSERT,UPDATE,DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'anon',
       'public.admin_role_action_capabilities',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated',
       'public.admin_role_action_capabilities',
       'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: capability table ACL mismatch';
  END IF;

  IF EXISTS (
    WITH base_expected(admin_role, action) AS (
      VALUES
        ('operator', 'apply_ban'),
        ('operator', 'lift_suspension'),
        ('operator', 'update_report_status'),
        ('operator', 'resolve_target_reports'),
        ('operator', 'takedown_content'),
        ('security_admin', 'revoke_token'),
        ('owner', 'apply_ban'),
        ('owner', 'lift_suspension'),
        ('owner', 'update_report_status'),
        ('owner', 'resolve_target_reports'),
        ('owner', 'takedown_content'),
        ('owner', 'set_post_pinned'),
        ('owner', 'upsert_banner'),
        ('owner', 'delete_banner'),
        ('owner', 'revoke_token'),
        ('owner', 'upload_banner')
    ), lifecycle_expected(admin_role, action) AS (
      SELECT lifecycle.admin_role, lifecycle.action
        FROM (VALUES
          ('security_admin', 'revoke_admin_tokens'),
          ('owner', 'issue_token'),
          ('owner', 'revoke_admin_tokens')
        ) AS lifecycle(admin_role, action)
       WHERE pg_catalog.to_regprocedure(
         'public.admin_execute_token_lifecycle(text,uuid,text,text,jsonb)'
       ) IS NOT NULL
    ), expected(admin_role, action) AS (
      SELECT base_expected.admin_role, base_expected.action FROM base_expected
      UNION ALL
      SELECT lifecycle_expected.admin_role, lifecycle_expected.action
        FROM lifecycle_expected
    ), differences AS (
      (SELECT expected.admin_role, expected.action FROM expected
       EXCEPT
       SELECT capability.admin_role, capability.action
         FROM public.admin_role_action_capabilities AS capability)
      UNION ALL
      (SELECT capability.admin_role, capability.action
         FROM public.admin_role_action_capabilities AS capability
       EXCEPT
       SELECT expected.admin_role, expected.action FROM expected)
    )
    SELECT 1 FROM differences
  ) THEN
    RAISE EXCEPTION 'verify_failed: exact role/action mapping drifted';
  END IF;

  IF capability_hook IS NULL
     OR revoke_hook IS NULL
     OR recovery_trigger_function IS NULL
     OR audit_function IS NULL
     OR authorization_function IS NULL
     OR inventory_function IS NULL
     OR owner_recoverable_function IS NULL
     OR token_statement_lock_function IS NULL THEN
    RAISE EXCEPTION 'verify_failed: capability/recovery/auth function missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public.admin_tokens'::pg_catalog.regclass
       AND trigger_row.tgname = 'admin_tokens_protect_recovery'
       AND trigger_row.tgfoid = recovery_trigger_function
       AND trigger_row.tgenabled = 'O'
       AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'verify_failed: direct token recovery trigger missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public.admin_tokens'::pg_catalog.regclass
       AND trigger_row.tgname = 'admin_tokens_00_lock_recovery_mutation'
       AND trigger_row.tgfoid = token_statement_lock_function
       AND trigger_row.tgtype = 26
       AND trigger_row.tgenabled = 'O'
       AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'verify_failed: statement-level token lock-order fence missing';
  END IF;

  SELECT function_row.prosrc INTO wrapper_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = pg_catalog.to_regprocedure(
     'public.admin_execute_mutation(text,uuid,text,text,jsonb)'
   );
  IF pg_catalog.to_regprocedure(
       'public.admin_execute_token_lifecycle(text,uuid,text,text,jsonb)'
     ) IS NOT NULL THEN
    SELECT function_row.prosrc INTO wrapper_source
      FROM pg_catalog.pg_proc AS function_row
     WHERE function_row.oid = pg_catalog.to_regprocedure(
       'public.admin_execute_token_lifecycle(text,uuid,text,text,jsonb)'
     );
  END IF;
  SELECT function_row.prosrc INTO capability_source
    FROM pg_catalog.pg_proc AS function_row WHERE function_row.oid = capability_hook;
  SELECT function_row.prosrc INTO revoke_source
    FROM pg_catalog.pg_proc AS function_row WHERE function_row.oid = revoke_hook;
  SELECT function_row.prosrc INTO recovery_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = recovery_trigger_function;
  SELECT function_row.prosrc INTO audit_source
    FROM pg_catalog.pg_proc AS function_row WHERE function_row.oid = audit_function;
  SELECT function_row.prosrc INTO owner_recoverable_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = owner_recoverable_function;
  SELECT function_row.prosrc INTO authorization_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = authorization_function;
  SELECT function_row.prosrc INTO token_statement_lock_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = token_statement_lock_function;
  inventory_result := pg_catalog.pg_get_function_result(inventory_function);

  IF pg_catalog.strpos(wrapper_source, 'admin_assert_mutation_capability') = 0
     OR pg_catalog.strpos(wrapper_source, 'INSERT INTO public.admin_mutation_requests') = 0
     OR pg_catalog.strpos(wrapper_source, 'admin_assert_mutation_capability')
        > pg_catalog.strpos(
          wrapper_source,
          'INSERT INTO public.admin_mutation_requests'
        ) THEN
    RAISE EXCEPTION 'verify_failed: capability hook is not before ledger insert';
  END IF;

  IF pg_catalog.strpos(capability_source, 'admin_role_action_capabilities') = 0
     OR pg_catalog.strpos(capability_source, 'admin_capability_denied') = 0
     OR pg_catalog.strpos(capability_source, 'admin.role') = 0
     OR pg_catalog.strpos(capability_source, 'set_config') = 0 THEN
    RAISE EXCEPTION 'verify_failed: exact capability/role-context hook missing';
  END IF;

  IF pg_catalog.strpos(revoke_source, 'last_active_owner_token') = 0
     OR pg_catalog.strpos(revoke_source, 'admin_owner_token_recoverable') = 0
     OR pg_catalog.strpos(revoke_source, 'owner_token.last_used_at') = 0
     OR pg_catalog.strpos(revoke_source, 'owner_profile.id = owner_token.admin_id') = 0
     OR pg_catalog.strpos(owner_recoverable_source, 'p_admin_id IS NOT NULL') = 0
     OR pg_catalog.strpos(owner_recoverable_source, $$p_role = 'owner'$$) = 0
     OR pg_catalog.strpos(owner_recoverable_source, 'p_last_used_at IS NOT NULL') = 0
     OR pg_catalog.strpos(owner_recoverable_source, 'clock_timestamp()') = 0
     OR pg_catalog.strpos(owner_recoverable_source, $$interval '24 hours'$$) = 0 THEN
    RAISE EXCEPTION 'verify_failed: verified/live-profile owner hook contract missing';
  END IF;

  IF pg_catalog.strpos(recovery_source, 'last_active_admin_token') = 0
     OR pg_catalog.strpos(recovery_source, 'last_active_owner_token') = 0
     OR pg_catalog.strpos(recovery_source, 'admin_owner_token_recoverable') = 0
     OR pg_catalog.strpos(recovery_source, 'other_owner.last_used_at') = 0
     OR pg_catalog.strpos(recovery_source, 'owner_profile.id = other_owner.admin_id') = 0
     OR pg_catalog.strpos(recovery_source, 'pg_advisory_xact_lock') = 0 THEN
    RAISE EXCEPTION 'verify_failed: direct PATCH recovery protection missing';
  END IF;

  IF pg_catalog.strpos(
       token_statement_lock_source, 'pg_advisory_xact_lock(20260718180000'
     ) = 0
     OR pg_catalog.strpos(
       token_statement_lock_source, 'pg_advisory_xact_lock(20260718190000'
     ) = 0
     OR pg_catalog.strpos(
       token_statement_lock_source, 'pg_advisory_xact_lock(20260718180000'
     ) > pg_catalog.strpos(
       token_statement_lock_source, 'pg_advisory_xact_lock(20260718190000'
     ) THEN
    RAISE EXCEPTION 'verify_failed: token statement lock order drifted';
  END IF;

  IF pg_catalog.strpos(audit_source, 'admin.role') = 0
     OR pg_catalog.strpos(audit_source, 'admin_role') = 0
     OR pg_catalog.strpos(audit_source, 'admin_audit_required_failed') = 0
     OR pg_catalog.strpos(audit_source, 'SQLSTATE') = 0
     OR pg_catalog.strpos(audit_source, 'SQLERRM') <> 0 THEN
    RAISE EXCEPTION 'verify_failed: role audit/required/safe-log contract missing';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        (capability_hook),
        (revoke_hook),
        (recovery_trigger_function),
        (owner_recoverable_function),
        (token_statement_lock_function)
      ) AS internal_function(function_oid)
     WHERE pg_catalog.has_function_privilege(
       'service_role', internal_function.function_oid, 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'anon', internal_function.function_oid, 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'authenticated', internal_function.function_oid, 'EXECUTE'
     )
  ) THEN
    RAISE EXCEPTION 'verify_failed: internal capability/recovery function executable';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'service_role', authorization_function, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', authorization_function, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', authorization_function, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', inventory_function, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', inventory_function, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', inventory_function, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: authorization/inventory RPC ACL mismatch';
  END IF;

  IF pg_catalog.strpos(authorization_source, 'token.admin_id IS NOT NULL') = 0
     OR pg_catalog.strpos(authorization_source, 'profile.id = token.admin_id') = 0
     OR pg_catalog.strpos(
       authorization_source, 'pg_advisory_xact_lock(20260718180000'
     ) = 0
     OR pg_catalog.strpos(
       authorization_source, 'pg_advisory_xact_lock(20260718190000'
     ) = 0
     OR pg_catalog.strpos(
       authorization_source, 'pg_advisory_xact_lock(20260718180000'
     ) > pg_catalog.strpos(
       authorization_source, 'pg_advisory_xact_lock(20260718190000'
     )
     OR pg_catalog.strpos(inventory_result, 'last_used_at') = 0 THEN
    RAISE EXCEPTION
      'verify_failed: token verification lock/profile/inventory signal drifted';
  END IF;

  IF pg_catalog.to_regprocedure('public.admin_token_validate(text)') IS NULL THEN
    RAISE EXCEPTION 'verify_failed: legacy token validation compatibility lost';
  END IF;
END;
$verify$;

SELECT admin_role, pg_catalog.array_agg(action ORDER BY action) AS actions
FROM public.admin_role_action_capabilities
GROUP BY admin_role
ORDER BY admin_role;

SELECT
  function_row.oid::pg_catalog.regprocedure AS function_name,
  pg_catalog.pg_get_function_result(function_row.oid) AS result_shape,
  function_row.prosecdef AS security_definer,
  function_row.proconfig AS fixed_config,
  pg_catalog.has_function_privilege(
    'service_role', function_row.oid, 'EXECUTE'
  ) AS service_role_execute,
  pg_catalog.has_function_privilege(
    'authenticated', function_row.oid, 'EXECUTE'
  ) AS authenticated_execute
FROM pg_catalog.pg_proc AS function_row
WHERE function_row.oid IN (
  pg_catalog.to_regprocedure('public.admin_token_authorization(text)'),
  pg_catalog.to_regprocedure('public.admin_token_inventory()'),
  pg_catalog.to_regprocedure('public.admin_assert_mutation_capability(uuid,text)'),
  pg_catalog.to_regprocedure('public.admin_assert_token_revoke_allowed(uuid,uuid)'),
  pg_catalog.to_regprocedure('public.admin_protect_recovery_tokens()')
  ,pg_catalog.to_regprocedure(
    'public.admin_owner_token_recoverable(uuid,text,timestamptz,timestamptz,timestamptz)'
  )
  ,pg_catalog.to_regprocedure(
    'public.admin_lock_token_recovery_mutation()'
  )
)
ORDER BY function_row.oid::pg_catalog.regprocedure::text;

ROLLBACK;
