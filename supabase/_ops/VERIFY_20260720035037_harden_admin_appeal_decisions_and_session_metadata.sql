-- Read-only post-deploy verification for the atomic appeal lifecycle and
-- versioned administrator session projections.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $verify$
DECLARE
  wrapper_oid oid := pg_catalog.to_regprocedure(
    'public.admin_execute_mutation(text,uuid,text,text,jsonb)'
  );
  legacy_oid oid := pg_catalog.to_regprocedure(
    'public.admin_execute_mutation_pre_appeal_lifecycle(text,uuid,text,text,jsonb)'
  );
  appeal_oid oid := pg_catalog.to_regprocedure(
    'public.admin_execute_appeal_decision(text,uuid,text,jsonb)'
  );
  auth_v1_oid oid := pg_catalog.to_regprocedure(
    'public.admin_token_authorization(text)'
  );
  auth_v2_oid oid := pg_catalog.to_regprocedure(
    'public.admin_token_authorization_v2(text)'
  );
  appeals_v1_oid oid := pg_catalog.to_regprocedure(
    'public.admin_list_appeals(integer,integer)'
  );
  appeals_v2_oid oid := pg_catalog.to_regprocedure(
    'public.admin_list_appeals_v2(integer,integer)'
  );
  moderation_audit_oid oid := pg_catalog.to_regprocedure(
    'public.admin_list_moderation_audit_log(integer,integer,text)'
  );
  owner_audit_oid oid := pg_catalog.to_regprocedure(
    'public.admin_list_owner_audit_log(integer,integer,text)'
  );
  legacy_audit_oid oid := pg_catalog.to_regprocedure(
    'public.admin_list_audit_log(integer,integer,text)'
  );
  search_oid oid := pg_catalog.to_regprocedure(
    'public.admin_search_users(text,integer)'
  );
  reason_oid oid := pg_catalog.to_regprocedure(
    'public.admin_moderation_reason_valid(text)'
  );
  lift_oid oid := pg_catalog.to_regprocedure(
    'public.lift_suspension(uuid,text)'
  );
  takedown_oid oid := pg_catalog.to_regprocedure(
    'public.admin_takedown_content(text,uuid,text)'
  );
  apply_ban_oid oid := pg_catalog.to_regprocedure(
    'public.apply_ban_level(uuid,smallint,text,text,integer)'
  );
  apply_ban_legacy_oid oid := pg_catalog.to_regprocedure(
    'public.apply_ban_level_pre_text_hardening(uuid,smallint,text,text,integer)'
  );
  record_audit_oid oid := pg_catalog.to_regprocedure(
    'public.record_audit(text,uuid,uuid,jsonb)'
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
  wrapper_source text;
  appeal_source text;
  auth_v1_source text;
  auth_v2_source text;
  appeals_v1_source text;
  appeals_v2_source text;
  moderation_audit_source text;
  owner_audit_source text;
  legacy_audit_source text;
  search_source text;
  record_audit_source text;
  lift_source text;
  takedown_source text;
  apply_ban_source text;
  legacy_submit_source text;
  intent_submit_source text;
  notify_suspension_source text;
  capability_check text;
  mutation_check text;
  audit_check text;
  audit_shape_check text;
  terminal_index text;
  terminal_index_unique boolean;
  terminal_index_valid boolean;
  terminal_index_ready boolean;
  timeline_index_valid boolean;
  timeline_index_ready boolean;
  submission_index text;
  submission_index_valid boolean;
  submission_index_ready boolean;
  submission_shape_check text;
BEGIN
  IF wrapper_oid IS NULL OR legacy_oid IS NULL OR appeal_oid IS NULL
     OR auth_v1_oid IS NULL OR auth_v2_oid IS NULL
     OR appeals_v1_oid IS NULL OR appeals_v2_oid IS NULL
     OR moderation_audit_oid IS NULL
     OR owner_audit_oid IS NULL OR legacy_audit_oid IS NULL
     OR search_oid IS NULL OR reason_oid IS NULL
     OR lift_oid IS NULL OR takedown_oid IS NULL
     OR apply_ban_oid IS NULL OR apply_ban_legacy_oid IS NULL
     OR record_audit_oid IS NULL OR legacy_submit_oid IS NULL
     OR intent_submit_oid IS NULL OR notify_suspension_oid IS NULL THEN
    RAISE EXCEPTION 'verify_failed: required appeal/session RPC missing';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = ANY(ARRAY[
       wrapper_oid, legacy_oid, appeal_oid, auth_v1_oid, auth_v2_oid,
       appeals_v1_oid, appeals_v2_oid, moderation_audit_oid, owner_audit_oid,
       legacy_audit_oid, search_oid, apply_ban_oid, apply_ban_legacy_oid,
       lift_oid, takedown_oid, record_audit_oid, legacy_submit_oid,
       intent_submit_oid, notify_suspension_oid
     ]::oid[])
       AND (
         NOT routine.prosecdef
         OR routine.proconfig IS DISTINCT FROM
            ARRAY['search_path=pg_catalog']::text[]
         OR pg_catalog.pg_get_userbyid(routine.proowner) <> 'postgres'
       )
  )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = reason_oid
          AND (
            routine.prosecdef
            OR routine.proconfig IS DISTINCT FROM
               ARRAY['search_path=pg_catalog']::text[]
            OR pg_catalog.pg_get_userbyid(routine.proowner) <> 'postgres'
          )
     ) THEN
    RAISE EXCEPTION 'verify_failed: function owner/definer/search_path drifted';
  END IF;

  IF NOT pg_catalog.has_function_privilege('service_role', wrapper_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', wrapper_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', wrapper_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', legacy_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', appeal_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', reason_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', apply_ban_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', apply_ban_legacy_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', lift_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', takedown_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'service_role', notify_suspension_oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege('service_role', auth_v1_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', auth_v2_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', appeals_v1_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', appeals_v2_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'service_role', moderation_audit_oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege('service_role', owner_audit_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', legacy_audit_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', search_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', record_audit_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(ARRAY[
           wrapper_oid, legacy_oid, appeal_oid, auth_v1_oid, auth_v2_oid,
           appeals_v1_oid, appeals_v2_oid, moderation_audit_oid, owner_audit_oid,
           legacy_audit_oid, search_oid, reason_oid, apply_ban_oid,
           apply_ban_legacy_oid, lift_oid, takedown_oid, record_audit_oid,
           notify_suspension_oid
         ]::oid[]) AS exposed(routine_oid)
        WHERE pg_catalog.has_function_privilege(
                'anon', exposed.routine_oid, 'EXECUTE'
              )
           OR pg_catalog.has_function_privilege(
                'authenticated', exposed.routine_oid, 'EXECUTE'
              )
     ) THEN
    RAISE EXCEPTION 'verify_failed: public/private function ACL mismatch';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'authenticated', legacy_submit_oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', intent_submit_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', legacy_submit_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', intent_submit_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', legacy_submit_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', intent_submit_oid, 'EXECUTE')
     OR pg_catalog.pg_get_function_result(legacy_submit_oid) <> 'void'
     OR pg_catalog.pg_get_function_result(intent_submit_oid) <> 'void' THEN
    RAISE EXCEPTION 'verify_failed: appeal submission RPC ACL/shape drifted';
  END IF;

  IF pg_catalog.has_table_privilege(
       'service_role', 'public.admin_audit_log',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR pg_catalog.has_any_column_privilege(
       'service_role', 'public.admin_audit_log',
       'SELECT,INSERT,UPDATE,REFERENCES'
     )
     OR pg_catalog.has_table_privilege(
       'anon', 'public.admin_audit_log', 'SELECT,INSERT,UPDATE,DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.admin_audit_log', 'SELECT,INSERT,UPDATE,DELETE'
     )
     OR pg_catalog.has_sequence_privilege(
       'service_role', 'public.admin_audit_log_id_seq', 'USAGE,SELECT,UPDATE'
     )
     OR pg_catalog.has_sequence_privilege(
       'anon', 'public.admin_audit_log_id_seq', 'USAGE,SELECT,UPDATE'
     )
     OR pg_catalog.has_sequence_privilege(
       'authenticated', 'public.admin_audit_log_id_seq', 'USAGE,SELECT,UPDATE'
     )
     OR NOT (
       SELECT relation.relrowsecurity
         FROM pg_catalog.pg_class AS relation
        WHERE relation.oid = 'public.admin_audit_log'::pg_catalog.regclass
     ) THEN
    RAISE EXCEPTION 'verify_failed: raw audit-table Data API bypass remains';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
    INTO capability_check
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid =
         'public.admin_role_action_capabilities'::pg_catalog.regclass
     AND constraint_row.conname =
         'admin_role_action_capabilities_action_check'
     AND constraint_row.convalidated;
  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
    INTO mutation_check
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid =
         'public.admin_mutation_requests'::pg_catalog.regclass
     AND constraint_row.conname = 'admin_mutation_requests_action_check'
     AND constraint_row.convalidated;
  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
    INTO audit_check
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid = 'public.admin_audit_log'::pg_catalog.regclass
     AND constraint_row.conname = 'admin_audit_log_event_kind_check'
     AND constraint_row.convalidated;
  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
    INTO audit_shape_check
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid = 'public.admin_audit_log'::pg_catalog.regclass
     AND constraint_row.conname = 'admin_audit_log_appeal_event_shape_check'
     AND constraint_row.convalidated;
  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
    INTO submission_shape_check
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid = 'public.suspensions'::pg_catalog.regclass
     AND constraint_row.conname = 'suspensions_appeal_submitted_shape_check'
     AND constraint_row.contype = 'c'
     AND constraint_row.convalidated;

  IF capability_check IS NULL OR mutation_check IS NULL
     OR audit_check IS NULL OR audit_shape_check IS NULL
     OR submission_shape_check IS NULL
     OR pg_catalog.strpos(capability_check, 'decide_appeal') = 0
     OR pg_catalog.strpos(mutation_check, 'decide_appeal') = 0
     OR pg_catalog.strpos(audit_check, 'appeal_decided') = 0
     OR pg_catalog.strpos(audit_check, 'appeal_more_information_requested') = 0
     OR pg_catalog.strpos(audit_shape_check, 'admin_token_id') = 0
     OR pg_catalog.strpos(audit_shape_check, 'idempotency_key') = 0
     OR pg_catalog.strpos(audit_shape_check, 'target_id') = 0
     OR pg_catalog.strpos(audit_shape_check, 'suspension_active') = 0
     OR pg_catalog.strpos(audit_shape_check, 'lifted_now') = 0
     OR pg_catalog.strpos(audit_shape_check, 'remains_active') = 0
     OR pg_catalog.strpos(audit_shape_check, 'accepted') = 0
     OR pg_catalog.strpos(submission_shape_check, 'appeal_submitted_at') = 0
     OR pg_catalog.strpos(submission_shape_check, 'appeal_note') = 0
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = 'public.suspensions'::pg_catalog.regclass
          AND attribute.attname = 'appeal_submitted_at'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND NOT attribute.attnotnull
          AND pg_catalog.format_type(
            attribute.atttypid, attribute.atttypmod
          ) = 'timestamp with time zone'
     ) THEN
    RAISE EXCEPTION 'verify_failed: appeal capability/ledger/audit constraint drifted';
  END IF;

  IF (
       SELECT pg_catalog.array_agg(capability.action ORDER BY capability.action)
         FROM public.admin_role_action_capabilities AS capability
        WHERE capability.admin_role = 'operator'
     ) IS DISTINCT FROM ARRAY[
       'apply_ban', 'decide_appeal', 'lift_suspension',
       'resolve_target_reports', 'takedown_content', 'update_report_status'
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
       'apply_ban', 'decide_appeal', 'delete_banner', 'issue_token',
       'lift_suspension', 'resolve_target_reports', 'revoke_admin_tokens',
       'revoke_token', 'set_post_pinned', 'takedown_content',
       'update_report_status', 'upload_banner', 'upsert_banner'
     ]::text[]
     OR EXISTS (
       SELECT 1
         FROM public.admin_role_action_capabilities AS capability
        WHERE capability.admin_role NOT IN (
          'operator', 'security_admin', 'owner'
        )
     ) THEN
    RAISE EXCEPTION 'verify_failed: appeal role capability mapping drifted';
  END IF;

  SELECT pg_catalog.pg_get_indexdef(index_row.indexrelid)
         || ' WHERE ' || pg_catalog.pg_get_expr(
           index_row.indpred, index_row.indrelid
         ),
         index_row.indisunique,
         index_row.indisvalid,
         index_row.indisready
    INTO terminal_index,
         terminal_index_unique,
         terminal_index_valid,
         terminal_index_ready
    FROM pg_catalog.pg_index AS index_row
   WHERE index_row.indexrelid = pg_catalog.to_regclass(
     'public.admin_audit_log_terminal_appeal_suspension_uidx'
   );
  IF terminal_index IS NULL
     OR NOT terminal_index_unique
     OR NOT terminal_index_valid
     OR NOT terminal_index_ready
     OR pg_catalog.strpos(terminal_index, 'UNIQUE INDEX') = 0
     OR pg_catalog.strpos(terminal_index, '(target_id)') = 0
     OR pg_catalog.strpos(terminal_index, 'appeal_decided') = 0 THEN
    RAISE EXCEPTION 'verify_failed: one-terminal-per-suspension index missing';
  END IF;
  SELECT index_row.indisvalid, index_row.indisready
    INTO timeline_index_valid, timeline_index_ready
    FROM pg_catalog.pg_index AS index_row
   WHERE index_row.indexrelid = pg_catalog.to_regclass(
     'public.admin_audit_log_appeal_suspension_created_idx'
   );
  IF timeline_index_valid IS NOT TRUE OR timeline_index_ready IS NOT TRUE THEN
    RAISE EXCEPTION 'verify_failed: appeal timeline support index missing';
  END IF;
  SELECT pg_catalog.pg_get_indexdef(index_row.indexrelid),
         index_row.indisvalid,
         index_row.indisready
    INTO submission_index,
         submission_index_valid,
         submission_index_ready
    FROM pg_catalog.pg_index AS index_row
   WHERE index_row.indexrelid = pg_catalog.to_regclass(
     'public.suspensions_pending_appeal_submitted_idx'
   );
  IF submission_index IS NULL
     OR submission_index_valid IS NOT TRUE
     OR submission_index_ready IS NOT TRUE
     OR pg_catalog.strpos(submission_index, 'appeal_submitted_at') = 0
     OR pg_catalog.strpos(submission_index, 'NULLS FIRST') = 0
     OR pg_catalog.strpos(submission_index, 'appeal_note IS NOT NULL') = 0 THEN
    RAISE EXCEPTION 'verify_failed: authoritative appeal FIFO index missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(wrapper_oid) INTO wrapper_source;
  SELECT pg_catalog.pg_get_functiondef(appeal_oid) INTO appeal_source;
  SELECT pg_catalog.pg_get_functiondef(auth_v1_oid) INTO auth_v1_source;
  SELECT pg_catalog.pg_get_functiondef(auth_v2_oid) INTO auth_v2_source;
  SELECT pg_catalog.pg_get_functiondef(appeals_v1_oid) INTO appeals_v1_source;
  SELECT pg_catalog.pg_get_functiondef(appeals_v2_oid) INTO appeals_v2_source;
  SELECT pg_catalog.pg_get_functiondef(moderation_audit_oid)
    INTO moderation_audit_source;
  SELECT pg_catalog.pg_get_functiondef(owner_audit_oid)
    INTO owner_audit_source;
  SELECT pg_catalog.pg_get_functiondef(legacy_audit_oid) INTO legacy_audit_source;
  SELECT pg_catalog.pg_get_functiondef(search_oid) INTO search_source;
  SELECT pg_catalog.pg_get_functiondef(
    record_audit_oid
  ) INTO record_audit_source;
  SELECT pg_catalog.pg_get_functiondef(lift_oid) INTO lift_source;
  SELECT pg_catalog.pg_get_functiondef(takedown_oid) INTO takedown_source;
  SELECT pg_catalog.pg_get_functiondef(apply_ban_oid) INTO apply_ban_source;
  SELECT pg_catalog.pg_get_functiondef(legacy_submit_oid)
    INTO legacy_submit_source;
  SELECT pg_catalog.pg_get_functiondef(intent_submit_oid)
    INTO intent_submit_source;
  SELECT pg_catalog.pg_get_functiondef(notify_suspension_oid)
    INTO notify_suspension_source;

  IF pg_catalog.strpos(wrapper_source, $$p_action = 'decide_appeal'$$) = 0
     OR pg_catalog.strpos(
       wrapper_source, 'admin_execute_mutation_pre_appeal_lifecycle'
     ) = 0
     OR pg_catalog.strpos(appeal_source, 'FOR UPDATE') = 0
     OR pg_catalog.strpos(appeal_source, '20260718180000') = 0
     OR pg_catalog.strpos(appeal_source, '20260718190000') = 0
     OR pg_catalog.strpos(appeal_source, 'clock_timestamp()') = 0
     OR NOT (
       pg_catalog.strpos(appeal_source, '20260718180000')
       < pg_catalog.strpos(appeal_source, '20260718190000')
       AND pg_catalog.strpos(appeal_source, '20260718190000')
           < pg_catalog.strpos(appeal_source, 'clock_timestamp()')
     )
     OR pg_catalog.strpos(appeal_source, 'appeal_already_decided') = 0
     OR pg_catalog.strpos(appeal_source, 'self_appeal_decision_forbidden') = 0
     OR pg_catalog.strpos(appeal_source, 'record_audit') = 0
     OR (
       pg_catalog.length(appeal_source)
       - pg_catalog.length(pg_catalog.replace(appeal_source, 'record_audit', ''))
     ) / pg_catalog.length('record_audit') <> 1 THEN
    RAISE EXCEPTION 'verify_failed: atomic appeal dispatcher contract drifted';
  END IF;

  IF pg_catalog.strpos(auth_v1_source, $$action <> 'decide_appeal'$$) = 0
     OR pg_catalog.strpos(auth_v1_source, 'clock_timestamp()') = 0
     OR pg_catalog.strpos(auth_v2_source, 'clock_timestamp()') = 0
     OR NOT (
       pg_catalog.strpos(auth_v1_source, '20260718180000')
       < pg_catalog.strpos(auth_v1_source, '20260718190000')
       AND pg_catalog.strpos(auth_v1_source, '20260718190000')
           < pg_catalog.strpos(auth_v1_source, 'clock_timestamp()')
     )
     OR NOT (
       pg_catalog.strpos(auth_v2_source, '20260718180000')
       < pg_catalog.strpos(auth_v2_source, '20260718190000')
       AND pg_catalog.strpos(auth_v2_source, '20260718190000')
           < pg_catalog.strpos(auth_v2_source, 'clock_timestamp()')
     )
     OR pg_catalog.pg_get_function_result(auth_v1_oid) <>
       'TABLE(admin_id uuid, admin_name text, admin_email text, role text, capabilities text[])'
     OR pg_catalog.pg_get_function_result(auth_v2_oid) <>
       'TABLE(token_id uuid, admin_id uuid, admin_name text, admin_email text, role text, expires_at timestamp with time zone, server_now timestamp with time zone, capabilities text[])' THEN
    RAISE EXCEPTION 'verify_failed: versioned authorization projection drifted';
  END IF;

  IF pg_catalog.strpos(appeals_v1_source, 'appeal_decided') = 0
     OR pg_catalog.strpos(appeals_v1_source, 'lifted_at IS NULL') <> 0
     OR pg_catalog.strpos(appeals_v1_source, 'appeal_submitted_at') = 0
     OR pg_catalog.strpos(appeals_v1_source, 'NULLS FIRST') = 0
     OR pg_catalog.strpos(appeals_v2_source, 'review_status') = 0
     OR pg_catalog.strpos(appeals_v2_source, 'reviewed_at') = 0
     OR pg_catalog.strpos(appeals_v2_source, 'appeal_decided') = 0
     OR pg_catalog.strpos(appeals_v2_source, 'lifted_at IS NULL') <> 0
     OR pg_catalog.strpos(appeals_v2_source, 'appeal_submitted_at') = 0
     OR pg_catalog.strpos(appeals_v2_source, 'NULLS FIRST') = 0
     OR pg_catalog.pg_get_function_result(appeals_v1_oid) <>
       'TABLE(id uuid, profile_id uuid, profile_nickname text, profile_avatar_url text, level smallint, reason text, ends_at timestamp with time zone, appeal_note text, created_at timestamp with time zone, issued_by uuid, issued_by_nickname text, lifted_by uuid, lifted_by_nickname text)'
     OR pg_catalog.pg_get_function_result(appeals_v2_oid) <>
       'TABLE(id uuid, profile_id uuid, profile_nickname text, profile_avatar_url text, level smallint, reason text, ends_at timestamp with time zone, appeal_note text, appeal_submitted_at timestamp with time zone, created_at timestamp with time zone, issued_by uuid, issued_by_nickname text, lifted_at timestamp with time zone, lifted_by uuid, lifted_by_nickname text, review_status text, reviewed_at timestamp with time zone)' THEN
    RAISE EXCEPTION 'verify_failed: pending/historical appeal projection drifted';
  END IF;

  IF pg_catalog.strpos(legacy_submit_source, 'appeal_submitted_at') = 0
     OR pg_catalog.strpos(legacy_submit_source, 'clock_timestamp()') = 0
     OR pg_catalog.strpos(
       legacy_submit_source, 'suspension.appeal_note IS NULL'
     ) = 0
     OR pg_catalog.strpos(intent_submit_source, 'appeal_submitted_at') = 0
     OR pg_catalog.strpos(intent_submit_source, 'clock_timestamp()') = 0
     OR pg_catalog.strpos(
       intent_submit_source,
       'expected_user_id_in IS DISTINCT FROM caller_id'
     ) = 0
     OR pg_catalog.strpos(
       intent_submit_source, 'suspension.appeal_note IS NULL'
     ) = 0 THEN
    RAISE EXCEPTION 'verify_failed: authoritative appeal filing clock drifted';
  END IF;

  IF pg_catalog.strpos(moderation_audit_source, 'admin_token_id') <> 0
     OR pg_catalog.strpos(moderation_audit_source, 'idempotency_key') <> 0
     OR pg_catalog.strpos(moderation_audit_source, 'token_revoked') <> 0
     OR pg_catalog.strpos(
       legacy_audit_source, 'admin_list_moderation_audit_log'
     ) = 0
     OR pg_catalog.strpos(owner_audit_source, 'audit.details') = 0
     OR pg_catalog.strpos(
       owner_audit_source,
       'kind_filter IS NULL OR audit.event_kind = kind_filter'
     ) = 0 THEN
    RAISE EXCEPTION 'verify_failed: operator audit redaction/legacy safety drifted';
  END IF;

  IF pg_catalog.strpos(search_source, 'pg_catalog.chr(92)') = 0
     OR pg_catalog.strpos(search_source, 'normalized.escaped_query') = 0
     OR pg_catalog.strpos(search_source, 'ESCAPE') = 0
     OR pg_catalog.strpos(
       search_source, 'pg_catalog.length(normalized.query) BETWEEN 2 AND 200'
     ) = 0
     OR pg_catalog.strpos(lift_source, 'self_appeal_decision_forbidden') = 0
     OR pg_catalog.strpos(lift_source, 'admin_moderation_reason_valid') = 0
     OR pg_catalog.strpos(lift_source, 'suspension.level DESC') = 0
     OR pg_catalog.strpos(lift_source, 'suspension.ends_at DESC NULLS FIRST') = 0
     OR pg_catalog.strpos(takedown_source, 'admin_moderation_reason_valid') = 0
     OR pg_catalog.strpos(apply_ban_source, 'admin_moderation_reason_valid') = 0
     OR pg_catalog.strpos(apply_ban_source, 'pg_catalog.btrim') = 0
     OR pg_catalog.strpos(apply_ban_source, 'suspension.level DESC') = 0
     OR pg_catalog.strpos(apply_ban_source, 'suspension.ends_at DESC NULLS FIRST') = 0
     OR pg_catalog.strpos(appeal_source, 'suspension.level DESC') = 0
     OR pg_catalog.strpos(appeal_source, 'suspension.ends_at DESC NULLS FIRST') = 0 THEN
    RAISE EXCEPTION 'verify_failed: search/reason/self-review hardening drifted';
  END IF;

  IF pg_catalog.strpos(record_audit_source, 'context_role IS NULL') = 0
     OR pg_catalog.strpos(record_audit_source, 'admin_audit_required_failed') = 0
     OR pg_catalog.strpos(record_audit_source, 'appeal_audit_context_required') = 0
     OR pg_catalog.strpos(
       record_audit_source,
       $$AND NOT audit_required THEN
    RAISE;$$
     ) = 0 THEN
    RAISE EXCEPTION 'verify_failed: required-audit role/context boundary drifted';
  END IF;

  IF pg_catalog.strpos(
       notify_suspension_source, 'another_restriction_active'
     ) = 0
     OR pg_catalog.pg_get_function_result(notify_suspension_oid) <> 'trigger'
     OR pg_catalog.strpos(
       notify_suspension_source, 'suspension.level >= 2'
     ) = 0
     OR pg_catalog.strpos(
       notify_suspension_source, 'Another account restriction remains active'
     ) = 0
     OR pg_catalog.strpos(
       notify_suspension_source, 'OLD.ends_at > notification_time'
     ) = 0
     OR pg_catalog.strpos(
       notify_suspension_source, 'NEW.started_at <= notification_time'
     ) = 0
     OR pg_catalog.strpos(
       notify_suspension_source, 'NEW.lifted_at IS NULL'
     ) = 0
     OR pg_catalog.strpos(
       notify_suspension_source, 'NEW.ends_at > notification_time'
     ) = 0
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
    RAISE EXCEPTION 'verify_failed: suspension notification truthfulness drifted';
  END IF;
END;
$verify$;

SELECT
  pg_catalog.count(*) AS terminal_appeal_rows,
  pg_catalog.count(DISTINCT target_id) AS terminal_suspensions
FROM public.admin_audit_log
WHERE event_kind = 'appeal_decided';

SELECT
  pg_catalog.count(*) AS pending_appeals,
  pg_catalog.count(*) FILTER (
    WHERE EXISTS (
      SELECT 1
        FROM public.admin_audit_log AS more_info
       WHERE more_info.event_kind = 'appeal_more_information_requested'
         AND more_info.target_id = suspension.id
    )
  ) AS awaiting_more_information,
  pg_catalog.count(*) FILTER (
    WHERE suspension.appeal_submitted_at IS NULL
  ) AS historical_unknown_filing_time,
  pg_catalog.min(suspension.appeal_submitted_at) FILTER (
    WHERE suspension.appeal_submitted_at IS NOT NULL
  ) AS oldest_authoritative_filing_time
FROM public.suspensions AS suspension
WHERE suspension.appeal_note IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
      FROM public.admin_audit_log AS terminal
     WHERE terminal.event_kind = 'appeal_decided'
       AND terminal.target_id = suspension.id
  );

ROLLBACK;
