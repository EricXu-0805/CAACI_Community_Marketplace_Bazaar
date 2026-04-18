-- ============================================
-- 012 Rate limiting + duplicate content guards
-- ============================================
-- Adversarial scenario: attacker runs a script firing 100x INSERT
-- per second against /rest/v1/posts (or items / messages / comments
-- / reports). RLS WITH CHECK accepts all of them because user_id
-- matches auth.uid(). Without rate limiting the DB fills up.
--
-- This migration adds BEFORE INSERT triggers that count recent
-- inserts per user_id and RAISE EXCEPTION when thresholds are
-- exceeded. Also adds short-window duplicate detection so the
-- same content cannot be posted twice in 60 seconds.
--
-- Limits (tunable):
--   items     : 10 / hour, 30 / day,  no dupes within 60s
--   posts     : 10 / hour, 30 / day,  no dupes within 60s
--   comments  : 30 / hour, 100 / day, no dupes within 30s
--   messages  : 200 / hour,            no dupes within 5s
--   reports   : 10 / hour, 30 / day   (UNIQUE (reporter,target) already exists from 011)
-- ============================================

-- --------------------------------------------
-- Generic helper: count recent inserts for a user
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.user_insert_count(
  tbl regclass, uid UUID, since INTERVAL
)
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cnt INT;
BEGIN
  EXECUTE format(
    'SELECT COUNT(*) FROM %s WHERE user_id = $1 AND created_at > NOW() - $2',
    tbl
  )
  INTO cnt
  USING uid, since;
  RETURN cnt;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.user_insert_count(regclass, UUID, INTERVAL) FROM anon, authenticated;

-- --------------------------------------------
-- 1. items: rate limit + dedupe
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.rl_items_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_hour INT;
  last_day INT;
  dupe INT;
BEGIN
  SELECT COUNT(*) INTO last_hour
    FROM public.items
    WHERE user_id = NEW.user_id AND created_at > NOW() - INTERVAL '1 hour';
  IF last_hour >= 10 THEN
    RAISE EXCEPTION 'rate_limit_items_hour'
      USING HINT = 'You have posted too many items this hour. Try again later.';
  END IF;

  SELECT COUNT(*) INTO last_day
    FROM public.items
    WHERE user_id = NEW.user_id AND created_at > NOW() - INTERVAL '24 hours';
  IF last_day >= 30 THEN
    RAISE EXCEPTION 'rate_limit_items_day'
      USING HINT = 'You have posted too many items today. Try again tomorrow.';
  END IF;

  SELECT COUNT(*) INTO dupe
    FROM public.items
    WHERE user_id = NEW.user_id
      AND title = NEW.title
      AND created_at > NOW() - INTERVAL '60 seconds';
  IF dupe > 0 THEN
    RAISE EXCEPTION 'duplicate_item'
      USING HINT = 'This item was just posted. Please wait before reposting.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rl_items_before_insert ON public.items;
CREATE TRIGGER trg_rl_items_before_insert
  BEFORE INSERT ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.rl_items_before_insert();

-- --------------------------------------------
-- 2. posts (plaza): rate limit + dedupe
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.rl_posts_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_hour INT;
  last_day INT;
  dupe INT;
BEGIN
  IF NEW.is_official THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO last_hour
    FROM public.posts
    WHERE user_id = NEW.user_id AND created_at > NOW() - INTERVAL '1 hour';
  IF last_hour >= 10 THEN
    RAISE EXCEPTION 'rate_limit_posts_hour'
      USING HINT = 'You have posted too many times this hour. Slow down.';
  END IF;

  SELECT COUNT(*) INTO last_day
    FROM public.posts
    WHERE user_id = NEW.user_id AND created_at > NOW() - INTERVAL '24 hours';
  IF last_day >= 30 THEN
    RAISE EXCEPTION 'rate_limit_posts_day'
      USING HINT = 'You have posted too many times today. Try again tomorrow.';
  END IF;

  SELECT COUNT(*) INTO dupe
    FROM public.posts
    WHERE user_id = NEW.user_id
      AND content = NEW.content
      AND created_at > NOW() - INTERVAL '60 seconds';
  IF dupe > 0 THEN
    RAISE EXCEPTION 'duplicate_post'
      USING HINT = 'You just posted that. Please wait before reposting.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rl_posts_before_insert ON public.posts;
CREATE TRIGGER trg_rl_posts_before_insert
  BEFORE INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.rl_posts_before_insert();

-- --------------------------------------------
-- 3. post_comments: rate limit + dedupe
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.rl_post_comments_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_hour INT;
  last_day INT;
  dupe INT;
BEGIN
  SELECT COUNT(*) INTO last_hour
    FROM public.post_comments
    WHERE user_id = NEW.user_id AND created_at > NOW() - INTERVAL '1 hour';
  IF last_hour >= 30 THEN
    RAISE EXCEPTION 'rate_limit_comments_hour'
      USING HINT = 'You are commenting too fast. Please wait a minute.';
  END IF;

  SELECT COUNT(*) INTO last_day
    FROM public.post_comments
    WHERE user_id = NEW.user_id AND created_at > NOW() - INTERVAL '24 hours';
  IF last_day >= 100 THEN
    RAISE EXCEPTION 'rate_limit_comments_day'
      USING HINT = 'Daily comment limit reached. Try again tomorrow.';
  END IF;

  SELECT COUNT(*) INTO dupe
    FROM public.post_comments
    WHERE user_id = NEW.user_id
      AND post_id = NEW.post_id
      AND content = NEW.content
      AND created_at > NOW() - INTERVAL '30 seconds';
  IF dupe > 0 THEN
    RAISE EXCEPTION 'duplicate_comment'
      USING HINT = 'You just wrote that comment. Please wait.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rl_post_comments_before_insert ON public.post_comments;
CREATE TRIGGER trg_rl_post_comments_before_insert
  BEFORE INSERT ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.rl_post_comments_before_insert();

-- --------------------------------------------
-- 4. messages (chat): rate limit + short dedupe
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.rl_messages_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_min INT;
  last_hour INT;
  dupe INT;
BEGIN
  SELECT COUNT(*) INTO last_min
    FROM public.messages
    WHERE sender_id = NEW.sender_id AND created_at > NOW() - INTERVAL '1 minute';
  IF last_min >= 30 THEN
    RAISE EXCEPTION 'rate_limit_messages_minute'
      USING HINT = 'Slow down — too many messages in one minute.';
  END IF;

  SELECT COUNT(*) INTO last_hour
    FROM public.messages
    WHERE sender_id = NEW.sender_id AND created_at > NOW() - INTERVAL '1 hour';
  IF last_hour >= 300 THEN
    RAISE EXCEPTION 'rate_limit_messages_hour'
      USING HINT = 'Hourly message limit reached.';
  END IF;

  SELECT COUNT(*) INTO dupe
    FROM public.messages
    WHERE sender_id = NEW.sender_id
      AND conversation_id = NEW.conversation_id
      AND content = NEW.content
      AND message_type = NEW.message_type
      AND created_at > NOW() - INTERVAL '5 seconds';
  IF dupe > 0 THEN
    RAISE EXCEPTION 'duplicate_message'
      USING HINT = 'Duplicate message blocked.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rl_messages_before_insert ON public.messages;
CREATE TRIGGER trg_rl_messages_before_insert
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.rl_messages_before_insert();

-- --------------------------------------------
-- 5. reports: rate limit (unique constraint already prevents spam
--    on same target from 011, but cap overall volume)
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
    WHERE reporter_id = NEW.reporter_id AND created_at > NOW() - INTERVAL '1 hour';
  IF last_hour >= 10 THEN
    RAISE EXCEPTION 'rate_limit_reports_hour'
      USING HINT = 'Too many reports in a short time.';
  END IF;

  SELECT COUNT(*) INTO last_day
    FROM public.reports
    WHERE reporter_id = NEW.reporter_id AND created_at > NOW() - INTERVAL '24 hours';
  IF last_day >= 30 THEN
    RAISE EXCEPTION 'rate_limit_reports_day'
      USING HINT = 'Daily report limit reached.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rl_reports_before_insert ON public.reports;
CREATE TRIGGER trg_rl_reports_before_insert
  BEFORE INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.rl_reports_before_insert();

-- --------------------------------------------
-- 6. profiles (signup burst): prevent a single auth.user from
--    creating more than one profile row (should already be enforced
--    by PK but guard anyway)
-- --------------------------------------------
-- (no trigger needed: profiles.id is PK == auth.users.id, already unique)

-- --------------------------------------------
-- Verification (run after):
--   SELECT tgname, tgrelid::regclass FROM pg_trigger
--     WHERE tgname LIKE 'trg_rl_%' ORDER BY tgrelid::regclass;
-- --------------------------------------------
