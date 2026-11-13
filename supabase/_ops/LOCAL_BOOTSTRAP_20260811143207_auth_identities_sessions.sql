-- LOCAL L-SQL REPLAY ONLY (RUNBOOK §5.1). Never apply to a hosted project:
-- there Supabase Auth (GoTrue) creates and owns these tables.
--
-- Hosted surface: auth.identities and auth.sessions. First read by
-- 20260811143207 (its fresh-replay guard needs both to exist and be empty),
-- then by 20260916073035 and 20260917033744 (s.id, s.user_id, s.created_at,
-- s.not_after). Only those columns and the tables' keys are defined here.
--
-- Sources (supabase/auth v2.197.0 (4eee58f296d9698a1c2c0ae14d7a0b379c7622d3), migrations/):
--   auth.identities user_id, identity_data, provider, last_sign_in_at,
--     created_at, updated_at, FK to auth.users: 20210909172000_create_identities_table.up.sql
--   auth.identities provider_id (renamed from id), id uuid primary key,
--     unique (provider_id, provider): 20231117164230_add_id_pkey_identities.up.sql
--   auth.sessions id, user_id, created_at, updated_at, FK to auth.users:
--     20220811173540_add_sessions_table.up.sql
--   auth.sessions not_after: 20221114143122_add_session_not_after_column.up.sql
--   Same shape as the minimal stubs in
--   _ops/LOCAL_BOOTSTRAP_20260811143207_device_fingerprint_churn_limiter.sql, with the columns later migrations read.

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

CREATE TABLE IF NOT EXISTS auth.identities (
  provider_id text NOT NULL,
  user_id uuid NOT NULL,
  identity_data jsonb NOT NULL,
  provider text NOT NULL,
  last_sign_in_at timestamptz NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider),
  CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth.sessions (
  id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  not_after timestamptz NULL,
  CONSTRAINT sessions_pkey PRIMARY KEY (id),
  CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE
);
