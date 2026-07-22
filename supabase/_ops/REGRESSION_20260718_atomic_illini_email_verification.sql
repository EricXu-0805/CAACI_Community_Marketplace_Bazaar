-- Isolated/local behavioral regression for
-- 20260717194842_atomic_illini_email_verification.sql.
-- NEVER run against production. Every fixture mutation is rolled back.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (
    '98100000-0000-4000-8000-000000000001',
    'illini-rpc-a@example.test',
    '{"nickname":"Illini RPC A"}'::jsonb
  ),
  (
    '98100000-0000-4000-8000-000000000002',
    'illini-rpc-b@example.test',
    '{"nickname":"Illini RPC B"}'::jsonb
  ),
  (
    '98100000-0000-4000-8000-000000000003',
    'illini-rpc-c@example.test',
    '{"nickname":"Illini RPC C"}'::jsonb
  ),
  (
    '98100000-0000-4000-8000-000000000004',
    'illini-rpc-d@example.test',
    '{"nickname":"Illini RPC D"}'::jsonb
  ),
  (
    '98100000-0000-4000-8000-000000000005',
    'illini-rpc-e@example.test',
    '{"nickname":"Illini RPC E"}'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  raw_user_meta_data = EXCLUDED.raw_user_meta_data;

INSERT INTO public.profiles (
  id,
  email,
  nickname,
  is_illini_verified,
  verified_illini_email
) VALUES
  (
    '98100000-0000-4000-8000-000000000001',
    'illini-rpc-a@example.test',
    'Illini RPC A',
    false,
    NULL
  ),
  (
    '98100000-0000-4000-8000-000000000002',
    'illini-rpc-b@example.test',
    'Illini RPC B',
    false,
    NULL
  ),
  (
    '98100000-0000-4000-8000-000000000003',
    'illini-rpc-c@example.test',
    'Illini RPC C',
    false,
    NULL
  ),
  (
    '98100000-0000-4000-8000-000000000004',
    'illini-rpc-d@example.test',
    'Illini RPC D',
    false,
    NULL
  ),
  (
    '98100000-0000-4000-8000-000000000005',
    'illini-rpc-e@example.test',
    'Illini RPC E',
    false,
    NULL
  )
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  nickname = EXCLUDED.nickname,
  is_illini_verified = false,
  verified_illini_email = NULL;

DELETE FROM public.illini_verifications
WHERE user_id IN (
  '98100000-0000-4000-8000-000000000001',
  '98100000-0000-4000-8000-000000000002',
  '98100000-0000-4000-8000-000000000003',
  '98100000-0000-4000-8000-000000000004',
  '98100000-0000-4000-8000-000000000005'
);

-- A wrong digest increments once; the next correct digest grants and consumes.
INSERT INTO public.illini_verifications (
  user_id,
  email,
  code_hash,
  expires_at,
  attempts
) VALUES (
  '98100000-0000-4000-8000-000000000001',
  '  Atomic.Shared@Illinois.edu  ',
  pg_catalog.repeat('a', 64),
  pg_catalog.statement_timestamp() + interval '10 minutes',
  0
);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '98100000-0000-4000-8000-000000000001',
  true
);

DO $test$
DECLARE
  actual_status text;
BEGIN
  actual_status := public.verify_illini_email_code(
    '98100000-0000-4000-8000-000000000001',
    pg_catalog.repeat('b', 64)
  );
  IF actual_status <> 'bad_code' THEN
    RAISE EXCEPTION 'expected bad_code, got %', actual_status;
  END IF;

  actual_status := public.verify_illini_email_code(
    '98100000-0000-4000-8000-000000000001',
    pg_catalog.repeat('a', 64)
  );
  IF actual_status <> 'verified' THEN
    RAISE EXCEPTION 'expected verified, got %', actual_status;
  END IF;

  actual_status := public.verify_illini_email_code(
    '98100000-0000-4000-8000-000000000001',
    pg_catalog.repeat('a', 64)
  );
  IF actual_status <> 'no_pending' THEN
    RAISE EXCEPTION 'expected no_pending after consumption, got %', actual_status;
  END IF;
END
$test$;

RESET ROLE;

DO $verify$
DECLARE
  verified_flag boolean;
  verified_email text;
BEGIN
  SELECT profile.is_illini_verified, profile.verified_illini_email
  INTO STRICT verified_flag, verified_email
  FROM public.profiles AS profile
  WHERE profile.id = '98100000-0000-4000-8000-000000000001';

  IF verified_flag IS NOT TRUE
     OR verified_email <> 'atomic.shared@illinois.edu' THEN
    RAISE EXCEPTION 'successful grant did not normalize and persist the badge';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.illini_verifications AS verification
    WHERE verification.user_id =
      '98100000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'successful grant did not consume the pending row';
  END IF;
END
$verify$;

-- A verified account consumes any stale pending row without re-granting.
INSERT INTO public.illini_verifications (
  user_id,
  email,
  code_hash,
  expires_at
) VALUES (
  '98100000-0000-4000-8000-000000000001',
  'another@illinois.edu',
  pg_catalog.repeat('f', 64),
  pg_catalog.statement_timestamp() + interval '10 minutes'
);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '98100000-0000-4000-8000-000000000001',
  true
);

DO $test$
DECLARE
  actual_status text;
BEGIN
  actual_status := public.verify_illini_email_code(
    '98100000-0000-4000-8000-000000000001',
    pg_catalog.repeat('0', 64)
  );
  IF actual_status <> 'already_verified' THEN
    RAISE EXCEPTION 'expected already_verified, got %', actual_status;
  END IF;
END
$test$;

RESET ROLE;

-- A second account with the same normalized campus email loses the unique race
-- and its correct code is consumed.
INSERT INTO public.illini_verifications (
  user_id,
  email,
  code_hash,
  expires_at
) VALUES (
  '98100000-0000-4000-8000-000000000002',
  'ATOMIC.SHARED@ILLINOIS.EDU',
  pg_catalog.repeat('b', 64),
  pg_catalog.statement_timestamp() + interval '10 minutes'
);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '98100000-0000-4000-8000-000000000002',
  true
);

DO $test$
DECLARE
  actual_status text;
BEGIN
  actual_status := public.verify_illini_email_code(
    '98100000-0000-4000-8000-000000000002',
    pg_catalog.repeat('b', 64)
  );
  IF actual_status <> 'email_taken' THEN
    RAISE EXCEPTION 'expected email_taken, got %', actual_status;
  END IF;
END
$test$;

RESET ROLE;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.illini_verifications AS verification
    WHERE verification.user_id =
      '98100000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'email_taken did not consume the correct code';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = '98100000-0000-4000-8000-000000000002'
      AND (
        profile.is_illini_verified IS TRUE
        OR profile.verified_illini_email IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'email_taken incorrectly granted account B';
  END IF;
END
$verify$;

-- Five serialized wrong guesses each increment; a sixth/correct guess is
-- rejected without changing the row. FOR UPDATE makes the same invariant hold
-- when those calls overlap in separate sessions.
INSERT INTO public.illini_verifications (
  user_id,
  email,
  code_hash,
  expires_at,
  attempts
) VALUES (
  '98100000-0000-4000-8000-000000000003',
  'atomic-c@illinois.edu',
  pg_catalog.repeat('c', 64),
  pg_catalog.statement_timestamp() + interval '10 minutes',
  0
);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '98100000-0000-4000-8000-000000000003',
  true
);

DO $test$
DECLARE
  actual_status text;
  guess_number integer;
BEGIN
  FOR guess_number IN 1..5 LOOP
    actual_status := public.verify_illini_email_code(
      '98100000-0000-4000-8000-000000000003',
      pg_catalog.repeat('d', 64)
    );
    IF actual_status <> 'bad_code' THEN
      RAISE EXCEPTION
        'expected bad_code for guess %, got %', guess_number, actual_status;
    END IF;
  END LOOP;

  actual_status := public.verify_illini_email_code(
    '98100000-0000-4000-8000-000000000003',
    pg_catalog.repeat('c', 64)
  );
  IF actual_status <> 'too_many_attempts' THEN
    RAISE EXCEPTION 'expected too_many_attempts, got %', actual_status;
  END IF;
END
$test$;

RESET ROLE;

DO $verify$
DECLARE
  actual_attempts integer;
BEGIN
  SELECT verification.attempts
  INTO STRICT actual_attempts
  FROM public.illini_verifications AS verification
  WHERE verification.user_id =
    '98100000-0000-4000-8000-000000000003';

  IF actual_attempts <> 5 THEN
    RAISE EXCEPTION 'expected exactly five committed attempts, got %', actual_attempts;
  END IF;
END
$verify$;

-- Expired and corrupt-email rows are consumed without granting.
UPDATE public.illini_verifications AS verification
SET email = 'atomic-c@illinois.edu',
    code_hash = pg_catalog.repeat('c', 64),
    expires_at = pg_catalog.statement_timestamp() - interval '1 minute',
    attempts = 0
WHERE verification.user_id = '98100000-0000-4000-8000-000000000003';

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '98100000-0000-4000-8000-000000000003',
  true
);

DO $test$
DECLARE
  actual_status text;
BEGIN
  actual_status := public.verify_illini_email_code(
    '98100000-0000-4000-8000-000000000003',
    pg_catalog.repeat('c', 64)
  );
  IF actual_status <> 'expired' THEN
    RAISE EXCEPTION 'expected expired, got %', actual_status;
  END IF;
END
$test$;

RESET ROLE;

INSERT INTO public.illini_verifications (
  user_id,
  email,
  code_hash,
  expires_at
) VALUES (
  '98100000-0000-4000-8000-000000000003',
  'atomic-c@example.test',
  pg_catalog.repeat('c', 64),
  pg_catalog.statement_timestamp() + interval '10 minutes'
);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '98100000-0000-4000-8000-000000000003',
  true
);

DO $test$
DECLARE
  actual_status text;
BEGIN
  actual_status := public.verify_illini_email_code(
    '98100000-0000-4000-8000-000000000003',
    pg_catalog.repeat('c', 64)
  );
  IF actual_status <> 'invalid_email' THEN
    RAISE EXCEPTION 'expected invalid_email, got %', actual_status;
  END IF;
END
$test$;

RESET ROLE;

-- A stale account-A intent cannot mutate account B or its attempt counter.
INSERT INTO public.illini_verifications (
  user_id,
  email,
  code_hash,
  expires_at,
  attempts
) VALUES (
  '98100000-0000-4000-8000-000000000002',
  'atomic-b@illinois.edu',
  pg_catalog.repeat('b', 64),
  pg_catalog.statement_timestamp() + interval '10 minutes',
  0
);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '98100000-0000-4000-8000-000000000001',
  true
);

DO $test$
BEGIN
  BEGIN
    PERFORM public.verify_illini_email_code(
      '98100000-0000-4000-8000-000000000002',
      pg_catalog.repeat('b', 64)
    );
    RAISE EXCEPTION 'expected account_changed';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'account_changed' THEN
      RAISE;
    END IF;
  END;
END
$test$;

RESET ROLE;

DO $verify$
DECLARE
  actual_attempts integer;
BEGIN
  SELECT verification.attempts
  INTO STRICT actual_attempts
  FROM public.illini_verifications AS verification
  WHERE verification.user_id =
    '98100000-0000-4000-8000-000000000002';

  IF actual_attempts <> 0 THEN
    RAISE EXCEPTION 'account_changed mutated B attempt count';
  END IF;
END
$verify$;

-- A valid auth user with a missing profile gets an explicit retryable state;
-- its pending code is preserved for an operational repair.
DELETE FROM public.profiles
WHERE id = '98100000-0000-4000-8000-000000000005';

INSERT INTO public.illini_verifications (
  user_id,
  email,
  code_hash,
  expires_at
) VALUES (
  '98100000-0000-4000-8000-000000000005',
  'atomic-e@illinois.edu',
  pg_catalog.repeat('e', 64),
  pg_catalog.statement_timestamp() + interval '10 minutes'
);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '98100000-0000-4000-8000-000000000005',
  true
);

DO $test$
DECLARE
  actual_status text;
BEGIN
  actual_status := public.verify_illini_email_code(
    '98100000-0000-4000-8000-000000000005',
    pg_catalog.repeat('e', 64)
  );
  IF actual_status <> 'profile_not_found' THEN
    RAISE EXCEPTION 'expected profile_not_found, got %', actual_status;
  END IF;
END
$test$;

RESET ROLE;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.illini_verifications AS verification
    WHERE verification.user_id =
      '98100000-0000-4000-8000-000000000005'
  ) THEN
    RAISE EXCEPTION 'profile_not_found consumed the pending code';
  END IF;
END
$verify$;

-- Force the final code-consumption DELETE to fail after the badge UPDATE. The
-- function call must roll both changes back, proving update+consume atomicity.
CREATE OR REPLACE FUNCTION pg_temp.reject_regression_illini_consume()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $trigger$
BEGIN
  IF OLD.user_id = '98100000-0000-4000-8000-000000000004'::uuid THEN
    RAISE EXCEPTION 'synthetic_consume_failure';
  END IF;
  RETURN OLD;
END
$trigger$;

CREATE TRIGGER reject_regression_illini_consume
  BEFORE DELETE ON public.illini_verifications
  FOR EACH ROW
  EXECUTE FUNCTION pg_temp.reject_regression_illini_consume();

INSERT INTO public.illini_verifications (
  user_id,
  email,
  code_hash,
  expires_at,
  attempts
) VALUES (
  '98100000-0000-4000-8000-000000000004',
  'atomic-d@illinois.edu',
  pg_catalog.repeat('d', 64),
  pg_catalog.statement_timestamp() + interval '10 minutes',
  0
);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '98100000-0000-4000-8000-000000000004',
  true
);

DO $test$
BEGIN
  BEGIN
    PERFORM public.verify_illini_email_code(
      '98100000-0000-4000-8000-000000000004',
      pg_catalog.repeat('d', 64)
    );
    RAISE EXCEPTION 'expected synthetic consume failure';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'expected synthetic consume failure' THEN
      RAISE;
    END IF;
    IF SQLERRM <> 'synthetic_consume_failure' THEN
      RAISE;
    END IF;
  END;
END
$test$;

RESET ROLE;

DO $verify$
DECLARE
  verified_flag boolean;
  verified_email text;
  pending_attempts integer;
BEGIN
  SELECT profile.is_illini_verified, profile.verified_illini_email
  INTO STRICT verified_flag, verified_email
  FROM public.profiles AS profile
  WHERE profile.id = '98100000-0000-4000-8000-000000000004';

  SELECT verification.attempts
  INTO STRICT pending_attempts
  FROM public.illini_verifications AS verification
  WHERE verification.user_id =
    '98100000-0000-4000-8000-000000000004';

  IF verified_flag IS TRUE OR verified_email IS NOT NULL THEN
    RAISE EXCEPTION 'failed consume left a partially granted badge';
  END IF;

  IF pending_attempts <> 0 THEN
    RAISE EXCEPTION 'failed consume changed the pending row';
  END IF;
END
$verify$;

DROP TRIGGER reject_regression_illini_consume
  ON public.illini_verifications;

ROLLBACK;
