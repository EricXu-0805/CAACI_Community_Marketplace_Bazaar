-- Isolated/local behavior regression. NEVER run against production.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('fa000000-0000-4000-8000-000000000001', 'fingerprint-owner@example.test', '{}'::jsonb),
  ('fa000000-0000-4000-8000-000000000002', 'fingerprint-target@example.test', '{}'::jsonb),
  ('fa000000-0000-4000-8000-000000000003', 'fingerprint-linked@example.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname, shadow_banned) VALUES
  ('fa000000-0000-4000-8000-000000000001', 'Fingerprint Owner', false),
  ('fa000000-0000-4000-8000-000000000002', 'Fingerprint Target', false),
  ('fa000000-0000-4000-8000-000000000003', 'Fingerprint Linked', false)
ON CONFLICT (id) DO UPDATE SET
  nickname = EXCLUDED.nickname,
  shadow_banned = false;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'fa000000-0000-4000-8000-000000000001',
  true
);

DO $fingerprint_bounds$
DECLARE
  owner_id uuid := 'fa000000-0000-4000-8000-000000000001';
  stable_hash text := pg_catalog.repeat('a', 64);
  seen integer;
  row_count integer;
BEGIN
  BEGIN
    PERFORM public.record_fingerprint(
      pg_catalog.repeat('a', 32),
      'legacy weak hash'
    );
    RAISE EXCEPTION 'legacy 32-character fingerprint accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_fingerprint' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.record_fingerprint(
      pg_catalog.repeat('A', 64),
      'uppercase hash'
    );
    RAISE EXCEPTION 'uppercase fingerprint accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_fingerprint' THEN RAISE; END IF;
  END;

  PERFORM public.record_fingerprint(stable_hash, E'UA\nwith\tcontrols');
  PERFORM public.record_fingerprint(stable_hash, 'duplicate initialization');

  -- device_fingerprints is intentionally RPC-only. Inspect the trusted state
  -- as the fixture owner, then return to the real authenticated RPC boundary
  -- for the cap behavior below.
  RESET ROLE;

  SELECT fingerprint.seen_count
    INTO seen
    FROM public.device_fingerprints AS fingerprint
   WHERE fingerprint.profile_id = owner_id
     AND fingerprint.fp_hash = stable_hash;
  IF seen <> 1 THEN
    RAISE EXCEPTION 'five-minute duplicate incremented seen_count to %', seen;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.device_fingerprints AS fingerprint
    WHERE fingerprint.profile_id = owner_id
      AND fingerprint.ua_snippet ~ '[[:cntrl:]]'
  ) THEN
    RAISE EXCEPTION 'control characters remained in ua_snippet';
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    'fa000000-0000-4000-8000-000000000001',
    true
  );

  -- stable_hash + 18 real RPC calls = 19 unique hashes. Using the RPC here
  -- also proves the advisory lock/count path rather than bypassing RLS as a
  -- trusted fixture writer.
  FOR seen IN 1..18 LOOP
    PERFORM public.record_fingerprint(
      pg_catalog.lpad(pg_catalog.to_hex(seen), 64, '0'),
      'cap fixture'
    );
  END LOOP;

  PERFORM public.record_fingerprint(pg_catalog.repeat('b', 64), 'twentieth');

  BEGIN
    PERFORM public.record_fingerprint(pg_catalog.repeat('c', 64), 'twenty-first');
    RAISE EXCEPTION 'twenty-first unique fingerprint accepted';
  EXCEPTION WHEN program_limit_exceeded THEN
    IF SQLERRM <> 'fingerprint_limit_reached' THEN RAISE; END IF;
  END;

  RESET ROLE;

  SELECT pg_catalog.count(*)::integer
    INTO row_count
    FROM public.device_fingerprints AS fingerprint
   WHERE fingerprint.profile_id = owner_id;
  IF row_count <> 20 THEN
    RAISE EXCEPTION 'fingerprint cap expected 20 rows, got %', row_count;
  END IF;
END
$fingerprint_bounds$;

RESET ROLE;

DO $table_constraint$
BEGIN
  BEGIN
    INSERT INTO public.device_fingerprints (profile_id, fp_hash)
    VALUES (
      'fa000000-0000-4000-8000-000000000001',
      pg_catalog.repeat('e', 32)
    );
    RAISE EXCEPTION 'table constraint accepted a new weak fingerprint';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$table_constraint$;

INSERT INTO public.device_fingerprints (profile_id, fp_hash) VALUES
  ('fa000000-0000-4000-8000-000000000002', pg_catalog.repeat('f', 64)),
  ('fa000000-0000-4000-8000-000000000003', pg_catalog.repeat('f', 64));

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);

SELECT public.apply_ban_level(
  'fa000000-0000-4000-8000-000000000002',
  4::smallint,
  'explicit target only regression',
  'regression',
  24
);

RESET ROLE;

DO $manual_review_only$
DECLARE
  target_level smallint;
  target_shadow boolean;
  linked_level smallint;
  linked_shadow boolean;
BEGIN
  SELECT profile.suspension_level, profile.shadow_banned
    INTO target_level, target_shadow
    FROM public.profiles AS profile
   WHERE profile.id = 'fa000000-0000-4000-8000-000000000002';

  SELECT profile.suspension_level, profile.shadow_banned
    INTO linked_level, linked_shadow
    FROM public.profiles AS profile
   WHERE profile.id = 'fa000000-0000-4000-8000-000000000003';

  IF target_level <> 4 OR target_shadow IS NOT TRUE THEN
    RAISE EXCEPTION 'explicit target sanction was not applied';
  END IF;
  IF linked_level <> 0 OR linked_shadow IS NOT FALSE THEN
    RAISE EXCEPTION 'fingerprint-linked account was sanctioned automatically';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_audit_log AS audit
    WHERE audit.event_kind = 'ban_applied'
      AND audit.target_id = 'fa000000-0000-4000-8000-000000000002'
      AND audit.details ->> 'linked_accounts_action' = 'manual_review_only'
      AND (audit.details ->> 'linked_fingerprint_candidates')::integer = 1
  ) THEN
    RAISE EXCEPTION 'manual-review fingerprint count missing from audit event';
  END IF;
END
$manual_review_only$;

ROLLBACK;
