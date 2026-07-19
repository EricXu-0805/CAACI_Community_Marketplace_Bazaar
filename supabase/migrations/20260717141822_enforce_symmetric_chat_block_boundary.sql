-- =============================================================================
-- Symmetric chat block boundary + transaction lifecycle guards.
--
-- A block is intentionally bilateral for the private marketplace channel:
-- once either participant blocks the other, neither account may read or write
-- the shared conversation, its messages, offers, or meetups. Removing the
-- block restores access to the same history.
--
-- The boundary is enforced in three layers:
--   1. RLS hides rows from BOTH participants while either directional block
--      exists (including Realtime/PostgREST reads).
--   2. BEFORE-write triggers close direct-table and SECURITY DEFINER bypasses.
--   3. The public RPCs repeat the checks and validate the current item state,
--      so callers get a deterministic error before a partial workflow begins.
--
-- Existing offers/meetups remain readable after expiry, sale, or deletion.
-- Only new state transitions are rejected once the listing no longer supports
-- the transaction.
-- =============================================================================

-- Internal helpers live outside the exposed public API schema. Authenticated
-- callers need EXECUTE for the predicates used by RLS. The pair predicate
-- returns FALSE unless the caller is one of the two supplied users; the
-- conversation predicate accepts only an id and resolves its pair internally.
-- Neither reveals who blocked whom or permits probing a third-party pair.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.current_user_can_access_pair(
  first_user_id uuid,
  second_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND $1 IS NOT NULL
    AND $2 IS NOT NULL
    AND auth.uid() IN ($1, $2)
    AND NOT EXISTS (
      SELECT 1
      FROM public.blocks AS block_relation
      WHERE (block_relation.blocker_id = $1 AND block_relation.blocked_id = $2)
         OR (block_relation.blocker_id = $2 AND block_relation.blocked_id = $1)
    )
$function$;

REVOKE ALL ON FUNCTION private.current_user_can_access_pair(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.current_user_can_access_pair(uuid, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION private.current_user_can_access_conversation(
  conversation_id_in uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT COALESCE((
    SELECT private.current_user_can_access_pair(
      conversation.buyer_id,
      conversation.seller_id
    )
    FROM public.conversations AS conversation
    WHERE conversation.id = $1
  ), false)
$function$;

REVOKE ALL ON FUNCTION private.current_user_can_access_conversation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.current_user_can_access_conversation(uuid)
  TO authenticated;

-- The existing UNIQUE(blocker_id, blocked_id) index serves the forward arm;
-- this reverse composite index keeps the symmetric lookup index-backed too.
CREATE INDEX IF NOT EXISTS blocks_blocked_blocker_idx
  ON public.blocks (blocked_id, blocker_id);

-- Reassert RLS in case an environment was restored from a schema-only dump
-- that preserved policies but not the table flags.
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetups ENABLE ROW LEVEL SECURITY;

-- Block rows are private, insert/delete-only state. Splitting the historical
-- FOR ALL policy makes the absence of UPDATE permission explicit and prevents
-- a caller from retargeting an existing block row.
DROP POLICY IF EXISTS "Users manage own blocks" ON public.blocks;
DROP POLICY IF EXISTS "Blockers can view own blocks" ON public.blocks;
DROP POLICY IF EXISTS "Blockers can create own blocks" ON public.blocks;
DROP POLICY IF EXISTS "Blockers can remove own blocks" ON public.blocks;

CREATE POLICY "Blockers can view own blocks"
  ON public.blocks FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = blocker_id);

CREATE POLICY "Blockers can create own blocks"
  ON public.blocks FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = blocker_id);

CREATE POLICY "Blockers can remove own blocks"
  ON public.blocks FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = blocker_id);

REVOKE UPDATE ON public.blocks FROM PUBLIC, anon, authenticated;

-- Serialize block/unblock with chat writes on the same unordered user pair.
-- Hash collisions merely serialize unrelated pairs; they cannot weaken access.
CREATE OR REPLACE FUNCTION public.serialize_block_pair_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  blocker uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.blocker_id ELSE NEW.blocker_id END;
  blocked uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.blocked_id ELSE NEW.blocked_id END;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      LEAST(blocker::text, blocked::text) || ':' ||
      GREATEST(blocker::text, blocked::text),
      0
    )
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$function$;

REVOKE ALL ON FUNCTION public.serialize_block_pair_change()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_serialize_block_pair_change ON public.blocks;
CREATE TRIGGER trg_serialize_block_pair_change
  BEFORE INSERT OR DELETE ON public.blocks
  FOR EACH ROW EXECUTE FUNCTION public.serialize_block_pair_change();

-- Defense-in-depth for every writable row in the private transaction channel.
-- The trigger runs with the caller's auth.uid() even when reached through a
-- SECURITY DEFINER RPC. Trusted migrations/service jobs have no auth.uid() and
-- retain their intentional maintenance access.
CREATE OR REPLACE FUNCTION public.enforce_chat_block_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller uuid := auth.uid();
  buyer uuid;
  seller uuid;
  conversation_id_value uuid;
  item_owner uuid;
BEGIN
  IF caller IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'conversations' THEN
    buyer := NEW.buyer_id;
    seller := NEW.seller_id;

    -- A conversation is always anchored to the listing owner. Without this
    -- check a buyer could forge seller_id for somebody else's item and create
    -- a private channel that misrepresents the counterparty/item relationship.
    IF TG_OP = 'INSERT' THEN
      SELECT item.user_id INTO item_owner
      FROM public.items AS item
      WHERE item.id = NEW.item_id
        AND item.status <> 'deleted'::public.item_status;

      IF NEW.item_id IS NULL OR item_owner IS NULL OR item_owner <> seller THEN
        RAISE EXCEPTION 'invalid_conversation_item'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSE
    conversation_id_value := NEW.conversation_id;
    SELECT conversation.buyer_id, conversation.seller_id
      INTO buyer, seller
    FROM public.conversations AS conversation
    WHERE conversation.id = conversation_id_value;
  END IF;

  IF buyer IS NULL OR seller IS NULL OR caller NOT IN (buyer, seller) THEN
    RAISE EXCEPTION 'conversation_unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      LEAST(buyer::text, seller::text) || ':' ||
      GREATEST(buyer::text, seller::text),
      0
    )
  );

  IF EXISTS (
    SELECT 1
    FROM public.blocks AS block_relation
    WHERE (block_relation.blocker_id = buyer AND block_relation.blocked_id = seller)
       OR (block_relation.blocker_id = seller AND block_relation.blocked_id = buyer)
  ) THEN
    -- One generic error deliberately hides block direction from the caller.
    RAISE EXCEPTION 'conversation_unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.enforce_chat_block_boundary()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_chat_block_boundary ON public.conversations;
CREATE TRIGGER trg_chat_block_boundary
  BEFORE INSERT OR UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_block_boundary();

DROP TRIGGER IF EXISTS trg_chat_block_boundary ON public.messages;
CREATE TRIGGER trg_chat_block_boundary
  BEFORE INSERT OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_block_boundary();

DROP TRIGGER IF EXISTS trg_chat_block_boundary ON public.offers;
CREATE TRIGGER trg_chat_block_boundary
  BEFORE INSERT OR UPDATE ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_block_boundary();

DROP TRIGGER IF EXISTS trg_chat_block_boundary ON public.meetups;
CREATE TRIGGER trg_chat_block_boundary
  BEFORE INSERT OR UPDATE ON public.meetups
  FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_block_boundary();

-- ---------------------------------------------------------------------------
-- Symmetric read/write RLS. Drop every policy name used by migration history
-- before recreating the single intended policy per operation; permissive RLS
-- policies OR together, so leaving one historical policy would reopen access.
--
-- Repeat the preflight policy gate inside the migration transaction.  The
-- standalone PRECHECK is useful deployment evidence but cannot prevent schema
-- drift between its connection and this apply.  Only a complete historical or
-- complete post-migration shape is accepted; unknown permissive policies are
-- never blindly dropped.
-- ---------------------------------------------------------------------------
DO $policy_gate$
DECLARE
  policy_shape_ok boolean;
BEGIN
  SELECT
    (
      pg_catalog.count(*) = 1
      AND pg_catalog.count(*) FILTER (
        WHERE policyname = 'Users manage own blocks' AND cmd = 'ALL'
      ) = 1
    ) OR (
      pg_catalog.count(*) = 3
      AND pg_catalog.count(*) FILTER (
        WHERE (policyname, cmd) IN (
          ('Blockers can view own blocks', 'SELECT'),
          ('Blockers can create own blocks', 'INSERT'),
          ('Blockers can remove own blocks', 'DELETE')
        )
      ) = 3
    )
  INTO policy_shape_ok
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'blocks'
    AND permissive = 'PERMISSIVE';
  IF NOT COALESCE(policy_shape_ok, false) THEN
    RAISE EXCEPTION 'migration_blocked: blocks permissive-policy drift';
  END IF;

  SELECT (
    pg_catalog.count(*) = 4 AND (
      pg_catalog.count(*) FILTER (
        WHERE (policyname, cmd) IN (
          ('Participants can view conversations', 'SELECT'),
          ('Authenticated users can create conversations', 'INSERT'),
          ('Participants can update conversations', 'UPDATE'),
          ('Participants can delete conversations', 'DELETE')
        )
      ) = 4
      OR pg_catalog.count(*) FILTER (
        WHERE (policyname, cmd) IN (
          ('Unblocked participants can view conversations', 'SELECT'),
          ('Unblocked buyers can create conversations', 'INSERT'),
          ('Unblocked participants can update conversations', 'UPDATE'),
          ('Unblocked participants can delete conversations', 'DELETE')
        )
      ) = 4
    )
  ) OR (
    -- The later evidence-retention migration intentionally removes DELETE.
    -- Accept only its exact three-policy shape and never reopen deletion when
    -- this earlier migration is replayed after the full chain.
    pg_catalog.to_regclass('public.conversation_archives') IS NOT NULL
    AND pg_catalog.count(*) = 3
    AND pg_catalog.count(*) FILTER (
      WHERE (policyname, cmd) IN (
        ('Unblocked participants can view conversations', 'SELECT'),
        ('Unblocked buyers can create conversations', 'INSERT'),
        ('Unblocked participants can update conversations', 'UPDATE')
      )
    ) = 3
  )
  INTO policy_shape_ok
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'conversations'
    AND permissive = 'PERMISSIVE';
  IF NOT COALESCE(policy_shape_ok, false) THEN
    RAISE EXCEPTION 'migration_blocked: conversations permissive-policy drift';
  END IF;

  SELECT (
    pg_catalog.count(*) = 4 AND (
      (
        pg_catalog.count(*) FILTER (
          WHERE policyname = 'Participants can view messages' AND cmd = 'SELECT'
        ) = 1
        AND pg_catalog.count(*) FILTER (
          WHERE policyname = 'Participants can send messages' AND cmd = 'INSERT'
        ) = 1
        AND pg_catalog.count(*) FILTER (
          WHERE policyname IN (
            'Participants can update messages',
            'Recipients can mark messages read'
          ) AND cmd = 'UPDATE'
        ) = 1
        AND pg_catalog.count(*) FILTER (
          WHERE policyname = 'Senders can delete own messages' AND cmd = 'DELETE'
        ) = 1
      ) OR pg_catalog.count(*) FILTER (
        WHERE (policyname, cmd) IN (
          ('Unblocked participants can view messages', 'SELECT'),
          ('Unblocked participants can send messages', 'INSERT'),
          ('Unblocked recipients can mark messages read', 'UPDATE'),
          ('Unblocked senders can delete own messages', 'DELETE')
        )
      ) = 4
    )
  ) OR (
    pg_catalog.to_regclass('public.conversation_archives') IS NOT NULL
    AND pg_catalog.count(*) = 3
    AND pg_catalog.count(*) FILTER (
      WHERE (policyname, cmd) IN (
        ('Unblocked participants can view messages', 'SELECT'),
        ('Unblocked participants can send messages', 'INSERT'),
        ('Unblocked recipients can mark messages read', 'UPDATE')
      )
    ) = 3
  )
  INTO policy_shape_ok
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'messages'
    AND permissive = 'PERMISSIVE';
  IF NOT COALESCE(policy_shape_ok, false) THEN
    RAISE EXCEPTION 'migration_blocked: messages permissive-policy drift';
  END IF;

  SELECT pg_catalog.count(*) = 1
    AND pg_catalog.count(*) FILTER (
      WHERE policyname = 'offers_select' AND cmd = 'SELECT'
    ) = 1
  INTO policy_shape_ok
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'offers'
    AND permissive = 'PERMISSIVE';
  IF NOT COALESCE(policy_shape_ok, false) THEN
    RAISE EXCEPTION 'migration_blocked: offers permissive-policy drift';
  END IF;

  SELECT pg_catalog.count(*) = 1
    AND pg_catalog.count(*) FILTER (
      WHERE policyname = 'meetups_select' AND cmd = 'SELECT'
    ) = 1
  INTO policy_shape_ok
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'meetups'
    AND permissive = 'PERMISSIVE';
  IF NOT COALESCE(policy_shape_ok, false) THEN
    RAISE EXCEPTION 'migration_blocked: meetups permissive-policy drift';
  END IF;
END
$policy_gate$;

DROP POLICY IF EXISTS "Participants can view conversations" ON public.conversations;
DROP POLICY IF EXISTS "Authenticated users can create conversations" ON public.conversations;
DROP POLICY IF EXISTS "Participants can update conversations" ON public.conversations;
DROP POLICY IF EXISTS "Participants can delete conversations" ON public.conversations;
DROP POLICY IF EXISTS "Unblocked participants can view conversations" ON public.conversations;
DROP POLICY IF EXISTS "Unblocked buyers can create conversations" ON public.conversations;
DROP POLICY IF EXISTS "Unblocked participants can update conversations" ON public.conversations;
DROP POLICY IF EXISTS "Unblocked participants can delete conversations" ON public.conversations;

CREATE POLICY "Unblocked participants can view conversations"
  ON public.conversations FOR SELECT TO authenticated
  USING (private.current_user_can_access_pair(buyer_id, seller_id));

CREATE POLICY "Unblocked buyers can create conversations"
  ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = buyer_id
    AND buyer_id <> seller_id
    AND item_id IS NOT NULL
    AND private.current_user_can_access_pair(buyer_id, seller_id)
    AND EXISTS (
      SELECT 1
      FROM public.items AS conversation_item
      WHERE conversation_item.id = conversations.item_id
        AND conversation_item.user_id = conversations.seller_id
        AND conversation_item.status <> 'deleted'::public.item_status
    )
  );

CREATE POLICY "Unblocked participants can update conversations"
  ON public.conversations FOR UPDATE TO authenticated
  USING (private.current_user_can_access_pair(buyer_id, seller_id))
  WITH CHECK (private.current_user_can_access_pair(buyer_id, seller_id));

DO $conversation_delete_policy$
BEGIN
  IF pg_catalog.to_regclass('public.conversation_archives') IS NULL THEN
    EXECUTE $policy$
      CREATE POLICY "Unblocked participants can delete conversations"
        ON public.conversations FOR DELETE TO authenticated
        USING (private.current_user_can_access_pair(buyer_id, seller_id))
    $policy$;
  END IF;
END
$conversation_delete_policy$;

DROP POLICY IF EXISTS "Participants can view messages" ON public.messages;
DROP POLICY IF EXISTS "Participants can send messages" ON public.messages;
DROP POLICY IF EXISTS "Participants can update messages" ON public.messages;
DROP POLICY IF EXISTS "Recipients can mark messages read" ON public.messages;
DROP POLICY IF EXISTS "Senders can delete own messages" ON public.messages;
DROP POLICY IF EXISTS "Unblocked participants can view messages" ON public.messages;
DROP POLICY IF EXISTS "Unblocked participants can send messages" ON public.messages;
DROP POLICY IF EXISTS "Unblocked recipients can mark messages read" ON public.messages;
DROP POLICY IF EXISTS "Unblocked senders can delete own messages" ON public.messages;

CREATE POLICY "Unblocked participants can view messages"
  ON public.messages FOR SELECT TO authenticated
  USING (private.current_user_can_access_conversation(conversation_id));

CREATE POLICY "Unblocked participants can send messages"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = sender_id
    AND private.current_user_can_access_conversation(conversation_id)
  );

CREATE POLICY "Unblocked recipients can mark messages read"
  ON public.messages FOR UPDATE TO authenticated
  USING (
    sender_id <> (SELECT auth.uid())
    AND private.current_user_can_access_conversation(conversation_id)
  )
  WITH CHECK (
    sender_id <> (SELECT auth.uid())
    AND private.current_user_can_access_conversation(conversation_id)
  );

DO $message_delete_policy$
BEGIN
  IF pg_catalog.to_regclass('public.conversation_archives') IS NULL THEN
    EXECUTE $policy$
      CREATE POLICY "Unblocked senders can delete own messages"
        ON public.messages FOR DELETE TO authenticated
        USING (
          sender_id = (SELECT auth.uid())
          AND private.current_user_can_access_conversation(conversation_id)
        )
    $policy$;
  END IF;
END
$message_delete_policy$;

DROP POLICY IF EXISTS offers_select ON public.offers;
CREATE POLICY offers_select
  ON public.offers FOR SELECT TO authenticated
  USING (private.current_user_can_access_conversation(conversation_id));

DROP POLICY IF EXISTS meetups_select ON public.meetups;
CREATE POLICY meetups_select
  ON public.meetups FOR SELECT TO authenticated
  USING (private.current_user_can_access_conversation(conversation_id));

-- Conversation previews are SECURITY DEFINER and therefore must repeat the
-- same predicate instead of relying on messages/conversations RLS.
CREATE OR REPLACE FUNCTION public.get_last_messages(conv_ids uuid[])
RETURNS TABLE (
  conversation_id uuid,
  content text,
  message_type public.message_type
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT DISTINCT ON (message.conversation_id)
    message.conversation_id,
    message.content,
    message.message_type
  FROM public.messages AS message
  WHERE message.conversation_id = ANY ($1)
    AND private.current_user_can_access_conversation(message.conversation_id)
  ORDER BY message.conversation_id, message.created_at DESC
$function$;

REVOKE ALL ON FUNCTION public.get_last_messages(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_last_messages(uuid[])
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Offer RPCs: block-aware and valid only while the item still supports offers.
-- Reserved listings keep their historical behavior; sold/deleted listings,
-- missing hard-deleted items, and non-negotiable listings reject every new
-- offer state transition. Existing rows remain SELECT-readable when unblocked.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.make_offer(
  p_conversation_id uuid,
  p_price numeric,
  expected_user_id_in uuid,
  p_note text DEFAULT NULL
) RETURNS public.offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_conv public.conversations;
  v_to uuid;
  v_offer public.offers;
  v_item_status public.item_status;
  v_negotiable boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF v_conv.id IS NULL
     OR NOT private.current_user_can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT item.status, item.negotiable
    INTO v_item_status, v_negotiable
  FROM public.items AS item
  WHERE item.id = v_conv.item_id;

  IF v_item_status IS NULL
     OR v_item_status IN ('sold'::public.item_status, 'deleted'::public.item_status)
     OR v_negotiable IS NOT TRUE THEN
    RAISE EXCEPTION 'item_unavailable_for_offer' USING ERRCODE = '55000';
  END IF;

  -- Structured offers must be strictly positive even though the storage
  -- constraint is intentionally broader for historical rows.
  IF p_price IS NULL OR p_price <= 0 OR p_price > 1000000 THEN
    RAISE EXCEPTION 'invalid price' USING ERRCODE = '22023';
  END IF;

  v_to := CASE
    WHEN v_uid = v_conv.buyer_id THEN v_conv.seller_id
    ELSE v_conv.buyer_id
  END;

  INSERT INTO public.offers (
    conversation_id, item_id, from_user, to_user, price, note
  ) VALUES (
    p_conversation_id,
    v_conv.item_id,
    v_uid,
    v_to,
    pg_catalog.round(p_price, 2),
    NULLIF(pg_catalog.btrim(COALESCE(p_note, '')), '')
  )
  RETURNING * INTO v_offer;

  UPDATE public.conversations
  SET last_message_at = pg_catalog.now()
  WHERE id = p_conversation_id;

  INSERT INTO public.notifications (
    user_id, type, title, body, item_id, conversation_id
  )
  VALUES (
    v_to,
    'offer',
    '新报价 · New offer',
    '$' || pg_catalog.trim_scale(pg_catalog.round(p_price, 2))::text,
    v_conv.item_id,
    p_conversation_id
  );

  RETURN v_offer;
END
$function$;

CREATE OR REPLACE FUNCTION public.respond_to_offer(
  p_offer_id uuid,
  p_action text,
  expected_user_id_in uuid,
  p_counter_price numeric DEFAULT NULL,
  p_counter_note text DEFAULT NULL
) RETURNS public.offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_offer public.offers;
  v_new public.offers;
  v_item_status public.item_status;
  v_negotiable boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_offer
  FROM public.offers
  WHERE id = p_offer_id
  FOR UPDATE;

  IF v_offer.id IS NULL
     OR v_uid <> v_offer.to_user
     OR NOT private.current_user_can_access_conversation(v_offer.conversation_id) THEN
    RAISE EXCEPTION 'offer_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT item.status, item.negotiable
    INTO v_item_status, v_negotiable
  FROM public.items AS item
  WHERE item.id = v_offer.item_id;

  IF v_item_status IS NULL
     OR v_item_status IN ('sold'::public.item_status, 'deleted'::public.item_status)
     OR v_negotiable IS NOT TRUE THEN
    RAISE EXCEPTION 'item_unavailable_for_offer' USING ERRCODE = '55000';
  END IF;

  IF v_offer.status <> 'pending' THEN
    RAISE EXCEPTION 'offer is no longer pending' USING ERRCODE = '55000';
  END IF;

  IF v_offer.expires_at <= pg_catalog.now() THEN
    UPDATE public.offers
    SET status = 'expired', updated_at = pg_catalog.now()
    WHERE id = p_offer_id
    RETURNING * INTO v_offer;

    -- Do not RAISE after the UPDATE: an exception would roll the state change
    -- back and leave this already-expired row permanently marked pending. The
    -- RPC already returns public.offers, so returning the expired row preserves
    -- the client contract and lets the caller refetch/render the terminal state.
    RETURN v_offer;
  END IF;

  IF p_action = 'accept' THEN
    UPDATE public.offers
    SET status = 'accepted', updated_at = pg_catalog.now()
    WHERE id = p_offer_id
    RETURNING * INTO v_offer;

    INSERT INTO public.notifications (
      user_id, type, title, body, item_id, conversation_id
    )
    VALUES (
      v_offer.from_user,
      'offer',
      '报价被接受 · Offer accepted',
      '$' || pg_catalog.trim_scale(v_offer.price)::text,
      v_offer.item_id,
      v_offer.conversation_id
    );

    UPDATE public.conversations
    SET last_message_at = pg_catalog.now()
    WHERE id = v_offer.conversation_id;
    RETURN v_offer;

  ELSIF p_action = 'decline' THEN
    UPDATE public.offers
    SET status = 'declined', updated_at = pg_catalog.now()
    WHERE id = p_offer_id
    RETURNING * INTO v_offer;

    INSERT INTO public.notifications (
      user_id, type, title, body, item_id, conversation_id
    )
    VALUES (
      v_offer.from_user,
      'offer',
      '报价被拒绝 · Offer declined',
      '$' || pg_catalog.trim_scale(v_offer.price)::text,
      v_offer.item_id,
      v_offer.conversation_id
    );
    RETURN v_offer;

  ELSIF p_action = 'counter' THEN
    IF p_counter_price IS NULL OR p_counter_price <= 0 OR p_counter_price > 1000000 THEN
      RAISE EXCEPTION 'invalid counter price' USING ERRCODE = '22023';
    END IF;

    UPDATE public.offers
    SET status = 'countered', updated_at = pg_catalog.now()
    WHERE id = p_offer_id;

    INSERT INTO public.offers (
      conversation_id, item_id, from_user, to_user, price, note, parent_offer_id
    ) VALUES (
      v_offer.conversation_id,
      v_offer.item_id,
      v_uid,
      v_offer.from_user,
      pg_catalog.round(p_counter_price, 2),
      NULLIF(pg_catalog.btrim(COALESCE(p_counter_note, '')), ''),
      v_offer.id
    )
    RETURNING * INTO v_new;

    UPDATE public.conversations
    SET last_message_at = pg_catalog.now()
    WHERE id = v_offer.conversation_id;

    INSERT INTO public.notifications (
      user_id, type, title, body, item_id, conversation_id
    )
    VALUES (
      v_offer.from_user,
      'offer',
      '收到还价 · Counter-offer',
      '$' || pg_catalog.trim_scale(pg_catalog.round(p_counter_price, 2))::text,
      v_offer.item_id,
      v_offer.conversation_id
    );
    RETURN v_new;

  ELSE
    RAISE EXCEPTION 'unknown action' USING ERRCODE = '22023';
  END IF;
END
$function$;

-- Rolling clients with the old signatures must fail closed: those overloads
-- have no account-intent token and therefore cannot safely perform a write
-- across an A -> B session switch. Keep them only when already present so a
-- stale PostgREST schema cache returns permission_denied instead of mutating.
DO $retire_legacy_offer_rpcs$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.make_offer(uuid,numeric,text)'
  ) IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.make_offer(uuid, numeric, text)
      FROM PUBLIC, anon, authenticated, service_role;
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.respond_to_offer(uuid,text,numeric,text)'
  ) IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.respond_to_offer(uuid, text, numeric, text)
      FROM PUBLIC, anon, authenticated, service_role;
  END IF;
END
$retire_legacy_offer_rpcs$;

REVOKE ALL ON FUNCTION public.make_offer(uuid, numeric, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.respond_to_offer(uuid, text, uuid, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.make_offer(uuid, numeric, uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_offer(uuid, text, uuid, numeric, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Meetup RPCs: latest m085 concurrency/state-machine behavior plus symmetric
-- block checks and the current item guard. Sold/deleted or missing items reject
-- proposal/response/reschedule writes; historical meetup rows remain readable.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.propose_meetup(
  p_conversation_id uuid,
  p_spot text,
  p_meet_at timestamptz,
  expected_user_id_in uuid,
  p_note text DEFAULT NULL
) RETURNS public.meetups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_conv public.conversations;
  v_to uuid;
  v_spot text;
  v_meetup public.meetups;
  v_item_status public.item_status;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF v_conv.id IS NULL
     OR NOT private.current_user_can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT item.status INTO v_item_status
  FROM public.items AS item
  WHERE item.id = v_conv.item_id;

  IF v_item_status IS NULL
     OR v_item_status IN ('sold'::public.item_status, 'deleted'::public.item_status) THEN
    RAISE EXCEPTION 'item_unavailable_for_meetup' USING ERRCODE = '55000';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_conversation_id::text)::bigint
  );

  IF EXISTS (
    SELECT 1 FROM public.meetups
    WHERE conversation_id = p_conversation_id
      AND status = 'pending'
      AND expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'a meetup proposal is already pending' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.meetups
    WHERE conversation_id = p_conversation_id
      AND status = 'accepted'
      AND meet_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'a meetup is already confirmed; reschedule it instead'
      USING ERRCODE = '55000';
  END IF;

  v_spot := pg_catalog.btrim(COALESCE(p_spot, ''));
  IF pg_catalog.char_length(v_spot) = 0 OR pg_catalog.char_length(v_spot) > 120 THEN
    RAISE EXCEPTION 'invalid spot' USING ERRCODE = '22023';
  END IF;
  IF p_meet_at IS NULL
     OR p_meet_at < pg_catalog.now() - interval '2 hours'
     OR p_meet_at > pg_catalog.now() + interval '90 days' THEN
    RAISE EXCEPTION 'invalid meet time' USING ERRCODE = '22023';
  END IF;

  v_to := CASE
    WHEN v_uid = v_conv.buyer_id THEN v_conv.seller_id
    ELSE v_conv.buyer_id
  END;

  INSERT INTO public.meetups (
    conversation_id, item_id, from_user, to_user, spot, meet_at, note
  ) VALUES (
    p_conversation_id,
    v_conv.item_id,
    v_uid,
    v_to,
    v_spot,
    p_meet_at,
    NULLIF(pg_catalog.btrim(COALESCE(p_note, '')), '')
  )
  RETURNING * INTO v_meetup;

  UPDATE public.conversations
  SET last_message_at = pg_catalog.now()
  WHERE id = p_conversation_id;

  INSERT INTO public.notifications (
    user_id, type, title, body, item_id, conversation_id
  ) VALUES (
    v_to,
    'meetup',
    '见面提议 · Meetup proposed',
    v_spot,
    v_conv.item_id,
    p_conversation_id
  );
  RETURN v_meetup;
END
$function$;

CREATE OR REPLACE FUNCTION public.respond_to_meetup(
  p_meetup_id uuid,
  p_action text,
  expected_user_id_in uuid,
  p_new_spot text DEFAULT NULL,
  p_new_meet_at timestamptz DEFAULT NULL,
  p_new_note text DEFAULT NULL
) RETURNS public.meetups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_meetup public.meetups;
  v_new public.meetups;
  v_spot text;
  v_item_status public.item_status;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_meetup
  FROM public.meetups
  WHERE id = p_meetup_id
  FOR UPDATE;

  IF v_meetup.id IS NULL
     OR v_uid <> v_meetup.to_user
     OR NOT private.current_user_can_access_conversation(v_meetup.conversation_id) THEN
    RAISE EXCEPTION 'meetup_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT item.status INTO v_item_status
  FROM public.items AS item
  WHERE item.id = v_meetup.item_id;

  IF v_item_status IS NULL
     OR v_item_status IN ('sold'::public.item_status, 'deleted'::public.item_status) THEN
    RAISE EXCEPTION 'item_unavailable_for_meetup' USING ERRCODE = '55000';
  END IF;

  IF v_meetup.status <> 'pending' THEN
    RAISE EXCEPTION 'meetup is no longer pending' USING ERRCODE = '55000';
  END IF;
  IF v_meetup.expires_at <= pg_catalog.now() THEN
    UPDATE public.meetups
    SET status = 'expired', updated_at = pg_catalog.now()
    WHERE id = p_meetup_id
    RETURNING * INTO v_meetup;

    -- See the offer branch above. Raising here would undo the UPDATE. Returning
    -- the expired row is compatible with the existing public.meetups return
    -- type; the notification/email path also treats `expired` as a no-op.
    RETURN v_meetup;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_meetup.conversation_id::text)::bigint
  );

  IF p_action = 'accept' THEN
    IF EXISTS (
      SELECT 1 FROM public.meetups
      WHERE conversation_id = v_meetup.conversation_id
        AND status = 'accepted'
        AND meet_at > pg_catalog.now()
        AND id <> p_meetup_id
    ) THEN
      RAISE EXCEPTION 'another meetup is already confirmed' USING ERRCODE = '55000';
    END IF;

    UPDATE public.meetups
    SET status = 'accepted', updated_at = pg_catalog.now()
    WHERE id = p_meetup_id
    RETURNING * INTO v_meetup;

    INSERT INTO public.notifications (
      user_id, type, title, body, item_id, conversation_id
    )
    VALUES (
      v_meetup.from_user,
      'meetup',
      '约定已确认 · Meetup confirmed',
      v_meetup.spot,
      v_meetup.item_id,
      v_meetup.conversation_id
    );
    UPDATE public.conversations
    SET last_message_at = pg_catalog.now()
    WHERE id = v_meetup.conversation_id;
    RETURN v_meetup;

  ELSIF p_action = 'decline' THEN
    UPDATE public.meetups
    SET status = 'declined', updated_at = pg_catalog.now()
    WHERE id = p_meetup_id
    RETURNING * INTO v_meetup;

    INSERT INTO public.notifications (
      user_id, type, title, body, item_id, conversation_id
    )
    VALUES (
      v_meetup.from_user,
      'meetup',
      '约定被婉拒 · Meetup declined',
      v_meetup.spot,
      v_meetup.item_id,
      v_meetup.conversation_id
    );
    RETURN v_meetup;

  ELSIF p_action = 'reschedule' THEN
    v_spot := pg_catalog.btrim(COALESCE(p_new_spot, ''));
    IF pg_catalog.char_length(v_spot) = 0 OR pg_catalog.char_length(v_spot) > 120 THEN
      RAISE EXCEPTION 'invalid spot' USING ERRCODE = '22023';
    END IF;
    IF p_new_meet_at IS NULL
       OR p_new_meet_at < pg_catalog.now() - interval '2 hours'
       OR p_new_meet_at > pg_catalog.now() + interval '90 days' THEN
      RAISE EXCEPTION 'invalid meet time' USING ERRCODE = '22023';
    END IF;

    UPDATE public.meetups
    SET status = 'rescheduled', updated_at = pg_catalog.now()
    WHERE id = p_meetup_id;

    INSERT INTO public.meetups (
      conversation_id, item_id, from_user, to_user, spot, meet_at, note, parent_meetup_id
    ) VALUES (
      v_meetup.conversation_id,
      v_meetup.item_id,
      v_uid,
      v_meetup.from_user,
      v_spot,
      p_new_meet_at,
      NULLIF(pg_catalog.btrim(COALESCE(p_new_note, '')), ''),
      v_meetup.id
    )
    RETURNING * INTO v_new;

    UPDATE public.conversations
    SET last_message_at = pg_catalog.now()
    WHERE id = v_meetup.conversation_id;

    INSERT INTO public.notifications (
      user_id, type, title, body, item_id, conversation_id
    )
    VALUES (
      v_meetup.from_user,
      'meetup',
      '新的见面提议 · Meetup updated',
      v_spot,
      v_meetup.item_id,
      v_meetup.conversation_id
    );
    RETURN v_new;

  ELSE
    RAISE EXCEPTION 'unknown action' USING ERRCODE = '22023';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_accepted_meetup(
  p_meetup_id uuid,
  p_new_spot text,
  p_new_meet_at timestamptz,
  expected_user_id_in uuid,
  p_new_note text DEFAULT NULL
) RETURNS public.meetups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_meetup public.meetups;
  v_new public.meetups;
  v_spot text;
  v_other uuid;
  v_item_status public.item_status;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_meetup
  FROM public.meetups
  WHERE id = p_meetup_id
  FOR UPDATE;

  IF v_meetup.id IS NULL
     OR v_uid NOT IN (v_meetup.from_user, v_meetup.to_user)
     OR NOT private.current_user_can_access_conversation(v_meetup.conversation_id) THEN
    RAISE EXCEPTION 'meetup_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT item.status INTO v_item_status
  FROM public.items AS item
  WHERE item.id = v_meetup.item_id;

  IF v_item_status IS NULL
     OR v_item_status IN ('sold'::public.item_status, 'deleted'::public.item_status) THEN
    RAISE EXCEPTION 'item_unavailable_for_meetup' USING ERRCODE = '55000';
  END IF;

  IF v_meetup.status <> 'accepted' THEN
    RAISE EXCEPTION 'only an accepted meetup can be rescheduled' USING ERRCODE = '55000';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_meetup.conversation_id::text)::bigint
  );

  IF EXISTS (
    SELECT 1 FROM public.meetups
    WHERE conversation_id = v_meetup.conversation_id
      AND status = 'pending'
      AND expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'a meetup proposal is already pending' USING ERRCODE = '55000';
  END IF;

  v_spot := pg_catalog.btrim(COALESCE(p_new_spot, ''));
  IF pg_catalog.char_length(v_spot) = 0 OR pg_catalog.char_length(v_spot) > 120 THEN
    RAISE EXCEPTION 'invalid spot' USING ERRCODE = '22023';
  END IF;
  IF p_new_meet_at IS NULL
     OR p_new_meet_at < pg_catalog.now() - interval '2 hours'
     OR p_new_meet_at > pg_catalog.now() + interval '90 days' THEN
    RAISE EXCEPTION 'invalid meet time' USING ERRCODE = '22023';
  END IF;

  v_other := CASE
    WHEN v_uid = v_meetup.from_user THEN v_meetup.to_user
    ELSE v_meetup.from_user
  END;

  UPDATE public.meetups
  SET status = 'rescheduled', updated_at = pg_catalog.now()
  WHERE id = p_meetup_id;

  INSERT INTO public.meetups (
    conversation_id, item_id, from_user, to_user, spot, meet_at, note, parent_meetup_id
  ) VALUES (
    v_meetup.conversation_id,
    v_meetup.item_id,
    v_uid,
    v_other,
    v_spot,
    p_new_meet_at,
    NULLIF(pg_catalog.btrim(COALESCE(p_new_note, '')), ''),
    v_meetup.id
  )
  RETURNING * INTO v_new;

  UPDATE public.conversations
  SET last_message_at = pg_catalog.now()
  WHERE id = v_meetup.conversation_id;

  INSERT INTO public.notifications (
    user_id, type, title, body, item_id, conversation_id
  )
  VALUES (
    v_other,
    'meetup',
    '改约请求 · Meetup change requested',
    v_spot,
    v_meetup.item_id,
    v_meetup.conversation_id
  );
  RETURN v_new;
END
$function$;

DO $retire_legacy_meetup_rpcs$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.propose_meetup(uuid,text,timestamp with time zone,text)'
  ) IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.propose_meetup(uuid, text, timestamptz, text)
      FROM PUBLIC, anon, authenticated, service_role;
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.respond_to_meetup(uuid,text,text,timestamp with time zone,text)'
  ) IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.respond_to_meetup(uuid, text, text, timestamptz, text)
      FROM PUBLIC, anon, authenticated, service_role;
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,text)'
  ) IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.reschedule_accepted_meetup(uuid, text, timestamptz, text)
      FROM PUBLIC, anon, authenticated, service_role;
  END IF;
END
$retire_legacy_meetup_rpcs$;

REVOKE ALL ON FUNCTION public.propose_meetup(uuid, text, timestamptz, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.respond_to_meetup(uuid, text, uuid, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reschedule_accepted_meetup(uuid, text, timestamptz, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.propose_meetup(uuid, text, timestamptz, uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_meetup(uuid, text, uuid, text, timestamptz, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_accepted_meetup(uuid, text, timestamptz, uuid, text)
  TO authenticated;
