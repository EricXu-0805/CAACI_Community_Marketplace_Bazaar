-- ============================================
-- 010 Plaza + UID + Chat flags + Currency Exchange category
-- ============================================
-- Adds:
--   1. profiles.uid (public short ID, e.g. U12345678)
--   2. conversations.is_pinned, is_muted
--   3. currency_exchange category enum value
--   4. posts (plaza user posts) + post_comments + post_likes
--   5. indexes + RLS policies

-- --------------------------------------------
-- 1. profiles.uid - short public identifier
-- --------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS uid TEXT UNIQUE;

-- Generate UID for any existing profile that lacks one
-- Format: U + 8 digits (e.g., U12345678)
CREATE OR REPLACE FUNCTION public.generate_uid()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  new_uid TEXT;
  attempts INT := 0;
BEGIN
  LOOP
    new_uid := 'U' || LPAD((FLOOR(RANDOM() * 99999999) + 1)::TEXT, 8, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE uid = new_uid);
    attempts := attempts + 1;
    IF attempts > 50 THEN
      new_uid := 'U' || LPAD((FLOOR(RANDOM() * 999999999) + 1)::TEXT, 9, '0');
      EXIT;
    END IF;
  END LOOP;
  RETURN new_uid;
END;
$$;

-- Backfill existing profiles
UPDATE public.profiles
SET uid = public.generate_uid()
WHERE uid IS NULL;

-- Make uid NOT NULL with default for new rows
ALTER TABLE public.profiles
  ALTER COLUMN uid SET DEFAULT public.generate_uid(),
  ALTER COLUMN uid SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_uid ON public.profiles(uid);

-- --------------------------------------------
-- 2. Update handle_new_user + get_my_profile to include uid
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, email, nickname, is_illini_verified, uid)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'nickname', split_part(NEW.email, '@', 1), 'user'),
      (LOWER(COALESCE(NEW.email, '')) LIKE '%@illinois.edu'),
      public.generate_uid()
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- Re-create get_my_profile to return uid
DROP FUNCTION IF EXISTS public.get_my_profile();
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS public.profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

-- Expose uid via the public profile column grants (others only see uid, nickname, etc.)
DO $$
BEGIN
  BEGIN
    EXECUTE 'GRANT SELECT (id, nickname, avatar_url, bio, location, is_illini_verified, created_at, updated_at, uid) ON public.profiles TO anon, authenticated';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'grant on profiles failed: %', SQLERRM;
  END;
END $$;

-- --------------------------------------------
-- 3. conversations: is_pinned + is_muted (per-conversation flags)
-- --------------------------------------------
-- Note: we store a single flag on the conversation row (simpler than per-user).
-- For P1 this is acceptable because mute/pin behavior is per-conversation for
-- the owner perspective — the tabbar badge logic will handle muted conversations
-- by showing a dot-only indicator (see useUnread).
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS is_pinned_buyer  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_pinned_seller BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_muted_buyer   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_muted_seller  BOOLEAN NOT NULL DEFAULT FALSE;

-- Convenience: index for pinned ordering queries
CREATE INDEX IF NOT EXISTS idx_conversations_pinned
  ON public.conversations(last_message_at DESC)
  WHERE is_pinned_buyer OR is_pinned_seller;

-- --------------------------------------------
-- 4. Expand item_category enum — currency_exchange
-- --------------------------------------------
DO $$
BEGIN
  BEGIN
    ALTER TYPE item_category ADD VALUE IF NOT EXISTS 'currency_exchange';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

-- --------------------------------------------
-- 5. Plaza: posts + comments + likes
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (length(content) > 0 AND length(content) <= 2000),
  images TEXT[] NOT NULL DEFAULT '{}',
  is_official BOOLEAN NOT NULL DEFAULT FALSE,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  like_count INT NOT NULL DEFAULT 0,
  comment_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted','hidden')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_created ON public.posts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_pinned  ON public.posts(is_pinned, created_at DESC) WHERE is_pinned;
CREATE INDEX IF NOT EXISTS idx_posts_user    ON public.posts(user_id);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active posts" ON public.posts;
CREATE POLICY "Anyone can view active posts"
  ON public.posts FOR SELECT USING (status = 'active');

DROP POLICY IF EXISTS "Authenticated users can create posts" ON public.posts;
CREATE POLICY "Authenticated users can create posts"
  ON public.posts FOR INSERT WITH CHECK (auth.uid() = user_id AND NOT is_official);

DROP POLICY IF EXISTS "Users can update own posts" ON public.posts;
CREATE POLICY "Users can update own posts"
  ON public.posts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND NOT is_official);

DROP POLICY IF EXISTS "Users can delete own posts" ON public.posts;
CREATE POLICY "Users can delete own posts"
  ON public.posts FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER set_posts_updated_at
  BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Comments
CREATE TABLE IF NOT EXISTS public.post_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (length(content) > 0 AND length(content) <= 1000),
  parent_comment_id UUID REFERENCES public.post_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_comments_post ON public.post_comments(post_id, created_at);

ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view comments" ON public.post_comments;
CREATE POLICY "Anyone can view comments"
  ON public.post_comments FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can comment" ON public.post_comments;
CREATE POLICY "Authenticated users can comment"
  ON public.post_comments FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own comments" ON public.post_comments;
CREATE POLICY "Users can delete own comments"
  ON public.post_comments FOR DELETE USING (auth.uid() = user_id);

-- Likes
CREATE TABLE IF NOT EXISTS public.post_likes (
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view likes" ON public.post_likes;
CREATE POLICY "Anyone can view likes"
  ON public.post_likes FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can like" ON public.post_likes;
CREATE POLICY "Users can like"
  ON public.post_likes FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can unlike" ON public.post_likes;
CREATE POLICY "Users can unlike"
  ON public.post_likes FOR DELETE USING (auth.uid() = user_id);

-- Trigger: maintain like_count + comment_count
CREATE OR REPLACE FUNCTION public.update_post_like_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts SET like_count = GREATEST(0, like_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_likes_count ON public.post_likes;
CREATE TRIGGER trg_post_likes_count
  AFTER INSERT OR DELETE ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION public.update_post_like_count();

CREATE OR REPLACE FUNCTION public.update_post_comment_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_comments_count ON public.post_comments;
CREATE TRIGGER trg_post_comments_count
  AFTER INSERT OR DELETE ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_post_comment_count();

-- Expose realtime on plaza posts/comments/likes
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.posts;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.post_comments;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.post_likes;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- --------------------------------------------
-- 6. Seed: one official welcome post (so the plaza isn't empty at launch)
-- --------------------------------------------
-- Only insert if no official posts exist yet
DO $$
DECLARE
  admin_user_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.posts WHERE is_official = TRUE) THEN
    SELECT id INTO admin_user_id FROM public.profiles ORDER BY created_at ASC LIMIT 1;
    IF admin_user_id IS NOT NULL THEN
      INSERT INTO public.posts (user_id, content, is_official, is_pinned)
      VALUES (
        admin_user_id,
        E'欢迎来到 Illini 集市广场 Welcome to Illini Market Plaza\n\n在这里你可以:\n· 查看官方活动/安全提示/校园通知\n· 发布校园动态,寻找室友或一起团购\n· 评论点赞互动\n\nHere you can:\n· See official events / safety tips / campus notices\n· Post campus updates, find roommates, or group-buy together\n· Comment and like',
        TRUE,
        TRUE
      );
    END IF;
  END IF;
END $$;

-- --------------------------------------------
-- Done. Verification:
--   SELECT id, nickname, uid FROM public.profiles LIMIT 5;
--   SELECT column_name FROM information_schema.columns WHERE table_name='conversations';
--   SELECT unnest(enum_range(NULL::item_category));
--   SELECT count(*) FROM public.posts;
-- --------------------------------------------
