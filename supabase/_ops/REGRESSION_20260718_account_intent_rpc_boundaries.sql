-- Isolated/local behavioral regression for the rolling account-intent
-- overloads in 20260717092804_secure_public_write_boundaries.sql.
-- NEVER run against production. Every fixture mutation is rolled back.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('98000000-0000-4000-8000-000000000001', 'intent-a@example.test', '{}'::jsonb),
  ('98000000-0000-4000-8000-000000000002', 'intent-b@example.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname) VALUES
  ('98000000-0000-4000-8000-000000000001', 'Intent A'),
  ('98000000-0000-4000-8000-000000000002', 'Intent B')
ON CONFLICT (id) DO UPDATE SET
  nickname = EXCLUDED.nickname,
  tos_version = '0',
  consented_at = NULL,
  onboarded_at = NULL,
  campus_area = NULL;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '98000000-0000-4000-8000-000000000001',
  true
);

-- New clients carry both the exact account and the release-bound version.
SELECT public.mark_onboarded(
  'Intent A updated',
  'UIUC',
  '98000000-0000-4000-8000-000000000001',
  NULL
);
SELECT public.record_consent(
  '2026-07-18',
  '98000000-0000-4000-8000-000000000001'
);

DO $new_release_validation$
DECLARE
  rejected_version text;
BEGIN
  FOREACH rejected_version IN ARRAY ARRAY[
    '9999', '9999-12-31', '2026-04-20', ' 2026-07-18 ',
    '2026-07-18x'
  ] LOOP
    BEGIN
      PERFORM public.record_consent(
        rejected_version,
        '98000000-0000-4000-8000-000000000001'
      );
      RAISE EXCEPTION 'new consent accepted rejected version %', rejected_version;
    EXCEPTION WHEN invalid_parameter_value THEN
      IF SQLERRM <> 'invalid_version' THEN RAISE; END IF;
    END;
  END LOOP;

END
$new_release_validation$;

RESET ROLE;
SELECT pg_catalog.set_config(
  'caaci_test.first_consent_at',
  (SELECT consented_at::text FROM public.profiles
   WHERE id = '98000000-0000-4000-8000-000000000001'),
  true
);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '98000000-0000-4000-8000-000000000001',
  true
);
SELECT public.record_consent(
  '2026-07-18',
  '98000000-0000-4000-8000-000000000001'
);
RESET ROLE;
DO $same_release_first_write$
BEGIN
  IF (SELECT consented_at::text FROM public.profiles
      WHERE id = '98000000-0000-4000-8000-000000000001')
     IS DISTINCT FROM pg_catalog.current_setting(
       'caaci_test.first_consent_at', true
     ) THEN
    RAISE EXCEPTION 'same-release retry rewrote consent timestamp';
  END IF;
END
$same_release_first_write$;

-- The page still carries A's token, but the session has switched to B. New
-- overloads must reject before touching B's profile.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '98000000-0000-4000-8000-000000000002',
  true
);

DO $new_account_switch$
BEGIN
  BEGIN
    PERFORM public.mark_onboarded(
      'Stale A form',
      'Champaign',
      '98000000-0000-4000-8000-000000000001',
      NULL
    );
    RAISE EXCEPTION 'expected stale onboarding intent to fail';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'account_changed' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.record_consent(
      '2026-07-18',
      '98000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'expected stale consent intent to fail';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'account_changed' THEN RAISE; END IF;
  END;
END
$new_account_switch$;

-- Old bundles remain usable while the database is deployed first. Their RPCs
-- derive B solely from the JWT, can attest only the previous release, and are
-- first-writer-wins initialization paths.
SELECT public.mark_onboarded(
  'Intent B legacy first',
  'Legacy campus',
  NULL::text
);
SELECT public.record_consent('2026-04-20');

RESET ROLE;
SELECT pg_catalog.set_config(
  'caaci_test.legacy_onboarded_at',
  (SELECT onboarded_at::text FROM public.profiles
   WHERE id = '98000000-0000-4000-8000-000000000002'),
  true
);
SELECT pg_catalog.set_config(
  'caaci_test.legacy_consented_at',
  (SELECT consented_at::text FROM public.profiles
   WHERE id = '98000000-0000-4000-8000-000000000002'),
  true
);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '98000000-0000-4000-8000-000000000002',
  true
);

DO $legacy_compatibility_and_first_write$
DECLARE
  rejected_version text;
BEGIN
  PERFORM public.mark_onboarded(
    'Legacy retry must not overwrite',
    'Wrong campus',
    'https://example.test/wrong.png'
  );
  PERFORM public.record_consent('2026-04-20');

  FOREACH rejected_version IN ARRAY ARRAY[
    '2026-07-18', '9999', '9999-12-31', '', ' 2026-04-20 ',
    '2026-04-20x'
  ] LOOP
    BEGIN
      PERFORM public.record_consent(rejected_version);
      RAISE EXCEPTION 'legacy consent accepted rejected version %', rejected_version;
    EXCEPTION WHEN invalid_parameter_value THEN
      IF SQLERRM <> 'invalid_version' THEN RAISE; END IF;
    END;
  END LOOP;

  BEGIN
    PERFORM public.mark_onboarded('', 'UIUC', NULL::text);
    RAISE EXCEPTION 'legacy onboarding accepted empty nickname';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_nickname' THEN RAISE; END IF;
  END;
END
$legacy_compatibility_and_first_write$;

RESET ROLE;
DO $legacy_first_write_verify$
BEGIN
  IF (SELECT nickname FROM public.profiles
      WHERE id = '98000000-0000-4000-8000-000000000002')
       <> 'Intent B legacy first'
     OR (SELECT campus_area FROM public.profiles
         WHERE id = '98000000-0000-4000-8000-000000000002')
       <> 'Legacy campus'
     OR (SELECT onboarded_at::text FROM public.profiles
         WHERE id = '98000000-0000-4000-8000-000000000002')
       IS DISTINCT FROM pg_catalog.current_setting(
         'caaci_test.legacy_onboarded_at', true
       )
     OR (SELECT consented_at::text FROM public.profiles
         WHERE id = '98000000-0000-4000-8000-000000000002')
       IS DISTINCT FROM pg_catalog.current_setting(
         'caaci_test.legacy_consented_at', true
       ) THEN
    RAISE EXCEPTION 'legacy retry violated first-writer-wins';
  END IF;
END
$legacy_first_write_verify$;

-- A new client upgrades B to the current release. The legacy signature must
-- remain callable but can no longer downgrade the stored evidence.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '98000000-0000-4000-8000-000000000002',
  true
);
SELECT public.record_consent(
  '2026-07-18',
  '98000000-0000-4000-8000-000000000002'
);
SELECT public.record_consent('2026-04-20');

RESET ROLE;

-- PUBLIC/anon and service_role are explicitly denied both old and new
-- signatures; the function-owner session is used only to switch roles here.
SET LOCAL ROLE anon;
DO $anon_acl$
BEGIN
  BEGIN
    PERFORM public.record_consent('2026-04-20');
    RAISE EXCEPTION 'anon executed legacy consent';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.mark_onboarded('Anon', 'UIUC', NULL::text);
    RAISE EXCEPTION 'anon executed legacy onboarding';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$anon_acl$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $service_acl$
BEGIN
  BEGIN
    PERFORM public.record_consent('2026-04-20');
    RAISE EXCEPTION 'service_role executed legacy consent';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.mark_onboarded('Service', 'UIUC', NULL::text);
    RAISE EXCEPTION 'service_role executed legacy onboarding';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$service_acl$;
RESET ROLE;

DO $verify$
DECLARE
  a_profile public.profiles%ROWTYPE;
  b_profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO STRICT a_profile
  FROM public.profiles
  WHERE id = '98000000-0000-4000-8000-000000000001';

  SELECT * INTO STRICT b_profile
  FROM public.profiles
  WHERE id = '98000000-0000-4000-8000-000000000002';

  IF a_profile.nickname <> 'Intent A updated'
     OR a_profile.campus_area <> 'UIUC'
     OR a_profile.tos_version <> '2026-07-18'
     OR a_profile.onboarded_at IS NULL
     OR a_profile.consented_at IS NULL THEN
    RAISE EXCEPTION 'positive account-intent writes did not persist for A';
  END IF;

  IF b_profile.nickname <> 'Intent B legacy first'
     OR b_profile.campus_area <> 'Legacy campus'
     OR b_profile.tos_version <> '2026-07-18'
     OR b_profile.onboarded_at IS NULL
     OR b_profile.consented_at IS NULL THEN
    RAISE EXCEPTION 'rolling legacy/current transition failed for B';
  END IF;

  BEGIN
    UPDATE public.profiles
    SET tos_version = '9999'
    WHERE id = '98000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'consent release CHECK accepted future poison';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$verify$;

ROLLBACK;
