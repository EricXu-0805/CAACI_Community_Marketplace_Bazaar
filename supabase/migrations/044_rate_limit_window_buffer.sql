-- ============================================
-- 044 Rate-limit window boundary buffer
-- ============================================
-- Audit finding (docs/audit/SECURITY_AUDIT.md:535-567, CRITICAL_FIXES.md:228-285):
-- the sliding rate-limit windows use `created_at > NOW() - INTERVAL '1 hour'`
-- with strict `>`. A row created at exactly the window edge is NOT counted
-- (T0 > T0 is false), so an attacker timing posts to the boundary can squeeze
-- out roughly double the intended throughput. The documented fix is to widen
-- each RATE-LIMIT window by 1 second so boundary rows are still counted.
--
-- This migration CREATE OR REPLACEs the six rate-limit trigger functions and
-- only changes the interval literals on the COUNT(*) rate windows:
--     '1 hour'    -> '1 hour 1 second'
--     '24 hours'  -> '24 hours 1 second'
--     '1 minute'  -> '1 minute 1 second'   (messages burst window)
-- The short DEDUPE windows (5s / 30s / 60s) are left untouched — they are
-- duplicate detection, not throughput limits, and were normalized in mig 013.
-- All bodies are otherwise byte-identical to migrations 012 / 013 / 016.
--
-- Idempotent (CREATE OR REPLACE). Triggers themselves are unchanged and are
-- not re-created here (they already point at these function names).
-- ============================================

-- --------------------------------------------
-- items (from 013) — 10/hr, 30/day + 60s dedupe
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.rl_items_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_hour INT;
  last_day  INT;
  dupe      INT;
  norm      TEXT;
BEGIN
  SELECT COUNT(*) INTO last_hour
    FROM public.items
    WHERE user_id = NEW.user_id AND created_at > NOW() - INTERVAL '1 hour 1 second';
  IF last_hour >= 10 THEN
    RAISE EXCEPTION 'rate_limit_items_hour'
      USING HINT = 'You have posted too many items this hour. Try again later.';
  END IF;

  SELECT COUNT(*) INTO last_day
    FROM public.items
    WHERE user_id = NEW.user_id AND created_at > NOW() - INTERVAL '24 hours 1 second';
  IF last_day >= 30 THEN
    RAISE EXCEPTION 'rate_limit_items_day'
      USING HINT = 'You have posted too many items today. Try again tomorrow.';
  END IF;

  norm := LOWER(TRIM(regexp_replace(COALESCE(NEW.title, ''), '\s+', ' ', 'g')));
  SELECT COUNT(*) INTO dupe
    FROM public.items
    WHERE user_id = NEW.user_id
      AND LOWER(TRIM(regexp_replace(COALESCE(title, ''), '\s+', ' ', 'g'))) = norm
      AND created_at > NOW() - INTERVAL '60 seconds';
  IF dupe > 0 THEN
    RAISE EXCEPTION 'duplicate_item'
      USING HINT = 'This item was just posted. Please wait before reposting.';
  END IF;

  RETURN NEW;
END;
$$;

-- --------------------------------------------
-- posts / plaza (from 013) — 10/hr, 30/day + 60s dedupe
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.rl_posts_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_hour INT;
  last_day  INT;
  dupe      INT;
  norm      TEXT;
BEGIN
  IF NEW.is_official THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO last_hour
    FROM public.posts
    WHERE user_id = NEW.user_id AND created_at > NOW() - INTERVAL '1 hour 1 second';
  IF last_hour >= 10 THEN
    RAISE EXCEPTION 'rate_limit_posts_hour'
      USING HINT = 'You have posted too many times this hour. Slow down.';
  END IF;

  SELECT COUNT(*) INTO last_day
    FROM public.posts
    WHERE user_id = NEW.user_id AND created_at > NOW() - INTERVAL '24 hours 1 second';
  IF last_day >= 30 THEN
    RAISE EXCEPTION 'rate_limit_posts_day'
      USING HINT = 'You have posted too many times today. Try again tomorrow.';
  END IF;

  norm := LOWER(TRIM(regexp_replace(COALESCE(NEW.content, ''), '\s+', ' ', 'g')));
  SELECT COUNT(*) INTO dupe
    FROM public.posts
    WHERE user_id = NEW.user_id
      AND LOWER(TRIM(regexp_replace(COALESCE(content, ''), '\s+', ' ', 'g'))) = norm
      AND created_at > NOW() - INTERVAL '60 seconds';
  IF dupe > 0 THEN
    RAISE EXCEPTION 'duplicate_post'
      USING HINT = 'You just posted that. Please wait before reposting.';
  END IF;

  RETURN NEW;
END;
$$;

-- --------------------------------------------
-- post_comments (from 013) — 30/hr, 100/day + 30s dedupe
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.rl_post_comments_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_hour INT;
  last_day  INT;
  dupe      INT;
  norm      TEXT;
BEGIN
  SELECT COUNT(*) INTO last_hour
    FROM public.post_comments
    WHERE user_id = NEW.user_id AND created_at > NOW() - INTERVAL '1 hour 1 second';
  IF last_hour >= 30 THEN
    RAISE EXCEPTION 'rate_limit_comments_hour'
      USING HINT = 'You are commenting too fast. Please wait a minute.';
  END IF;

  SELECT COUNT(*) INTO last_day
    FROM public.post_comments
    WHERE user_id = NEW.user_id AND created_at > NOW() - INTERVAL '24 hours 1 second';
  IF last_day >= 100 THEN
    RAISE EXCEPTION 'rate_limit_comments_day'
      USING HINT = 'Daily comment limit reached. Try again tomorrow.';
  END IF;

  norm := LOWER(TRIM(regexp_replace(COALESCE(NEW.content, ''), '\s+', ' ', 'g')));
  SELECT COUNT(*) INTO dupe
    FROM public.post_comments
    WHERE user_id = NEW.user_id
      AND post_id = NEW.post_id
      AND LOWER(TRIM(regexp_replace(COALESCE(content, ''), '\s+', ' ', 'g'))) = norm
      AND created_at > NOW() - INTERVAL '30 seconds';
  IF dupe > 0 THEN
    RAISE EXCEPTION 'duplicate_comment'
      USING HINT = 'You just wrote that comment. Please wait.';
  END IF;

  RETURN NEW;
END;
$$;

-- --------------------------------------------
-- messages (from 013) — 30/min, 300/hr + 5s dedupe
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.rl_messages_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_min  INT;
  last_hour INT;
  dupe      INT;
  norm      TEXT;
BEGIN
  SELECT COUNT(*) INTO last_min
    FROM public.messages
    WHERE sender_id = NEW.sender_id AND created_at > NOW() - INTERVAL '1 minute 1 second';
  IF last_min >= 30 THEN
    RAISE EXCEPTION 'rate_limit_messages_minute'
      USING HINT = 'Slow down — too many messages in one minute.';
  END IF;

  SELECT COUNT(*) INTO last_hour
    FROM public.messages
    WHERE sender_id = NEW.sender_id AND created_at > NOW() - INTERVAL '1 hour 1 second';
  IF last_hour >= 300 THEN
    RAISE EXCEPTION 'rate_limit_messages_hour'
      USING HINT = 'Hourly message limit reached.';
  END IF;

  norm := LOWER(TRIM(regexp_replace(COALESCE(NEW.content, ''), '\s+', ' ', 'g')));
  SELECT COUNT(*) INTO dupe
    FROM public.messages
    WHERE sender_id = NEW.sender_id
      AND conversation_id = NEW.conversation_id
      AND message_type = NEW.message_type
      AND LOWER(TRIM(regexp_replace(COALESCE(content, ''), '\s+', ' ', 'g'))) = norm
      AND created_at > NOW() - INTERVAL '5 seconds';
  IF dupe > 0 THEN
    RAISE EXCEPTION 'duplicate_message'
      USING HINT = 'Duplicate message blocked.';
  END IF;

  RETURN NEW;
END;
$$;

-- --------------------------------------------
-- reports (from 012) — 10/hr, 30/day (no dedupe)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.rl_reports_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_hour INT;
  last_day INT;
BEGIN
  SELECT COUNT(*) INTO last_hour
    FROM public.reports
    WHERE reporter_id = NEW.reporter_id AND created_at > NOW() - INTERVAL '1 hour 1 second';
  IF last_hour >= 10 THEN
    RAISE EXCEPTION 'rate_limit_reports_hour'
      USING HINT = 'Too many reports in a short time.';
  END IF;

  SELECT COUNT(*) INTO last_day
    FROM public.reports
    WHERE reporter_id = NEW.reporter_id AND created_at > NOW() - INTERVAL '24 hours 1 second';
  IF last_day >= 30 THEN
    RAISE EXCEPTION 'rate_limit_reports_day'
      USING HINT = 'Daily report limit reached.';
  END IF;

  RETURN NEW;
END;
$$;

-- --------------------------------------------
-- follows (from 016) — 30/hr, 100/day (no dedupe)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.rl_follows_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_hour INT;
  last_day INT;
BEGIN
  SELECT COUNT(*) INTO last_hour
    FROM public.follows
    WHERE follower_id = NEW.follower_id AND created_at > NOW() - INTERVAL '1 hour 1 second';
  IF last_hour >= 30 THEN
    RAISE EXCEPTION 'rate_limit_follows_hour'
      USING HINT = 'Following too fast.';
  END IF;
  SELECT COUNT(*) INTO last_day
    FROM public.follows
    WHERE follower_id = NEW.follower_id AND created_at > NOW() - INTERVAL '24 hours 1 second';
  IF last_day >= 100 THEN
    RAISE EXCEPTION 'rate_limit_follows_day'
      USING HINT = 'Daily follow limit reached.';
  END IF;
  RETURN NEW;
END;
$$;

-- --------------------------------------------
-- Verification (run after apply):
--   SELECT proname, prosrc LIKE '%1 hour 1 second%' AS buffered
--     FROM pg_proc
--     WHERE proname IN ('rl_items_before_insert','rl_posts_before_insert',
--       'rl_post_comments_before_insert','rl_messages_before_insert',
--       'rl_reports_before_insert','rl_follows_before_insert');
--   -- every row should show buffered = true
-- --------------------------------------------
