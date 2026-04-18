-- ============================================
-- 019 Items favorite_count denormalized counter
-- ============================================
-- The client (useItems LIST_ITEM_FIELDS, home card "想要" display,
-- useFollow feed projection) was already selecting items.favorite_count
-- but the column never existed in the schema — only the favorites
-- junction table did. Queries silently failed with
--   "column items.favorite_count does not exist"
-- producing empty home feeds.
--
-- Adds the column, backfills from the existing favorites table, and
-- installs an AFTER INSERT/DELETE trigger so the counter stays in
-- sync. Using a cached counter (instead of SELECT COUNT on read) is
-- worth the write-time cost because the home feed re-reads these
-- counts dozens of times per session.
-- ============================================

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS favorite_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_items_favorite_count
  ON public.items(favorite_count DESC)
  WHERE status = 'active';

UPDATE public.items i
SET favorite_count = (
  SELECT COUNT(*) FROM public.favorites f WHERE f.item_id = i.id
);

CREATE OR REPLACE FUNCTION public.maintain_item_favorite_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.items SET favorite_count = favorite_count + 1 WHERE id = NEW.item_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.items SET favorite_count = GREATEST(favorite_count - 1, 0) WHERE id = OLD.item_id;
  END IF;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_maintain_item_favorite_count ON public.favorites;
CREATE TRIGGER trg_maintain_item_favorite_count
  AFTER INSERT OR DELETE ON public.favorites
  FOR EACH ROW EXECUTE FUNCTION public.maintain_item_favorite_count();

-- Verification
--   SELECT id, title, favorite_count FROM public.items ORDER BY favorite_count DESC LIMIT 5;
-- ============================================
