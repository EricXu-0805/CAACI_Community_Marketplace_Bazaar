-- Isolated/local behavioral regression for durable meetup-email attribution.
-- NEVER run against production. Every fixture mutation is rolled back.

\set ON_ERROR_STOP on

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure(
       'private.enqueue_meetup_event_notification(uuid,text,uuid,text,text,uuid,uuid)'
     ) IS NULL OR pg_catalog.to_regprocedure(
       'public.resolve_meetup_email_notification(uuid,text,uuid,uuid)'
     ) IS NULL OR pg_catalog.to_regprocedure(
       'public.mark_meetup_email_notification_emailed(uuid,text)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'regression_preflight_failed: durable meetup delivery migration is not applied';
  END IF;
END
$preflight$;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e5000000-0000-4000-8000-000000000001', 'meetup-seller@example.test', '{}'::jsonb),
  ('e5000000-0000-4000-8000-000000000002', 'meetup-buyer-a@example.test', '{}'::jsonb),
  ('e5000000-0000-4000-8000-000000000003', 'meetup-buyer-b@example.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname) VALUES
  ('e5000000-0000-4000-8000-000000000001', 'Meetup Seller'),
  ('e5000000-0000-4000-8000-000000000002', 'Meetup Buyer A'),
  ('e5000000-0000-4000-8000-000000000003', 'Meetup Buyer B')
ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname;

-- The current resource/chat triggers bind writes to auth.uid even for fixture
-- setup. Use the seller claim because the seller owns the item and belongs to
-- both conversations.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'e5000000-0000-4000-8000-000000000001',
  true
);

INSERT INTO public.items (
  id, user_id, title, description, price, category, condition, status
) VALUES (
  'e5100000-0000-4000-8000-000000000001',
  'e5000000-0000-4000-8000-000000000001',
  'Two-buyer meetup fixture',
  'Same item, independent meetup events',
  25,
  'other',
  'good',
  'active'
);

INSERT INTO public.conversations (
  id, item_id, buyer_id, seller_id, last_message_at
) VALUES
  (
    'e5200000-0000-4000-8000-000000000001',
    'e5100000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000002',
    'e5000000-0000-4000-8000-000000000001',
    pg_catalog.now()
  ),
  (
    'e5200000-0000-4000-8000-000000000002',
    'e5100000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000003',
    'e5000000-0000-4000-8000-000000000001',
    pg_catalog.now()
  );

CREATE TEMP TABLE meetup_delivery_regression_state (
  key text PRIMARY KEY,
  id uuid NOT NULL
) ON COMMIT DROP;
CREATE TEMP TABLE meetup_delivery_regression_results (
  key text PRIMARY KEY,
  value boolean NOT NULL
) ON COMMIT DROP;
GRANT SELECT, INSERT ON TABLE pg_temp.meetup_delivery_regression_state
  TO authenticated, service_role;
GRANT SELECT, INSERT ON TABLE pg_temp.meetup_delivery_regression_results
  TO authenticated, service_role;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'e5000000-0000-4000-8000-000000000002',
  true
);
INSERT INTO pg_temp.meetup_delivery_regression_state (key, id)
SELECT 'meetup_a', (public.propose_meetup(
    'e5200000-0000-4000-8000-000000000001',
    'Grainger entrance A',
    pg_catalog.now() + interval '2 days',
    'e5000000-0000-4000-8000-000000000002',
    'Buyer A proposal'
  )).id;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'e5000000-0000-4000-8000-000000000003',
  true
);
INSERT INTO pg_temp.meetup_delivery_regression_state (key, id)
SELECT 'meetup_b', (public.propose_meetup(
    'e5200000-0000-4000-8000-000000000002',
    'Grainger entrance B',
    pg_catalog.now() + interval '3 days',
    'e5000000-0000-4000-8000-000000000003',
    'Buyer B proposal'
  )).id;
RESET ROLE;

DO $two_buyers$
DECLARE
  event_count integer;
  distinct_id_count integer;
BEGIN
  SELECT pg_catalog.count(*), pg_catalog.count(DISTINCT notification.id)
    INTO event_count, distinct_id_count
  FROM public.notifications AS notification
  WHERE notification.source_event_key IN (
    'meetup:' || (
      SELECT state.id::text
      FROM pg_temp.meetup_delivery_regression_state AS state
      WHERE state.key = 'meetup_a'
    ) || ':pending',
    'meetup:' || (
      SELECT state.id::text
      FROM pg_temp.meetup_delivery_regression_state AS state
      WHERE state.key = 'meetup_b'
    ) || ':pending'
  )
    AND notification.item_id = 'e5100000-0000-4000-8000-000000000001'
    AND notification.user_id = 'e5000000-0000-4000-8000-000000000001';

  IF event_count <> 2 OR distinct_id_count <> 2 THEN
    RAISE EXCEPTION
      'two-buyer events were merged or lost: rows %, ids %',
      event_count, distinct_id_count;
  END IF;
END
$two_buyers$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'e5000000-0000-4000-8000-000000000001',
  true
);
INSERT INTO pg_temp.meetup_delivery_regression_state (key, id)
SELECT 'accepted_a', (public.respond_to_meetup(
    (
      SELECT state.id
      FROM pg_temp.meetup_delivery_regression_state AS state
      WHERE state.key = 'meetup_a'
    ),
    'accept',
    'e5000000-0000-4000-8000-000000000001'::uuid
  )).id;
INSERT INTO pg_temp.meetup_delivery_regression_state (key, id)
SELECT 'declined_b', (public.respond_to_meetup(
    (
      SELECT state.id
      FROM pg_temp.meetup_delivery_regression_state AS state
      WHERE state.key = 'meetup_b'
    ),
    'decline',
    'e5000000-0000-4000-8000-000000000001'::uuid
  )).id;
INSERT INTO pg_temp.meetup_delivery_regression_state (key, id)
SELECT 'child_a', (public.reschedule_accepted_meetup(
    (
      SELECT state.id
      FROM pg_temp.meetup_delivery_regression_state AS state
      WHERE state.key = 'accepted_a'
    ),
    'Siebel entrance',
    pg_catalog.now() + interval '4 days',
    'e5000000-0000-4000-8000-000000000001',
    'Seller changed the time'
  )).id;
RESET ROLE;

-- Resolve both an older accepted event and its newer same-conversation child.
-- A delayed acknowledgement for the older email must not stamp the child.
SET LOCAL ROLE service_role;
INSERT INTO pg_temp.meetup_delivery_regression_state (key, id)
SELECT 'old_notification', notification_id
FROM public.resolve_meetup_email_notification(
  (
    SELECT state.id
    FROM pg_temp.meetup_delivery_regression_state AS state
    WHERE state.key = 'accepted_a'
  ),
  'accepted',
  'e5000000-0000-4000-8000-000000000002',
  'e5200000-0000-4000-8000-000000000001'
);
INSERT INTO pg_temp.meetup_delivery_regression_state (key, id)
SELECT 'child_notification', notification_id
FROM public.resolve_meetup_email_notification(
  (
    SELECT state.id
    FROM pg_temp.meetup_delivery_regression_state AS state
    WHERE state.key = 'child_a'
  ),
  'pending',
  'e5000000-0000-4000-8000-000000000002',
  'e5200000-0000-4000-8000-000000000001'
);

INSERT INTO pg_temp.meetup_delivery_regression_results (key, value)
SELECT 'wrong_pair', public.mark_meetup_email_notification_emailed(
  (
    SELECT state.id
    FROM pg_temp.meetup_delivery_regression_state AS state
    WHERE state.key = 'old_notification'
  ),
  'meetup:' || (
    SELECT state.id::text
    FROM pg_temp.meetup_delivery_regression_state AS state
    WHERE state.key = 'child_a'
  ) || ':pending'
);
INSERT INTO pg_temp.meetup_delivery_regression_results (key, value)
SELECT 'exact_pair', public.mark_meetup_email_notification_emailed(
  (
    SELECT state.id
    FROM pg_temp.meetup_delivery_regression_state AS state
    WHERE state.key = 'old_notification'
  ),
  'meetup:' || (
    SELECT state.id::text
    FROM pg_temp.meetup_delivery_regression_state AS state
    WHERE state.key = 'accepted_a'
  ) || ':accepted'
);
INSERT INTO pg_temp.meetup_delivery_regression_results (key, value)
SELECT 'replay', public.mark_meetup_email_notification_emailed(
  (
    SELECT state.id
    FROM pg_temp.meetup_delivery_regression_state AS state
    WHERE state.key = 'old_notification'
  ),
  'meetup:' || (
    SELECT state.id::text
    FROM pg_temp.meetup_delivery_regression_state AS state
    WHERE state.key = 'accepted_a'
  ) || ':accepted'
);
RESET ROLE;

DO $exact_ack$
BEGIN
  IF (
    SELECT state.id
    FROM pg_temp.meetup_delivery_regression_state AS state
    WHERE state.key = 'old_notification'
  ) = (
    SELECT state.id
    FROM pg_temp.meetup_delivery_regression_state AS state
    WHERE state.key = 'child_notification'
  ) THEN
    RAISE EXCEPTION 'same-conversation events resolved to one notification id';
  END IF;
  IF (SELECT result.value FROM pg_temp.meetup_delivery_regression_results AS result WHERE result.key = 'wrong_pair')
     OR NOT (SELECT result.value FROM pg_temp.meetup_delivery_regression_results AS result WHERE result.key = 'exact_pair')
     OR NOT (SELECT result.value FROM pg_temp.meetup_delivery_regression_results AS result WHERE result.key = 'replay') THEN
    RAISE EXCEPTION 'exact acknowledgement CAS result drifted';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.notifications AS notification
    WHERE notification.id = (
            SELECT state.id
            FROM pg_temp.meetup_delivery_regression_state AS state
            WHERE state.key = 'old_notification'
          )
      AND notification.emailed_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.notifications AS notification
    WHERE notification.id = (
            SELECT state.id
            FROM pg_temp.meetup_delivery_regression_state AS state
            WHERE state.key = 'child_notification'
          )
      AND notification.emailed_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.notifications AS notification
    WHERE notification.source_event_key =
            'meetup:' || (
              SELECT state.id::text
              FROM pg_temp.meetup_delivery_regression_state AS state
              WHERE state.key = 'meetup_b'
            ) || ':declined'
      AND notification.emailed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'exact acknowledgement stamped an unrelated event';
  END IF;
END
$exact_ack$;

DO $unique_event_key$
BEGIN
  BEGIN
    INSERT INTO public.notifications (
      user_id, type, title, body, item_id, conversation_id, source_event_key
    ) VALUES (
      'e5000000-0000-4000-8000-000000000002',
      'meetup',
      'duplicate event fixture',
      '',
      'e5100000-0000-4000-8000-000000000001',
      'e5200000-0000-4000-8000-000000000001',
      'meetup:' || (
        SELECT state.id::text
        FROM pg_temp.meetup_delivery_regression_state AS state
        WHERE state.key = 'child_a'
      ) || ':pending'
    );
    RAISE EXCEPTION 'duplicate source event key unexpectedly inserted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END
$unique_event_key$;

ROLLBACK;
