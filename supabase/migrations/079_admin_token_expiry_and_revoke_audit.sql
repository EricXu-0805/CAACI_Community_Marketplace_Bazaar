-- 079_admin_token_expiry_and_revoke_audit.sql
--
-- ADM-SEC-02 + ADM-SEC-03 from the 2026-06-29 admin review.
--
-- ADM-SEC-02: admin tokens had no expiry — a stolen/leaked token was valid
-- forever. Add an optional per-token expires_at and enforce it in the validate
-- hot path. NULL = never expires, so every existing token is unaffected
-- (backward-safe); the mint script now stamps a default expiry on new tokens.
--
-- ADM-SEC-03: revoke_token wrote no audit row, so an admin could silently
-- revoke any other admin's token in the flat-trust model. Allow a
-- 'token_revoked' audit event so the edge function can record who revoked which
-- token (the edge change is in api/admin/index.js).

-- ADM-SEC-02 ----------------------------------------------------------------
ALTER TABLE public.admin_tokens
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Return type is unchanged, so a plain CREATE OR REPLACE is fine. Only the
-- WHERE clause gains the expiry guard.
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
     AND (t.expires_at IS NULL OR t.expires_at > now())
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

REVOKE ALL ON FUNCTION public.admin_token_validate(TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_token_validate(TEXT) TO service_role;

-- ADM-SEC-03 ----------------------------------------------------------------
-- Allow the new audit event kind (PG-named CHECK from 031, last extended in 073).
ALTER TABLE public.admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_event_kind_check;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_event_kind_check
  CHECK (event_kind IN (
    'ban_applied',
    'suspension_lifted',
    'report_status_changed',
    'actor_blocked',
    'admin_login',
    'admin_unauthorized',
    'content_takedown',
    'token_revoked'
  ));
