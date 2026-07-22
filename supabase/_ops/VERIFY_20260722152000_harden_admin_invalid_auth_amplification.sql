-- Read-only verification for
-- 20260722152000_harden_admin_invalid_auth_amplification.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $verify$
DECLARE
  authorization_oid regprocedure :=
    pg_catalog.to_regprocedure('public.admin_token_authorization_v2(text)');
  authorization_source text;
  probe_position integer;
  first_lock_position integer;
  second_lock_position integer;
  authoritative_update_position integer;
  candidate_identity_position integer;
  token_identity_position integer;
  migration_recorded boolean := false;
BEGIN
  IF authorization_oid IS NULL THEN
    RAISE EXCEPTION 'verify_failed: authorization RPC missing';
  END IF;

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
      'verify_failed: admin token hash lacks a ready, valid probe index';
  END IF;

  SELECT function.prosrc
    INTO authorization_source
    FROM pg_catalog.pg_proc AS function
   WHERE function.oid = authorization_oid;

  probe_position := pg_catalog.strpos(authorization_source, 'IF NOT EXISTS');
  first_lock_position := pg_catalog.strpos(
    authorization_source,
    'pg_advisory_xact_lock(20260718180000::bigint)'
  );
  second_lock_position := pg_catalog.strpos(
    authorization_source,
    'pg_advisory_xact_lock(20260718190000::bigint)'
  );
  authoritative_update_position := pg_catalog.strpos(
    authorization_source,
    'UPDATE public.admin_tokens AS token'
  );
  candidate_identity_position := pg_catalog.strpos(
    authorization_source,
    'admin_token_identity_safe('
  );
  token_identity_position := pg_catalog.strpos(
    pg_catalog.substr(
      authorization_source,
      authoritative_update_position
    ),
    'admin_token_identity_safe('
  );

  IF probe_position = 0
     OR candidate_identity_position <= probe_position
     OR candidate_identity_position >= first_lock_position
     OR first_lock_position <= probe_position
     OR second_lock_position <= first_lock_position
     OR authoritative_update_position <= second_lock_position
     OR token_identity_position = 0
     OR pg_catalog.strpos(authorization_source, 'SET last_used_at') = 0 THEN
    RAISE EXCEPTION 'verify_failed: negative-probe/locked-revalidation order drifted';
  END IF;

  IF pg_catalog.has_function_privilege(
       'anon', authorization_oid, 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'authenticated', authorization_oid, 'EXECUTE'
     ) OR NOT pg_catalog.has_function_privilege(
       'service_role', authorization_oid, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: authorization RPC ACL drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function
     WHERE function.oid = authorization_oid
       AND function.prosecdef
       AND function.proconfig @> ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION 'verify_failed: authorization RPC execution context drifted';
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
    IF NOT migration_recorded THEN
      RAISE EXCEPTION
        'verify_failed: migration ledger lacks 20260722152000_harden_admin_invalid_auth_amplification';
    END IF;
  END IF;
END;
$verify$;

SELECT
  pg_catalog.pg_get_function_identity_arguments(function.oid) AS identity_arguments,
  function.prosecdef AS security_definer,
  function.proconfig,
  function.proacl
FROM pg_catalog.pg_proc AS function
WHERE function.oid =
  'public.admin_token_authorization_v2(text)'::pg_catalog.regprocedure;

ROLLBACK;
