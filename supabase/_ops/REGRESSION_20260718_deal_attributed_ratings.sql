-- Isolated/local behavioral regression for authoritative deal attribution and
-- transaction-bound ratings (migration 20260718210000).
-- NEVER run against production. Every fixture mutation is rolled back.

\set ON_ERROR_STOP on

BEGIN;

DO $preflight$
DECLARE
  function_source text;
BEGIN
  IF pg_catalog.to_regclass('private.item_deals') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.get_item_sale_candidates(uuid,uuid)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.mark_item_sold(uuid,uuid,uuid)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.get_transaction_rating_eligibility(uuid,uuid)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.submit_transaction_rating(uuid,uuid,integer,text,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'regression_preflight_failed: deal-attribution migration is not applied';
  END IF;

  -- The behavioral loser case below is the state observed by a transaction
  -- after a concurrent winner commits. Keep the lock assertion here so the
  -- sequential replay cannot silently stop representing real two-tab races.
  SELECT pg_catalog.pg_get_functiondef(
    'public.mark_item_sold(uuid,uuid,uuid)'::pg_catalog.regprocedure
  ) INTO function_source;
  IF pg_catalog.strpos(function_source, 'FOR UPDATE') = 0 THEN
    RAISE EXCEPTION
      'regression_preflight_failed: mark_item_sold no longer serializes item selection';
  END IF;
END
$preflight$;

-- Users:
--   001 ordinary listing owner
--   002 selected counterparty (deleted at the end)
--   003 alternate accepted-offer counterparty
--   004 pending-offer counterparty
--   005 unrelated/malformed participant
--   006 favoritor
--   007 wanted-listing owner (owner appears in buyer_id)
--   008 wanted-listing counterparty (appears in seller_id)
--   009 legacy rater
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('9d000000-0000-4000-8000-000000000001', 'deal-owner@example.test', '{}'::jsonb),
  ('9d000000-0000-4000-8000-000000000002', 'deal-selected@example.test', '{}'::jsonb),
  ('9d000000-0000-4000-8000-000000000003', 'deal-alternate@example.test', '{}'::jsonb),
  ('9d000000-0000-4000-8000-000000000004', 'deal-pending@example.test', '{}'::jsonb),
  ('9d000000-0000-4000-8000-000000000005', 'deal-outsider@example.test', '{}'::jsonb),
  ('9d000000-0000-4000-8000-000000000006', 'deal-favoritor@example.test', '{}'::jsonb),
  ('9d000000-0000-4000-8000-000000000007', 'deal-wanted-owner@example.test', '{}'::jsonb),
  ('9d000000-0000-4000-8000-000000000008', 'deal-wanted-other@example.test', '{}'::jsonb),
  ('9d000000-0000-4000-8000-000000000009', 'deal-legacy-rater@example.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname) VALUES
  ('9d000000-0000-4000-8000-000000000001', 'Deal Owner'),
  ('9d000000-0000-4000-8000-000000000002', 'Selected Counterparty'),
  ('9d000000-0000-4000-8000-000000000003', 'Alternate Counterparty'),
  ('9d000000-0000-4000-8000-000000000004', 'Pending Counterparty'),
  ('9d000000-0000-4000-8000-000000000005', 'Unrelated Account'),
  ('9d000000-0000-4000-8000-000000000006', 'Sale Favoritor'),
  ('9d000000-0000-4000-8000-000000000007', 'Wanted Owner'),
  ('9d000000-0000-4000-8000-000000000008', 'Wanted Counterparty'),
  ('9d000000-0000-4000-8000-000000000009', 'Legacy Rater')
ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname;

INSERT INTO public.items (
  id, user_id, title, description, price, category, condition, status,
  listing_type
) VALUES
  (
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000001',
    'Attributed active sale', 'multi-conversation fixture', 100,
    'other', 'good', 'active', 'sell'
  ),
  (
    '9d100000-0000-4000-8000-000000000002',
    '9d000000-0000-4000-8000-000000000007',
    'Attributed wanted listing', 'owner is conversation buyer', 80,
    'other', 'good', 'reserved', 'wanted'
  ),
  (
    '9d100000-0000-4000-8000-000000000003',
    '9d000000-0000-4000-8000-000000000001',
    'Wrong-item fixture', 'must remain open', 40,
    'other', 'good', 'active', 'sell'
  ),
  (
    '9d100000-0000-4000-8000-000000000004',
    '9d000000-0000-4000-8000-000000000001',
    'Legacy sold without deal', 'pre-migration history', 20,
    'other', 'good', 'sold', 'sell'
  );

INSERT INTO public.conversations (
  id, item_id, buyer_id, seller_id, last_message_at
) VALUES
  (
    '9d200000-0000-4000-8000-000000000001',
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000002',
    '9d000000-0000-4000-8000-000000000001',
    pg_catalog.now()
  ),
  (
    '9d200000-0000-4000-8000-000000000002',
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000003',
    '9d000000-0000-4000-8000-000000000001',
    pg_catalog.now()
  ),
  (
    '9d200000-0000-4000-8000-000000000003',
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000004',
    '9d000000-0000-4000-8000-000000000001',
    pg_catalog.now()
  ),
  (
    '9d200000-0000-4000-8000-000000000004',
    '9d100000-0000-4000-8000-000000000003',
    '9d000000-0000-4000-8000-000000000005',
    '9d000000-0000-4000-8000-000000000001',
    pg_catalog.now()
  ),
  (
    '9d200000-0000-4000-8000-000000000005',
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000001',
    pg_catalog.now()
  ),
  (
    '9d200000-0000-4000-8000-000000000006',
    '9d100000-0000-4000-8000-000000000002',
    '9d000000-0000-4000-8000-000000000007',
    '9d000000-0000-4000-8000-000000000008',
    pg_catalog.now()
  );

-- Main item has two independently accepted offers, two pending offers, and
-- isolated malformed accepted rows. Only 301 and 302 are valid sale candidates.
INSERT INTO public.offers (
  id, conversation_id, item_id, from_user, to_user, price, status,
  expires_at, created_at, updated_at, note
) VALUES
  (
    '9d300000-0000-4000-8000-000000000001',
    '9d200000-0000-4000-8000-000000000001',
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000002',
    '9d000000-0000-4000-8000-000000000001',
    90, 'accepted', pg_catalog.now() + interval '20 hours',
    pg_catalog.now() - interval '4 hours',
    pg_catalog.now() - interval '1 hour', 'selected accepted offer'
  ),
  (
    '9d300000-0000-4000-8000-000000000002',
    '9d200000-0000-4000-8000-000000000002',
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000003',
    '9d000000-0000-4000-8000-000000000001',
    92, 'accepted', pg_catalog.now() + interval '20 hours',
    pg_catalog.now() - interval '4 hours',
    pg_catalog.now() - interval '30 minutes', 'alternate accepted history'
  ),
  (
    '9d300000-0000-4000-8000-000000000003',
    '9d200000-0000-4000-8000-000000000002',
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000003',
    85, 'pending', pg_catalog.now() + interval '22 hours',
    pg_catalog.now() - interval '2 hours',
    pg_catalog.now() - interval '2 hours', 'pending with direct item link'
  ),
  (
    '9d300000-0000-4000-8000-000000000004',
    '9d200000-0000-4000-8000-000000000003',
    NULL,
    '9d000000-0000-4000-8000-000000000004',
    '9d000000-0000-4000-8000-000000000001',
    86, 'pending', pg_catalog.now() + interval '22 hours',
    pg_catalog.now() - interval '2 hours',
    pg_catalog.now() - interval '2 hours', 'pending linked only by conversation'
  ),
  (
    '9d300000-0000-4000-8000-000000000005',
    '9d200000-0000-4000-8000-000000000004',
    '9d100000-0000-4000-8000-000000000003',
    '9d000000-0000-4000-8000-000000000005',
    '9d000000-0000-4000-8000-000000000001',
    35, 'pending', pg_catalog.now() + interval '22 hours',
    pg_catalog.now() - interval '2 hours',
    pg_catalog.now() - interval '2 hours', 'unrelated pending must survive'
  ),
  -- offer.item_id does not match its conversation/item selection
  (
    '9d300000-0000-4000-8000-000000000006',
    '9d200000-0000-4000-8000-000000000001',
    '9d100000-0000-4000-8000-000000000003',
    '9d000000-0000-4000-8000-000000000002',
    '9d000000-0000-4000-8000-000000000001',
    70, 'accepted', pg_catalog.now() + interval '20 hours',
    pg_catalog.now() - interval '4 hours',
    pg_catalog.now() - interval '1 hour', 'wrong offer item'
  ),
  -- conversation.item_id does not match the requested main item
  (
    '9d300000-0000-4000-8000-000000000007',
    '9d200000-0000-4000-8000-000000000004',
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000005',
    '9d000000-0000-4000-8000-000000000001',
    71, 'accepted', pg_catalog.now() + interval '20 hours',
    pg_catalog.now() - interval '4 hours',
    pg_catalog.now() - interval '1 hour', 'wrong conversation item'
  ),
  -- from/to users do not match conversation participants
  (
    '9d300000-0000-4000-8000-000000000008',
    '9d200000-0000-4000-8000-000000000002',
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000005',
    '9d000000-0000-4000-8000-000000000001',
    72, 'accepted', pg_catalog.now() + interval '20 hours',
    pg_catalog.now() - interval '4 hours',
    pg_catalog.now() - interval '1 hour', 'forged participant'
  ),
  -- self-conversation and self-offer cannot create a counterparty
  (
    '9d300000-0000-4000-8000-000000000009',
    '9d200000-0000-4000-8000-000000000005',
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000001',
    73, 'accepted', pg_catalog.now() + interval '20 hours',
    pg_catalog.now() - interval '4 hours',
    pg_catalog.now() - interval '1 hour', 'self offer'
  ),
  -- status says accepted, but acceptance timestamp is after expiry
  (
    '9d300000-0000-4000-8000-000000000010',
    '9d200000-0000-4000-8000-000000000003',
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000004',
    '9d000000-0000-4000-8000-000000000001',
    74, 'accepted', pg_catalog.now() - interval '1 hour',
    pg_catalog.now() - interval '2 days',
    pg_catalog.now(), 'accepted after expiry'
  ),
  -- valid wanted-listing offer: the item owner is buyer_id, not seller_id
  (
    '9d300000-0000-4000-8000-000000000011',
    '9d200000-0000-4000-8000-000000000006',
    '9d100000-0000-4000-8000-000000000002',
    '9d000000-0000-4000-8000-000000000008',
    '9d000000-0000-4000-8000-000000000007',
    75, 'accepted', pg_catalog.now() + interval '20 hours',
    pg_catalog.now() - interval '4 hours',
    pg_catalog.now() - interval '1 hour', 'wanted-listing accepted offer'
  );

INSERT INTO public.favorites (id, user_id, item_id) VALUES
  (
    '9d500000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000006',
    '9d100000-0000-4000-8000-000000000001'
  ),
  (
    '9d500000-0000-4000-8000-000000000002',
    '9d000000-0000-4000-8000-000000000006',
    '9d100000-0000-4000-8000-000000000002'
  );

-- Simulate pre-migration history after the new migration is already installed:
-- privileged fixture setup may create it, while client mutation remains closed.
INSERT INTO public.ratings (
  id, rater_id, ratee_id, item_id, stars, comment
) VALUES (
  '9d400000-0000-4000-8000-000000000001',
  '9d000000-0000-4000-8000-000000000009',
  '9d000000-0000-4000-8000-000000000001',
  '9d100000-0000-4000-8000-000000000004',
  5,
  'legacy rating remains readable'
);

-- Only the owner can enumerate candidates. All malformed accepted rows are
-- excluded, leaving the two independently accepted and valid offers.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000001',
  true
);

DO $candidate_boundary$
DECLARE
  candidate_count integer;
  candidate_counterparties uuid[];
BEGIN
  SELECT pg_catalog.count(*),
         pg_catalog.array_agg(candidate.counterparty_id ORDER BY candidate.offer_id)
    INTO candidate_count, candidate_counterparties
  FROM public.get_item_sale_candidates(
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000001'
  ) AS candidate;

  IF candidate_count <> 2
     OR candidate_counterparties IS DISTINCT FROM ARRAY[
       '9d000000-0000-4000-8000-000000000002'::uuid,
       '9d000000-0000-4000-8000-000000000003'::uuid
     ] THEN
    RAISE EXCEPTION
      'candidate filter leaked malformed offers or lost valid offers: count %, users %',
      candidate_count,
      candidate_counterparties;
  END IF;

  BEGIN
    PERFORM public.get_item_sale_candidates(
      '9d100000-0000-4000-8000-000000000001',
      '9d000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'stale-account candidate request unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'account_changed' THEN RAISE; END IF;
  END;

  -- Even the correct owner cannot bypass the attributed RPC with a direct
  -- active -> sold update.
  BEGIN
    UPDATE public.items
    SET status = 'sold'
    WHERE id = '9d100000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'direct owner sold transition unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'mark_item_sold_rpc_required' THEN RAISE; END IF;
  END;
END
$candidate_boundary$;

-- A non-owner cannot enumerate or finalize the listing.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000002',
  true
);

DO $non_owner_boundary$
BEGIN
  BEGIN
    PERFORM public.get_item_sale_candidates(
      '9d100000-0000-4000-8000-000000000001',
      '9d000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'non-owner enumerated sale candidates';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'item_unavailable' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.mark_item_sold(
      '9d100000-0000-4000-8000-000000000001',
      '9d300000-0000-4000-8000-000000000001',
      '9d000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'non-owner finalized another account listing';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'item_unavailable' THEN RAISE; END IF;
  END;
END
$non_owner_boundary$;

-- Restore the owner and prove each malformed accepted-offer edge fails before
-- any item/deal state is written.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000001',
  true
);

DO $invalid_offer_boundaries$
DECLARE
  invalid_case record;
BEGIN
  FOR invalid_case IN
    SELECT *
    FROM (VALUES
      (
        'wrong offer.item_id',
        '9d300000-0000-4000-8000-000000000006'::uuid,
        'accepted_offer_unavailable'
      ),
      (
        'wrong conversation.item_id',
        '9d300000-0000-4000-8000-000000000007'::uuid,
        'accepted_offer_unavailable'
      ),
      (
        'forged offer participant',
        '9d300000-0000-4000-8000-000000000008'::uuid,
        'accepted_offer_participants_invalid'
      ),
      (
        'self conversation/offer',
        '9d300000-0000-4000-8000-000000000009'::uuid,
        'accepted_offer_participants_invalid'
      ),
      (
        'accepted after expiry',
        '9d300000-0000-4000-8000-000000000010'::uuid,
        'accepted_offer_unavailable'
      ),
      (
        'pending instead of accepted',
        '9d300000-0000-4000-8000-000000000003'::uuid,
        'accepted_offer_unavailable'
      )
    ) AS cases(case_name, offer_id, expected_error)
  LOOP
    BEGIN
      PERFORM public.mark_item_sold(
        '9d100000-0000-4000-8000-000000000001',
        invalid_case.offer_id,
        '9d000000-0000-4000-8000-000000000001'
      );
      RAISE EXCEPTION 'invalid sale case unexpectedly succeeded: %',
        invalid_case.case_name;
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
      IF SQLERRM <> invalid_case.expected_error THEN
        RAISE EXCEPTION 'invalid sale case % returned %, expected %',
          invalid_case.case_name,
          SQLERRM,
          invalid_case.expected_error;
      END IF;
    END;
  END LOOP;

  IF (
    SELECT status FROM public.items
    WHERE id = '9d100000-0000-4000-8000-000000000001'
  ) <> 'active'::public.item_status THEN
    RAISE EXCEPTION 'rejected offer selection changed item state';
  END IF;
END
$invalid_offer_boundaries$;

-- Inspect the private half of the atomicity assertion only as the migration
-- owner; browser roles deliberately have no private.item_deals privileges.
RESET ROLE;
DO $invalid_offer_private_atomicity$
BEGIN
  IF EXISTS (
    SELECT 1 FROM private.item_deals
    WHERE item_id = '9d100000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'rejected offer selection left a partial private deal';
  END IF;
END
$invalid_offer_private_atomicity$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000001',
  true
);

-- Select exactly one accepted offer. The real item row lock makes this call the
-- winner in a concurrent race; a later different-offer call below exercises the
-- serialized loser state.
SELECT public.mark_item_sold(
  '9d100000-0000-4000-8000-000000000001',
  '9d300000-0000-4000-8000-000000000001',
  '9d000000-0000-4000-8000-000000000001'
);

RESET ROLE;

DO $main_sale_verify$
DECLARE
  deal_row private.item_deals%ROWTYPE;
  notification_count integer;
BEGIN
  SELECT * INTO STRICT deal_row
  FROM private.item_deals
  WHERE item_id = '9d100000-0000-4000-8000-000000000001';

  IF deal_row.offer_id <> '9d300000-0000-4000-8000-000000000001'
     OR deal_row.conversation_id <>
       '9d200000-0000-4000-8000-000000000001'
     OR deal_row.owner_id <> '9d000000-0000-4000-8000-000000000001'
     OR deal_row.counterparty_id <>
       '9d000000-0000-4000-8000-000000000002'
     OR deal_row.agreed_price <> 90
     OR deal_row.accepted_at IS DISTINCT FROM (
       SELECT updated_at FROM public.offers
       WHERE id = '9d300000-0000-4000-8000-000000000001'
     ) THEN
    RAISE EXCEPTION 'private deal did not preserve exact selected offer facts';
  END IF;

  IF (
    SELECT status FROM public.items
    WHERE id = '9d100000-0000-4000-8000-000000000001'
  ) <> 'sold'::public.item_status THEN
    RAISE EXCEPTION 'active listing did not transition to sold';
  END IF;

  IF (
    SELECT status FROM public.offers
    WHERE id = '9d300000-0000-4000-8000-000000000001'
  ) <> 'accepted'
     OR (
       SELECT status FROM public.offers
       WHERE id = '9d300000-0000-4000-8000-000000000002'
     ) <> 'accepted' THEN
    RAISE EXCEPTION 'accepted offer history was rewritten during finalization';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.offers
    WHERE id IN (
      '9d300000-0000-4000-8000-000000000003',
      '9d300000-0000-4000-8000-000000000004'
    )
      AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'other pending offers were not atomically cancelled';
  END IF;

  IF (
    SELECT status FROM public.offers
    WHERE id = '9d300000-0000-4000-8000-000000000005'
  ) <> 'pending' THEN
    RAISE EXCEPTION 'unrelated item pending offer was cancelled';
  END IF;

  SELECT pg_catalog.count(*) INTO notification_count
  FROM public.notifications
  WHERE user_id = '9d000000-0000-4000-8000-000000000006'
    AND item_id = '9d100000-0000-4000-8000-000000000001'
    AND type = 'sold';
  IF notification_count <> 1 THEN
    RAISE EXCEPTION 'active -> sold emitted % notifications instead of one',
      notification_count;
  END IF;
END
$main_sale_verify$;

-- Same-offer response-loss retry is a no-op; a different accepted offer is the
-- serialized concurrent loser and cannot rewrite attribution.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000001',
  true
);

SELECT public.mark_item_sold(
  '9d100000-0000-4000-8000-000000000001',
  '9d300000-0000-4000-8000-000000000001',
  '9d000000-0000-4000-8000-000000000001'
);

DO $sale_retry_boundary$
BEGIN
  BEGIN
    PERFORM public.mark_item_sold(
      '9d100000-0000-4000-8000-000000000001',
      '9d300000-0000-4000-8000-000000000002',
      '9d000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'different offer rewrote an attributed sale';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'sale_already_attributed' THEN RAISE; END IF;
  END;

END
$sale_retry_boundary$;

RESET ROLE;
DO $sale_retry_notification_verify$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM public.notifications
    WHERE user_id = '9d000000-0000-4000-8000-000000000006'
      AND item_id = '9d100000-0000-4000-8000-000000000001'
      AND type = 'sold'
  ) <> 1 THEN
    RAISE EXCEPTION 'idempotent retry duplicated sold notification';
  END IF;
END
$sale_retry_notification_verify$;

-- Wanted listing: the listing owner is buyer_id, so seller/buyer labels must
-- not determine the deal role. Derive the counterparty as the other participant.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000007',
  true
);

DO $wanted_candidate$
DECLARE
  candidate record;
BEGIN
  SELECT * INTO STRICT candidate
  FROM public.get_item_sale_candidates(
    '9d100000-0000-4000-8000-000000000002',
    '9d000000-0000-4000-8000-000000000007'
  );
  IF candidate.offer_id <> '9d300000-0000-4000-8000-000000000011'
     OR candidate.counterparty_id <>
       '9d000000-0000-4000-8000-000000000008' THEN
    RAISE EXCEPTION 'wanted candidate trusted buyer/seller labels';
  END IF;
END
$wanted_candidate$;

SELECT public.mark_item_sold(
  '9d100000-0000-4000-8000-000000000002',
  '9d300000-0000-4000-8000-000000000011',
  '9d000000-0000-4000-8000-000000000007'
);

RESET ROLE;

DO $wanted_sale_verify$
DECLARE
  deal_row private.item_deals%ROWTYPE;
BEGIN
  SELECT * INTO STRICT deal_row
  FROM private.item_deals
  WHERE item_id = '9d100000-0000-4000-8000-000000000002';

  IF deal_row.owner_id <> '9d000000-0000-4000-8000-000000000007'
     OR deal_row.counterparty_id <>
       '9d000000-0000-4000-8000-000000000008'
     OR (
       SELECT status FROM public.items
       WHERE id = '9d100000-0000-4000-8000-000000000002'
     ) <> 'sold'::public.item_status THEN
    RAISE EXCEPTION 'reserved wanted listing attribution is incorrect';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM public.notifications
    WHERE user_id = '9d000000-0000-4000-8000-000000000006'
      AND item_id = '9d100000-0000-4000-8000-000000000002'
      AND type = 'sold'
  ) <> 1 THEN
    RAISE EXCEPTION 'reserved -> sold notification did not fire exactly once';
  END IF;
END
$wanted_sale_verify$;

-- Owner eligibility and owner -> counterparty rating. Exact normalized-content
-- replay returns the same row; changed score cannot rewrite reputation history.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000001',
  true
);

DO $owner_rating_boundary$
DECLARE
  eligibility record;
  first_rating public.ratings;
  retried_rating public.ratings;
BEGIN
  SELECT * INTO STRICT eligibility
  FROM public.get_transaction_rating_eligibility(
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000001'
  );
  IF NOT eligibility.eligible
     OR eligibility.ratee_id <>
       '9d000000-0000-4000-8000-000000000002'
     OR eligibility.ratee_nickname <> 'Selected Counterparty'
     OR eligibility.already_rated THEN
    RAISE EXCEPTION 'owner received incorrect rating eligibility';
  END IF;

  SELECT * INTO STRICT first_rating
  FROM public.submit_transaction_rating(
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000002',
    5,
    '  trustworthy transaction  ',
    '9d000000-0000-4000-8000-000000000001'
  );

  SELECT * INTO STRICT retried_rating
  FROM public.submit_transaction_rating(
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000002',
    5,
    'trustworthy transaction',
    '9d000000-0000-4000-8000-000000000001'
  );
  IF first_rating.id <> retried_rating.id
     OR retried_rating.comment <> 'trustworthy transaction' THEN
    RAISE EXCEPTION 'identical normalized rating retry was not idempotent';
  END IF;

  BEGIN
    PERFORM public.submit_transaction_rating(
      '9d100000-0000-4000-8000-000000000001',
      '9d000000-0000-4000-8000-000000000002',
      4,
      'trustworthy transaction',
      '9d000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'rating score rewrite unexpectedly succeeded';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'rating_already_submitted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.submit_transaction_rating(
      '9d100000-0000-4000-8000-000000000001',
      '9d000000-0000-4000-8000-000000000003',
      5,
      'forged alternate counterparty',
      '9d000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'owner rated an unselected accepted-offer participant';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'rating_not_permitted' THEN RAISE; END IF;
  END;

  SELECT * INTO STRICT eligibility
  FROM public.get_transaction_rating_eligibility(
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000001'
  );
  IF NOT eligibility.already_rated THEN
    RAISE EXCEPTION 'eligibility did not reflect submitted owner rating';
  END IF;

  -- Ratings are immutable at the browser-table boundary.
  BEGIN
    DELETE FROM public.ratings
    WHERE id = first_rating.id;
    RAISE EXCEPTION 'direct rating delete unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$owner_rating_boundary$;

-- The selected counterparty can rate the owner in the reverse direction.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000002',
  true
);

DO $counterparty_rating_boundary$
DECLARE
  eligibility record;
  created_rating public.ratings;
BEGIN
  SELECT * INTO STRICT eligibility
  FROM public.get_transaction_rating_eligibility(
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000002'
  );
  IF NOT eligibility.eligible
     OR eligibility.ratee_id <>
       '9d000000-0000-4000-8000-000000000001'
     OR eligibility.already_rated THEN
    RAISE EXCEPTION 'counterparty received incorrect rating eligibility';
  END IF;

  SELECT * INTO STRICT created_rating
  FROM public.submit_transaction_rating(
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000001',
    4,
    'clear handoff',
    '9d000000-0000-4000-8000-000000000002'
  );
  IF created_rating.rater_id <>
       '9d000000-0000-4000-8000-000000000002'
     OR created_rating.ratee_id <>
       '9d000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'reverse-direction rating was misattributed';
  END IF;
END
$counterparty_rating_boundary$;

-- An alternate accepted-offer participant is not a transaction party. The
-- eligibility response must not reveal the selected counterparty.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000003',
  true
);

DO $unrelated_rating_boundary$
DECLARE
  eligibility record;
BEGIN
  SELECT * INTO STRICT eligibility
  FROM public.get_transaction_rating_eligibility(
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000003'
  );
  IF eligibility.eligible
     OR eligibility.ratee_id IS NOT NULL
     OR eligibility.ratee_nickname IS NOT NULL
     OR eligibility.already_rated THEN
    RAISE EXCEPTION 'unrelated eligibility leaked authoritative party data';
  END IF;

  BEGIN
    PERFORM public.submit_transaction_rating(
      '9d100000-0000-4000-8000-000000000001',
      '9d000000-0000-4000-8000-000000000001',
      5,
      'not my transaction',
      '9d000000-0000-4000-8000-000000000003'
    );
    RAISE EXCEPTION 'unrelated account submitted transaction rating';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'rating_not_permitted' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO public.ratings (
      rater_id, ratee_id, item_id, stars, comment
    ) VALUES (
      '9d000000-0000-4000-8000-000000000003',
      '9d000000-0000-4000-8000-000000000001',
      '9d100000-0000-4000-8000-000000000001',
      5,
      'direct bypass'
    );
    RAISE EXCEPTION 'direct rating insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.get_transaction_rating_eligibility(
      '9d100000-0000-4000-8000-000000000001',
      '9d000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'stale-account eligibility unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'account_changed' THEN RAISE; END IF;
  END;
END
$unrelated_rating_boundary$;

-- Legacy sold listings without private attribution remain readable, including
-- their old ratings, but cannot acquire a guessed new transaction rating.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000009',
  true
);

DO $legacy_boundary$
DECLARE
  eligibility record;
  legacy_visible integer;
BEGIN
  SELECT pg_catalog.count(*) INTO legacy_visible
  FROM public.ratings
  WHERE id = '9d400000-0000-4000-8000-000000000001';
  IF legacy_visible <> 1 THEN
    RAISE EXCEPTION 'authenticated reader lost legacy rating visibility';
  END IF;

  SELECT * INTO STRICT eligibility
  FROM public.get_transaction_rating_eligibility(
    '9d100000-0000-4000-8000-000000000004',
    '9d000000-0000-4000-8000-000000000009'
  );
  IF eligibility.eligible
     OR eligibility.ratee_id IS NOT NULL
     OR eligibility.ratee_nickname IS NOT NULL THEN
    RAISE EXCEPTION 'legacy sold listing invented rating attribution';
  END IF;

  BEGIN
    PERFORM public.submit_transaction_rating(
      '9d100000-0000-4000-8000-000000000004',
      '9d000000-0000-4000-8000-000000000001',
      4,
      'guessed legacy deal',
      '9d000000-0000-4000-8000-000000000009'
    );
    RAISE EXCEPTION 'legacy sold listing accepted a new guessed rating';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'rating_not_permitted' THEN RAISE; END IF;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.ratings
    WHERE id = '9d400000-0000-4000-8000-000000000001'
      AND comment = 'legacy rating remains readable'
  ) THEN
    RAISE EXCEPTION 'rejected legacy write modified historical rating';
  END IF;
END
$legacy_boundary$;

RESET ROLE;

-- Hard-delete the selected counterparty exactly as the account deletion saga's
-- Auth step does. Conversation/offer/rating cascades must not block deletion;
-- private participant links clear via SET NULL while the sold item and
-- non-identifying price/timestamps remain.
DELETE FROM auth.users
WHERE id = '9d000000-0000-4000-8000-000000000002';

DO $account_deletion_cleanup$
DECLARE
  deal_row private.item_deals%ROWTYPE;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '9d000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'counterparty profile survived auth account deletion';
  END IF;

  SELECT * INTO STRICT deal_row
  FROM private.item_deals
  WHERE item_id = '9d100000-0000-4000-8000-000000000001';
  IF deal_row.owner_id <> '9d000000-0000-4000-8000-000000000001'
     OR deal_row.counterparty_id IS NOT NULL
     OR deal_row.offer_id IS NOT NULL
     OR deal_row.conversation_id IS NOT NULL
     OR deal_row.agreed_price <> 90
     OR deal_row.accepted_at IS NULL
     OR deal_row.confirmed_at IS NULL THEN
    RAISE EXCEPTION 'private deal FK cleanup lost or retained wrong fields';
  END IF;

  IF (
    SELECT status FROM public.items
    WHERE id = '9d100000-0000-4000-8000-000000000001'
  ) <> 'sold'::public.item_status THEN
    RAISE EXCEPTION 'counterparty deletion removed or reopened owner listing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ratings
    WHERE item_id = '9d100000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'counterparty-linked ratings did not follow profile cascade';
  END IF;
END
$account_deletion_cleanup$;

-- Once identifying links have been cleared, even the surviving owner gets a
-- fail-closed non-identifying eligibility response.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000001',
  true
);

DO $post_deletion_eligibility$
DECLARE
  eligibility record;
BEGIN
  SELECT * INTO STRICT eligibility
  FROM public.get_transaction_rating_eligibility(
    '9d100000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-000000000001'
  );
  IF eligibility.eligible
     OR eligibility.ratee_id IS NOT NULL
     OR eligibility.ratee_nickname IS NOT NULL
     OR eligibility.already_rated THEN
    RAISE EXCEPTION 'deleted counterparty identity leaked through eligibility';
  END IF;
END
$post_deletion_eligibility$;

RESET ROLE;

-- Deleting the listing owner takes the opposite privacy path: items.user_id
-- cascades the sold listing, and item_deals.item_id must cascade the complete
-- private attribution row rather than retain an ownerless transaction link.
DELETE FROM auth.users
WHERE id = '9d000000-0000-4000-8000-000000000001';

DO $owner_deletion_cleanup$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.items
    WHERE id = '9d100000-0000-4000-8000-000000000001'
  ) OR EXISTS (
    SELECT 1 FROM private.item_deals
    WHERE item_id = '9d100000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'owner deletion did not cascade listing and private deal';
  END IF;
END
$owner_deletion_cleanup$;

ROLLBACK;
