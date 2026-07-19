-- LOCAL/ISOLATED POSTGRESQL ONLY.
-- Minimal managed Realtime objects for replaying the repository migration
-- chain outside a Supabase local stack. Never run this file in production.

\set ON_ERROR_STOP on

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'
  ) THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END;
$roles$;

CREATE SCHEMA IF NOT EXISTS realtime;

CREATE TABLE IF NOT EXISTS realtime.messages (
  topic text NOT NULL,
  extension text NOT NULL,
  payload jsonb,
  event text,
  private boolean DEFAULT false,
  updated_at timestamp without time zone NOT NULL DEFAULT pg_catalog.now(),
  inserted_at timestamp without time zone NOT NULL DEFAULT pg_catalog.now(),
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid()
);

-- Supabase's managed helper resolves the joining channel topic. The isolated
-- fixture reads a transaction-local setting so RLS can be exercised directly.
CREATE OR REPLACE FUNCTION realtime.topic()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $function$
  SELECT NULLIF(pg_catalog.current_setting('realtime.topic', true), '')
$function$;

GRANT USAGE ON SCHEMA realtime TO anon, authenticated;
-- Start deliberately over-privileged so the migration/VERIFY pair proves that
-- DELETE/TRUNCATE/REFERENCES/TRIGGER drift is removed as well as UPDATE.
GRANT ALL ON realtime.messages TO anon, authenticated;
GRANT EXECUTE ON FUNCTION realtime.topic() TO anon, authenticated;
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
