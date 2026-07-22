-- Read-only pre-deploy gate for
-- 20260720035037_harden_admin_appeal_decisions_and_session_metadata.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $precheck$
DECLARE
  capability_check text;
  mutation_check text;
  audit_check text;
  wrapper_oid oid := pg_catalog.to_regprocedure(
    'public.admin_execute_mutation(text,uuid,text,text,jsonb)'
  );
  authorization_oid oid := pg_catalog.to_regprocedure(
    'public.admin_token_authorization(text)'
  );
  appeals_oid oid := pg_catalog.to_regprocedure(
    'public.admin_list_appeals(integer,integer)'
  );
  audit_list_oid oid := pg_catalog.to_regprocedure(
    'public.admin_list_audit_log(integer,integer,text)'
  );
  apply_ban_oid oid := pg_catalog.to_regprocedure(
    'public.apply_ban_level(uuid,smallint,text,text,integer)'
  );
  capability_assert_oid oid := pg_catalog.to_regprocedure(
    'public.admin_assert_mutation_capability(uuid,text)'
  );
  legacy_submit_oid oid := pg_catalog.to_regprocedure(
    'public.submit_appeal(text)'
  );
  intent_submit_oid oid := pg_catalog.to_regprocedure(
    'public.submit_appeal(text,uuid,uuid)'
  );
  notify_suspension_oid oid := pg_catalog.to_regprocedure(
    'public.notify_suspension_change()'
  );
  conflicting_sessions text;
BEGIN
  IF pg_catalog.to_regclass('public.admin_tokens') IS NULL
     OR pg_catalog.to_regclass('public.admin_mutation_requests') IS NULL
     OR pg_catalog.to_regclass('public.admin_role_action_capabilities') IS NULL
     OR pg_catalog.to_regclass('public.admin_audit_log') IS NULL
     OR pg_catalog.to_regclass('public.suspensions') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: admin appeal prerequisites missing';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.admin_execute_mutation(text,uuid,text,text,jsonb)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_assert_mutation_capability(uuid,text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.apply_ban_level(uuid,smallint,text,text,integer)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_token_authorization(text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_list_appeals(integer,integer)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_list_audit_log(integer,integer,text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.record_audit(text,uuid,uuid,jsonb)'
     ) IS NULL
     OR pg_catalog.to_regprocedure('public.submit_appeal(text)') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.submit_appeal(text,uuid,uuid)'
     ) IS NULL
     OR notify_suspension_oid IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: predecessor admin RPC contract missing';
  END IF;

  IF NOT (
       SELECT routine.prosecdef
              AND routine.proconfig IS NOT DISTINCT FROM
                  ARRAY['search_path=public']::text[]
              AND pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
              AND pg_catalog.pg_get_function_result(routine.oid) = 'trigger'
         FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = notify_suspension_oid
     )
     -- Supabase-managed postgres default privileges may leave an explicit
     -- service_role EXECUTE grant on this trigger helper. The migration below
     -- revokes it atomically; precheck must not require its own repair to have
     -- happened already. Browser roles remain a hard failure here.
     OR pg_catalog.has_function_privilege('anon', notify_suspension_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'authenticated', notify_suspension_oid, 'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger AS trigger_row
        WHERE trigger_row.tgrelid = 'public.suspensions'::pg_catalog.regclass
          AND trigger_row.tgname = 'trg_notify_suspension_change'
          AND trigger_row.tgfoid = notify_suspension_oid
          AND trigger_row.tgenabled = 'O'
          AND trigger_row.tgtype = 21
          AND NOT trigger_row.tgisinternal
     ) THEN
    RAISE EXCEPTION 'precheck_failed: suspension notification trigger drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid IN (
       wrapper_oid, authorization_oid, appeals_oid,
       apply_ban_oid, capability_assert_oid, legacy_submit_oid,
       intent_submit_oid
     )
       AND (
         NOT routine.prosecdef
         OR routine.proconfig IS DISTINCT FROM
            ARRAY['search_path=pg_catalog']::text[]
         OR pg_catalog.pg_get_userbyid(routine.proowner) <> 'postgres'
       )
  )
     -- 19082600 is frozen with search_path=public. This migration replaces
     -- the legacy audit RPC with a pg_catalog-pinned projection, so accept
     -- only that exact predecessor configuration instead of demanding the
     -- post-migration repair before the migration can start.
     OR NOT (
       SELECT routine.prosecdef
              AND routine.proconfig IS NOT DISTINCT FROM
                  ARRAY['search_path=public']::text[]
              AND pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
         FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = audit_list_oid
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', wrapper_oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', authorization_oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', appeals_oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', audit_list_oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', apply_ban_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', capability_assert_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', wrapper_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', wrapper_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', authorization_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', authorization_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', apply_ban_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', apply_ban_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', capability_assert_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', capability_assert_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', legacy_submit_oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', intent_submit_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', legacy_submit_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', intent_submit_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', legacy_submit_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', intent_submit_oid, 'EXECUTE')
     OR pg_catalog.pg_get_function_result(wrapper_oid) <> 'jsonb'
     OR pg_catalog.pg_get_function_result(apply_ban_oid) <> 'uuid'
     OR pg_catalog.pg_get_function_result(capability_assert_oid) <> 'void'
     OR pg_catalog.pg_get_function_result(legacy_submit_oid) <> 'void'
     OR pg_catalog.pg_get_function_result(intent_submit_oid) <> 'void'
     OR pg_catalog.strpos(
       pg_catalog.pg_get_function_result(authorization_oid),
       'admin_id uuid'
     ) = 0
     OR pg_catalog.strpos(
       pg_catalog.pg_get_function_result(authorization_oid),
       'capabilities text[]'
     ) = 0
     OR pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(apply_ban_oid),
       'public.admin_context_actor_id()'
     ) = 0
     OR pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(apply_ban_oid),
       'public.record_audit('
     ) = 0
     OR pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(apply_ban_oid),
       'public.recompute_trust_score('
     ) = 0
     OR pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(capability_assert_oid),
       'public.admin_role_action_capabilities'
     ) = 0
     OR pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(capability_assert_oid),
       'public.admin_tokens'
     ) = 0
     OR pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(legacy_submit_oid),
       'suspension.appeal_note IS NULL'
     ) = 0
     OR pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(intent_submit_oid),
       'expected_user_id_in IS DISTINCT FROM caller_id'
     ) = 0
     OR pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(intent_submit_oid),
       'suspension.appeal_note IS NULL'
     ) = 0 THEN
    RAISE EXCEPTION 'precheck_failed: predecessor function security/shape drifted';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.admin_token_authorization_v2(text)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_list_appeals_v2(integer,integer)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_list_moderation_audit_log(integer,integer,text)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_list_owner_audit_log(integer,integer,text)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_execute_appeal_decision(text,uuid,text,jsonb)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_execute_mutation_pre_appeal_lifecycle(text,uuid,text,text,jsonb)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_moderation_reason_valid(text)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.apply_ban_level_pre_text_hardening(uuid,smallint,text,text,integer)'
     ) IS NOT NULL
     OR pg_catalog.to_regclass(
       'public.admin_audit_log_terminal_appeal_suspension_uidx'
     ) IS NOT NULL
     OR pg_catalog.to_regclass(
       'public.admin_audit_log_appeal_suspension_created_idx'
     ) IS NOT NULL
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = 'public.suspensions'::pg_catalog.regclass
          AND attribute.attname = 'appeal_submitted_at'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
     )
     OR pg_catalog.to_regclass(
       'public.suspensions_pending_appeal_submitted_idx'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'precheck_failed: partial appeal lifecycle migration exists';
  END IF;

  IF EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid =
              'public.admin_audit_log'::pg_catalog.regclass
          AND constraint_row.conname =
              'admin_audit_log_appeal_event_shape_check'
     )
     OR EXISTS (
       SELECT 1
         FROM public.admin_role_action_capabilities AS capability
        WHERE capability.action = 'decide_appeal'
     ) THEN
    RAISE EXCEPTION 'precheck_failed: partial appeal capability/shape exists';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
    INTO capability_check
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid =
         'public.admin_role_action_capabilities'::pg_catalog.regclass
     AND constraint_row.conname =
         'admin_role_action_capabilities_action_check'
     AND constraint_row.contype = 'c'
     AND constraint_row.convalidated;
  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
    INTO mutation_check
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid =
         'public.admin_mutation_requests'::pg_catalog.regclass
     AND constraint_row.conname = 'admin_mutation_requests_action_check'
     AND constraint_row.contype = 'c'
     AND constraint_row.convalidated;
  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
    INTO audit_check
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid = 'public.admin_audit_log'::pg_catalog.regclass
     AND constraint_row.conname = 'admin_audit_log_event_kind_check'
     AND constraint_row.contype = 'c'
     AND constraint_row.convalidated;

  IF capability_check IS NULL OR mutation_check IS NULL OR audit_check IS NULL
     OR pg_catalog.strpos(capability_check, 'lift_suspension') = 0
     OR pg_catalog.strpos(mutation_check, 'lift_suspension') = 0
     OR pg_catalog.strpos(audit_check, 'suspension_lifted') = 0
     OR pg_catalog.strpos(capability_check, 'decide_appeal') <> 0
     OR pg_catalog.strpos(mutation_check, 'decide_appeal') <> 0
     OR pg_catalog.strpos(audit_check, 'appeal_decided') <> 0
     OR pg_catalog.strpos(
       audit_check, 'appeal_more_information_requested'
     ) <> 0 THEN
    RAISE EXCEPTION 'precheck_failed: predecessor constraints drifted';
  END IF;

  IF (
       SELECT pg_catalog.array_agg(capability.action ORDER BY capability.action)
         FROM public.admin_role_action_capabilities AS capability
        WHERE capability.admin_role = 'operator'
     ) IS DISTINCT FROM ARRAY[
       'apply_ban', 'lift_suspension', 'resolve_target_reports',
       'takedown_content', 'update_report_status'
     ]::text[]
     OR (
       SELECT pg_catalog.array_agg(capability.action ORDER BY capability.action)
         FROM public.admin_role_action_capabilities AS capability
        WHERE capability.admin_role = 'security_admin'
     ) IS DISTINCT FROM ARRAY[
       'revoke_admin_tokens', 'revoke_token'
     ]::text[]
     OR (
       SELECT pg_catalog.array_agg(capability.action ORDER BY capability.action)
         FROM public.admin_role_action_capabilities AS capability
        WHERE capability.admin_role = 'owner'
     ) IS DISTINCT FROM ARRAY[
       'apply_ban', 'delete_banner', 'issue_token', 'lift_suspension',
       'resolve_target_reports', 'revoke_admin_tokens', 'revoke_token',
       'set_post_pinned', 'takedown_content', 'update_report_status',
       'upload_banner', 'upsert_banner'
     ]::text[]
     OR EXISTS (
       SELECT 1
         FROM public.admin_role_action_capabilities AS capability
        WHERE capability.admin_role NOT IN (
          'operator', 'security_admin', 'owner'
        )
     ) THEN
    RAISE EXCEPTION
      'precheck_failed: exact predecessor role capability matrix drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.role NOT IN ('operator', 'security_admin', 'owner')
        OR (token.admin_id IS NULL AND token.revoked_at IS NULL)
        OR (
          token.admin_id IS NOT NULL
          AND NOT EXISTS (
          SELECT 1
            FROM public.profiles AS profile
           WHERE profile.id = token.admin_id
        )
        )
  ) THEN
    RAISE EXCEPTION 'precheck_failed: active admin identity evidence drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.admin_mutation_requests AS request
     WHERE request.status = 'running'
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: running admin mutations require reconciliation';
  END IF;

  IF NOT pg_catalog.pg_try_advisory_xact_lock(20260718180000::bigint)
     OR NOT pg_catalog.pg_try_advisory_xact_lock(20260718190000::bigint) THEN
    RAISE EXCEPTION 'precheck_failed: admin advisory lock namespace is busy';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_locks AS lock_row
     WHERE lock_row.pid IS NULL
       AND lock_row.granted
       AND lock_row.relation IN (
         'public.admin_tokens'::pg_catalog.regclass,
         'public.admin_mutation_requests'::pg_catalog.regclass,
         'public.admin_audit_log'::pg_catalog.regclass,
         'public.suspensions'::pg_catalog.regclass
       )
       AND lock_row.mode IN (
         'RowExclusiveLock', 'ShareUpdateExclusiveLock', 'ShareLock',
         'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock'
       )
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: prepared appeal lifecycle table writer must be resolved';
  END IF;

  SELECT pg_catalog.string_agg(
           pg_catalog.format(
             '%s:%s:%s', lock_row.pid,
             lock_row.relation::pg_catalog.regclass,
             lock_row.mode
           ),
           ', ' ORDER BY lock_row.pid, lock_row.relation, lock_row.mode
         )
    INTO conflicting_sessions
    FROM pg_catalog.pg_locks AS lock_row
    JOIN pg_catalog.pg_stat_activity AS activity
      ON activity.pid = lock_row.pid
   WHERE lock_row.relation IN (
       'public.admin_tokens'::pg_catalog.regclass,
       'public.admin_mutation_requests'::pg_catalog.regclass,
       'public.admin_audit_log'::pg_catalog.regclass,
       'public.suspensions'::pg_catalog.regclass
     )
     AND lock_row.granted
     AND lock_row.pid <> pg_catalog.pg_backend_pid()
     AND lock_row.mode IN (
       'RowExclusiveLock', 'ShareUpdateExclusiveLock', 'ShareLock',
       'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock'
     )
     AND activity.xact_start IS NOT NULL
     AND pg_catalog.now() - activity.xact_start > interval '30 seconds';

  IF conflicting_sessions IS NOT NULL THEN
    RAISE EXCEPTION
      'precheck_failed: appeal lifecycle table writers must drain first: %',
      conflicting_sessions;
  END IF;
END;
$precheck$;

SELECT
  pg_catalog.count(*) AS token_rows,
  pg_catalog.count(*) FILTER (
    WHERE token.revoked_at IS NULL
      AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
  ) AS active_token_rows,
  pg_catalog.count(*) FILTER (
    WHERE token.role = 'owner'
      AND token.revoked_at IS NULL
      AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
  ) AS active_owner_token_rows
FROM public.admin_tokens AS token;

SELECT
  pg_catalog.count(*) AS appeals_with_notes,
  pg_catalog.count(*) FILTER (
    WHERE suspension.lifted_at IS NULL
      AND (
        suspension.ends_at IS NULL
        OR suspension.ends_at > pg_catalog.now()
      )
  ) AS currently_active_appeals,
  pg_catalog.count(*) FILTER (
    WHERE suspension.lifted_at IS NOT NULL
       OR (
         suspension.ends_at IS NOT NULL
         AND suspension.ends_at <= pg_catalog.now()
       )
  ) AS historical_reviewable_appeals
FROM public.suspensions AS suspension
WHERE suspension.appeal_note IS NOT NULL;

SELECT admin_role, pg_catalog.array_agg(action ORDER BY action) AS actions
FROM public.admin_role_action_capabilities
GROUP BY admin_role
ORDER BY admin_role;

SELECT event_kind, pg_catalog.count(*) AS audit_rows
FROM public.admin_audit_log
GROUP BY event_kind
ORDER BY event_kind;

ROLLBACK;
