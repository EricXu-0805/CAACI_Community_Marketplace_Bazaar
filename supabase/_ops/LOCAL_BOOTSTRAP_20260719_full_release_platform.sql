-- LOCAL/ISOLATED POSTGRESQL ONLY.
-- Managed Supabase parity surface needed for a full 001-089 + candidate replay.
-- Hosted Supabase already owns these columns/helpers/grants; never deploy this.

\set ON_ERROR_STOP on

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $function$
  SELECT COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  )
$function$;

GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;

ALTER TABLE storage.buckets
  ADD COLUMN IF NOT EXISTS file_size_limit bigint,
  ADD COLUMN IF NOT EXISTS allowed_mime_types text[];

ALTER TABLE storage.objects
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT pg_catalog.now();

GRANT USAGE ON SCHEMA public, storage TO anon, authenticated, service_role;
GRANT SELECT ON public.profiles, public.items, public.conversations,
  public.messages, public.offers, public.meetups, public.ratings, public.notifications,
  public.posts, public.post_comments, public.reports TO authenticated;
GRANT SELECT ON public.profiles, public.items, public.posts,
  public.post_comments TO anon;
GRANT INSERT ON public.reports TO authenticated;
GRANT UPDATE (status) ON public.items TO authenticated;
GRANT INSERT (rater_id, ratee_id, item_id, stars, comment)
  ON public.ratings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO service_role;
