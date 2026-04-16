-- RPC to increment view_count without RLS ownership restriction
-- (superseded by 004 which adds existence check, but kept for migration order)
CREATE OR REPLACE FUNCTION public.increment_view_count(item_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE public.items SET view_count = view_count + 1 WHERE id = item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Allow conversation participants to update last_message_at
DROP POLICY IF EXISTS "Participants can update conversations" ON public.conversations;
CREATE POLICY "Participants can update conversations"
  ON public.conversations FOR UPDATE
  USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- Allow participants to mark messages as read
-- (same policy exists in 001; DROP first to be idempotent)
DROP POLICY IF EXISTS "Participants can update messages" ON public.messages;
CREATE POLICY "Participants can update messages"
  ON public.messages FOR UPDATE
  USING (
    conversation_id IN (
      SELECT id FROM public.conversations
      WHERE buyer_id = auth.uid() OR seller_id = auth.uid()
    )
  );
