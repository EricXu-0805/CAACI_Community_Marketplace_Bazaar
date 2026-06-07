-- ============================================
-- 043 Profile bio — PII / moderation screening
-- ============================================
-- Audit finding (docs/audit/SECURITY_AUDIT.md:685-705, CRITICAL_FIXES.md:287-323):
-- profiles.bio is granted SELECT to anon/authenticated (mig 004) and has NO
-- moderation, so a user can drop a phone / WeChat / email in their bio to route
-- deals off-platform — defeating the anti-scam "use in-app chat" stance and
-- exposing contact info even to users they've blocked.
--
-- Fix: screen bio with the SAME content_moderation_check() used for posts /
-- items / comments / messages (mig 024, hardened in 033). It already detects
-- CN mobile numbers, emails, WeChat handles ('contact_info') and the active
-- moderation_keywords lexicon ('sensitive_word'). This is the server-side
-- defense-in-depth layer; the client (useAuth.updateProfile) warns first so
-- the user gets a friendly message before the DB rejects.
--
-- IMPORTANT — changed-only guard: profiles are UPDATEd for many unrelated
-- reasons (avatar, nickname, status, consent, trust fields). If we screened
-- NEW.bio on every UPDATE, a user with a grandfathered bio that predates this
-- trigger (and happens to contain a number) would be locked out of ALL profile
-- edits. So we only screen bio on INSERT or when bio actually changes.
--
-- Idempotent (CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER).
-- ============================================

CREATE OR REPLACE FUNCTION public.trg_moderate_profiles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result text;
BEGIN
  -- Only screen when bio is being set (INSERT) or changed (UPDATE). An
  -- unchanged bio never blocks an unrelated profile edit.
  IF TG_OP = 'UPDATE' AND NEW.bio IS NOT DISTINCT FROM OLD.bio THEN
    RETURN NEW;
  END IF;

  result := public.content_moderation_check(NEW.bio);
  IF result IS NOT NULL THEN
    -- Same 'moderation_block:<category>' shape the client's
    -- friendlyErrorMessage() already localizes (utils/index.ts).
    RAISE EXCEPTION 'moderation_block:%', result;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS moderate_profiles ON public.profiles;
CREATE TRIGGER moderate_profiles
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_moderate_profiles();

-- --------------------------------------------
-- Verification (run after apply):
--   -- (1) should raise 'moderation_block:contact_info':
--   UPDATE public.profiles SET bio = 'wechat: scammer123' WHERE id = auth.uid();
--   -- (2) should raise 'moderation_block:contact_info':
--   UPDATE public.profiles SET bio = 'call me 13912345678' WHERE id = auth.uid();
--   -- (3) should SUCCEED (bio unchanged, only nickname edited) even if the
--   --     existing bio contains a number:
--   UPDATE public.profiles SET nickname = 'NewName' WHERE id = auth.uid();
--   -- (4) should SUCCEED (clean bio):
--   UPDATE public.profiles SET bio = 'CS senior, love thrifting' WHERE id = auth.uid();
-- --------------------------------------------
