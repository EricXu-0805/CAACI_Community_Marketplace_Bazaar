-- ============================================
-- 064 Messages UPDATE lockdown (QA4 B9)
-- ============================================
-- Problem: a conversation participant could UPDATE any message in the
-- conversation, including the OTHER person's `content`, `sender_id`,
-- `created_at`, `message_type`. The only UPDATE policy ("Participants can
-- update messages", 011) checks conversation membership only — no column
-- scope and no sender guard — and `authenticated`/`anon` held table-wide
-- UPDATE on every column. So message history (used as evidence in reports /
-- admin review) was tamperable. Clients only ever flip `is_read`.
--
-- Fix is two layers:
--   Layer 1 (the real lock): column-level privilege — strip table-wide UPDATE
--   and regrant only UPDATE(is_read). This is enforced BEFORE RLS, so even a
--   crafted statement that SETs content is rejected.
--   Layer 2 (clean RLS): only the RECIPIENT (not either participant) may flip
--   is_read. Both client write paths (markAsRead / markConversationUnread)
--   target received messages, so this matches real usage with no regression.
--
-- service_role/postgres keep full UPDATE (trusted server paths bypass RLS).

-- Layer 1 — column privilege. REVOKE FROM PUBLIC is not enough on this stack;
-- anon + authenticated must be revoked explicitly (durable Supabase lesson).
REVOKE UPDATE ON public.messages FROM PUBLIC;
REVOKE UPDATE ON public.messages FROM anon;
REVOKE UPDATE ON public.messages FROM authenticated;
GRANT  UPDATE (is_read) ON public.messages TO authenticated;

-- Layer 2 — recipient-keyed RLS (replaces the membership-only policy).
DROP POLICY IF EXISTS "Participants can update messages" ON public.messages;
CREATE POLICY "Recipients can mark messages read"
  ON public.messages FOR UPDATE
  TO authenticated
  USING (
    sender_id <> auth.uid()
    AND conversation_id IN (
      SELECT id FROM public.conversations
      WHERE buyer_id = auth.uid() OR seller_id = auth.uid()
    )
  )
  WITH CHECK (
    sender_id <> auth.uid()
    AND conversation_id IN (
      SELECT id FROM public.conversations
      WHERE buyer_id = auth.uid() OR seller_id = auth.uid()
    )
  );
