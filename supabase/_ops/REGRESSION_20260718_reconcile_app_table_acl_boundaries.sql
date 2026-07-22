-- Local/isolated behavior regression for migration 20260718280000.
-- NEVER run against production. Every fixture and role change rolls back.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a2800000-0000-4000-8000-000000000001', 'acl-a@example.test', '{}'::jsonb),
  ('a2800000-0000-4000-8000-000000000002', 'acl-b@example.test', '{}'::jsonb),
  ('a2800000-0000-4000-8000-000000000003', 'acl-nonowner@example.test', '{}'::jsonb),
  ('a2800000-0000-4000-8000-000000000004', 'acl-suspended@example.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname, email, phone) VALUES
  ('a2800000-0000-4000-8000-000000000001', 'ACL A', 'acl-a@example.test', '+12170000001'),
  ('a2800000-0000-4000-8000-000000000002', 'ACL B', 'acl-b@example.test', '+12170000002'),
  ('a2800000-0000-4000-8000-000000000003', 'ACL C', 'acl-c@example.test', '+12170000003'),
  ('a2800000-0000-4000-8000-000000000004', 'ACL Suspended', 'acl-s@example.test', '+12170000004')
ON CONFLICT (id) DO UPDATE SET
  nickname = EXCLUDED.nickname,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone;

UPDATE public.profiles
SET trust_score = 7,
    last_fp_hash = pg_catalog.repeat('f', 64),
    verified_illini_email = 'private-verified@example.test'
WHERE id = 'a2800000-0000-4000-8000-000000000001';

INSERT INTO public.items (
  id, user_id, title, description, price, category, condition, status
) VALUES
  (
    'a2810000-0000-4000-8000-000000000001',
    'a2800000-0000-4000-8000-000000000001',
    'ACL A item', '', 10, 'other', 'good', 'active'
  ),
  (
    'a2810000-0000-4000-8000-000000000002',
    'a2800000-0000-4000-8000-000000000002',
    'ACL B item', '', 20, 'other', 'good', 'active'
  );

INSERT INTO public.conversations (
  id, item_id, buyer_id, seller_id
) VALUES (
  'a2820000-0000-4000-8000-000000000001',
  'a2810000-0000-4000-8000-000000000001',
  'a2800000-0000-4000-8000-000000000002',
  'a2800000-0000-4000-8000-000000000001'
);

INSERT INTO public.messages (
  id, conversation_id, sender_id, content, message_type
) VALUES (
  'a2830000-0000-4000-8000-000000000001',
  'a2820000-0000-4000-8000-000000000001',
  'a2800000-0000-4000-8000-000000000001',
  'ACL private message',
  'text'
);

INSERT INTO public.offers (
  id, conversation_id, item_id, from_user, to_user, price
) VALUES (
  'a2840000-0000-4000-8000-000000000001',
  'a2820000-0000-4000-8000-000000000001',
  'a2810000-0000-4000-8000-000000000001',
  'a2800000-0000-4000-8000-000000000002',
  'a2800000-0000-4000-8000-000000000001',
  9
);

INSERT INTO public.meetups (
  id, conversation_id, item_id, from_user, to_user, spot, meet_at
) VALUES (
  'a2850000-0000-4000-8000-000000000001',
  'a2820000-0000-4000-8000-000000000001',
  'a2810000-0000-4000-8000-000000000001',
  'a2800000-0000-4000-8000-000000000002',
  'a2800000-0000-4000-8000-000000000001',
  'Main Library',
  pg_catalog.now() + interval '1 day'
);

INSERT INTO public.favorites (user_id, item_id) VALUES
  ('a2800000-0000-4000-8000-000000000001', 'a2810000-0000-4000-8000-000000000002'),
  ('a2800000-0000-4000-8000-000000000002', 'a2810000-0000-4000-8000-000000000001');
INSERT INTO public.follows (follower_id, followee_id) VALUES
  ('a2800000-0000-4000-8000-000000000001', 'a2800000-0000-4000-8000-000000000002');
INSERT INTO public.blocks (blocker_id, blocked_id) VALUES
  ('a2800000-0000-4000-8000-000000000001', 'a2800000-0000-4000-8000-000000000003');
INSERT INTO public.saved_searches (
  id, user_id, keyword, listing_type
) VALUES
  (
    'a2860000-0000-4000-8000-000000000001',
    'a2800000-0000-4000-8000-000000000001',
    'desk', 'sell'
  ),
  (
    'a2860000-0000-4000-8000-000000000002',
    'a2800000-0000-4000-8000-000000000002',
    'chair', 'sell'
  );

INSERT INTO public.notifications (
  id, user_id, type, title, body, item_id, source_event_key
) VALUES (
  'a2870000-0000-4000-8000-000000000001',
  'a2800000-0000-4000-8000-000000000002',
  'system', 'ACL notification', 'private body',
  'a2810000-0000-4000-8000-000000000001',
  'acl-regression-private-event-key'
);

INSERT INTO public.posts (id, user_id, content, status) VALUES (
  'a2880000-0000-4000-8000-000000000001',
  'a2800000-0000-4000-8000-000000000001',
  'ACL public post',
  'active'
);
INSERT INTO public.post_comments (
  id, post_id, user_id, content, status
) VALUES
  (
    'a2890000-0000-4000-8000-000000000001',
    'a2880000-0000-4000-8000-000000000001',
    'a2800000-0000-4000-8000-000000000001',
    'ACL public comment',
    'active'
  ),
  (
    'a2890000-0000-4000-8000-000000000002',
    'a2880000-0000-4000-8000-000000000001',
    'a2800000-0000-4000-8000-000000000001',
    'ACL hidden comment',
    'hidden'
  );

INSERT INTO public.suspensions (
  id, profile_id, level, reason, category, started_at, ends_at
) VALUES (
  'a28a0000-0000-4000-8000-000000000001',
  'a2800000-0000-4000-8000-000000000004',
  2, 'ACL active suspension', 'regression',
  pg_catalog.now() - interval '1 hour',
  pg_catalog.now() + interval '1 day'
);

-- Simulate a pre-managed-upload banner row. Migration 200 explicitly permits
-- an unchanged legacy row, and this ACL regression is about the view/base
-- dependency rather than repeating upload-saga behavior.
DO $disable_banner_admission_if_present$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.banners'::pg_catalog.regclass
      AND trigger_row.tgname = 'banners_require_managed_upload'
      AND NOT trigger_row.tgisinternal
  ) THEN
    ALTER TABLE public.banners DISABLE TRIGGER banners_require_managed_upload;
  END IF;
END;
$disable_banner_admission_if_present$;
INSERT INTO public.banners (
  id, image_url, title, priority, active, is_default
) VALUES (
  'a28b0000-0000-4000-8000-000000000001',
  'https://legacy.example.test/acl-banner.png',
  'ACL banner', 10000, true, false
);
DO $enable_banner_admission_if_present$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.banners'::pg_catalog.regclass
      AND trigger_row.tgname = 'banners_require_managed_upload'
      AND NOT trigger_row.tgisinternal
  ) THEN
    ALTER TABLE public.banners ENABLE TRIGGER banners_require_managed_upload;
  END IF;
END;
$enable_banner_admission_if_present$;

-- Anonymous users can render the explicitly public projections but cannot
-- access private profile columns or account-private relations.
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;

DO $anon_contract$
DECLARE
  visible_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO visible_count
  FROM public.profiles
  WHERE id::text LIKE 'a2800000-0000-4000-8000-%';
  IF visible_count <> 4 THEN
    RAISE EXCEPTION 'anon safe profile projection unavailable';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO visible_count
  FROM public.items
  WHERE id::text LIKE 'a2810000-0000-4000-8000-%';
  IF visible_count <> 2 THEN RAISE EXCEPTION 'anon item read unavailable'; END IF;

  SELECT pg_catalog.count(*)::integer INTO visible_count
  FROM public.post_comments
  WHERE id = 'a2890000-0000-4000-8000-000000000001';
  IF visible_count <> 1 THEN RAISE EXCEPTION 'anon comment read unavailable'; END IF;

  SELECT pg_catalog.count(*)::integer INTO visible_count
  FROM public.banners_live
  WHERE id = 'a28b0000-0000-4000-8000-000000000001';
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'security-invoker banner dependency unavailable';
  END IF;

  BEGIN
    PERFORM profile.email FROM public.profiles AS profile LIMIT 1;
    RAISE EXCEPTION 'anon read profiles.email';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM favorite.id FROM public.favorites AS favorite LIMIT 1;
    RAISE EXCEPTION 'anon read favorites';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$anon_contract$;

RESET ROLE;

-- Account A sees only A-owned private state and can execute the shipped direct
-- writes. B-owned rows remain hidden by RLS after ACL admission.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'a2800000-0000-4000-8000-000000000001', true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"a2800000-0000-4000-8000-000000000001","role":"authenticated","iss":"https://aaaaaaaaaaaaaaaaaaaa.supabase.co/auth/v1"}',
  true
);
SET LOCAL ROLE authenticated;

DO $account_a_contract$
DECLARE
  row_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO row_count FROM public.favorites;
  IF row_count <> 1 THEN RAISE EXCEPTION 'A favorites RLS mismatch'; END IF;
  SELECT pg_catalog.count(*)::integer INTO row_count FROM public.blocks;
  IF row_count <> 1 THEN RAISE EXCEPTION 'A blocks RLS mismatch'; END IF;
  SELECT pg_catalog.count(*)::integer INTO row_count FROM public.saved_searches;
  IF row_count <> 1 THEN RAISE EXCEPTION 'A saved-search RLS mismatch'; END IF;
  SELECT pg_catalog.count(*)::integer INTO row_count FROM public.notifications;
  IF row_count <> 0 THEN RAISE EXCEPTION 'A saw B notification'; END IF;
  SELECT pg_catalog.count(*)::integer INTO row_count FROM public.conversations;
  IF row_count <> 1 THEN RAISE EXCEPTION 'A conversation unavailable'; END IF;
  SELECT pg_catalog.count(*)::integer INTO row_count FROM public.messages;
  IF row_count <> 1 THEN RAISE EXCEPTION 'A message unavailable'; END IF;
  SELECT pg_catalog.count(*)::integer INTO row_count FROM public.offers;
  IF row_count <> 1 THEN RAISE EXCEPTION 'A offer unavailable'; END IF;
  SELECT pg_catalog.count(*)::integer INTO row_count FROM public.meetups;
  IF row_count <> 1 THEN RAISE EXCEPTION 'A meetup unavailable'; END IF;

  BEGIN
    PERFORM profile.trust_score FROM public.profiles AS profile LIMIT 1;
    RAISE EXCEPTION 'authenticated read profiles.trust_score';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.profiles
       SET email = 'stolen@example.test'
     WHERE id = 'a2800000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'authenticated updated profiles.email';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.favorites (user_id, item_id) VALUES (
      'a2800000-0000-4000-8000-000000000002',
      'a2810000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'A inserted B favorite';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$account_a_contract$;

UPDATE public.profiles
SET nickname = 'ACL A updated'
WHERE id = 'a2800000-0000-4000-8000-000000000001';

DELETE FROM public.favorites
WHERE user_id = 'a2800000-0000-4000-8000-000000000001'
  AND item_id = 'a2810000-0000-4000-8000-000000000002';
INSERT INTO public.favorites (user_id, item_id) VALUES (
  'a2800000-0000-4000-8000-000000000001',
  'a2810000-0000-4000-8000-000000000002'
);

RESET ROLE;

-- B is the message recipient and owns the notification. Allowed state-only
-- updates work, while server/delivery columns remain unreadable.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'a2800000-0000-4000-8000-000000000002', true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"a2800000-0000-4000-8000-000000000002","role":"authenticated","iss":"https://aaaaaaaaaaaaaaaaaaaa.supabase.co/auth/v1"}',
  true
);
SET LOCAL ROLE authenticated;

UPDATE public.messages
SET is_read = true
WHERE id = 'a2830000-0000-4000-8000-000000000001';
UPDATE public.notifications
SET is_read = true
WHERE id = 'a2870000-0000-4000-8000-000000000001';

-- capture_report_target_snapshot() is SECURITY INVOKER and deliberately uses
-- post_comments.status while RLS remains in force. The active row must be
-- reportable without granting visibility to the hidden row.
DO $comment_report_contract$
DECLARE
  active_status text;
BEGIN
  SELECT comment.status INTO STRICT active_status
  FROM public.post_comments AS comment
  WHERE comment.id = 'a2890000-0000-4000-8000-000000000001';
  IF active_status <> 'active' THEN
    RAISE EXCEPTION 'active comment status ACL mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.post_comments AS comment
    WHERE comment.id = 'a2890000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'authenticated saw hidden comment';
  END IF;

  INSERT INTO public.reports (
    reporter_id, target_type, target_id, reason, note
  ) VALUES (
    'a2800000-0000-4000-8000-000000000002',
    'comment',
    'a2890000-0000-4000-8000-000000000001',
    'spam',
    'ACL active comment report'
  );

  BEGIN
    INSERT INTO public.reports (
      reporter_id, target_type, target_id, reason, note
    ) VALUES (
      'a2800000-0000-4000-8000-000000000002',
      'comment',
      'a2890000-0000-4000-8000-000000000002',
      'spam',
      'ACL hidden comment report'
    );
    RAISE EXCEPTION 'hidden comment was reportable';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END;
$comment_report_contract$;

DO $account_b_private_columns$
BEGIN
  BEGIN
    PERFORM notification.source_event_key
    FROM public.notifications AS notification LIMIT 1;
    RAISE EXCEPTION 'B read notification source_event_key';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.messages
       SET content = 'tampered'
     WHERE id = 'a2830000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'B updated immutable message content';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$account_b_private_columns$;

RESET ROLE;

-- A nonparticipant has column admission but RLS returns no private rows and
-- rejects a forged message insert into A/B's conversation.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'a2800000-0000-4000-8000-000000000003', true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"a2800000-0000-4000-8000-000000000003","role":"authenticated","iss":"https://aaaaaaaaaaaaaaaaaaaa.supabase.co/auth/v1"}',
  true
);
SET LOCAL ROLE authenticated;

DO $nonparticipant_contract$
DECLARE
  row_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO row_count FROM public.conversations;
  IF row_count <> 0 THEN RAISE EXCEPTION 'nonparticipant saw conversation'; END IF;
  SELECT pg_catalog.count(*)::integer INTO row_count FROM public.messages;
  IF row_count <> 0 THEN RAISE EXCEPTION 'nonparticipant saw message'; END IF;
  SELECT pg_catalog.count(*)::integer INTO row_count FROM public.offers;
  IF row_count <> 0 THEN RAISE EXCEPTION 'nonparticipant saw offer'; END IF;
  SELECT pg_catalog.count(*)::integer INTO row_count FROM public.meetups;
  IF row_count <> 0 THEN RAISE EXCEPTION 'nonparticipant saw meetup'; END IF;
  SELECT pg_catalog.count(*)::integer INTO row_count FROM public.blocks;
  IF row_count <> 0 THEN RAISE EXCEPTION 'nonowner saw A block row'; END IF;

  BEGIN
    INSERT INTO public.messages (
      id, conversation_id, sender_id, content, message_type
    ) VALUES (
      'a2830000-0000-4000-8000-000000000099',
      'a2820000-0000-4000-8000-000000000001',
      'a2800000-0000-4000-8000-000000000003',
      'forged nonparticipant message',
      'text'
    );
    RAISE EXCEPTION 'nonparticipant inserted message';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$nonparticipant_contract$;

RESET ROLE;

-- ACL admission must not bypass the canonical suspension write trigger.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'a2800000-0000-4000-8000-000000000004', true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"a2800000-0000-4000-8000-000000000004","role":"authenticated","iss":"https://aaaaaaaaaaaaaaaaaaaa.supabase.co/auth/v1"}',
  true
);
SET LOCAL ROLE authenticated;

DO $suspended_write_denied$
BEGIN
  BEGIN
    INSERT INTO public.items (
      user_id, title, description, price, category, condition, location,
      images, listing_type
    ) VALUES (
      'a2800000-0000-4000-8000-000000000004',
      'suspended write', '', 1, 'other', 'good', 'UIUC', ARRAY[]::text[],
      'sell'
    );
    RAISE EXCEPTION 'active L2 suspension inserted item';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'suspension_active:2:%' THEN RAISE; END IF;
  END;
END;
$suspended_write_denied$;

-- Filter/order-only columns on suspensions must remain usable.
DO $suspension_filter_columns$
DECLARE
  row_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO row_count
  FROM public.suspensions
  WHERE profile_id = 'a2800000-0000-4000-8000-000000000004'
    AND lifted_at IS NULL
    AND level >= 2;
  IF row_count <> 1 THEN RAISE EXCEPTION 'suspension filter ACL mismatch'; END IF;
END;
$suspension_filter_columns$;

RESET ROLE;

-- The local replay role does not emulate Supabase's BYPASSRLS bit. Enable it
-- only inside this transaction to prove the explicit service_role table ACL.
ALTER ROLE service_role BYPASSRLS;
SET LOCAL ROLE service_role;

DO $service_contract$
DECLARE
  private_email text;
  private_event text;
BEGIN
  SELECT profile.email INTO STRICT private_email
  FROM public.profiles AS profile
  WHERE profile.id = 'a2800000-0000-4000-8000-000000000001';
  IF private_email <> 'acl-a@example.test' THEN
    RAISE EXCEPTION 'service_role private profile read failed';
  END IF;

  SELECT notification.source_event_key INTO STRICT private_event
  FROM public.notifications AS notification
  WHERE notification.id = 'a2870000-0000-4000-8000-000000000001';
  IF private_event <> 'acl-regression-private-event-key' THEN
    RAISE EXCEPTION 'service_role notification read failed';
  END IF;
END;
$service_contract$;

RESET ROLE;

ROLLBACK;
