-- Read-only pre-deploy gate for the final full FK indexes.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $precheck$
DECLARE
  profile_table_oid oid := pg_catalog.to_regclass('public.profiles');
  profile_id_column smallint;
  required_target record;
  target_table_oid oid;
  target_column smallint;
  target_index_oid oid;
  oversized text;
  conflicting_sessions text;
BEGIN
  IF profile_table_oid IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: profiles prerequisite missing';
  END IF;

  SELECT attribute.attnum
    INTO profile_id_column
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = profile_table_oid
    AND attribute.attname = 'id'
    AND attribute.atttypid = 'uuid'::pg_catalog.regtype
    AND attribute.attnotnull
    AND NOT attribute.attisdropped;

  IF profile_id_column IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: profiles.id shape mismatch';
  END IF;

  FOR required_target IN
    SELECT *
    FROM (VALUES
      (
        'admin_tokens',
        'admin_id',
        'admin_tokens_admin_id_full_idx',
        'n'::"char"
      ),
      (
        'suspensions',
        'profile_id',
        'suspensions_profile_id_full_idx',
        'c'::"char"
      ),
      (
        'reports',
        'reporter_id',
        'reports_reporter_id_idx',
        'c'::"char"
      )
    ) AS required(table_name, column_name, index_name, delete_action)
  LOOP
    target_table_oid := pg_catalog.to_regclass(
      pg_catalog.format('public.%I', required_target.table_name)
    );
    target_column := NULL;

    SELECT attribute.attnum
      INTO target_column
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = target_table_oid
      AND attribute.attname = required_target.column_name
      AND attribute.atttypid = 'uuid'::pg_catalog.regtype
      AND NOT attribute.attisdropped;

    IF target_table_oid IS NULL OR target_column IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: target shape mismatch: %.%',
        required_target.table_name,
        required_target.column_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS foreign_key
      WHERE foreign_key.conrelid = target_table_oid
        AND foreign_key.contype = 'f'
        AND foreign_key.convalidated
        AND foreign_key.confrelid = profile_table_oid
        AND foreign_key.conkey = ARRAY[target_column]::smallint[]
        AND foreign_key.confkey = ARRAY[profile_id_column]::smallint[]
        AND foreign_key.confdeltype = required_target.delete_action
    ) THEN
      RAISE EXCEPTION 'precheck_failed: FK shape mismatch: %.%',
        required_target.table_name,
        required_target.column_name;
    END IF;

    target_index_oid := pg_catalog.to_regclass(
      pg_catalog.format('public.%I', required_target.index_name)
    );
    IF target_index_oid IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index AS index_row
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_row.indexrelid
      JOIN pg_catalog.pg_am AS access_method
        ON access_method.oid = index_relation.relam
      WHERE index_relation.oid = target_index_oid
        AND index_row.indrelid = target_table_oid
        AND index_row.indisvalid
        AND index_row.indisready
        AND index_row.indislive
        AND NOT index_row.indisunique
        AND index_row.indnkeyatts = 1
        AND index_row.indnatts = 1
        AND index_row.indpred IS NULL
        AND index_row.indexprs IS NULL
        AND access_method.amname = 'btree'
        AND (index_row.indkey::smallint[])[0] = target_column
    ) THEN
      RAISE EXCEPTION 'precheck_failed: existing full FK index shape mismatch: %',
        required_target.index_name;
    END IF;
  END LOOP;

  WITH targets(table_oid, index_name) AS (
    VALUES
      (
        'public.admin_tokens'::pg_catalog.regclass,
        'public.admin_tokens_admin_id_full_idx'
      ),
      (
        'public.suspensions'::pg_catalog.regclass,
        'public.suspensions_profile_id_full_idx'
      ),
      (
        'public.reports'::pg_catalog.regclass,
        'public.reports_reporter_id_idx'
      )
  )
  SELECT pg_catalog.string_agg(
           pg_catalog.format(
             '%s=%s',
             target.table_oid::pg_catalog.regclass,
             pg_catalog.pg_size_pretty(
               pg_catalog.pg_total_relation_size(target.table_oid)
             )
           ),
           ', '
         )
    INTO oversized
  FROM targets AS target
  WHERE pg_catalog.to_regclass(target.index_name) IS NULL
    AND pg_catalog.pg_total_relation_size(target.table_oid) > 64 * 1024 * 1024;

  IF oversized IS NOT NULL THEN
    RAISE EXCEPTION
      'precheck_failed: full FK transactional index target exceeds 64 MiB; prebuild the exact named index concurrently in a reviewed maintenance path: %',
      oversized;
  END IF;

  WITH targets(table_oid, index_name) AS (
    VALUES
      (
        'public.admin_tokens'::pg_catalog.regclass,
        'public.admin_tokens_admin_id_full_idx'
      ),
      (
        'public.suspensions'::pg_catalog.regclass,
        'public.suspensions_profile_id_full_idx'
      ),
      (
        'public.reports'::pg_catalog.regclass,
        'public.reports_reporter_id_idx'
      )
  ), missing_targets AS (
    SELECT target.table_oid
    FROM targets AS target
    WHERE pg_catalog.to_regclass(target.index_name) IS NULL
  )
  SELECT pg_catalog.string_agg(
           CASE
             WHEN lock_row.pid IS NULL THEN
               'prepared-transaction:' || lock_row.mode
             ELSE pg_catalog.format('%s:%s', lock_row.pid, lock_row.mode)
           END,
           ', ' ORDER BY lock_row.pid NULLS FIRST, lock_row.mode
         )
    INTO conflicting_sessions
  FROM pg_catalog.pg_locks AS lock_row
  JOIN missing_targets AS target ON target.table_oid = lock_row.relation
  LEFT JOIN pg_catalog.pg_stat_activity AS activity ON activity.pid = lock_row.pid
  WHERE lock_row.granted
    AND lock_row.pid IS DISTINCT FROM pg_catalog.pg_backend_pid()
    AND lock_row.mode IN (
      'RowExclusiveLock', 'ShareUpdateExclusiveLock',
      'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock'
    )
    AND (lock_row.pid IS NULL OR activity.xact_start IS NOT NULL);

  IF conflicting_sessions IS NOT NULL THEN
    RAISE EXCEPTION
      'precheck_failed: full FK index target writers must drain first: %',
      conflicting_sessions;
  END IF;
END
$precheck$;

SELECT
  pg_catalog.pg_size_pretty(
    pg_catalog.pg_total_relation_size('public.admin_tokens')
  ) AS admin_tokens_size,
  pg_catalog.pg_size_pretty(
    pg_catalog.pg_total_relation_size('public.suspensions')
  ) AS suspensions_size,
  pg_catalog.pg_size_pretty(
    pg_catalog.pg_total_relation_size('public.reports')
  ) AS reports_size,
  pg_catalog.to_regclass(
    'public.admin_tokens_admin_id_full_idx'
  ) AS existing_admin_tokens_index,
  pg_catalog.to_regclass(
    'public.suspensions_profile_id_full_idx'
  ) AS existing_suspensions_index,
  pg_catalog.to_regclass(
    'public.reports_reporter_id_idx'
  ) AS existing_reports_index;

ROLLBACK;
