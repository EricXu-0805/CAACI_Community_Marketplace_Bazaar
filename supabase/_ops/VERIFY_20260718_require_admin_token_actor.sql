-- Read-only post-deploy verification for required admin-token actors.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  validate_rpc oid := pg_catalog.to_regprocedure(
    'public.admin_token_validate(text)'
  );
  lifecycle_rpc oid := pg_catalog.to_regprocedure(
    'public.admin_prepare_account_deletion(uuid)'
  );
BEGIN
  IF pg_catalog.to_regclass('public.admin_tokens') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'verify_failed: admin_tokens/profiles table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS column_row
     WHERE column_row.attrelid = 'public.admin_tokens'::pg_catalog.regclass
       AND column_row.attname = 'admin_id'
       AND column_row.atttypid = 'uuid'::pg_catalog.regtype
       AND column_row.attnum > 0
       AND NOT column_row.attisdropped
  ) THEN
    RAISE EXCEPTION 'verify_failed: admin_tokens.admin_id is not uuid';
  END IF;

  IF lifecycle_rpc IS NULL THEN
    IF EXISTS (
      SELECT 1
        FROM pg_catalog.pg_attribute AS column_row
       WHERE column_row.attrelid = 'public.admin_tokens'::pg_catalog.regclass
         AND column_row.attname = 'admin_id'
         AND NOT column_row.attnotnull
         AND NOT column_row.attisdropped
    ) OR EXISTS (
      SELECT 1 FROM public.admin_tokens AS token WHERE token.admin_id IS NULL
    ) OR NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = 'public.admin_tokens'::pg_catalog.regclass
         AND constraint_row.contype = 'f'
         AND constraint_row.confrelid = 'public.profiles'::pg_catalog.regclass
         AND constraint_row.confdeltype = 'c'
         AND constraint_row.convalidated
         AND constraint_row.conkey = ARRAY[
           (SELECT column_row.attnum
              FROM pg_catalog.pg_attribute AS column_row
             WHERE column_row.attrelid = 'public.admin_tokens'::pg_catalog.regclass
               AND column_row.attname = 'admin_id'
               AND NOT column_row.attisdropped)
         ]
    ) THEN
      RAISE EXCEPTION
        'verify_failed: pre-lifecycle admin token actor NOT NULL/CASCADE boundary';
    END IF;
  ELSE
    -- The later lifecycle migration intentionally preserves revoked credential
    -- evidence after profile deletion. At that point NULL is legal only for a
    -- revoked row and the FK must detach, never cascade away the evidence.
    IF EXISTS (
      SELECT 1
        FROM pg_catalog.pg_attribute AS column_row
       WHERE column_row.attrelid = 'public.admin_tokens'::pg_catalog.regclass
         AND column_row.attname = 'admin_id'
         AND column_row.attnotnull
         AND NOT column_row.attisdropped
    ) OR EXISTS (
      SELECT 1
        FROM public.admin_tokens AS token
       WHERE token.admin_id IS NULL
         AND token.revoked_at IS NULL
    ) OR NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = 'public.admin_tokens'::pg_catalog.regclass
         AND constraint_row.contype = 'f'
         AND constraint_row.confrelid = 'public.profiles'::pg_catalog.regclass
         AND constraint_row.confdeltype = 'n'
         AND constraint_row.convalidated
         AND constraint_row.conkey = ARRAY[
           (SELECT column_row.attnum
              FROM pg_catalog.pg_attribute AS column_row
             WHERE column_row.attrelid = 'public.admin_tokens'::pg_catalog.regclass
               AND column_row.attname = 'admin_id'
               AND NOT column_row.attisdropped)
         ]
    ) OR NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = 'public.admin_tokens'::pg_catalog.regclass
         AND constraint_row.conname = 'admin_tokens_detached_revoked_check'
         AND constraint_row.contype = 'c'
         AND constraint_row.convalidated
    ) THEN
      RAISE EXCEPTION
        'verify_failed: lifecycle detached/revoked admin token actor boundary';
    END IF;
  END IF;

  IF validate_rpc IS NULL THEN
    RAISE EXCEPTION 'verify_failed: admin_token_validate(text) missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function_row
     WHERE function_row.oid = validate_rpc
       AND function_row.prosecdef
       AND function_row.provolatile = 'v'
       AND pg_catalog.strpos(function_row.prosrc, 't.admin_id') > 0
       AND pg_catalog.strpos(function_row.prosrc, 't.revoked_at IS NULL') > 0
       AND pg_catalog.strpos(function_row.prosrc, 't.expires_at IS NULL') > 0
       AND pg_catalog.strpos(function_row.prosrc, 't.expires_at > now()') > 0
  ) THEN
    RAISE EXCEPTION 'verify_failed: token validation actor/lifecycle contract mismatch';
  END IF;

  IF NOT pg_catalog.has_function_privilege('service_role', validate_rpc, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', validate_rpc, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', validate_rpc, 'EXECUTE')
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS function_row
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             function_row.proacl,
             pg_catalog.acldefault('f', function_row.proowner)
           )
         ) AS function_acl
        WHERE function_row.oid = validate_rpc
          AND function_acl.grantee = 0
          AND function_acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: admin_token_validate ACL mismatch';
  END IF;
END
$verify$;

SELECT
  column_row.attnotnull AS admin_id_not_null,
  pg_catalog.col_description(column_row.attrelid, column_row.attnum) AS column_comment
FROM pg_catalog.pg_attribute AS column_row
WHERE column_row.attrelid = 'public.admin_tokens'::pg_catalog.regclass
  AND column_row.attname = 'admin_id'
  AND column_row.attnum > 0
  AND NOT column_row.attisdropped;

SELECT
  constraint_row.conname,
  constraint_row.convalidated,
  pg_catalog.pg_get_constraintdef(constraint_row.oid) AS definition
FROM pg_catalog.pg_constraint AS constraint_row
WHERE constraint_row.conrelid = 'public.admin_tokens'::pg_catalog.regclass
  AND constraint_row.contype = 'f'
ORDER BY constraint_row.conname;

ROLLBACK;
