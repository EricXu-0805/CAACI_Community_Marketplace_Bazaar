-- LOCAL/ISOLATED DATABASE ONLY.
-- Production-parity supplements needed by the compact migration-review base.

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

ALTER TABLE public.items
  ALTER COLUMN id SET DEFAULT public.uuid_generate_v4();
ALTER TABLE public.posts
  ALTER COLUMN id SET DEFAULT public.uuid_generate_v4();
ALTER TABLE public.post_comments
  ALTER COLUMN id SET DEFAULT public.uuid_generate_v4();
ALTER TABLE public.reports
  ALTER COLUMN id SET DEFAULT public.uuid_generate_v4();

CREATE TABLE IF NOT EXISTS public.favorites (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_item
  ON public.favorites (item_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user_item
  ON public.favorites (user_id, item_id);

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  event_kind text NOT NULL CHECK (event_kind IN (
    'ban_applied',
    'suspension_lifted',
    'report_status_changed',
    'actor_blocked',
    'admin_login',
    'admin_unauthorized',
    'content_takedown'
  )),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

DO $publication$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$publication$;
