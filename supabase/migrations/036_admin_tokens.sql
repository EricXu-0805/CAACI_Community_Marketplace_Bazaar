-- ============================================
-- 036 admin_tokens — per-admin bearer tokens with audit identity
-- ============================================
--
-- Background
-- ----------
-- Pre-036, /api/admin/* gated on a single shared ADMIN_API_KEY env
-- var. Every admin used the same string. Consequences:
--
--   1. No identity in audit log. The admin_audit_log.actor_id column
--      held NULL for every action because there was no auth context
--      tying a request back to a specific admin profile. Reviewing
--      "who lifted this suspension" was guesswork.
--
--   2. Un-revokable. Rotating the shared key locked out every admin
--      simultaneously and required re-distributing the new value to
--      every admin browser via env-var change + redeploy.
--
--   3. No trace. A leaked key gave the attacker full admin access
--      with zero attribution; we couldn't even tell *which* admin's
--      browser or device leaked it.
--
-- The fix
-- -------
-- This migration introduces public.admin_tokens, where each admin
-- gets a personal bearer token. The token is a 256-bit random string;
-- only its SHA-256 hash is stored in the DB. The admin keeps the
-- plaintext in their browser localStorage (same UX as before — the
-- existing dashboard prompt now expects the personal token instead
-- of the shared key).
--
-- The /api/admin edge function:
--   1. Reads the bearer header
--   2. SHA-256 hashes it
--   3. Looks up admin_tokens.token_hash → admin_id, admin_name
--   4. If found and not revoked, lets the request through; bumps
--      last_used_at; passes admin_id into every audit_log entry
--      (writeable now because actor_id finally has a value)
--
-- Schema
-- ------
-- id            UUID surrogate PK
-- token_hash    SHA-256 hex of the plaintext token (64 chars). UNIQUE.
--               We never store plaintext — anyone who SELECTs the row
--               sees only the hash. Token recovery on lost device
--               requires minting a new one via scripts/admin-token-mint.ts
--               and revoking the old.
-- admin_id      profiles.id of the admin (FK CASCADE). Used as
--               actor_id in admin_audit_log.
-- admin_name    Cached display name at issue time. We don't JOIN to
--               profiles in the hot path because audit-log writes
--               can survive after the admin's profile row is deleted
--               (CASCADE is a hard constraint we MIGHT relax later).
-- admin_email   Cached email at issue time. Operational convenience
--               for `SELECT admin_email FROM admin_tokens WHERE id=…`
--               when revoking compromised tokens.
-- created_at    Issue time.
-- last_used_at  Updated on every successful auth check. Stale entries
--               can be safely revoked.
-- revoked_at    NULL for active tokens. Set to now() when revoking;
--               rows are kept (not deleted) so we retain the historical
--               audit_log → admin_id linkage.
-- created_by    Optional: which admin (or NULL for service_role)
--               minted this token. Mainly so future minting tools
--               can record "admin X granted access to admin Y" if we
--               ever build that flow.
--
-- Plaintext token format
-- ----------------------
-- 32 random bytes, base64url-encoded → ~43 chars. Prefixed with
-- "iam_admin_" so accidental git commits get caught by secret scanners
-- (the 12-char prefix is high-entropy enough for GitHub's secret
-- scanning without being so distinctive that an attacker can grep
-- for it on GitHub easily). Stored on the admin's browser only;
-- never on the server. Hash with SHA-256 (NOT bcrypt) so the edge
-- function can do constant-time hash compare without expensive KDF
-- on every request — bearer tokens are single-use random strings,
-- not user-chosen passwords, so the bcrypt threat model doesn't
-- apply.
--
-- Security mitigations
-- --------------------
-- · RLS deny-all (no policies). service_role-only access via REST/RPC.
-- · Hash-not-plaintext: a DB dump exposes only hashes; the attacker
--   would need to brute-force SHA-256 of a 32-byte random preimage
--   to recover plaintext. Computationally infeasible.
-- · Per-admin revocation: revoke a token by setting revoked_at; their
--   audit_log identity is preserved for historical lookups.
-- · No fallback to shared key. Once admin_tokens has at least one
--   active row, /api/admin rejects the legacy ADMIN_API_KEY format.
--   Migration window: keep shared key working until first per-admin
--   token is minted, then rotate-out the env var.
--
-- Rollback
-- --------
-- DROP TABLE public.admin_tokens CASCADE;
-- DROP FUNCTION public.admin_token_validate(text);
-- (Then revert api/admin/index.js to the pre-036 commit, which still
-- supports the shared ADMIN_API_KEY env var.)
-- ============================================

CREATE TABLE IF NOT EXISTS public.admin_tokens (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_hash    TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  admin_id      UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  admin_name    TEXT NOT NULL CHECK (length(admin_name) BETWEEN 1 AND 100),
  admin_email   TEXT NOT NULL CHECK (length(admin_email) BETWEEN 3 AND 200),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_tokens_active
  ON public.admin_tokens (token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_admin_tokens_admin_id
  ON public.admin_tokens (admin_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.admin_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.admin_tokens FROM PUBLIC;
REVOKE ALL ON public.admin_tokens FROM anon, authenticated;
GRANT  SELECT, INSERT, UPDATE ON public.admin_tokens TO service_role;

-- ---------- RPC: admin_token_validate ----------
-- Edge function calls this with the SHA-256 hash of the bearer
-- token from the request header. On match, returns admin_id +
-- admin_name and bumps last_used_at. On miss / revoked, returns
-- a single row with NULL admin_id (caller must reject).
-- Returning a row instead of throwing keeps the edge code simple:
-- no PG-error-string parsing, just a NULL check.

CREATE OR REPLACE FUNCTION public.admin_token_validate(p_token_hash TEXT)
RETURNS TABLE (
  admin_id    UUID,
  admin_name  TEXT,
  admin_email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    UUID;
  v_name  TEXT;
  v_email TEXT;
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  SELECT t.admin_id, t.admin_name, t.admin_email
    INTO v_id, v_name, v_email
    FROM public.admin_tokens t
   WHERE t.token_hash = p_token_hash
     AND t.revoked_at IS NULL
   LIMIT 1;

  IF v_name IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  UPDATE public.admin_tokens
     SET last_used_at = now()
   WHERE token_hash = p_token_hash;

  RETURN QUERY SELECT v_id, v_name, v_email;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_token_validate(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_token_validate(TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_token_validate(TEXT) TO service_role;

COMMENT ON FUNCTION public.admin_token_validate(TEXT) IS
  'Service-role only. Looks up an admin token by SHA-256 hash.
   Returns (admin_id, admin_name, admin_email) on match, or a row
   of NULLs on miss / revoked. Bumps last_used_at on success.
   Called by /api/admin checkAuth.';

-- ---------- RPC: admin_token_list (for admin tooling) ----------
-- Returns all tokens (active + revoked) for inventory + revoke UI.
-- Token hashes are returned but the plaintext is unrecoverable —
-- this is purely for "show me the active sessions" type displays.

CREATE OR REPLACE FUNCTION public.admin_token_list()
RETURNS TABLE (
  id            UUID,
  admin_name    TEXT,
  admin_email   TEXT,
  created_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, admin_name, admin_email, created_at, last_used_at, revoked_at
    FROM public.admin_tokens
   ORDER BY revoked_at NULLS FIRST, created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_token_list() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_token_list() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_token_list() TO service_role;

NOTIFY pgrst, 'reload schema';
