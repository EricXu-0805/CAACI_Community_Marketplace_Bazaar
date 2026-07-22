-- Read-only preflight for
-- 20260722024000_harden_wechat_callback_replay.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;

DO $precheck$
DECLARE
  media_oid oid;
  media_owner oid;
  primary_key_columns text[];
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
  ) THEN
    RAISE EXCEPTION 'precheck_failed: API role missing';
  END IF;

  SELECT relation.oid, relation.relowner
  INTO media_oid, media_owner
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'wechat_media_checks'
    AND relation.relkind = 'r'
    AND relation.relrowsecurity;

  IF media_oid IS NULL OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('trace_id', 'text', true),
      ('bucket', 'text', true),
      ('storage_path', 'text', true),
      ('user_id', 'uuid', false),
      ('created_at', 'timestamp with time zone', true)
    ) AS required(column_name, type_name, not_null)
    LEFT JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = media_oid
     AND attribute.attname = required.column_name
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND attribute.atttypid = pg_catalog.to_regtype(required.type_name)
     AND attribute.attnotnull = required.not_null
    WHERE attribute.attname IS NULL
  ) THEN
    RAISE EXCEPTION 'precheck_failed: exact wechat_media_checks contract missing';
  END IF;

  SELECT pg_catalog.array_agg(attribute.attname ORDER BY key_column.ordinality)
  INTO primary_key_columns
  FROM pg_catalog.pg_constraint AS constraint_row
  CROSS JOIN LATERAL pg_catalog.unnest(constraint_row.conkey)
    WITH ORDINALITY AS key_column(attnum, ordinality)
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = constraint_row.conrelid
   AND attribute.attnum = key_column.attnum
  WHERE constraint_row.conrelid = media_oid
    AND constraint_row.contype = 'p';

  IF primary_key_columns IS DISTINCT FROM ARRAY['trace_id']::text[] THEN
    RAISE EXCEPTION 'precheck_failed: wechat_media_checks primary key drift';
  END IF;

  IF media_owner IS NULL OR NOT pg_catalog.has_table_privilege(
       current_user, media_oid, 'SELECT,DELETE'
     ) THEN
    RAISE EXCEPTION 'precheck_failed: migration owner lacks mapping privileges';
  END IF;

  IF pg_catalog.to_regclass('public.wechat_callback_receipts') IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS routine
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = routine.pronamespace
       WHERE namespace.nspname = 'public'
         AND routine.proname IN (
           'claim_wechat_callback_receipt',
           'complete_wechat_callback_receipt',
           'release_wechat_callback_receipt'
         )
     ) THEN
    RAISE EXCEPTION 'precheck_failed: callback receipt target already exists';
  END IF;

  IF pg_catalog.to_regclass(
       'supabase_migrations.schema_migrations'
     ) IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1)'
      INTO migration_recorded
      USING '20260722024000';
    IF migration_recorded THEN
      RAISE EXCEPTION 'precheck_failed: migration ledger already contains 20260722024000';
    END IF;
  END IF;
END;
$precheck$;

SELECT
  relation.oid::pg_catalog.regclass AS media_table,
  relation.relrowsecurity AS rls_enabled,
  relation.relforcerowsecurity AS rls_forced,
  relation.relacl
FROM pg_catalog.pg_class AS relation
WHERE relation.oid = 'public.wechat_media_checks'::pg_catalog.regclass;

SELECT
  attribute.attname AS column_name,
  pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
  attribute.attnotnull AS not_null
FROM pg_catalog.pg_attribute AS attribute
WHERE attribute.attrelid = 'public.wechat_media_checks'::pg_catalog.regclass
  AND attribute.attnum > 0
  AND NOT attribute.attisdropped
ORDER BY attribute.attnum;

ROLLBACK;
