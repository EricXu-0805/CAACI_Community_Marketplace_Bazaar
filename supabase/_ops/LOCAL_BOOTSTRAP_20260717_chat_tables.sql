-- Supplemental schema for the isolated PostgreSQL regression harness.
-- It mirrors migrations 004/008/011/051/052/061/064/085 only for the chat
-- objects omitted by the base audit bootstrap. Never run on production.

GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

ALTER TABLE public.conversations
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.messages
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view conversations"
  ON public.conversations FOR SELECT
  USING (auth.uid() IN (buyer_id, seller_id));
CREATE POLICY "Authenticated users can create conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (auth.uid() = buyer_id);
CREATE POLICY "Participants can update conversations"
  ON public.conversations FOR UPDATE
  USING (auth.uid() IN (buyer_id, seller_id))
  WITH CHECK (auth.uid() IN (buyer_id, seller_id));
CREATE POLICY "Participants can delete conversations"
  ON public.conversations FOR DELETE
  USING (auth.uid() IN (buyer_id, seller_id));

CREATE POLICY "Participants can view messages"
  ON public.messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations
      WHERE id = messages.conversation_id
        AND auth.uid() IN (buyer_id, seller_id)
    )
  );
CREATE POLICY "Participants can send messages"
  ON public.messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.conversations
      WHERE id = messages.conversation_id
        AND auth.uid() IN (buyer_id, seller_id)
    )
  );
CREATE POLICY "Recipients can mark messages read"
  ON public.messages FOR UPDATE
  USING (sender_id <> auth.uid());
CREATE POLICY "Senders can delete own messages"
  ON public.messages FOR DELETE
  USING (sender_id = auth.uid());

CREATE TABLE public.blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX idx_blocks_blocker ON public.blocks(blocker_id);
CREATE INDEX idx_blocks_blocked ON public.blocks(blocked_id);
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own blocks"
  ON public.blocks FOR ALL
  USING (auth.uid() = blocker_id)
  WITH CHECK (auth.uid() = blocker_id);

CREATE TABLE public.offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.items(id) ON DELETE SET NULL,
  from_user uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  to_user uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  price numeric(10,2) NOT NULL CHECK (price >= 0 AND price <= 1000000),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'countered', 'expired')),
  parent_offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY offers_select ON public.offers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations
      WHERE id = offers.conversation_id
        AND auth.uid() IN (buyer_id, seller_id)
    )
  );

CREATE TABLE public.meetups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.items(id) ON DELETE SET NULL,
  from_user uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  to_user uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  spot text NOT NULL CHECK (char_length(btrim(spot)) BETWEEN 1 AND 120),
  meet_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'rescheduled', 'expired')),
  parent_meetup_id uuid REFERENCES public.meetups(id) ON DELETE SET NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  reminded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meetups ENABLE ROW LEVEL SECURITY;
CREATE POLICY meetups_select ON public.meetups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations
      WHERE id = meetups.conversation_id
        AND auth.uid() IN (buyer_id, seller_id)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.blocks, public.conversations, public.messages, public.offers, public.meetups
  TO authenticated;
