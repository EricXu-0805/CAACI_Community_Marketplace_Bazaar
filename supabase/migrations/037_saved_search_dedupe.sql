-- ============================================
-- 037 saved_search dedupe — at most one notification per (subscriber, item)
-- ============================================
--
-- Background
-- ----------
-- Migration 017 wired up the saved-search match fan-out: when a new
-- item lands, every saved_search whose keyword + category + price
-- matches the item triggers an INSERT into notifications for that
-- search's subscriber. The 24h `last_notified_at` throttle prevented
-- the *same search* firing twice in 24h, but did NOT prevent the
-- *same subscriber* getting multiple notifications for the same item
-- — they simply needed multiple matching saved_searches to receive a
-- notification per search.
--
-- The bug surfaced in production: a power user with 5 overlapping
-- saved_searches ("textbook", "econ 101", "books under 50", "graduation
-- sale", "cheap furniture") got 5 push notifications when one item
-- happened to match all five queries. Notification spam is a
-- significant retention risk on mp-weixin where unread badges bring
-- users back daily.
--
-- The fix
-- -------
-- Insert at most ONE notification per (subscriber, item) by aggregating
-- the matching saved_searches with GROUP BY subscriber. The
-- last_notified_at update still iterates every matching search, so the
-- 24h per-search throttle is preserved (a user with 5 saved searches
-- on the same hot keyword still gets all 5 throttled by their own
-- last_notified_at clocks).
--
-- We also add a unique partial index on
-- notifications (user_id, item_id, type) WHERE body = 'saved_search_match'
-- as a database-level safety net: even if two concurrent INSERTs slip
-- past the GROUP BY (e.g. two items inserted in rapid succession both
-- matching the same saved_search), the unique index degrades the
-- duplicate INSERT to a no-op via ON CONFLICT DO NOTHING in the
-- trigger.
--
-- We deliberately DO NOT collapse all 24h matches per subscriber into
-- a single rolled-up notification ("3 new items match your saved
-- searches") — that's a richer UX and would need new notification
-- shape + a Notification.fan_out_summary table. Out of scope here.
--
-- Rollback
-- --------
-- Run migration 017's CREATE OR REPLACE FUNCTION block to restore the
-- pre-037 trigger body. Drop the unique index manually:
--   DROP INDEX IF EXISTS notifications_saved_search_unique_per_item;
-- ============================================

-- ---------- Database-level safety net ----------
-- One notification per (user, item, type='system' with body='saved_search_match').
-- Partial index keeps the constraint scoped to the saved_search_match
-- subset; other notification types (offer, message, sold) are unaffected.
--
-- WARNING: the existing notifications table may already have duplicate
-- rows from before this migration. The CREATE UNIQUE INDEX would fail
-- on those. We delete the pre-existing duplicates first, keeping the
-- earliest one per (user, item) — that's the row the user has likely
-- already seen / dismissed.
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

-- ---------- Trigger function: GROUP BY subscriber ----------
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

NOTIFY pgrst, 'reload schema';

-- Verification
--   -- Insert a fake item touching multiple of your own saved_searches.
--   -- Confirm only ONE notification row appears for your user.
--   SELECT count(*) FROM public.notifications
--    WHERE user_id = auth.uid() AND item_id = '<the_test_item_id>';
--   -- Expect: 1
-- ============================================
