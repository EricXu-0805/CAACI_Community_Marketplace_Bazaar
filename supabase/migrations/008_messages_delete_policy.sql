-- ============================================
-- 008 Allow senders to delete their own messages
-- ============================================

DROP POLICY IF EXISTS "Senders can delete own messages" ON public.messages;
CREATE POLICY "Senders can delete own messages"
  ON public.messages FOR DELETE
  USING (auth.uid() = sender_id);
