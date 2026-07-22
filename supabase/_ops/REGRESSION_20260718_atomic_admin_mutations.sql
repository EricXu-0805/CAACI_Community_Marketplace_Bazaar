-- Isolated/local behavior regression for atomic administrator mutations.
-- NEVER run against production.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a1800000-0000-4000-8000-000000000001', 'atomic-admin@example.test', '{}'::jsonb),
  ('a1800000-0000-4000-8000-000000000002', 'atomic-target@example.test', '{}'::jsonb),
  ('a1800000-0000-4000-8000-000000000003', 'atomic-reporter-one@example.test', '{}'::jsonb),
  ('a1800000-0000-4000-8000-000000000004', 'atomic-reporter-two@example.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname, email) VALUES
  ('a1800000-0000-4000-8000-000000000001', 'Atomic Admin', 'atomic-admin@example.test'),
  ('a1800000-0000-4000-8000-000000000002', 'Atomic Target', 'atomic-target@example.test'),
  ('a1800000-0000-4000-8000-000000000003', 'Atomic Reporter One', 'atomic-reporter-one@example.test'),
  ('a1800000-0000-4000-8000-000000000004', 'Atomic Reporter Two', 'atomic-reporter-two@example.test')
ON CONFLICT (id) DO UPDATE SET
  nickname = EXCLUDED.nickname,
  email = EXCLUDED.email;

INSERT INTO public.posts (id, user_id, content, status, is_pinned) VALUES
  ('a1800000-0000-4000-8000-000000000020', 'a1800000-0000-4000-8000-000000000002', 'reported post', 'active', false),
  ('a1800000-0000-4000-8000-000000000021', 'a1800000-0000-4000-8000-000000000002', 'pin post', 'active', false);

INSERT INTO public.reports (id, reporter_id, target_type, target_id, reason, status) VALUES
  ('a1800000-0000-4000-8000-000000000030', 'a1800000-0000-4000-8000-000000000003', 'post', 'a1800000-0000-4000-8000-000000000020', 'first report', 'pending'),
  ('a1800000-0000-4000-8000-000000000031', 'a1800000-0000-4000-8000-000000000004', 'post', 'a1800000-0000-4000-8000-000000000020', 'second report', 'pending');

INSERT INTO public.admin_tokens (
  id, token_hash, admin_id, admin_name, admin_email, expires_at, revoked_at,
  role
) VALUES
  (
    'a1800000-0000-4000-8000-000000000040', pg_catalog.repeat('a', 64),
    'a1800000-0000-4000-8000-000000000001', 'Atomic Admin',
    'atomic-admin@example.test', pg_catalog.now() + interval '1 day', NULL,
    'owner'
  ),
  (
    'a1800000-0000-4000-8000-000000000041', pg_catalog.repeat('b', 64),
    'a1800000-0000-4000-8000-000000000001', 'Revoked Admin',
    'atomic-admin@example.test', pg_catalog.now() + interval '1 day', pg_catalog.now(),
    'operator'
  ),
  (
    'a1800000-0000-4000-8000-000000000042', pg_catalog.repeat('c', 64),
    'a1800000-0000-4000-8000-000000000001', 'Expired Admin',
    'atomic-admin@example.test', pg_catalog.now() - interval '1 day', NULL,
    'operator'
  ),
  (
    'a1800000-0000-4000-8000-000000000043', pg_catalog.repeat('d', 64),
    'a1800000-0000-4000-8000-000000000001', 'Revocation Target',
    'atomic-admin@example.test', pg_catalog.now() + interval '1 day', NULL,
    'operator'
  );

-- The final banner boundary accepts only completed deterministic upload-saga
-- objects. Seed one trusted completed upload so this older suite can continue
-- to test the atomic admin mutation wrapper; the saga itself has a dedicated
-- behavioral regression.
INSERT INTO public.admin_banner_uploads (
  id,
  admin_token_id,
  idempotency_key,
  actor_id,
  admin_role,
  content_hash,
  mime_type,
  size_bytes,
  object_name,
  status,
  completed_at,
  gc_after
) VALUES (
  'a1800000-0000-4000-8000-000000000050',
  'a1800000-0000-4000-8000-000000000040',
  'a1800000-0000-4000-8000-000000000107',
  'a1800000-0000-4000-8000-000000000001',
  'owner',
  pg_catalog.repeat('7', 64),
  'image/png',
  128,
  'managed/a1800000-0000-4000-8000-000000000040/a1800000-0000-4000-8000-000000000107/'
    || pg_catalog.repeat('7', 64) || '.png',
  'available',
  pg_catalog.now(),
  pg_catalog.now() + interval '24 hours'
);

CREATE TEMP TABLE admin_mutation_regression_results (
  label text PRIMARY KEY,
  result jsonb NOT NULL
) ON COMMIT DROP;
GRANT SELECT, INSERT ON admin_mutation_regression_results TO service_role;

SET LOCAL ROLE service_role;

INSERT INTO admin_mutation_regression_results VALUES (
  'apply_first',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'a1800000-0000-4000-8000-000000000101',
    pg_catalog.repeat('1', 64),
    'apply_ban',
    pg_catalog.jsonb_build_object(
      'target_id', 'a1800000-0000-4000-8000-000000000002',
      'level', 1,
      'reason', 'atomic replay warning',
      'category', 'regression'
    )
  )
);

INSERT INTO admin_mutation_regression_results VALUES (
  'apply_replay',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'a1800000-0000-4000-8000-000000000101',
    pg_catalog.repeat('1', 64),
    'apply_ban',
    pg_catalog.jsonb_build_object(
      'target_id', 'a1800000-0000-4000-8000-000000000002',
      'level', 1,
      'reason', 'atomic replay warning',
      'category', 'regression'
    )
  )
);

DO $conflicts_and_inactive$
BEGIN
  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('a', 64),
      'a1800000-0000-4000-8000-000000000101',
      pg_catalog.repeat('2', 64),
      'apply_ban',
      pg_catalog.jsonb_build_object(
        'target_id', 'a1800000-0000-4000-8000-000000000002',
        'level', 1,
        'reason', 'hash conflict',
        'category', 'regression'
      )
    );
    RAISE EXCEPTION 'same key with a different payload hash was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'idempotency_conflict' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('a', 64),
      'a1800000-0000-4000-8000-000000000101',
      pg_catalog.repeat('1', 64),
      'set_post_pinned',
      pg_catalog.jsonb_build_object(
        'post_id', 'a1800000-0000-4000-8000-000000000021',
        'pinned', true
      )
    );
    RAISE EXCEPTION 'same key/hash with a different action was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'idempotency_conflict' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('b', 64),
      'a1800000-0000-4000-8000-000000000120',
      pg_catalog.repeat('2', 64),
      'set_post_pinned',
      pg_catalog.jsonb_build_object(
        'post_id', 'a1800000-0000-4000-8000-000000000021',
        'pinned', true
      )
    );
    RAISE EXCEPTION 'revoked caller token was accepted';
  EXCEPTION WHEN invalid_authorization_specification THEN
    IF SQLERRM <> 'admin_token_inactive' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('c', 64),
      'a1800000-0000-4000-8000-000000000121',
      pg_catalog.repeat('2', 64),
      'set_post_pinned',
      pg_catalog.jsonb_build_object(
        'post_id', 'a1800000-0000-4000-8000-000000000021',
        'pinned', true
      )
    );
    RAISE EXCEPTION 'expired caller token was accepted';
  EXCEPTION WHEN invalid_authorization_specification THEN
    IF SQLERRM <> 'admin_token_inactive' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('a', 64),
      'a1800000-0000-4000-8000-000000000113',
      pg_catalog.repeat('3', 64),
      'set_post_pinned',
      pg_catalog.jsonb_build_object(
        'post_id', 'a1800000-0000-4000-8000-000000000099',
        'pinned', true
      )
    );
    RAISE EXCEPTION 'missing post was reported as success';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM <> 'post_not_found' THEN RAISE; END IF;
  END;
END
$conflicts_and_inactive$;

INSERT INTO admin_mutation_regression_results VALUES (
  'lift',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'a1800000-0000-4000-8000-000000000102',
    pg_catalog.repeat('2', 64),
    'lift_suspension',
    pg_catalog.jsonb_build_object(
      'suspension_id', (
        SELECT result ->> 'data'
          FROM admin_mutation_regression_results
         WHERE label = 'apply_first'
      ),
      'reason', 'accepted regression appeal'
    )
  )
);

INSERT INTO admin_mutation_regression_results VALUES (
  'update_report',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'a1800000-0000-4000-8000-000000000103',
    pg_catalog.repeat('3', 64),
    'update_report_status',
    pg_catalog.jsonb_build_object(
      'report_id', 'a1800000-0000-4000-8000-000000000030',
      'status', 'reviewed'
    )
  )
);

INSERT INTO admin_mutation_regression_results VALUES (
  'resolve_reports',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'a1800000-0000-4000-8000-000000000104',
    pg_catalog.repeat('4', 64),
    'resolve_target_reports',
    pg_catalog.jsonb_build_object(
      'target_type', 'post',
      'target_id', 'a1800000-0000-4000-8000-000000000020',
      'status', 'resolved'
    )
  )
);

INSERT INTO admin_mutation_regression_results VALUES (
  'takedown',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'a1800000-0000-4000-8000-000000000105',
    pg_catalog.repeat('5', 64),
    'takedown_content',
    pg_catalog.jsonb_build_object(
      'target_type', 'post',
      'target_id', 'a1800000-0000-4000-8000-000000000020',
      'reason', 'confirmed regression abuse'
    )
  )
);

INSERT INTO admin_mutation_regression_results VALUES (
  'pin',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'a1800000-0000-4000-8000-000000000106',
    pg_catalog.repeat('6', 64),
    'set_post_pinned',
    pg_catalog.jsonb_build_object(
      'post_id', 'a1800000-0000-4000-8000-000000000021',
      'pinned', true
    )
  )
);

INSERT INTO admin_mutation_regression_results VALUES (
  'banner_create',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'a1800000-0000-4000-8000-000000000107',
    pg_catalog.repeat('7', 64),
    'upsert_banner',
    pg_catalog.jsonb_build_object(
      'image_url', 'https://project.example.test/storage/v1/object/public/banners/managed/'
        || 'a1800000-0000-4000-8000-000000000040/'
        || 'a1800000-0000-4000-8000-000000000107/'
        || pg_catalog.repeat('7', 64) || '.png',
      'target_url', '/pages/plaza/index',
      'title_en', 'Atomic banner',
      'priority', 7,
      'active', true,
      'is_default', false
    )
  )
);

INSERT INTO admin_mutation_regression_results VALUES (
  'banner_update',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'a1800000-0000-4000-8000-000000000108',
    pg_catalog.repeat('8', 64),
    'upsert_banner',
    pg_catalog.jsonb_build_object(
      'id', (
        SELECT result -> 'data' ->> 'id'
          FROM admin_mutation_regression_results
         WHERE label = 'banner_create'
      ),
      'title_en', 'Atomic banner updated',
      'priority', 8
    )
  )
);

INSERT INTO admin_mutation_regression_results VALUES (
  'banner_delete',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'a1800000-0000-4000-8000-000000000109',
    pg_catalog.repeat('9', 64),
    'delete_banner',
    pg_catalog.jsonb_build_object(
      'id', (
        SELECT result -> 'data' ->> 'id'
          FROM admin_mutation_regression_results
         WHERE label = 'banner_create'
      )
    )
  )
);

DO $self_revoke$
BEGIN
  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('a', 64),
      'a1800000-0000-4000-8000-000000000111',
      pg_catalog.repeat('f', 64),
      'revoke_token',
      pg_catalog.jsonb_build_object(
        'token_id', 'a1800000-0000-4000-8000-000000000040',
        'case_id', 'CASE-ATOMIC-111',
        'approval_ref', 'APPROVAL-ATOMIC-111'
      )
    );
    RAISE EXCEPTION 'self revoke was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'self_revoke_forbidden' THEN RAISE; END IF;
  END;
END
$self_revoke$;

INSERT INTO admin_mutation_regression_results VALUES (
  'revoke',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'a1800000-0000-4000-8000-000000000110',
    pg_catalog.repeat('e', 64),
    'revoke_token',
    pg_catalog.jsonb_build_object(
      'token_id', 'a1800000-0000-4000-8000-000000000043',
      'case_id', 'CASE-ATOMIC-110',
      'approval_ref', 'APPROVAL-ATOMIC-110'
    )
  )
);

-- An expired-but-unrevoked target is not part of the active-token count. It
-- remains revocable for cleanup and must not trip the last-active guard.
INSERT INTO admin_mutation_regression_results VALUES (
  'revoke_expired',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'a1800000-0000-4000-8000-000000000114',
    pg_catalog.repeat('4', 64),
    'revoke_token',
    pg_catalog.jsonb_build_object(
      'token_id', 'a1800000-0000-4000-8000-000000000042',
      'case_id', 'CASE-ATOMIC-114',
      'approval_ref', 'APPROVAL-ATOMIC-114'
    )
  )
);

-- With exactly one active and unexpired token left, its revocation must fail
-- before any token, audit, or idempotency-ledger state can change.
-- Switch back to the fixture owner because direct ledger/audit reads are
-- intentionally denied to service_role; the SECURITY DEFINER mutation RPC
-- still performs the tested call through its production privilege boundary.
RESET ROLE;

DO $last_active_revoke$
DECLARE
  token_revoked_at_before timestamptz;
  ledger_count_before bigint;
  audit_count_before bigint;
BEGIN
  SELECT token.revoked_at INTO token_revoked_at_before
    FROM public.admin_tokens AS token
   WHERE token.id = 'a1800000-0000-4000-8000-000000000040';
  SELECT pg_catalog.count(*) INTO ledger_count_before
    FROM public.admin_mutation_requests;
  SELECT pg_catalog.count(*) INTO audit_count_before
    FROM public.admin_audit_log;

  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('a', 64),
      'a1800000-0000-4000-8000-000000000115',
      pg_catalog.repeat('5', 64),
      'revoke_token',
      pg_catalog.jsonb_build_object(
        'token_id', 'a1800000-0000-4000-8000-000000000040',
        'case_id', 'CASE-ATOMIC-115',
        'approval_ref', 'APPROVAL-ATOMIC-115'
      )
    );
    RAISE EXCEPTION 'last active admin token was revoked';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'last_active_admin_token' THEN RAISE; END IF;
  END;

  IF (SELECT token.revoked_at FROM public.admin_tokens AS token
       WHERE token.id = 'a1800000-0000-4000-8000-000000000040')
       IS DISTINCT FROM token_revoked_at_before THEN
    RAISE EXCEPTION 'last-active rejection changed the token';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.admin_mutation_requests)
       <> ledger_count_before THEN
    RAISE EXCEPTION 'last-active rejection left an idempotency row';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.admin_audit_log)
       <> audit_count_before THEN
    RAISE EXCEPTION 'last-active rejection left an audit row';
  END IF;
END
$last_active_revoke$;

DO $committed_contracts$
DECLARE
  first_result jsonb;
  replay_result jsonb;
  suspension_id uuid;
  request_count integer;
  audit_count integer;
BEGIN
  SELECT result INTO first_result
    FROM admin_mutation_regression_results WHERE label = 'apply_first';
  SELECT result INTO replay_result
    FROM admin_mutation_regression_results WHERE label = 'apply_replay';
  IF first_result IS DISTINCT FROM replay_result THEN
    RAISE EXCEPTION 'completed result was not replayed verbatim';
  END IF;
  suspension_id := (first_result ->> 'data')::uuid;

  IF (SELECT pg_catalog.count(*) FROM public.suspensions AS suspension
       WHERE suspension.reason = 'atomic replay warning') <> 1 THEN
    RAISE EXCEPTION 'idempotent apply created duplicate suspensions';
  END IF;
  IF (SELECT profile.warning_count FROM public.profiles AS profile
       WHERE profile.id = 'a1800000-0000-4000-8000-000000000002') <> 1 THEN
    RAISE EXCEPTION 'idempotent apply duplicated warning_count';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.suspensions AS suspension
     WHERE suspension.id = suspension_id
       AND suspension.issued_by = 'a1800000-0000-4000-8000-000000000001'
       AND suspension.lifted_by = 'a1800000-0000-4000-8000-000000000001'
       AND suspension.lifted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'admin actor did not reach issued_by/lifted_by evidence';
  END IF;

  IF (SELECT report.status FROM public.reports AS report
       WHERE report.id = 'a1800000-0000-4000-8000-000000000030') <> 'reviewed'
     OR (SELECT report.status FROM public.reports AS report
          WHERE report.id = 'a1800000-0000-4000-8000-000000000031') <> 'resolved' THEN
    RAISE EXCEPTION 'single/bulk report status mutation failed';
  END IF;
  IF (SELECT post.status FROM public.posts AS post
       WHERE post.id = 'a1800000-0000-4000-8000-000000000020') <> 'hidden'
     OR (SELECT post.is_pinned FROM public.posts AS post
          WHERE post.id = 'a1800000-0000-4000-8000-000000000021') IS NOT TRUE THEN
    RAISE EXCEPTION 'takedown/pin mutation failed';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.banners AS banner
     WHERE banner.id = (
       SELECT (result -> 'data' ->> 'id')::uuid
         FROM admin_mutation_regression_results
        WHERE label = 'banner_create'
     )
  ) THEN
    RAISE EXCEPTION 'banner delete did not remove the created row';
  END IF;
  IF (SELECT result -> 'data' ->> 'title_en'
        FROM admin_mutation_regression_results
       WHERE label = 'banner_update') <> 'Atomic banner updated'
     OR NOT (
       SELECT result -> 'data' ?& ARRAY['id', 'image_url', 'created_at', 'updated_at', 'is_default']
         FROM admin_mutation_regression_results
        WHERE label = 'banner_update'
     ) THEN
    RAISE EXCEPTION 'upsert banner did not return the complete updated row';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_tokens AS token
     WHERE token.id = 'a1800000-0000-4000-8000-000000000043'
       AND token.revoked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'token revoke did not persist';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_tokens AS token
     WHERE token.id = 'a1800000-0000-4000-8000-000000000042'
       AND token.expires_at <= pg_catalog.now()
       AND token.revoked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'expired token cleanup revoke was blocked or did not persist';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM admin_mutation_regression_results AS result_row
     WHERE result_row.label IN (
       'lift', 'update_report', 'pin', 'banner_delete', 'revoke', 'revoke_expired'
     )
       AND result_row.result <> '{"success": true}'::jsonb
  ) THEN
    RAISE EXCEPTION 'success response contract drifted';
  END IF;
  IF (SELECT result -> 'data' ->> 'affected'
        FROM admin_mutation_regression_results WHERE label = 'resolve_reports') <> '1'
     OR (SELECT result -> 'data' ->> 'affected'
          FROM admin_mutation_regression_results WHERE label = 'takedown') <> '1' THEN
    RAISE EXCEPTION 'wrapped legacy jsonb result contract drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO request_count
    FROM public.admin_mutation_requests AS request
   WHERE request.admin_token_id = 'a1800000-0000-4000-8000-000000000040'
     AND request.status = 'completed';
  IF request_count <> 11 THEN
    RAISE EXCEPTION 'expected 11 completed idempotency rows, got %', request_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO audit_count
    FROM public.admin_audit_log AS audit
   WHERE audit.admin_token_id = 'a1800000-0000-4000-8000-000000000040';
  IF audit_count <> 11 THEN
    RAISE EXCEPTION 'expected exactly one required audit per mutation, got %', audit_count;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.admin_mutation_requests AS request
      LEFT JOIN public.admin_audit_log AS audit
        ON audit.admin_token_id = request.admin_token_id
       AND audit.idempotency_key = request.idempotency_key
     WHERE request.admin_token_id = 'a1800000-0000-4000-8000-000000000040'
       AND (
         audit.id IS NULL
         OR audit.actor_id <> 'a1800000-0000-4000-8000-000000000001'
         OR audit.details ->> 'admin_token_id' <> request.admin_token_id::text
         OR audit.details ->> 'idempotency_key' <> request.idempotency_key::text
       )
  ) THEN
    RAISE EXCEPTION 'required audit actor/token/key linkage is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.admin_mutation_requests AS request
     WHERE request.idempotency_key IN (
       'a1800000-0000-4000-8000-000000000111'::uuid,
       'a1800000-0000-4000-8000-000000000115'::uuid,
       'a1800000-0000-4000-8000-000000000113'::uuid,
       'a1800000-0000-4000-8000-000000000120'::uuid,
       'a1800000-0000-4000-8000-000000000121'::uuid
     )
  ) THEN
    RAISE EXCEPTION 'failed/unauthorized mutation left an idempotency row';
  END IF;
END
$committed_contracts$;

-- Force the required audit INSERT to fail. The mutation and its idempotency
-- row must roll back with it; a context-free legacy call must remain best effort.
ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_regression_forced_failure
  CHECK (details ->> 'reason' IS DISTINCT FROM 'forced-audit-failure')
  NOT VALID;

SET LOCAL ROLE service_role;

DO $required_audit_failure$
BEGIN
  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('a', 64),
      'a1800000-0000-4000-8000-000000000112',
      pg_catalog.repeat('f', 64),
      'apply_ban',
      pg_catalog.jsonb_build_object(
        'target_id', 'a1800000-0000-4000-8000-000000000002',
        'level', 1,
        'reason', 'forced-audit-failure',
        'category', 'regression'
      )
    );
    RAISE EXCEPTION 'mutation committed despite required audit failure';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'admin_audit_required_failed' THEN RAISE; END IF;
  END;

  -- No admin.* required context is active here. This insert violates the same
  -- temporary constraint but record_audit must preserve legacy best effort.
  PERFORM public.record_audit(
    'ban_applied',
    'a1800000-0000-4000-8000-000000000001',
    'a1800000-0000-4000-8000-000000000002',
    pg_catalog.jsonb_build_object('reason', 'forced-audit-failure')
  );
END
$required_audit_failure$;

RESET ROLE;

DO $rollback_proof$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.suspensions AS suspension
     WHERE suspension.reason = 'forced-audit-failure'
  ) THEN
    RAISE EXCEPTION 'business mutation survived required audit failure';
  END IF;
  IF (SELECT profile.warning_count FROM public.profiles AS profile
       WHERE profile.id = 'a1800000-0000-4000-8000-000000000002') <> 1 THEN
    RAISE EXCEPTION 'warning count survived required audit failure';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.admin_mutation_requests AS request
     WHERE request.idempotency_key = 'a1800000-0000-4000-8000-000000000112'
  ) THEN
    RAISE EXCEPTION 'idempotency row survived required audit failure';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.admin_audit_log AS audit
     WHERE audit.details ->> 'reason' = 'forced-audit-failure'
  ) THEN
    RAISE EXCEPTION 'failed required/best-effort audit row was persisted';
  END IF;
END
$rollback_proof$;

ALTER TABLE public.admin_audit_log
  DROP CONSTRAINT admin_audit_log_regression_forced_failure;

ROLLBACK;
