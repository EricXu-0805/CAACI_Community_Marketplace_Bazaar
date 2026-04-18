-- ============================================
-- 013 Security patches — post-audit hardening
-- ============================================
-- Addresses three findings from the Apr 18 security audit
-- (see docs/audit/SECURITY_AUDIT.md):
--
--   P0-1 (CRIT)  notifications table has no explicit INSERT policy
--                → any authenticated user can forge notifications
--                  for another user by calling .insert() directly.
--                  Fix: deny all direct INSERTs; only allow
--                  SECURITY DEFINER triggers (notify_price_drop,
--                  sold trigger) to write.
--
--   P0-2 (HIGH)  conversations.UPDATE policy lets either party
--                mutate the OTHER party's is_pinned/is_muted
--                columns. Buyer should only touch _buyer flags;
--                seller should only touch _seller flags.
--                Fix: BEFORE UPDATE trigger enforces per-column
--                ownership.
--
--   P0-3 (HIGH)  rate-limit dedupe in 012 compares strings
--                case-sensitively and does not TRIM whitespace.
--                Attacker bypasses 60s dedupe with
--                "iPhone 13" → "IPHONE 13 " → "iPhone  13".
--                Fix: normalize with LOWER(TRIM(regexp_replace))
--                before comparing.
--
-- All changes are idempotent (DROP … IF EXISTS + CREATE).
-- ============================================

-- --------------------------------------------
-- 1. notifications: explicit INSERT deny
-- --------------------------------------------
-- RLS-wise, an absent INSERT policy means inserts are denied for
-- non-privileged roles. BUT two hazards:
--   (a) future migrations may accidentally add a permissive policy
--   (b) clients using the service_role key (shouldn't happen but…)
--       ignore RLS entirely, so an explicit CHECK (false) here
--       doesn't protect that — it's a defense-in-depth belt &
--       suspenders signal to future maintainers.
-- The two legitimate writers are SECURITY DEFINER triggers:
--   - notify_price_drop (005)
--   - sold trigger (006)
-- Both bypass RLS because they run with elevated privileges, so
-- CHECK (false) below does NOT block them.

DROP POLICY IF EXISTS "Block direct notification inserts" ON public.notifications;
CREATE POLICY "Block direct notification inserts"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (false);

COMMENT ON POLICY "Block direct notification inserts" ON public.notifications IS
  'Notifications are system-generated. Only SECURITY DEFINER triggers (notify_price_drop, sold trigger) may insert. Direct client inserts are denied.';

-- --------------------------------------------
-- 2. conversations: per-participant flag isolation
-- --------------------------------------------
-- Problem: the policy in 011 says "either participant can UPDATE".
-- RLS cannot express column-level WITH CHECK, so a buyer can
-- technically run `UPDATE conversations SET is_muted_seller = true
-- WHERE id = $1` and RLS will allow it (since they're a participant).
-- Fix with a BEFORE UPDATE trigger that rejects cross-party writes.

CREATE OR REPLACE FUNCTION public.enforce_conversation_flag_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  -- Service-role / trigger context: skip check
  IF uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Non-participants shouldn't get here (RLS blocks them) but
  -- guard anyway
  IF uid <> OLD.buyer_id AND uid <> OLD.seller_id THEN
    RAISE EXCEPTION 'not_a_participant';
  END IF;

  -- Only the buyer may change buyer flags
  IF uid <> OLD.buyer_id THEN
    IF NEW.is_pinned_buyer IS DISTINCT FROM OLD.is_pinned_buyer
       OR NEW.is_muted_buyer  IS DISTINCT FROM OLD.is_muted_buyer THEN
      RAISE EXCEPTION 'cross_party_flag_update'
        USING HINT = 'Only the buyer can change their own pin/mute state.';
    END IF;
  END IF;

  -- Only the seller may change seller flags
  IF uid <> OLD.seller_id THEN
    IF NEW.is_pinned_seller IS DISTINCT FROM OLD.is_pinned_seller
       OR NEW.is_muted_seller  IS DISTINCT FROM OLD.is_muted_seller THEN
      RAISE EXCEPTION 'cross_party_flag_update'
        USING HINT = 'Only the seller can change their own pin/mute state.';
    END IF;
  END IF;

  -- buyer_id / seller_id / item_id immutable
  IF NEW.buyer_id  IS DISTINCT FROM OLD.buyer_id
     OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
     OR NEW.item_id   IS DISTINCT FROM OLD.item_id THEN
    RAISE EXCEPTION 'immutable_participant_fields';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conv_flag_ownership ON public.conversations;
CREATE TRIGGER trg_conv_flag_ownership
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_conversation_flag_ownership();

-- --------------------------------------------
-- 3. dedupe normalization — rewrite 012 trigger bodies
-- --------------------------------------------
-- Normalization rule: LOWER(TRIM(regexp_replace(x, '\s+', ' ', 'g')))
--   - case-insensitive
--   - leading/trailing whitespace stripped
--   - internal runs of whitespace collapsed to single space
-- This catches "iPhone 13", "IPHONE 13 ", "iPhone  13" as duplicates.

-- 3a. items
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

-- 3b. posts (plaza)
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

-- 3c. post_comments
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

-- 3d. messages — dedupe also normalized (5s window is short but
-- scripts can still race with casing changes)
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
-- Verification
--   -- (1) should error 'new row violates row-level security policy':
--   INSERT INTO public.notifications (user_id, type, title)
--     VALUES ('<some-other-uid>', 'system', 'forged');
--
--   -- (2) buyer tries to mute as seller — should raise
--   --     cross_party_flag_update:
--   UPDATE public.conversations SET is_muted_seller = true
--     WHERE id = '<conv-where-im-buyer>';
--
--   -- (3) dedupe with casing:
--   INSERT INTO public.items ... (title 'iPhone 13', ...);
--   INSERT INTO public.items ... (title 'IPHONE 13 ', ...);  -- should fail
-- --------------------------------------------
