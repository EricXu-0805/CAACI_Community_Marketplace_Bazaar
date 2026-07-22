-- LOCAL/ISOLATED POSTGRESQL ONLY.
--
-- The official Supabase PostgreSQL image creates Auth roles/functions and the
-- Storage schema, but a standalone container does not run the separate
-- Storage service migrations that create buckets/objects.  This minimal
-- fixture supplies only that managed surface so the repository can be replayed
-- from 001 in a clean official PG17 container.  Never deploy this file to a
-- hosted Supabase project.
--
-- Fail-closed invocation contract: in the SAME disposable psql session, set
-- the explicit marker below before including this file:
--   SET caaci.local_bootstrap = '20260722-disposable-pg17';
-- The marker is deliberately session-local operational intent, not an
-- environment heuristic.  Hosted Supabase also has the standard API roles, so
-- checking those roles alone cannot distinguish a disposable replay database.

\set ON_ERROR_STOP on

DO $roles$
BEGIN
  IF pg_catalog.current_setting('caaci.local_bootstrap', true)
       IS DISTINCT FROM '20260722-disposable-pg17' THEN
    RAISE EXCEPTION 'local bootstrap requires explicit disposable-session marker'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regrole('anon') IS NULL
     OR pg_catalog.to_regrole('authenticated') IS NULL
     OR pg_catalog.to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'local bootstrap requires Supabase API roles';
  END IF;
END;
$roles$;

-- GoTrue owns this table in hosted Supabase.  The standalone database image
-- has the base table but omits a service-managed compatibility column used by
-- historical migration 009.
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner uuid,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (bucket_id, name)
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.string_to_array(name, '/')
$function$;

-- Run this fixture as the standalone image's `supabase_admin` bootstrap role,
-- then hand the historical surface to `postgres`.  Early repository migrations
-- predate Storage's hosted owner split and legitimately create policies on
-- these relations as `postgres`; later migrations explicitly model the hosted
-- owner boundary where relevant.
ALTER TABLE storage.buckets OWNER TO postgres;
ALTER TABLE storage.objects OWNER TO postgres;
ALTER FUNCTION storage.foldername(text) OWNER TO postgres;

GRANT USAGE ON SCHEMA storage TO postgres, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.foldername(text)
  TO anon, authenticated, service_role;
