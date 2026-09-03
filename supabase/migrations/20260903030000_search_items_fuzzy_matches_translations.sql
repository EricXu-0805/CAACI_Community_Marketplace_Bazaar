-- ============================================
-- 20260903030000 — search_items_fuzzy also matches the translated title/description
-- ============================================
-- A card shows a zh reader localize(title_i18n) — '台灯，暖白色LED' for a listing
-- whose author wrote 'Desk lamp, warm white LED'. Typing the title they can see
-- ('台灯') into search returned nothing, because the function only ever matched
-- items.title and items.description: the author's language. The same happens
-- the other way round for an en reader searching the English they were shown.
--
-- This re-issues the 20260717092804 body (identical to production's
-- pg_get_functiondef on 2026-09-03, pg_trgm in `extensions`) with one change:
-- the haystacks. Every term is now tried against the original title plus
-- title_i18n->>'zh' / ->>'en', and against the original description plus
-- description_i18n->>'zh' / ->>'en', with the same weights the two families
-- already had. Signature, return columns, search_path and volatility are
-- byte-identical, so CREATE OR REPLACE keeps the existing anon/authenticated
-- EXECUTE grants (the client and scripts/deployed-rpc-contract.test.mjs pin
-- the 11-argument form).
--
-- The trigram GIN indexes only cover title/description; the correlated EXISTS
-- over unnest(terms_in) never used them anyway, so no plan gets worse.

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
    AND (location_in IS NULL OR i.location ILIKE '%' || location_in || '%')
    AND (verified_only_in = false OR i.location_verified = true)
  ORDER BY rank DESC, i.created_at DESC
  LIMIT GREATEST(1, LEAST(limit_in, 100))
  OFFSET GREATEST(0, offset_in)
$function$;

NOTIFY pgrst, 'reload schema';

-- Verification (staging, then production, after apply):
--   SELECT id, title, title_i18n->>'zh' FROM public.search_items_fuzzy(ARRAY['台灯']);
--   -- Expect: a listing titled in English whose title_i18n.zh contains 台灯.
--   SELECT pg_get_function_identity_arguments('public.search_items_fuzzy'::regproc);
--   -- Expect: the same 11-argument list as before this migration.
