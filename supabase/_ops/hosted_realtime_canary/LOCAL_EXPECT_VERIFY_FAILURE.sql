\set ON_ERROR_STOP off

-- Included only from LOCAL_REGRESSION.sql inside a transaction that injected
-- one temporary catalog drift. VERIFY_BODY must fail with the caller's exact
-- expected boundary; ROLLBACK removes the drift even when the assertion fails.
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
-- SQLSTATE is the status of the command that just ran. Capture it before the
-- following meta-commands can obscure whether this VERIFY invocation itself
-- failed; LAST_ERROR_* alone may still describe an earlier negative case.
\set local_verify_current_sqlstate :SQLSTATE
\set local_verify_failure_sqlstate :LAST_ERROR_SQLSTATE
\set local_verify_failure_message :LAST_ERROR_MESSAGE
ROLLBACK;
\set ON_ERROR_STOP on

SELECT
  :'local_verify_current_sqlstate' = '55000'
  AND :'local_verify_failure_sqlstate' = '55000'
  AND :'local_verify_failure_message' = :'expected_verify_failure_message'
  AS local_verify_failure_observed
\gset
\if :local_verify_failure_observed
\else
  \echo '[LOCAL-PG] Exact expected VERIFY failure was not observed'
  \quit 3
\endif
\unset expected_verify_failure_message
