-- A publisher can select Illini Union / 伊利尼学生中心 without typing UIUC.
-- Match the campus area's bilingual public pickup labels before pagination.
-- This preserves the existing 11-argument RPC, return shape, INVOKER/RLS and
-- grants. It does not infer a person's location or mark GPS as verified.
-- Deploy this before the paired frontend. Other free-text area filters retain
-- their substring behavior. Reapply is safe; no stored listing is rewritten.
-- Registry: app/src/composables/useCampusSpots.ts (safe campus spots only).

DO $migration_precheck$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.search_items_fuzzy(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean)'
     ) IS NULL THEN
    RAISE EXCEPTION 'search_items_fuzzy 11-argument form is missing; apply 20260717092804 first';
  END IF;
END;
$migration_precheck$;

CREATE OR REPLACE FUNCTION public.search_items_fuzzy(
  terms_in         text[],
  category_in      public.item_category  DEFAULT NULL,
  condition_in     public.item_condition DEFAULT NULL,
  price_min_in     numeric               DEFAULT NULL,
  price_max_in     numeric               DEFAULT NULL,
  user_id_in       uuid                  DEFAULT NULL,
  listing_type_in  text                  DEFAULT NULL,
  limit_in         integer               DEFAULT 20,
  offset_in        integer               DEFAULT 0,
  location_in      text                  DEFAULT NULL,
  verified_only_in boolean               DEFAULT false
)
RETURNS TABLE (
  id                uuid,
  user_id           uuid,
  title             text,
  title_i18n        jsonb,
  description_i18n  jsonb,
  source_lang       text,
  price             numeric,
  category          public.item_category,
  condition         public.item_condition,
  status            public.item_status,
  listing_type      text,
  location          text,
  location_verified boolean,
  images            text[],
  image_dimensions  jsonb,
  view_count        integer,
  favorite_count    integer,
  negotiable        boolean,
  created_at        timestamptz,
  profile           jsonb,
  rank              real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, extensions
AS $function$
  SELECT
    i.id,
    i.user_id,
    i.title,
    i.title_i18n,
    i.description_i18n,
    i.source_lang,
    i.price,
    i.category,
    i.condition,
    i.status,
    i.listing_type,
    i.location,
    i.location_verified,
    i.images,
    i.image_dimensions,
    i.view_count,
    i.favorite_count,
    i.negotiable,
    i.created_at,
    pg_catalog.jsonb_build_object(
      'id',                 p.id,
      'nickname',           p.nickname,
      'avatar_url',         p.avatar_url,
      'location',           p.location,
      'is_illini_verified', p.is_illini_verified,
      'status_text',        p.status_text,
      'status_emoji',       p.status_emoji
    ) AS profile,
    (
      SELECT COALESCE(pg_catalog.max(GREATEST(
        similarity(title_text, search_term),
        similarity(description_text, search_term) * 0.6,
        CASE WHEN title_text ILIKE '%' || search_term || '%' THEN 0.4 ELSE 0 END,
        CASE
          WHEN description_text ILIKE '%' || search_term || '%'
            THEN 0.25
          ELSE 0
        END
      )), 0)::real
      FROM pg_catalog.unnest(terms_in) AS search_term
      CROSS JOIN pg_catalog.unnest(ARRAY[
        i.title,
        COALESCE(i.title_i18n->>'zh', ''),
        COALESCE(i.title_i18n->>'en', '')
      ]) AS title_text
      CROSS JOIN pg_catalog.unnest(ARRAY[
        COALESCE(i.description, ''),
        COALESCE(i.description_i18n->>'zh', ''),
        COALESCE(i.description_i18n->>'en', '')
      ]) AS description_text
    ) AS rank
  FROM public.items AS i
  LEFT JOIN public.profiles AS p ON p.id = i.user_id
  WHERE i.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(terms_in) AS search_term
      CROSS JOIN pg_catalog.unnest(ARRAY[
        i.title,
        COALESCE(i.title_i18n->>'zh', ''),
        COALESCE(i.title_i18n->>'en', '')
      ]) AS title_text
      CROSS JOIN pg_catalog.unnest(ARRAY[
        COALESCE(i.description, ''),
        COALESCE(i.description_i18n->>'zh', ''),
        COALESCE(i.description_i18n->>'en', '')
      ]) AS description_text
      WHERE title_text % search_term
         OR description_text % search_term
         OR title_text ILIKE '%' || search_term || '%'
         OR description_text ILIKE '%' || search_term || '%'
    )
    AND (category_in IS NULL OR i.category = category_in)
    AND (condition_in IS NULL OR i.condition = condition_in)
    AND (price_min_in IS NULL OR i.price >= price_min_in)
    AND (price_max_in IS NULL OR i.price <= price_max_in)
    AND (user_id_in IS NULL OR i.user_id = user_id_in)
    AND (listing_type_in IS NULL OR i.listing_type = listing_type_in)
    AND (location_in IS NULL OR EXISTS (
      SELECT 1 FROM pg_catalog.unnest(
        CASE WHEN pg_catalog.lower(pg_catalog.btrim(location_in)) = 'uiuc'
          THEN ARRAY['UIUC', 'Illini Union', '伊利尼学生中心', 'Grainger Library', 'Grainger 图书馆', 'Main Library', '主图书馆', 'UGL', '本科生图书馆', 'Siebel Center', 'Siebel CS 楼', 'ARC Gym', 'ARC 健身房', 'Lincoln Hall', '林肯堂', 'Foellinger Aud.', 'Foellinger 礼堂', 'Ikenberry Commons', '伊肯贝里公共区']
          ELSE ARRAY[pg_catalog.btrim(location_in)]
        END
      ) AS pickup_term
      WHERE i.location ILIKE '%' || pickup_term || '%'
    ))
    AND (verified_only_in = false OR i.location_verified = true)
  ORDER BY rank DESC, i.created_at DESC, i.id DESC
  LIMIT GREATEST(1, LEAST(limit_in, 100))
  OFFSET GREATEST(0, offset_in)
$function$;

NOTIFY pgrst, 'reload schema';

