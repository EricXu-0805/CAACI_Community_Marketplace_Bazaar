DO $verify_cron$
DECLARE
  v_ttl_job_id constant bigint := pg_catalog.current_setting(
    'caaci.activation_verified_ttl_job_id'
  )::bigint;
  v_computed_manifest constant text := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.current_setting(
          'caaci.activation_verified_fixture_manifest_payload'
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
BEGIN
  IF CURRENT_USER <> 'postgres'
     OR SESSION_USER <> 'postgres' THEN
    RAISE EXCEPTION 'verify_cron_operator_failed'
      USING ERRCODE = '42501';
  END IF;

  IF v_computed_manifest IS DISTINCT FROM lower(
    pg_catalog.current_setting(
      'caaci.activation_fixture_manifest_sha256'
    )
  ) THEN
    RAISE EXCEPTION 'verify_fixture_manifest_failed'
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM cron.job AS job
    WHERE job.jobid = v_ttl_job_id
      AND job.jobname = 'caaci-hosted-realtime-canary-ttl-v1'
      AND job.schedule = '*/5 * * * *'
      AND job.command =
        'SELECT private.hosted_realtime_canary_ttl_cleanup()'
      AND job.database = pg_catalog.current_database()
      AND job.username = 'postgres'
      AND job.active
  ) <> 1 THEN
    RAISE EXCEPTION 'verify_cron_job_failed' USING ERRCODE = '55000';
  END IF;

  IF NOT pg_catalog.has_schema_privilege(
       'postgres', 'private', 'USAGE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'postgres',
       'private.hosted_realtime_canary_ttl_cleanup()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_cron_operator_acl_failed'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('anon'),
      ('authenticated'),
      ('service_role')
    ) AS api(role_name)
    WHERE pg_catalog.has_function_privilege(
      api.role_name,
      'private.hosted_realtime_canary_ttl_cleanup()',
      'EXECUTE'
    )
  ) THEN
    RAISE EXCEPTION 'verify_cron_api_acl_failed'
      USING ERRCODE = '55000';
  END IF;
END
$verify_cron$;
