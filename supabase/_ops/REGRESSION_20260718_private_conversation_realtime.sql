-- Local/isolated behavioral regression for private conversation Realtime.
-- NEVER run against production. Every fixture mutation is rolled back.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('93000000-0000-4000-8000-000000000001', 'realtime-a@example.test', '{}'::jsonb),
  ('93000000-0000-4000-8000-000000000002', 'realtime-b@example.test', '{}'::jsonb),
  ('93000000-0000-4000-8000-000000000003', 'realtime-c@example.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname) VALUES
  ('93000000-0000-4000-8000-000000000001', 'Realtime A'),
  ('93000000-0000-4000-8000-000000000002', 'Realtime B'),
  ('93000000-0000-4000-8000-000000000003', 'Realtime C')
ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname;

INSERT INTO public.conversations (id, item_id, buyer_id, seller_id) VALUES
  (
    '94000000-0000-4000-8000-000000000001',
    NULL,
    '93000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000002'
  ),
  (
    '94000000-0000-4000-8000-000000000002',
    NULL,
    '93000000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000003'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO realtime.messages (topic, extension, event, private) VALUES
  ('fixture', 'broadcast', 'typing', true),
  ('fixture', 'presence', 'sync', true),
  ('fixture', 'postgres_changes', 'INSERT', true);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '93000000-0000-4000-8000-000000000001',
  true
);
SELECT pg_catalog.set_config(
  'realtime.topic',
  'conversation:94000000-0000-4000-8000-000000000001',
  true
);

DO $allowed$
DECLARE
  visible_count integer;
BEGIN
  SELECT pg_catalog.count(*) INTO visible_count
  FROM realtime.messages;
  IF visible_count <> 2 THEN
    RAISE EXCEPTION 'regression_failed: member expected 2 allowed extensions, got %',
      visible_count;
  END IF;

  INSERT INTO realtime.messages (topic, extension, event, private) VALUES
    ('authorization probe', 'broadcast', 'typing', true),
    ('authorization probe', 'presence', 'track', true);

  BEGIN
    INSERT INTO realtime.messages (topic, extension, event, private)
    VALUES ('authorization probe', 'postgres_changes', 'INSERT', true);
    RAISE EXCEPTION 'regression_failed: unexpected extension was insertable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$allowed$;

SELECT pg_catalog.set_config(
  'realtime.topic',
  'conversation:94000000-0000-4000-8000-000000000002',
  true
);
DO $non_member$
DECLARE
  visible_count integer;
BEGIN
  SELECT pg_catalog.count(*) INTO visible_count FROM realtime.messages;
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'regression_failed: non-member received Realtime rows';
  END IF;
  BEGIN
    INSERT INTO realtime.messages (topic, extension, event, private)
    VALUES ('authorization probe', 'broadcast', 'typing', true);
    RAISE EXCEPTION 'regression_failed: non-member sent a broadcast';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$non_member$;

SELECT pg_catalog.set_config('realtime.topic', 'online-users', true);
DO $global_topic$
DECLARE
  visible_count integer;
BEGIN
  SELECT pg_catalog.count(*) INTO visible_count FROM realtime.messages;
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'regression_failed: global topic exposed Realtime rows';
  END IF;
  BEGIN
    INSERT INTO realtime.messages (topic, extension, event, private)
    VALUES ('authorization probe', 'presence', 'track', true);
    RAISE EXCEPTION 'regression_failed: global topic accepted Presence';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$global_topic$;

RESET ROLE;
INSERT INTO public.blocks (blocker_id, blocked_id) VALUES (
  '93000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000002'
) ON CONFLICT DO NOTHING;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '93000000-0000-4000-8000-000000000001',
  true
);
SELECT pg_catalog.set_config(
  'realtime.topic',
  'conversation:94000000-0000-4000-8000-000000000001',
  true
);
DO $blocked_pair$
DECLARE
  visible_count integer;
BEGIN
  SELECT pg_catalog.count(*) INTO visible_count FROM realtime.messages;
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'regression_failed: blocked pair retained Realtime access';
  END IF;
  BEGIN
    INSERT INTO realtime.messages (topic, extension, event, private)
    VALUES ('authorization probe', 'broadcast', 'typing', true);
    RAISE EXCEPTION 'regression_failed: blocked pair sent a broadcast';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$blocked_pair$;

RESET ROLE;
SET LOCAL ROLE anon;
DO $anonymous$
DECLARE
  visible_count integer;
BEGIN
  -- Hosted Supabase keeps owner-issued base S/I/U on this managed table. With
  -- no anon policy, RLS must still expose zero rows. A local fixture that has
  -- already removed the managed base grant may deny SELECT earlier; both paths
  -- preserve the same application authorization boundary.
  IF pg_catalog.has_table_privilege(
    'anon', 'realtime.messages', 'SELECT'
  ) THEN
    SELECT pg_catalog.count(*) INTO visible_count FROM realtime.messages;
    IF visible_count <> 0 THEN
      RAISE EXCEPTION
        'regression_failed: anon received managed Realtime rows';
    END IF;
  ELSE
    BEGIN
      PERFORM 1 FROM realtime.messages LIMIT 1;
      RAISE EXCEPTION
        'regression_failed: anon without base grant read realtime.messages';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END IF;
END;
$anonymous$;

ROLLBACK;
