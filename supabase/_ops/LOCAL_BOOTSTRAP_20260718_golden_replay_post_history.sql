-- LOCAL/ISOLATED DATABASE ONLY.
-- Final production-parity adjustments after the selected historical replay.

\set ON_ERROR_STOP on

-- Migration 064 supersedes 004's broad message UPDATE policy.
DROP POLICY IF EXISTS "Participants can update messages" ON public.messages;

CREATE TABLE IF NOT EXISTS public.moderation_keywords (
  id bigserial PRIMARY KEY,
  keyword text NOT NULL,
  category text NOT NULL DEFAULT 'generic',
  severity smallint NOT NULL DEFAULT 2 CHECK (severity BETWEEN 1 AND 3),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE UNIQUE INDEX IF NOT EXISTS moderation_keywords_kw_uniq
  ON public.moderation_keywords (pg_catalog.lower(keyword));
ALTER TABLE public.moderation_keywords ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moderation_keywords FROM PUBLIC, anon, authenticated;

-- Migration 057 ran after these functions were created in production.  The
-- compact local replay bootstraps their definitions instead of replaying every
-- unrelated historical table, so reproduce its final ACLs explicitly.
REVOKE EXECUTE ON FUNCTION public.trg_moderate_profiles()
  FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.trg_moderate_profiles()
  SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.rl_saved_searches_before_insert()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_post_comment_count()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.content_moderation_check(text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_profile()
  FROM PUBLIC, anon;

-- Preserve the latest notification vocabulary (migration 070) after 051.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'price_drop',
    'system',
    'sold',
    'offer',
    'meetup',
    'unread_message'
  ));

-- Production FK deletion actions used by account/evidence regressions.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_user_id_fkey;
ALTER TABLE public.items
  ADD CONSTRAINT items_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_item_id_fkey,
  DROP CONSTRAINT IF EXISTS conversations_buyer_id_fkey,
  DROP CONSTRAINT IF EXISTS conversations_seller_id_fkey;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE SET NULL,
  ADD CONSTRAINT conversations_buyer_id_fkey
    FOREIGN KEY (buyer_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD CONSTRAINT conversations_seller_id_fkey
    FOREIGN KEY (seller_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey,
  DROP CONSTRAINT IF EXISTS messages_sender_id_fkey;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE,
  ADD CONSTRAINT messages_sender_id_fkey
    FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_user_id_fkey,
  DROP CONSTRAINT IF EXISTS notifications_item_id_fkey;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD CONSTRAINT notifications_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;

ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_user_id_fkey;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.post_comments
  DROP CONSTRAINT IF EXISTS post_comments_post_id_fkey,
  DROP CONSTRAINT IF EXISTS post_comments_user_id_fkey,
  DROP CONSTRAINT IF EXISTS post_comments_parent_comment_id_fkey;
ALTER TABLE public.post_comments
  ADD CONSTRAINT post_comments_post_id_fkey
    FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE,
  ADD CONSTRAINT post_comments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD CONSTRAINT post_comments_parent_comment_id_fkey
    FOREIGN KEY (parent_comment_id) REFERENCES public.post_comments(id) ON DELETE CASCADE;

ALTER TABLE public.ratings
  DROP CONSTRAINT IF EXISTS ratings_item_id_fkey,
  DROP CONSTRAINT IF EXISTS ratings_rater_id_fkey,
  DROP CONSTRAINT IF EXISTS ratings_ratee_id_fkey;
ALTER TABLE public.ratings
  ADD CONSTRAINT ratings_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE,
  ADD CONSTRAINT ratings_rater_id_fkey
    FOREIGN KEY (rater_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD CONSTRAINT ratings_ratee_id_fkey
    FOREIGN KEY (ratee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_reporter_id_fkey;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_reporter_id_fkey
  FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active items" ON public.items;
CREATE POLICY "Anyone can view active items"
  ON public.items FOR SELECT
  USING (status <> 'deleted'::public.item_status);

DROP POLICY IF EXISTS "Anyone can view active posts" ON public.posts;
CREATE POLICY "Anyone can view active posts"
  ON public.posts FOR SELECT
  USING (status = 'active');

DROP POLICY IF EXISTS "Anyone can view comments" ON public.post_comments;
CREATE POLICY "Anyone can view comments"
  ON public.post_comments FOR SELECT
  USING (status = 'active');

DROP POLICY IF EXISTS "Users can view own favorites" ON public.favorites;
DROP POLICY IF EXISTS "Users can add favorites" ON public.favorites;
DROP POLICY IF EXISTS "Users can remove favorites" ON public.favorites;
CREATE POLICY "Users can view own favorites"
  ON public.favorites FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can add favorites"
  ON public.favorites FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can remove favorites"
  ON public.favorites FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users delete own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications"
  ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own notifications"
  ON public.notifications FOR DELETE USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.items TO service_role;
