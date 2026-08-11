-- LOCAL/ISOLATED POSTGRESQL ONLY.
-- Builds the exact write-quiescence predecessor needed to replay the final
-- fingerprint limiter on disposable PostgreSQL 16/17.

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF pg_catalog.current_setting('caaci.local_bootstrap', true)
       IS DISTINCT FROM '20260811143207-disposable-fingerprint' THEN
    RAISE EXCEPTION
      'local bootstrap requires the explicit final-limiter marker'
      USING ERRCODE = '55000';
  END IF;
END;
$guard$;

SELECT pg_catalog.set_config(
  'caaci.local_bootstrap',
  '20260811140018-disposable-fingerprint',
  false
);
\ir LOCAL_BOOTSTRAP_20260811140018_device_fingerprint_churn.sql

-- The historical local fixture predates the two other managed Auth relations
-- used only by the fresh-replay emptiness guard. Their contents are irrelevant
-- here; exact absence is the behavior under test.
CREATE TABLE IF NOT EXISTS auth.identities (
  id text PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  id bigint PRIMARY KEY
);

BEGIN;
\ir ../migrations/20260811140018_bound_device_fingerprint_churn.sql
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260811140018',
  'bound_device_fingerprint_churn',
  ARRAY[]::text[]
);
COMMIT;

-- Prove that a truly empty, newly replayed database can apply the next
-- migration immediately. Roll the entire candidate back so the same fixture
-- can then exercise the populated-hosted age path below.
BEGIN;
\ir ../migrations/20260811143207_install_device_fingerprint_churn_limiter.sql
ROLLBACK;

-- Local replay has no wall-clock deployment pause. Advance only the bounded
-- cutover fixture so the final PRECHECK/migration can exercise the same >=65s
-- gate; hosted execution must wait and prove a real drain instead.
UPDATE private.device_fingerprint_churn_cutover
   SET bridge_installed_at =
       pg_catalog.clock_timestamp() - interval '2 minutes';

SELECT pg_catalog.set_config(
  'caaci.local_bootstrap',
  '20260811143207-disposable-fingerprint',
  false
);
