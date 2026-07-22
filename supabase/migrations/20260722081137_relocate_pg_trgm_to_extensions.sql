-- =============================================================================
-- Keep extension-owned objects out of the API-exposed public schema.
--
-- pg_trgm is relocatable, and every existing trigram index depends on its
-- operator classes by OID.  Move the extension in place instead of dropping or
-- recreating it.  The two SQL search RPCs parse extension operators/functions
-- through their fixed search_path, so both paths are reasserted before the
-- extension moves.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $migration_precheck$
DECLARE
  extension_schema text;
  extension_relocatable boolean;
BEGIN
  IF pg_catalog.to_regnamespace('extensions') IS NULL THEN
    RAISE EXCEPTION
      'pg_trgm relocation requires the pre-existing extensions schema';
  END IF;

  SELECT
    namespace.nspname,
    extension.extrelocatable
  INTO
    extension_schema,
    extension_relocatable
  FROM pg_catalog.pg_extension AS extension
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pg_trgm';

  IF extension_schema IS NULL THEN
    RAISE EXCEPTION 'pg_trgm extension is missing';
  END IF;
  IF extension_schema NOT IN ('public', 'extensions') THEN
    RAISE EXCEPTION
      'pg_trgm is installed in unsupported schema %', extension_schema;
  END IF;
  IF extension_schema = 'public' AND NOT extension_relocatable THEN
    RAISE EXCEPTION 'pg_trgm is not relocatable on this database';
  END IF;
  IF NOT pg_catalog.has_schema_privilege(
       current_user, 'extensions', 'CREATE'
     ) THEN
    RAISE EXCEPTION 'migration role cannot create in extensions schema';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated')) AS api_role(role_name)
    WHERE pg_catalog.to_regrole(api_role.role_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'search API role is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated')) AS api_role(role_name)
    WHERE NOT pg_catalog.has_schema_privilege(
         pg_catalog.to_regrole(api_role.role_name),
         pg_catalog.to_regnamespace('public'),
         'USAGE'
       )
       OR NOT pg_catalog.has_schema_privilege(
         pg_catalog.to_regrole(api_role.role_name),
         pg_catalog.to_regnamespace('extensions'),
         'USAGE'
       )
  ) THEN
    RAISE EXCEPTION
      'search API role lacks public/extensions schema usage';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.search_items_fuzzy(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.search_posts_fuzzy(text[],text,integer,integer)'
     ) IS NULL THEN
    RAISE EXCEPTION 'trigram search RPC prerequisite is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated')) AS api_role(role_name)
    CROSS JOIN (VALUES
      ('public.search_items_fuzzy(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean)'),
      ('public.search_posts_fuzzy(text[],text,integer,integer)')
    ) AS expected(signature)
    WHERE NOT pg_catalog.has_function_privilege(
      api_role.role_name,
      pg_catalog.to_regprocedure(expected.signature),
      'EXECUTE'
    )
  ) THEN
    RAISE EXCEPTION 'search API role lacks RPC execute privilege';
  END IF;
END;
$migration_precheck$;

ALTER FUNCTION public.search_items_fuzzy(
  text[],
  public.item_category,
  public.item_condition,
  numeric,
  numeric,
  uuid,
  text,
  integer,
  integer,
  text,
  boolean
) SET search_path = pg_catalog, public, extensions;

ALTER FUNCTION public.search_posts_fuzzy(
  text[],
  text,
  integer,
  integer
) SET search_path = pg_catalog, public, extensions;

DO $relocate_extension$
DECLARE
  extension_schema text;
  index_oids_before oid[];
  index_oids_after oid[];
  invalid_indexes text;
BEGIN
  index_oids_before := ARRAY[
    pg_catalog.to_regclass('public.idx_items_description_trgm')::oid,
    pg_catalog.to_regclass('public.idx_items_title_trgm')::oid,
    pg_catalog.to_regclass('public.idx_posts_content_trgm')::oid,
    pg_catalog.to_regclass('public.idx_profiles_nickname_trgm')::oid
  ];

  IF pg_catalog.array_position(index_oids_before, NULL) IS NOT NULL THEN
    RAISE EXCEPTION
      'pg_trgm relocation requires all four managed trigram indexes';
  END IF;

  SELECT namespace.nspname
  INTO extension_schema
  FROM pg_catalog.pg_extension AS extension
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pg_trgm';

  IF extension_schema = 'public' THEN
    EXECUTE 'ALTER EXTENSION pg_trgm SET SCHEMA extensions';
  ELSIF extension_schema IS DISTINCT FROM 'extensions' THEN
    RAISE EXCEPTION
      'pg_trgm moved to unexpected schema % during migration', extension_schema;
  END IF;

  SELECT namespace.nspname
  INTO extension_schema
  FROM pg_catalog.pg_extension AS extension
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pg_trgm';

  IF extension_schema IS DISTINCT FROM 'extensions' THEN
    RAISE EXCEPTION
      'pg_trgm relocation postcondition failed: schema is %', extension_schema;
  END IF;

  index_oids_after := ARRAY[
    pg_catalog.to_regclass('public.idx_items_description_trgm')::oid,
    pg_catalog.to_regclass('public.idx_items_title_trgm')::oid,
    pg_catalog.to_regclass('public.idx_posts_content_trgm')::oid,
    pg_catalog.to_regclass('public.idx_profiles_nickname_trgm')::oid
  ];

  IF index_oids_after IS DISTINCT FROM index_oids_before THEN
    RAISE EXCEPTION
      'pg_trgm relocation recreated, removed, or renamed a managed trigram index';
  END IF;

  WITH expected(index_name, table_name, column_name) AS (
    VALUES
      ('idx_items_description_trgm', 'items', 'description'),
      ('idx_items_title_trgm', 'items', 'title'),
      ('idx_posts_content_trgm', 'posts', 'content'),
      ('idx_profiles_nickname_trgm', 'profiles', 'nickname')
  ), actual AS (
    SELECT
      expected.*,
      index_relation.oid AS index_oid,
      index_relation.relkind AS index_kind,
      access_method.amname AS access_method,
      index_state.indnkeyatts,
      index_state.indnatts,
      index_state.indisvalid,
      index_state.indisready,
      index_state.indislive,
      index_state.indexprs,
      index_state.indpred,
      table_namespace.nspname AS table_schema,
      table_relation.relname AS actual_table_name,
      indexed_column.attname AS actual_column_name,
      operator_namespace.nspname AS operator_schema,
      operator_class.opcname AS operator_class
    FROM expected
    LEFT JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = pg_catalog.to_regclass(
        'public.' || expected.index_name
      )
    LEFT JOIN pg_catalog.pg_am AS access_method
      ON access_method.oid = index_relation.relam
    LEFT JOIN pg_catalog.pg_index AS index_state
      ON index_state.indexrelid = index_relation.oid
    LEFT JOIN pg_catalog.pg_class AS table_relation
      ON table_relation.oid = index_state.indrelid
     AND table_relation.relname = expected.table_name
    LEFT JOIN pg_catalog.pg_namespace AS table_namespace
      ON table_namespace.oid = table_relation.relnamespace
    LEFT JOIN pg_catalog.pg_attribute AS indexed_column
      ON indexed_column.attrelid = index_state.indrelid
     AND indexed_column.attnum = index_state.indkey[0]
    LEFT JOIN pg_catalog.pg_opclass AS operator_class
      ON operator_class.oid = index_state.indclass[0]
    LEFT JOIN pg_catalog.pg_namespace AS operator_namespace
      ON operator_namespace.oid = operator_class.opcnamespace
  )
  SELECT pg_catalog.string_agg(
    actual.index_name, ', ' ORDER BY actual.index_name
  )
  INTO invalid_indexes
  FROM actual
  WHERE actual.index_oid IS NULL
     OR actual.index_kind IS DISTINCT FROM 'i'::"char"
     OR actual.access_method IS DISTINCT FROM 'gin'
     OR actual.indnkeyatts IS DISTINCT FROM 1
     OR actual.indnatts IS DISTINCT FROM 1
     OR actual.indisvalid IS DISTINCT FROM true
     OR actual.indisready IS DISTINCT FROM true
     OR actual.indislive IS DISTINCT FROM true
     OR actual.indexprs IS NOT NULL
     OR actual.indpred IS NOT NULL
     OR actual.table_schema IS DISTINCT FROM 'public'
     OR actual.actual_table_name IS DISTINCT FROM actual.table_name
     OR actual.actual_column_name IS DISTINCT FROM actual.column_name
     OR actual.operator_schema IS DISTINCT FROM 'extensions'
     OR actual.operator_class IS DISTINCT FROM 'gin_trgm_ops';

  IF invalid_indexes IS NOT NULL THEN
    RAISE EXCEPTION
      'pg_trgm relocation postcondition failed for indexes: %',
      invalid_indexes;
  END IF;
END;
$relocate_extension$;

NOTIFY pgrst, 'reload schema';

COMMIT;
