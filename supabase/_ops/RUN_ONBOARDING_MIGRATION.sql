-- =========================================================
-- DEPRECATED OPERATOR BUNDLE — retained only as historical recovery evidence.
-- Do not execute this file. Its contracts predate the timestamped 2026-07
-- hardening chain and can overwrite current least-privilege functions.
-- Follow RUNBOOK.md and the matching PRECHECK/migration/VERIFY/REGRESSION files.
\set ON_ERROR_STOP on
DO $deprecated_operator_bundle$
BEGIN
  RAISE EXCEPTION
    'deprecated_operator_bundle: use the reviewed timestamped migration chain';
END
$deprecated_operator_bundle$;

-- =========================================================
-- RUN ONBOARDING MIGRATION (026 bundle + PostgREST reload)
-- =========================================================
-- Historical instructions below are retained for incident archaeology only.
--
-- Symptom this fixes:
--   Client error on the avatar picker step of /pages/onboarding/index:
--     "Could not find the function public.mark_onboarded(avatar_in,
--      campus_in, nickname_in) in the schema cache"
--
-- Root cause:
--   Migration 026_profile_consent.sql was committed to the repo in
--   667f40f (onboarding wizard + consent gate) but never applied to the
--   live Supabase database. 027+ (Security C) got all the attention and
--   026 was skipped.
--
-- What this does:
--   1. Re-applies the legacy 026 contract with current safety hardening
--      (idempotent — OR REPLACE / IF NOT EXISTS).
--   2. Forces PostgREST to reload its schema cache so the new RPC shows
--      up immediately (otherwise it can take up to 10 minutes, or until
--      the next connection recycle).
--
-- This is a historical recovery helper, not the complete current release.
-- Apply 20260717092804_secure_public_write_boundaries.sql afterwards to add
-- the expected-account overload and current consent release. Re-running this
-- helper does not remove or weaken that newer overload.
-- =========================================================

BEGIN;

-- ---------- 026: profile consent + onboarding columns ----------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tos_version    text,
  ADD COLUMN IF NOT EXISTS consented_at   timestamptz,
  ADD COLUMN IF NOT EXISTS onboarded_at   timestamptz,
  ADD COLUMN IF NOT EXISTS campus_area    text;

CREATE INDEX IF NOT EXISTS profiles_tos_version_idx
  ON public.profiles (tos_version);

-- ---------- record_consent() RPC ----------
CREATE OR REPLACE FUNCTION public.record_consent(version_in text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  caller_id uuid := auth.uid();
  cleaned_version text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF version_in IS DISTINCT FROM '2026-04-20' THEN
    RAISE EXCEPTION 'invalid_version' USING ERRCODE = '22023';
  END IF;
  cleaned_version := '2026-04-20';

  UPDATE public.profiles
     SET tos_version  = cleaned_version,
         consented_at = pg_catalog.statement_timestamp()
   WHERE id = caller_id
     AND (tos_version IS NULL OR tos_version = '0');

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = caller_id
  ) THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_consent(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_consent(text) TO authenticated;

-- ---------- mark_onboarded() RPC ----------
-- Signature: (nickname_in text, campus_in text, avatar_in text DEFAULT NULL)
-- PostgREST resolves RPCs by the SET of named parameters — order doesn't
-- matter, but the names MUST match the client call site exactly.
-- Client call (onboarding/index.vue:150) passes:
--   { nickname_in, campus_in, avatar_in } — matches this signature.
CREATE OR REPLACE FUNCTION public.mark_onboarded(
  nickname_in  text,
  campus_in    text,
  avatar_in    text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  caller_id uuid := auth.uid();
  cleaned_nick text;
  cleaned_campus text;
  cleaned_avatar text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  cleaned_nick := pg_catalog.btrim(COALESCE(nickname_in, ''));
  IF pg_catalog.length(cleaned_nick) < 1
     OR pg_catalog.length(cleaned_nick) > 40 THEN
    RAISE EXCEPTION 'invalid_nickname' USING ERRCODE = '22023';
  END IF;

  cleaned_campus := pg_catalog.btrim(COALESCE(campus_in, ''));
  IF pg_catalog.length(cleaned_campus) > 80 THEN
    RAISE EXCEPTION 'invalid_campus' USING ERRCODE = '22023';
  END IF;

  cleaned_avatar := NULLIF(pg_catalog.btrim(COALESCE(avatar_in, '')), '');
  IF cleaned_avatar IS NOT NULL
     AND pg_catalog.length(cleaned_avatar) > 2048 THEN
    RAISE EXCEPTION 'invalid_avatar' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
     SET nickname     = cleaned_nick,
         campus_area  = NULLIF(cleaned_campus, ''),
         avatar_url   = COALESCE(cleaned_avatar, avatar_url),
         onboarded_at = pg_catalog.statement_timestamp()
   WHERE id = caller_id
     AND onboarded_at IS NULL;

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = caller_id
  ) THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_onboarded(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_onboarded(text, text, text) TO authenticated;

COMMIT;

-- ---------- PostgREST schema cache reload ----------
-- Without this, the new RPCs may not be visible to the REST API until
-- PostgREST recycles its connection pool (up to ~10 minutes on Supabase).
-- Running NOTIFY forces an immediate reload.
NOTIFY pgrst, 'reload schema';

-- =========================================================
-- Verification — all three should succeed:
--
--   1. Function exists:
--      SELECT proname, pg_get_function_arguments(oid) AS args
--        FROM pg_proc
--       WHERE proname IN ('mark_onboarded', 'record_consent')
--         AND pronamespace = 'public'::regnamespace;
--      -- Expect:
--      --   mark_onboarded  | nickname_in text, campus_in text, avatar_in text DEFAULT NULL::text
--      --   record_consent  | version_in text
--
--   2. Columns exist:
--      SELECT column_name FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'profiles'
--         AND column_name IN ('tos_version', 'consented_at', 'onboarded_at', 'campus_area')
--       ORDER BY column_name;
--      -- Expect all 4 rows.
--
--   3. RPC callable (from your own authenticated session in the app):
--      -- Just retry the onboarding flow; avatar step should now save without
--      -- the "schema cache" error.
-- =========================================================
-- =========================================================
