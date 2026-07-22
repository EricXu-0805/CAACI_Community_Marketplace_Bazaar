-- =============================================================================
-- Reconcile the historical 014/015 migration-version collisions.
--
-- Supabase records migration history by numeric version. Historical repositories
-- could therefore apply the SQL from only one file in each colliding pair:
--   014_condition_defective / 014_image_dimensions
--   015_content_i18n      / 015_plaza_item_tag
--
-- The canonical legacy files now contain the schema needed by fresh replay.
-- This forward migration converges already-ledgered databases without depending
-- on which historical filename won. The single-item Plaza attachment introduced
-- by the old 015 variant is intentionally retired: migration 041 replaced it with
-- public.post_items, and this migration only removes any remaining obsolete
-- trigger/function/index/column artifacts after that replacement exists.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

-- Both historical 014 outcomes are required by the current application.
ALTER TYPE public.item_condition ADD VALUE IF NOT EXISTS 'defective';

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS image_dimensions jsonb;
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS image_dimensions jsonb;

UPDATE public.items
   SET image_dimensions = '[]'::jsonb
 WHERE image_dimensions IS NULL;
UPDATE public.posts
   SET image_dimensions = '[]'::jsonb
 WHERE image_dimensions IS NULL;

ALTER TABLE public.items
  ALTER COLUMN image_dimensions SET DEFAULT '[]'::jsonb,
  ALTER COLUMN image_dimensions SET NOT NULL;
ALTER TABLE public.posts
  ALTER COLUMN image_dimensions SET DEFAULT '[]'::jsonb,
  ALTER COLUMN image_dimensions SET NOT NULL;

COMMENT ON COLUMN public.items.image_dimensions IS
  'Per-image natural dimensions, same indexing as images[]. {w,h} in pixels. Empty array allowed; frontend falls back to client-side measurement.';
COMMENT ON COLUMN public.posts.image_dimensions IS
  'Per-image natural dimensions, same indexing as images[]. {w,h} in pixels. Empty array allowed; frontend falls back to client-side measurement.';

ALTER TABLE public.items
  DROP CONSTRAINT IF EXISTS items_image_dimensions_is_array;
ALTER TABLE public.items
  ADD CONSTRAINT items_image_dimensions_is_array
  CHECK (jsonb_typeof(image_dimensions) = 'array') NOT VALID;
ALTER TABLE public.items
  VALIDATE CONSTRAINT items_image_dimensions_is_array;

ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_image_dimensions_is_array;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_image_dimensions_is_array
  CHECK (jsonb_typeof(image_dimensions) = 'array') NOT VALID;
ALTER TABLE public.posts
  VALIDATE CONSTRAINT posts_image_dimensions_is_array;

-- The canonical 015 outcome remains content_i18n; restore it if the obsolete
-- Plaza attachment file was the row historically recorded for version 015.
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS title_i18n jsonb,
  ADD COLUMN IF NOT EXISTS description_i18n jsonb,
  ADD COLUMN IF NOT EXISTS source_lang text;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS content_i18n jsonb,
  ADD COLUMN IF NOT EXISTS source_lang text;

COMMENT ON COLUMN public.items.title_i18n IS
  'Localized titles, keyed by BCP-47 language code. e.g. {"zh":"小米手机","en":"Xiaomi phone"}. NULL until a translation is available. Frontend pattern: title_i18n?.[lang] ?? title.';
COMMENT ON COLUMN public.items.description_i18n IS
  'Localized descriptions, same shape as title_i18n.';
COMMENT ON COLUMN public.items.source_lang IS
  'Language the original title/description were authored in (zh, en, ...). Drives which target languages publish-time auto-translation fills in.';
COMMENT ON COLUMN public.posts.content_i18n IS
  'Localized post content, keyed by BCP-47 language code.';
COMMENT ON COLUMN public.posts.source_lang IS
  'Language the original post content was authored in.';

ALTER TABLE public.items
  DROP CONSTRAINT IF EXISTS items_title_i18n_is_object,
  DROP CONSTRAINT IF EXISTS items_description_i18n_is_object,
  DROP CONSTRAINT IF EXISTS items_source_lang_valid;
ALTER TABLE public.items
  ADD CONSTRAINT items_title_i18n_is_object
    CHECK (title_i18n IS NULL OR jsonb_typeof(title_i18n) = 'object') NOT VALID,
  ADD CONSTRAINT items_description_i18n_is_object
    CHECK (description_i18n IS NULL OR jsonb_typeof(description_i18n) = 'object') NOT VALID,
  ADD CONSTRAINT items_source_lang_valid
    CHECK (source_lang IS NULL OR source_lang IN ('zh', 'en', 'ja', 'ko', 'zh-Hant')) NOT VALID;
ALTER TABLE public.items VALIDATE CONSTRAINT items_title_i18n_is_object;
ALTER TABLE public.items VALIDATE CONSTRAINT items_description_i18n_is_object;
ALTER TABLE public.items VALIDATE CONSTRAINT items_source_lang_valid;

ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_content_i18n_is_object,
  DROP CONSTRAINT IF EXISTS posts_source_lang_valid;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_content_i18n_is_object
    CHECK (content_i18n IS NULL OR jsonb_typeof(content_i18n) = 'object') NOT VALID,
  ADD CONSTRAINT posts_source_lang_valid
    CHECK (source_lang IS NULL OR source_lang IN ('zh', 'en', 'ja', 'ko', 'zh-Hant')) NOT VALID;
ALTER TABLE public.posts VALIDATE CONSTRAINT posts_content_i18n_is_object;
ALTER TABLE public.posts VALIDATE CONSTRAINT posts_source_lang_valid;

-- Fail closed unless migration 041's replacement has the constraints and cap
-- trigger required to preserve every still-live legacy pair. Merely seeing the
-- table is not evidence that historical attached_item_id values were copied.
DO $legacy_plaza_prerequisites$
DECLARE
  items_oid oid := 'public.items'::pg_catalog.regclass;
  posts_oid oid := 'public.posts'::pg_catalog.regclass;
  post_items_oid oid := pg_catalog.to_regclass('public.post_items');
  item_id_attnum smallint;
  post_id_attnum smallint;
  link_post_attnum smallint;
  link_item_attnum smallint;
  display_order_attnum smallint;
BEGIN
  IF post_items_oid IS NULL THEN
    RAISE EXCEPTION
      'legacy migration reconciliation requires public.post_items from migration 041';
  END IF;

  SELECT attribute.attnum INTO item_id_attnum
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = items_oid
    AND attribute.attname = 'id'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype;
  SELECT attribute.attnum INTO post_id_attnum
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = posts_oid
    AND attribute.attname = 'id'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype;
  SELECT attribute.attnum INTO link_post_attnum
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = post_items_oid
    AND attribute.attname = 'post_id'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype
    AND attribute.attnotnull;
  SELECT attribute.attnum INTO link_item_attnum
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = post_items_oid
    AND attribute.attname = 'item_id'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype
    AND attribute.attnotnull;
  SELECT attribute.attnum INTO display_order_attnum
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = post_items_oid
    AND attribute.attname = 'display_order'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.atttypid = 'pg_catalog.int4'::pg_catalog.regtype
    AND attribute.attnotnull;

  IF item_id_attnum IS NULL OR post_id_attnum IS NULL
     OR link_post_attnum IS NULL OR link_item_attnum IS NULL
     OR display_order_attnum IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = post_items_oid
         AND constraint_row.contype = 'p'
         AND constraint_row.convalidated
         AND constraint_row.conkey::smallint[] =
           ARRAY[link_post_attnum, link_item_attnum]::smallint[]
     ) OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = post_items_oid
         AND constraint_row.contype = 'f'
         AND constraint_row.confrelid = posts_oid
         AND constraint_row.convalidated
         AND constraint_row.conkey::smallint[] = ARRAY[link_post_attnum]::smallint[]
         AND constraint_row.confkey::smallint[] = ARRAY[post_id_attnum]::smallint[]
         AND constraint_row.confdeltype = 'c'
     ) OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = post_items_oid
         AND constraint_row.contype = 'f'
         AND constraint_row.confrelid = items_oid
         AND constraint_row.convalidated
         AND constraint_row.conkey::smallint[] = ARRAY[link_item_attnum]::smallint[]
         AND constraint_row.confkey::smallint[] = ARRAY[item_id_attnum]::smallint[]
         AND constraint_row.confdeltype = 'c'
     ) OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS trigger_row
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
     ) THEN
    RAISE EXCEPTION
      'legacy migration reconciliation requires exact post_items PK/FKs, display_order, and cap trigger';
  END IF;
END;
$legacy_plaza_prerequisites$;

-- Reassert the canonical non-negative order contract. A repository that kept
-- the right column but lost only its CHECK can be repaired safely; validation
-- fails and rolls the whole migration back if any existing row is negative.
ALTER TABLE public.post_items
  DROP CONSTRAINT IF EXISTS post_items_display_order_check;
ALTER TABLE public.post_items
  ADD CONSTRAINT post_items_display_order_check
  CHECK (display_order >= 0) NOT VALID;
ALTER TABLE public.post_items
  VALIDATE CONSTRAINT post_items_display_order_check;

-- The historical trigger counted visible rows without serializing inserts.
-- Two transactions starting from two attachments could both observe 2 and
-- commit a fourth row. Lock the immutable parent identity first: concurrent
-- attachments for one post now queue, while different posts remain independent.
CREATE OR REPLACE FUNCTION public.enforce_post_items_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  current_count integer;
BEGIN
  PERFORM post.id
    FROM public.posts AS post
   WHERE post.id = NEW.post_id
   FOR UPDATE;

  SELECT pg_catalog.count(*)::integer
    INTO current_count
    FROM public.post_items AS post_item
   WHERE post_item.post_id = NEW.post_id;

  IF current_count >= 3 THEN
    RAISE EXCEPTION 'post_items_cap_exceeded'
      USING HINT = 'A post may attach at most 3 items.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_post_items_cap()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.enforce_post_items_cap() IS
  'Trigger-only cap-of-three guard; locks the parent post so concurrent attachments for one post serialize.';

-- Keep the legacy source and replacement stable from proof through DROP. The
-- earlier ALTER TABLE statements already fence writes to posts/items; this
-- explicit lock also blocks concurrent post_items inserts/deletes.
LOCK TABLE public.post_items IN SHARE ROW EXCLUSIVE MODE;

DO $migrate_legacy_plaza_attachment$
DECLARE
  legacy_column_present boolean;
  legacy_column_exists boolean;
  invalid_owner_or_fk_count bigint := 0;
  missing_before_count bigint := 0;
  inserted_count bigint := 0;
  missing_after_count bigint := 0;
  over_cap_count bigint := 0;
  display_order_overflow_count bigint := 0;
BEGIN
  SELECT pg_catalog.count(*) INTO over_cap_count
  FROM (
    SELECT post_item.post_id
    FROM public.post_items AS post_item
    GROUP BY post_item.post_id
    HAVING pg_catalog.count(*) > 3
  ) AS over_cap;
  IF over_cap_count <> 0 THEN
    RAISE EXCEPTION
      'post_items already exceeds cap for % posts', over_cap_count
      USING ERRCODE = '23514';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.posts'::pg_catalog.regclass
      AND attribute.attname = 'attached_item_id'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) INTO legacy_column_present;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.posts'::pg_catalog.regclass
      AND attribute.attname = 'attached_item_id'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype
  ) INTO legacy_column_exists;

  IF legacy_column_present AND NOT legacy_column_exists THEN
    RAISE EXCEPTION
      'legacy attached_item_id exists with a non-uuid type'
      USING ERRCODE = '42804';
  END IF;

  IF NOT legacy_column_exists THEN
    RETURN;
  END IF;

  EXECUTE $query$
    SELECT pg_catalog.count(*)
    FROM public.posts AS post
    LEFT JOIN public.items AS item ON item.id = post.attached_item_id
    WHERE post.attached_item_id IS NOT NULL
      AND (item.id IS NULL OR item.user_id IS DISTINCT FROM post.user_id)
  $query$ INTO invalid_owner_or_fk_count;

  IF invalid_owner_or_fk_count <> 0 THEN
    RAISE EXCEPTION
      'legacy attached_item_id has % missing-item or cross-owner rows',
      invalid_owner_or_fk_count USING ERRCODE = '23514';
  END IF;

  EXECUTE $query$
    SELECT pg_catalog.count(*)
    FROM public.posts AS post
    WHERE post.attached_item_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.post_items AS post_item
        WHERE post_item.post_id = post.id
          AND post_item.item_id = post.attached_item_id
      )
  $query$ INTO missing_before_count;

  EXECUTE $query$
    SELECT pg_catalog.count(*)
    FROM public.posts AS post
    WHERE post.attached_item_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.post_items AS post_item
        WHERE post_item.post_id = post.id
          AND post_item.item_id = post.attached_item_id
      )
      AND (
        SELECT pg_catalog.max(existing.display_order)
        FROM public.post_items AS existing
        WHERE existing.post_id = post.id
      ) = 2147483647
  $query$ INTO display_order_overflow_count;

  IF display_order_overflow_count <> 0 THEN
    RAISE EXCEPTION
      'legacy attachment display_order would overflow for % posts',
      display_order_overflow_count USING ERRCODE = '22003';
  END IF;

  EXECUTE $query$
    INSERT INTO public.post_items (post_id, item_id, display_order)
    SELECT
      post.id,
      post.attached_item_id,
      COALESCE((
        SELECT pg_catalog.max(existing.display_order) + 1
        FROM public.post_items AS existing
        WHERE existing.post_id = post.id
      ), 0)
    FROM public.posts AS post
    WHERE post.attached_item_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.post_items AS post_item
        WHERE post_item.post_id = post.id
          AND post_item.item_id = post.attached_item_id
      )
  $query$;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count IS DISTINCT FROM missing_before_count THEN
    RAISE EXCEPTION
      'legacy attachment migration cardinality changed: expected %, inserted %',
      missing_before_count, inserted_count USING ERRCODE = '40001';
  END IF;

  EXECUTE $query$
    SELECT pg_catalog.count(*)
    FROM public.posts AS post
    WHERE post.attached_item_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.post_items AS post_item
        WHERE post_item.post_id = post.id
          AND post_item.item_id = post.attached_item_id
      )
  $query$ INTO missing_after_count;

  IF missing_after_count <> 0 THEN
    RAISE EXCEPTION
      'legacy attachment equivalence proof failed: % pairs remain missing',
      missing_after_count USING ERRCODE = '40001';
  END IF;
END;
$migrate_legacy_plaza_attachment$;

DROP TRIGGER IF EXISTS trg_post_attached_item_ownership ON public.posts;
DROP FUNCTION IF EXISTS public.enforce_post_attached_item_ownership();
DROP INDEX IF EXISTS public.idx_posts_attached_item;
ALTER TABLE public.posts DROP COLUMN IF EXISTS attached_item_id;

COMMIT;
