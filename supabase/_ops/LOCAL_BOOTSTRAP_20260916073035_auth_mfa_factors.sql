-- LOCAL L-SQL REPLAY ONLY (RUNBOOK §5.1). Never apply to a hosted project:
-- there Supabase Auth (GoTrue) creates and owns these objects.
--
-- Hosted surface: auth.mfa_factors. First read by 20260916073035
-- (f.user_id, f.status = 'verified').
--
-- Sources (supabase/auth v2.197.0 (4eee58f296d9698a1c2c0ae14d7a0b379c7622d3), migrations/):
--   types auth.factor_type ('totp', 'webauthn') and auth.factor_status
--   ('unverified', 'verified'); table auth.mfa_factors id, user_id,
--   friendly_name, factor_type, status, created_at, updated_at, secret,
--   primary key and FK to auth.users: 20221003041349_add_mfa_schema.up.sql

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF pg_catalog.current_setting('caaci.local_bootstrap', true)
       IS DISTINCT FROM 'lsql-replay' THEN
    RAISE EXCEPTION 'local L-SQL replay bootstrap only (set caaci.local_bootstrap = lsql-replay)'
      USING ERRCODE = '55000';
  END IF;
END;
$guard$;

DO $$ BEGIN
  CREATE TYPE auth.factor_type AS ENUM ('totp', 'webauthn');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE auth.factor_status AS ENUM ('unverified', 'verified');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS auth.mfa_factors (
  id uuid NOT NULL,
  user_id uuid NOT NULL,
  friendly_name text NULL,
  factor_type auth.factor_type NOT NULL,
  status auth.factor_status NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  secret text NULL,
  CONSTRAINT mfa_factors_pkey PRIMARY KEY (id),
  CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE
);
