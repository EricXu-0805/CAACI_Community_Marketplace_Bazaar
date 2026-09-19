-- Expand before deploying the first-party campaign measurement privacy bundle. Preserve old
-- client acceptance; never rewrite a user's acceptance without their action.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF to_regprocedure('public.record_consent(text,uuid)') IS NULL
    OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND conname='profiles_tos_version_release_allowlist' AND convalidated) THEN
   RAISE EXCEPTION 'consent_dependency_missing';
 END IF;
END $$;
ALTER TABLE public.profiles DROP CONSTRAINT profiles_tos_version_release_allowlist;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_tos_version_release_allowlist
 CHECK(tos_version IN ('0','2026-04-20','2026-07-18','2026-08-01','2026-09-03','2026-09-16','2026-09-17','2026-09-19')) NOT VALID;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_tos_version_release_allowlist;
CREATE OR REPLACE FUNCTION public.record_consent(
  version_in text,
  expected_user_id_in uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  target_version text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS NULL OR expected_user_id_in <> caller_id THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;
  CASE version_in
    WHEN '2026-07-18' THEN target_version := '2026-07-18';
    WHEN '2026-08-01' THEN target_version := '2026-08-01';
    WHEN '2026-09-03' THEN target_version := '2026-09-03';
    WHEN '2026-09-16' THEN target_version := '2026-09-16';
    WHEN '2026-09-17' THEN target_version := '2026-09-17';
    WHEN '2026-09-19' THEN target_version := '2026-09-19';
    ELSE
      RAISE EXCEPTION 'invalid_version' USING ERRCODE = '22023';
  END CASE;

  UPDATE public.profiles
  SET tos_version = target_version,
      consented_at = pg_catalog.statement_timestamp()
  WHERE id = expected_user_id_in
    AND (
      tos_version IS NULL
      OR tos_version = '0'
      OR tos_version < target_version
    );

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = expected_user_id_in
  ) THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.record_consent(text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_consent(text, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.record_consent(text,uuid) IS 'Account-bound consent; includes September 19 first-party campaign session and verified-account cohort reporting; never downgrades.';
COMMIT;
