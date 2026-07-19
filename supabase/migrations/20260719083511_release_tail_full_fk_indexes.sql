-- Restore the real release-tail foreign-key index invariant.
--
-- The earlier advisor-equivalent verifier accepted every partial btree whose
-- leading key matched a foreign key. That is only safe when the partial
-- predicate is implied by the FK lookup itself (for this schema, the exact
-- nullable-FK predicate "column IS NOT NULL"). These three historical indexes
-- have unrelated business predicates, so parent-row UPDATE/DELETE paths could
-- still scan the complete child table.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $guard$
DECLARE
  profile_table_oid oid := pg_catalog.to_regclass('public.profiles');
  profile_id_column smallint;
  target record;
  target_table_oid oid;
  target_column smallint;
  target_index_oid oid;
BEGIN
  IF profile_table_oid IS NULL THEN
    RAISE EXCEPTION 'release_full_fk_index_profiles_missing'
      USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'release_full_fk_index_profile_id_shape_mismatch'
      USING ERRCODE = '55000';
  END IF;

  FOR target IN
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
      pg_catalog.format('public.%I', target.table_name)
    );
    target_column := NULL;

    SELECT attribute.attnum
      INTO target_column
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = target_table_oid
      AND attribute.attname = target.column_name
      AND attribute.atttypid = 'uuid'::pg_catalog.regtype
      AND NOT attribute.attisdropped;

    IF target_table_oid IS NULL OR target_column IS NULL THEN
      RAISE EXCEPTION 'release_full_fk_index_target_shape_mismatch: %.%',
        target.table_name,
        target.column_name
        USING ERRCODE = '55000';
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
        AND foreign_key.confdeltype = target.delete_action
    ) THEN
      RAISE EXCEPTION 'release_full_fk_index_fk_mismatch: %.%',
        target.table_name,
        target.column_name
        USING ERRCODE = '55000';
    END IF;

    target_index_oid := pg_catalog.to_regclass(
      pg_catalog.format('public.%I', target.index_name)
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
      RAISE EXCEPTION 'release_full_fk_index_existing_index_mismatch: %',
        target.index_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$guard$;

CREATE INDEX IF NOT EXISTS admin_tokens_admin_id_full_idx
  ON public.admin_tokens (admin_id);

CREATE INDEX IF NOT EXISTS suspensions_profile_id_full_idx
  ON public.suspensions (profile_id);

CREATE INDEX IF NOT EXISTS reports_reporter_id_idx
  ON public.reports (reporter_id);

COMMIT;
