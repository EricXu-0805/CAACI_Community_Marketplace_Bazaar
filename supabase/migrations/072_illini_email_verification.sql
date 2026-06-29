-- 072_illini_email_verification.sql
--
-- Real one-tap Illini verification for users who signed up with a NON-@illinois.edu
-- email. They prove control of a campus inbox by entering a 6-digit code that the
-- send-illini-code edge function emails (Resend) to that address; verify-illini-code
-- then sets is_illini_verified via the service role. The account's LOGIN email is
-- never changed. One campus email can verify at most one account (Eric's call).
--
-- handle_new_user (migration 004) still auto-verifies @illinois.edu signups; this is
-- only the fallback path for people who used a personal email.

-- ---------------------------------------------------------------------------
-- Pending verification codes. One active row per user (PK = user_id; the edge
-- function upserts, so re-sending replaces the prior code and resets attempts).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.illini_verifications (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code_hash    TEXT NOT NULL,            -- sha256(`${code}:${user_id}`); plaintext code never stored
  expires_at   TIMESTAMPTZ NOT NULL,
  attempts     INT NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Per-user daily send cap (the resend upsert carries these forward): blunts
  -- the "email a fresh code to a different @illinois.edu victim every 60s"
  -- abuse vector and, since each resend = a fresh code, also caps total
  -- brute-force guesses/day (cap × 5 attempts) on our shared sending domain.
  sent_today   INT NOT NULL DEFAULT 0,
  sent_date    DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only the service role (the edge functions) ever touches this table. Enable RLS
-- with NO policies so anon/authenticated get nothing; the service role bypasses RLS.
ALTER TABLE public.illini_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.illini_verifications FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Which campus email verified each profile (audit + the one-email-one-account
-- guarantee). Server-only: not in the column SELECT grant (PII — never sent to
-- clients) and not in ALLOWED_PROFILE_FIELDS (clients can't write it).
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verified_illini_email TEXT;

-- One @illinois.edu address verifies at most one account. Partial + lower() so
-- many NULLs coexist and the match is case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_verified_illini_email
  ON public.profiles (lower(verified_illini_email))
  WHERE verified_illini_email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Defense in depth: profiles has table-wide INSERT and UPDATE grants to
-- `authenticated`, so without this a client could PATCH is_illini_verified /
-- verified_illini_email on their own row — OR, in the (reachable) window where
-- handle_new_user silently skipped profile creation (its INSERT is wrapped in
-- EXCEPTION…RAISE WARNING, e.g. a moderation-tripping signup nickname), INSERT a
-- fresh row with the badge already set. Both forge the trust signal with no
-- emailed code. This trigger rejects either columns being set/changed by an
-- authenticated/anon caller, on BOTH INSERT and UPDATE. Runs SECURITY INVOKER
-- (default) so current_user is the REAL caller. handle_new_user (SECURITY
-- DEFINER → runs as the owner, not authenticated/anon) and the service-role
-- PATCH from verify-illini-code (current_user = service_role) are unaffected,
-- so legitimate @illinois.edu auto-verify and the real grant still succeed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_illini_verify_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.is_illini_verified IS TRUE OR NEW.verified_illini_email IS NOT NULL THEN
        RAISE EXCEPTION 'illini verification is server-managed and cannot be set by the client';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.is_illini_verified   IS DISTINCT FROM OLD.is_illini_verified
        OR NEW.verified_illini_email IS DISTINCT FROM OLD.verified_illini_email THEN
        RAISE EXCEPTION 'illini verification is server-managed and cannot be set by the client';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_illini_verify_columns ON public.profiles;
CREATE TRIGGER guard_illini_verify_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_illini_verify_columns();
