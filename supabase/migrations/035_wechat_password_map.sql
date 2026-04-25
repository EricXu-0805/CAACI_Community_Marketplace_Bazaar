-- ============================================
-- 035 wechat_password_map — per-user rotatable WeChat login passwords
-- ============================================
--
-- Background
-- ----------
-- Pre-035, /api/auth/wechat-login derived each WeChat user's GoTrue
-- password as `HMAC-SHA256(openid, WECHAT_USER_PASSWORD_SALT)` (see
-- migration 034 + the original wechat-login.js header). That worked,
-- but had three weaknesses:
--
--   1. Single-secret blast radius. A leaked SALT lets an attacker
--      compute every user's plaintext password from their openid.
--      Openids are not secret (they appear in profile rows visible
--      via column-level grants on `wechat_openid` and on every
--      relation that references profiles).
--
--   2. Un-rotatable. Rotating SALT invalidates EVERY existing user
--      simultaneously (all bcrypt hashes in auth.users were keyed
--      to the old derivation). There is no per-user remediation —
--      a single compromised user means we either keep the leak or
--      mass-logout every WeChat account.
--
--   3. Adminless. The edge function had no way to "rotate this one
--      user's password" because the password is a deterministic
--      function of openid; we'd have to change BOTH the SALT and
--      that user's openid (impossible — openid is assigned by
--      WeChat and cannot be re-issued).
--
-- The fix
-- -------
-- Store a per-user random password in this table. Generated once on
-- first login (32 bytes = 256 bits, hex-encoded), and used verbatim
-- as the GoTrue auth password from then on. Rotation = `DELETE FROM
-- wechat_password_map WHERE openid = $1` followed by the user's next
-- login (which will regenerate, call admin.updateUserById to swap the
-- bcrypt hash on auth.users, and insert a fresh row).
--
-- Schema
-- ------
-- openid       PK — same value used in profiles.wechat_openid
-- password     plaintext random hex (NOT a hash). Stored at rest in
--              postgres + replicated to backups. Mitigations:
--                · RLS deny-all (no policies, no GRANT to anon/auth)
--                · service_role-only access via REST/RPC
--                · Per-user randomness: a SQL injection or backup
--                  leak grants the attacker every user's password,
--                  but they STILL need the auth.users email mapping
--                  + the WeChat AppSecret to do anything useful with
--                  it (signInWithPassword needs both).
--                · Rotatable: cycle one user without touching others.
--              We don't bcrypt at this layer because GoTrue already
--              bcrypts on auth.users; double-hashing prevents us from
--              ever calling signInWithPassword(email, plaintext)
--              against GoTrue.
-- created_at   when the row was first inserted (audit only).
-- last_used_at updated by wechat_password_lookup() on every read so
--              we can spot dormant openids if needed.
-- rotated_at   updated by wechat_password_store() when an existing
--              row is overwritten (rotation event).
--
-- Migration semantics
-- -------------------
-- The edge function reads from this table via service_role REST. If
-- the SELECT returns a row, that password is used. If not, it falls
-- back to the HMAC-from-SALT path (kept as a transition for users
-- who logged in with the v1 mint and never re-logged after deploy)
-- and seeds a fresh random into this table for next time. The
-- transitional code branch is documented inline in wechat-login.js
-- and will be removed in a follow-up once the active-user tail has
-- migrated.
--
-- Rollback
-- --------
-- DROP TABLE public.wechat_password_map;
-- DROP FUNCTION public.wechat_password_lookup(text);
-- DROP FUNCTION public.wechat_password_store(text, text);
-- (Then revert wechat-login.js to the pre-035 commit.)
-- ============================================

CREATE TABLE IF NOT EXISTS public.wechat_password_map (
  openid       TEXT PRIMARY KEY CHECK (length(openid) BETWEEN 4 AND 128),
  password     TEXT NOT NULL    CHECK (length(password) BETWEEN 32 AND 256),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  rotated_at   TIMESTAMPTZ
);

-- RLS deny-all. service_role bypasses RLS, so the edge function still
-- reads/writes via REST + Bearer service_role.
ALTER TABLE public.wechat_password_map ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth: even if RLS were misconfigured, anon + authenticated
-- have no table-level grants, so PostgREST would return 401. The empty
-- policy set means a stolen anon key cannot read this table.
REVOKE ALL ON public.wechat_password_map FROM PUBLIC;
REVOKE ALL ON public.wechat_password_map FROM anon, authenticated;
GRANT  SELECT, INSERT, UPDATE ON public.wechat_password_map TO service_role;

-- ---------- RPCs ----------
-- The edge function uses raw REST today (the file is shared across
-- /api/auth/wechat-login + sibling routes that don't have a Supabase
-- client). Reading and writing this table directly via the table's
-- REST endpoint also works under service_role. We expose RPCs as a
-- convenience for any future caller (e.g. an admin tool that needs
-- to rotate a specific user's password without juggling REST verbs).

CREATE OR REPLACE FUNCTION public.wechat_password_lookup(p_openid TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pw TEXT;
BEGIN
  IF p_openid IS NULL OR length(p_openid) < 4 THEN
    RAISE EXCEPTION 'invalid_openid' USING ERRCODE = '22023';
  END IF;
  SELECT password INTO v_pw
    FROM public.wechat_password_map
   WHERE openid = p_openid;
  IF v_pw IS NOT NULL THEN
    UPDATE public.wechat_password_map
       SET last_used_at = now()
     WHERE openid = p_openid;
  END IF;
  RETURN v_pw;
END;
$$;

REVOKE ALL ON FUNCTION public.wechat_password_lookup(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wechat_password_lookup(TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.wechat_password_lookup(TEXT) TO service_role;

COMMENT ON FUNCTION public.wechat_password_lookup(TEXT) IS
  'Service-role only. Returns the stored auth password for an openid,
   or NULL if not yet seeded. Side-effect: bumps last_used_at so
   dormant openids stand out. Called by /api/auth/wechat-login.';


CREATE OR REPLACE FUNCTION public.wechat_password_store(
  p_openid   TEXT,
  p_password TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_openid IS NULL OR length(p_openid) < 4 THEN
    RAISE EXCEPTION 'invalid_openid' USING ERRCODE = '22023';
  END IF;
  IF p_password IS NULL OR length(p_password) < 32 THEN
    RAISE EXCEPTION 'invalid_password' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.wechat_password_map (openid, password)
  VALUES (p_openid, p_password)
  ON CONFLICT (openid) DO UPDATE
    SET password   = EXCLUDED.password,
        rotated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.wechat_password_store(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wechat_password_store(TEXT, TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.wechat_password_store(TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.wechat_password_store(TEXT, TEXT) IS
  'Service-role only. UPSERTs the auth password row for an openid.
   On conflict, sets rotated_at = now() so audits can spot rotation
   events. Called by /api/auth/wechat-login.';

NOTIFY pgrst, 'reload schema';
