-- Read-only verification for
-- 20260722081137_relocate_pg_trgm_to_extensions.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '2min';

DO $verify$
DECLARE
  extension_oid oid;
  extension_schema text;
  trigram_opclass_oid oid;
  index_name text;
  index_oid oid;
BEGIN
  SELECT extension.oid, namespace.nspname
  INTO extension_oid, extension_schema
  FROM pg_catalog.pg_extension AS extension
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pg_trgm';

  IF extension_oid IS NULL OR extension_schema IS DISTINCT FROM 'extensions' THEN
    RAISE EXCEPTION
      'verify_failed: pg_trgm schema %, expected extensions', extension_schema;
  END IF;

  SELECT opclass.oid
  INTO trigram_opclass_oid
  FROM pg_catalog.pg_opclass AS opclass
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = opclass.opcnamespace
  JOIN pg_catalog.pg_am AS access_method
    ON access_method.oid = opclass.opcmethod
  WHERE namespace.nspname = 'extensions'
    AND opclass.opcname = 'gin_trgm_ops'
    AND access_method.amname = 'gin';

  IF trigram_opclass_oid IS NULL THEN
    RAISE EXCEPTION 'verify_failed: extensions.gin_trgm_ops is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated')) AS api_role(role_name)
    WHERE pg_catalog.to_regrole(api_role.role_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'verify_failed: search API role is missing';
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
      'verify_failed: search API role lacks schema usage';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.search_items_fuzzy(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean)'),
      ('public.search_posts_fuzzy(text[],text,integer,integer)')
    ) AS expected(signature)
    LEFT JOIN pg_catalog.pg_proc AS routine
      ON routine.oid = pg_catalog.to_regprocedure(expected.signature)
    WHERE routine.oid IS NULL
       OR routine.prokind <> 'f'
       OR routine.prosecdef
       OR routine.proconfig IS DISTINCT FROM
          ARRAY['search_path=pg_catalog, public, extensions']::text[]
  ) THEN
    RAISE EXCEPTION
      'verify_failed: exact search RPC invoker/search_path contract drift';
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
    RAISE EXCEPTION
      'verify_failed: search API role lacks RPC execute privilege';
  END IF;

  FOREACH index_name IN ARRAY ARRAY[
    'idx_items_description_trgm',
    'idx_items_title_trgm',
    'idx_posts_content_trgm',
    'idx_profiles_nickname_trgm'
  ]
  LOOP
    index_oid := pg_catalog.to_regclass('public.' || index_name);
    IF index_oid IS NULL OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index AS index_row
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_row.indexrelid
      JOIN pg_catalog.pg_am AS access_method
        ON access_method.oid = index_relation.relam
      WHERE index_row.indexrelid = index_oid
        AND index_row.indisvalid
        AND index_row.indisready
        AND access_method.amname = 'gin'
        AND trigram_opclass_oid = ANY (index_row.indclass::oid[])
    ) THEN
      RAISE EXCEPTION
        'verify_failed: trigram index % lost its ready GIN opclass', index_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_depend AS dependency
    JOIN pg_catalog.pg_proc AS routine
      ON dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
     AND routine.oid = dependency.objid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE dependency.refclassid =
            'pg_catalog.pg_extension'::pg_catalog.regclass
      AND dependency.refobjid = extension_oid
      AND dependency.deptype = 'e'
      AND namespace.nspname = 'public'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_depend AS dependency
    JOIN pg_catalog.pg_operator AS operator_row
      ON dependency.classid = 'pg_catalog.pg_operator'::pg_catalog.regclass
     AND operator_row.oid = dependency.objid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = operator_row.oprnamespace
    WHERE dependency.refclassid =
            'pg_catalog.pg_extension'::pg_catalog.regclass
      AND dependency.refobjid = extension_oid
      AND dependency.deptype = 'e'
      AND namespace.nspname = 'public'
  ) THEN
    RAISE EXCEPTION
      'verify_failed: pg_trgm function/operator member remains in public';
  END IF;
END;
$verify$;

SELECT
  extension.extname,
  extension.extversion,
  namespace.nspname AS extension_schema,
  extension.extrelocatable
FROM pg_catalog.pg_extension AS extension
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = extension.extnamespace
WHERE extension.extname = 'pg_trgm';

SELECT
  routine.oid::pg_catalog.regprocedure AS function_signature,
  routine.prosecdef AS security_definer,
  routine.proconfig,
  pg_catalog.has_function_privilege(
    'anon', routine.oid, 'EXECUTE'
  ) AS anon_execute,
  pg_catalog.has_function_privilege(
    'authenticated', routine.oid, 'EXECUTE'
  ) AS authenticated_execute
FROM pg_catalog.pg_proc AS routine
WHERE routine.oid IN (
  pg_catalog.to_regprocedure(
    'public.search_items_fuzzy(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean)'
  ),
  pg_catalog.to_regprocedure(
    'public.search_posts_fuzzy(text[],text,integer,integer)'
  )
)
ORDER BY routine.oid::pg_catalog.regprocedure::text;

SELECT
  index_relation.oid::pg_catalog.regclass AS index_name,
  index_row.indisvalid,
  index_row.indisready,
  opclass_namespace.nspname AS opclass_schema,
  opclass.opcname
FROM pg_catalog.pg_index AS index_row
JOIN pg_catalog.pg_class AS index_relation
  ON index_relation.oid = index_row.indexrelid
CROSS JOIN LATERAL pg_catalog.unnest(index_row.indclass::oid[]) AS class_oid
JOIN pg_catalog.pg_opclass AS opclass ON opclass.oid = class_oid
JOIN pg_catalog.pg_namespace AS opclass_namespace
  ON opclass_namespace.oid = opclass.opcnamespace
WHERE index_relation.oid IN (
  pg_catalog.to_regclass('public.idx_items_description_trgm'),
  pg_catalog.to_regclass('public.idx_items_title_trgm'),
  pg_catalog.to_regclass('public.idx_posts_content_trgm'),
  pg_catalog.to_regclass('public.idx_profiles_nickname_trgm')
)
ORDER BY index_relation.oid::pg_catalog.regclass::text, opclass.opcname;

ROLLBACK;
