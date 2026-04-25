-- =========================================================
-- RUN 038: search_items_fuzzy RPC (Oracle P1 #18)
-- =========================================================
-- Paste this ENTIRE file into Supabase SQL Editor and run ONCE.
--
-- Replaces the OR-of-ILIKEs home-feed search path with a server-side
-- RPC that uses the gin_trgm_ops indexes from migration 007. Ranks
-- by similarity, returns profile join inline, accepts category /
-- condition / price-range / pagination filters.
--
-- Order of operations matters:
--   1. Apply this migration FIRST (drops the old signature and
--      creates the new one).
--   2. Deploy the new useItems.ts that calls the new signature.
--      Old useItems.ts code (without this migration applied) keeps
--      working — it never called search_items_fuzzy.
--   3. The RPC's WHERE clause uses `column % term`, which Postgres
--      plans through gin_trgm_ops automatically. ANALYZE items if
--      query plans don't pick the indexes after migrating.
--
-- Re-running is a safe no-op (DROP IF EXISTS + CREATE OR REPLACE).
-- =========================================================

BEGIN;

DROP FUNCTION IF EXISTS public.search_items_fuzzy(TEXT, INT);

CREATE OR REPLACE FUNCTION public.search_items_fuzzy(
  terms_in        TEXT[],
  category_in     item_category   DEFAULT NULL,
  condition_in    item_condition  DEFAULT NULL,
  price_min_in    NUMERIC         DEFAULT NULL,
  price_max_in    NUMERIC         DEFAULT NULL,
  user_id_in      UUID            DEFAULT NULL,
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
    i.category, i.condition, i.status,
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
    AND (category_in    IS NULL OR i.category   = category_in)
    AND (condition_in   IS NULL OR i.condition  = condition_in)
    AND (price_min_in   IS NULL OR i.price     >= price_min_in)
    AND (price_max_in   IS NULL OR i.price     <= price_max_in)
    AND (user_id_in     IS NULL OR i.user_id    = user_id_in)
  ORDER BY rank DESC, i.created_at DESC
  LIMIT GREATEST(1, LEAST(limit_in, 100))
  OFFSET GREATEST(0, offset_in)
$$;

REVOKE ALL ON FUNCTION public.search_items_fuzzy(
  TEXT[], item_category, item_condition, NUMERIC, NUMERIC, UUID, INT, INT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_items_fuzzy(
  TEXT[], item_category, item_condition, NUMERIC, NUMERIC, UUID, INT, INT
) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =========================================================
-- Verification:
--   SELECT id, title, rank
--     FROM public.search_items_fuzzy(ARRAY['desk'], NULL, NULL, NULL, NULL, NULL, 5, 0);
--   -- Expect: rows ranked by similarity to "desk".
--
--   EXPLAIN ANALYZE SELECT id FROM public.search_items_fuzzy(
--     ARRAY['desk'], NULL, NULL, NULL, NULL, NULL, 20, 0
--   );
--   -- Expect: BitmapIndexScan on idx_items_title_trgm and/or
--   -- idx_items_description_trgm somewhere in the plan.
-- =========================================================
