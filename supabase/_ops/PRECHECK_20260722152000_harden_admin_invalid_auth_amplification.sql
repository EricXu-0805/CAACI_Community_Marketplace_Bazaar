-- Read-only preflight for
-- 20260722152000_harden_admin_invalid_auth_amplification.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $precheck$
DECLARE
  authorization_source text;
  migration_recorded boolean := false;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION 'precheck_failed: PostgreSQL 16 or newer is required';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
        AS required(role_name)
     WHERE pg_catalog.to_regrole(required.role_name) IS NULL
  ) OR pg_catalog.to_regclass('public.admin_tokens') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.admin_role_action_capabilities') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_token_identity_safe(text,text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_token_authorization_v2(text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: admin authorization prerequisite missing';
  END IF;

  -- The unlocked negative probe is safe from the global advisory-lock domain,
  -- but it must also remain a bounded indexed lookup. Accept either the full
  -- token-hash index/constraint or the exact active-token partial index.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_index AS token_index
      JOIN pg_catalog.pg_attribute AS token_hash_column
        ON token_hash_column.attrelid = token_index.indrelid
       AND token_hash_column.attname = 'token_hash'
       AND NOT token_hash_column.attisdropped
     WHERE token_index.indrelid = 'public.admin_tokens'::pg_catalog.regclass
       AND token_index.indisvalid
       AND token_index.indisready
       AND token_index.indnkeyatts = 1
       AND token_index.indexprs IS NULL
       AND token_index.indkey[0] = token_hash_column.attnum
       AND (
         token_index.indpred IS NULL
         OR pg_catalog.pg_get_expr(
              token_index.indpred,
              token_index.indrelid
            ) = '(revoked_at IS NULL)'
       )
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: admin token hash lacks a ready, valid probe index';
  END IF;

  SELECT function.prosrc
    INTO authorization_source
    FROM pg_catalog.pg_proc AS function
   WHERE function.oid = pg_catalog.to_regprocedure(
     'public.admin_token_authorization_v2(text)'
   );

  IF authorization_source IS NULL
     OR pg_catalog.strpos(
       authorization_source,
       'pg_advisory_xact_lock(20260718180000::bigint)'
     ) = 0
     OR pg_catalog.strpos(
       authorization_source,
       'pg_advisory_xact_lock(20260718190000::bigint)'
     ) = 0
     OR pg_catalog.strpos(authorization_source, 'SET last_used_at') = 0
     OR pg_catalog.strpos(
       authorization_source,
       'admin_token_identity_safe('
     ) = 0 THEN
    RAISE EXCEPTION 'precheck_failed: deployed authorization baseline drifted';
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
        '20260722152000',
        '20260722152000_harden_admin_invalid_auth_amplification';
    IF migration_recorded THEN
      RAISE EXCEPTION
        'precheck_failed: migration ledger already contains 20260722152000_harden_admin_invalid_auth_amplification';
    END IF;
  END IF;
END;
$precheck$;

SELECT
  pg_catalog.count(*) FILTER (WHERE revoked_at IS NULL) AS unrevoked_tokens,
  pg_catalog.count(*) FILTER (
    WHERE revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > pg_catalog.clock_timestamp())
  ) AS currently_active_tokens
FROM public.admin_tokens;

ROLLBACK;
