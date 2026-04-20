-- =========================================================
-- RUN ONBOARDING MIGRATION (026 bundle + PostgREST reload)
-- =========================================================
-- Paste this ENTIRE file into Supabase SQL Editor and run ONCE.
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
--   1. Re-applies 026 verbatim (idempotent — OR REPLACE / IF NOT EXISTS).
--   2. Forces PostgREST to reload its schema cache so the new RPC shows
--      up immediately (otherwise it can take up to 10 minutes, or until
--      the next connection recycle).
--
-- Re-running this is a safe no-op. Keep in repo as proof of application.
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
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF version_in IS NULL OR length(version_in) = 0 OR length(version_in) > 40 THEN
    RAISE EXCEPTION 'invalid_version';
  END IF;
  UPDATE public.profiles
     SET tos_version  = version_in,
         consented_at = now()
   WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.record_consent(text) FROM PUBLIC;
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
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cleaned_nick text;
  cleaned_campus text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  cleaned_nick := btrim(COALESCE(nickname_in, ''));
  IF length(cleaned_nick) < 1 OR length(cleaned_nick) > 40 THEN
    RAISE EXCEPTION 'invalid_nickname';
  END IF;

  cleaned_campus := btrim(COALESCE(campus_in, ''));
  IF length(cleaned_campus) > 80 THEN
    RAISE EXCEPTION 'invalid_campus';
  END IF;

  UPDATE public.profiles
     SET nickname     = cleaned_nick,
         campus_area  = NULLIF(cleaned_campus, ''),
         avatar_url   = COALESCE(NULLIF(avatar_in, ''), avatar_url),
         onboarded_at = now()
   WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.mark_onboarded(text, text, text) FROM PUBLIC;
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
