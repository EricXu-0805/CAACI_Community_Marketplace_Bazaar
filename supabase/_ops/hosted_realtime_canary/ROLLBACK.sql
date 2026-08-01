\set ON_ERROR_STOP on

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '30s';
SET LOCAL search_path = pg_catalog;

SELECT
  pg_catalog.set_config(
    'caaci.rollback_project_ref', :'project_ref', true
  ),
  pg_catalog.set_config(
    'caaci.rollback_sentinel_id', :'sentinel_id', true
  ),
  pg_catalog.set_config(
    'caaci.rollback_fixture_manifest_sha256',
    :'fixture_manifest_sha256',
    true
  );

DO $rollback_operator_gate$
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 160000
     OR CURRENT_USER <> 'postgres'
     OR SESSION_USER <> 'postgres'
     OR (
       SELECT pg_catalog.count(*)
       FROM pg_catalog.pg_auth_members AS membership
       WHERE membership.roleid =
               pg_catalog.to_regrole('caaci_hosted_realtime_executor')
         AND membership.member = pg_catalog.to_regrole('postgres')
         AND (
           (
             membership.grantor IN (
               SELECT bootstrap.oid
               FROM pg_catalog.pg_roles AS bootstrap
               WHERE bootstrap.rolsuper
             )
             AND membership.admin_option
             AND NOT membership.inherit_option
             AND NOT membership.set_option
           )
           OR (
             membership.grantor = pg_catalog.to_regrole('postgres')
             AND NOT membership.admin_option
             AND NOT membership.inherit_option
             AND membership.set_option
           )
         )
     ) <> 2
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_auth_members AS membership
       WHERE (
         membership.roleid =
           pg_catalog.to_regrole('caaci_hosted_realtime_executor')
         OR membership.member =
           pg_catalog.to_regrole('caaci_hosted_realtime_executor')
       )
         AND NOT (
           membership.roleid =
             pg_catalog.to_regrole('caaci_hosted_realtime_executor')
           AND membership.member = pg_catalog.to_regrole('postgres')
           AND (
             (
               membership.grantor IN (
                 SELECT bootstrap.oid
                 FROM pg_catalog.pg_roles AS bootstrap
                 WHERE bootstrap.rolsuper
               )
               AND membership.admin_option
               AND NOT membership.inherit_option
               AND NOT membership.set_option
             )
             OR (
               membership.grantor = pg_catalog.to_regrole('postgres')
               AND NOT membership.admin_option
               AND NOT membership.inherit_option
               AND membership.set_option
             )
           )
         )
     )
     OR pg_catalog.pg_has_role(
       'postgres', 'caaci_hosted_realtime_executor', 'USAGE'
     )
     OR NOT pg_catalog.pg_has_role(
       'postgres', 'caaci_hosted_realtime_executor', 'SET'
     ) THEN
    RAISE EXCEPTION 'rollback_operator_boundary_failed'
      USING ERRCODE = '42501';
  END IF;
END
$rollback_operator_gate$;

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'caaci-hosted-realtime-canary-activation-v1',
    20260731
  )
);
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'caaci-hosted-realtime-canary-run-v1',
    20260731
  )
);

SET LOCAL ROLE caaci_hosted_realtime_executor;

DO $rollback_gate$
DECLARE
  v_project_ref constant text := lower(pg_catalog.current_setting(
    'caaci.rollback_project_ref'
  ));
  v_sentinel constant uuid := pg_catalog.current_setting(
    'caaci.rollback_sentinel_id'
  )::uuid;
  v_manifest constant text := lower(pg_catalog.current_setting(
    'caaci.rollback_fixture_manifest_sha256'
  ));
  v_config private.hosted_realtime_canary_environment_config%ROWTYPE;
BEGIN
  SELECT config.* INTO STRICT v_config
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton
  FOR UPDATE;

  IF v_project_ref = 'lfhvgprfphyfvhidegum'
     OR v_config.project_ref <> v_project_ref
     OR v_config.sentinel_id <> v_sentinel
     OR v_config.fixture_manifest_sha256 <> v_manifest
     OR private.hosted_realtime_canary_residue_count(false) <> 0
     OR EXISTS (
       SELECT 1
       FROM private.hosted_realtime_canary_runs AS run
       WHERE run.status IN (
         'active', 'recovery_required', 'quarantined'
       )
     )
     OR private.hosted_realtime_canary_fixture_session_count(
       v_config.actor_a_id,
       v_config.actor_b_id,
       v_config.actor_c_id
     ) <> 0
     OR (
       SELECT pg_catalog.count(*)
       FROM pg_catalog.pg_proc AS procedure
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = procedure.pronamespace
       WHERE procedure.proname LIKE 'hosted_realtime_canary_%'
         AND namespace.nspname IN ('private', 'public')
     ) <> 12
     OR (
       SELECT pg_catalog.count(*)
       FROM pg_catalog.pg_class AS relation
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'private'
         AND relation.relname LIKE 'hosted_realtime_canary_%'
         AND relation.relkind = 'r'
     ) <> 4
     OR (
       SELECT pg_catalog.count(*)
       FROM pg_catalog.pg_trigger AS trigger
       WHERE trigger.tgname LIKE '%hosted_realtime_canary%'
         AND NOT trigger.tgisinternal
     ) <> 2
     OR (
       SELECT pg_catalog.count(*)
       FROM pg_catalog.pg_policies AS policy
       WHERE policy.policyname LIKE 'hosted_realtime_canary_%'
     ) <> 12 THEN
    RAISE EXCEPTION 'rollback_gate_failed' USING ERRCODE = '55000';
  END IF;

  PERFORM pg_catalog.set_config(
    'caaci.rollback_ttl_job_id',
    v_config.ttl_job_id::text,
    true
  );
  UPDATE private.hosted_realtime_canary_environment_config AS config
  SET admission_open = false
  WHERE config.singleton;
END
$rollback_gate$;

RESET ROLE;

DO $rollback_cron_gate$
DECLARE
  v_ttl_job_id constant bigint := pg_catalog.current_setting(
    'caaci.rollback_ttl_job_id'
  )::bigint;
BEGIN
  IF CURRENT_USER <> 'postgres'
     OR SESSION_USER <> 'postgres'
     OR (
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
     ) <> 1
     OR NOT cron.unschedule(v_ttl_job_id) THEN
    RAISE EXCEPTION 'rollback_cron_gate_failed' USING ERRCODE = '55000';
  END IF;
END
$rollback_cron_gate$;

DROP TRIGGER aa_hosted_realtime_canary_message_guard
  ON public.messages;
DROP TRIGGER zz_hosted_realtime_canary_restore_profile_timestamp
  ON public.profiles;

DROP POLICY hosted_realtime_canary_executor_insert
  ON public.messages;
DROP POLICY hosted_realtime_canary_executor_delete
  ON public.messages;
DROP POLICY hosted_realtime_canary_executor_message_observation
  ON public.messages;
DROP POLICY hosted_realtime_canary_executor_archive_observation
  ON public.conversation_archives;
DROP POLICY hosted_realtime_canary_executor_notification_observation
  ON public.notifications;
DROP POLICY hosted_realtime_canary_executor_conversation_observation
  ON public.conversations;
DROP POLICY hosted_realtime_canary_executor_conversation_restore
  ON public.conversations;
DROP POLICY hosted_realtime_canary_executor_profile_authorization
  ON public.profiles;

SET LOCAL ROLE caaci_hosted_realtime_executor;

REVOKE ALL ON FUNCTION public.hosted_realtime_canary_environment()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hosted_realtime_canary_begin_run(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.hosted_realtime_canary_insert_message(uuid, uuid, uuid, text)
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hosted_realtime_canary_cleanup(uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION public.hosted_realtime_canary_cleanup(uuid, uuid[]);
DROP FUNCTION
  public.hosted_realtime_canary_insert_message(uuid, uuid, uuid, text);
DROP FUNCTION public.hosted_realtime_canary_begin_run(uuid);
DROP FUNCTION public.hosted_realtime_canary_environment();

DROP FUNCTION private.hosted_realtime_canary_ttl_cleanup();
DROP FUNCTION private.hosted_realtime_canary_cleanup_run(uuid, text);
DROP FUNCTION
  private.hosted_realtime_canary_restore_profile_timestamp();
DROP FUNCTION private.hosted_realtime_canary_message_mutation_guard();
DROP FUNCTION
  private.hosted_realtime_canary_actor_authorized(uuid, text);
DROP FUNCTION private.hosted_realtime_canary_residue_count(boolean);

RESET ROLE;

REVOKE ALL ON FUNCTION
  private.hosted_realtime_canary_auth_context(text, text)
FROM caaci_hosted_realtime_executor;
REVOKE ALL ON FUNCTION
  private.hosted_realtime_canary_fixture_session_count(uuid, uuid, uuid)
FROM caaci_hosted_realtime_executor;
DROP FUNCTION private.hosted_realtime_canary_auth_context(text, text);
DROP FUNCTION
  private.hosted_realtime_canary_fixture_session_count(uuid, uuid, uuid);

SET LOCAL ROLE caaci_hosted_realtime_executor;

DROP POLICY hosted_realtime_canary_executor_writes
  ON private.hosted_realtime_canary_writes;
DROP POLICY hosted_realtime_canary_executor_profile_baselines
  ON private.hosted_realtime_canary_profile_baselines;
DROP POLICY hosted_realtime_canary_executor_runs
  ON private.hosted_realtime_canary_runs;
DROP POLICY hosted_realtime_canary_executor_config
  ON private.hosted_realtime_canary_environment_config;

DROP TABLE private.hosted_realtime_canary_writes;
DROP TABLE private.hosted_realtime_canary_profile_baselines;
DROP TABLE private.hosted_realtime_canary_runs;
DROP TABLE private.hosted_realtime_canary_environment_config;

RESET ROLE;

REVOKE SELECT ON TABLE
  public.profiles,
  public.conversations,
  public.messages,
  public.conversation_archives,
  public.notifications
FROM caaci_hosted_realtime_executor;
REVOKE INSERT (id, conversation_id, sender_id, content, message_type)
  ON TABLE public.messages FROM caaci_hosted_realtime_executor;
REVOKE DELETE ON TABLE public.messages
  FROM caaci_hosted_realtime_executor;
REVOKE UPDATE (last_message_at) ON TABLE public.conversations
  FROM caaci_hosted_realtime_executor;
REVOKE EXECUTE ON FUNCTION public.recompute_seller_response(uuid)
  FROM caaci_hosted_realtime_executor;
REVOKE USAGE, CREATE ON SCHEMA public, private
  FROM caaci_hosted_realtime_executor;
DROP ROLE caaci_hosted_realtime_executor;

DO $rollback_verify$
BEGIN
  IF EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
       WHERE rolname = 'caaci_hosted_realtime_executor'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = procedure.pronamespace
       WHERE procedure.proname LIKE 'hosted_realtime_canary_%'
         AND namespace.nspname IN ('private', 'public')
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS relation
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = relation.relnamespace
       WHERE relation.relname LIKE 'hosted_realtime_canary_%'
         AND namespace.nspname IN ('private', 'public')
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger AS trigger
       WHERE trigger.tgname LIKE '%hosted_realtime_canary%'
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_policies AS policy
       WHERE policy.policyname LIKE 'hosted_realtime_canary_%'
     )
     OR EXISTS (
       SELECT 1 FROM cron.job AS job
       WHERE job.jobname = 'caaci-hosted-realtime-canary-ttl-v1'
     ) THEN
    RAISE EXCEPTION 'rollback_postcondition_failed'
      USING ERRCODE = '55000';
  END IF;
END
$rollback_verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;
