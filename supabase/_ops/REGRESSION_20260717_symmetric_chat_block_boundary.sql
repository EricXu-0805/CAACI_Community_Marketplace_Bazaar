-- Local/isolated-database behavioral regression for migration 20260717141822.
-- NEVER run against production. Every fixture mutation is wrapped in a rollback.

BEGIN;

-- Use IDs outside normal fixture ranges. Insert auth users first so the profile
-- FK and normal signup trigger remain representative of Supabase behavior.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('91000000-0000-0000-0000-000000000001', 'block-a@example.test', '{}'::jsonb),
  ('91000000-0000-0000-0000-000000000002', 'block-b@example.test', '{}'::jsonb),
  ('91000000-0000-0000-0000-000000000003', 'block-c@example.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname) VALUES
  ('91000000-0000-0000-0000-000000000001', 'Block A'),
  ('91000000-0000-0000-0000-000000000002', 'Block B'),
  ('91000000-0000-0000-0000-000000000003', 'Block C')
ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname;

INSERT INTO public.items (
  id, user_id, title, price, status, negotiable, listing_type
) VALUES (
  '92000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000002',
  'Block boundary fixture',
  25,
  'active',
  true,
  'sell'
) ON CONFLICT (id) DO UPDATE SET
  status = 'active',
  negotiable = true;

-- Create the conversation and baseline rows as A through the real API role.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-0000-0000-000000000001',
  true
);

DO $test$
BEGIN
  BEGIN
    INSERT INTO public.conversations (item_id, buyer_id, seller_id) VALUES (
      '92000000-0000-0000-0000-000000000001',
      '91000000-0000-0000-0000-000000000001',
      '91000000-0000-0000-0000-000000000003'
    );
    RAISE EXCEPTION 'buyer forged a seller/item relationship';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$test$;

WITH created_conversation AS (
  INSERT INTO public.conversations (item_id, buyer_id, seller_id) VALUES (
    '92000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000002'
  )
  RETURNING id
)
SELECT set_config(
  'caaci_test.conversation_id',
  id::text,
  true
)
FROM created_conversation;

INSERT INTO public.messages (conversation_id, sender_id, content) VALUES (
  current_setting('caaci_test.conversation_id')::uuid,
  '91000000-0000-0000-0000-000000000001',
  'baseline'
);

SELECT set_config(
  'caaci_test.baseline_offer_id',
  (public.make_offer(
    current_setting('caaci_test.conversation_id')::uuid,
    20,
    '91000000-0000-0000-0000-000000000001',
    'baseline'
  )).id::text,
  true
);

SELECT set_config(
  'caaci_test.baseline_meetup_id',
  (public.propose_meetup(
    current_setting('caaci_test.conversation_id')::uuid,
    'Illini Union',
    now() + interval '2 days',
    '91000000-0000-0000-0000-000000000001',
    'baseline'
  )).id::text,
  true
);

RESET ROLE;

-- Extra trusted fixtures let both sides exercise recipient-only and
-- accepted-meetup RPCs without changing the two baseline pending rows. These
-- inserts deliberately bypass the client surface; the behavior under test is
-- the migration's boundary around existing historical state.
WITH reverse_offer AS (
  INSERT INTO public.offers (
    conversation_id, item_id, from_user, to_user, price, note
  ) VALUES (
    current_setting('caaci_test.conversation_id')::uuid,
    '92000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000002',
    '91000000-0000-0000-0000-000000000001',
    21,
    'reverse fixture'
  )
  RETURNING id
)
SELECT set_config(
  'caaci_test.reverse_offer_id',
  id::text,
  true
)
FROM reverse_offer;

WITH accepted_meetup AS (
  INSERT INTO public.meetups (
    conversation_id, item_id, from_user, to_user, spot, meet_at, status, note
  ) VALUES (
    current_setting('caaci_test.conversation_id')::uuid,
    '92000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000002',
    'Krannert Center',
    now() + interval '3 days',
    'accepted',
    'accepted fixture'
  )
  RETURNING id
)
SELECT set_config(
  'caaci_test.accepted_meetup_id',
  id::text,
  true
)
FROM accepted_meetup;

DO $test$
DECLARE
  bad_routes integer;
BEGIN
  SELECT count(*) INTO bad_routes
  FROM public.notifications
  WHERE type IN ('offer', 'meetup')
    AND user_id = '91000000-0000-0000-0000-000000000002'
    AND item_id = '92000000-0000-0000-0000-000000000001'
    AND conversation_id IS DISTINCT FROM current_setting('caaci_test.conversation_id')::uuid;
  IF bad_routes <> 0 THEN
    RAISE EXCEPTION 'offer/meetup notification lost its conversation route';
  END IF;

  SELECT count(*) INTO bad_routes
  FROM public.notifications
  WHERE type IN ('offer', 'meetup')
    AND user_id = '91000000-0000-0000-0000-000000000002'
    AND item_id = '92000000-0000-0000-0000-000000000001';
  IF bad_routes <> 2 THEN
    RAISE EXCEPTION 'expected two routed baseline notifications, got %', bad_routes;
  END IF;
END
$test$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-0000-0000-000000000001',
  true
);

-- A blocks B. Both A and B must now see zero rows and every write/RPC must fail.
INSERT INTO public.blocks (blocker_id, blocked_id) VALUES (
  '91000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000002'
);

DO $test$
DECLARE
  row_count_value integer;
  affected_rows bigint;
BEGIN
  SELECT count(*) INTO row_count_value
  FROM public.blocks
  WHERE blocker_id = '91000000-0000-0000-0000-000000000001'
    AND blocked_id = '91000000-0000-0000-0000-000000000002';
  IF row_count_value <> 1 THEN RAISE EXCEPTION 'A cannot see its own outgoing block'; END IF;

  IF private.current_user_can_access_pair(
    '91000000-0000-0000-0000-000000000002',
    '91000000-0000-0000-0000-000000000003'
  ) THEN
    RAISE EXCEPTION 'pair helper exposed a third-party relationship';
  END IF;

  SELECT count(*) INTO row_count_value
  FROM public.conversations
  WHERE id = current_setting('caaci_test.conversation_id')::uuid;
  IF row_count_value <> 0 THEN RAISE EXCEPTION 'A can still SELECT blocked conversation'; END IF;

  SELECT count(*) INTO row_count_value
  FROM public.messages
  WHERE conversation_id = current_setting('caaci_test.conversation_id')::uuid;
  IF row_count_value <> 0 THEN RAISE EXCEPTION 'A can still SELECT blocked messages'; END IF;

  SELECT count(*) INTO row_count_value
  FROM public.offers
  WHERE conversation_id = current_setting('caaci_test.conversation_id')::uuid;
  IF row_count_value <> 0 THEN RAISE EXCEPTION 'A can still SELECT blocked offers'; END IF;

  SELECT count(*) INTO row_count_value
  FROM public.meetups
  WHERE conversation_id = current_setting('caaci_test.conversation_id')::uuid;
  IF row_count_value <> 0 THEN RAISE EXCEPTION 'A can still SELECT blocked meetups'; END IF;

  SELECT count(*) INTO row_count_value
  FROM public.get_last_messages(
    ARRAY[current_setting('caaci_test.conversation_id')::uuid]
  );
  IF row_count_value <> 0 THEN RAISE EXCEPTION 'A can still read blocked preview RPC'; END IF;

  UPDATE public.conversations
  SET is_pinned_buyer = true
  WHERE id = current_setting('caaci_test.conversation_id')::uuid;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN RAISE EXCEPTION 'A updated a blocked conversation'; END IF;

  BEGIN
    INSERT INTO public.conversations (item_id, buyer_id, seller_id) VALUES (
      '92000000-0000-0000-0000-000000000001',
      '91000000-0000-0000-0000-000000000001',
      '91000000-0000-0000-0000-000000000002'
    );
    RAISE EXCEPTION 'A inserted a conversation across block';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.messages (conversation_id, sender_id, content) VALUES (
      current_setting('caaci_test.conversation_id')::uuid,
      '91000000-0000-0000-0000-000000000001',
      'must fail'
    );
    RAISE EXCEPTION 'A inserted a message across block';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.make_offer(
      current_setting('caaci_test.conversation_id')::uuid,
      19,
      '91000000-0000-0000-0000-000000000001',
      'must fail'
    );
    RAISE EXCEPTION 'A made an offer across block';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.respond_to_offer(
      current_setting('caaci_test.reverse_offer_id')::uuid,
      'decline',
      '91000000-0000-0000-0000-000000000001',
      NULL,
      NULL
    );
    RAISE EXCEPTION 'A responded to an offer across outgoing block';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.propose_meetup(
      current_setting('caaci_test.conversation_id')::uuid,
      'Main Library',
      now() + interval '4 days',
      '91000000-0000-0000-0000-000000000001',
      'must fail'
    );
    RAISE EXCEPTION 'A proposed a meetup across block';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.reschedule_accepted_meetup(
      current_setting('caaci_test.accepted_meetup_id')::uuid,
      'Main Library',
      now() + interval '4 days',
      '91000000-0000-0000-0000-000000000001',
      'must fail'
    );
    RAISE EXCEPTION 'A rescheduled an accepted meetup across block';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$test$;

SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-0000-0000-000000000002',
  true
);

DO $test$
DECLARE
  row_count_value integer;
  affected_rows bigint;
BEGIN
  SELECT count(*) INTO row_count_value
  FROM public.conversations
  WHERE id = current_setting('caaci_test.conversation_id')::uuid;
  IF row_count_value <> 0 THEN RAISE EXCEPTION 'B can still SELECT blocked conversation'; END IF;

  SELECT count(*) INTO row_count_value
  FROM public.messages
  WHERE conversation_id = current_setting('caaci_test.conversation_id')::uuid;
  IF row_count_value <> 0 THEN RAISE EXCEPTION 'B can still SELECT blocked messages'; END IF;

  SELECT count(*) INTO row_count_value
  FROM public.offers
  WHERE conversation_id = current_setting('caaci_test.conversation_id')::uuid;
  IF row_count_value <> 0 THEN RAISE EXCEPTION 'B can still SELECT blocked offers'; END IF;

  SELECT count(*) INTO row_count_value
  FROM public.meetups
  WHERE conversation_id = current_setting('caaci_test.conversation_id')::uuid;
  IF row_count_value <> 0 THEN RAISE EXCEPTION 'B can still SELECT blocked meetups'; END IF;

  -- Incoming blocks are intentionally not exposed as rows to the recipient.
  SELECT count(*) INTO row_count_value
  FROM public.blocks
  WHERE blocker_id = '91000000-0000-0000-0000-000000000001'
    AND blocked_id = '91000000-0000-0000-0000-000000000002';
  IF row_count_value <> 0 THEN RAISE EXCEPTION 'B can inspect A''s block row'; END IF;

  SELECT count(*) INTO row_count_value
  FROM public.get_last_messages(
    ARRAY[current_setting('caaci_test.conversation_id')::uuid]
  );
  IF row_count_value <> 0 THEN RAISE EXCEPTION 'B can still read blocked preview RPC'; END IF;

  UPDATE public.conversations
  SET is_pinned_seller = true
  WHERE id = current_setting('caaci_test.conversation_id')::uuid;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN RAISE EXCEPTION 'B updated a blocked conversation'; END IF;

  UPDATE public.messages
  SET is_read = true
  WHERE conversation_id = current_setting('caaci_test.conversation_id')::uuid
    AND sender_id <> '91000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN RAISE EXCEPTION 'B updated blocked messages'; END IF;

  BEGIN
    INSERT INTO public.messages (conversation_id, sender_id, content) VALUES (
      current_setting('caaci_test.conversation_id')::uuid,
      '91000000-0000-0000-0000-000000000002',
      'must fail'
    );
    RAISE EXCEPTION 'B inserted a message across incoming block';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.respond_to_offer(
      current_setting('caaci_test.baseline_offer_id')::uuid,
      'accept',
      '91000000-0000-0000-0000-000000000002',
      NULL,
      NULL
    );
    RAISE EXCEPTION 'B responded to an offer across incoming block';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.respond_to_meetup(
      current_setting('caaci_test.baseline_meetup_id')::uuid,
      'accept',
      '91000000-0000-0000-0000-000000000002',
      NULL,
      NULL,
      NULL
    );
    RAISE EXCEPTION 'B responded to a meetup across incoming block';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.make_offer(
      current_setting('caaci_test.conversation_id')::uuid,
      22,
      '91000000-0000-0000-0000-000000000002',
      'must fail'
    );
    RAISE EXCEPTION 'B made an offer across incoming block';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.propose_meetup(
      current_setting('caaci_test.conversation_id')::uuid,
      'Siebel Center',
      now() + interval '4 days',
      '91000000-0000-0000-0000-000000000002',
      'must fail'
    );
    RAISE EXCEPTION 'B proposed a meetup across incoming block';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.reschedule_accepted_meetup(
      current_setting('caaci_test.accepted_meetup_id')::uuid,
      'Siebel Center',
      now() + interval '4 days',
      '91000000-0000-0000-0000-000000000002',
      'must fail'
    );
    RAISE EXCEPTION 'B rescheduled an accepted meetup across incoming block';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$test$;

-- A unblocks B; the same history and writes immediately become available.
SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-0000-0000-000000000001',
  true
);
DELETE FROM public.blocks
WHERE blocker_id = '91000000-0000-0000-0000-000000000001'
  AND blocked_id = '91000000-0000-0000-0000-000000000002';

DO $test$
DECLARE
  row_count_value integer;
BEGIN
  SELECT count(*) INTO row_count_value
  FROM public.messages
  WHERE conversation_id = current_setting('caaci_test.conversation_id')::uuid;
  IF row_count_value <> 1 THEN RAISE EXCEPTION 'history did not restore after unblock'; END IF;

  SELECT count(*) INTO row_count_value
  FROM public.get_last_messages(
    ARRAY[current_setting('caaci_test.conversation_id')::uuid]
  );
  IF row_count_value <> 1 THEN RAISE EXCEPTION 'preview RPC did not restore after unblock'; END IF;
END
$test$;

INSERT INTO public.messages (conversation_id, sender_id, content) VALUES (
  current_setting('caaci_test.conversation_id')::uuid,
  '91000000-0000-0000-0000-000000000001',
  'restored'
);

-- Confirm restoration from the formerly incoming side too.
SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-0000-0000-000000000002',
  true
);

DO $test$
DECLARE
  row_count_value integer;
BEGIN
  SELECT count(*) INTO row_count_value
  FROM public.messages
  WHERE conversation_id = current_setting('caaci_test.conversation_id')::uuid;
  IF row_count_value <> 2 THEN RAISE EXCEPTION 'B history did not restore after unblock'; END IF;

  SELECT count(*) INTO row_count_value
  FROM public.offers
  WHERE conversation_id = current_setting('caaci_test.conversation_id')::uuid;
  IF row_count_value <> 2 THEN RAISE EXCEPTION 'B offers did not restore after unblock'; END IF;

  SELECT count(*) INTO row_count_value
  FROM public.meetups
  WHERE conversation_id = current_setting('caaci_test.conversation_id')::uuid;
  IF row_count_value <> 2 THEN RAISE EXCEPTION 'B meetups did not restore after unblock'; END IF;
END
$test$;

INSERT INTO public.messages (conversation_id, sender_id, content) VALUES (
  current_setting('caaci_test.conversation_id')::uuid,
  '91000000-0000-0000-0000-000000000002',
  'restored from B'
);

-- Account-intent boundary: these actions were captured while A was active,
-- but the request reaches PostgreSQL under B's JWT. B is deliberately a valid
-- participant/recipient for every target, so ordinary authorization checks
-- would not catch the switch. Each RPC must report account_changed before any
-- SELECT ... FOR UPDATE or write, and every observable row remains unchanged.
DO $account_intent_test$
DECLARE
  offers_before bigint;
  meetups_before bigint;
  notifications_before bigint;
  last_message_before timestamptz;
  baseline_offer_status_before text;
  baseline_meetup_status_before text;
  accepted_meetup_status_before text;
  stored_status text;
BEGIN
  SELECT pg_catalog.count(*) INTO offers_before
  FROM public.offers
  WHERE conversation_id = current_setting('caaci_test.conversation_id')::uuid;

  SELECT pg_catalog.count(*) INTO meetups_before
  FROM public.meetups
  WHERE conversation_id = current_setting('caaci_test.conversation_id')::uuid;

  SELECT pg_catalog.count(*) INTO notifications_before
  FROM public.notifications;

  SELECT last_message_at INTO last_message_before
  FROM public.conversations
  WHERE id = current_setting('caaci_test.conversation_id')::uuid;

  SELECT status::text INTO baseline_offer_status_before
  FROM public.offers
  WHERE id = current_setting('caaci_test.baseline_offer_id')::uuid;

  SELECT status::text INTO baseline_meetup_status_before
  FROM public.meetups
  WHERE id = current_setting('caaci_test.baseline_meetup_id')::uuid;

  SELECT status::text INTO accepted_meetup_status_before
  FROM public.meetups
  WHERE id = current_setting('caaci_test.accepted_meetup_id')::uuid;

  BEGIN
    PERFORM public.make_offer(
      current_setting('caaci_test.conversation_id')::uuid,
      23,
      '91000000-0000-0000-0000-000000000001',
      'A intent under B JWT'
    );
    RAISE EXCEPTION 'make_offer accepted stale A intent under B JWT';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'account_changed' THEN
      RAISE EXCEPTION 'make_offer mismatch returned %, expected account_changed', SQLERRM;
    END IF;
  END;

  BEGIN
    PERFORM public.respond_to_offer(
      current_setting('caaci_test.baseline_offer_id')::uuid,
      'accept',
      '91000000-0000-0000-0000-000000000001',
      NULL,
      NULL
    );
    RAISE EXCEPTION 'respond_to_offer accepted stale A intent under B JWT';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'account_changed' THEN
      RAISE EXCEPTION 'respond_to_offer mismatch returned %, expected account_changed', SQLERRM;
    END IF;
  END;

  BEGIN
    PERFORM public.propose_meetup(
      current_setting('caaci_test.conversation_id')::uuid,
      'Account switch fixture',
      pg_catalog.now() + interval '5 days',
      '91000000-0000-0000-0000-000000000001',
      'A intent under B JWT'
    );
    RAISE EXCEPTION 'propose_meetup accepted stale A intent under B JWT';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'account_changed' THEN
      RAISE EXCEPTION 'propose_meetup mismatch returned %, expected account_changed', SQLERRM;
    END IF;
  END;

  BEGIN
    PERFORM public.respond_to_meetup(
      current_setting('caaci_test.baseline_meetup_id')::uuid,
      'accept',
      '91000000-0000-0000-0000-000000000001',
      NULL,
      NULL,
      NULL
    );
    RAISE EXCEPTION 'respond_to_meetup accepted stale A intent under B JWT';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'account_changed' THEN
      RAISE EXCEPTION 'respond_to_meetup mismatch returned %, expected account_changed', SQLERRM;
    END IF;
  END;

  BEGIN
    PERFORM public.reschedule_accepted_meetup(
      current_setting('caaci_test.accepted_meetup_id')::uuid,
      'Account switch fixture',
      pg_catalog.now() + interval '5 days',
      '91000000-0000-0000-0000-000000000001',
      'A intent under B JWT'
    );
    RAISE EXCEPTION 'reschedule_accepted_meetup accepted stale A intent under B JWT';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'account_changed' THEN
      RAISE EXCEPTION 'reschedule mismatch returned %, expected account_changed', SQLERRM;
    END IF;
  END;

  -- A rolling client that still resolves the legacy overload cannot execute
  -- it. The explicit casts ensure PostgreSQL selects the old identity.
  BEGIN
    PERFORM public.make_offer(
      current_setting('caaci_test.conversation_id')::uuid,
      24::numeric,
      'legacy call must fail'::text
    );
    RAISE EXCEPTION 'legacy make_offer overload remained callable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF (SELECT pg_catalog.count(*) FROM public.offers
      WHERE conversation_id = current_setting('caaci_test.conversation_id')::uuid)
       IS DISTINCT FROM offers_before
     OR (SELECT pg_catalog.count(*) FROM public.meetups
         WHERE conversation_id = current_setting('caaci_test.conversation_id')::uuid)
       IS DISTINCT FROM meetups_before
     OR (SELECT pg_catalog.count(*) FROM public.notifications)
       IS DISTINCT FROM notifications_before
     OR (SELECT last_message_at FROM public.conversations
         WHERE id = current_setting('caaci_test.conversation_id')::uuid)
       IS DISTINCT FROM last_message_before THEN
    RAISE EXCEPTION 'account-intent rejection changed row counts or conversation activity';
  END IF;

  SELECT status::text INTO stored_status FROM public.offers
  WHERE id = current_setting('caaci_test.baseline_offer_id')::uuid;
  IF stored_status IS DISTINCT FROM baseline_offer_status_before THEN
    RAISE EXCEPTION 'account-intent rejection changed baseline offer status';
  END IF;

  SELECT status::text INTO stored_status FROM public.meetups
  WHERE id = current_setting('caaci_test.baseline_meetup_id')::uuid;
  IF stored_status IS DISTINCT FROM baseline_meetup_status_before THEN
    RAISE EXCEPTION 'account-intent rejection changed baseline meetup status';
  END IF;

  SELECT status::text INTO stored_status FROM public.meetups
  WHERE id = current_setting('caaci_test.accepted_meetup_id')::uuid;
  IF stored_status IS DISTINCT FROM accepted_meetup_status_before THEN
    RAISE EXCEPTION 'account-intent rejection changed accepted meetup status';
  END IF;
END
$account_intent_test$;

-- Expiration is a persisted state transition, not merely a client-side label.
-- These trusted fixtures are already expired; responding as their recipient
-- must return and retain `expired`. A RAISE after UPDATE would silently roll the
-- transition back to pending, which this regression catches.
RESET ROLE;
INSERT INTO public.offers (
  id, conversation_id, item_id, from_user, to_user, price, expires_at, note
) VALUES (
  '93000000-0000-0000-0000-000000000001',
  current_setting('caaci_test.conversation_id')::uuid,
  '92000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000002',
  18,
  pg_catalog.now() - interval '1 hour',
  'expired offer fixture'
);

INSERT INTO public.meetups (
  id, conversation_id, item_id, from_user, to_user, spot, meet_at,
  expires_at, note
) VALUES (
  '93000000-0000-0000-0000-000000000002',
  current_setting('caaci_test.conversation_id')::uuid,
  '92000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000002',
  'Expired fixture spot',
  pg_catalog.now() + interval '1 day',
  pg_catalog.now() - interval '1 hour',
  'expired meetup fixture'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-0000-0000-000000000002',
  true
);

DO $test$
DECLARE
  expired_offer public.offers;
  expired_meetup public.meetups;
  stored_status text;
BEGIN
  expired_offer := public.respond_to_offer(
    '93000000-0000-0000-0000-000000000001',
    'accept',
    '91000000-0000-0000-0000-000000000002',
    NULL,
    NULL
  );
  IF expired_offer.status <> 'expired' THEN
    RAISE EXCEPTION 'expired offer RPC returned status %', expired_offer.status;
  END IF;

  SELECT status INTO stored_status
  FROM public.offers
  WHERE id = '93000000-0000-0000-0000-000000000001';
  IF stored_status <> 'expired' THEN
    RAISE EXCEPTION 'expired offer transition was not persisted: %', stored_status;
  END IF;

  expired_meetup := public.respond_to_meetup(
    '93000000-0000-0000-0000-000000000002',
    'accept',
    '91000000-0000-0000-0000-000000000002',
    NULL,
    NULL,
    NULL
  );
  IF expired_meetup.status <> 'expired' THEN
    RAISE EXCEPTION 'expired meetup RPC returned status %', expired_meetup.status;
  END IF;

  SELECT status INTO stored_status
  FROM public.meetups
  WHERE id = '93000000-0000-0000-0000-000000000002';
  IF stored_status <> 'expired' THEN
    RAISE EXCEPTION 'expired meetup transition was not persisted: %', stored_status;
  END IF;
END
$test$;

-- Price validation is identical for a new offer and the counter branch: zero
-- is not a meaningful marketplace offer even though historical storage rows
-- may contain it under the table's older nonnegative constraint.
DO $test$
BEGIN
  BEGIN
    PERFORM public.make_offer(
      current_setting('caaci_test.conversation_id')::uuid,
      0,
      '91000000-0000-0000-0000-000000000002',
      'must fail'
    );
    RAISE EXCEPTION 'zero-price offer was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM public.respond_to_offer(
      current_setting('caaci_test.baseline_offer_id')::uuid,
      'counter',
      '91000000-0000-0000-0000-000000000002',
      0,
      'must fail'
    );
    RAISE EXCEPTION 'zero-price counter-offer was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END
$test$;

-- Lifecycle guards reject writes while leaving the existing rows readable.
RESET ROLE;
-- The final release requires every sold row to carry an exact private deal.
-- Seed that trusted ledger fact before moving this legacy chat fixture into
-- its terminal state; deal-attribution behavior has its own dedicated suite.
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
  '92000000-0000-0000-0000-000000000001',
  current_setting('caaci_test.baseline_offer_id')::uuid,
  current_setting('caaci_test.conversation_id')::uuid,
  '91000000-0000-0000-0000-000000000002',
  '91000000-0000-0000-0000-000000000001',
  20,
  pg_catalog.now(),
  pg_catalog.now()
);

UPDATE public.items
SET status = 'sold'
WHERE id = '92000000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-0000-0000-000000000002',
  true
);

DO $test$
DECLARE
  row_count_value integer;
BEGIN
  SELECT count(*) INTO row_count_value
  FROM public.offers
  WHERE id = current_setting('caaci_test.baseline_offer_id')::uuid;
  IF row_count_value <> 1 THEN RAISE EXCEPTION 'sold item hid historical offer'; END IF;

  SELECT count(*) INTO row_count_value
  FROM public.meetups
  WHERE id = current_setting('caaci_test.baseline_meetup_id')::uuid;
  IF row_count_value <> 1 THEN RAISE EXCEPTION 'sold item hid historical meetup'; END IF;

  BEGIN
    PERFORM public.respond_to_offer(
      current_setting('caaci_test.baseline_offer_id')::uuid,
      'accept',
      '91000000-0000-0000-0000-000000000002',
      NULL,
      NULL
    );
    RAISE EXCEPTION 'sold item allowed offer response';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  BEGIN
    PERFORM public.respond_to_meetup(
      current_setting('caaci_test.baseline_meetup_id')::uuid,
      'accept',
      '91000000-0000-0000-0000-000000000002',
      NULL,
      NULL,
      NULL
    );
    RAISE EXCEPTION 'sold item allowed meetup response';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  BEGIN
    PERFORM public.make_offer(
      current_setting('caaci_test.conversation_id')::uuid,
      17,
      '91000000-0000-0000-0000-000000000002',
      'must fail'
    );
    RAISE EXCEPTION 'sold item allowed a new offer';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  BEGIN
    PERFORM public.propose_meetup(
      current_setting('caaci_test.conversation_id')::uuid,
      'Main Library',
      now() + interval '4 days',
      '91000000-0000-0000-0000-000000000002',
      'must fail'
    );
    RAISE EXCEPTION 'sold item allowed a meetup proposal';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  BEGIN
    PERFORM public.reschedule_accepted_meetup(
      current_setting('caaci_test.accepted_meetup_id')::uuid,
      'Main Library',
      now() + interval '4 days',
      '91000000-0000-0000-0000-000000000002',
      'must fail'
    );
    RAISE EXCEPTION 'sold item allowed accepted meetup reschedule';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END
$test$;

-- Deleted listings enforce the same transition boundary while the private
-- conversation history remains available to both unblocked participants.
RESET ROLE;
UPDATE public.items
SET status = 'deleted', negotiable = true
WHERE id = '92000000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-0000-0000-000000000001',
  true
);

DO $test$
DECLARE
  row_count_value integer;
BEGIN
  SELECT count(*) INTO row_count_value
  FROM public.messages
  WHERE conversation_id = current_setting('caaci_test.conversation_id')::uuid;
  IF row_count_value <> 3 THEN RAISE EXCEPTION 'deleted item hid historical messages'; END IF;

  SELECT count(*) INTO row_count_value
  FROM public.offers
  WHERE id = current_setting('caaci_test.reverse_offer_id')::uuid;
  IF row_count_value <> 1 THEN RAISE EXCEPTION 'deleted item hid historical offer'; END IF;

  SELECT count(*) INTO row_count_value
  FROM public.meetups
  WHERE id = current_setting('caaci_test.accepted_meetup_id')::uuid;
  IF row_count_value <> 1 THEN RAISE EXCEPTION 'deleted item hid historical meetup'; END IF;

  BEGIN
    PERFORM public.make_offer(
      current_setting('caaci_test.conversation_id')::uuid,
      16,
      '91000000-0000-0000-0000-000000000001',
      'must fail'
    );
    RAISE EXCEPTION 'deleted item allowed a new offer';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  BEGIN
    PERFORM public.respond_to_offer(
      current_setting('caaci_test.reverse_offer_id')::uuid,
      'decline',
      '91000000-0000-0000-0000-000000000001',
      NULL,
      NULL
    );
    RAISE EXCEPTION 'deleted item allowed offer response';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  BEGIN
    PERFORM public.propose_meetup(
      current_setting('caaci_test.conversation_id')::uuid,
      'Main Library',
      now() + interval '4 days',
      '91000000-0000-0000-0000-000000000001',
      'must fail'
    );
    RAISE EXCEPTION 'deleted item allowed a meetup proposal';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  BEGIN
    PERFORM public.reschedule_accepted_meetup(
      current_setting('caaci_test.accepted_meetup_id')::uuid,
      'Main Library',
      now() + interval '4 days',
      '91000000-0000-0000-0000-000000000001',
      'must fail'
    );
    RAISE EXCEPTION 'deleted item allowed accepted meetup reschedule';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END
$test$;

SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-0000-0000-000000000002',
  true
);

DO $test$
BEGIN
  BEGIN
    PERFORM public.respond_to_offer(
      current_setting('caaci_test.baseline_offer_id')::uuid,
      'accept',
      '91000000-0000-0000-0000-000000000002',
      NULL,
      NULL
    );
    RAISE EXCEPTION 'deleted item allowed recipient offer response';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  BEGIN
    PERFORM public.respond_to_meetup(
      current_setting('caaci_test.baseline_meetup_id')::uuid,
      'accept',
      '91000000-0000-0000-0000-000000000002',
      NULL,
      NULL,
      NULL
    );
    RAISE EXCEPTION 'deleted item allowed meetup response';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END
$test$;

RESET ROLE;
UPDATE public.items
SET status = 'active', negotiable = false
WHERE id = '92000000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-0000-0000-000000000001',
  true
);

DO $test$
BEGIN
  BEGIN
    PERFORM public.make_offer(
      current_setting('caaci_test.conversation_id')::uuid,
      18,
      '91000000-0000-0000-0000-000000000001',
      'must fail'
    );
    RAISE EXCEPTION 'non-negotiable item allowed offer';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END
$test$;

SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-0000-0000-000000000002',
  true
);

DO $test$
BEGIN
  BEGIN
    PERFORM public.respond_to_offer(
      current_setting('caaci_test.baseline_offer_id')::uuid,
      'decline',
      '91000000-0000-0000-0000-000000000002',
      NULL,
      NULL
    );
    RAISE EXCEPTION 'non-negotiable item allowed offer response';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END
$test$;

ROLLBACK;
