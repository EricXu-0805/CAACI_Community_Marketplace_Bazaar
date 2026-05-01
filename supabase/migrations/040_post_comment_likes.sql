-- ============================================
-- 040 Comment likes — mirrors post_likes pattern from migrations 010 + 011
-- ============================================
-- Adds:
--   1. post_comments.like_count column (denormalized counter, maintained
--      by AFTER INSERT/DELETE trigger on post_comment_likes — same shape as
--      post_likes → posts.like_count from mig 010).
--   2. post_comment_likes join table with composite PK (comment_id, user_id),
--      cascade-delete on both FKs.
--   3. RLS: public SELECT, owner-only INSERT/DELETE, hard-deny UPDATE
--      (matches post_likes from 010+011).
--   4. Performance index on user_id (mirrors idx_post_likes_user_id).
--   5. Trigger update_post_comment_like_count + GREATEST(0, …) underflow guard.
--   6. Realtime publication add (matches post_likes).
-- ============================================

-- 1. Denormalized counter on post_comments
ALTER TABLE public.post_comments
  ADD COLUMN IF NOT EXISTS like_count INT NOT NULL DEFAULT 0;

-- 2. Likes join table
CREATE TABLE IF NOT EXISTS public.post_comment_likes (
  comment_id UUID NOT NULL REFERENCES public.post_comments(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id)      ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, user_id)
);

-- 3. RLS — same shape as post_likes
ALTER TABLE public.post_comment_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view comment likes" ON public.post_comment_likes;
CREATE POLICY "Anyone can view comment likes"
  ON public.post_comment_likes FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can like comments" ON public.post_comment_likes;
CREATE POLICY "Users can like comments"
  ON public.post_comment_likes FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can unlike comments" ON public.post_comment_likes;
CREATE POLICY "Users can unlike comments"
  ON public.post_comment_likes FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "No updates to comment likes" ON public.post_comment_likes;
CREATE POLICY "No updates to comment likes"
  ON public.post_comment_likes FOR UPDATE USING (false) WITH CHECK (false);

-- 4. User-id index for "did I like any of these comments" lookup
CREATE INDEX IF NOT EXISTS idx_post_comment_likes_user
  ON public.post_comment_likes(user_id);

-- 5. Trigger maintains post_comments.like_count
CREATE OR REPLACE FUNCTION public.update_post_comment_like_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.post_comments
       SET like_count = like_count + 1
     WHERE id = NEW.comment_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.post_comments
       SET like_count = GREATEST(0, like_count - 1)
     WHERE id = OLD.comment_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_comment_likes_count ON public.post_comment_likes;
CREATE TRIGGER trg_post_comment_likes_count
  AFTER INSERT OR DELETE ON public.post_comment_likes
  FOR EACH ROW EXECUTE FUNCTION public.update_post_comment_like_count();

-- 6. Realtime publication
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.post_comment_likes;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ============================================
-- Verification queries (Eric will run after `supabase db push`):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='post_comments' AND column_name='like_count';
--   SELECT policyname, cmd FROM pg_policies WHERE tablename='post_comment_likes' ORDER BY cmd;
--   SELECT indexname FROM pg_indexes WHERE tablename='post_comment_likes';
--   SELECT tgname FROM pg_trigger WHERE tgname='trg_post_comment_likes_count';
-- ============================================
