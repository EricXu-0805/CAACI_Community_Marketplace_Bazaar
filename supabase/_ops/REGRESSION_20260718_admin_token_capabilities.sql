-- Isolated/local behavior regression for administrator token capabilities.
-- NEVER run against production.

\set ON_ERROR_STOP on

BEGIN;

-- Keep the last-owner scenario deterministic if this is run in a reusable
-- disposable database. The recovery trigger correctly refuses expiring the
-- final verified owner one row at a time, so this superuser-only fixture reset
-- suspends that one guard explicitly; the enclosing transaction restores both
-- the trigger state and every row.
ALTER TABLE public.admin_tokens
  DISABLE TRIGGER admin_tokens_protect_recovery;
UPDATE public.admin_tokens AS token
   SET expires_at = pg_catalog.now() - interval '1 second'
 WHERE token.role = 'owner'
   AND token.revoked_at IS NULL
   AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now());
ALTER TABLE public.admin_tokens
  ENABLE TRIGGER admin_tokens_protect_recovery;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('c1900000-0000-4000-8000-000000000001', 'operator@example.test', '{}'::jsonb),
  ('c1900000-0000-4000-8000-000000000002', 'security@example.test', '{}'::jsonb),
  ('c1900000-0000-4000-8000-000000000003', 'owner@example.test', '{}'::jsonb),
  ('c1900000-0000-4000-8000-000000000004', 'reporter@example.test', '{}'::jsonb),
  ('c1900000-0000-4000-8000-000000000005', 'target@example.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname, email) VALUES
  ('c1900000-0000-4000-8000-000000000001', 'Capability Operator', 'operator@example.test'),
  ('c1900000-0000-4000-8000-000000000002', 'Capability Security', 'security@example.test'),
  ('c1900000-0000-4000-8000-000000000003', 'Capability Owner', 'owner@example.test'),
  ('c1900000-0000-4000-8000-000000000004', 'Capability Reporter', 'reporter@example.test'),
  ('c1900000-0000-4000-8000-000000000005', 'Capability Target', 'target@example.test')
ON CONFLICT (id) DO UPDATE SET
  nickname = EXCLUDED.nickname,
  email = EXCLUDED.email;

INSERT INTO public.posts (id, user_id, content, status, is_pinned) VALUES (
  'c1900000-0000-4000-8000-000000000020',
  'c1900000-0000-4000-8000-000000000005',
  'capability regression post',
  'active',
  false
);

INSERT INTO public.reports (
  id, reporter_id, target_type, target_id, reason, status
) VALUES (
  'c1900000-0000-4000-8000-000000000030',
  'c1900000-0000-4000-8000-000000000004',
  'post',
  'c1900000-0000-4000-8000-000000000020',
  'capability regression report',
  'pending'
);

INSERT INTO public.admin_tokens (
  id, token_hash, admin_id, admin_name, admin_email, expires_at, revoked_at
) VALUES (
  'c1900000-0000-4000-8000-000000000040',
  pg_catalog.repeat('a', 64),
  'c1900000-0000-4000-8000-000000000001',
  'Capability Operator',
  'operator@example.test',
  pg_catalog.now() + interval '1 day',
  NULL
);

INSERT INTO public.admin_tokens (
  id, token_hash, admin_id, admin_name, admin_email, role, expires_at, revoked_at
) VALUES
  (
    'c1900000-0000-4000-8000-000000000041', pg_catalog.repeat('b', 64),
    'c1900000-0000-4000-8000-000000000002', 'Capability Security',
    'security@example.test', 'security_admin', pg_catalog.now() + interval '1 day', NULL
  ),
  (
    'c1900000-0000-4000-8000-000000000042', pg_catalog.repeat('c', 64),
    'c1900000-0000-4000-8000-000000000003', 'Capability Owner',
    'owner@example.test', 'owner', pg_catalog.now() + interval '2 days', NULL
  ),
  (
    'c1900000-0000-4000-8000-000000000043', pg_catalog.repeat('d', 64),
    'c1900000-0000-4000-8000-000000000004', 'Ordinary Revoke Target',
    'reporter@example.test', 'operator', pg_catalog.now() + interval '1 day', NULL
  ),
  (
    'c1900000-0000-4000-8000-000000000044', pg_catalog.repeat('e', 64),
    'c1900000-0000-4000-8000-000000000003', 'Owner Backup',
    'owner@example.test', 'owner', pg_catalog.now() + interval '2 days', NULL
  ),
  (
    'c1900000-0000-4000-8000-000000000045', pg_catalog.repeat('f', 64),
    'c1900000-0000-4000-8000-000000000003', 'Expired Owner',
    'owner@example.test', 'owner', pg_catalog.now() - interval '1 day', NULL
  );

DO $role_constraint$
BEGIN
  IF (SELECT token.role FROM public.admin_tokens AS token
       WHERE token.id = 'c1900000-0000-4000-8000-000000000040') <> 'operator' THEN
    RAISE EXCEPTION 'token role default did not produce operator';
  END IF;

  BEGIN
    INSERT INTO public.admin_tokens (
      id, token_hash, admin_id, admin_name, admin_email, role, expires_at
    ) VALUES (
      'c1900000-0000-4000-8000-000000000049', pg_catalog.repeat('0', 64),
      'c1900000-0000-4000-8000-000000000001', 'Invalid Role',
      'operator@example.test', 'root', pg_catalog.now() + interval '1 day'
    );
    RAISE EXCEPTION 'invalid administrator role was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$role_constraint$;

CREATE TEMP TABLE admin_capability_regression_results (
  label text PRIMARY KEY,
  result jsonb NOT NULL
) ON COMMIT DROP;
GRANT SELECT, INSERT ON admin_capability_regression_results TO service_role;

SET LOCAL ROLE service_role;

DO $authorization_contract$
DECLARE
  resolved_role text;
  resolved_capabilities text[];
  inventory_role text;
  lifecycle_enabled boolean := pg_catalog.to_regprocedure(
    'public.admin_execute_token_lifecycle(text,uuid,text,text,jsonb)'
  ) IS NOT NULL;
BEGIN
  SELECT auth_row.role, auth_row.capabilities
    INTO resolved_role, resolved_capabilities
    FROM public.admin_token_authorization(pg_catalog.repeat('a', 64)) AS auth_row;
  IF resolved_role <> 'operator'
     OR pg_catalog.cardinality(resolved_capabilities) <> 5
     OR NOT resolved_capabilities @> ARRAY[
       'apply_ban', 'lift_suspension', 'update_report_status',
       'resolve_target_reports', 'takedown_content'
     ]::text[] THEN
    RAISE EXCEPTION 'operator authorization role/capabilities drifted';
  END IF;

  SELECT auth_row.role, auth_row.capabilities
    INTO resolved_role, resolved_capabilities
    FROM public.admin_token_authorization(pg_catalog.repeat('b', 64)) AS auth_row;
  IF resolved_role <> 'security_admin'
     OR (
       lifecycle_enabled
       AND resolved_capabilities <>
         ARRAY['revoke_admin_tokens', 'revoke_token']::text[]
     )
     OR (
       NOT lifecycle_enabled
       AND resolved_capabilities <> ARRAY['revoke_token']::text[]
     ) THEN
    RAISE EXCEPTION 'security authorization role/capabilities drifted';
  END IF;

  SELECT auth_row.role, auth_row.capabilities
    INTO resolved_role, resolved_capabilities
    FROM public.admin_token_authorization(pg_catalog.repeat('c', 64)) AS auth_row;
  IF resolved_role <> 'owner'
     OR pg_catalog.cardinality(resolved_capabilities) <>
       (CASE WHEN lifecycle_enabled THEN 12 ELSE 10 END)
     OR NOT resolved_capabilities @> ARRAY['upload_banner', 'revoke_token']::text[] THEN
    RAISE EXCEPTION 'owner authorization role/capabilities drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.admin_token_authorization(pg_catalog.repeat('9', 64))
  ) THEN
    RAISE EXCEPTION 'unknown token authorization returned a row';
  END IF;

  SELECT inventory.role INTO inventory_role
    FROM public.admin_token_inventory() AS inventory
   WHERE inventory.id = 'c1900000-0000-4000-8000-000000000040';
  IF inventory_role <> 'operator' THEN
    RAISE EXCEPTION 'token inventory omitted/defaulted role incorrectly';
  END IF;
END;
$authorization_contract$;

INSERT INTO admin_capability_regression_results VALUES (
  'operator_moderation',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'c1900000-0000-4000-8000-000000000201',
    pg_catalog.repeat('1', 64),
    'update_report_status',
    pg_catalog.jsonb_build_object(
      'report_id', 'c1900000-0000-4000-8000-000000000030',
      'status', 'reviewed'
    )
  )
);

DO $denied_before_ledger$
BEGIN
  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('a', 64),
      'c1900000-0000-4000-8000-000000000202',
      pg_catalog.repeat('2', 64),
      'set_post_pinned',
      pg_catalog.jsonb_build_object(
        'post_id', 'c1900000-0000-4000-8000-000000000020',
        'pinned', true
      )
    );
    RAISE EXCEPTION 'operator plaza mutation was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'admin_capability_denied' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('a', 64),
      'c1900000-0000-4000-8000-000000000203',
      pg_catalog.repeat('3', 64),
      'revoke_token',
      pg_catalog.jsonb_build_object(
        'token_id', 'c1900000-0000-4000-8000-000000000043'
      )
    );
    RAISE EXCEPTION 'operator token revoke was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'admin_capability_denied' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('b', 64),
      'c1900000-0000-4000-8000-000000000204',
      pg_catalog.repeat('4', 64),
      'apply_ban',
      pg_catalog.jsonb_build_object(
        'target_id', 'c1900000-0000-4000-8000-000000000005',
        'level', 1,
        'reason', 'security role must not moderate',
        'category', 'regression'
      )
    );
    RAISE EXCEPTION 'security_admin moderation was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'admin_capability_denied' THEN RAISE; END IF;
  END;
END;
$denied_before_ledger$;

RESET ROLE;

DO $denied_rollback_proof$
BEGIN
  IF (SELECT post.is_pinned FROM public.posts AS post
       WHERE post.id = 'c1900000-0000-4000-8000-000000000020') IS NOT FALSE THEN
    RAISE EXCEPTION 'denied operator plaza mutation changed business state';
  END IF;
  IF (SELECT token.revoked_at FROM public.admin_tokens AS token
       WHERE token.id = 'c1900000-0000-4000-8000-000000000043') IS NOT NULL THEN
    RAISE EXCEPTION 'denied operator revoke changed the target token';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.suspensions AS suspension
     WHERE suspension.reason = 'security role must not moderate'
  ) THEN
    RAISE EXCEPTION 'denied security moderation changed business state';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.admin_mutation_requests AS request
     WHERE request.idempotency_key IN (
       'c1900000-0000-4000-8000-000000000202'::uuid,
       'c1900000-0000-4000-8000-000000000203'::uuid,
       'c1900000-0000-4000-8000-000000000204'::uuid
     )
  ) OR EXISTS (
    SELECT 1 FROM public.admin_audit_log AS audit
     WHERE audit.idempotency_key IN (
       'c1900000-0000-4000-8000-000000000202'::uuid,
       'c1900000-0000-4000-8000-000000000203'::uuid,
       'c1900000-0000-4000-8000-000000000204'::uuid
     )
  ) THEN
    RAISE EXCEPTION 'capability denial left ledger/audit state';
  END IF;
END;
$denied_rollback_proof$;

SET LOCAL ROLE service_role;

INSERT INTO admin_capability_regression_results VALUES (
  'owner_plaza',
  public.admin_execute_mutation(
    pg_catalog.repeat('c', 64),
    'c1900000-0000-4000-8000-000000000205',
    pg_catalog.repeat('5', 64),
    'set_post_pinned',
    pg_catalog.jsonb_build_object(
      'post_id', 'c1900000-0000-4000-8000-000000000020',
      'pinned', true
    )
  )
);

INSERT INTO admin_capability_regression_results VALUES (
  'security_revoke_operator',
  public.admin_execute_mutation(
    pg_catalog.repeat('b', 64),
    'c1900000-0000-4000-8000-000000000206',
    pg_catalog.repeat('6', 64),
    'revoke_token',
    pg_catalog.jsonb_build_object(
      'token_id', 'c1900000-0000-4000-8000-000000000043',
      'case_id', 'CASE-CAPABILITY-206',
      'approval_ref', 'APPROVAL-CAPABILITY-206'
    )
  )
);

INSERT INTO admin_capability_regression_results VALUES (
  'security_revoke_owner_backup',
  public.admin_execute_mutation(
    pg_catalog.repeat('b', 64),
    'c1900000-0000-4000-8000-000000000207',
    pg_catalog.repeat('7', 64),
    'revoke_token',
    pg_catalog.jsonb_build_object(
      'token_id', 'c1900000-0000-4000-8000-000000000044',
      'case_id', 'CASE-CAPABILITY-207',
      'approval_ref', 'APPROVAL-CAPABILITY-207'
    )
  )
);

INSERT INTO admin_capability_regression_results VALUES (
  'owner_revoke_expired_owner',
  public.admin_execute_mutation(
    pg_catalog.repeat('c', 64),
    'c1900000-0000-4000-8000-000000000208',
    pg_catalog.repeat('8', 64),
    'revoke_token',
    pg_catalog.jsonb_build_object(
      'token_id', 'c1900000-0000-4000-8000-000000000045',
      'case_id', 'CASE-CAPABILITY-208',
      'approval_ref', 'APPROVAL-CAPABILITY-208'
    )
  )
);

INSERT INTO admin_capability_regression_results VALUES (
  'owner_moderation',
  public.admin_execute_mutation(
    pg_catalog.repeat('c', 64),
    'c1900000-0000-4000-8000-000000000209',
    pg_catalog.repeat('9', 64),
    'apply_ban',
    pg_catalog.jsonb_build_object(
      'target_id', 'c1900000-0000-4000-8000-000000000005',
      'level', 1,
      'reason', 'owner moderation regression',
      'category', 'regression'
    )
  )
);

DO $last_owner_protection$
BEGIN
  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('b', 64),
      'c1900000-0000-4000-8000-000000000210',
      pg_catalog.repeat('a', 64),
      'revoke_token',
      pg_catalog.jsonb_build_object(
        'token_id', 'c1900000-0000-4000-8000-000000000042',
        'case_id', 'CASE-CAPABILITY-210',
        'approval_ref', 'APPROVAL-CAPABILITY-210'
      )
    );
    RAISE EXCEPTION 'last active owner token was revoked through wrapper';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'last_active_owner_token' THEN RAISE; END IF;
  END;

  -- After the lifecycle migration, service_role has no raw mutation escape
  -- hatch. Before it, preserve the historical recovery-trigger assertion.
  BEGIN
    UPDATE public.admin_tokens AS token
       SET revoked_at = pg_catalog.now()
     WHERE token.id = 'c1900000-0000-4000-8000-000000000042';
    RAISE EXCEPTION 'last active owner token was revoked by direct PATCH';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF pg_catalog.to_regprocedure(
           'public.admin_execute_token_lifecycle(text,uuid,text,text,jsonb)'
         ) IS NULL THEN
        RAISE;
      END IF;
    WHEN object_not_in_prerequisite_state THEN
      IF pg_catalog.to_regprocedure(
           'public.admin_execute_token_lifecycle(text,uuid,text,text,jsonb)'
         ) IS NOT NULL OR SQLERRM <> 'last_active_owner_token' THEN
        RAISE;
      END IF;
  END;
END;
$last_owner_protection$;

RESET ROLE;

DO $committed_contracts$
DECLARE
  expected_success_keys uuid[] := ARRAY[
    'c1900000-0000-4000-8000-000000000201'::uuid,
    'c1900000-0000-4000-8000-000000000205'::uuid,
    'c1900000-0000-4000-8000-000000000206'::uuid,
    'c1900000-0000-4000-8000-000000000207'::uuid,
    'c1900000-0000-4000-8000-000000000208'::uuid,
    'c1900000-0000-4000-8000-000000000209'::uuid
  ];
BEGIN
  IF EXISTS (
    SELECT 1 FROM admin_capability_regression_results AS result_row
     WHERE result_row.label IN (
       'operator_moderation', 'owner_plaza', 'security_revoke_operator',
       'security_revoke_owner_backup', 'owner_revoke_expired_owner'
     )
       AND result_row.result <> '{"success": true}'::jsonb
  ) THEN
    RAISE EXCEPTION 'capability success response contract drifted';
  END IF;
  IF NOT (
    SELECT result_row.result ? 'data'
      FROM admin_capability_regression_results AS result_row
     WHERE result_row.label = 'owner_moderation'
  ) THEN
    RAISE EXCEPTION 'owner moderation response contract drifted';
  END IF;

  IF (SELECT report.status FROM public.reports AS report
       WHERE report.id = 'c1900000-0000-4000-8000-000000000030') <> 'reviewed'
     OR (SELECT post.is_pinned FROM public.posts AS post
          WHERE post.id = 'c1900000-0000-4000-8000-000000000020') IS NOT TRUE THEN
    RAISE EXCEPTION 'allowed operator/owner business mutation failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.admin_tokens AS token
     WHERE token.id IN (
       'c1900000-0000-4000-8000-000000000043'::uuid,
       'c1900000-0000-4000-8000-000000000044'::uuid,
       'c1900000-0000-4000-8000-000000000045'::uuid
     )
       AND token.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'allowed security/owner token revoke failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_tokens AS token
     WHERE token.id = 'c1900000-0000-4000-8000-000000000042'
       AND token.role = 'owner'
       AND token.revoked_at IS NULL
       AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
  ) THEN
    RAISE EXCEPTION 'last active owner protection changed recovery state';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.admin_tokens AS token
       WHERE token.role = 'owner'
         AND token.revoked_at IS NULL
         AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())) <> 1 THEN
    RAISE EXCEPTION 'expired owner was counted as an active recovery credential';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.suspensions AS suspension
     WHERE suspension.reason = 'owner moderation regression'
       AND suspension.issued_by = 'c1900000-0000-4000-8000-000000000003'
  ) THEN
    RAISE EXCEPTION 'owner actor did not reach moderation evidence';
  END IF;

  IF (SELECT pg_catalog.count(*) FROM public.admin_mutation_requests AS request
       WHERE request.idempotency_key = ANY(expected_success_keys)
         AND request.status = 'completed') <> 6
     OR (SELECT pg_catalog.count(*) FROM public.admin_audit_log AS audit
          WHERE audit.idempotency_key = ANY(expected_success_keys)) <> 6 THEN
    RAISE EXCEPTION 'expected exactly one completed ledger/audit row per allowed mutation';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.admin_audit_log AS audit
     WHERE audit.idempotency_key = ANY(expected_success_keys)
       AND audit.details ->> 'admin_role' IS DISTINCT FROM CASE
         WHEN audit.idempotency_key = 'c1900000-0000-4000-8000-000000000201'::uuid
           THEN 'operator'
         WHEN audit.idempotency_key IN (
           'c1900000-0000-4000-8000-000000000206'::uuid,
           'c1900000-0000-4000-8000-000000000207'::uuid
         ) THEN 'security_admin'
         ELSE 'owner'
       END
  ) THEN
    RAISE EXCEPTION 'required audit role snapshot is missing or incorrect';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.admin_mutation_requests AS request
     WHERE request.idempotency_key = 'c1900000-0000-4000-8000-000000000210'
  ) OR EXISTS (
    SELECT 1 FROM public.admin_audit_log AS audit
     WHERE audit.idempotency_key = 'c1900000-0000-4000-8000-000000000210'
  ) THEN
    RAISE EXCEPTION 'last-owner rejection left ledger/audit state';
  END IF;
END;
$committed_contracts$;

-- Re-test the required-audit rollback contract after record_audit was replaced
-- to add the role snapshot. Legacy context-free audit remains best effort.
ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_capability_forced_failure
  CHECK (details ->> 'reason' IS DISTINCT FROM 'capability-forced-audit-failure')
  NOT VALID;

SET LOCAL ROLE service_role;

DO $required_audit_failure$
BEGIN
  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('a', 64),
      'c1900000-0000-4000-8000-000000000211',
      pg_catalog.repeat('b', 64),
      'apply_ban',
      pg_catalog.jsonb_build_object(
        'target_id', 'c1900000-0000-4000-8000-000000000005',
        'level', 1,
        'reason', 'capability-forced-audit-failure',
        'category', 'regression'
      )
    );
    RAISE EXCEPTION 'role-aware mutation committed despite required audit failure';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'admin_audit_required_failed' THEN RAISE; END IF;
  END;

  PERFORM public.record_audit(
    'ban_applied',
    'c1900000-0000-4000-8000-000000000001',
    'c1900000-0000-4000-8000-000000000005',
    pg_catalog.jsonb_build_object(
      'reason', 'capability-forced-audit-failure'
    )
  );
END;
$required_audit_failure$;

RESET ROLE;

DO $required_audit_rollback_proof$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.suspensions AS suspension
     WHERE suspension.reason = 'capability-forced-audit-failure'
  ) OR EXISTS (
    SELECT 1 FROM public.admin_mutation_requests AS request
     WHERE request.idempotency_key = 'c1900000-0000-4000-8000-000000000211'
  ) OR EXISTS (
    SELECT 1 FROM public.admin_audit_log AS audit
     WHERE audit.idempotency_key = 'c1900000-0000-4000-8000-000000000211'
        OR audit.details ->> 'reason' = 'capability-forced-audit-failure'
  ) THEN
    RAISE EXCEPTION 'role-aware required/best-effort audit rollback failed';
  END IF;
  IF (SELECT profile.warning_count FROM public.profiles AS profile
       WHERE profile.id = 'c1900000-0000-4000-8000-000000000005') <> 1 THEN
    RAISE EXCEPTION 'failed required audit changed warning count';
  END IF;
END;
$required_audit_rollback_proof$;

ALTER TABLE public.admin_audit_log
  DROP CONSTRAINT admin_audit_log_capability_forced_failure;

ROLLBACK;
