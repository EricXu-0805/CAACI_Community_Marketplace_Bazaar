-- Listing reminders must obey the same block/visibility boundary as the feed.
-- A later block also hides historical listing reminders at the SELECT boundary.
-- No notification columns or client grants change.
BEGIN;

CREATE OR REPLACE FUNCTION public.notify_followers_on_new_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.status <> 'active' OR EXISTS (
    SELECT 1 FROM moderation_private.current_profile_state(NEW.user_id) s
    WHERE s.shadow_banned
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, item_id)
  SELECT f.follower_id, 'system', NEW.title, 'new_listing_from_followee', NEW.id
  FROM public.follows f
  WHERE f.followee_id = NEW.user_id
    AND f.follower_id <> NEW.user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = f.follower_id AND b.blocked_id = NEW.user_id)
         OR (b.blocker_id = NEW.user_id AND b.blocked_id = f.follower_id)
    );
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.notify_saved_search_matches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  norm_haystack text;
BEGIN
  IF NEW.status <> 'active' OR EXISTS (
    SELECT 1 FROM moderation_private.current_profile_state(NEW.user_id) s
    WHERE s.shadow_banned
  ) THEN
    RETURN NEW;
  END IF;
  norm_haystack := lower(COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.description, ''));

  -- Lock in a consistent order before inserting any notification. Previously
  -- two publishers both read last_notified_at=NULL, both notified, then raced
  -- to update the throttle. The second locker rechecks eligibility after the
  -- first commits; a rolled-back first publisher cannot lose the second event.
  WITH matching AS MATERIALIZED (
    SELECT ss.id
    FROM public.saved_searches ss
    WHERE ss.user_id <> NEW.user_id
      AND (ss.last_notified_at IS NULL OR ss.last_notified_at < statement_timestamp() - INTERVAL '24 hours')
      AND strpos(norm_haystack, lower(ss.keyword)) > 0
      AND (ss.category IS NULL OR ss.category = NEW.category)
      AND (ss.price_min IS NULL OR NEW.price >= ss.price_min)
      AND (ss.price_max IS NULL OR NEW.price <= ss.price_max)
      AND (ss.listing_type = 'both' OR ss.listing_type = NEW.listing_type)
      AND NOT EXISTS (
        SELECT 1 FROM public.blocks b
        WHERE (b.blocker_id = ss.user_id AND b.blocked_id = NEW.user_id)
           OR (b.blocker_id = NEW.user_id AND b.blocked_id = ss.user_id)
      )
    ORDER BY ss.id
    FOR UPDATE OF ss
  ), claimed AS (
    UPDATE public.saved_searches ss
    SET last_notified_at = statement_timestamp()
    FROM matching m
    WHERE ss.id = m.id
      AND (ss.last_notified_at IS NULL OR ss.last_notified_at < statement_timestamp() - INTERVAL '24 hours')
    RETURNING ss.user_id
  )
  INSERT INTO public.notifications (user_id, type, title, body, item_id)
  SELECT DISTINCT user_id, 'system', NEW.title, 'saved_search_match', NEW.id
  FROM claimed
  ON CONFLICT (user_id, item_id)
    WHERE type = 'system' AND body = 'saved_search_match' AND item_id IS NOT NULL
    DO NOTHING;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.notify_followers_on_new_item()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_saved_search_matches()
  FROM PUBLIC, anon, authenticated, service_role;

-- Restrictive: retains the existing recipient-only policy. The item read uses
-- the caller's existing RLS (including both block directions and suspension
-- expiry). Deleted/missing items cannot leak their title through a reminder.
DROP POLICY IF EXISTS "Listing notifications require visible items" ON public.notifications;
CREATE POLICY "Listing notifications require visible items"
  ON public.notifications AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    CASE WHEN item_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.items i
      WHERE i.id = notifications.item_id AND i.status <> 'deleted'
    ) ELSE body NOT IN ('new_listing_from_followee', 'saved_search_match') END
  );

COMMIT;
