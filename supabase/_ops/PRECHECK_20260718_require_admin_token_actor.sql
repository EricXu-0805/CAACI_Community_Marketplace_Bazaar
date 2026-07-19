-- Read-only pre-deploy gate for 20260718170000_require_admin_token_actor.sql.
-- Safe on production only as an explicitly approved read-only inspection.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  null_actor_count bigint;
  orphan_actor_count bigint;
  validate_rpc oid := pg_catalog.to_regprocedure(
    'public.admin_token_validate(text)'
  );
BEGIN
  IF pg_catalog.to_regclass('public.admin_tokens') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: admin_tokens/profiles table missing';
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
    RAISE EXCEPTION 'precheck_failed: admin_tokens.admin_id uuid missing';
  END IF;

  SELECT pg_catalog.count(*)
    INTO null_actor_count
    FROM public.admin_tokens AS token
   WHERE token.admin_id IS NULL;

  IF null_actor_count > 0 THEN
    RAISE EXCEPTION
      'precheck_failed: % admin token row(s) have NULL admin_id',
      null_actor_count
      USING HINT = 'Do not infer identity from name/email. Revoke and replace each token with an independently verified profiles.id, retain required evidence, deliberately clean up the obsolete row, then rerun.';
  END IF;

  SELECT pg_catalog.count(*)
    INTO orphan_actor_count
    FROM public.admin_tokens AS token
    LEFT JOIN public.profiles AS profile ON profile.id = token.admin_id
   WHERE token.admin_id IS NOT NULL
     AND profile.id IS NULL;

  IF orphan_actor_count > 0 THEN
    RAISE EXCEPTION
      'precheck_failed: % admin token actor row(s) do not resolve to profiles',
      orphan_actor_count;
  END IF;

  IF validate_rpc IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: admin_token_validate(text) missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function_row
     WHERE function_row.oid = validate_rpc
       AND function_row.prosecdef
       AND pg_catalog.strpos(function_row.prosrc, 't.admin_id') > 0
       AND pg_catalog.strpos(function_row.prosrc, 't.revoked_at IS NULL') > 0
       AND pg_catalog.strpos(function_row.prosrc, 't.expires_at IS NULL') > 0
  ) THEN
    RAISE EXCEPTION 'precheck_failed: admin_token_validate actor/lifecycle contract drifted';
  END IF;
END
$precheck$;

SELECT
  pg_catalog.count(*) AS token_rows,
  pg_catalog.count(*) FILTER (WHERE token.admin_id IS NULL) AS null_actor_rows,
  pg_catalog.count(*) FILTER (
    WHERE token.revoked_at IS NULL
      AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
  ) AS active_token_rows
FROM public.admin_tokens AS token;

SELECT
  column_row.attnotnull AS admin_id_not_null_before,
  pg_catalog.col_description(column_row.attrelid, column_row.attnum) AS column_comment
FROM pg_catalog.pg_attribute AS column_row
WHERE column_row.attrelid = 'public.admin_tokens'::pg_catalog.regclass
  AND column_row.attname = 'admin_id'
  AND column_row.attnum > 0
  AND NOT column_row.attisdropped;

ROLLBACK;
