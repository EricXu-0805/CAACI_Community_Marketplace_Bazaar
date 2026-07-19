-- Read-only post-deploy verification for the real release-tail FK indexes.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  target record;
  target_table_oid oid;
  target_column smallint;
  uncovered_count integer;
BEGIN
  FOR target IN
    SELECT *
    FROM (VALUES
      ('admin_tokens', 'admin_id', 'admin_tokens_admin_id_full_idx'),
      ('suspensions', 'profile_id', 'suspensions_profile_id_full_idx'),
      ('reports', 'reporter_id', 'reports_reporter_id_idx')
    ) AS required(table_name, column_name, index_name)
  LOOP
    target_table_oid := pg_catalog.to_regclass(
      pg_catalog.format('public.%I', target.table_name)
    );
    target_column := NULL;

    SELECT attribute.attnum
      INTO target_column
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = target_table_oid
      AND attribute.attname = target.column_name
      AND NOT attribute.attisdropped;

    IF target_table_oid IS NULL OR target_column IS NULL OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index AS index_row
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_row.indexrelid
      JOIN pg_catalog.pg_am AS access_method
        ON access_method.oid = index_relation.relam
      WHERE index_relation.oid = pg_catalog.to_regclass(
              pg_catalog.format('public.%I', target.index_name)
            )
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
      RAISE EXCEPTION 'verify_failed: full FK index shape mismatch: %',
        target.index_name;
    END IF;
  END LOOP;

  -- A full btree prefix is always usable. A partial index is accepted only for
  -- a single-column FK whose entire predicate is exactly that same nullable
  -- column IS NOT NULL; the FK equality lookup implies that predicate. Business
  -- predicates such as status='pending', revoked_at IS NULL, or lifted_at IS
  -- NULL must never be counted as global FK coverage.
  WITH foreign_keys AS (
    SELECT
      foreign_key.conrelid,
      foreign_key.conkey,
      (
        SELECT attribute.attname
        FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = foreign_key.conrelid
          AND attribute.attnum = foreign_key.conkey[1]
          AND NOT attribute.attisdropped
      ) AS single_column_name
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
      AND (
        index_row.indpred IS NULL
        OR (
          pg_catalog.cardinality(foreign_key.conkey) = 1
          AND foreign_key.single_column_name IS NOT NULL
          AND pg_catalog.regexp_replace(
                pg_catalog.replace(
                  pg_catalog.replace(
                    pg_catalog.lower(pg_catalog.pg_get_expr(
                      index_row.indpred,
                      index_row.indrelid
                    )),
                    '(',
                    ''
                  ),
                  ')',
                  ''
                ),
                '[[:space:]]+',
                ' ',
                'g'
              ) = pg_catalog.lower(pg_catalog.format(
                    '%I is not null',
                    foreign_key.single_column_name
                  ))
        )
      )
  );

  IF uncovered_count <> 0 THEN
    RAISE EXCEPTION
      'verify_failed: % foreign keys lack a safe leading btree index at the real release tail',
      uncovered_count;
  END IF;
END
$verify$;

SELECT
  index_relation.relname AS index_name,
  pg_catalog.pg_get_indexdef(index_relation.oid) AS definition
FROM pg_catalog.pg_class AS index_relation
WHERE index_relation.oid IN (
  'public.admin_tokens_admin_id_full_idx'::pg_catalog.regclass,
  'public.suspensions_profile_id_full_idx'::pg_catalog.regclass,
  'public.reports_reporter_id_idx'::pg_catalog.regclass
)
ORDER BY index_relation.relname;

ROLLBACK;
