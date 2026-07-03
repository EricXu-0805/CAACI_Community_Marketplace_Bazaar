-- 086_banner_default_fallback.sql
--
-- QA8 #31: banner scheduling was already honored by banners_live (m023 filters
-- on start_at/end_at), but the admin form never exposed those fields, and once
-- every scheduled promo window closes the carousel goes empty. This adds a
-- "default" flag so an admin can mark one (or more) banners as an always-live
-- fallback: banners_live now returns the scheduled/in-window set, and folds in
-- the default banner(s) ONLY when nothing scheduled is currently live — the
-- plaza never renders an empty banner strip after a promo expires.

ALTER TABLE public.banners
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- Rebuild the view. Output columns are identical to m023 (id, image_url,
-- target_url, title, title_en, title_zh, priority) so the client contract
-- (useBanners) is unchanged; only the row-selection logic gains the fallback.
CREATE OR REPLACE VIEW public.banners_live AS
WITH scheduled AS (
  SELECT id, image_url, target_url, title, title_en, title_zh, priority, created_at
  FROM public.banners
  WHERE active = true
    AND is_default = false
    AND (start_at IS NULL OR start_at <= now())
    AND (end_at   IS NULL OR end_at   >= now())
),
fallback AS (
  -- Default banners ignore the schedule window entirely: they exist to fill an
  -- otherwise-empty carousel, so they are eligible whenever active.
  SELECT id, image_url, target_url, title, title_en, title_zh, priority, created_at
  FROM public.banners
  WHERE active = true
    AND is_default = true
)
SELECT id, image_url, target_url, title, title_en, title_zh, priority
FROM (
  SELECT * FROM scheduled
  UNION ALL
  SELECT * FROM fallback WHERE NOT EXISTS (SELECT 1 FROM scheduled)
) x
ORDER BY priority DESC, created_at DESC
LIMIT 8;

GRANT SELECT ON public.banners_live TO anon, authenticated;

-- Promote the seeded welcome slide (m023) to the built-in default so a fresh
-- install — or a fully-expired promo set — still shows a friendly banner.
UPDATE public.banners
  SET is_default = true
  WHERE id = '00000000-0000-0000-0000-000000000001';
