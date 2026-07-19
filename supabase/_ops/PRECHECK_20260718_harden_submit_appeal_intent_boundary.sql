-- Read-only deployment gate for 20260718120000_harden_submit_appeal_intent_boundary.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $precheck$
BEGIN
  IF pg_catalog.to_regclass('public.suspensions') IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: missing public.suspensions';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('id', 'uuid'),
      ('profile_id', 'uuid'),
      ('lifted_at', 'timestamp with time zone'),
      ('appeal_note', 'text'),
      ('created_at', 'timestamp with time zone')
    ) AS required(column_name, formatted_type)
    LEFT JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = 'public.suspensions'::pg_catalog.regclass
     AND attribute.attname = required.column_name
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    WHERE attribute.attname IS NULL
       OR pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
          <> required.formatted_type
  ) THEN
    RAISE EXCEPTION 'precheck_failed: suspension appeal column shape mismatch';
  END IF;

  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR pg_catalog.to_regprocedure('public.submit_appeal(text)') IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: legacy appeal/auth function is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS required(role_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = required.role_name
    )
  ) THEN
    RAISE EXCEPTION 'precheck_failed: required API role is missing';
  END IF;
END
$precheck$;

SELECT
  pg_catalog.to_regclass('public.suspensions') AS suspensions_table,
  pg_catalog.to_regprocedure('public.submit_appeal(text)') AS legacy_rpc,
  pg_catalog.to_regprocedure('public.submit_appeal(text,uuid,uuid)') AS intent_rpc;

SELECT
  attribute.attname AS column_name,
  pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS data_type
FROM pg_catalog.pg_attribute AS attribute
WHERE attribute.attrelid = 'public.suspensions'::pg_catalog.regclass
  AND attribute.attname IN (
    'id', 'profile_id', 'lifted_at', 'appeal_note', 'created_at'
  )
  AND attribute.attnum > 0
  AND NOT attribute.attisdropped
ORDER BY attribute.attnum;

ROLLBACK;
