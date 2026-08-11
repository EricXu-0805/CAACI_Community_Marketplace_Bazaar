-- Rollback-only behavior regression for disposable LOCAL PostgreSQL only.
-- Never run on hosted staging/production: fixture nextval() calls advance the
-- bigserial sequence even though all table rows are rolled back.

\set ON_ERROR_STOP on

BEGIN;

DO $local_guard$
BEGIN
  IF current_setting(
       'caaci.local_fingerprint_regression',
       true
     ) IS DISTINCT FROM
       '20260811143207-disposable-fingerprint-churn' THEN
    RAISE EXCEPTION
      'local_regression_refused: explicit disposable-local marker required'
      USING ERRCODE = '55000';
  END IF;
END;
$local_guard$;

CREATE TEMP TABLE churn_regression_baseline (
  name text PRIMARY KEY,
  value text NOT NULL
) ON COMMIT DROP;

INSERT INTO churn_regression_baseline (name, value) VALUES
  ('auth_sessions', (SELECT pg_catalog.count(*)::text FROM auth.sessions));

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (
    'fd000000-0000-4000-8000-000000000001',
    'fingerprint-churn-basic@example.invalid',
    '{"synthetic":true}'::jsonb
  ),
  (
    'fd000000-0000-4000-8000-000000000002',
    'fingerprint-churn-budget@example.invalid',
    '{"synthetic":true}'::jsonb
  ),
  (
    'fd000000-0000-4000-8000-000000000003',
    'fingerprint-churn-cap@example.invalid',
    '{"synthetic":true}'::jsonb
  ),
  (
    'fd000000-0000-4000-8000-000000000004',
    'fingerprint-churn-undercap@example.invalid',
    '{"synthetic":true}'::jsonb
  ),
  (
    'fd000000-0000-4000-8000-000000000005',
    'fingerprint-churn-overcap@example.invalid',
    '{"synthetic":true}'::jsonb
  ),
  (
    'fd000000-0000-4000-8000-000000000006',
    'fingerprint-churn-same-clock@example.invalid',
    '{"synthetic":true}'::jsonb
  );

INSERT INTO public.profiles (id, nickname) VALUES
  ('fd000000-0000-4000-8000-000000000001', 'Churn Basic'),
  ('fd000000-0000-4000-8000-000000000002', 'Churn Budget'),
  ('fd000000-0000-4000-8000-000000000003', 'Churn Cap'),
  ('fd000000-0000-4000-8000-000000000004', 'Churn Undercap'),
  ('fd000000-0000-4000-8000-000000000005', 'Churn Overcap'),
  ('fd000000-0000-4000-8000-000000000006', 'Churn Same Clock')
ON CONFLICT (id) DO UPDATE
SET nickname = EXCLUDED.nickname;

-- All nested function calls in one DO statement observe the same
-- statement_timestamp(). Preserve timestamp multiplicity in the limiter:
-- five accepted events with the same timestamp must still consume all five
-- rolling-window slots, and the sixth must fail closed.
DO $same_timestamp_multiplicity$
DECLARE
  sequence_no integer;
BEGIN
  FOR sequence_no IN 1..5 LOOP
    SET LOCAL ROLE authenticated;
    PERFORM pg_catalog.set_config(
      'request.jwt.claim.sub',
      'fd000000-0000-4000-8000-000000000006',
      true
    );
    PERFORM public.record_fingerprint(
      pg_catalog.lpad(pg_catalog.to_hex(300 + sequence_no), 64, '0'),
      'same-clock'
    );
    RESET ROLE;

    UPDATE public.device_fingerprints
       SET last_seen = pg_catalog.statement_timestamp() - interval '10 minutes'
     WHERE profile_id = 'fd000000-0000-4000-8000-000000000006';
    UPDATE private.device_fingerprint_rate_limits
       SET last_accepted_write_at =
           pg_catalog.statement_timestamp() - interval '10 minutes'
     WHERE profile_id = 'fd000000-0000-4000-8000-000000000006';
  END LOOP;

  IF (
    SELECT pg_catalog.cardinality(limiter.accepted_new_hash_at)
      FROM private.device_fingerprint_rate_limits AS limiter
     WHERE limiter.profile_id =
           'fd000000-0000-4000-8000-000000000006'
  ) <> 5 THEN
    RAISE EXCEPTION 'same-timestamp events lost multiplicity';
  END IF;

  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.record_fingerprint(
      pg_catalog.lpad(pg_catalog.to_hex(306), 64, '0'),
      'same-clock-sixth'
    );
    RAISE EXCEPTION 'same-timestamp sixth hash was accepted';
  EXCEPTION WHEN SQLSTATE 'PT429' THEN
    IF SQLERRM <> 'fingerprint_rate_limited' THEN RAISE; END IF;
  END;
  RESET ROLE;
END;
$same_timestamp_multiplicity$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'fd000000-0000-4000-8000-000000000001',
  true
);

DO $input_boundaries$
BEGIN
  BEGIN
    PERFORM public.record_fingerprint(
      pg_catalog.repeat('a', 32),
      'weak hash'
    );
    RAISE EXCEPTION 'legacy weak fingerprint accepted';
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

SELECT public.record_fingerprint(pg_catalog.repeat('1', 64), 'first');
SELECT public.record_fingerprint(pg_catalog.repeat('1', 64), 'same hash');
RESET ROLE;

DO $same_hash_noop$
DECLARE
  observed_count integer;
  observed_seen_count integer;
  observed_budget integer;
BEGIN
  SELECT pg_catalog.count(*)::integer, pg_catalog.max(fingerprint.seen_count)
    INTO observed_count, observed_seen_count
    FROM public.device_fingerprints AS fingerprint
   WHERE fingerprint.profile_id =
         'fd000000-0000-4000-8000-000000000001';
  SELECT pg_catalog.cardinality(limiter.accepted_new_hash_at)
    INTO observed_budget
    FROM private.device_fingerprint_rate_limits AS limiter
   WHERE limiter.profile_id =
         'fd000000-0000-4000-8000-000000000001';

  IF observed_count <> 1
     OR observed_seen_count <> 1
     OR observed_budget <> 1 THEN
    RAISE EXCEPTION
      'same-hash five-minute no-op drifted rows %, seen %, budget %',
      observed_count,
      observed_seen_count,
      observed_budget;
  END IF;
END;
$same_hash_noop$;

DO $cooldown_rejected$
DECLARE
  before_fingerprint text;
  before_profile text;
  before_limiter text;
  before_sequence bigint;
  after_fingerprint text;
  after_profile text;
  after_limiter text;
  after_sequence bigint;
BEGIN
  SELECT pg_catalog.md5(pg_catalog.to_jsonb(fingerprint)::text)
    INTO before_fingerprint
    FROM public.device_fingerprints AS fingerprint
   WHERE fingerprint.profile_id =
         'fd000000-0000-4000-8000-000000000001';
  SELECT pg_catalog.md5(pg_catalog.to_jsonb(profile)::text)
    INTO before_profile
    FROM public.profiles AS profile
   WHERE profile.id = 'fd000000-0000-4000-8000-000000000001';
  SELECT pg_catalog.md5(pg_catalog.to_jsonb(limiter)::text)
    INTO before_limiter
    FROM private.device_fingerprint_rate_limits AS limiter
   WHERE limiter.profile_id =
         'fd000000-0000-4000-8000-000000000001';
  SELECT sequence_state.last_value INTO before_sequence
    FROM public.device_fingerprints_id_seq AS sequence_state;

  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.record_fingerprint(
      pg_catalog.repeat('2', 64),
      'must defer'
    );
    RAISE EXCEPTION 'cooldown accepted a second physical write';
  EXCEPTION WHEN SQLSTATE 'PT429' THEN
    IF SQLERRM <> 'fingerprint_write_deferred' THEN RAISE; END IF;
  END;
  RESET ROLE;

  SELECT pg_catalog.md5(pg_catalog.to_jsonb(fingerprint)::text)
    INTO after_fingerprint
    FROM public.device_fingerprints AS fingerprint
   WHERE fingerprint.profile_id =
         'fd000000-0000-4000-8000-000000000001';
  SELECT pg_catalog.md5(pg_catalog.to_jsonb(profile)::text)
    INTO after_profile
    FROM public.profiles AS profile
   WHERE profile.id = 'fd000000-0000-4000-8000-000000000001';
  SELECT pg_catalog.md5(pg_catalog.to_jsonb(limiter)::text)
    INTO after_limiter
    FROM private.device_fingerprint_rate_limits AS limiter
   WHERE limiter.profile_id =
         'fd000000-0000-4000-8000-000000000001';
  SELECT sequence_state.last_value INTO after_sequence
    FROM public.device_fingerprints_id_seq AS sequence_state;

  IF before_fingerprint IS DISTINCT FROM after_fingerprint
     OR before_profile IS DISTINCT FROM after_profile
     OR before_limiter IS DISTINCT FROM after_limiter
     OR before_sequence IS DISTINCT FROM after_sequence THEN
    RAISE EXCEPTION 'cooldown rejection caused a physical state change';
  END IF;
END;
$cooldown_rejected$;

RESET ROLE;
UPDATE public.device_fingerprints
   SET last_seen = pg_catalog.statement_timestamp() - interval '10 minutes'
 WHERE profile_id = 'fd000000-0000-4000-8000-000000000001';
UPDATE private.device_fingerprint_rate_limits
   SET last_accepted_write_at =
       pg_catalog.statement_timestamp() - interval '10 minutes'
 WHERE profile_id = 'fd000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'fd000000-0000-4000-8000-000000000001',
  true
);
SELECT public.record_fingerprint(pg_catalog.repeat('1', 64), 'refresh');
RESET ROLE;

DO $existing_refresh$
DECLARE
  observed_seen_count integer;
  observed_budget integer;
BEGIN
  SELECT fingerprint.seen_count
    INTO observed_seen_count
    FROM public.device_fingerprints AS fingerprint
   WHERE fingerprint.profile_id =
         'fd000000-0000-4000-8000-000000000001'
     AND fingerprint.fp_hash = pg_catalog.repeat('1', 64);
  SELECT pg_catalog.cardinality(limiter.accepted_new_hash_at)
    INTO observed_budget
    FROM private.device_fingerprint_rate_limits AS limiter
   WHERE limiter.profile_id =
         'fd000000-0000-4000-8000-000000000001';
  IF observed_seen_count <> 2 OR observed_budget <> 1 THEN
    RAISE EXCEPTION
      'existing-hash refresh drifted seen %, budget %',
      observed_seen_count,
      observed_budget;
  END IF;
END;
$existing_refresh$;

-- Accept five distinct hashes while privileged fixture maintenance advances
-- only the cooldown clock. first_seen remains recent and consumes the rolling
-- 24-hour new-hash budget.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'fd000000-0000-4000-8000-000000000002',
  true
);
SELECT public.record_fingerprint(pg_catalog.repeat('a', 64), 'budget-1');
RESET ROLE;

UPDATE public.device_fingerprints
   SET last_seen = pg_catalog.statement_timestamp() - interval '10 minutes'
 WHERE profile_id = 'fd000000-0000-4000-8000-000000000002';
UPDATE private.device_fingerprint_rate_limits
   SET last_accepted_write_at =
       pg_catalog.statement_timestamp() - interval '10 minutes'
 WHERE profile_id = 'fd000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT public.record_fingerprint(pg_catalog.repeat('b', 64), 'budget-2');
RESET ROLE;

UPDATE public.device_fingerprints
   SET last_seen = pg_catalog.statement_timestamp() - interval '10 minutes'
 WHERE profile_id = 'fd000000-0000-4000-8000-000000000002';
UPDATE private.device_fingerprint_rate_limits
   SET last_accepted_write_at =
       pg_catalog.statement_timestamp() - interval '10 minutes'
 WHERE profile_id = 'fd000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT public.record_fingerprint(pg_catalog.repeat('c', 64), 'budget-3');
RESET ROLE;

UPDATE public.device_fingerprints
   SET last_seen = pg_catalog.statement_timestamp() - interval '10 minutes'
 WHERE profile_id = 'fd000000-0000-4000-8000-000000000002';
UPDATE private.device_fingerprint_rate_limits
   SET last_accepted_write_at =
       pg_catalog.statement_timestamp() - interval '10 minutes'
 WHERE profile_id = 'fd000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT public.record_fingerprint(pg_catalog.repeat('d', 64), 'budget-4');
RESET ROLE;

UPDATE public.device_fingerprints
   SET last_seen = pg_catalog.statement_timestamp() - interval '10 minutes'
 WHERE profile_id = 'fd000000-0000-4000-8000-000000000002';
UPDATE private.device_fingerprint_rate_limits
   SET last_accepted_write_at =
       pg_catalog.statement_timestamp() - interval '10 minutes'
 WHERE profile_id = 'fd000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT public.record_fingerprint(pg_catalog.repeat('e', 64), 'budget-5');
RESET ROLE;

UPDATE public.device_fingerprints
   SET last_seen = pg_catalog.statement_timestamp() - interval '10 minutes'
 WHERE profile_id = 'fd000000-0000-4000-8000-000000000002';
UPDATE private.device_fingerprint_rate_limits
   SET last_accepted_write_at =
       pg_catalog.statement_timestamp() - interval '10 minutes'
 WHERE profile_id = 'fd000000-0000-4000-8000-000000000002';

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'fd000000-0000-4000-8000-000000000002',
  true
);
RESET ROLE;
DO $rolling_budget_rejected$
DECLARE
  before_rows text;
  before_profile text;
  before_limiter text;
  before_sequence bigint;
BEGIN
  SELECT pg_catalog.md5(pg_catalog.jsonb_agg(
           pg_catalog.to_jsonb(fingerprint) ORDER BY fingerprint.id
         )::text)
    INTO before_rows
    FROM public.device_fingerprints AS fingerprint
   WHERE fingerprint.profile_id =
         'fd000000-0000-4000-8000-000000000002';
  SELECT pg_catalog.md5(pg_catalog.to_jsonb(profile)::text)
    INTO before_profile FROM public.profiles AS profile
   WHERE profile.id = 'fd000000-0000-4000-8000-000000000002';
  SELECT pg_catalog.md5(pg_catalog.to_jsonb(limiter)::text)
    INTO before_limiter
    FROM private.device_fingerprint_rate_limits AS limiter
   WHERE limiter.profile_id =
         'fd000000-0000-4000-8000-000000000002';
  SELECT sequence_state.last_value INTO before_sequence
    FROM public.device_fingerprints_id_seq AS sequence_state;

  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.record_fingerprint(
      pg_catalog.repeat('f', 64),
      'budget-6-rejected'
    );
    RAISE EXCEPTION 'sixth rolling-window hash was accepted';
  EXCEPTION WHEN SQLSTATE 'PT429' THEN
    IF SQLERRM <> 'fingerprint_rate_limited' THEN RAISE; END IF;
  END;
  RESET ROLE;

  IF before_rows IS DISTINCT FROM (
       SELECT pg_catalog.md5(pg_catalog.jsonb_agg(
         pg_catalog.to_jsonb(fingerprint) ORDER BY fingerprint.id
       )::text)
         FROM public.device_fingerprints AS fingerprint
        WHERE fingerprint.profile_id =
              'fd000000-0000-4000-8000-000000000002'
     ) OR before_profile IS DISTINCT FROM (
       SELECT pg_catalog.md5(pg_catalog.to_jsonb(profile)::text)
         FROM public.profiles AS profile
        WHERE profile.id = 'fd000000-0000-4000-8000-000000000002'
     ) OR before_limiter IS DISTINCT FROM (
       SELECT pg_catalog.md5(pg_catalog.to_jsonb(limiter)::text)
         FROM private.device_fingerprint_rate_limits AS limiter
        WHERE limiter.profile_id =
              'fd000000-0000-4000-8000-000000000002'
     ) OR before_sequence IS DISTINCT FROM (
       SELECT sequence_state.last_value
         FROM public.device_fingerprints_id_seq AS sequence_state
     ) THEN
    RAISE EXCEPTION 'rolling-budget rejection caused a state change';
  END IF;
END;
$rolling_budget_rejected$;

UPDATE public.device_fingerprints
   SET first_seen = first_seen - interval '25 hours',
       last_seen = pg_catalog.statement_timestamp() - interval '10 minutes'
 WHERE profile_id = 'fd000000-0000-4000-8000-000000000002';
UPDATE private.device_fingerprint_rate_limits
   SET last_accepted_write_at =
         pg_catalog.statement_timestamp() - interval '10 minutes',
       accepted_new_hash_at = ARRAY(
         SELECT accepted_at - interval '25 hours'
           FROM pg_catalog.unnest(accepted_new_hash_at)
                AS accepted(accepted_at)
       )
 WHERE profile_id = 'fd000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'fd000000-0000-4000-8000-000000000002',
  true
);
SELECT public.record_fingerprint(pg_catalog.repeat('f', 64), 'window-reset');
RESET ROLE;

DO $rolling_window_reset$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
      FROM public.device_fingerprints AS fingerprint
     WHERE fingerprint.profile_id =
           'fd000000-0000-4000-8000-000000000002'
  ) <> 6 OR (
    SELECT pg_catalog.cardinality(limiter.accepted_new_hash_at)
      FROM private.device_fingerprint_rate_limits AS limiter
     WHERE limiter.profile_id =
           'fd000000-0000-4000-8000-000000000002'
  ) <> 1 THEN
    RAISE EXCEPTION 'rolling 24-hour window did not expire deterministically';
  END IF;
END;
$rolling_window_reset$;

-- Direct local fixtures create the exact 20-row boundary with timestamps old
-- enough to avoid the new rolling budget. The authenticated call must reuse
-- the deterministic LRU row id and leave the sequence unchanged.
INSERT INTO public.device_fingerprints (
  profile_id,
  fp_hash,
  first_seen,
  last_seen,
  seen_count,
  ua_snippet
)
SELECT
  'fd000000-0000-4000-8000-000000000003'::uuid,
  pg_catalog.lpad(pg_catalog.to_hex(sequence_no), 64, '0'),
  pg_catalog.statement_timestamp() - interval '3 days'
    + sequence_no * interval '1 second',
  pg_catalog.statement_timestamp() - interval '2 days'
    + sequence_no * interval '1 second',
  7,
  'old ua'
FROM pg_catalog.generate_series(1, 20) AS sequence_no;

CREATE TEMP TABLE churn_cap_baseline AS
SELECT
  fingerprint.id AS expected_lru_id,
  (SELECT sequence_state.last_value
     FROM public.device_fingerprints_id_seq AS sequence_state)
    AS sequence_last_value
FROM public.device_fingerprints AS fingerprint
WHERE fingerprint.profile_id = 'fd000000-0000-4000-8000-000000000003'
ORDER BY fingerprint.last_seen ASC, fingerprint.id ASC
LIMIT 1;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'fd000000-0000-4000-8000-000000000003',
  true
);
SELECT public.record_fingerprint(pg_catalog.repeat('9', 64), 'new ua');
RESET ROLE;

DO $at_cap_reuses_lru$
DECLARE
  observed_id bigint;
  observed_first timestamptz;
  observed_last timestamptz;
  observed_seen integer;
  observed_ua text;
  observed_sequence bigint;
BEGIN
  SELECT
    fingerprint.id,
    fingerprint.first_seen,
    fingerprint.last_seen,
    fingerprint.seen_count,
    fingerprint.ua_snippet
    INTO
      observed_id,
      observed_first,
      observed_last,
      observed_seen,
      observed_ua
    FROM public.device_fingerprints AS fingerprint
   WHERE fingerprint.profile_id =
         'fd000000-0000-4000-8000-000000000003'
     AND fingerprint.fp_hash = pg_catalog.repeat('9', 64);
  SELECT sequence_state.last_value INTO observed_sequence
    FROM public.device_fingerprints_id_seq AS sequence_state;

  IF (
    SELECT pg_catalog.count(*)
      FROM public.device_fingerprints AS fingerprint
     WHERE fingerprint.profile_id =
           'fd000000-0000-4000-8000-000000000003'
  ) <> 20 OR observed_id IS DISTINCT FROM (
    SELECT expected_lru_id FROM churn_cap_baseline
  ) OR observed_sequence IS DISTINCT FROM (
    SELECT sequence_last_value FROM churn_cap_baseline
  ) OR observed_first IS DISTINCT FROM observed_last
     OR observed_seen <> 1 OR observed_ua IS DISTINCT FROM 'new ua' THEN
    RAISE EXCEPTION
      'at-cap in-place replacement drifted id %, seen %, ua %, sequence %',
      observed_id,
      observed_seen,
      observed_ua,
      observed_sequence;
  END IF;
END;
$at_cap_reuses_lru$;

INSERT INTO public.device_fingerprints (
  profile_id,
  fp_hash,
  first_seen,
  last_seen
)
SELECT
  'fd000000-0000-4000-8000-000000000004'::uuid,
  pg_catalog.lpad(pg_catalog.to_hex(100 + sequence_no), 64, '0'),
  pg_catalog.statement_timestamp() - interval '3 days',
  pg_catalog.statement_timestamp() - interval '2 days'
FROM pg_catalog.generate_series(1, 19) AS sequence_no;

CREATE TEMP TABLE churn_undercap_baseline AS
SELECT sequence_state.last_value AS sequence_last_value
  FROM public.device_fingerprints_id_seq AS sequence_state;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'fd000000-0000-4000-8000-000000000004',
  true
);
SELECT public.record_fingerprint(pg_catalog.repeat('8', 64), 'twentieth');
RESET ROLE;

DO $undercap_inserts_once$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
      FROM public.device_fingerprints AS fingerprint
     WHERE fingerprint.profile_id =
           'fd000000-0000-4000-8000-000000000004'
  ) <> 20 OR (
    SELECT sequence_state.last_value
      FROM public.device_fingerprints_id_seq AS sequence_state
  ) <> (
    SELECT sequence_last_value + 1 FROM churn_undercap_baseline
  ) THEN
    RAISE EXCEPTION '19-to-20 insert did not advance sequence exactly once';
  END IF;
END;
$undercap_inserts_once$;

INSERT INTO public.device_fingerprints (profile_id, fp_hash, last_seen)
SELECT
  'fd000000-0000-4000-8000-000000000005'::uuid,
  pg_catalog.lpad(pg_catalog.to_hex(200 + sequence_no), 64, '0'),
  pg_catalog.statement_timestamp() - interval '2 days'
FROM pg_catalog.generate_series(1, 21) AS sequence_no;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'fd000000-0000-4000-8000-000000000005',
  true
);
RESET ROLE;
DO $overcap_rejected$
DECLARE
  before_rows text;
  before_sequence bigint;
BEGIN
  SELECT pg_catalog.md5(pg_catalog.jsonb_agg(
           pg_catalog.to_jsonb(fingerprint) ORDER BY fingerprint.id
         )::text)
    INTO before_rows
    FROM public.device_fingerprints AS fingerprint
   WHERE fingerprint.profile_id =
         'fd000000-0000-4000-8000-000000000005';
  SELECT sequence_state.last_value INTO before_sequence
    FROM public.device_fingerprints_id_seq AS sequence_state;

  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.record_fingerprint(
      pg_catalog.repeat('7', 64),
      'over-cap'
    );
    RAISE EXCEPTION 'over-cap profile did not fail closed';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'fingerprint_cleanup_required' THEN RAISE; END IF;
  END;
  RESET ROLE;

  IF before_rows IS DISTINCT FROM (
    SELECT pg_catalog.md5(pg_catalog.jsonb_agg(
             pg_catalog.to_jsonb(fingerprint) ORDER BY fingerprint.id
           )::text)
      FROM public.device_fingerprints AS fingerprint
     WHERE fingerprint.profile_id =
           'fd000000-0000-4000-8000-000000000005'
  ) OR before_sequence IS DISTINCT FROM (
    SELECT sequence_state.last_value
      FROM public.device_fingerprints_id_seq AS sequence_state
  ) THEN
    RAISE EXCEPTION 'over-cap failure changed fingerprint state';
  END IF;
END;
$overcap_rejected$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'fd000000-0000-4000-8000-000000000099',
  true
);
SELECT public.record_fingerprint(pg_catalog.repeat('6', 64), 'no profile');
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE authenticated;
DO $unauthenticated_boundary$
BEGIN
  BEGIN
    PERFORM public.record_fingerprint(
      pg_catalog.repeat('5', 64),
      'unauthenticated'
    );
    RAISE EXCEPTION 'unauthenticated fingerprint accepted';
  EXCEPTION WHEN invalid_authorization_specification THEN
    IF SQLERRM <> 'not_authenticated' THEN RAISE; END IF;
  END;
END;
$unauthenticated_boundary$;
RESET ROLE;

DO $private_acl_boundary$
BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM pg_catalog.count(*)
      FROM private.device_fingerprint_rate_limits;
    RESET ROLE;
    RAISE EXCEPTION 'authenticated could read the private limiter';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;

  BEGIN
    SET LOCAL ROLE service_role;
    PERFORM pg_catalog.count(*)
      FROM private.device_fingerprint_rate_limits;
    RESET ROLE;
    RAISE EXCEPTION 'service_role could read the private limiter';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;
END;
$private_acl_boundary$;

DO $cascade_and_session_boundaries$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM private.device_fingerprint_rate_limits AS limiter
     WHERE limiter.profile_id =
           'fd000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'budget fixture limiter is missing before cascade';
  END IF;

  DELETE FROM public.profiles
   WHERE id = 'fd000000-0000-4000-8000-000000000002';

  IF EXISTS (
    SELECT 1
      FROM private.device_fingerprint_rate_limits AS limiter
     WHERE limiter.profile_id =
           'fd000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'profile deletion did not cascade the limiter';
  END IF;

  IF (
    SELECT pg_catalog.count(*)::text FROM auth.sessions
  ) IS DISTINCT FROM (
    SELECT value FROM churn_regression_baseline WHERE name = 'auth_sessions'
  ) THEN
    RAISE EXCEPTION
      'fingerprint regression unexpectedly changed Auth sessions';
  END IF;
END;
$cascade_and_session_boundaries$;

ROLLBACK;
