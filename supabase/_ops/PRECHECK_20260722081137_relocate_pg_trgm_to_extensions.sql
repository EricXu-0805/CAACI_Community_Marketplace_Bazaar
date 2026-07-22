-- Read-only preflight for
-- 20260722081137_relocate_pg_trgm_to_extensions.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '2min';

DO $precheck$
DECLARE
  extension_oid oid;
  extension_schema text;
  extension_relocatable boolean;
  extension_owner oid;
  index_name text;
  index_oid oid;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION 'precheck_failed: PostgreSQL 16 or newer is required';
  END IF;

  IF pg_catalog.to_regnamespace('extensions') IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: extensions schema is missing';
  END IF;

  SELECT
    extension.oid,
    namespace.nspname,
    extension.extrelocatable,
    extension.extowner
  INTO
    extension_oid,
    extension_schema,
    extension_relocatable,
    extension_owner
  FROM pg_catalog.pg_extension AS extension
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pg_trgm';

  IF extension_oid IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: pg_trgm is missing';
  END IF;
  IF extension_schema NOT IN ('public', 'extensions') THEN
    RAISE EXCEPTION
      'precheck_failed: pg_trgm is in unsupported schema %', extension_schema;
  END IF;
  IF extension_schema = 'public' AND NOT extension_relocatable THEN
    RAISE EXCEPTION 'precheck_failed: pg_trgm is not relocatable';
  END IF;

  -- Hosted Supabase owns managed extensions as supabase_admin while allowing
  -- the postgres migration role to perform the documented relocatable-extension
  -- operation. Role membership is therefore not a valid capability proxy;
  -- require the target-schema privilege and let ALTER EXTENSION enforce the
  -- managed extension boundary atomically.
  IF NOT pg_catalog.has_schema_privilege(
       current_user, 'extensions', 'CREATE'
     ) THEN
    RAISE EXCEPTION
      'precheck_failed: migration role cannot create in extensions schema';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated')) AS api_role(role_name)
    WHERE pg_catalog.to_regrole(api_role.role_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'precheck_failed: search API role is missing';
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
      'precheck_failed: search API role lacks schema usage';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.search_items_fuzzy(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.search_posts_fuzzy(text[],text,integer,integer)'
     ) IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: trigram search RPC is missing';
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
      'precheck_failed: search API role lacks RPC execute privilege';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.search_items_fuzzy(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean)'),
      ('public.search_posts_fuzzy(text[],text,integer,integer)')
    ) AS expected(signature)
    JOIN pg_catalog.pg_proc AS routine
      ON routine.oid = pg_catalog.to_regprocedure(expected.signature)
    WHERE routine.prosecdef
       OR routine.prokind <> 'f'
       OR NOT pg_catalog.pg_has_role(current_user, routine.proowner, 'USAGE')
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: search RPC invoker/ownership contract drift';
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
    ) THEN
      RAISE EXCEPTION
        'precheck_failed: trigram index % is missing/not ready', index_name;
    END IF;
  END LOOP;
END;
$precheck$;

SELECT
  extension.extname,
  extension.extversion,
  namespace.nspname AS extension_schema,
  extension.extrelocatable,
  pg_catalog.pg_get_userbyid(extension.extowner) AS extension_owner
FROM pg_catalog.pg_extension AS extension
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = extension.extnamespace
WHERE extension.extname = 'pg_trgm';

SELECT
  routine.oid::pg_catalog.regprocedure AS function_signature,
  routine.prosecdef AS security_definer,
  routine.proconfig,
  pg_catalog.pg_get_userbyid(routine.proowner) AS function_owner,
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
  pg_catalog.pg_get_indexdef(index_relation.oid) AS index_definition
FROM pg_catalog.pg_index AS index_row
JOIN pg_catalog.pg_class AS index_relation
  ON index_relation.oid = index_row.indexrelid
WHERE index_relation.oid IN (
  pg_catalog.to_regclass('public.idx_items_description_trgm'),
  pg_catalog.to_regclass('public.idx_items_title_trgm'),
  pg_catalog.to_regclass('public.idx_posts_content_trgm'),
  pg_catalog.to_regclass('public.idx_profiles_nickname_trgm')
)
ORDER BY index_relation.oid::pg_catalog.regclass::text;

ROLLBACK;
