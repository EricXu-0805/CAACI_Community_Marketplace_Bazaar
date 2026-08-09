-- LOCAL/ISOLATED POSTGRESQL ONLY.
-- Minimal Supabase-compatible surface for replaying the predecessor and the
-- 20260808040313 fingerprint migration on disposable PostgreSQL 16/17.
-- Never run this file against a hosted project.

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF pg_catalog.current_setting('caaci.local_bootstrap', true)
       IS DISTINCT FROM '20260808040313-disposable-fingerprint' THEN
    RAISE EXCEPTION
      'local bootstrap requires the explicit disposable fingerprint marker'
      USING ERRCODE = '55000';
  END IF;
END;
$guard$;

DO $roles$
BEGIN
  IF pg_catalog.to_regrole('anon') IS NULL THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF pg_catalog.to_regrole('authenticated') IS NULL THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF pg_catalog.to_regrole('service_role') IS NULL THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END;
$roles$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS supabase_migrations;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE auth.sessions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $function$
  SELECT NULLIF(
    pg_catalog.current_setting('request.jwt.claim.sub', true),
    ''
  )::uuid
$function$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname text,
  last_fp_hash text,
  last_fp_seen_at timestamptz,
  suspension_level smallint NOT NULL DEFAULT 0,
  suspended_until timestamptz,
  shadow_banned boolean NOT NULL DEFAULT false,
  warning_count integer NOT NULL DEFAULT 0,
  trust_score smallint NOT NULL DEFAULT 50
);

-- Mirror the hosted AFTER INSERT profile trigger closely enough that the
-- runtime regression cannot pass only because its local auth.users surface is
-- easier than staging. The regression must tolerate the profile already
-- existing after each synthetic Auth user is inserted.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  INSERT INTO public.profiles (id, nickname)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'nickname', ''),
      NULLIF(pg_catalog.split_part(NEW.email, '@', 1), ''),
      'Illini User'
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END
$function$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.device_fingerprints (
  id bigserial PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fp_hash text NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT pg_catalog.now(),
  last_seen timestamptz NOT NULL DEFAULT pg_catalog.now(),
  seen_count integer NOT NULL DEFAULT 1,
  ua_snippet text,
  UNIQUE (profile_id, fp_hash)
);

ALTER TABLE public.device_fingerprints ENABLE ROW LEVEL SECURITY;
CREATE POLICY dfp_self_read
  ON public.device_fingerprints
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = profile_id);

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.device_fingerprints TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_fingerprints
  TO service_role;

CREATE TABLE public.suspensions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  level smallint NOT NULL,
  reason text NOT NULL,
  category text NOT NULL,
  issued_by uuid,
  ends_at timestamptz
);

CREATE TABLE public.admin_audit_log (
  id bigserial PRIMARY KEY,
  event_kind text NOT NULL,
  actor_id uuid,
  target_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION public.recompute_trust_score(profile_id_in uuid)
RETURNS smallint
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT COALESCE(
    (
      SELECT profile.trust_score
        FROM public.profiles AS profile
       WHERE profile.id = profile_id_in
    ),
    50::smallint
  )
$function$;

CREATE OR REPLACE FUNCTION public.record_audit(
  event_kind_in text,
  actor_id_in uuid,
  target_id_in uuid,
  details_in jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  INSERT INTO public.admin_audit_log (
    event_kind,
    actor_id,
    target_id,
    details
  ) VALUES (
    event_kind_in,
    actor_id_in,
    target_id_in,
    COALESCE(details_in, '{}'::jsonb)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.recompute_trust_score(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_audit(text, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_audit(text, uuid, uuid, jsonb)
  TO service_role;

CREATE TABLE supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[],
  name text
);

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES (
  '20260801082650',
  'advance_privacy_consent_for_first_release_auth_matrix'
);

-- Install the exact reviewed predecessor rather than copying its function
-- body into this fixture. This makes the migration's predecessor hash check a
-- real forward-replay assertion.
\ir ../migrations/20260718130000_harden_device_fingerprint_signal.sql
