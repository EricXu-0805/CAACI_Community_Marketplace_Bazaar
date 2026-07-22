-- Read-only verification for
-- 20260722033904_reconcile_legacy_migration_versions.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '2min';

DO $verify$
DECLARE
  items_oid oid := pg_catalog.to_regclass('public.items');
  posts_oid oid := pg_catalog.to_regclass('public.posts');
  post_items_oid oid := pg_catalog.to_regclass('public.post_items');
  item_id_attnum smallint;
  post_id_attnum smallint;
  link_post_attnum smallint;
  link_item_attnum smallint;
  display_order_attnum smallint;
  invalid_count bigint := 0;
  migration_recorded boolean := false;
BEGIN
  IF items_oid IS NULL OR posts_oid IS NULL OR post_items_oid IS NULL THEN
    RAISE EXCEPTION 'verify_failed: canonical application tables missing';
  END IF;

  IF (
       SELECT pg_catalog.count(*) FROM pg_catalog.pg_class AS relation
       WHERE relation.oid IN (items_oid, posts_oid, post_items_oid)
         AND relation.relkind = 'r'
         AND relation.relrowsecurity
     ) <> 3 THEN
    RAISE EXCEPTION 'verify_failed: exposed table or RLS contract missing';
  END IF;

  SELECT attribute.attnum INTO item_id_attnum
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = items_oid AND attribute.attname = 'id'
    AND attribute.attnum > 0 AND NOT attribute.attisdropped
    AND attribute.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype;
  SELECT attribute.attnum INTO post_id_attnum
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = posts_oid AND attribute.attname = 'id'
    AND attribute.attnum > 0 AND NOT attribute.attisdropped
    AND attribute.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype;
  SELECT attribute.attnum INTO link_post_attnum
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = post_items_oid AND attribute.attname = 'post_id'
    AND attribute.attnum > 0 AND NOT attribute.attisdropped
    AND attribute.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype
    AND attribute.attnotnull;
  SELECT attribute.attnum INTO link_item_attnum
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = post_items_oid AND attribute.attname = 'item_id'
    AND attribute.attnum > 0 AND NOT attribute.attisdropped
    AND attribute.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype
    AND attribute.attnotnull;
  SELECT attribute.attnum INTO display_order_attnum
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = post_items_oid AND attribute.attname = 'display_order'
    AND attribute.attnum > 0 AND NOT attribute.attisdropped
    AND attribute.atttypid = 'pg_catalog.int4'::pg_catalog.regtype
    AND attribute.attnotnull;

  IF item_id_attnum IS NULL OR post_id_attnum IS NULL
     OR link_post_attnum IS NULL OR link_item_attnum IS NULL
     OR display_order_attnum IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = post_items_oid
         AND constraint_row.contype = 'p'
         AND constraint_row.convalidated
         AND constraint_row.conkey::smallint[] =
           ARRAY[link_post_attnum, link_item_attnum]::smallint[]
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = post_items_oid
         AND constraint_row.contype = 'f'
         AND constraint_row.convalidated
         AND constraint_row.confrelid = posts_oid
         AND constraint_row.conkey::smallint[] = ARRAY[link_post_attnum]::smallint[]
         AND constraint_row.confkey::smallint[] = ARRAY[post_id_attnum]::smallint[]
         AND constraint_row.confdeltype = 'c'
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = post_items_oid
         AND constraint_row.contype = 'f'
         AND constraint_row.convalidated
         AND constraint_row.confrelid = items_oid
         AND constraint_row.conkey::smallint[] = ARRAY[link_item_attnum]::smallint[]
         AND constraint_row.confkey::smallint[] = ARRAY[item_id_attnum]::smallint[]
         AND constraint_row.confdeltype = 'c'
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = post_items_oid
         AND constraint_row.conname = 'post_items_display_order_check'
         AND constraint_row.contype = 'c'
         AND constraint_row.convalidated
         AND constraint_row.conkey::smallint[] = ARRAY[display_order_attnum]::smallint[]
         AND pg_catalog.pg_get_expr(
           constraint_row.conbin, constraint_row.conrelid
         ) = '(display_order >= 0)'
     ) THEN
    RAISE EXCEPTION 'verify_failed: exact post_items PK/FK/display contract missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_enum AS enum_value
    WHERE enum_value.enumtypid = 'public.item_condition'::pg_catalog.regtype
      AND enum_value.enumlabel = 'defective'
  ) THEN
    RAISE EXCEPTION 'verify_failed: defective item condition missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      (items_oid, 'image_dimensions', 'jsonb', true),
      (posts_oid, 'image_dimensions', 'jsonb', true),
      (items_oid, 'title_i18n', 'jsonb', false),
      (items_oid, 'description_i18n', 'jsonb', false),
      (items_oid, 'source_lang', 'text', false),
      (posts_oid, 'content_i18n', 'jsonb', false),
      (posts_oid, 'source_lang', 'text', false)
    ) AS required(relation_oid, column_name, type_name, not_null)
    LEFT JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = required.relation_oid
     AND attribute.attname = required.column_name
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND attribute.atttypid = pg_catalog.to_regtype(required.type_name)
     AND attribute.attnotnull = required.not_null
    WHERE attribute.attname IS NULL
  ) THEN
    RAISE EXCEPTION 'verify_failed: canonical 014/015 column contract missing';
  END IF;

  IF (SELECT pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid)
      FROM pg_catalog.pg_attrdef AS default_row
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = default_row.adrelid
       AND attribute.attnum = default_row.adnum
      WHERE default_row.adrelid = items_oid
        AND attribute.attname = 'image_dimensions')
       IS DISTINCT FROM '''[]''::jsonb'
     OR (SELECT pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid)
         FROM pg_catalog.pg_attrdef AS default_row
         JOIN pg_catalog.pg_attribute AS attribute
           ON attribute.attrelid = default_row.adrelid
          AND attribute.attnum = default_row.adnum
         WHERE default_row.adrelid = posts_oid
           AND attribute.attname = 'image_dimensions')
       IS DISTINCT FROM '''[]''::jsonb' THEN
    RAISE EXCEPTION 'verify_failed: image_dimensions defaults drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      (items_oid, 'items_image_dimensions_is_array'),
      (posts_oid, 'posts_image_dimensions_is_array'),
      (items_oid, 'items_title_i18n_is_object'),
      (items_oid, 'items_description_i18n_is_object'),
      (items_oid, 'items_source_lang_valid'),
      (posts_oid, 'posts_content_i18n_is_object'),
      (posts_oid, 'posts_source_lang_valid')
    ) AS required(relation_oid, constraint_name)
    LEFT JOIN pg_catalog.pg_constraint AS constraint_row
      ON constraint_row.conrelid = required.relation_oid
     AND constraint_row.conname = required.constraint_name
     AND constraint_row.contype = 'c'
     AND constraint_row.convalidated
    WHERE constraint_row.oid IS NULL
  ) THEN
    RAISE EXCEPTION 'verify_failed: canonical 014/015 validated constraint missing';
  END IF;

  SELECT
    (SELECT pg_catalog.count(*) FROM public.items
      WHERE pg_catalog.jsonb_typeof(image_dimensions) <> 'array')
    + (SELECT pg_catalog.count(*) FROM public.posts
      WHERE pg_catalog.jsonb_typeof(image_dimensions) <> 'array')
    + (SELECT pg_catalog.count(*) FROM public.items
      WHERE title_i18n IS NOT NULL AND pg_catalog.jsonb_typeof(title_i18n) <> 'object')
    + (SELECT pg_catalog.count(*) FROM public.items
      WHERE description_i18n IS NOT NULL AND pg_catalog.jsonb_typeof(description_i18n) <> 'object')
    + (SELECT pg_catalog.count(*) FROM public.posts
      WHERE content_i18n IS NOT NULL AND pg_catalog.jsonb_typeof(content_i18n) <> 'object')
    + (SELECT pg_catalog.count(*) FROM public.items
      WHERE source_lang IS NOT NULL AND source_lang NOT IN ('zh', 'en', 'ja', 'ko', 'zh-Hant'))
    + (SELECT pg_catalog.count(*) FROM public.posts
      WHERE source_lang IS NOT NULL AND source_lang NOT IN ('zh', 'en', 'ja', 'ko', 'zh-Hant'))
  INTO invalid_count;
  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'verify_failed: canonical 014/015 invalid rows %', invalid_count;
  END IF;

  IF EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = posts_oid
         AND attribute.attname = 'attached_item_id'
         AND attribute.attnum > 0 AND NOT attribute.attisdropped
     ) OR pg_catalog.to_regclass('public.idx_posts_attached_item') IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.enforce_post_attached_item_ownership()'
     ) IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
       WHERE trigger_row.tgrelid = posts_oid
         AND trigger_row.tgname = 'trg_post_attached_item_ownership'
         AND NOT trigger_row.tgisinternal
     ) THEN
    RAISE EXCEPTION 'verify_failed: obsolete legacy attachment object remains';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
       WHERE trigger_row.tgrelid = post_items_oid
         AND trigger_row.tgname = 'trg_enforce_post_items_cap'
         AND trigger_row.tgfoid =
           'public.enforce_post_items_cap()'::pg_catalog.regprocedure
         AND trigger_row.tgenabled = 'O'
         AND trigger_row.tgtype = 7
         AND trigger_row.tgnargs = 0
         AND trigger_row.tgattr::text = ''
         AND trigger_row.tgqual IS NULL
         AND trigger_row.tgconstraint = 0
         AND NOT trigger_row.tgdeferrable
         AND NOT trigger_row.tginitdeferred
         AND trigger_row.tgoldtable IS NULL
         AND trigger_row.tgnewtable IS NULL
         AND trigger_row.tgparentid = 0
         AND NOT trigger_row.tgisinternal
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS routine
       WHERE routine.oid =
         'public.enforce_post_items_cap()'::pg_catalog.regprocedure
         AND routine.prosecdef
         AND routine.provolatile = 'v'
         AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
         AND pg_catalog.strpos(routine.prosrc, 'FOR UPDATE') > 0
         AND pg_catalog.strpos(
           routine.prosrc, 'WHERE post.id = NEW.post_id'
         ) > 0
         AND pg_catalog.strpos(routine.prosrc, 'current_count >= 3') > 0
     ) OR EXISTS (
       SELECT 1 FROM (
         SELECT post_item.post_id FROM public.post_items AS post_item
         GROUP BY post_item.post_id HAVING pg_catalog.count(*) > 3
       ) AS over_cap
     ) THEN
    RAISE EXCEPTION 'verify_failed: serialized post_items cap contract drifted';
  END IF;

  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1)'
      INTO migration_recorded USING '20260722033904';
    IF NOT migration_recorded THEN
      RAISE EXCEPTION 'verify_failed: migration ledger lacks 20260722033904';
    END IF;
  END IF;
END;
$verify$;

SELECT
  relation.oid::pg_catalog.regclass AS relation,
  relation.reltuples::bigint AS estimated_rows,
  pg_catalog.pg_total_relation_size(relation.oid) AS total_bytes,
  relation.relrowsecurity AS rls_enabled
FROM pg_catalog.pg_class AS relation
WHERE relation.oid IN (
  'public.items'::pg_catalog.regclass,
  'public.posts'::pg_catalog.regclass,
  'public.post_items'::pg_catalog.regclass
)
ORDER BY relation.oid::pg_catalog.regclass::text;

SELECT
  (SELECT pg_catalog.count(*) FROM public.items) AS item_rows,
  (SELECT pg_catalog.count(*) FROM public.posts) AS post_rows,
  (SELECT pg_catalog.count(*) FROM public.post_items) AS post_item_rows;

ROLLBACK;
