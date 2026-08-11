-- LOCAL/ISOLATED POSTGRESQL ONLY.
-- Builds the exact 20260808040313 predecessor needed to replay the bounded
-- fingerprint-churn successor on disposable PostgreSQL 16/17.
-- Never run this file against a hosted project.

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF pg_catalog.current_setting('caaci.local_bootstrap', true)
       IS DISTINCT FROM '20260811140018-disposable-fingerprint' THEN
    RAISE EXCEPTION
      'local bootstrap requires the explicit successor marker'
      USING ERRCODE = '55000';
  END IF;
END;
$guard$;

-- Reuse the already-reviewed minimal Supabase surface, which installs the
-- 20260718130000 function predecessor. Its own marker remains fail-closed.
SELECT pg_catalog.set_config(
  'caaci.local_bootstrap',
  '20260808040313-disposable-fingerprint',
  false
);
\ir LOCAL_BOOTSTRAP_20260808040313_device_fingerprint_eviction.sql

-- Hosted Supabase installs pgcrypto in `extensions`; mirror that exact shape
-- so ledger SHA verification exercises the same qualified digest function.
CREATE SCHEMA extensions AUTHORIZATION postgres;
ALTER EXTENSION pgcrypto SET SCHEMA extensions;

CREATE SCHEMA private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, service_role;
GRANT USAGE ON SCHEMA private TO authenticated;

-- Install the immutable P2 source and model the clean Supabase CLI ledger
-- identity. Hosted endpoints may generate a later version with the long name;
-- the successor accepts both exact reviewed identity forms.
\ir ../migrations/20260808040313_evict_oldest_device_fingerprint_instead_of_failing.sql
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260808040313',
  'evict_oldest_device_fingerprint_instead_of_failing',
  ARRAY[]::text[]
);

SELECT pg_catalog.set_config(
  'caaci.local_bootstrap',
  '20260811140018-disposable-fingerprint',
  false
);
