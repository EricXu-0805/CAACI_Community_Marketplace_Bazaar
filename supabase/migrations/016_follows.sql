-- ============================================
-- 016 Seller follows
-- ============================================
-- Asymmetric follow graph: follower_id follows followee_id. Pair is
-- unique (no duplicate follows) and self-follow is blocked at the
-- CHECK level. Drives:
--   - 'Following' tab on home feed (items from followed sellers)
--   - Notifications when a followed seller posts a new item
--   - Follower/following counts on profiles
-- ============================================

CREATE TABLE IF NOT EXISTS public.follows (
  follower_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  followee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_followee
  ON public.follows(followee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follows_follower
  ON public.follows(follower_id, created_at DESC);

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view follows" ON public.follows;
CREATE POLICY "Anyone can view follows"
  ON public.follows FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can follow" ON public.follows;
CREATE POLICY "Users can follow"
  ON public.follows FOR INSERT
  WITH CHECK (auth.uid() = follower_id);

DROP POLICY IF EXISTS "Users can unfollow" ON public.follows;
CREATE POLICY "Users can unfollow"
  ON public.follows FOR DELETE
  USING (auth.uid() = follower_id);

-- Rate limit follows: 30/hr, 100/day per user (prevents follow-spam bots)
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
    WHERE follower_id = NEW.follower_id AND created_at > NOW() - INTERVAL '1 hour';
  IF last_hour >= 30 THEN
    RAISE EXCEPTION 'rate_limit_follows_hour'
      USING HINT = 'Following too fast.';
  END IF;
  SELECT COUNT(*) INTO last_day
    FROM public.follows
    WHERE follower_id = NEW.follower_id AND created_at > NOW() - INTERVAL '24 hours';
  IF last_day >= 100 THEN
    RAISE EXCEPTION 'rate_limit_follows_day'
      USING HINT = 'Daily follow limit reached.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rl_follows_before_insert ON public.follows;
CREATE TRIGGER trg_rl_follows_before_insert
  BEFORE INSERT ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.rl_follows_before_insert();

-- Notify followers when their followee lists a new item. Uses the
-- same notifications table (migration 005). type='system' (keeps the
-- enum clean; the title encodes the intent).
CREATE OR REPLACE FUNCTION public.notify_followers_on_new_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.notifications (user_id, type, title, body, item_id)
  SELECT
    f.follower_id,
    'system',
    NEW.title,
    'new_listing_from_followee',
    NEW.id
  FROM public.follows f
  WHERE f.followee_id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_followers_on_new_item ON public.items;
CREATE TRIGGER trg_notify_followers_on_new_item
  AFTER INSERT ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.notify_followers_on_new_item();

-- Verification
--   INSERT INTO public.follows (follower_id, followee_id)
--     VALUES (auth.uid(), '<seller-uuid>');
--   -- Following that seller; subsequent item inserts fan out notifications.
-- ============================================
