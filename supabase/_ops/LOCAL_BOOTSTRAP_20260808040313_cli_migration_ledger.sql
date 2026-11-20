-- LOCAL L-SQL REPLAY ONLY (RUNBOOK §5.1). Never apply to a hosted project:
-- there the Supabase CLI already creates and owns this ledger.
--
-- Hosted surface: the Supabase CLI migration ledger. First read by
-- 20260808040313 (its precheck needs the predecessor version recorded), then
-- by 20260811140018 and 20260811143207.
--
-- Sources:
--   schema supabase_migrations; table schema_migrations; columns
--   version text NOT NULL PRIMARY KEY, statements text[], name text:
--     supabase/cli v3.1.0 (d4fc0e5bbd65b3ade802e956d6df1cddab2e65a3),
--     apps/cli/src/command-internal/migration-history.ts:27-33;
--     same three columns as _ops/LOCAL_BOOTSTRAP_20260808040313_device_fingerprint_eviction.sql:197-201.
--   owner postgres: the CLI creates the ledger while connected as postgres.
--
-- The replay script records the migrations it has already replayed right after
-- this file and every later one after it runs, as the CLI does when applying.

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

CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text NOT NULL PRIMARY KEY
);
ALTER TABLE supabase_migrations.schema_migrations
  ADD COLUMN IF NOT EXISTS statements text[];
ALTER TABLE supabase_migrations.schema_migrations
  ADD COLUMN IF NOT EXISTS name text;

ALTER SCHEMA supabase_migrations OWNER TO postgres;
ALTER TABLE supabase_migrations.schema_migrations OWNER TO postgres;
