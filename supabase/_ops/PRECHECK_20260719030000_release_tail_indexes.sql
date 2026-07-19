-- Read-only pre-deploy gate for 20260719030000_release_tail_indexes.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $precheck$
DECLARE
  fence_table_oid oid := pg_catalog.to_regclass(
    'public.admin_idempotency_reconciliation_fences'
  );
  token_table_oid oid := pg_catalog.to_regclass('public.admin_tokens');
  meetup_table_oid oid := pg_catalog.to_regclass('public.meetups');
  fence_column smallint;
  token_id_column smallint;
  meetup_at_column smallint;
  meetup_id_column smallint;
  meetup_predicate text;
  oversized text;
  conflicting_sessions text;
BEGIN
  IF fence_table_oid IS NULL OR token_table_oid IS NULL OR meetup_table_oid IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: release-tail index prerequisite missing';
  END IF;

  SELECT attribute.attnum INTO fence_column
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = fence_table_oid
    AND attribute.attname = 'reconciled_by'
    AND attribute.atttypid = 'uuid'::pg_catalog.regtype
    AND attribute.attnotnull
    AND NOT attribute.attisdropped;
  SELECT attribute.attnum INTO token_id_column
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = token_table_oid
    AND attribute.attname = 'id'
    AND attribute.atttypid = 'uuid'::pg_catalog.regtype
    AND attribute.attnotnull
    AND NOT attribute.attisdropped;
  SELECT attribute.attnum INTO meetup_at_column
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = meetup_table_oid
    AND attribute.attname = 'meet_at'
    AND attribute.atttypid = 'timestamp with time zone'::pg_catalog.regtype
    AND attribute.attnotnull
    AND NOT attribute.attisdropped;
  SELECT attribute.attnum INTO meetup_id_column
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = meetup_table_oid
    AND attribute.attname = 'id'
    AND attribute.atttypid = 'uuid'::pg_catalog.regtype
    AND attribute.attnotnull
    AND NOT attribute.attisdropped;

  IF fence_column IS NULL OR token_id_column IS NULL
     OR meetup_at_column IS NULL OR meetup_id_column IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: release-tail index column shape mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS foreign_key
    WHERE foreign_key.conrelid = fence_table_oid
      AND foreign_key.contype = 'f'
      AND foreign_key.convalidated
      AND foreign_key.confrelid = token_table_oid
      AND foreign_key.conkey = ARRAY[fence_column]::smallint[]
      AND foreign_key.confkey = ARRAY[token_id_column]::smallint[]
      AND foreign_key.confdeltype = 'r'
  ) THEN
    RAISE EXCEPTION 'precheck_failed: release-tail fence FK mismatch';
  END IF;

  IF pg_catalog.to_regclass(
       'public.admin_idempotency_reconciliation_fences_reconciled_by_idx'
     ) IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = index_row.indexrelid
    JOIN pg_catalog.pg_am AS access_method
      ON access_method.oid = index_relation.relam
    WHERE index_relation.oid = pg_catalog.to_regclass(
            'public.admin_idempotency_reconciliation_fences_reconciled_by_idx'
          )
      AND index_row.indrelid = fence_table_oid
      AND index_row.indisvalid AND index_row.indisready AND index_row.indislive
      AND NOT index_row.indisunique
      AND index_row.indnkeyatts = 1 AND index_row.indnatts = 1
      AND index_row.indpred IS NULL AND index_row.indexprs IS NULL
      AND access_method.amname = 'btree'
      AND (index_row.indkey::smallint[])[0] = fence_column
  ) THEN
    RAISE EXCEPTION 'precheck_failed: existing fence index shape mismatch';
  END IF;

  IF pg_catalog.to_regclass('public.meetups_digest_pending_idx') IS NOT NULL THEN
    SELECT pg_catalog.regexp_replace(
             pg_catalog.replace(pg_catalog.replace(
               pg_catalog.lower(pg_catalog.pg_get_expr(
                 index_row.indpred,
                 index_row.indrelid
               )),
               '(',
               ''
             ), ')', ''),
             '[[:space:]]+',
             ' ',
             'g'
           )
      INTO meetup_predicate
    FROM pg_catalog.pg_index AS index_row
    WHERE index_row.indexrelid =
          'public.meetups_digest_pending_idx'::pg_catalog.regclass;

    IF meetup_predicate IS DISTINCT FROM
         'status = ''accepted''::text and reminded_at is null'
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_index AS index_row
         JOIN pg_catalog.pg_class AS index_relation
           ON index_relation.oid = index_row.indexrelid
         JOIN pg_catalog.pg_am AS access_method
           ON access_method.oid = index_relation.relam
         WHERE index_relation.oid =
               'public.meetups_digest_pending_idx'::pg_catalog.regclass
           AND index_row.indrelid = meetup_table_oid
           AND index_row.indisvalid AND index_row.indisready AND index_row.indislive
           AND NOT index_row.indisunique
           AND index_row.indnkeyatts = 2 AND index_row.indnatts = 2
           AND index_row.indexprs IS NULL
           AND access_method.amname = 'btree'
           AND (index_row.indkey::smallint[])[0] = meetup_at_column
           AND (index_row.indkey::smallint[])[1] = meetup_id_column
       ) THEN
      RAISE EXCEPTION 'precheck_failed: existing meetup digest index shape mismatch';
    END IF;
  END IF;

  WITH targets(table_oid, index_name) AS (
    VALUES
      (
        fence_table_oid,
        'public.admin_idempotency_reconciliation_fences_reconciled_by_idx'
      ),
      (meetup_table_oid, 'public.meetups_digest_pending_idx')
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
      'precheck_failed: release-tail transactional index target exceeds 64 MiB; prebuild exact index concurrently in a reviewed maintenance path: %',
      oversized;
  END IF;

  WITH targets(table_oid, index_name) AS (
    VALUES
      (
        fence_table_oid,
        'public.admin_idempotency_reconciliation_fences_reconciled_by_idx'
      ),
      (meetup_table_oid, 'public.meetups_digest_pending_idx')
  ), missing_targets AS (
    SELECT target.table_oid
    FROM targets AS target
    WHERE pg_catalog.to_regclass(target.index_name) IS NULL
  )
  SELECT pg_catalog.string_agg(
           pg_catalog.format('%s:%s', activity.pid, lock_row.mode),
           ', ' ORDER BY activity.pid, lock_row.mode
         )
    INTO conflicting_sessions
  FROM pg_catalog.pg_locks AS lock_row
  JOIN missing_targets AS target ON target.table_oid = lock_row.relation
  JOIN pg_catalog.pg_stat_activity AS activity ON activity.pid = lock_row.pid
  WHERE lock_row.granted
    AND lock_row.pid <> pg_catalog.pg_backend_pid()
    AND activity.xact_start IS NOT NULL
    AND pg_catalog.now() - activity.xact_start > interval '30 seconds'
    AND lock_row.mode IN (
      'RowExclusiveLock', 'ShareUpdateExclusiveLock', 'ShareLock',
      'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock'
    );

  IF conflicting_sessions IS NOT NULL THEN
    RAISE EXCEPTION
      'precheck_failed: release-tail target writers must drain first: %',
      conflicting_sessions;
  END IF;
END
$precheck$;

SELECT
  pg_catalog.pg_size_pretty(pg_catalog.pg_total_relation_size(
    'public.admin_idempotency_reconciliation_fences'
  )) AS fence_table_size,
  pg_catalog.pg_size_pretty(pg_catalog.pg_total_relation_size(
    'public.meetups'
  )) AS meetups_table_size,
  pg_catalog.to_regclass(
    'public.admin_idempotency_reconciliation_fences_reconciled_by_idx'
  ) AS existing_fence_index,
  pg_catalog.to_regclass(
    'public.meetups_digest_pending_idx'
  ) AS existing_meetup_index;

ROLLBACK;
