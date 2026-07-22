-- Isolated/local behavioral regression for shared email delivery claims.
-- NEVER run against production. Every fixture mutation is rolled back.

\set ON_ERROR_STOP on

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.claim_notification_email_delivery(uuid[],text,integer)'
     ) IS NULL THEN
    RAISE EXCEPTION 'regression_preflight_failed: migration 270 is not applied';
  END IF;
END
$preflight$;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (
  'e7000000-0000-4000-8000-000000000001',
  'delivery-claim@example.test',
  '{}'::jsonb
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname) VALUES (
  'e7000000-0000-4000-8000-000000000001',
  'Delivery Claim Fixture'
) ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname;

INSERT INTO public.notifications (id, user_id, type, title, body) VALUES
  ('e7100000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000001', 'system', 'Race A', ''),
  ('e7100000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000001', 'system', 'Digest B', ''),
  ('e7100000-0000-4000-8000-000000000003', 'e7000000-0000-4000-8000-000000000001', 'system', 'Digest C', ''),
  ('e7100000-0000-4000-8000-000000000004', 'e7000000-0000-4000-8000-000000000001', 'system', 'Release D', '');

CREATE TEMP TABLE delivery_claim_result (
  label text PRIMARY KEY,
  delivery_key text,
  claim_token uuid,
  notification_ids uuid[]
) ON COMMIT DROP;
GRANT SELECT, INSERT, UPDATE ON TABLE pg_temp.delivery_claim_result TO service_role;

SET LOCAL ROLE service_role;
INSERT INTO pg_temp.delivery_claim_result
SELECT 'immediate_a', claim.*
FROM public.claim_notification_email_delivery(
  ARRAY['e7100000-0000-4000-8000-000000000001']::uuid[],
  'immediate',
  120
) AS claim;
INSERT INTO pg_temp.delivery_claim_result
SELECT 'digest_loses_a', claim.*
FROM public.claim_notification_email_delivery(
  ARRAY['e7100000-0000-4000-8000-000000000001']::uuid[],
  'digest',
  120
) AS claim;
RESET ROLE;

DO $active_race$
DECLARE
  immediate_claim pg_temp.delivery_claim_result;
BEGIN
  SELECT * INTO immediate_claim
  FROM pg_temp.delivery_claim_result WHERE label = 'immediate_a';
  IF immediate_claim.delivery_key <>
       'immediate/e7100000-0000-4000-8000-000000000001'
     OR immediate_claim.notification_ids IS DISTINCT FROM
       ARRAY['e7100000-0000-4000-8000-000000000001']::uuid[]
     OR EXISTS (
       SELECT 1 FROM pg_temp.delivery_claim_result
       WHERE label = 'digest_loses_a'
     ) THEN
    RAISE EXCEPTION 'active immediate-vs-digest arbitration drifted';
  END IF;
END
$active_race$;

-- An attempted provider call makes immediate ownership/key sticky. Releasing
-- the lease cannot let digest send the same row under a different key.
SET LOCAL ROLE service_role;
DO $attempt_release$
DECLARE
  current_claim pg_temp.delivery_claim_result;
  changed integer;
BEGIN
  SELECT * INTO current_claim
  FROM pg_temp.delivery_claim_result WHERE label = 'immediate_a';
  changed := public.begin_notification_email_delivery(
    current_claim.claim_token, current_claim.delivery_key, 600
  );
  IF changed <> 1 THEN RAISE EXCEPTION 'begin count drifted: %', changed; END IF;
  changed := public.release_notification_email_delivery(
    current_claim.claim_token, current_claim.delivery_key
  );
  IF changed <> 1 THEN RAISE EXCEPTION 'release count drifted: %', changed; END IF;
END
$attempt_release$;
INSERT INTO pg_temp.delivery_claim_result
SELECT 'digest_still_loses_a', claim.*
FROM public.claim_notification_email_delivery(
  ARRAY['e7100000-0000-4000-8000-000000000001']::uuid[],
  'digest',
  120
) AS claim;
INSERT INTO pg_temp.delivery_claim_result
SELECT 'immediate_a_retry', claim.*
FROM public.claim_notification_email_delivery(
  ARRAY['e7100000-0000-4000-8000-000000000001']::uuid[],
  'immediate',
  120
) AS claim;
RESET ROLE;

DO $sticky_retry$
DECLARE
  first_claim pg_temp.delivery_claim_result;
  retry_claim pg_temp.delivery_claim_result;
  changed integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_temp.delivery_claim_result
    WHERE label = 'digest_still_loses_a'
  ) THEN
    RAISE EXCEPTION 'digest stole an attempted immediate delivery';
  END IF;
  SELECT * INTO first_claim
  FROM pg_temp.delivery_claim_result WHERE label = 'immediate_a';
  SELECT * INTO retry_claim
  FROM pg_temp.delivery_claim_result WHERE label = 'immediate_a_retry';
  IF retry_claim.delivery_key IS DISTINCT FROM first_claim.delivery_key
     OR retry_claim.claim_token IS NOT DISTINCT FROM first_claim.claim_token THEN
    RAISE EXCEPTION 'ambiguous retry did not preserve only the provider key';
  END IF;

  SET LOCAL ROLE service_role;
  changed := public.complete_notification_email_delivery(
    retry_claim.claim_token, retry_claim.delivery_key
  );
  IF changed <> 0 THEN RAISE EXCEPTION 'completed before begin: %', changed; END IF;
  changed := public.renew_notification_email_delivery(
    retry_claim.claim_token, retry_claim.delivery_key, 180
  );
  IF changed <> 1 THEN RAISE EXCEPTION 'renew count drifted: %', changed; END IF;
  changed := public.begin_notification_email_delivery(
    retry_claim.claim_token, retry_claim.delivery_key, 600
  );
  IF changed <> 1 THEN RAISE EXCEPTION 'retry begin count drifted: %', changed; END IF;
  changed := public.complete_notification_email_delivery(
    retry_claim.claim_token, retry_claim.delivery_key
  );
  IF changed <> 1 THEN RAISE EXCEPTION 'complete count drifted: %', changed; END IF;
  changed := public.complete_notification_email_delivery(
    retry_claim.claim_token, retry_claim.delivery_key
  );
  IF changed <> 1 THEN RAISE EXCEPTION 'complete replay not idempotent: %', changed; END IF;
  RESET ROLE;
END
$sticky_retry$;

-- Before begin, release returns ownership to the common pool. Immediate can
-- then win a row initially claimed by digest.
SET LOCAL ROLE service_role;
INSERT INTO pg_temp.delivery_claim_result
SELECT 'digest_d', claim.*
FROM public.claim_notification_email_delivery(
  ARRAY['e7100000-0000-4000-8000-000000000004']::uuid[],
  'digest',
  120
) AS claim;
DO $unattempted_release$
DECLARE
  current_claim pg_temp.delivery_claim_result;
  changed integer;
BEGIN
  SELECT * INTO current_claim
  FROM pg_temp.delivery_claim_result WHERE label = 'digest_d';
  changed := public.release_notification_email_delivery(
    current_claim.claim_token, current_claim.delivery_key
  );
  IF changed <> 1 THEN RAISE EXCEPTION 'unattempted release failed'; END IF;
END
$unattempted_release$;
INSERT INTO pg_temp.delivery_claim_result
SELECT 'immediate_d', claim.*
FROM public.claim_notification_email_delivery(
  ARRAY['e7100000-0000-4000-8000-000000000004']::uuid[],
  'immediate',
  120
) AS claim;
RESET ROLE;

DO $reassignment$
DECLARE
  immediate_claim pg_temp.delivery_claim_result;
BEGIN
  SELECT * INTO immediate_claim
  FROM pg_temp.delivery_claim_result WHERE label = 'immediate_d';
  IF immediate_claim.delivery_key <>
       'immediate/e7100000-0000-4000-8000-000000000004' THEN
    RAISE EXCEPTION 'unattempted release did not permit reassignment';
  END IF;
END
$reassignment$;

-- A two-row digest retry recovers the complete original group/key even when
-- the retry supplies just one member.
SET LOCAL ROLE service_role;
INSERT INTO pg_temp.delivery_claim_result
SELECT 'digest_bc', claim.*
FROM public.claim_notification_email_delivery(
  ARRAY[
    'e7100000-0000-4000-8000-000000000002',
    'e7100000-0000-4000-8000-000000000003'
  ]::uuid[],
  'digest',
  120
) AS claim;
DO $digest_attempt_release$
DECLARE
  current_claim pg_temp.delivery_claim_result;
BEGIN
  SELECT * INTO current_claim
  FROM pg_temp.delivery_claim_result WHERE label = 'digest_bc';
  IF public.begin_notification_email_delivery(
       current_claim.claim_token, current_claim.delivery_key, 600
     ) <> 2 THEN
    RAISE EXCEPTION 'digest begin count drifted';
  END IF;
  IF public.release_notification_email_delivery(
       current_claim.claim_token, current_claim.delivery_key
     ) <> 2 THEN
    RAISE EXCEPTION 'digest release count drifted';
  END IF;
END
$digest_attempt_release$;
INSERT INTO pg_temp.delivery_claim_result
SELECT 'digest_bc_retry', claim.*
FROM public.claim_notification_email_delivery(
  ARRAY['e7100000-0000-4000-8000-000000000002']::uuid[],
  'digest',
  120
) AS claim;
RESET ROLE;

DO $digest_retry$
DECLARE
  first_claim pg_temp.delivery_claim_result;
  retry_claim pg_temp.delivery_claim_result;
BEGIN
  SELECT * INTO first_claim
  FROM pg_temp.delivery_claim_result WHERE label = 'digest_bc';
  SELECT * INTO retry_claim
  FROM pg_temp.delivery_claim_result WHERE label = 'digest_bc_retry';
  IF retry_claim.delivery_key IS DISTINCT FROM first_claim.delivery_key
     OR retry_claim.notification_ids IS DISTINCT FROM ARRAY[
       'e7100000-0000-4000-8000-000000000002',
       'e7100000-0000-4000-8000-000000000003'
     ]::uuid[] THEN
    RAISE EXCEPTION 'digest retry did not recover the exact sticky batch';
  END IF;

  SET LOCAL ROLE service_role;
  IF public.begin_notification_email_delivery(
       retry_claim.claim_token, retry_claim.delivery_key, 600
     ) <> 2 OR public.complete_notification_email_delivery(
       retry_claim.claim_token, retry_claim.delivery_key
     ) <> 2 THEN
    RAISE EXCEPTION 'digest retry could not complete atomically';
  END IF;
  RESET ROLE;
END
$digest_retry$;

DO $final_state$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM public.notifications AS notification
    WHERE notification.id IN (
      'e7100000-0000-4000-8000-000000000001',
      'e7100000-0000-4000-8000-000000000002',
      'e7100000-0000-4000-8000-000000000003'
    ) AND notification.emailed_at IS NOT NULL
  ) <> 3 THEN
    RAISE EXCEPTION 'completed delivery rows were not stamped atomically';
  END IF;
END
$final_state$;

ROLLBACK;
