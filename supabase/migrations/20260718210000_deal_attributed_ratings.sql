-- =============================================================================
-- Authoritative deal attribution and transaction-bound ratings.
--
-- Historical sold listings and ratings are deliberately left untouched. A sold
-- listing without a private item_deals row remains readable, but cannot acquire
-- new ratings: guessing a buyer from one of several conversations would turn an
-- inference into a false transaction fact.
--
-- New lifecycle:
--   accepted offer -> item owner selects that exact offer -> one private deal
--   row + status=sold + cancellation of other pending offers, atomically.
-- Only the two attributed parties can learn the counterparty through guarded
-- RPCs. The public items row keeps only status=sold, so anonymous callers cannot
-- enumerate who bought/requested an item.
-- =============================================================================

DO $precheck$
DECLARE
  required_relation text;
  required_function text;
BEGIN
  FOREACH required_relation IN ARRAY ARRAY[
    'public.items',
    'public.profiles',
    'public.conversations',
    'public.offers',
    'public.ratings',
    'public.notifications'
  ] LOOP
    IF pg_catalog.to_regclass(required_relation) IS NULL THEN
      RAISE EXCEPTION 'migration_precheck_failed: missing relation %',
        required_relation;
    END IF;
  END LOOP;

  FOREACH required_function IN ARRAY ARRAY[
    'auth.uid()',
    'public.guard_item_lifecycle_boundaries()',
    'public.notify_item_sold()',
    'public.recompute_profile_rating(uuid)'
  ] LOOP
    IF pg_catalog.to_regprocedure(required_function) IS NULL THEN
      RAISE EXCEPTION 'migration_precheck_failed: missing function %',
        required_function;
    END IF;
  END LOOP;

  IF pg_catalog.to_regnamespace('private') IS NULL THEN
    RAISE EXCEPTION 'migration_precheck_failed: private schema missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS offer_status_constraint
    WHERE offer_status_constraint.conrelid = 'public.offers'::pg_catalog.regclass
      AND offer_status_constraint.conname = 'offers_status_check'
      AND offer_status_constraint.contype = 'c'
      AND offer_status_constraint.convalidated
  ) THEN
    RAISE EXCEPTION 'migration_precheck_failed: offers status constraint drift';
  END IF;

  IF pg_catalog.to_regclass('private.item_deals') IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.get_item_sale_candidates(uuid,uuid)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.mark_item_sold(uuid,uuid,uuid)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.get_transaction_rating_eligibility(uuid,uuid)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.submit_transaction_rating(uuid,uuid,integer,text,uuid)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'migration_precheck_failed: deal attribution objects already exist';
  END IF;
END
$precheck$;

-- A listing finalization cancels still-open offers without mislabelling them as
-- declined or expired. Accepted offers remain historical evidence; exactly one
-- is selected into private.item_deals and becomes rating authority.
ALTER TABLE public.offers
  DROP CONSTRAINT offers_status_check;
ALTER TABLE public.offers
  ADD CONSTRAINT offers_status_check
  CHECK (status IN (
    'pending', 'accepted', 'declined', 'countered', 'expired', 'cancelled'
  ));

CREATE TABLE private.item_deals (
  item_id uuid PRIMARY KEY
    REFERENCES public.items(id) ON DELETE CASCADE,
  offer_id uuid UNIQUE
    REFERENCES public.offers(id) ON DELETE SET NULL,
  conversation_id uuid
    REFERENCES public.conversations(id) ON DELETE SET NULL,
  owner_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  counterparty_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  agreed_price numeric(10,2) NOT NULL
    CHECK (agreed_price >= 0 AND agreed_price <= 1000000),
  accepted_at timestamptz NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CHECK (owner_id IS NULL OR counterparty_id IS NULL OR owner_id <> counterparty_id)
);

COMMENT ON TABLE private.item_deals IS
  'Private immutable sale-attribution ledger. Participant links are cleared by FK SET NULL on account/conversation deletion; item owner deletion cascades the whole row.';
COMMENT ON COLUMN private.item_deals.offer_id IS
  'The exact accepted offer selected by the item owner; nullable only after trusted FK deletion.';
COMMENT ON COLUMN private.item_deals.counterparty_id IS
  'The non-item-owner conversation participant, independent of buyer/seller column labels; nullable only after account deletion.';

ALTER TABLE private.item_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.item_deals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.item_deals
  FROM PUBLIC, anon, authenticated, service_role;

-- Only the current item owner can enumerate eligible accepted offers. This RPC
-- returns the minimum fields needed by the confirmation UI and never exposes a
-- deal/counterparty through public.items.
CREATE FUNCTION public.get_item_sale_candidates(
  p_item_id uuid,
  expected_user_id_in uuid
)
RETURNS TABLE (
  offer_id uuid,
  conversation_id uuid,
  counterparty_id uuid,
  counterparty_name text,
  agreed_price numeric,
  accepted_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  item_owner_id uuid;
  item_state public.item_status;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM caller_id THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;

  SELECT item.user_id, item.status
    INTO item_owner_id, item_state
  FROM public.items AS item
  WHERE item.id = p_item_id;

  IF item_owner_id IS NULL OR item_owner_id <> caller_id THEN
    RAISE EXCEPTION 'item_unavailable' USING ERRCODE = '42501';
  END IF;
  IF item_state NOT IN ('active'::public.item_status, 'reserved'::public.item_status) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    selected_offer.id,
    selected_conversation.id,
    CASE
      WHEN selected_conversation.buyer_id = caller_id
        THEN selected_conversation.seller_id
      ELSE selected_conversation.buyer_id
    END AS counterparty_id,
    counterparty.nickname,
    selected_offer.price,
    selected_offer.updated_at
  FROM public.offers AS selected_offer
  INNER JOIN public.conversations AS selected_conversation
    ON selected_conversation.id = selected_offer.conversation_id
   AND selected_conversation.item_id = p_item_id
  INNER JOIN public.profiles AS counterparty
    ON counterparty.id = CASE
      WHEN selected_conversation.buyer_id = caller_id
        THEN selected_conversation.seller_id
      ELSE selected_conversation.buyer_id
    END
  WHERE selected_offer.item_id = p_item_id
    AND selected_offer.status = 'accepted'
    -- respond_to_offer writes updated_at at acceptance and refuses an already
    -- expired pending offer. Acceptance can remain valid after its 24h window;
    -- what must be true is that it was accepted no later than expires_at.
    AND selected_offer.updated_at <= selected_offer.expires_at
    AND selected_offer.updated_at >= selected_offer.created_at
    AND caller_id IN (
      selected_conversation.buyer_id,
      selected_conversation.seller_id
    )
    AND selected_conversation.buyer_id <> selected_conversation.seller_id
    AND selected_offer.from_user <> selected_offer.to_user
    AND (
      (
        selected_offer.from_user = selected_conversation.buyer_id
        AND selected_offer.to_user = selected_conversation.seller_id
      ) OR (
        selected_offer.from_user = selected_conversation.seller_id
        AND selected_offer.to_user = selected_conversation.buyer_id
      )
    )
  ORDER BY selected_offer.updated_at DESC, selected_offer.id;
END
$function$;

-- Item-row locking serializes two tabs selecting different accepted offers.
-- A response-lost retry with the same offer is idempotent; a different offer
-- receives an explicit conflict and cannot rewrite the authoritative deal.
CREATE FUNCTION public.mark_item_sold(
  p_item_id uuid,
  p_offer_id uuid,
  expected_user_id_in uuid
)
RETURNS public.items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  selected_item public.items;
  selected_offer public.offers;
  selected_conversation public.conversations;
  existing_deal private.item_deals;
  counterparty_id uuid;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM caller_id THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;
  IF p_item_id IS NULL OR p_offer_id IS NULL THEN
    RAISE EXCEPTION 'invalid_sale_selection' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO selected_item
  FROM public.items AS item
  WHERE item.id = p_item_id
  FOR UPDATE;

  -- Do not reveal whether another account owns the supplied item UUID.
  IF selected_item.id IS NULL OR selected_item.user_id <> caller_id THEN
    RAISE EXCEPTION 'item_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO existing_deal
  FROM private.item_deals AS deal
  WHERE deal.item_id = p_item_id;

  IF selected_item.status = 'sold'::public.item_status THEN
    IF existing_deal.item_id IS NOT NULL
       AND existing_deal.owner_id = caller_id
       AND existing_deal.offer_id = p_offer_id THEN
      RETURN selected_item;
    END IF;
    RAISE EXCEPTION 'sale_already_attributed' USING ERRCODE = '55000';
  END IF;

  IF selected_item.status NOT IN (
    'active'::public.item_status,
    'reserved'::public.item_status
  ) THEN
    RAISE EXCEPTION 'item_unavailable_for_sale' USING ERRCODE = '55000';
  END IF;
  IF existing_deal.item_id IS NOT NULL THEN
    RAISE EXCEPTION 'sale_attribution_conflict' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO selected_offer
  FROM public.offers AS selected_offer_row
  WHERE selected_offer_row.id = p_offer_id
  FOR UPDATE;

  IF selected_offer.id IS NOT NULL THEN
    SELECT * INTO selected_conversation
    FROM public.conversations AS selected_conversation_row
    WHERE selected_conversation_row.id = selected_offer.conversation_id
    FOR UPDATE;
  END IF;

  IF selected_offer.id IS NULL
     OR selected_conversation.id IS NULL
     OR selected_offer.status <> 'accepted'
     OR selected_offer.item_id IS DISTINCT FROM p_item_id
     OR selected_conversation.item_id IS DISTINCT FROM p_item_id
     OR selected_offer.conversation_id IS DISTINCT FROM selected_conversation.id
     OR selected_offer.updated_at > selected_offer.expires_at
     OR selected_offer.updated_at < selected_offer.created_at THEN
    RAISE EXCEPTION 'accepted_offer_unavailable' USING ERRCODE = '55000';
  END IF;

  IF selected_conversation.buyer_id = selected_conversation.seller_id
     OR caller_id NOT IN (
       selected_conversation.buyer_id,
       selected_conversation.seller_id
     )
     OR selected_offer.from_user = selected_offer.to_user
     OR NOT (
       (
         selected_offer.from_user = selected_conversation.buyer_id
         AND selected_offer.to_user = selected_conversation.seller_id
       ) OR (
         selected_offer.from_user = selected_conversation.seller_id
         AND selected_offer.to_user = selected_conversation.buyer_id
       )
     ) THEN
    RAISE EXCEPTION 'accepted_offer_participants_invalid' USING ERRCODE = '55000';
  END IF;

  counterparty_id := CASE
    WHEN selected_conversation.buyer_id = caller_id
      THEN selected_conversation.seller_id
    ELSE selected_conversation.buyer_id
  END;
  IF counterparty_id IS NULL OR counterparty_id = caller_id THEN
    RAISE EXCEPTION 'accepted_offer_counterparty_invalid' USING ERRCODE = '55000';
  END IF;

  INSERT INTO private.item_deals (
    item_id,
    offer_id,
    conversation_id,
    owner_id,
    counterparty_id,
    agreed_price,
    accepted_at,
    confirmed_at
  ) VALUES (
    p_item_id,
    p_offer_id,
    selected_conversation.id,
    caller_id,
    counterparty_id,
    selected_offer.price,
    selected_offer.updated_at,
    pg_catalog.statement_timestamp()
  );

  UPDATE public.offers AS open_offer
  SET status = 'cancelled',
      updated_at = pg_catalog.statement_timestamp()
  WHERE open_offer.status = 'pending'
    AND (
      open_offer.item_id = p_item_id
      OR EXISTS (
        SELECT 1
        FROM public.conversations AS offer_conversation
        WHERE offer_conversation.id = open_offer.conversation_id
          AND offer_conversation.item_id = p_item_id
      )
    );

  UPDATE public.items AS item
  SET status = 'sold'::public.item_status
  WHERE item.id = p_item_id
  RETURNING * INTO selected_item;

  IF selected_item.id IS NULL THEN
    RAISE EXCEPTION 'sale_status_update_failed' USING ERRCODE = '55000';
  END IF;

  -- notify_item_sold() owns favoritor notifications. This RPC intentionally
  -- adds none, so the transition and an idempotent retry cannot double-notify.
  RETURN selected_item;
END
$function$;

CREATE FUNCTION public.get_transaction_rating_eligibility(
  p_item_id uuid,
  expected_user_id_in uuid
)
RETURNS TABLE (
  eligible boolean,
  ratee_id uuid,
  ratee_nickname text,
  already_rated boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  item_state public.item_status;
  deal_owner_id uuid;
  deal_counterparty_id uuid;
  target_id uuid;
  target_name text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM caller_id THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;

  SELECT item.status, deal.owner_id, deal.counterparty_id
    INTO item_state, deal_owner_id, deal_counterparty_id
  FROM public.items AS item
  INNER JOIN private.item_deals AS deal ON deal.item_id = item.id
  WHERE item.id = p_item_id;

  IF item_state IS DISTINCT FROM 'sold'::public.item_status
     OR deal_owner_id IS NULL
     OR deal_counterparty_id IS NULL
     OR caller_id NOT IN (deal_owner_id, deal_counterparty_id) THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, false;
    RETURN;
  END IF;

  target_id := CASE
    WHEN caller_id = deal_owner_id THEN deal_counterparty_id
    ELSE deal_owner_id
  END;

  SELECT profile.nickname INTO target_name
  FROM public.profiles AS profile
  WHERE profile.id = target_id;

  IF target_name IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, false;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    true,
    target_id,
    target_name,
    EXISTS (
      SELECT 1
      FROM public.ratings AS rating
      WHERE rating.item_id = p_item_id
        AND rating.rater_id = caller_id
        AND rating.ratee_id = target_id
    );
END
$function$;

CREATE FUNCTION public.submit_transaction_rating(
  p_item_id uuid,
  p_ratee_id uuid,
  p_stars integer,
  p_comment text,
  expected_user_id_in uuid
)
RETURNS public.ratings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  item_state public.item_status;
  deal_owner_id uuid;
  deal_counterparty_id uuid;
  expected_ratee_id uuid;
  cleaned_comment text;
  existing_rating public.ratings;
  created_rating public.ratings;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM caller_id THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;
  IF p_stars IS NULL OR p_stars < 1 OR p_stars > 5 THEN
    RAISE EXCEPTION 'invalid_rating_stars' USING ERRCODE = '22023';
  END IF;

  cleaned_comment := NULLIF(pg_catalog.btrim(COALESCE(p_comment, '')), '');
  IF cleaned_comment IS NOT NULL AND pg_catalog.length(cleaned_comment) > 500 THEN
    RAISE EXCEPTION 'rating_comment_too_long' USING ERRCODE = '22023';
  END IF;

  -- The item lock serializes two tabs submitting the same direction. This lets
  -- a response-lost retry return the identical row while rejecting an attempt
  -- to rewrite stars/comment under the original unique key.
  SELECT item.status, deal.owner_id, deal.counterparty_id
    INTO item_state, deal_owner_id, deal_counterparty_id
  FROM public.items AS item
  INNER JOIN private.item_deals AS deal ON deal.item_id = item.id
  WHERE item.id = p_item_id
  FOR UPDATE OF item;

  IF item_state IS DISTINCT FROM 'sold'::public.item_status
     OR deal_owner_id IS NULL
     OR deal_counterparty_id IS NULL
     OR caller_id NOT IN (deal_owner_id, deal_counterparty_id) THEN
    RAISE EXCEPTION 'rating_not_permitted' USING ERRCODE = '42501';
  END IF;

  expected_ratee_id := CASE
    WHEN caller_id = deal_owner_id THEN deal_counterparty_id
    ELSE deal_owner_id
  END;
  IF p_ratee_id IS DISTINCT FROM expected_ratee_id THEN
    RAISE EXCEPTION 'rating_not_permitted' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO existing_rating
  FROM public.ratings AS rating
  WHERE rating.item_id = p_item_id
    AND rating.rater_id = caller_id
    AND rating.ratee_id = expected_ratee_id;

  IF existing_rating.id IS NOT NULL THEN
    IF existing_rating.stars = p_stars
       AND existing_rating.comment IS NOT DISTINCT FROM cleaned_comment THEN
      RETURN existing_rating;
    END IF;
    RAISE EXCEPTION 'rating_already_submitted' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.ratings (
    rater_id, ratee_id, item_id, stars, comment
  ) VALUES (
    caller_id, expected_ratee_id, p_item_id, p_stars, cleaned_comment
  )
  RETURNING * INTO created_rating;

  RETURN created_rating;
END
$function$;

-- Direct sold transitions must fail even though authenticated still needs the
-- status column for active <-> reserved. Trusted writes also require a private
-- deal row, so service/admin code cannot accidentally recreate unattributed
-- sold inventory.
CREATE FUNCTION public.guard_item_sale_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'sold'::public.item_status THEN
    IF current_user IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'mark_item_sold_rpc_required' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM private.item_deals AS deal
      WHERE deal.item_id = NEW.id
        AND deal.owner_id = NEW.user_id
        AND deal.offer_id IS NOT NULL
        AND deal.conversation_id IS NOT NULL
        AND deal.counterparty_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'item_sale_attribution_required' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.guard_item_sale_attribution()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS item_deal_attribution_guard ON public.items;
CREATE TRIGGER item_deal_attribution_guard
  BEFORE UPDATE OF status ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_item_sale_attribution();

-- New ratings are RPC-only. Existing rows and the public read policy remain
-- unchanged, so the migration never deletes or hides historical reviews.
DROP POLICY IF EXISTS "Participants can rate sold items" ON public.ratings;
DROP POLICY IF EXISTS "Raters can delete own rating" ON public.ratings;
REVOKE INSERT, DELETE ON public.ratings FROM PUBLIC, anon, authenticated;
-- Migration 20260717092804 deliberately granted INSERT at column scope. A
-- table-level REVOKE does not remove that ACL, so revoke the exact historical
-- grant too; otherwise clients could still bypass the authoritative RPC.
REVOKE INSERT (rater_id, ratee_id, item_id, stars, comment)
  ON public.ratings FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_item_sale_candidates(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_item_sold(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_transaction_rating_eligibility(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_transaction_rating(
  uuid, uuid, integer, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_item_sale_candidates(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_item_sold(uuid, uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_transaction_rating_eligibility(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_transaction_rating(
  uuid, uuid, integer, text, uuid
) TO authenticated;
