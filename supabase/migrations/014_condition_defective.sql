-- ============================================
-- 014 Expand item_condition enum — add 'defective'
-- ============================================
-- Standardizes the condition scale to the 5-tier taxonomy used by
-- Xianyu (成新) and Mercari:
--   new        — unopened / unused
--   like_new   — 95%+ new, no visible wear
--   good       — light wear from normal use (default)
--   fair       — clear signs of use, fully functional
--   defective  — has a known defect; seller must disclose
--
-- Only the `defective` value is new; the other four were defined in 001.
-- ============================================

DO $$
BEGIN
  BEGIN
    ALTER TYPE item_condition ADD VALUE IF NOT EXISTS 'defective';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

-- Verification
--   SELECT unnest(enum_range(NULL::item_condition));
-- ============================================

-- =============================================================================
-- Canonical 014 also includes the image-dimension schema formerly published as
-- the colliding 014_image_dimensions.sql. Supabase migration history keys rows
-- by numeric version, so a fresh branch cannot record two version-014 files.
-- The original bytes remain in
-- ../_ops/forensics/legacy-version-collisions/014_image_dimensions.sql.frozen.
-- =============================================================================

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS image_dimensions jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS image_dimensions jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.items.image_dimensions IS
  'Per-image natural dimensions, same indexing as images[]. {w,h} in pixels. Empty array allowed; frontend falls back to client-side measurement.';
COMMENT ON COLUMN public.posts.image_dimensions IS
  'Per-image natural dimensions, same indexing as images[]. {w,h} in pixels. Empty array allowed; frontend falls back to client-side measurement.';

ALTER TABLE public.items
  DROP CONSTRAINT IF EXISTS items_image_dimensions_is_array;
ALTER TABLE public.items
  ADD CONSTRAINT items_image_dimensions_is_array
  CHECK (jsonb_typeof(image_dimensions) = 'array');

ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_image_dimensions_is_array;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_image_dimensions_is_array
  CHECK (jsonb_typeof(image_dimensions) = 'array');
