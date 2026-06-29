-- 073_admin_takedown_content.sql
--
-- gaps-1 from the 2026-06-29 admin review: give the admin a per-content
-- takedown. Before this, banning never removed the offending content and there
-- was no single-item takedown at all (only L3+ which nukes the author's whole
-- catalog). The most common marketplace action — "pull THIS scam listing" —
-- was impossible.
--
-- Design: reuse the EXISTING status soft-hide so there is NO change to the live
-- read path or RLS (getting that wrong would break all browsing):
--   · items  — RLS is `status != 'deleted'` and the client filters
--               status='active'; setting status='deleted' hides it everywhere.
--   · posts  — RLS is `status = 'active'` and 'hidden' is already a valid
--               status value; setting status='hidden' hides it everywhere.
--   · comments — RLS is `USING (true)` with no status column, so a takedown
--               there needs a schema + RLS change; deferred to a follow-up.
--
-- Restorable: an item/post can be re-activated (status='active') later. The
-- audit row (written by the edge function, like ban/lift) records who/what/why.

-- Allow the new audit event kind (column CHECK from 031; PG auto-named it
-- admin_audit_log_event_kind_check).
ALTER TABLE public.admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_event_kind_check;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_event_kind_check
  CHECK (event_kind IN (
    'ban_applied',
    'suspension_lifted',
    'report_status_changed',
    'actor_blocked',
    'admin_login',
    'admin_unauthorized',
    'content_takedown'
  ));

-- Service-role-only takedown RPC (same authz posture as every other admin RPC:
-- SECURITY DEFINER, EXECUTE granted ONLY to service_role; the edge function is
-- the sole caller). Returns how many rows it changed so a no-op (already hidden
-- / wrong id) is visible to the caller.
CREATE OR REPLACE FUNCTION public.admin_takedown_content(
  target_type_in text,
  target_id_in   uuid,
  reason_in      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected int := 0;
BEGIN
  IF target_type_in = 'item' THEN
    UPDATE public.items SET status = 'deleted'
     WHERE id = target_id_in AND status <> 'deleted';
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSIF target_type_in = 'post' THEN
    UPDATE public.posts SET status = 'hidden'
     WHERE id = target_id_in AND status = 'active';
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'unsupported_target_type: %', target_type_in
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN jsonb_build_object('ok', true, 'affected', affected);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_takedown_content(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_takedown_content(text, uuid, text) TO service_role;
