-- 060_search_items_fuzzy_listing_type.sql — make search respect the
-- sell / wanted toggle (audit round 2, data-edge dimension).
--
-- search_items_fuzzy (038) predates the listing_type column (054) and has no
-- listing_type filter, nor does it return the column. So a search on the 求购
-- (wanted) tab returns a page of mostly-sell rows; the client-side filter in
-- index.vue drops them (treating the absent listing_type as 'sell'), the page
-- looks near-empty, yet hasMore (raw data.length === PAGE_SIZE) stays true —
-- so @scrolltolower keeps re-firing loadMore, walking every matching sell row
-- in pages of 20 with a flickering spinner before a short page ends it.
--
-- Fix: add listing_type_in to filter server-side AND return the listing_type
-- column so the rows the client receives already carry the right type (the
-- client filter then passes them, and hasMore reflects the real count).
-- Adding a parameter changes the signature, so DROP the 8-arg form first to
-- avoid an ambiguous overload (the client calls with named args, so the new
-- 9-arg form with listing_type_in DEFAULT NULL stays backward-compatible —
-- an old 8-named-arg call resolves via the default until the client deploys).

DROP FUNCTION IF EXISTS public.search_items_fuzzy(
  TEXT[], item_category, item_condition, NUMERIC, NUMERIC, UUID, INT, INT
);

CREATE OR REPLACE FUNCTION public.search_items_fuzzy(
  terms_in        TEXT[],
  category_in     item_category   DEFAULT NULL,
  condition_in    item_condition  DEFAULT NULL,
  price_min_in    NUMERIC         DEFAULT NULL,
  price_max_in    NUMERIC         DEFAULT NULL,
  user_id_in      UUID            DEFAULT NULL,
  listing_type_in TEXT            DEFAULT NULL,
  limit_in        INT             DEFAULT 20,
  offset_in       INT             DEFAULT 0
)
RETURNS TABLE (
  id                UUID,
  user_id           UUID,
  title             TEXT,
  title_i18n        JSONB,
  description_i18n  JSONB,
  source_lang       TEXT,
  price             NUMERIC,
  category          item_category,
  condition         item_condition,
  status            item_status,
  listing_type      TEXT,
  location          TEXT,
  location_verified BOOLEAN,
  images            TEXT[],
  image_dimensions  JSONB,
  view_count        INT,
  favorite_count    INT,
  negotiable        BOOLEAN,
  created_at        TIMESTAMPTZ,
  profile           JSONB,
  rank              REAL
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    i.id, i.user_id, i.title, i.title_i18n,
    i.description_i18n, i.source_lang, i.price,
    i.category, i.condition, i.status, i.listing_type,
    i.location, i.location_verified,
    i.images, i.image_dimensions,
    i.view_count, i.favorite_count, i.negotiable,
    i.created_at,
    jsonb_build_object(
      'id',                  p.id,
      'nickname',            p.nickname,
      'avatar_url',          p.avatar_url,
      'location',            p.location,
      'is_illini_verified',  p.is_illini_verified,
      'status_text',         p.status_text,
      'status_emoji',        p.status_emoji
    ) AS profile,
    (
      SELECT COALESCE(MAX(GREATEST(
        similarity(i.title, t),
        similarity(COALESCE(i.description, ''), t) * 0.6,
        CASE WHEN i.title ILIKE '%' || t || '%' THEN 0.4 ELSE 0 END,
        CASE WHEN COALESCE(i.description, '') ILIKE '%' || t || '%' THEN 0.25 ELSE 0 END
      )), 0)::REAL
        FROM unnest(terms_in) t
    ) AS rank
  FROM public.items i
  LEFT JOIN public.profiles p ON p.id = i.user_id
  WHERE i.status = 'active'
    AND EXISTS (
      SELECT 1
        FROM unnest(terms_in) t
       WHERE i.title % t
          OR COALESCE(i.description, '') % t
          OR i.title ILIKE '%' || t || '%'
          OR COALESCE(i.description, '') ILIKE '%' || t || '%'
    )
    AND (category_in    IS NULL OR i.category     = category_in)
    AND (condition_in   IS NULL OR i.condition    = condition_in)
    AND (price_min_in   IS NULL OR i.price        >= price_min_in)
    AND (price_max_in   IS NULL OR i.price        <= price_max_in)
    AND (user_id_in     IS NULL OR i.user_id      = user_id_in)
    AND (listing_type_in IS NULL OR i.listing_type = listing_type_in)
  ORDER BY rank DESC, i.created_at DESC
  LIMIT GREATEST(1, LEAST(limit_in, 100))
  OFFSET GREATEST(0, offset_in)
$$;

REVOKE ALL ON FUNCTION public.search_items_fuzzy(
  TEXT[], item_category, item_condition, NUMERIC, NUMERIC, UUID, TEXT, INT, INT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_items_fuzzy(
  TEXT[], item_category, item_condition, NUMERIC, NUMERIC, UUID, TEXT, INT, INT
) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Verification
--   SELECT id, title, listing_type FROM public.search_items_fuzzy(ARRAY['desk'], NULL, NULL, NULL, NULL, NULL, 'wanted', 5, 0);
--   -- Expect: only listing_type = 'wanted' rows.
