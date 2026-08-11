-- Rollback-only behavior regression for disposable LOCAL PostgreSQL only.
-- Do not run it on hosted staging or production: nextval() calls advance the
-- bigserial sequence even though the fixture rows are rolled back.

\set ON_ERROR_STOP on

BEGIN;

DO $local_guard$
BEGIN
  IF current_setting(
       'caaci.local_fingerprint_regression',
       true
     ) IS DISTINCT FROM
       '20260808040313-disposable-fingerprint-regression' THEN
    RAISE EXCEPTION
      'local_regression_refused: explicit disposable-local marker required'
      USING ERRCODE = '55000';
  END IF;
END;
$local_guard$;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (
    'fb000000-0000-4000-8000-000000000001',
    'fingerprint-eviction-owner@example.invalid',
    '{"synthetic":true}'::jsonb
  ),
  (
    'fb000000-0000-4000-8000-000000000002',
    'fingerprint-eviction-peer@example.invalid',
    '{"synthetic":true}'::jsonb
  ),
  (
    'fb000000-0000-4000-8000-000000000003',
    'fingerprint-over-cap@example.invalid',
    '{"synthetic":true}'::jsonb
  );

INSERT INTO public.profiles (id, nickname) VALUES
  ('fb000000-0000-4000-8000-000000000001', 'Eviction Owner'),
  ('fb000000-0000-4000-8000-000000000002', 'Eviction Peer'),
  ('fb000000-0000-4000-8000-000000000003', 'Over-cap Fixture')
ON CONFLICT (id) DO UPDATE
SET nickname = EXCLUDED.nickname;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'fb000000-0000-4000-8000-000000000001',
  true
);

DO $input_boundaries$
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
END;
$input_boundaries$;

DO $fill_to_cap$
DECLARE
  sequence_no integer;
BEGIN
  FOR sequence_no IN 1..20 LOOP
    PERFORM public.record_fingerprint(
      pg_catalog.lpad(pg_catalog.to_hex(sequence_no), 64, '0'),
      'cap fixture'
    );
  END LOOP;
END;
$fill_to_cap$;

RESET ROLE;

DO $capture_oldest$
DECLARE
  oldest_hash text;
BEGIN
  SELECT fingerprint.fp_hash
    INTO oldest_hash
    FROM public.device_fingerprints AS fingerprint
   WHERE fingerprint.profile_id =
         'fb000000-0000-4000-8000-000000000001'
   ORDER BY fingerprint.last_seen ASC, fingerprint.id ASC
   LIMIT 1;

  IF oldest_hash IS DISTINCT FROM pg_catalog.lpad('1', 64, '0') THEN
    RAISE EXCEPTION 'unexpected oldest fingerprint fixture: %', oldest_hash;
  END IF;
END;
$capture_oldest$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'fb000000-0000-4000-8000-000000000001',
  true
);
SELECT public.record_fingerprint(pg_catalog.repeat('f', 64), 'twenty-first');
SELECT public.record_fingerprint(
  pg_catalog.repeat('f', 64),
  'duplicate initialization'
);
RESET ROLE;

DO $eviction_result$
DECLARE
  row_count integer;
  new_seen_count integer;
  profile_last_hash text;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO row_count
    FROM public.device_fingerprints AS fingerprint
   WHERE fingerprint.profile_id =
         'fb000000-0000-4000-8000-000000000001';

  IF row_count <> 20 THEN
    RAISE EXCEPTION 'eviction cap expected 20 rows, got %', row_count;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.device_fingerprints AS fingerprint
     WHERE fingerprint.profile_id =
           'fb000000-0000-4000-8000-000000000001'
       AND fingerprint.fp_hash = pg_catalog.lpad('1', 64, '0')
  ) OR NOT EXISTS (
    SELECT 1
      FROM public.device_fingerprints AS fingerprint
     WHERE fingerprint.profile_id =
           'fb000000-0000-4000-8000-000000000001'
       AND fingerprint.fp_hash = pg_catalog.repeat('f', 64)
  ) THEN
    RAISE EXCEPTION 'least-recently-seen replacement was not exact';
  END IF;

  SELECT fingerprint.seen_count
    INTO new_seen_count
    FROM public.device_fingerprints AS fingerprint
   WHERE fingerprint.profile_id =
         'fb000000-0000-4000-8000-000000000001'
     AND fingerprint.fp_hash = pg_catalog.repeat('f', 64);
  IF new_seen_count <> 1 THEN
    RAISE EXCEPTION
      'five-minute duplicate changed seen_count to %', new_seen_count;
  END IF;

  SELECT profile.last_fp_hash
    INTO profile_last_hash
    FROM public.profiles AS profile
   WHERE profile.id = 'fb000000-0000-4000-8000-000000000001';
  IF profile_last_hash IS DISTINCT FROM pg_catalog.repeat('f', 64) THEN
    RAISE EXCEPTION 'profile pointer did not follow the inserted hash';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.device_fingerprints AS fingerprint
     WHERE fingerprint.profile_id =
           'fb000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'peer profile was mutated by another caller';
  END IF;
END;
$eviction_result$;

-- Simulate drift created by a privileged direct writer after migration. The
-- ordinary authenticated RPC must fail closed without deleting that history.
INSERT INTO public.device_fingerprints (profile_id, fp_hash, last_seen)
SELECT
  'fb000000-0000-4000-8000-000000000003'::uuid,
  pg_catalog.lpad(pg_catalog.to_hex(sequence_no), 64, 'a'),
  pg_catalog.clock_timestamp() + sequence_no * interval '1 second'
FROM pg_catalog.generate_series(1, 21) AS sequence_no;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'fb000000-0000-4000-8000-000000000003',
  true
);

DO $over_cap_fail_closed$
BEGIN
  BEGIN
    PERFORM public.record_fingerprint(
      pg_catalog.repeat('e', 64),
      'must not trigger bulk cleanup'
    );
    RAISE EXCEPTION 'over-cap profile did not fail closed';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'fingerprint_cleanup_required' THEN RAISE; END IF;
  END;
END;
$over_cap_fail_closed$;

RESET ROLE;

DO $over_cap_unchanged$
DECLARE
  row_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO row_count
    FROM public.device_fingerprints AS fingerprint
   WHERE fingerprint.profile_id =
         'fb000000-0000-4000-8000-000000000003';
  IF row_count <> 21 THEN
    RAISE EXCEPTION
      'over-cap fail-closed path changed row count to %', row_count;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.device_fingerprints AS fingerprint
     WHERE fingerprint.profile_id =
           'fb000000-0000-4000-8000-000000000003'
       AND fingerprint.fp_hash = pg_catalog.repeat('e', 64)
  ) THEN
    RAISE EXCEPTION 'over-cap fail-closed path inserted the new hash';
  END IF;
END;
$over_cap_unchanged$;

SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE authenticated;
DO $unauthenticated_boundary$
BEGIN
  BEGIN
    PERFORM public.record_fingerprint(
      pg_catalog.repeat('d', 64),
      'unauthenticated'
    );
    RAISE EXCEPTION 'unauthenticated fingerprint accepted';
  EXCEPTION WHEN invalid_authorization_specification THEN
    IF SQLERRM <> 'not_authenticated' THEN RAISE; END IF;
  END;
END;
$unauthenticated_boundary$;
RESET ROLE;

DO $session_boundary$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM auth.sessions AS session_row
     WHERE session_row.user_id IN (
       'fb000000-0000-4000-8000-000000000001'::uuid,
       'fb000000-0000-4000-8000-000000000002'::uuid,
       'fb000000-0000-4000-8000-000000000003'::uuid
     )
  ) THEN
    RAISE EXCEPTION
      'fingerprint regression unexpectedly created Auth sessions';
  END IF;
END;
$session_boundary$;

ROLLBACK;
