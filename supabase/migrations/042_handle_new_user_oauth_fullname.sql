-- ============================================================
-- 042_handle_new_user_oauth_fullname.sql
--
-- Patches public.handle_new_user() trigger to read Google OAuth's
-- raw_user_meta_data.full_name (and fallback .name) before falling
-- back to the email local part. Pre-patch, Google OAuth users land
-- with nickname like "eric.guoyi.xu" (email prefix) which is poor UX.
--
-- Context: O1 sprint (2026-05-20) removed the 3-step onboarding wizard
-- after F1/F1b/F1c failed real-device verification on the nickname
-- input glyph clipping bug. The wizard was the previous mechanism for
-- new users to set a proper display name; handle_new_user is now the
-- sole source of new-user nickname (with profile/edit as the editable
-- surface afterwards).
--
-- Forward-only. Idempotent. CREATE OR REPLACE only re-defines function
-- body — no schema changes, no trigger re-registration, no data
-- migration. Safe to apply on prod and safe to re-run.
--
-- IMPORTANT: This migration MUST preserve every column write that the
-- current handle_new_user (last defined in 010_plaza_and_uid_and_chat_flags.sql)
-- already performs:
--   - id
--   - email
--   - nickname (COALESCE chain extended here)
--   - is_illini_verified (LOWER(email) LIKE '%@illinois.edu' boolean)
--   - uid (public.generate_uid())
-- The ON CONFLICT (id) DO NOTHING + EXCEPTION-WHEN-OTHERS-RAISE-WARNING
-- envelope is preserved verbatim from 010 — it guarantees auth signup
-- never fails just because the trigger had a problem (the profile row
-- can be backfilled lazily via get_my_profile fallback in useAuth).
--
-- Author: Eric (EricXu-0805 <eric.guoyi.xu@gmail.com>)
-- Cross-ref: docs/memory/o1_onboarding_removed.md
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, email, nickname, is_illini_verified, uid)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(
        NEW.raw_user_meta_data->>'nickname',     -- Email signup form provides this (useAuth.signUp passes data.nickname)
        NEW.raw_user_meta_data->>'full_name',    -- Google OAuth provides this (042: O1-added)
        NEW.raw_user_meta_data->>'name',         -- Belt-and-suspenders OAuth fallback (042: O1-added)
        split_part(NEW.email, '@', 1),           -- Email-prefix fallback (existing 010 behavior)
        'user'                                    -- Final fallback (existing 010 behavior)
      ),
      (LOWER(COALESCE(NEW.email, '')) LIKE '%@illinois.edu'),
      public.generate_uid()
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- The trigger registration (ON auth.users AFTER INSERT) created in
-- 001_initial_schema.sql is unchanged — CREATE OR REPLACE FUNCTION only
-- updates the function body. No additional GRANTs or REVOKEs needed.

-- Verification queries (run after apply):
--   SELECT prosrc FROM pg_proc WHERE proname = 'handle_new_user';
--     -> body should include 'full_name' COALESCE branch
--
--   -- Smoke: simulate Google OAuth user (do this via Supabase Dashboard
--   -- Auth → Users → Invite, not in SQL, to exercise the full trigger chain)
--   -- Or check existing profiles for any with email-prefix nickname that
--   -- a re-signup would now resolve to full_name:
--   SELECT id, email, nickname FROM public.profiles
--     WHERE nickname = split_part(email, '@', 1)
--     LIMIT 5;
