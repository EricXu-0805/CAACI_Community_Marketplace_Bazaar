-- ============================================
-- 20260903013000 — Let a listing be deleted once someone has chatted about it
-- ============================================
-- conversations.item_id is ON DELETE SET NULL (001). enforce_conversation_flag_
-- ownership (013) is a BEFORE UPDATE trigger that refuses any change to
-- item_id as 'immutable_participant_fields'. The referential action is an
-- UPDATE, it runs in the seller's own session, and the seller is a participant
-- — so the guard fires and the DELETE on items rolls back.
--
-- Measured on production 2026-09-02 as the owner, through the app:
--   DELETE /rest/v1/items?id=eq.38b08291-…  →  400 P0001 immutable_participant_fields
-- and the app says "Something went wrong". Every listing with a conversation
-- is undeletable by its seller; only the four that nobody had messaged went.
--
-- The guard keeps its purpose: a participant still cannot re-point a
-- conversation at another listing. What it now allows is exactly the cascade:
-- item_id going to NULL while the listing it pointed at no longer exists. A
-- manual UPDATE setting item_id = NULL on a live listing is still refused,
-- because the row in items is still there.
--
-- Same body as 013 otherwise, re-issued in full. Privileges survive CREATE OR
-- REPLACE (057 revoked EXECUTE from public/anon/authenticated).

CREATE OR REPLACE FUNCTION public.enforce_conversation_flag_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  -- Service-role / trigger context: skip check
  IF uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Non-participants shouldn't get here (RLS blocks them) but
  -- guard anyway
  IF uid <> OLD.buyer_id AND uid <> OLD.seller_id THEN
    RAISE EXCEPTION 'not_a_participant';
  END IF;

  -- Only the buyer may change buyer flags
  IF uid <> OLD.buyer_id THEN
    IF NEW.is_pinned_buyer IS DISTINCT FROM OLD.is_pinned_buyer
       OR NEW.is_muted_buyer  IS DISTINCT FROM OLD.is_muted_buyer THEN
      RAISE EXCEPTION 'cross_party_flag_update'
        USING HINT = 'Only the buyer can change their own pin/mute state.';
    END IF;
  END IF;

  -- Only the seller may change seller flags
  IF uid <> OLD.seller_id THEN
    IF NEW.is_pinned_seller IS DISTINCT FROM OLD.is_pinned_seller
       OR NEW.is_muted_seller  IS DISTINCT FROM OLD.is_muted_seller THEN
      RAISE EXCEPTION 'cross_party_flag_update'
        USING HINT = 'Only the seller can change their own pin/mute state.';
    END IF;
  END IF;

  -- buyer_id / seller_id immutable
  IF NEW.buyer_id  IS DISTINCT FROM OLD.buyer_id
     OR NEW.seller_id IS DISTINCT FROM OLD.seller_id THEN
    RAISE EXCEPTION 'immutable_participant_fields';
  END IF;

  -- item_id immutable, except for the ON DELETE SET NULL cascade: by the time
  -- the referential action updates this row, the listing is already gone.
  IF NEW.item_id IS DISTINCT FROM OLD.item_id THEN
    IF NEW.item_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.items WHERE id = OLD.item_id) THEN
      RAISE EXCEPTION 'immutable_participant_fields';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
