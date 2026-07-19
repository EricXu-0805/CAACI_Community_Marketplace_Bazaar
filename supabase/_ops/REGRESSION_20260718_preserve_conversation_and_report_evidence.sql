-- Local/isolated-database behavioral regression for migration 20260717194334.
-- NEVER run against production. Every fixture mutation is rolled back.

BEGIN;

-- These rows model evidence that predates the final local-media boundary and
-- deliberately contain legacy external URLs. Bypass only the later media
-- validator while constructing that historical fixture; all report/snapshot
-- triggers under test remain enabled, and the rollback restores trigger state.
ALTER TABLE public.profiles
  DISABLE TRIGGER authoritative_public_write_boundary;
ALTER TABLE public.items
  DISABLE TRIGGER authoritative_public_write_boundary;
ALTER TABLE public.posts
  DISABLE TRIGGER authoritative_public_write_boundary;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('96000000-0000-0000-0000-000000000001', 'evidence-a@example.test', '{}'::jsonb),
  ('96000000-0000-0000-0000-000000000002', 'evidence-b@example.test', '{}'::jsonb),
  ('96000000-0000-0000-0000-000000000003', 'evidence-c@example.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (
  id, nickname, avatar_url, bio, status_text, status_emoji
) VALUES
  (
    '96000000-0000-0000-0000-000000000001',
    'Evidence A', NULL, 'reporter bio', NULL, NULL
  ),
  (
    '96000000-0000-0000-0000-000000000002',
    'Evidence B', 'https://example.test/avatar-b.jpg', 'public target bio',
    'public status', 'B'
  ),
  (
    '96000000-0000-0000-0000-000000000003',
    'Evidence C', NULL, 'outsider bio', NULL, NULL
  )
ON CONFLICT (id) DO UPDATE SET
  nickname = EXCLUDED.nickname,
  avatar_url = EXCLUDED.avatar_url,
  bio = EXCLUDED.bio,
  status_text = EXCLUDED.status_text,
  status_emoji = EXCLUDED.status_emoji;

INSERT INTO public.items (
  id, user_id, title, description, price, status, negotiable, listing_type,
  images
) VALUES
  (
    '96100000-0000-0000-0000-000000000001',
    '96000000-0000-0000-0000-000000000002',
    'Evidence item', 'Evidence item description', 25, 'active', true, 'sell',
    ARRAY['https://example.test/item-1.jpg']::text[]
  ),
  (
    '96100000-0000-0000-0000-000000000002',
    '96000000-0000-0000-0000-000000000002',
    'Second visible item', 'Injection privilege fixture', 30, 'active', true,
    'sell', ARRAY[]::text[]
  ),
  (
    '96100000-0000-0000-0000-000000000003',
    '96000000-0000-0000-0000-000000000002',
    'Deleted secret item', 'must never enter a snapshot', 35, 'deleted', true,
    'sell', ARRAY['https://example.test/secret-item.jpg']::text[]
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  images = EXCLUDED.images,
  negotiable = EXCLUDED.negotiable;

INSERT INTO public.posts (id, user_id, content, images, status) VALUES
  (
    '96200000-0000-0000-0000-000000000001',
    '96000000-0000-0000-0000-000000000002',
    'Evidence post content',
    ARRAY['https://example.test/post-1.jpg']::text[],
    'active'
  ),
  (
    '96200000-0000-0000-0000-000000000002',
    '96000000-0000-0000-0000-000000000002',
    'Hidden post secret',
    ARRAY['https://example.test/secret-post.jpg']::text[],
    'hidden'
  )
ON CONFLICT (id) DO UPDATE SET
  content = EXCLUDED.content,
  images = EXCLUDED.images,
  status = EXCLUDED.status;

ALTER TABLE public.profiles
  ENABLE TRIGGER authoritative_public_write_boundary;
ALTER TABLE public.items
  ENABLE TRIGGER authoritative_public_write_boundary;
ALTER TABLE public.posts
  ENABLE TRIGGER authoritative_public_write_boundary;

INSERT INTO public.post_comments (
  id, post_id, user_id, content, status
) VALUES
  (
    '96300000-0000-0000-0000-000000000001',
    '96200000-0000-0000-0000-000000000001',
    '96000000-0000-0000-0000-000000000002',
    'Evidence comment content', 'active'
  ),
  (
    '96300000-0000-0000-0000-000000000002',
    '96200000-0000-0000-0000-000000000001',
    '96000000-0000-0000-0000-000000000002',
    'Hidden comment secret', 'hidden'
  ),
  (
    '96300000-0000-0000-0000-000000000003',
    '96200000-0000-0000-0000-000000000002',
    '96000000-0000-0000-0000-000000000002',
    'Active comment under hidden post secret', 'active'
  )
ON CONFLICT (id) DO UPDATE SET
  content = EXCLUDED.content,
  status = EXCLUDED.status;

INSERT INTO public.conversations (
  id, item_id, buyer_id, seller_id
) VALUES (
  '96400000-0000-0000-0000-000000000001',
  '96100000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000002'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.messages (
  id, conversation_id, sender_id, content, message_type
) VALUES
  (
    '96500000-0000-0000-0000-000000000001',
    '96400000-0000-0000-0000-000000000001',
    '96000000-0000-0000-0000-000000000001',
    'A own message', 'text'
  ),
  (
    '96500000-0000-0000-0000-000000000002',
    '96400000-0000-0000-0000-000000000001',
    '96000000-0000-0000-0000-000000000002',
    'Evidence message from B', 'text'
  ),
  (
    '96500000-0000-0000-0000-000000000003',
    '96400000-0000-0000-0000-000000000001',
    '96000000-0000-0000-0000-000000000002',
    'Blocked message from B', 'text'
  )
ON CONFLICT (id) DO NOTHING;

-- Per-user archives are isolated. Neither side can forge the other's intent.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000001',
  true
);
SELECT public.archive_conversation(
  '96400000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001'
);

DO $test$
DECLARE
  archive_count integer;
BEGIN
  SELECT pg_catalog.count(*) INTO archive_count
  FROM public.conversation_archives;
  IF archive_count <> 1 THEN
    RAISE EXCEPTION 'A should see exactly its own archive row, got %', archive_count;
  END IF;

  BEGIN
    PERFORM public.archive_conversation(
      '96400000-0000-0000-0000-000000000001',
      '96000000-0000-0000-0000-000000000002'
    );
    RAISE EXCEPTION 'A forged B archive intent';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    PERFORM public.archive_conversation(
      '96400000-0000-0000-0000-000000000099',
      '96000000-0000-0000-0000-000000000001'
    );
    RAISE EXCEPTION 'A archived an unavailable conversation';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.conversation_archives (user_id, conversation_id)
    VALUES (
      '96000000-0000-0000-0000-000000000001',
      '96400000-0000-0000-0000-000000000001'
    );
    RAISE EXCEPTION 'authenticated caller wrote archive table directly';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END
$test$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000002',
  true
);

DO $test$
DECLARE
  archive_count integer;
BEGIN
  SELECT pg_catalog.count(*) INTO archive_count
  FROM public.conversation_archives;
  IF archive_count <> 0 THEN
    RAISE EXCEPTION 'B can see A archive row';
  END IF;
END
$test$;

SELECT public.archive_conversation(
  '96400000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000002'
);
RESET ROLE;

DO $test$
DECLARE
  archive_count integer;
BEGIN
  SELECT pg_catalog.count(*) INTO archive_count
  FROM public.conversation_archives
  WHERE conversation_id = '96400000-0000-0000-0000-000000000001';
  IF archive_count <> 2 THEN
    RAISE EXCEPTION 'bilateral archives should coexist, got %', archive_count;
  END IF;
END
$test$;

-- A new real message clears both parties' archive rows.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000001',
  true
);
INSERT INTO public.messages (
  id, conversation_id, sender_id, content, message_type
) VALUES (
  '96500000-0000-0000-0000-000000000004',
  '96400000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001',
  'new activity clears archives', 'text'
);
RESET ROLE;

DO $test$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.conversation_archives
    WHERE conversation_id = '96400000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'message activity did not clear both archives';
  END IF;
END
$test$;

-- Offer insert and state change each clear a freshly archived conversation.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000001',
  true
);
SELECT public.archive_conversation(
  '96400000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001'
);
SELECT pg_catalog.set_config(
  'caaci_test.evidence_offer_id',
  (public.make_offer(
    '96400000-0000-0000-0000-000000000001',
    20,
    '96000000-0000-0000-0000-000000000001',
    'archive insert test'
  )).id::text,
  true
);

DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM public.conversation_archives) THEN
    RAISE EXCEPTION 'offer insert did not clear archive';
  END IF;
END
$test$;

SELECT public.archive_conversation(
  '96400000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001'
);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000002',
  true
);
SELECT public.respond_to_offer(
  pg_catalog.current_setting('caaci_test.evidence_offer_id')::uuid,
  'decline',
  '96000000-0000-0000-0000-000000000002',
  NULL,
  NULL
);

DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM public.conversation_archives) THEN
    RAISE EXCEPTION 'offer status change did not clear archive';
  END IF;
END
$test$;

-- A background offer expiry carries no realtime/user-visible signal and must
-- not resurrect an archived inbox row. A later meaningful status change does.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000001',
  true
);
SELECT pg_catalog.set_config(
  'caaci_test.evidence_expiring_offer_id',
  (public.make_offer(
    '96400000-0000-0000-0000-000000000001',
    21,
    '96000000-0000-0000-0000-000000000001',
    'expiry boundary test'
  )).id::text,
  true
);
SELECT public.archive_conversation(
  '96400000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001'
);
RESET ROLE;

UPDATE public.offers
SET status = 'expired'
WHERE id = pg_catalog.current_setting(
  'caaci_test.evidence_expiring_offer_id'
)::uuid;

DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_archives
    WHERE user_id = '96000000-0000-0000-0000-000000000001'
      AND conversation_id = '96400000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'pure offer expiry reopened an archived conversation';
  END IF;
END
$test$;

UPDATE public.offers
SET status = 'declined'
WHERE id = pg_catalog.current_setting(
  'caaci_test.evidence_expiring_offer_id'
)::uuid;

DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM public.conversation_archives) THEN
    RAISE EXCEPTION 'meaningful offer status after expiry did not clear archive';
  END IF;
END
$test$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000002',
  true
);

-- Meetup insert and state change each clear a freshly archived conversation.
SELECT public.archive_conversation(
  '96400000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000002'
);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000001',
  true
);
SELECT pg_catalog.set_config(
  'caaci_test.evidence_meetup_id',
  (public.propose_meetup(
    '96400000-0000-0000-0000-000000000001',
    'Illini Union',
    pg_catalog.now() + interval '2 days',
    '96000000-0000-0000-0000-000000000001',
    'archive insert test'
  )).id::text,
  true
);

DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM public.conversation_archives) THEN
    RAISE EXCEPTION 'meetup insert did not clear archive';
  END IF;
END
$test$;

SELECT public.archive_conversation(
  '96400000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001'
);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000002',
  true
);
SELECT public.respond_to_meetup(
  pg_catalog.current_setting('caaci_test.evidence_meetup_id')::uuid,
  'decline',
  '96000000-0000-0000-0000-000000000002',
  NULL,
  NULL,
  NULL
);

DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM public.conversation_archives) THEN
    RAISE EXCEPTION 'meetup status change did not clear archive';
  END IF;
END
$test$;

-- Pure meetup expiry is likewise background lifecycle noise. A subsequent
-- note/place/time edit is user-visible activity and still clears the archive.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000001',
  true
);
SELECT pg_catalog.set_config(
  'caaci_test.evidence_expiring_meetup_id',
  (public.propose_meetup(
    '96400000-0000-0000-0000-000000000001',
    'Grainger Library',
    pg_catalog.now() + interval '3 days',
    '96000000-0000-0000-0000-000000000001',
    'expiry boundary test'
  )).id::text,
  true
);
SELECT public.archive_conversation(
  '96400000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001'
);
RESET ROLE;

UPDATE public.meetups
SET status = 'expired'
WHERE id = pg_catalog.current_setting(
  'caaci_test.evidence_expiring_meetup_id'
)::uuid;

DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_archives
    WHERE user_id = '96000000-0000-0000-0000-000000000001'
      AND conversation_id = '96400000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'pure meetup expiry reopened an archived conversation';
  END IF;
END
$test$;

UPDATE public.meetups
SET note = 'visible follow-up after expiry'
WHERE id = pg_catalog.current_setting(
  'caaci_test.evidence_expiring_meetup_id'
)::uuid;

DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM public.conversation_archives) THEN
    RAISE EXCEPTION 'meetup note change after expiry did not clear archive';
  END IF;
END
$test$;

SET LOCAL ROLE authenticated;

-- Authenticated clients can no longer destroy shared evidence.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000001',
  true
);
DO $test$
BEGIN
  BEGIN
    DELETE FROM public.messages
    WHERE id = '96500000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'authenticated sender deleted a message';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    DELETE FROM public.conversations
    WHERE id = '96400000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'authenticated participant deleted a conversation';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END
$test$;
RESET ROLE;

DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.messages
    WHERE id = '96500000-0000-0000-0000-000000000001'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = '96400000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'failed client DELETE changed shared evidence';
  END IF;
END
$test$;

-- Nonparticipants, self-reports, arbitrary UUIDs and hidden targets all fail
-- with one non-enumerating SQLSTATE/message contract.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000003',
  true
);
DO $test$
BEGIN
  BEGIN
    INSERT INTO public.reports (
      reporter_id, target_type, target_id, reason, note
    ) VALUES (
      '96000000-0000-0000-0000-000000000003',
      'message', '96500000-0000-0000-0000-000000000002',
      'spam', 'nonparticipant must fail'
    );
    RAISE EXCEPTION 'nonparticipant reported a private message';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'report_target_unavailable' THEN
      RAISE EXCEPTION 'non-generic private-target error: %', SQLERRM;
    END IF;
  END;
END
$test$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000001',
  true
);
DO $test$
DECLARE
  target_kind text;
BEGIN
  BEGIN
    INSERT INTO public.reports (
      reporter_id, target_type, target_id, reason
    ) VALUES (
      '96000000-0000-0000-0000-000000000001',
      'message', '96500000-0000-0000-0000-000000000001', 'spam'
    );
    RAISE EXCEPTION 'sender reported own message';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  FOREACH target_kind IN ARRAY ARRAY['message', 'item', 'post', 'comment', 'user']
  LOOP
    BEGIN
      INSERT INTO public.reports (
        reporter_id, target_type, target_id, reason
      ) VALUES (
        '96000000-0000-0000-0000-000000000001',
        target_kind,
        '96900000-0000-0000-0000-000000000099',
        'spam'
      );
      RAISE EXCEPTION 'arbitrary % UUID produced a report', target_kind;
    EXCEPTION WHEN SQLSTATE '42501' THEN
      IF SQLERRM <> 'report_target_unavailable' THEN
        RAISE EXCEPTION 'non-generic arbitrary-target error: %', SQLERRM;
      END IF;
    END;
  END LOOP;

  BEGIN
    INSERT INTO public.reports (reporter_id, target_type, target_id, reason)
    VALUES (
      '96000000-0000-0000-0000-000000000001', 'item',
      '96100000-0000-0000-0000-000000000003', 'prohibited'
    );
    RAISE EXCEPTION 'deleted item content entered snapshot';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.reports (reporter_id, target_type, target_id, reason)
    VALUES (
      '96000000-0000-0000-0000-000000000001', 'post',
      '96200000-0000-0000-0000-000000000002', 'spam'
    );
    RAISE EXCEPTION 'hidden post content entered snapshot';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.reports (reporter_id, target_type, target_id, reason)
    VALUES (
      '96000000-0000-0000-0000-000000000001', 'comment',
      '96300000-0000-0000-0000-000000000002', 'spam'
    );
    RAISE EXCEPTION 'hidden comment content entered snapshot';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.reports (reporter_id, target_type, target_id, reason)
    VALUES (
      '96000000-0000-0000-0000-000000000001', 'comment',
      '96300000-0000-0000-0000-000000000003', 'spam'
    );
    RAISE EXCEPTION 'comment under hidden post entered snapshot';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.reports (
      reporter_id, target_type, target_id, reason, target_snapshot
    ) VALUES (
      '96000000-0000-0000-0000-000000000001', 'item',
      '96100000-0000-0000-0000-000000000002', 'spam',
      '{"forged":"secret"}'::jsonb
    );
    RAISE EXCEPTION 'client supplied target_snapshot';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END
$test$;

-- An incoming block also makes the known message UUID unavailable.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000002',
  true
);
INSERT INTO public.blocks (blocker_id, blocked_id) VALUES (
  '96000000-0000-0000-0000-000000000002',
  '96000000-0000-0000-0000-000000000001'
);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000001',
  true
);
DO $test$
BEGIN
  BEGIN
    INSERT INTO public.reports (reporter_id, target_type, target_id, reason)
    VALUES (
      '96000000-0000-0000-0000-000000000001', 'message',
      '96500000-0000-0000-0000-000000000003', 'spam'
    );
    RAISE EXCEPTION 'blocked message entered snapshot';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END
$test$;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000002',
  true
);
DELETE FROM public.blocks
WHERE blocker_id = '96000000-0000-0000-0000-000000000002'
  AND blocked_id = '96000000-0000-0000-0000-000000000001';

-- Valid visible targets create server-authored snapshots. Reporters can read
-- only safe report metadata; the immutable evidence remains operator-only.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000001',
  true
);
INSERT INTO public.reports (
  reporter_id, target_type, target_id, reason, note
) VALUES
  (
    '96000000-0000-0000-0000-000000000001', 'message',
    '96500000-0000-0000-0000-000000000002', 'spam', 'message report'
  ),
  (
    '96000000-0000-0000-0000-000000000001', 'item',
    '96100000-0000-0000-0000-000000000001', 'prohibited', 'item report'
  ),
  (
    '96000000-0000-0000-0000-000000000001', 'post',
    '96200000-0000-0000-0000-000000000001', 'spam', 'post report'
  ),
  (
    '96000000-0000-0000-0000-000000000001', 'comment',
    '96300000-0000-0000-0000-000000000001', 'spam', 'comment report'
  ),
  (
    '96000000-0000-0000-0000-000000000001', 'user',
    '96000000-0000-0000-0000-000000000002', 'spam', 'user report'
  );

DO $test$
DECLARE
  safe_count integer;
BEGIN
  IF pg_catalog.has_any_column_privilege(
       'authenticated', 'public.reports', 'SELECT'
     ) THEN
    -- Immediate post-migration stage: safe own-report metadata remains
    -- readable under RLS while the internal snapshot stays closed.
    SELECT pg_catalog.count(*) INTO safe_count
    FROM public.reports
    WHERE reporter_id = '96000000-0000-0000-0000-000000000001'
      AND target_id IN (
        '96500000-0000-0000-0000-000000000002',
        '96100000-0000-0000-0000-000000000001',
        '96200000-0000-0000-0000-000000000001',
        '96300000-0000-0000-0000-000000000001',
        '96000000-0000-0000-0000-000000000002'
      );
    IF safe_count <> 5 THEN
      RAISE EXCEPTION 'reporter could not read safe own-report metadata';
    END IF;
  ELSE
    -- Final app ACL stage: the shipped client submits reports but has no
    -- report-history screen, so the entire read surface is deliberately shut.
    BEGIN
      PERFORM id FROM public.reports LIMIT 1;
      RAISE EXCEPTION 'reporter read reports after final ACL closure';
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
  END IF;

  BEGIN
    PERFORM target_snapshot
    FROM public.reports
    WHERE reporter_id = '96000000-0000-0000-0000-000000000001'
    LIMIT 1;
    RAISE EXCEPTION 'reporter read internal target_snapshot';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END
$test$;
RESET ROLE;

DO $test$
DECLARE
  report_row record;
BEGIN
  FOR report_row IN
    SELECT target_type, target_snapshot
    FROM public.reports
    WHERE reporter_id = '96000000-0000-0000-0000-000000000001'
      AND target_id IN (
        '96500000-0000-0000-0000-000000000002',
        '96100000-0000-0000-0000-000000000001',
        '96200000-0000-0000-0000-000000000001',
        '96300000-0000-0000-0000-000000000001',
        '96000000-0000-0000-0000-000000000002'
      )
  LOOP
    IF report_row.target_snapshot IS NULL
       OR report_row.target_snapshot ->> 'target_type' <> report_row.target_type
       OR report_row.target_snapshot ->> 'target_user_id' <>
         '96000000-0000-0000-0000-000000000002'
       OR report_row.target_snapshot ->> 'target_user_nickname' <> 'Evidence B'
       OR NOT (report_row.target_snapshot ? 'captured_at') THEN
      RAISE EXCEPTION 'invalid % snapshot: %',
        report_row.target_type, report_row.target_snapshot;
    END IF;
    IF report_row.target_snapshot ?| ARRAY[
      'email', 'phone', 'wechat_openid', 'location', 'trust_score',
      'suspension_level'
    ] THEN
      RAISE EXCEPTION 'snapshot leaked non-minimal profile data: %',
        report_row.target_snapshot;
    END IF;
  END LOOP;

  IF (
    SELECT pg_catalog.count(*)
    FROM public.reports
    WHERE reporter_id = '96000000-0000-0000-0000-000000000001'
      AND target_snapshot IS NOT NULL
  ) <> 5 THEN
    RAISE EXCEPTION 'expected five valid snapshots';
  END IF;
END
$test$;

-- Evidence fields stay immutable even to a trusted direct UPDATE path.
DO $test$
BEGIN
  BEGIN
    UPDATE public.reports
    SET target_snapshot = '{}'::jsonb
    WHERE reporter_id = '96000000-0000-0000-0000-000000000001'
      AND target_type = 'message'
      AND target_id = '96500000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'trusted path changed report evidence';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
END
$test$;

-- Save report IDs, then hard-delete every live target as trusted maintenance.
SELECT pg_catalog.set_config(
  'caaci_test.message_report_id',
  id::text,
  true
) FROM public.reports
WHERE reporter_id = '96000000-0000-0000-0000-000000000001'
  AND target_type = 'message'
  AND target_id = '96500000-0000-0000-0000-000000000002';
SELECT pg_catalog.set_config(
  'caaci_test.item_report_id', id::text, true
) FROM public.reports
WHERE reporter_id = '96000000-0000-0000-0000-000000000001'
  AND target_type = 'item'
  AND target_id = '96100000-0000-0000-0000-000000000001';
SELECT pg_catalog.set_config(
  'caaci_test.post_report_id', id::text, true
) FROM public.reports
WHERE reporter_id = '96000000-0000-0000-0000-000000000001'
  AND target_type = 'post'
  AND target_id = '96200000-0000-0000-0000-000000000001';
SELECT pg_catalog.set_config(
  'caaci_test.comment_report_id', id::text, true
) FROM public.reports
WHERE reporter_id = '96000000-0000-0000-0000-000000000001'
  AND target_type = 'comment'
  AND target_id = '96300000-0000-0000-0000-000000000001';
SELECT pg_catalog.set_config(
  'caaci_test.user_report_id', id::text, true
) FROM public.reports
WHERE reporter_id = '96000000-0000-0000-0000-000000000001'
  AND target_type = 'user'
  AND target_id = '96000000-0000-0000-0000-000000000002';

DELETE FROM public.messages
WHERE id = '96500000-0000-0000-0000-000000000002';
DELETE FROM public.offers
WHERE conversation_id = '96400000-0000-0000-0000-000000000001';
DELETE FROM public.meetups
WHERE conversation_id = '96400000-0000-0000-0000-000000000001';
DELETE FROM public.messages
WHERE conversation_id = '96400000-0000-0000-0000-000000000001';
DELETE FROM public.notifications
WHERE conversation_id = '96400000-0000-0000-0000-000000000001'
   OR item_id = '96100000-0000-0000-0000-000000000001';
DELETE FROM public.conversations
WHERE id = '96400000-0000-0000-0000-000000000001';
DELETE FROM public.items
WHERE id = '96100000-0000-0000-0000-000000000001';
DELETE FROM public.post_comments
WHERE post_id = '96200000-0000-0000-0000-000000000001';
DELETE FROM public.posts
WHERE id = '96200000-0000-0000-0000-000000000001';
DELETE FROM public.post_comments
WHERE user_id = '96000000-0000-0000-0000-000000000002';
DELETE FROM public.posts
WHERE user_id = '96000000-0000-0000-0000-000000000002';
DELETE FROM public.items
WHERE user_id = '96000000-0000-0000-0000-000000000002';
DELETE FROM public.profiles
WHERE id = '96000000-0000-0000-0000-000000000002';

-- service_role must be able to call the unchanged admin API after live rows
-- disappear. The following SELECT also exercises the actual role ACL.
SET LOCAL ROLE service_role;
SELECT target_type, target_user_id, target_user_nickname, target_preview,
       target_image
FROM public.admin_get_report_detail(
  pg_catalog.current_setting('caaci_test.message_report_id')::uuid
);
RESET ROLE;

DO $test$
DECLARE
  detail record;
BEGIN
  SELECT * INTO detail
  FROM public.admin_get_report_detail(
    pg_catalog.current_setting('caaci_test.message_report_id')::uuid
  );
  IF detail.target_user_id <>
       '96000000-0000-0000-0000-000000000002'::uuid
     OR detail.target_user_nickname <> 'Evidence B'
     OR detail.target_preview <> 'Evidence message from B' THEN
    RAISE EXCEPTION 'message snapshot fallback failed: %', detail;
  END IF;

  SELECT * INTO detail
  FROM public.admin_get_report_detail(
    pg_catalog.current_setting('caaci_test.item_report_id')::uuid
  );
  IF detail.target_user_id <>
       '96000000-0000-0000-0000-000000000002'::uuid
     OR detail.target_user_nickname <> 'Evidence B'
     OR detail.target_preview <> 'Evidence item'
     OR detail.target_image <> 'https://example.test/item-1.jpg' THEN
    RAISE EXCEPTION 'item snapshot fallback failed: %', detail;
  END IF;

  SELECT * INTO detail
  FROM public.admin_get_report_detail(
    pg_catalog.current_setting('caaci_test.post_report_id')::uuid
  );
  IF detail.target_user_id <>
       '96000000-0000-0000-0000-000000000002'::uuid
     OR detail.target_user_nickname <> 'Evidence B'
     OR detail.target_preview <> 'Evidence post content'
     OR detail.target_image <> 'https://example.test/post-1.jpg' THEN
    RAISE EXCEPTION 'post snapshot fallback failed: %', detail;
  END IF;

  SELECT * INTO detail
  FROM public.admin_get_report_detail(
    pg_catalog.current_setting('caaci_test.comment_report_id')::uuid
  );
  IF detail.target_user_id <>
       '96000000-0000-0000-0000-000000000002'::uuid
     OR detail.target_user_nickname <> 'Evidence B'
     OR detail.target_preview <> 'Evidence comment content' THEN
    RAISE EXCEPTION 'comment snapshot fallback failed: %', detail;
  END IF;

  SELECT * INTO detail
  FROM public.admin_get_report_detail(
    pg_catalog.current_setting('caaci_test.user_report_id')::uuid
  );
  IF detail.target_user_id <>
       '96000000-0000-0000-0000-000000000002'::uuid
     OR detail.target_user_nickname <> 'Evidence B'
     OR detail.target_preview IS NOT NULL THEN
    RAISE EXCEPTION 'user snapshot fallback failed: %', detail;
  END IF;
END
$test$;

ROLLBACK;
