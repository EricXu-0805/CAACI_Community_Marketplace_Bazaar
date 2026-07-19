-- Isolated/local behavioral regression for atomic digest reminder seeding.
-- NEVER run against production. Every fixture mutation is rolled back.

\set ON_ERROR_STOP on

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.seed_digest_reminders(integer,integer,integer)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'regression_preflight_failed: atomic reminder migration is not applied';
  END IF;
END
$preflight$;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e6000000-0000-4000-8000-000000000001', 'seed-seller@example.test', '{}'::jsonb),
  ('e6000000-0000-4000-8000-000000000002', 'seed-buyer-a@example.test', '{}'::jsonb),
  ('e6000000-0000-4000-8000-000000000003', 'seed-buyer-b@example.test', '{}'::jsonb),
  ('e6000000-0000-4000-8000-000000000004', 'seed-buyer-c@example.test', '{}'::jsonb),
  ('e6000000-0000-4000-8000-000000000005', 'seed-buyer-d@example.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname) VALUES
  ('e6000000-0000-4000-8000-000000000001', 'Seed Seller'),
  ('e6000000-0000-4000-8000-000000000002', 'Seed Buyer A'),
  ('e6000000-0000-4000-8000-000000000003', 'Seed Buyer B'),
  ('e6000000-0000-4000-8000-000000000004', 'Seed Buyer C'),
  ('e6000000-0000-4000-8000-000000000005', 'Seed Buyer D')
ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'e6000000-0000-4000-8000-000000000001',
  true
);

INSERT INTO public.items (
  id, user_id, title, description, price, category, condition, status
) VALUES (
  'e6100000-0000-4000-8000-000000000001',
  'e6000000-0000-4000-8000-000000000001',
  'Atomic reminder fixture',
  'Block, mute, recipient, rollback and starvation coverage',
  30,
  'other',
  'good',
  'active'
);

INSERT INTO public.conversations (
  id, item_id, buyer_id, seller_id, last_message_at
) VALUES
  ('e6200000-0000-4000-8000-000000000001', 'e6100000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-000000000001', pg_catalog.now()),
  ('e6200000-0000-4000-8000-000000000002', 'e6100000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000003', 'e6000000-0000-4000-8000-000000000001', pg_catalog.now()),
  ('e6200000-0000-4000-8000-000000000003', 'e6100000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000004', 'e6000000-0000-4000-8000-000000000001', pg_catalog.now()),
  ('e6200000-0000-4000-8000-000000000004', 'e6100000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000005', 'e6000000-0000-4000-8000-000000000001', pg_catalog.now());

-- Buyer B muted their own side. The row must be retired without creating an
-- off-platform reminder, while a later unmuted conversation still progresses.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'e6000000-0000-4000-8000-000000000003',
  true
);
UPDATE public.conversations
SET is_muted_buyer = true
WHERE id = 'e6200000-0000-4000-8000-000000000002';

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'e6000000-0000-4000-8000-000000000001',
  true
);

INSERT INTO public.meetups (
  id, conversation_id, item_id, from_user, to_user, spot, meet_at,
  status, created_at, updated_at
) VALUES
  ('e6300000-0000-4000-8000-000000000001', 'e6200000-0000-4000-8000-000000000001', 'e6100000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002', 'Unblocked spot', pg_catalog.now() + interval '12 hours', 'accepted', pg_catalog.now(), pg_catalog.now()),
  ('e6300000-0000-4000-8000-000000000002', 'e6200000-0000-4000-8000-000000000003', 'e6100000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000004', 'Blocked spot', pg_catalog.now() + interval '13 hours', 'accepted', pg_catalog.now(), pg_catalog.now());

INSERT INTO public.messages (
  id, conversation_id, sender_id, content, message_type, is_read, created_at
) VALUES
  ('e6400000-0000-4000-8000-000000000001', 'e6200000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'unblocked one', 'text', false, pg_catalog.now() - interval '16 hours'),
  ('e6400000-0000-4000-8000-000000000002', 'e6200000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'unblocked two', 'text', false, pg_catalog.now() - interval '15 hours'),
  ('e6400000-0000-4000-8000-000000000003', 'e6200000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-000000000001', 'muted old', 'text', false, pg_catalog.now() - interval '17 hours'),
  ('e6400000-0000-4000-8000-000000000004', 'e6200000-0000-4000-8000-000000000003', 'e6000000-0000-4000-8000-000000000001', 'blocked old', 'text', false, pg_catalog.now() - interval '18 hours'),
  ('e6400000-0000-4000-8000-000000000005', 'e6200000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'too new', 'text', false, pg_catalog.now() - interval '1 hour'),
  ('e6400000-0000-4000-8000-000000000006', 'e6200000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'already read', 'text', true, pg_catalog.now() - interval '20 hours');

-- Block after source creation. The symmetric boundary must suppress both the
-- structured meetup and unread message without leaving starvation rows.
INSERT INTO public.blocks (blocker_id, blocked_id)
VALUES (
  'e6000000-0000-4000-8000-000000000004',
  'e6000000-0000-4000-8000-000000000001'
);

CREATE TEMP TABLE seed_regression_result (
  label text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT DROP;
GRANT SELECT, INSERT ON TABLE pg_temp.seed_regression_result TO service_role;

SET LOCAL ROLE service_role;
INSERT INTO pg_temp.seed_regression_result (label, payload)
SELECT 'initial', public.seed_digest_reminders(200, 500, 12);
INSERT INTO pg_temp.seed_regression_result (label, payload)
SELECT 'replay', public.seed_digest_reminders(200, 500, 12);
RESET ROLE;

DO $initial_seed$
DECLARE
  initial_result jsonb := (
    SELECT result.payload
    FROM pg_temp.seed_regression_result AS result
    WHERE result.label = 'initial'
  );
  replay_result jsonb := (
    SELECT result.payload
    FROM pg_temp.seed_regression_result AS result
    WHERE result.label = 'replay'
  );
BEGIN
  IF initial_result ->> 'meetup_sources_scanned' <> '2'
     OR initial_result ->> 'meetup_reminders' <> '1'
     OR initial_result ->> 'meetup_notifications' <> '2'
     OR initial_result ->> 'unread_messages_scanned' <> '4'
     OR initial_result ->> 'unread_reminders' <> '1' THEN
    RAISE EXCEPTION 'initial atomic seed metrics drifted: %', initial_result;
  END IF;
  IF replay_result ->> 'meetup_sources_scanned' <> '0'
     OR replay_result ->> 'meetup_notifications' <> '0'
     OR replay_result ->> 'unread_messages_scanned' <> '0'
     OR replay_result ->> 'unread_reminders' <> '0' THEN
    RAISE EXCEPTION 'sequential retry was not idempotent: %', replay_result;
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM public.notifications AS notification
    WHERE notification.source_event_key LIKE
      'meetup-reminder:e6300000-0000-4000-8000-000000000001:%'
  ) <> 2 OR EXISTS (
    SELECT 1
    FROM public.notifications AS notification
    WHERE notification.source_event_key LIKE
      'meetup-reminder:e6300000-0000-4000-8000-000000000002:%'
  ) THEN
    RAISE EXCEPTION 'meetup block/recipient reminder routing drifted';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM public.notifications AS notification
    WHERE notification.type = 'unread_message'
      AND notification.conversation_id = 'e6200000-0000-4000-8000-000000000001'
      AND notification.user_id = 'e6000000-0000-4000-8000-000000000002'
      AND notification.body LIKE '%2 unread messages%'
  ) <> 1 OR EXISTS (
    SELECT 1
    FROM public.notifications AS notification
    WHERE notification.type = 'unread_message'
      AND notification.conversation_id IN (
        'e6200000-0000-4000-8000-000000000002',
        'e6200000-0000-4000-8000-000000000003'
      )
  ) THEN
    RAISE EXCEPTION 'unread block/mute/recipient grouping drifted';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM public.meetups AS meetup
    WHERE meetup.id IN (
      'e6300000-0000-4000-8000-000000000001',
      'e6300000-0000-4000-8000-000000000002'
    ) AND meetup.reminded_at IS NOT NULL
  ) <> 2 OR (
    SELECT pg_catalog.count(*)
    FROM public.messages AS message
    WHERE message.id BETWEEN
      'e6400000-0000-4000-8000-000000000001' AND
      'e6400000-0000-4000-8000-000000000004'
      AND message.reminded_at IS NOT NULL
  ) <> 4 OR EXISTS (
    SELECT 1
    FROM public.messages AS message
    WHERE message.id IN (
      'e6400000-0000-4000-8000-000000000005',
      'e6400000-0000-4000-8000-000000000006'
    ) AND message.reminded_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'source stamp/retirement semantics drifted';
  END IF;
END
$initial_seed$;

-- Starvation regression: two bounded calls retire three older muted messages;
-- the later safe row then becomes eligible instead of remaining behind them.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'e6000000-0000-4000-8000-000000000001',
  true
);
INSERT INTO public.messages (
  id, conversation_id, sender_id, content, message_type, is_read, created_at
) VALUES
  ('e6410000-0000-4000-8000-000000000001', 'e6200000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-000000000001', 'muted backlog one', 'text', false, pg_catalog.now() - interval '30 hours'),
  ('e6410000-0000-4000-8000-000000000002', 'e6200000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-000000000001', 'muted backlog two', 'text', false, pg_catalog.now() - interval '29 hours'),
  ('e6410000-0000-4000-8000-000000000003', 'e6200000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-000000000001', 'muted backlog three', 'text', false, pg_catalog.now() - interval '28 hours'),
  ('e6410000-0000-4000-8000-000000000004', 'e6200000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'safe after backlog', 'text', false, pg_catalog.now() - interval '27 hours');

SET LOCAL ROLE service_role;
INSERT INTO pg_temp.seed_regression_result (label, payload)
SELECT 'starvation_first', public.seed_digest_reminders(1, 2, 12);
INSERT INTO pg_temp.seed_regression_result (label, payload)
SELECT 'starvation_second', public.seed_digest_reminders(1, 2, 12);
RESET ROLE;

DO $starvation$
DECLARE
  first_result jsonb := (
    SELECT payload FROM pg_temp.seed_regression_result
    WHERE label = 'starvation_first'
  );
  second_result jsonb := (
    SELECT payload FROM pg_temp.seed_regression_result
    WHERE label = 'starvation_second'
  );
BEGIN
  IF first_result ->> 'unread_messages_scanned' <> '2'
     OR first_result ->> 'unread_reminders' <> '0'
     OR second_result ->> 'unread_messages_scanned' <> '2'
     OR second_result ->> 'unread_reminders' <> '1' THEN
    RAISE EXCEPTION 'suppressed backlog still starves safe rows: %, %',
      first_result, second_result;
  END IF;
END
$starvation$;

-- Any notification insert error must roll back BOTH notification creation and
-- every reminded_at stamp in the RPC transaction.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'e6000000-0000-4000-8000-000000000001',
  true
);
INSERT INTO public.meetups (
  id, conversation_id, item_id, from_user, to_user, spot, meet_at,
  status, created_at, updated_at
) VALUES (
  'e6300000-0000-4000-8000-000000000004',
  'e6200000-0000-4000-8000-000000000004',
  'e6100000-0000-4000-8000-000000000001',
  'e6000000-0000-4000-8000-000000000001',
  'e6000000-0000-4000-8000-000000000005',
  'Rollback spot',
  pg_catalog.now() + interval '10 hours',
  'accepted',
  pg_catalog.now(),
  pg_catalog.now()
);
INSERT INTO public.messages (
  id, conversation_id, sender_id, content, message_type, is_read, created_at
) VALUES (
  'e6400000-0000-4000-8000-000000000009',
  'e6200000-0000-4000-8000-000000000004',
  'e6000000-0000-4000-8000-000000000001',
  'rollback unread',
  'text',
  false,
  pg_catalog.now() - interval '14 hours'
);

CREATE FUNCTION pg_temp.fail_atomic_seed_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.conversation_id = 'e6200000-0000-4000-8000-000000000004' THEN
    RAISE EXCEPTION 'injected_notification_insert_failure'
      USING ERRCODE = '45000';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER fail_atomic_seed_insert
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_atomic_seed_insert();

DO $rollback_boundary$
BEGIN
  BEGIN
    PERFORM public.seed_digest_reminders(200, 500, 12);
    RAISE EXCEPTION 'injected seed failure unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '45000' THEN
    IF SQLERRM <> 'injected_notification_insert_failure' THEN RAISE; END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM public.meetups
    WHERE id = 'e6300000-0000-4000-8000-000000000004'
      AND reminded_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.messages
    WHERE id = 'e6400000-0000-4000-8000-000000000009'
      AND reminded_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.notifications
    WHERE conversation_id = 'e6200000-0000-4000-8000-000000000004'
      AND source_event_key IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'split failure left a partial reminder seed commit';
  END IF;
END
$rollback_boundary$;

DROP TRIGGER fail_atomic_seed_insert ON public.notifications;

SET LOCAL ROLE service_role;
INSERT INTO pg_temp.seed_regression_result (label, payload)
SELECT 'after_rollback', public.seed_digest_reminders(200, 500, 12);
RESET ROLE;

DO $retry_after_rollback$
DECLARE
  retry_result jsonb := (
    SELECT payload FROM pg_temp.seed_regression_result
    WHERE label = 'after_rollback'
  );
BEGIN
  IF retry_result ->> 'meetup_reminders' <> '1'
     OR retry_result ->> 'unread_reminders' <> '1'
     OR NOT EXISTS (
       SELECT 1 FROM public.meetups
       WHERE id = 'e6300000-0000-4000-8000-000000000004'
         AND reminded_at IS NOT NULL
     ) OR NOT EXISTS (
       SELECT 1 FROM public.messages
       WHERE id = 'e6400000-0000-4000-8000-000000000009'
         AND reminded_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'atomic seed did not recover after rolled-back failure: %',
      retry_result;
  END IF;
END
$retry_after_rollback$;

ROLLBACK;
