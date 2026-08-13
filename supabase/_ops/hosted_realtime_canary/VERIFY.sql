\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = pg_catalog;

SELECT
  pg_catalog.set_config(
    'caaci.activation_project_ref', :'project_ref', true
  ),
  pg_catalog.set_config(
    'caaci.activation_dataset_lineage', :'dataset_lineage', true
  ),
  pg_catalog.set_config(
    'caaci.activation_fixture_manifest_sha256',
    :'fixture_manifest_sha256',
    true
  ),
  pg_catalog.set_config(
    'caaci.activation_sentinel_id', :'sentinel_id', true
  ),
  pg_catalog.set_config(
    'caaci.activation_verify_require_heartbeat', 'true', true
  );

SET LOCAL ROLE caaci_hosted_realtime_executor;

\ir VERIFY_BODY.sql

SELECT
  config.project_ref,
  config.dataset_lineage,
  config.fixture_manifest_sha256,
  config.fixture_revision,
  config.protocol_revision,
  config.admission_open,
  config.last_ttl_heartbeat_at,
  config.expires_at,
  private.hosted_realtime_canary_residue_count(false) AS residue_count
FROM private.hosted_realtime_canary_environment_config AS config
WHERE config.singleton;

RESET ROLE;
\ir VERIFY_CRON_BODY.sql

ROLLBACK;
