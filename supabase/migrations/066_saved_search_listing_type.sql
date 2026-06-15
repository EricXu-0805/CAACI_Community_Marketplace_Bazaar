-- ============================================
-- 066 Saved-search listing_type filter (QA4 B14)
-- ============================================
-- The saved-search match trigger ignored listing_type, so a buyer's saved
-- "iphone" search fired on WANTED/求购 posts too (and vice versa). Add a
-- discriminator column to saved_searches and a predicate to the match
-- function. Default 'sell' (every existing saved search was a buyer looking
-- to BUY); 'both' preserves the old match-everything behavior on request.
--
-- The function body below is migration 037's verbatim, plus the single
-- listing_type AND line in the `matching` CTE — re-emitted whole because
-- CREATE OR REPLACE replaces the entire definition; do not drop the dedupe /
-- 24h-throttle / ON CONFLICT logic.

ALTER TABLE public.saved_searches
  ADD COLUMN IF NOT EXISTS listing_type text NOT NULL DEFAULT 'sell'
    CHECK (listing_type IN ('sell', 'wanted', 'both'));

CREATE OR REPLACE FUNCTION public.notify_saved_search_matches()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  norm_haystack TEXT;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  norm_haystack := LOWER(COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.description, ''));

  WITH matching AS (
    SELECT ss.id AS ss_id, ss.user_id AS subscriber
    FROM public.saved_searches ss
    WHERE ss.user_id <> NEW.user_id
      AND (ss.last_notified_at IS NULL
           OR ss.last_notified_at < NOW() - INTERVAL '24 hours')
      AND norm_haystack LIKE '%' || LOWER(ss.keyword) || '%'
      AND (ss.category  IS NULL OR ss.category = NEW.category)
      AND (ss.price_min IS NULL OR NEW.price >= ss.price_min)
      AND (ss.price_max IS NULL OR NEW.price <= ss.price_max)
      AND (ss.listing_type = 'both' OR ss.listing_type = NEW.listing_type)
  ),
  unique_subs AS (
    SELECT DISTINCT subscriber FROM matching
  ),
  inserted AS (
    INSERT INTO public.notifications (user_id, type, title, body, item_id)
    SELECT subscriber, 'system', NEW.title, 'saved_search_match', NEW.id
      FROM unique_subs
       ON CONFLICT (user_id, item_id)
          WHERE type = 'system'
            AND body = 'saved_search_match'
            AND item_id IS NOT NULL
          DO NOTHING
    RETURNING user_id
  )
  UPDATE public.saved_searches
     SET last_notified_at = NOW()
   WHERE id IN (SELECT ss_id FROM matching);

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
