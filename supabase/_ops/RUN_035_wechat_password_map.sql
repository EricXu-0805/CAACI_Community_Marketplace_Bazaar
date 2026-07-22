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
-- RUN 035: wechat_password_map (per-user rotatable WeChat passwords)
-- =========================================================
-- Historical instructions below are retained for incident archaeology only.
--
-- Replaces the WECHAT_USER_PASSWORD_SALT-derived HMAC password
-- scheme (single-secret, un-rotatable) with a per-user random
-- password row stored in this table.
--
-- After applying:
--   1. New WeChat logins generate a 256-bit random password,
--      sync it onto auth.users, and persist here.
--   2. Existing WeChat users continue to log in via the legacy
--      HMAC fallback in /api/auth/wechat-login until they next
--      sign in, at which point they migrate automatically.
--   3. Once your active-user tail has migrated (check via
--      `SELECT count(*) FROM wechat_password_map`), you can
--      delete the WECHAT_USER_PASSWORD_SALT env var on Vercel.
--
-- Re-running is a safe no-op (CREATE TABLE IF NOT EXISTS +
-- CREATE OR REPLACE FUNCTION on every object).
--
-- See supabase/migrations/035_wechat_password_map.sql for the
-- full architectural comment.
-- =========================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.wechat_password_map (
  openid       TEXT PRIMARY KEY CHECK (length(openid) BETWEEN 4 AND 128),
  password     TEXT NOT NULL    CHECK (length(password) BETWEEN 32 AND 256),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  rotated_at   TIMESTAMPTZ
);

ALTER TABLE public.wechat_password_map ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wechat_password_map FROM PUBLIC;
REVOKE ALL ON public.wechat_password_map FROM anon, authenticated;
GRANT  SELECT, INSERT, UPDATE ON public.wechat_password_map TO service_role;

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

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =========================================================
-- Verification (after running):
--   SELECT * FROM public.wechat_password_map LIMIT 1;
--   -- Expect: 0 rows (table is empty until first WeChat login).
--   SELECT proname FROM pg_proc WHERE proname IN
--     ('wechat_password_lookup', 'wechat_password_store');
--   -- Expect: 2 rows.
-- =========================================================
-- =========================================================
