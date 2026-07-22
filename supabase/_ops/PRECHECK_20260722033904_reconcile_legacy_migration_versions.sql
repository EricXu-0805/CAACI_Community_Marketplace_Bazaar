-- Read-only preflight for
-- 20260722033904_reconcile_legacy_migration_versions.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '2min';

DO $precheck$
DECLARE
  items_oid oid := pg_catalog.to_regclass('public.items');
  posts_oid oid := pg_catalog.to_regclass('public.posts');
  post_items_oid oid := pg_catalog.to_regclass('public.post_items');
  cap_function_oid oid := pg_catalog.to_regprocedure('public.enforce_post_items_cap()');
  legacy_function_oid oid := pg_catalog.to_regprocedure(
    'public.enforce_post_attached_item_ownership()'
  );
  item_id_attnum smallint;
  post_id_attnum smallint;
  link_post_attnum smallint;
  link_item_attnum smallint;
  display_order_attnum smallint;
  invalid_count bigint := 0;
  legacy_count bigint := 0;
  missing_pair_count bigint := 0;
  migration_recorded boolean := false;
  current_role_is_superuser boolean := false;
BEGIN
  IF items_oid IS NULL OR posts_oid IS NULL OR post_items_oid IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: items/posts/post_items prerequisite missing';
  END IF;

  IF (
       SELECT pg_catalog.count(*) FROM pg_catalog.pg_class AS relation
       WHERE relation.oid IN (items_oid, posts_oid, post_items_oid)
         AND relation.relkind = 'r'
         AND relation.relrowsecurity
     ) <> 3 THEN
    RAISE EXCEPTION 'precheck_failed: exposed table or RLS contract missing';
  END IF;

  SELECT role_row.rolsuper INTO current_role_is_superuser
  FROM pg_catalog.pg_roles AS role_row
  WHERE role_row.oid = current_user::pg_catalog.regrole;

  IF pg_catalog.to_regtype('public.item_condition') IS NULL
     OR cap_function_oid IS NULL
     OR NOT pg_catalog.has_table_privilege(current_user, items_oid, 'SELECT')
     OR NOT pg_catalog.has_table_privilege(current_user, items_oid, 'UPDATE')
     OR NOT pg_catalog.has_table_privilege(current_user, posts_oid, 'SELECT')
     OR NOT pg_catalog.has_table_privilege(current_user, posts_oid, 'UPDATE')
     OR NOT pg_catalog.has_table_privilege(current_user, post_items_oid, 'SELECT')
     OR NOT pg_catalog.has_table_privilege(current_user, post_items_oid, 'INSERT') THEN
    RAISE EXCEPTION 'precheck_failed: migration type or table privileges missing';
  END IF;

  -- This migration performs ALTER TYPE/TABLE, replaces and revokes a trigger
  -- function, and may drop the obsolete ownership function. DML privileges are
  -- not a proxy for those owner-only operations: a comma-separated privilege
  -- string is an ANY check in PostgreSQL and can otherwise make preflight green
  -- for a role that cannot execute the migration.
  IF NOT current_role_is_superuser AND (
       NOT pg_catalog.pg_has_role(
         current_user,
         (SELECT type_row.typowner FROM pg_catalog.pg_type AS type_row
          WHERE type_row.oid = 'public.item_condition'::pg_catalog.regtype),
         'USAGE'
       )
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.pg_class AS relation
         WHERE relation.oid IN (items_oid, posts_oid, post_items_oid)
           AND NOT pg_catalog.pg_has_role(current_user, relation.relowner, 'USAGE')
       )
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc AS routine
         WHERE routine.oid IN (cap_function_oid, legacy_function_oid)
           AND NOT pg_catalog.pg_has_role(current_user, routine.proowner, 'USAGE')
       )
     ) THEN
    RAISE EXCEPTION 'precheck_failed: migration object ownership missing';
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
       SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
       WHERE trigger_row.tgrelid = post_items_oid
         AND trigger_row.tgname = 'trg_enforce_post_items_cap'
         AND trigger_row.tgfoid = cap_function_oid
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
     ) THEN
    RAISE EXCEPTION 'precheck_failed: exact post_items PK/FK/display/cap prerequisite missing';
  END IF;

  SELECT pg_catalog.count(*) INTO invalid_count
  FROM public.post_items AS post_item
  WHERE post_item.display_order < 0;
  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'precheck_failed: negative post_items.display_order rows %', invalid_count;
  END IF;

  SELECT pg_catalog.count(*) INTO invalid_count
  FROM (
    SELECT post_item.post_id
    FROM public.post_items AS post_item
    GROUP BY post_item.post_id
    HAVING pg_catalog.count(*) > 3
  ) AS over_cap;
  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'precheck_failed: post_items already exceeds cap for % posts', invalid_count;
  END IF;

  -- Existing non-NULL values must already satisfy the target constraints. NULL
  -- image dimensions are intentionally accepted and counted for migration.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = items_oid AND attname = 'image_dimensions' AND attnum > 0 AND NOT attisdropped) THEN
    SELECT pg_catalog.count(*) INTO invalid_count FROM public.items
    WHERE image_dimensions IS NOT NULL AND pg_catalog.jsonb_typeof(image_dimensions) <> 'array';
    IF invalid_count <> 0 THEN RAISE EXCEPTION 'precheck_failed: invalid items.image_dimensions rows %', invalid_count; END IF;
    SELECT pg_catalog.count(*) INTO invalid_count FROM public.items WHERE image_dimensions IS NULL;
    RAISE NOTICE 'items.image_dimensions NULL rows %', invalid_count;
  ELSE
    RAISE NOTICE 'items.image_dimensions is absent and will require a full backfill';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = posts_oid AND attname = 'image_dimensions' AND attnum > 0 AND NOT attisdropped) THEN
    SELECT pg_catalog.count(*) INTO invalid_count FROM public.posts
    WHERE image_dimensions IS NOT NULL AND pg_catalog.jsonb_typeof(image_dimensions) <> 'array';
    IF invalid_count <> 0 THEN RAISE EXCEPTION 'precheck_failed: invalid posts.image_dimensions rows %', invalid_count; END IF;
    SELECT pg_catalog.count(*) INTO invalid_count FROM public.posts WHERE image_dimensions IS NULL;
    RAISE NOTICE 'posts.image_dimensions NULL rows %', invalid_count;
  ELSE
    RAISE NOTICE 'posts.image_dimensions is absent and will require a full backfill';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = items_oid AND attname = 'title_i18n' AND attnum > 0 AND NOT attisdropped) THEN
    SELECT pg_catalog.count(*) INTO invalid_count FROM public.items
    WHERE title_i18n IS NOT NULL AND pg_catalog.jsonb_typeof(title_i18n) <> 'object';
    IF invalid_count <> 0 THEN RAISE EXCEPTION 'precheck_failed: invalid items.title_i18n rows %', invalid_count; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = items_oid AND attname = 'description_i18n' AND attnum > 0 AND NOT attisdropped) THEN
    SELECT pg_catalog.count(*) INTO invalid_count FROM public.items
    WHERE description_i18n IS NOT NULL AND pg_catalog.jsonb_typeof(description_i18n) <> 'object';
    IF invalid_count <> 0 THEN RAISE EXCEPTION 'precheck_failed: invalid items.description_i18n rows %', invalid_count; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = posts_oid AND attname = 'content_i18n' AND attnum > 0 AND NOT attisdropped) THEN
    SELECT pg_catalog.count(*) INTO invalid_count FROM public.posts
    WHERE content_i18n IS NOT NULL AND pg_catalog.jsonb_typeof(content_i18n) <> 'object';
    IF invalid_count <> 0 THEN RAISE EXCEPTION 'precheck_failed: invalid posts.content_i18n rows %', invalid_count; END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = items_oid AND attname = 'source_lang' AND attnum > 0 AND NOT attisdropped) THEN
    SELECT pg_catalog.count(*) INTO invalid_count FROM public.items
    WHERE source_lang IS NOT NULL AND source_lang NOT IN ('zh', 'en', 'ja', 'ko', 'zh-Hant');
    IF invalid_count <> 0 THEN RAISE EXCEPTION 'precheck_failed: invalid items.source_lang rows %', invalid_count; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = posts_oid AND attname = 'source_lang' AND attnum > 0 AND NOT attisdropped) THEN
    SELECT pg_catalog.count(*) INTO invalid_count FROM public.posts
    WHERE source_lang IS NOT NULL AND source_lang NOT IN ('zh', 'en', 'ja', 'ko', 'zh-Hant');
    IF invalid_count <> 0 THEN RAISE EXCEPTION 'precheck_failed: invalid posts.source_lang rows %', invalid_count; END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = posts_oid AND attribute.attname = 'attached_item_id'
      AND attribute.attnum > 0 AND NOT attribute.attisdropped
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = posts_oid AND attribute.attname = 'attached_item_id'
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
        AND attribute.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype
    ) THEN
      RAISE EXCEPTION 'precheck_failed: legacy attached_item_id is not uuid';
    END IF;

    EXECUTE 'SELECT count(*) FROM public.posts WHERE attached_item_id IS NOT NULL'
      INTO legacy_count;
    EXECUTE $query$
      SELECT pg_catalog.count(*) FROM public.posts AS post
      LEFT JOIN public.items AS item ON item.id = post.attached_item_id
      WHERE post.attached_item_id IS NOT NULL
        AND (item.id IS NULL OR item.user_id IS DISTINCT FROM post.user_id)
    $query$ INTO invalid_count;
    IF invalid_count <> 0 THEN
      RAISE EXCEPTION 'precheck_failed: legacy missing-item/cross-owner rows %', invalid_count;
    END IF;

    EXECUTE $query$
      SELECT pg_catalog.count(*) FROM public.posts AS post
      WHERE post.attached_item_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.post_items AS post_item
          WHERE post_item.post_id = post.id
            AND post_item.item_id = post.attached_item_id
        )
    $query$ INTO missing_pair_count;

    EXECUTE $query$
      SELECT pg_catalog.count(*) FROM public.posts AS post
      WHERE post.attached_item_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.post_items AS pair
          WHERE pair.post_id = post.id AND pair.item_id = post.attached_item_id
        )
        AND (SELECT pg_catalog.count(*) FROM public.post_items AS existing
             WHERE existing.post_id = post.id) >= 3
    $query$ INTO invalid_count;
    IF invalid_count <> 0 THEN
      RAISE EXCEPTION 'precheck_failed: % legacy pairs would violate cap', invalid_count;
    END IF;

    EXECUTE $query$
      SELECT pg_catalog.count(*) FROM public.posts AS post
      WHERE post.attached_item_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.post_items AS pair
          WHERE pair.post_id = post.id AND pair.item_id = post.attached_item_id
        )
        AND (SELECT pg_catalog.max(existing.display_order)
             FROM public.post_items AS existing
             WHERE existing.post_id = post.id) = 2147483647
    $query$ INTO invalid_count;
    IF invalid_count <> 0 THEN
      RAISE EXCEPTION 'precheck_failed: % legacy pairs would overflow display_order', invalid_count;
    END IF;
    RAISE NOTICE 'legacy attachment rows %, missing replacement pairs %', legacy_count, missing_pair_count;
  END IF;

  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1)'
      INTO migration_recorded USING '20260722033904';
    IF migration_recorded THEN
      RAISE EXCEPTION 'precheck_failed: migration ledger already contains 20260722033904';
    END IF;
  END IF;
END;
$precheck$;

SELECT
  relation.oid::pg_catalog.regclass AS relation,
  relation.reltuples::bigint AS estimated_rows,
  pg_catalog.pg_total_relation_size(relation.oid) AS total_bytes
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
