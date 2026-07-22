-- Read-only pre-deploy gate for 20260718190000_admin_token_capabilities.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  wrapper_source text;
  audit_source text;
BEGIN
  IF pg_catalog.to_regclass('public.admin_tokens') IS NULL
     OR pg_catalog.to_regclass('public.admin_audit_log') IS NULL
     OR pg_catalog.to_regclass('public.admin_mutation_requests') IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: 170000/180000 admin relations missing';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS column_row
     WHERE column_row.attrelid = 'public.admin_tokens'::pg_catalog.regclass
       AND column_row.attname = 'role'
       AND column_row.attnum > 0
       AND NOT column_row.attisdropped
  ) OR pg_catalog.to_regclass(
    'public.admin_role_action_capabilities'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'precheck_failed: partial/previous capability schema exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS column_row
     WHERE column_row.attrelid = 'public.admin_tokens'::pg_catalog.regclass
       AND column_row.attname = 'admin_id'
       AND column_row.attnotnull
       AND column_row.atttypid = 'uuid'::pg_catalog.regtype
       AND NOT column_row.attisdropped
  ) OR EXISTS (
    SELECT 1 FROM public.admin_tokens AS token WHERE token.admin_id IS NULL
  ) THEN
    RAISE EXCEPTION 'precheck_failed: required token actor boundary missing';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.admin_execute_mutation(text,uuid,text,text,jsonb)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_assert_mutation_capability(uuid,text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_assert_token_revoke_allowed(uuid,uuid)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.record_audit(text,uuid,uuid,jsonb)'
     ) IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: 180000 wrapper/hook/audit function missing';
  END IF;

  SELECT function_row.prosrc
    INTO wrapper_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = pg_catalog.to_regprocedure(
     'public.admin_execute_mutation(text,uuid,text,text,jsonb)'
   );
  SELECT function_row.prosrc
    INTO audit_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = pg_catalog.to_regprocedure(
     'public.record_audit(text,uuid,uuid,jsonb)'
   );

  IF pg_catalog.strpos(wrapper_source, 'admin_assert_mutation_capability') = 0
     OR pg_catalog.strpos(wrapper_source, 'INSERT INTO public.admin_mutation_requests') = 0
     OR pg_catalog.strpos(wrapper_source, 'admin_assert_mutation_capability')
        > pg_catalog.strpos(
          wrapper_source,
          'INSERT INTO public.admin_mutation_requests'
        )
     OR pg_catalog.strpos(wrapper_source, 'admin_assert_token_revoke_allowed') = 0 THEN
    RAISE EXCEPTION 'precheck_failed: 180000 hook call order contract missing';
  END IF;

  IF pg_catalog.strpos(audit_source, 'admin.audit_required') = 0
     OR pg_catalog.strpos(audit_source, 'admin_audit_required_failed') = 0
     OR pg_catalog.strpos(audit_source, 'SQLERRM') <> 0 THEN
    RAISE EXCEPTION 'precheck_failed: required/best-effort audit contract drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
        AS required(role_name)
     WHERE NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_roles AS role_row
        WHERE role_row.rolname = required.role_name
     )
  ) THEN
    RAISE EXCEPTION 'precheck_failed: required API role missing';
  END IF;
END;
$precheck$;

SELECT
  pg_catalog.count(*) AS token_rows,
  pg_catalog.count(*) FILTER (
    WHERE token.revoked_at IS NULL
      AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
  ) AS active_token_rows
FROM public.admin_tokens AS token;

SELECT
  pg_catalog.to_regprocedure(
    'public.admin_assert_mutation_capability(uuid,text)'
  ) AS capability_hook,
  pg_catalog.to_regprocedure(
    'public.admin_assert_token_revoke_allowed(uuid,uuid)'
  ) AS revoke_hook;

ROLLBACK;
