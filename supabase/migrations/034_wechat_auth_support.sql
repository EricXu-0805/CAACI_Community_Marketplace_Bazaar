-- ============================================
-- 034 WeChat mini-program auth support
-- ============================================
--
-- Background: the mp-weixin build is coming online (commit b345015).
-- On H5 users sign up with email + password. On mp they expect the
-- standard "一键登录" wx.login silent flow. That flow needs two
-- openid fields plus a server-side endpoint (/api/auth/wechat-login)
-- that holds AppSecret, exchanges js_code → openid, and mints a
-- Supabase-compatible JWT.
--
-- What this migration adds:
--
-- 1.  profiles.wechat_unionid TEXT UNIQUE
--     openid is per-mp-appid; unionid is stable across every app
--     owned by the same WeChat open-platform account. We don't need
--     it today (one app), but adding the column now means we won't
--     need a re-migration when someone later spins up the official
--     account / a second mini-program / etc.
--
--     wechat_openid already exists from migration 001 — untouched here.
--
-- 2.  public.upsert_wechat_user(openid text, unionid text, nickname text,
--                               avatar text) RETURNS uuid
--     A SECURITY DEFINER function the edge route calls once per login.
--     Encapsulates the "find existing profile by openid OR create one"
--     logic in a single statement so two concurrent wx.login calls
--     from the same openid can't race into a duplicate-key insert.
--
--     Returns the profile UUID, which the edge function then embeds
--     in the signed JWT under `sub`.
--
--     Runs as SECURITY DEFINER because it needs to write wechat_openid,
--     which is not in the column-level grants (same reasoning as the
--     hidden-field pattern established in migration 004).
--
--     Deliberately does NOT create the auth.users row. public schema
--     cannot touch auth.users at all — that requires the Supabase
--     admin API (service_role key). The edge function therefore
--     orchestrates the pair: admin.createUser first, then
--     upsert_wechat_user second. Do not refactor this into a single
--     RPC without understanding that constraint.
--
-- 3.  Index on wechat_unionid (UNIQUE implies one) — same as 001 did
--     for wechat_openid.
--
-- Column-level SELECT grants for the new column: we DO NOT add one.
-- wechat_unionid, like wechat_openid, is intentionally hidden from
-- anon/authenticated (per the 004 privacy model). The only readers
-- are SECURITY DEFINER RPCs and service_role in edge routes.
--
-- Rollback: all changes are additive, no data migration. To undo:
--   DROP FUNCTION public.upsert_wechat_user(text, text, text, text);
--   ALTER TABLE public.profiles DROP COLUMN wechat_unionid;

-- ---------- 1. wechat_unionid column ----------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS wechat_unionid TEXT UNIQUE;

-- ---------- 2. upsert_wechat_user RPC ----------

CREATE OR REPLACE FUNCTION public.upsert_wechat_user(
  p_openid   TEXT,
  p_unionid  TEXT,
  p_nickname TEXT,
  p_avatar   TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id UUID;
BEGIN
  IF p_openid IS NULL OR length(p_openid) < 4 THEN
    RAISE EXCEPTION 'invalid_openid' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_profile_id
  FROM public.profiles
  WHERE wechat_openid = p_openid
  LIMIT 1;

  IF v_profile_id IS NOT NULL THEN
    UPDATE public.profiles
    SET
      wechat_unionid = COALESCE(wechat_unionid, p_unionid),
      nickname = CASE
        WHEN nickname IS NULL OR nickname = '' OR nickname = '用户'
          THEN COALESCE(NULLIF(trim(p_nickname), ''), nickname)
        ELSE nickname
      END,
      avatar_url = CASE
        WHEN avatar_url IS NULL OR avatar_url = ''
          THEN COALESCE(NULLIF(trim(p_avatar), ''), avatar_url)
        ELSE avatar_url
      END,
      updated_at = NOW()
    WHERE id = v_profile_id;
    RETURN v_profile_id;
  END IF;

  RAISE EXCEPTION 'profile_not_found_for_openid' USING ERRCODE = 'P0002';
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_wechat_user(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_wechat_user(TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_wechat_user(TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.upsert_wechat_user(TEXT, TEXT, TEXT, TEXT) IS
  'Called by /api/auth/wechat-login AFTER admin.createUser has created
   auth.users + the trigger has populated profiles. Binds wechat_openid
   onto the profile row created by the trigger, fills missing nickname
   /avatar from the WeChat userInfo payload if the trigger defaulted
   them. Returns the profile uuid for JWT `sub`. SECURITY DEFINER + GRANT
   to service_role only; never callable from anon/authenticated since
   the caller is expected to hold the service_role key.';
