-- LOCAL/STAGING ONLY — NEVER PRODUCTION.
-- Rollback-only execution regression for
-- 20260722081137_relocate_pg_trgm_to_extensions.sql.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '2min';

DO $extension_contract$
DECLARE
  extension_schema text;
BEGIN
  SELECT namespace.nspname
  INTO extension_schema
  FROM pg_catalog.pg_extension AS extension
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pg_trgm';

  IF extension_schema IS DISTINCT FROM 'extensions' THEN
    RAISE EXCEPTION
      'regression_failed: pg_trgm schema %, expected extensions',
      extension_schema;
  END IF;
END;
$extension_contract$;

-- Execute both SQL-language functions after relocation as each real API role.
-- The impossible term keeps the result set empty while proving schema USAGE,
-- function EXECUTE, similarity and the % operator through the fixed paths.
SET LOCAL ROLE anon;
SELECT pg_catalog.count(*) AS item_search_rows
FROM public.search_items_fuzzy(
  ARRAY['__caaci_pg_trgm_no_match_7f65ad__']::text[],
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  1,
  0,
  NULL,
  false
);

SELECT pg_catalog.count(*) AS post_search_rows
FROM public.search_posts_fuzzy(
  ARRAY['__caaci_pg_trgm_no_match_7f65ad__']::text[],
  'recent',
  1,
  0
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.count(*) AS authenticated_item_search_rows
FROM public.search_items_fuzzy(
  ARRAY['__caaci_pg_trgm_no_match_7f65ad__']::text[],
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  1,
  0,
  NULL,
  false
);

SELECT pg_catalog.count(*) AS authenticated_post_search_rows
FROM public.search_posts_fuzzy(
  ARRAY['__caaci_pg_trgm_no_match_7f65ad__']::text[],
  'recent',
  1,
  0
);
RESET ROLE;

DO $index_contract$
DECLARE
  trigram_opclass_oid oid;
  index_name text;
  index_oid oid;
BEGIN
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
      WHERE index_row.indexrelid = index_oid
        AND index_row.indisvalid
        AND index_row.indisready
        AND trigram_opclass_oid = ANY (index_row.indclass::oid[])
    ) THEN
      RAISE EXCEPTION
        'regression_failed: trigram index % is not usable', index_name;
    END IF;
  END LOOP;
END;
$index_contract$;

ROLLBACK;
