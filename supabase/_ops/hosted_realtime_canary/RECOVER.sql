\set ON_ERROR_STOP on

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '30s';
SET LOCAL search_path = pg_catalog;

SELECT
  pg_catalog.set_config(
    'caaci.recovery_project_ref', :'project_ref', true
  ),
  pg_catalog.set_config(
    'caaci.recovery_sentinel_id', :'sentinel_id', true
  ),
  pg_catalog.set_config(
    'caaci.recovery_fixture_manifest_sha256',
    :'fixture_manifest_sha256',
    true
  ),
  pg_catalog.set_config(
    'caaci.recovery_run_id', :'recovery_run_id', true
  ),
  pg_catalog.set_config(
    'caaci.recovery_proof_sha256',
    :'management_recovery_proof_sha256',
    true
  ),
  pg_catalog.set_config(
    'caaci.recovery_completed_at',
    :'management_recovery_completed_at',
    true
  ),
  pg_catalog.set_config(
    'caaci.recovery_proof_expires_at',
    :'management_recovery_proof_expires_at',
    true
  ),
  pg_catalog.set_config(
    'caaci.recovery_approval_reference',
    :'recovery_approval_reference',
    true
  );

DO $recovery_operator_gate$
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
    RAISE EXCEPTION 'recovery_operator_boundary_failed'
      USING ERRCODE = '42501';
  END IF;
END
$recovery_operator_gate$;

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

DO $recover$
DECLARE
  v_project_ref constant text := lower(pg_catalog.current_setting(
    'caaci.recovery_project_ref'
  ));
  v_sentinel constant uuid := pg_catalog.current_setting(
    'caaci.recovery_sentinel_id'
  )::uuid;
  v_manifest constant text := lower(pg_catalog.current_setting(
    'caaci.recovery_fixture_manifest_sha256'
  ));
  v_run_id constant uuid := pg_catalog.current_setting(
    'caaci.recovery_run_id'
  )::uuid;
  v_proof constant text := lower(pg_catalog.current_setting(
    'caaci.recovery_proof_sha256'
  ));
  v_completed_at constant timestamptz := pg_catalog.current_setting(
    'caaci.recovery_completed_at'
  )::timestamptz;
  v_proof_expires_at constant timestamptz := pg_catalog.current_setting(
    'caaci.recovery_proof_expires_at'
  )::timestamptz;
  v_approval constant text := pg_catalog.current_setting(
    'caaci.recovery_approval_reference'
  );
  v_config private.hosted_realtime_canary_environment_config%ROWTYPE;
  v_run private.hosted_realtime_canary_runs%ROWTYPE;
BEGIN
  SELECT config.* INTO STRICT v_config
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton
  FOR UPDATE;
  SELECT run.* INTO STRICT v_run
  FROM private.hosted_realtime_canary_runs AS run
  WHERE run.run_id = v_run_id
  FOR UPDATE;

  IF v_project_ref = 'lfhvgprfphyfvhidegum'
     OR v_config.project_ref <> v_project_ref
     OR v_config.sentinel_id <> v_sentinel
     OR v_config.fixture_manifest_sha256 <> v_manifest
     OR v_config.admission_open
     OR v_run.status <> 'recovery_required'
     OR v_run.cleaned_at IS NULL
     OR v_proof !~ '^[0-9a-f]{64}$'
     OR pg_catalog.length(v_approval) NOT BETWEEN 8 AND 200
     OR v_approval ~ '[[:cntrl:]]'
     OR v_completed_at < v_run.cleaned_at
     OR v_completed_at > pg_catalog.statement_timestamp()
     OR v_proof_expires_at <= pg_catalog.statement_timestamp()
     OR v_proof_expires_at >
          pg_catalog.statement_timestamp() + interval '24 hours'
     OR pg_catalog.statement_timestamp() <
          v_completed_at
          + pg_catalog.make_interval(
              secs => v_config.max_access_token_lifetime_seconds + 60
            ) THEN
    RAISE EXCEPTION 'recovery_external_proof_failed'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM private.hosted_realtime_canary_runs AS run
       WHERE run.status IN ('active', 'quarantined')
     )
     OR private.hosted_realtime_canary_fixture_session_count(
       v_config.actor_a_id,
       v_config.actor_b_id,
       v_config.actor_c_id
     ) <> 0
     OR EXISTS (
       SELECT 1
       FROM private.hosted_realtime_canary_writes AS write
       LEFT JOIN public.messages AS message
         ON message.id = write.message_id
       WHERE write.run_id = v_run_id
         AND (
           write.deleted_at IS NULL
           OR message.id IS NOT NULL
         )
     )
     OR EXISTS (
       SELECT 1
       FROM public.messages AS message
       WHERE message.conversation_id IN (
         v_config.conversation_ab_id,
         v_config.conversation_ac_id
       )
         AND message.sender_id IN (
           v_config.actor_a_id,
           v_config.actor_b_id,
           v_config.actor_c_id
         )
         AND message.content ~
           '^caaci-hosted-canary-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     )
     OR EXISTS (
       SELECT 1
       FROM public.conversation_archives AS archive
       WHERE archive.conversation_id IN (
         v_config.conversation_ab_id,
         v_config.conversation_ac_id
       )
     )
     OR EXISTS (
       SELECT 1
       FROM public.conversations AS conversation
       WHERE (
         conversation.id = v_config.conversation_ab_id
         AND conversation.last_message_at IS DISTINCT FROM
           v_config.baseline_ab_last_message_at
       ) OR (
         conversation.id = v_config.conversation_ac_id
         AND conversation.last_message_at IS DISTINCT FROM
           v_config.baseline_ac_last_message_at
       )
     )
     OR EXISTS (
       SELECT 1
       FROM private.hosted_realtime_canary_profile_baselines AS baseline
       JOIN public.profiles AS profile ON profile.id = baseline.profile_id
       WHERE profile.updated_at IS DISTINCT FROM baseline.updated_at
          OR profile.response_rate IS DISTINCT FROM baseline.response_rate
          OR profile.response_sample IS DISTINCT FROM baseline.response_sample
     )
     OR EXISTS (
       SELECT 1
       FROM public.notifications AS notification
       WHERE notification.conversation_id IN (
         v_config.conversation_ab_id,
         v_config.conversation_ac_id
       )
         AND notification.user_id IN (
           v_config.actor_a_id,
           v_config.actor_b_id,
           v_config.actor_c_id
         )
         AND notification.created_at >= v_config.activated_at
     ) THEN
    RAISE EXCEPTION 'recovery_residue_or_derived_state_failed'
      USING ERRCODE = '55000';
  END IF;

  UPDATE private.hosted_realtime_canary_runs AS run
  SET status = 'recovered',
      recovery_proof_sha256 = v_proof,
      recovery_completed_at = v_completed_at,
      recovery_approval_reference = v_approval
  WHERE run.run_id = v_run_id;
  UPDATE private.hosted_realtime_canary_environment_config AS config
  SET session_quarantine_until = NULL
  WHERE config.singleton;

  IF private.hosted_realtime_canary_residue_count(false) <> 0 THEN
    RAISE EXCEPTION 'recovery_final_residue_failed'
      USING ERRCODE = '55000';
  END IF;
END
$recover$;

RESET ROLE;
NOTIFY pgrst, 'reload schema';
COMMIT;
