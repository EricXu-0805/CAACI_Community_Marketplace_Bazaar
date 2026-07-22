-- Read-only post-deploy verification for atomic administrator mutations.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  execute_rpc oid := pg_catalog.to_regprocedure(
    'public.admin_execute_mutation(text,uuid,text,text,jsonb)'
  );
  capability_hook oid := pg_catalog.to_regprocedure(
    'public.admin_assert_mutation_capability(uuid,text)'
  );
  revoke_hook oid := pg_catalog.to_regprocedure(
    'public.admin_assert_token_revoke_allowed(uuid,uuid)'
  );
  audit_rpc oid := pg_catalog.to_regprocedure(
    'public.record_audit(text,uuid,uuid,jsonb)'
  );
  execute_source text;
  lifecycle_source text;
  legacy_source text;
  audit_source text;
  apply_source text;
  lift_source text;
BEGIN
  IF pg_catalog.to_regclass('public.admin_mutation_requests') IS NULL THEN
    RAISE EXCEPTION 'verify_failed: admin_mutation_requests missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public.admin_mutation_requests'::pg_catalog.regclass
       AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'verify_failed: admin mutation ledger RLS disabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = 'public.admin_mutation_requests'::pg_catalog.regclass
       AND constraint_row.contype = 'p'
       AND pg_catalog.pg_get_constraintdef(constraint_row.oid)
         LIKE '%(admin_token_id, idempotency_key)%'
  ) THEN
    RAISE EXCEPTION 'verify_failed: per-token idempotency primary key missing';
  END IF;

  IF pg_catalog.has_table_privilege('anon', 'public.admin_mutation_requests', 'SELECT,INSERT,UPDATE,DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.admin_mutation_requests', 'SELECT,INSERT,UPDATE,DELETE')
     OR pg_catalog.has_table_privilege('service_role', 'public.admin_mutation_requests', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'verify_failed: direct admin mutation ledger privilege remains';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS column_row
     WHERE column_row.attrelid = 'public.admin_audit_log'::pg_catalog.regclass
       AND column_row.attname = 'admin_token_id'
       AND column_row.atttypid = 'uuid'::pg_catalog.regtype
       AND NOT column_row.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS column_row
     WHERE column_row.attrelid = 'public.admin_audit_log'::pg_catalog.regclass
       AND column_row.attname = 'idempotency_key'
       AND column_row.atttypid = 'uuid'::pg_catalog.regtype
       AND NOT column_row.attisdropped
  ) THEN
    RAISE EXCEPTION 'verify_failed: audit token/key columns missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_index AS index_row
      JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_row.indexrelid
     WHERE index_row.indrelid = 'public.admin_audit_log'::pg_catalog.regclass
       AND index_relation.relname = 'admin_audit_log_admin_mutation_uidx'
       AND index_row.indisunique
       AND index_row.indisvalid
  ) THEN
    RAISE EXCEPTION 'verify_failed: one-audit-per-idempotency-key index missing';
  END IF;

  IF execute_rpc IS NULL OR audit_rpc IS NULL
     OR capability_hook IS NULL OR revoke_hook IS NULL THEN
    RAISE EXCEPTION 'verify_failed: execute/audit/internal hook missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function_row
     WHERE function_row.oid = execute_rpc
       AND function_row.prosecdef
       AND function_row.provolatile = 'v'
       AND function_row.prorettype = 'jsonb'::pg_catalog.regtype
       AND COALESCE(function_row.proconfig, ARRAY[]::text[])
         @> ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION 'verify_failed: admin_execute_mutation shape mismatch';
  END IF;

  IF NOT pg_catalog.has_function_privilege('service_role', execute_rpc, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', execute_rpc, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', execute_rpc, 'EXECUTE')
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS function_row
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             function_row.proacl,
             pg_catalog.acldefault('f', function_row.proowner)
           )
         ) AS function_acl
        WHERE function_row.oid = execute_rpc
          AND function_acl.grantee = 0
          AND function_acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: admin_execute_mutation ACL mismatch';
  END IF;

  SELECT function_row.prosrc INTO execute_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = execute_rpc;
  IF pg_catalog.to_regprocedure(
       'public.admin_execute_token_lifecycle(text,uuid,text,text,jsonb)'
     ) IS NOT NULL THEN
    SELECT function_row.prosrc INTO lifecycle_source
      FROM pg_catalog.pg_proc AS function_row
     WHERE function_row.oid = pg_catalog.to_regprocedure(
       'public.admin_execute_token_lifecycle(text,uuid,text,text,jsonb)'
     );
    SELECT function_row.prosrc INTO legacy_source
      FROM pg_catalog.pg_proc AS function_row
     WHERE function_row.oid = pg_catalog.to_regprocedure(
       'public.admin_execute_mutation_pre_token_lifecycle(text,uuid,text,text,jsonb)'
     );
    execute_source := lifecycle_source || E'\n' || legacy_source;
  END IF;
  SELECT function_row.prosrc INTO audit_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = audit_rpc;
  SELECT function_row.prosrc INTO apply_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = pg_catalog.to_regprocedure(
     'public.apply_ban_level(uuid,smallint,text,text,integer)'
   );
  SELECT function_row.prosrc INTO lift_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = pg_catalog.to_regprocedure(
     'public.lift_suspension(uuid,text)'
   );

  IF pg_catalog.strpos(execute_source, 'FOR UPDATE') = 0
     OR pg_catalog.strpos(execute_source, 'token.revoked_at IS NULL') = 0
     OR pg_catalog.strpos(execute_source, 'token.expires_at >') = 0
     OR pg_catalog.strpos(execute_source, 'idempotency_conflict') = 0
     OR pg_catalog.strpos(execute_source, 'admin_token_inactive') = 0
     OR pg_catalog.strpos(execute_source, 'self_revoke_forbidden') = 0
     OR pg_catalog.strpos(execute_source, 'last_active_admin_token') = 0
     OR pg_catalog.strpos(execute_source, 'admin_assert_mutation_capability') = 0
     OR pg_catalog.strpos(execute_source, 'admin_assert_token_revoke_allowed') = 0
     OR pg_catalog.strpos(execute_source, 'admin_audit_required_missing') = 0
     OR pg_catalog.strpos(execute_source, 'upsert_banner') = 0
     OR pg_catalog.strpos(execute_source, 'revoke_token') = 0 THEN
    RAISE EXCEPTION 'verify_failed: execute mutation safety sentinels missing';
  END IF;

  IF pg_catalog.strpos(execute_source, 'admin_assert_mutation_capability')
       > pg_catalog.strpos(execute_source, 'INSERT INTO public.admin_mutation_requests') THEN
    RAISE EXCEPTION 'verify_failed: capability check occurs after idempotency ledger write';
  END IF;

  IF pg_catalog.has_function_privilege('service_role', capability_hook, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', capability_hook, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', capability_hook, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', revoke_hook, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', revoke_hook, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', revoke_hook, 'EXECUTE') THEN
    RAISE EXCEPTION 'verify_failed: internal authorization hook is directly executable';
  END IF;

  IF pg_catalog.strpos(audit_source, 'admin.audit_required') = 0
     OR pg_catalog.strpos(audit_source, 'admin_token_id') = 0
     OR pg_catalog.strpos(audit_source, 'idempotency_key') = 0
     OR pg_catalog.strpos(audit_source, 'admin_audit_required_failed') = 0
     OR pg_catalog.strpos(audit_source, 'SQLSTATE') = 0
     OR pg_catalog.strpos(audit_source, 'SQLERRM') <> 0 THEN
    RAISE EXCEPTION 'verify_failed: required audit context contract missing';
  END IF;

  IF pg_catalog.strpos(apply_source, 'admin_context_actor_id') = 0
     OR pg_catalog.strpos(apply_source, 'issued_by') = 0
     OR pg_catalog.strpos(lift_source, 'admin_context_actor_id') = 0
     OR pg_catalog.strpos(lift_source, 'lifted_by') = 0 THEN
    RAISE EXCEPTION 'verify_failed: actor did not reach suspension evidence fields';
  END IF;
END
$verify$;

SELECT
  function_row.oid::pg_catalog.regprocedure AS function_name,
  function_row.prosecdef AS security_definer,
  function_row.proconfig AS fixed_config,
  pg_catalog.has_function_privilege('anon', function_row.oid, 'EXECUTE') AS anon_execute,
  pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE') AS authenticated_execute,
  pg_catalog.has_function_privilege('service_role', function_row.oid, 'EXECUTE') AS service_role_execute
FROM pg_catalog.pg_proc AS function_row
WHERE function_row.oid IN (
  pg_catalog.to_regprocedure('public.admin_execute_mutation(text,uuid,text,text,jsonb)'),
  pg_catalog.to_regprocedure('public.record_audit(text,uuid,uuid,jsonb)'),
  pg_catalog.to_regprocedure('public.admin_assert_mutation_capability(uuid,text)'),
  pg_catalog.to_regprocedure('public.admin_assert_token_revoke_allowed(uuid,uuid)')
)
ORDER BY function_row.oid::pg_catalog.regprocedure::text;

SELECT
  index_relation.relname AS index_name,
  index_row.indisunique,
  index_row.indisvalid,
  pg_catalog.pg_get_indexdef(index_row.indexrelid) AS definition
FROM pg_catalog.pg_index AS index_row
JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_row.indexrelid
WHERE index_row.indrelid IN (
  'public.admin_mutation_requests'::pg_catalog.regclass,
  'public.admin_audit_log'::pg_catalog.regclass
)
ORDER BY index_relation.relname;

ROLLBACK;
