-- Read-only post-deploy verification for release-tail indexes.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  fence_table_oid oid := pg_catalog.to_regclass(
    'public.admin_idempotency_reconciliation_fences'
  );
  meetup_table_oid oid := pg_catalog.to_regclass('public.meetups');
  fence_column smallint;
  meetup_at_column smallint;
  meetup_id_column smallint;
  meetup_predicate text;
  uncovered_count integer;
BEGIN
  SELECT attribute.attnum INTO fence_column
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = fence_table_oid
    AND attribute.attname = 'reconciled_by'
    AND NOT attribute.attisdropped;
  SELECT attribute.attnum INTO meetup_at_column
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = meetup_table_oid
    AND attribute.attname = 'meet_at'
    AND NOT attribute.attisdropped;
  SELECT attribute.attnum INTO meetup_id_column
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = meetup_table_oid
    AND attribute.attname = 'id'
    AND NOT attribute.attisdropped;

  IF fence_table_oid IS NULL OR meetup_table_oid IS NULL
     OR fence_column IS NULL OR meetup_at_column IS NULL OR meetup_id_column IS NULL THEN
    RAISE EXCEPTION 'verify_failed: release-tail index relation/column missing';
  END IF;

  IF NOT EXISTS (
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
    RAISE EXCEPTION 'verify_failed: reconciled_by FK index shape mismatch';
  END IF;

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
  WHERE index_row.indexrelid = pg_catalog.to_regclass(
          'public.meetups_digest_pending_idx'
        );

  IF meetup_predicate IS DISTINCT FROM
       'status = ''accepted''::text and reminded_at is null'
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_index AS index_row
       JOIN pg_catalog.pg_class AS index_relation
         ON index_relation.oid = index_row.indexrelid
       JOIN pg_catalog.pg_am AS access_method
         ON access_method.oid = index_relation.relam
       WHERE index_relation.oid = pg_catalog.to_regclass(
               'public.meetups_digest_pending_idx'
             )
         AND index_row.indrelid = meetup_table_oid
         AND index_row.indisvalid AND index_row.indisready AND index_row.indislive
         AND NOT index_row.indisunique
         AND index_row.indnkeyatts = 2 AND index_row.indnatts = 2
         AND index_row.indexprs IS NULL
         AND access_method.amname = 'btree'
         AND (index_row.indkey::smallint[])[0] = meetup_at_column
         AND (index_row.indkey::smallint[])[1] = meetup_id_column
     ) THEN
    RAISE EXCEPTION 'verify_failed: meetup digest partial index shape mismatch';
  END IF;

  -- Re-run the global advisor-equivalent invariant at the actual migration tail;
  -- 20260718220000 cannot see foreign keys introduced by later migrations.
  WITH foreign_keys AS (
    SELECT foreign_key.conrelid, foreign_key.conkey
    FROM pg_catalog.pg_constraint AS foreign_key
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = foreign_key.conrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE foreign_key.contype = 'f'
      AND namespace.nspname IN ('public', 'private')
  )
  SELECT pg_catalog.count(*)::integer
    INTO uncovered_count
  FROM foreign_keys AS foreign_key
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = index_row.indexrelid
    JOIN pg_catalog.pg_am AS access_method
      ON access_method.oid = index_relation.relam
    WHERE index_row.indrelid = foreign_key.conrelid
      AND index_row.indisvalid
      AND index_row.indisready
      AND index_row.indislive
      AND access_method.amname = 'btree'
      AND index_row.indnkeyatts >= pg_catalog.cardinality(foreign_key.conkey)
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.generate_subscripts(
          foreign_key.conkey,
          1
        ) AS position
        WHERE (index_row.indkey::smallint[])[position - 1]
              <> foreign_key.conkey[position]
      )
  );

  IF uncovered_count <> 0 THEN
    RAISE EXCEPTION
      'verify_failed: % foreign keys lack a valid leading btree index at release tail',
      uncovered_count;
  END IF;
END
$verify$;

SELECT
  index_relation.relname AS index_name,
  pg_catalog.pg_get_indexdef(index_relation.oid) AS definition
FROM pg_catalog.pg_class AS index_relation
WHERE index_relation.oid IN (
  'public.admin_idempotency_reconciliation_fences_reconciled_by_idx'::pg_catalog.regclass,
  'public.meetups_digest_pending_idx'::pg_catalog.regclass
)
ORDER BY index_relation.relname;

ROLLBACK;
