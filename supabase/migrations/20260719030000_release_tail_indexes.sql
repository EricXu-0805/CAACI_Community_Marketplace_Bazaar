-- Final release-tail index reconciliation.
--
-- 20260718220000 proved that every then-existing foreign key had a usable
-- leading btree index. 20260719010000 later introduced the reconciliation-fence
-- foreign key, so the global invariant must be restored at the actual tail.
-- The digest meetup scan also needs an oldest-first partial index; its bounded
-- LIMIT does not prevent a full-table scan/sort before rows are selected.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $guard$
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
BEGIN
  IF fence_table_oid IS NULL OR token_table_oid IS NULL OR meetup_table_oid IS NULL THEN
    RAISE EXCEPTION 'release_tail_index_prerequisite_missing'
      USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'release_tail_index_column_shape_mismatch'
      USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'release_tail_index_fence_fk_mismatch'
      USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'release_tail_index_existing_fence_index_mismatch'
      USING ERRCODE = '55000';
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
      RAISE EXCEPTION 'release_tail_index_existing_meetup_index_mismatch'
        USING ERRCODE = '55000';
    END IF;
  END IF;
END
$guard$;

CREATE INDEX IF NOT EXISTS
  admin_idempotency_reconciliation_fences_reconciled_by_idx
  ON public.admin_idempotency_reconciliation_fences (reconciled_by);

CREATE INDEX IF NOT EXISTS meetups_digest_pending_idx
  ON public.meetups (meet_at, id)
  WHERE status = 'accepted' AND reminded_at IS NULL;

COMMIT;
