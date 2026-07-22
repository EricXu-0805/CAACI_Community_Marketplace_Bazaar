-- LOCAL/ISOLATED POSTGRESQL ONLY. Minimal Supabase platform fixtures used to
-- replay the deal-attribution migration from a clean PostgreSQL cluster.

\set ON_ERROR_STOP on

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$roles$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  email text,
  encrypted_password text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  email_confirmed_at timestamptz
);

CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $function$
  SELECT NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid
$function$;

CREATE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $function$
  SELECT current_user::text
$function$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role()
  TO anon, authenticated, service_role;

CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false
);

CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner uuid,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (bucket_id, name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION storage.foldername(name text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.string_to_array(name, '/')
$function$;

GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects
  TO anon, authenticated, service_role;

DO $publication$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$publication$;

-- Run the selected historical migrations after this bootstrap, then apply the
-- following parity grants before PRECHECK_20260718_deal_attributed_ratings.sql:
--
--   GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
--   GRANT SELECT ON public.profiles, public.items, public.conversations,
--     public.offers, public.ratings, public.notifications TO anon, authenticated;
--   GRANT UPDATE (status) ON public.items TO authenticated;
--   GRANT INSERT (rater_id, ratee_id, item_id, stars, comment)
--     ON public.ratings TO authenticated;
