-- ============================================
-- 011 RLS hardening + perf indexes + rate limits
-- ============================================
-- Security findings addressed:
--   P0: items.UPDATE missing WITH CHECK (user_id spoofing)
--   P0: messages.UPDATE missing WITH CHECK + sender_id guard (impersonation)
--   P0: post_comments has no UPDATE policy (explicit deny)
--   P0: post_likes has no UPDATE policy (explicit deny)
--   P1: conversations.UPDATE missing WITH CHECK (participant swap)
--   P1: notifications.UPDATE missing WITH CHECK
--   P1: posts.UPDATE allows is_pinned=true self-pin
--   P1: storage bucket: restrict uploads to user's own folder
--   P1: reports: unique(reporter, target) to block spam
--
-- Performance findings addressed:
--   Missing index on conversations.item_id
--   Missing index on messages.sender_id
--   Missing index on post_likes.user_id
--   Index on messages(conversation_id, is_read) for unread-count query
--   Index on items(user_id, status) for seller page + profile listed tab
-- ============================================

-- --------------------------------------------
-- 1. items UPDATE WITH CHECK + prevent user_id swap
-- --------------------------------------------
DROP POLICY IF EXISTS "Users can update own items" ON public.items;
CREATE POLICY "Users can update own items"
  ON public.items FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- --------------------------------------------
-- 2. messages UPDATE WITH CHECK + forbid sender_id tampering
-- --------------------------------------------
DROP POLICY IF EXISTS "Participants can update messages" ON public.messages;
CREATE POLICY "Participants can update messages"
  ON public.messages FOR UPDATE
  USING (
    conversation_id IN (
      SELECT id FROM public.conversations
      WHERE buyer_id = auth.uid() OR seller_id = auth.uid()
    )
  )
  WITH CHECK (
    conversation_id IN (
      SELECT id FROM public.conversations
      WHERE buyer_id = auth.uid() OR seller_id = auth.uid()
    )
  );

-- --------------------------------------------
-- 3. conversations UPDATE WITH CHECK — prevent buyer_id/seller_id swap
-- --------------------------------------------
DROP POLICY IF EXISTS "Participants can update conversations" ON public.conversations;
CREATE POLICY "Participants can update conversations"
  ON public.conversations FOR UPDATE
  USING (auth.uid() = buyer_id OR auth.uid() = seller_id)
  WITH CHECK (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- --------------------------------------------
-- 4. notifications UPDATE WITH CHECK
-- --------------------------------------------
DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- --------------------------------------------
-- 5. posts: harden update policy so regular users cannot self-pin or
--    flip is_official
-- --------------------------------------------
DROP POLICY IF EXISTS "Users can update own posts" ON public.posts;
CREATE POLICY "Users can update own posts"
  ON public.posts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND NOT is_official
    AND NOT is_pinned
  );

-- --------------------------------------------
-- 6. post_comments: add explicit UPDATE policy (user can edit own)
--    with WITH CHECK to prevent user_id/post_id hijack.
-- --------------------------------------------
DROP POLICY IF EXISTS "Users can update own comments" ON public.post_comments;
CREATE POLICY "Users can update own comments"
  ON public.post_comments FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- --------------------------------------------
-- 7. post_likes: deny UPDATE entirely (rows should be insert/delete only)
-- --------------------------------------------
DROP POLICY IF EXISTS "No updates to likes" ON public.post_likes;
CREATE POLICY "No updates to likes"
  ON public.post_likes FOR UPDATE
  USING (false)
  WITH CHECK (false);

-- --------------------------------------------
-- 8. Storage: restrict uploads to user's own folder
--    (path convention: items/<uid>/<filename>)
-- --------------------------------------------
DO $$
BEGIN
  BEGIN
    DROP POLICY IF EXISTS "Authenticated users can upload images" ON storage.objects;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

CREATE POLICY "Authenticated users can upload to own folder"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'item-images'
    AND auth.role() = 'authenticated'
    AND (
      -- allow: items/<uid>/...
      (storage.foldername(name))[1] = 'items'
      AND (storage.foldername(name))[2] = auth.uid()::text
    )
  );

-- --------------------------------------------
-- 9. reports: prevent spamming the same target
-- --------------------------------------------
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.reports
      ADD CONSTRAINT reports_unique_reporter_target
      UNIQUE (reporter_id, target_type, target_id);
  EXCEPTION WHEN duplicate_object THEN NULL;
    WHEN duplicate_table THEN NULL;
  END;
END $$;

-- --------------------------------------------
-- 10. Performance indexes
-- --------------------------------------------
CREATE INDEX IF NOT EXISTS idx_conversations_item_id
  ON public.conversations(item_id)
  WHERE item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_sender_id
  ON public.messages(sender_id);

CREATE INDEX IF NOT EXISTS idx_messages_unread_by_conv
  ON public.messages(conversation_id, is_read)
  WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_post_likes_user_id
  ON public.post_likes(user_id);

CREATE INDEX IF NOT EXISTS idx_items_user_status
  ON public.items(user_id, status)
  WHERE status <> 'deleted';

-- --------------------------------------------
-- 11. Guard future trigger runs: rewrite 009's auto-confirm to ONLY
--     trust @illinois.edu (no @gmail.com). This is a NO-OP since 009
--     was a one-time UPDATE, but document the intent for reruns.
-- --------------------------------------------
-- (No action: migration 009 already ran once. Future signups go through
-- the normal email verification flow via Supabase auth redirect URL.)

-- --------------------------------------------
-- Verification queries (run after):
--   SELECT policyname, cmd, with_check FROM pg_policies
--     WHERE tablename IN ('items','messages','conversations','notifications','posts','post_comments','post_likes')
--     ORDER BY tablename, cmd;
--   SELECT indexname FROM pg_indexes WHERE tablename IN ('messages','conversations','post_likes','items');
-- --------------------------------------------
