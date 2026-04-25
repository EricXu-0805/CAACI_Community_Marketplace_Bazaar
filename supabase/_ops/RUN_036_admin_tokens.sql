-- =========================================================
-- RUN 036: admin_tokens (per-admin bearer tokens)
-- =========================================================
-- Paste this ENTIRE file into Supabase SQL Editor and run ONCE.
--
-- Replaces the single shared ADMIN_API_KEY env var with per-admin
-- bearer tokens. Each admin gets their own token; SHA-256 hashes
-- are stored here, plaintext lives only in the admin's browser.
--
-- After applying:
--   1. Mint a token per admin via:
--        export SUPABASE_URL=https://<project>.supabase.co
--        export SUPABASE_SERVICE_ROLE_KEY=<service_role>
--        node scripts/admin-token-mint.mjs --name "Alice" \
--             --email "alice@example.edu" --apply
--      Save the printed plaintext (only shown once).
--   2. Each admin pastes their token into the dashboard's first-
--      visit prompt (replacing the old shared key).
--   3. After every admin has switched, delete the ADMIN_API_KEY env
--      var on Vercel. /api/admin will then reject any request that
--      doesn't match a row in this table.
--
-- During the rollout window, /api/admin accepts BOTH the new
-- per-admin tokens AND the legacy ADMIN_API_KEY shared key — so
-- there is no admin downtime even if some admins update browsers
-- before others.
--
-- Re-running is a safe no-op (CREATE TABLE IF NOT EXISTS +
-- CREATE OR REPLACE FUNCTION on every object).
-- =========================================================

BEGIN;

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

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =========================================================
-- Verification (after running):
--   SELECT count(*) FROM public.admin_tokens;
--   -- Expect: 0 (table is empty until you mint your first token).
--   SELECT proname FROM pg_proc WHERE proname IN
--     ('admin_token_validate', 'admin_token_list');
--   -- Expect: 2 rows.
-- =========================================================
