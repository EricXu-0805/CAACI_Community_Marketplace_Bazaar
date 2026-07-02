-- 083_admin_plaza_controls.sql
--
-- QA8 #7 (admin half): the plaza's pin + banner levers existed in the schema
-- but had no admin write path — posts.is_pinned (m010) is service_role-only
-- and the feed already orders pinned-first; banners/banners_live (m023) are
-- rendered by PlazaBannerCarousel but could only be edited via the Supabase
-- dashboard. This adds the read RPC the console needs plus the audit kinds
-- and the storage bucket for banner image uploads. The WRITES themselves go
-- through the admin edge function with the service key (same posture as
-- revoke_token: no RPC needed where PostgREST + service_role suffices).

-- ---------- admin_list_plaza_posts ----------
-- Recent active posts for the console's pin manager: author + counts +
-- pinned/official flags + first image as thumbnail.
CREATE OR REPLACE FUNCTION public.admin_list_plaza_posts(
  limit_in  integer DEFAULT 50,
  offset_in integer DEFAULT 0
)
RETURNS TABLE (
  id              uuid,
  content         text,
  author_nickname text,
  author_id       uuid,
  is_pinned       boolean,
  is_official     boolean,
  like_count      integer,
  comment_count   integer,
  thumbnail       text,
  created_at      timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.id,
    left(p.content, 140),
    pr.nickname,
    p.user_id,
    p.is_pinned,
    p.is_official,
    p.like_count,
    p.comment_count,
    p.images[1],
    p.created_at
  FROM public.posts p
  JOIN public.profiles pr ON pr.id = p.user_id
  WHERE p.status = 'active'
  ORDER BY p.is_pinned DESC, p.created_at DESC
  LIMIT GREATEST(1, LEAST(limit_in, 200))
  OFFSET GREATEST(0, offset_in);
$$;

REVOKE ALL ON FUNCTION public.admin_list_plaza_posts(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_list_plaza_posts(integer, integer) TO service_role;

-- ---------- audit event kinds ----------
-- PG-named CHECK from 031; last extended in 079. Re-assert verbatim + the
-- two new kinds the plaza actions record.
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
    'token_revoked',
    'post_pin_changed',
    'banner_changed'
  ));

-- ---------- banner image bucket ----------
-- Public-read bucket for banner images uploaded from the admin console.
-- Deliberately NO storage.objects policies for anon/authenticated: the only
-- writer is the admin edge function using the service key (bypasses RLS), so
-- the client-side attack surface stays zero. Public read happens via the
-- /storage/v1/object/public/banners/... CDN path, which needs public=true on
-- the bucket, not a SELECT policy.
INSERT INTO storage.buckets (id, name, public)
VALUES ('banners', 'banners', true)
ON CONFLICT (id) DO NOTHING;
