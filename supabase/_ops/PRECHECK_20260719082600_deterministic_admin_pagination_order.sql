-- Read-only pre-deploy gate for
-- 20260719082600_deterministic_admin_pagination_order.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $precheck$
DECLARE
  expected record;
  function_oid oid;
  function_security_definer boolean;
  function_language text;
  missing_shape text;
BEGIN
  -- Version ordering is enforced by the migration ledger. These two objects
  -- additionally prove that the immediately preceding release-tail migration
  -- has reached the target schema before this function-only tail is applied.
  IF pg_catalog.to_regclass(
       'public.admin_idempotency_reconciliation_fences_reconciled_by_idx'
     ) IS NULL
     OR pg_catalog.to_regclass('public.meetups_digest_pending_idx') IS NULL THEN
    RAISE EXCEPTION
      'precheck_failed: 20260719030000 release-tail indexes are missing';
  END IF;

  FOR expected IN
    SELECT *
    FROM (VALUES
      ('public.admin_list_reports_grouped(integer,integer,boolean)'),
      ('public.admin_list_suspensions(integer,integer,boolean)'),
      ('public.admin_list_appeals(integer,integer)'),
      ('public.admin_list_audit_log(integer,integer,text)'),
      ('public.admin_list_plaza_posts(integer,integer)')
    ) AS function_target(signature)
  LOOP
    function_oid := pg_catalog.to_regprocedure(expected.signature);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: required function missing: %',
        expected.signature;
    END IF;

    SELECT procedure.prosecdef, language.lanname
      INTO function_security_definer, function_language
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
    WHERE procedure.oid = function_oid;

    IF NOT function_security_definer OR function_language <> 'sql' THEN
      RAISE EXCEPTION
        'precheck_failed: function execution contract drifted: %',
        expected.signature;
    END IF;
  END LOOP;

  WITH expected_columns(table_name, column_name, type_name, must_be_not_null) AS (
    VALUES
      ('reports', 'id', 'uuid', true),
      ('reports', 'target_type', 'text', true),
      ('reports', 'target_id', 'uuid', true),
      ('reports', 'created_at', 'timestamp with time zone', true),
      ('suspensions', 'id', 'uuid', true),
      ('suspensions', 'created_at', 'timestamp with time zone', true),
      ('admin_audit_log', 'id', 'bigint', true),
      ('admin_audit_log', 'created_at', 'timestamp with time zone', true),
      ('posts', 'id', 'uuid', true),
      ('posts', 'is_pinned', 'boolean', true),
      ('posts', 'created_at', 'timestamp with time zone', true)
  ), drift AS (
    SELECT expected_column.table_name || '.' || expected_column.column_name AS name
    FROM expected_columns AS expected_column
    LEFT JOIN pg_catalog.pg_class AS relation
      ON relation.oid = pg_catalog.to_regclass(
           'public.' || expected_column.table_name
         )
    LEFT JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
     AND attribute.attname = expected_column.column_name
     AND NOT attribute.attisdropped
    WHERE relation.oid IS NULL
       OR attribute.attnum IS NULL
       OR attribute.atttypid <> expected_column.type_name::pg_catalog.regtype
       OR (expected_column.must_be_not_null AND NOT attribute.attnotnull)
  )
  SELECT pg_catalog.string_agg(drift.name, ', ' ORDER BY drift.name)
    INTO missing_shape
  FROM drift;

  IF missing_shape IS NOT NULL THEN
    RAISE EXCEPTION 'precheck_failed: pagination column shape drifted: %',
      missing_shape;
  END IF;

  WITH expected_primary_keys(table_name, column_name) AS (
    VALUES
      ('reports', 'id'),
      ('suspensions', 'id'),
      ('admin_audit_log', 'id'),
      ('posts', 'id')
  ), drift AS (
    SELECT expected_key.table_name || '.' || expected_key.column_name AS name
    FROM expected_primary_keys AS expected_key
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = pg_catalog.to_regclass('public.' || expected_key.table_name)
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
     AND attribute.attname = expected_key.column_name
     AND NOT attribute.attisdropped
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = relation.oid
        AND constraint_row.contype = 'p'
        AND constraint_row.convalidated
        AND attribute.attnum = ANY (constraint_row.conkey)
    )
  )
  SELECT pg_catalog.string_agg(drift.name, ', ' ORDER BY drift.name)
    INTO missing_shape
  FROM drift;

  IF missing_shape IS NOT NULL THEN
    RAISE EXCEPTION 'precheck_failed: pagination unique key drifted: %',
      missing_shape;
  END IF;
END
$precheck$;

SELECT
  pg_catalog.to_regprocedure(
    'public.admin_list_reports_grouped(integer,integer,boolean)'
  ) AS reports_grouped,
  pg_catalog.to_regprocedure(
    'public.admin_list_suspensions(integer,integer,boolean)'
  ) AS suspensions,
  pg_catalog.to_regprocedure(
    'public.admin_list_appeals(integer,integer)'
  ) AS appeals,
  pg_catalog.to_regprocedure(
    'public.admin_list_audit_log(integer,integer,text)'
  ) AS audit_log,
  pg_catalog.to_regprocedure(
    'public.admin_list_plaza_posts(integer,integer)'
  ) AS plaza_posts;

ROLLBACK;
