-- ============================================================
-- 014_image_dimensions.sql
--
-- Adds image_dimensions to items and posts (plaza) so the frontend can
-- compute per-image aspect ratios on FIRST paint (zero CLS), without
-- waiting for each image to actually load.
--
-- Shape:
--   image_dimensions jsonb DEFAULT '[]'::jsonb
--
-- Each element is { "w": <natural_width>, "h": <natural_height> } at
-- the SAME index as items.images / posts.images. Missing indices are
-- tolerated by the frontend (it falls back to <image @load>).
--
-- We DO NOT backfill existing rows. The frontend falls back to the
-- onLoad measurement path for any row where this array is shorter than
-- images[], which covers every row that existed before this migration.
--
-- Example row after migration + publish:
--   images:            ['https://…/a.jpg', 'https://…/b.jpg']
--   image_dimensions:  [{"w":1200,"h":1600}, {"w":2400,"h":1800}]
--
-- Rollback: DROP the columns; the app keeps working via onLoad.
-- ============================================================

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS image_dimensions jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS image_dimensions jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN items.image_dimensions IS
  'Per-image natural dimensions, same indexing as images[]. {w,h} in pixels. Empty array allowed; frontend falls back to client-side measurement.';
COMMENT ON COLUMN posts.image_dimensions IS
  'Per-image natural dimensions, same indexing as images[]. {w,h} in pixels. Empty array allowed; frontend falls back to client-side measurement.';

-- Light sanity constraint: must be an array (or empty). This stops a
-- malformed client from writing an object or scalar that would crash
-- array accessors later. Does NOT enforce element shape — keeping the
-- door open for future fields like {w,h,blurhash} without a migration.
ALTER TABLE items
  DROP CONSTRAINT IF EXISTS items_image_dimensions_is_array;
ALTER TABLE items
  ADD CONSTRAINT items_image_dimensions_is_array
  CHECK (jsonb_typeof(image_dimensions) = 'array');

ALTER TABLE posts
  DROP CONSTRAINT IF EXISTS posts_image_dimensions_is_array;
ALTER TABLE posts
  ADD CONSTRAINT posts_image_dimensions_is_array
  CHECK (jsonb_typeof(image_dimensions) = 'array');
