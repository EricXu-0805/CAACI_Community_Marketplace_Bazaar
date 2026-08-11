-- Rollback-only bridge regression for disposable LOCAL PostgreSQL only.

\set ON_ERROR_STOP on

BEGIN;

DO $local_guard$
BEGIN
  IF current_setting(
       'caaci.local_fingerprint_regression',
       true
     ) IS DISTINCT FROM
       '20260811140018-disposable-fingerprint-bridge' THEN
    RAISE EXCEPTION
      'local_regression_refused: explicit disposable-local bridge marker required'
      USING ERRCODE = '55000';
  END IF;
END;
$local_guard$;

CREATE TEMP TABLE bridge_regression_baseline (
  name text PRIMARY KEY,
  value text NOT NULL
) ON COMMIT DROP;

INSERT INTO bridge_regression_baseline (name, value) VALUES
  ('auth_sessions', (SELECT pg_catalog.count(*)::text FROM auth.sessions));

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (
  'fc000000-0000-4000-8000-000000000101',
  'fingerprint-bridge@example.invalid',
  '{"synthetic":true}'::jsonb
);
INSERT INTO public.profiles (id, nickname) VALUES (
  'fc000000-0000-4000-8000-000000000101',
  'Fingerprint Bridge'
)
ON CONFLICT (id) DO UPDATE
SET nickname = EXCLUDED.nickname;

INSERT INTO public.device_fingerprints (
  profile_id,
  fp_hash,
  first_seen,
  last_seen,
  seen_count,
  ua_snippet
) VALUES (
  'fc000000-0000-4000-8000-000000000101',
  pg_catalog.repeat('1', 64),
  pg_catalog.statement_timestamp(),
  pg_catalog.statement_timestamp(),
  1,
  'bridge baseline'
);

CREATE TEMP TABLE bridge_state_before AS
SELECT
  pg_catalog.md5(pg_catalog.to_jsonb(fingerprint)::text)
    AS fingerprint_md5,
  (
    SELECT pg_catalog.md5(pg_catalog.to_jsonb(profile)::text)
      FROM public.profiles AS profile
     WHERE profile.id = 'fc000000-0000-4000-8000-000000000101'
  ) AS profile_md5,
  (
    SELECT sequence_state.last_value
      FROM public.device_fingerprints_id_seq AS sequence_state
  ) AS sequence_last_value
FROM public.device_fingerprints AS fingerprint
WHERE fingerprint.profile_id = 'fc000000-0000-4000-8000-000000000101';

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'fc000000-0000-4000-8000-000000000101',
  true
);
SELECT public.record_fingerprint(pg_catalog.repeat('1', 64), 'recent noop');

DO $new_hash_deferred$
BEGIN
  BEGIN
    PERFORM public.record_fingerprint(
      pg_catalog.repeat('2', 64),
      'must defer'
    );
    RAISE EXCEPTION 'bridge accepted a new physical write';
  EXCEPTION WHEN SQLSTATE 'PT429' THEN
    IF SQLERRM <> 'fingerprint_write_deferred' THEN RAISE; END IF;
  END;
END;
$new_hash_deferred$;
RESET ROLE;

DO $recent_bridge_state_unchanged$
BEGIN
  IF (
    SELECT fingerprint_md5 FROM bridge_state_before
  ) IS DISTINCT FROM (
    SELECT pg_catalog.md5(pg_catalog.to_jsonb(fingerprint)::text)
      FROM public.device_fingerprints AS fingerprint
     WHERE fingerprint.profile_id =
           'fc000000-0000-4000-8000-000000000101'
  ) OR (
    SELECT profile_md5 FROM bridge_state_before
  ) IS DISTINCT FROM (
    SELECT pg_catalog.md5(pg_catalog.to_jsonb(profile)::text)
      FROM public.profiles AS profile
     WHERE profile.id = 'fc000000-0000-4000-8000-000000000101'
  ) OR (
    SELECT sequence_last_value FROM bridge_state_before
  ) IS DISTINCT FROM (
    SELECT sequence_state.last_value
      FROM public.device_fingerprints_id_seq AS sequence_state
  ) THEN
    RAISE EXCEPTION 'recent bridge no-op/defer changed persistent state';
  END IF;
END;
$recent_bridge_state_unchanged$;

UPDATE public.device_fingerprints
   SET last_seen = pg_catalog.statement_timestamp() - interval '10 minutes'
 WHERE profile_id = 'fc000000-0000-4000-8000-000000000101';

CREATE TEMP TABLE bridge_old_hash_before AS
SELECT
  pg_catalog.md5(pg_catalog.to_jsonb(fingerprint)::text)
    AS fingerprint_md5,
  (
    SELECT pg_catalog.md5(pg_catalog.to_jsonb(profile)::text)
      FROM public.profiles AS profile
     WHERE profile.id = 'fc000000-0000-4000-8000-000000000101'
  ) AS profile_md5,
  (
    SELECT sequence_state.last_value
      FROM public.device_fingerprints_id_seq AS sequence_state
  ) AS sequence_last_value
FROM public.device_fingerprints AS fingerprint
WHERE fingerprint.profile_id = 'fc000000-0000-4000-8000-000000000101';

SET LOCAL ROLE authenticated;
DO $old_hash_deferred$
BEGIN
  BEGIN
    PERFORM public.record_fingerprint(
      pg_catalog.repeat('1', 64),
      'old hash must defer'
    );
    RAISE EXCEPTION 'bridge refreshed an old physical row';
  EXCEPTION WHEN SQLSTATE 'PT429' THEN
    IF SQLERRM <> 'fingerprint_write_deferred' THEN RAISE; END IF;
  END;
END;
$old_hash_deferred$;
RESET ROLE;

DO $bridge_state_unchanged$
BEGIN
  IF (
    SELECT fingerprint_md5 FROM bridge_old_hash_before
  ) IS DISTINCT FROM (
    SELECT pg_catalog.md5(pg_catalog.to_jsonb(fingerprint)::text)
      FROM public.device_fingerprints AS fingerprint
     WHERE fingerprint.profile_id =
           'fc000000-0000-4000-8000-000000000101'
  ) OR (
    SELECT profile_md5 FROM bridge_old_hash_before
  ) IS DISTINCT FROM (
    SELECT pg_catalog.md5(pg_catalog.to_jsonb(profile)::text)
      FROM public.profiles AS profile
     WHERE profile.id = 'fc000000-0000-4000-8000-000000000101'
  ) OR (
    SELECT sequence_last_value FROM bridge_old_hash_before
  ) IS DISTINCT FROM (
    SELECT sequence_state.last_value
      FROM public.device_fingerprints_id_seq AS sequence_state
  ) THEN
    RAISE EXCEPTION 'bridge rejection changed persistent fingerprint state';
  END IF;
END;
$bridge_state_unchanged$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'fc000000-0000-4000-8000-000000000199',
  true
);
SELECT public.record_fingerprint(pg_catalog.repeat('3', 64), 'missing profile');

SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
DO $unauthenticated_boundary$
BEGIN
  BEGIN
    PERFORM public.record_fingerprint(
      pg_catalog.repeat('4', 64),
      'unauthenticated'
    );
    RAISE EXCEPTION 'unauthenticated bridge call accepted';
  EXCEPTION WHEN invalid_authorization_specification THEN
    IF SQLERRM <> 'not_authenticated' THEN RAISE; END IF;
  END;
END;
$unauthenticated_boundary$;
RESET ROLE;

DO $bridge_acl_and_session_boundary$
BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM pg_catalog.count(*)
      FROM private.device_fingerprint_churn_cutover;
    RESET ROLE;
    RAISE EXCEPTION 'authenticated could read the bridge cutover gate';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;

  IF (
    SELECT pg_catalog.count(*)::text FROM auth.sessions
  ) IS DISTINCT FROM (
    SELECT value FROM bridge_regression_baseline WHERE name = 'auth_sessions'
  ) THEN
    RAISE EXCEPTION 'bridge regression changed Auth sessions';
  END IF;
END;
$bridge_acl_and_session_boundary$;

ROLLBACK;
