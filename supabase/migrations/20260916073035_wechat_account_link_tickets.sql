-- Existing website account -> verified WeChat identity. No account merge and
-- no password transfer. Only the server may access tickets or call these RPCs.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE private.wechat_link_requests (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  app_id text NOT NULL,
  code_hash text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  pending_openid text,
  pending_unionid text,
  proof_hash text CHECK (proof_hash IS NULL OR proof_hash ~ '^[0-9a-f]{64}$'),
  consumed_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes')
);
CREATE INDEX wechat_link_requests_expiry ON private.wechat_link_requests(expires_at);
ALTER TABLE private.wechat_link_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.wechat_link_requests FROM PUBLIC, anon, authenticated, service_role;

-- A valid access JWT alone survives sign-out until it expires. Linking a new
-- login method additionally requires a live, matching Auth session and a real
-- confirmed mailbox. Deleted, deleting and suspended accounts cannot link.
CREATE FUNCTION private.wechat_link_account_eligible(user_id_in uuid, session_id_in uuid, require_recent boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    JOIN auth.sessions s ON s.user_id = u.id
    JOIN public.profiles p ON p.id = u.id
    WHERE u.id = user_id_in AND s.id = session_id_in
      AND u.deleted_at IS NULL AND u.email_confirmed_at IS NOT NULL
      AND u.email IS NOT NULL AND u.email NOT ILIKE '%@wechat.placeholder'
      AND (u.banned_until IS NULL OR u.banned_until <= now())
      AND (s.not_after IS NULL OR s.not_after > now())
      AND (NOT require_recent OR s.created_at >= now() - interval '30 minutes')
      AND NOT (coalesce(p.suspension_level, 0) >= 2
        AND (p.suspended_until IS NULL OR p.suspended_until > now()))
      AND NOT EXISTS (SELECT 1 FROM public.account_deletion_jobs d WHERE d.user_id = u.id)
      -- A custom provider must not silently downgrade an enrolled MFA account.
      AND NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=u.id AND f.status='verified')
  )
$$;
REVOKE ALL ON FUNCTION private.wechat_link_account_eligible(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.wechat_link_issue(user_id_in uuid, session_id_in uuid, code_hash_in text, app_id_in text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE stamp timestamptz := clock_timestamp();
BEGIN
  IF code_hash_in IS NULL OR code_hash_in !~ '^[0-9a-f]{64}$'
     OR app_id_in IS NULL OR app_id_in !~ '^wx[A-Za-z0-9_-]{4,64}$' THEN
    RETURN jsonb_build_object('error','invalid_request');
  END IF;
  IF NOT private.wechat_link_account_eligible(user_id_in,session_id_in,true) THEN
    RETURN jsonb_build_object('error','reauth_required');
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id=user_id_in AND wechat_openid IS NOT NULL) THEN
    RETURN jsonb_build_object('error','already_linked');
  END IF;
  INSERT INTO private.wechat_link_requests(user_id,session_id,app_id,code_hash,created_at,expires_at)
    VALUES(user_id_in,session_id_in,app_id_in,code_hash_in,stamp,stamp+interval '5 minutes')
    ON CONFLICT(user_id) DO UPDATE SET session_id=excluded.session_id,app_id=excluded.app_id,
      code_hash=excluded.code_hash,created_at=excluded.created_at,expires_at=excluded.expires_at,
      pending_openid=NULL,pending_unionid=NULL,proof_hash=NULL,consumed_at=NULL;
  RETURN jsonb_build_object('expires_at',stamp+interval '5 minutes');
END $$;

-- The phone first displays the destination account. Its random confirmation
-- proof is kept only in memory, so entering a code never silently links an
-- identity. Both preview and confirmation require a fresh provider exchange.
CREATE FUNCTION public.wechat_link_preview(code_hash_in text, app_id_in text, openid_in text, unionid_in text, proof_hash_in text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ticket private.wechat_link_requests%ROWTYPE; profile public.profiles%ROWTYPE; email_label text;
BEGIN
  IF openid_in IS NULL OR openid_in !~ '^[A-Za-z0-9_-]{4,128}$'
    OR (unionid_in IS NOT NULL AND unionid_in !~ '^[A-Za-z0-9_-]{4,128}$')
    OR proof_hash_in IS NULL OR proof_hash_in !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('error','invalid_request');
  END IF;
  SELECT * INTO ticket FROM private.wechat_link_requests
    WHERE code_hash=code_hash_in AND app_id=app_id_in FOR UPDATE;
  IF NOT FOUND OR ticket.consumed_at IS NOT NULL OR ticket.expires_at <= clock_timestamp()
    OR NOT private.wechat_link_account_eligible(ticket.user_id,ticket.session_id,false) THEN
    RETURN jsonb_build_object('error','link_expired');
  END IF;
  SELECT * INTO profile FROM public.profiles WHERE id=ticket.user_id;
  IF (profile.wechat_openid IS NOT NULL AND profile.wechat_openid <> openid_in)
    OR (unionid_in IS NOT NULL AND profile.wechat_unionid IS NOT NULL AND profile.wechat_unionid <> unionid_in)
    OR EXISTS(SELECT 1 FROM public.profiles WHERE wechat_openid=openid_in AND id<>ticket.user_id) THEN
    RETURN jsonb_build_object('error','link_conflict');
  END IF;
  IF ticket.pending_openid IS NOT NULL AND ticket.pending_openid <> openid_in THEN
    RETURN jsonb_build_object('error','link_expired');
  END IF;
  UPDATE private.wechat_link_requests SET pending_openid=openid_in,pending_unionid=unionid_in,proof_hash=proof_hash_in
    WHERE user_id=ticket.user_id;
  SELECT left(email,1)||'***@'||split_part(email,'@',2) INTO email_label FROM auth.users WHERE id=ticket.user_id;
  RETURN jsonb_build_object('nickname',coalesce(profile.nickname,''),'email_label',email_label,'expires_at',ticket.expires_at);
END $$;

CREATE FUNCTION public.wechat_link_confirm(code_hash_in text, app_id_in text, openid_in text, unionid_in text, proof_hash_in text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ticket private.wechat_link_requests%ROWTYPE; linked_id uuid;
BEGIN
  IF openid_in IS NULL OR openid_in !~ '^[A-Za-z0-9_-]{4,128}$'
    OR (unionid_in IS NOT NULL AND unionid_in !~ '^[A-Za-z0-9_-]{4,128}$')
    OR proof_hash_in IS NULL OR proof_hash_in !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('error','invalid_request');
  END IF;
  SELECT * INTO ticket FROM private.wechat_link_requests
    WHERE code_hash=code_hash_in AND app_id=app_id_in FOR UPDATE;
  IF NOT FOUND OR ticket.consumed_at IS NOT NULL OR ticket.expires_at <= clock_timestamp()
    OR ticket.pending_openid IS DISTINCT FROM openid_in OR ticket.pending_openid IS NULL
    OR ticket.proof_hash IS DISTINCT FROM proof_hash_in OR ticket.proof_hash IS NULL
    OR (unionid_in IS NOT NULL AND ticket.pending_unionid IS NOT NULL AND unionid_in <> ticket.pending_unionid)
    OR NOT private.wechat_link_account_eligible(ticket.user_id,ticket.session_id,false) THEN
    RETURN jsonb_build_object('error','link_expired');
  END IF;
  BEGIN
    UPDATE public.profiles SET wechat_openid=openid_in,
      wechat_unionid=coalesce(wechat_unionid,ticket.pending_unionid,unionid_in)
      WHERE id=ticket.user_id
        AND (wechat_openid IS NULL OR wechat_openid=openid_in)
        AND (wechat_unionid IS NULL OR coalesce(ticket.pending_unionid,unionid_in) IS NULL
          OR wechat_unionid=coalesce(ticket.pending_unionid,unionid_in))
      RETURNING id INTO linked_id;
    IF linked_id IS NULL THEN RETURN jsonb_build_object('error','link_conflict'); END IF;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('error','link_conflict');
  END;
  UPDATE private.wechat_link_requests SET consumed_at=clock_timestamp(),proof_hash=NULL,
    pending_openid=NULL,pending_unionid=NULL WHERE user_id=ticket.user_id;
  RETURN jsonb_build_object('user_id',linked_id);
END $$;

REVOKE ALL ON FUNCTION public.wechat_link_issue(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.wechat_link_preview(text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.wechat_link_confirm(text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wechat_link_issue(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wechat_link_preview(text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wechat_link_confirm(text,text,text,text,text) TO service_role;
-- Hourly operational retention only removes expired tickets, never accounts.
CREATE FUNCTION public.prune_wechat_link_requests()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE removed integer;
BEGIN
  WITH expired AS (
    SELECT user_id FROM private.wechat_link_requests
    WHERE expires_at <= clock_timestamp()
    ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED
  ) DELETE FROM private.wechat_link_requests r USING expired e WHERE r.user_id=e.user_id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN jsonb_build_object('deleted',removed,'has_more',EXISTS(
    SELECT 1 FROM private.wechat_link_requests WHERE expires_at <= clock_timestamp()
  ));
END $$;
REVOKE ALL ON FUNCTION public.prune_wechat_link_requests() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prune_wechat_link_requests() TO service_role;
COMMIT;
