-- ============================================
-- 050 P0: lock down admin/moderation RPCs + RLS-bypassing views
-- ============================================
-- Found 2026-06-10 via Supabase security advisor + live probe with the
-- public anon key:
--
--   curl .../rest/v1/rpc/admin_dashboard_stats  (anon)  → HTTP 200 + real counts
--   curl .../rest/v1/rpc/admin_list_reports     (anon)  → HTTP 200
--
-- Every admin_*/apply_ban_level/lift_suspension/admin_update_report_status
-- function is SECURITY DEFINER with EXECUTE granted to anon + authenticated,
-- and NONE of them check the caller is an admin (auth.uid() is used only to
-- stamp "who did it" into the audit log). The anon key ships embedded in the
-- H5 client, so ANY visitor could:
--   · apply_ban_level(any_user, 5, '...')      — permanently ban / shadow-ban anyone
--   · lift_suspension(own_suspension, '...')   — lift their own ban
--   · admin_update_report_status(...)          — dismiss reports against themselves
--   · admin_list_reports() / admin_get_report_detail(...) — read every report
--     INCLUDING reporter identities (deanonymizes reporters → retaliation)
--
-- The legitimate admin surface is api/admin/index.js, which calls these RPCs
-- with the service_role key (bypasses GRANTs). Revoking anon+authenticated
-- does NOT touch service_role, so the admin dashboard keeps working.
--
-- No client code calls these RPCs directly (verified: admin page goes through
-- the edge function; the 9 client supabase.rpc() calls are all non-admin).
--
-- Also fixes 3 advisor ERRORs: items_visible/posts_visible/banners_live are
-- SECURITY DEFINER views that bypass RLS on their base tables. Their base
-- tables are publicly readable (items: status<>'deleted'; posts:
-- status='active'; banners: active+time-window), so flipping to
-- security_invoker is behavior-preserving and restores RLS enforcement.
--
-- And 5 advisor WARNs: functions with a role-mutable search_path get pinned.
-- ============================================

-- ---- 1. Revoke direct anon/authenticated access to admin/moderation RPCs ----
DO $$
DECLARE
  fn text;
  admin_fns text[] := ARRAY[
    'public.admin_dashboard_stats()',
    'public.admin_get_profile_suspensions(uuid)',
    'public.admin_get_report_detail(uuid)',
    'public.admin_get_suspension_detail(uuid)',
    'public.admin_list_appeals(integer, integer)',
    'public.admin_list_audit_log(integer, integer, text)',
    'public.admin_list_reports(integer, integer, text)',
    'public.admin_list_suspensions(integer, integer, boolean)',
    'public.admin_list_warnings(integer, integer)',
    'public.admin_update_report_status(uuid, text)',
    'public.apply_ban_level(uuid, smallint, text, text, integer)',
    'public.lift_suspension(uuid, text)',
    'public.record_audit(text, uuid, uuid, jsonb)'
  ];
BEGIN
  FOREACH fn IN ARRAY admin_fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', fn);
  END LOOP;
END $$;

-- ---- 2. Views: SECURITY DEFINER → security_invoker (respect RLS as caller) ----
ALTER VIEW public.items_visible  SET (security_invoker = on);
ALTER VIEW public.posts_visible  SET (security_invoker = on);
ALTER VIEW public.banners_live   SET (security_invoker = on);

-- ---- 3. Pin mutable search_path on flagged functions ----
ALTER FUNCTION public.get_last_messages(uuid[])         SET search_path = public;
ALTER FUNCTION public.generate_uid()                    SET search_path = public;
ALTER FUNCTION public.content_moderation_normalize(text) SET search_path = public;
ALTER FUNCTION public.update_updated_at()               SET search_path = public;
ALTER FUNCTION public.compute_trust_score(uuid)         SET search_path = public;

-- --------------------------------------------
-- Verification (run after apply):
--   -- anon must now be denied (was HTTP 200 before):
--   --   curl .../rest/v1/rpc/admin_dashboard_stats  → HTTP 401/403, code 42501
--   SELECT has_function_privilege('anon', 'public.apply_ban_level(uuid,smallint,text,text,integer)', 'EXECUTE');          -- false
--   SELECT has_function_privilege('authenticated', 'public.admin_list_reports(integer,integer,text)', 'EXECUTE');         -- false
--   SELECT has_function_privilege('service_role', 'public.apply_ban_level(uuid,smallint,text,text,integer)', 'EXECUTE');  -- true (edge fn keeps working)
--   -- client RPCs untouched:
--   SELECT has_function_privilege('authenticated', 'public.search_items_fuzzy(text[],item_category,item_condition,numeric,numeric,uuid,integer,integer)', 'EXECUTE'); -- true
--   SELECT (SELECT reloptions FROM pg_class WHERE relname='items_visible');  -- {security_invoker=on}
-- --------------------------------------------
