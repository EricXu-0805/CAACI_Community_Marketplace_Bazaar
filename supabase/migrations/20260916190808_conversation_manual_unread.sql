SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='60s';
-- Manual inbox reminders must work on empty/outgoing-only threads and must
-- never falsify the other participant's already-delivered read receipts.
ALTER TABLE public.conversations
  ADD COLUMN is_unread_buyer boolean NOT NULL DEFAULT false,
  ADD COLUMN is_unread_seller boolean NOT NULL DEFAULT false;

CREATE FUNCTION private.guard_conversation_manual_unread()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid();
BEGIN
  IF actor IS NULL THEN RETURN NEW; END IF;
  IF (NEW.is_unread_buyer IS DISTINCT FROM OLD.is_unread_buyer AND actor <> OLD.buyer_id)
    OR (NEW.is_unread_seller IS DISTINCT FROM OLD.is_unread_seller AND actor <> OLD.seller_id) THEN
    RAISE EXCEPTION 'cross_party_flag_update' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_conversation_manual_unread() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_conversation_manual_unread
  BEFORE UPDATE ON public.conversations FOR EACH ROW
  EXECUTE FUNCTION private.guard_conversation_manual_unread();

CREATE FUNCTION public.set_conversation_read_state(
  conversation_id_in uuid, expected_user_id_in uuid, unread_in boolean
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); matched uuid;
BEGIN
  IF actor IS NULL OR actor IS DISTINCT FROM expected_user_id_in OR unread_in IS NULL THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;
  -- RLS still applies, including participant, block and suspension checks.
  -- A zero-row update is an error, not a successful action with no effect.
  UPDATE public.conversations c SET
    is_unread_buyer = CASE WHEN c.buyer_id = actor THEN unread_in ELSE c.is_unread_buyer END,
    is_unread_seller = CASE WHEN c.seller_id = actor THEN unread_in ELSE c.is_unread_seller END
  WHERE c.id = conversation_id_in AND actor IN (c.buyer_id, c.seller_id)
  RETURNING c.id INTO matched;
  IF matched IS NULL THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;
  IF NOT unread_in THEN
    UPDATE public.messages SET is_read = true
    WHERE conversation_id = conversation_id_in AND sender_id <> actor AND is_read = false;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_conversation_read_state(uuid,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_conversation_read_state(uuid,uuid,boolean) TO authenticated;
-- Existing column ACLs may be narrower than table UPDATE grants.
GRANT SELECT (is_unread_buyer,is_unread_seller), UPDATE (is_unread_buyer,is_unread_seller)
  ON public.conversations TO authenticated;
NOTIFY pgrst, 'reload schema';
