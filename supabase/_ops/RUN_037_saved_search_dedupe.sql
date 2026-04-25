-- =========================================================
-- RUN 037: saved_search dedupe (Oracle P0 #8)
-- =========================================================
-- Paste this ENTIRE file into Supabase SQL Editor and run ONCE.
--
-- Stops "5 saved searches all match → 5 push notifications" spam by:
--   1. Deleting pre-existing duplicate rows in notifications (keeping
--      the earliest one per user_id, item_id pair)
--   2. Adding a UNIQUE INDEX so concurrent inserts can't sneak past
--   3. Replacing the trigger with a GROUP-BY-subscriber version
--
-- Re-running is safe (CREATE INDEX IF NOT EXISTS, OR REPLACE function).
-- The DELETE step is also idempotent — the second run finds 0
-- duplicates because the index now prevents new ones.
-- =========================================================

BEGIN;

WITH duplicates AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, item_id
           ORDER BY created_at ASC
         ) AS rn
    FROM public.notifications
   WHERE type = 'system'
     AND body = 'saved_search_match'
     AND item_id IS NOT NULL
)
DELETE FROM public.notifications
 WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_saved_search_unique_per_item
  ON public.notifications (user_id, item_id)
  WHERE type = 'system'
    AND body = 'saved_search_match'
    AND item_id IS NOT NULL;

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

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =========================================================
-- Verification:
--   SELECT count(*) FILTER (WHERE rn > 1) AS leftover_duplicates
--     FROM (
--       SELECT row_number() OVER (PARTITION BY user_id, item_id ORDER BY created_at) AS rn
--         FROM public.notifications
--        WHERE type='system' AND body='saved_search_match' AND item_id IS NOT NULL
--     ) sub;
--   -- Expect: 0
--
--   SELECT indexname FROM pg_indexes WHERE indexname='notifications_saved_search_unique_per_item';
--   -- Expect: 1 row
-- =========================================================
