-- Isolated/local behavioral regression for the atomic administrator appeal
-- lifecycle. NEVER run against production. Every fixture mutation rolls back.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a2050000-0000-4000-8000-000000000001', 'appeal-owner@example.test', '{}'),
  ('a2050000-0000-4000-8000-000000000002', 'appeal-operator@example.test', '{}'),
  ('a2050000-0000-4000-8000-000000000003', 'appeal-security@example.test', '{}'),
  ('a2050000-0000-4000-8000-000000000004', 'appeal-target@example.test', '{}'),
  ('a2050000-0000-4000-8000-000000000005', 'appeal-other@example.test', '{}'),
  ('a2050000-0000-4000-8000-000000000006', 'appeal-denied@example.test', '{}'),
  ('a2050000-0000-4000-8000-000000000007', 'appeal-expired@example.test', '{}'),
  ('a2050000-0000-4000-8000-000000000008', 'appeal-lifted@example.test', '{}'),
  ('a2050000-0000-4000-8000-000000000009', 'literal-percent@example.test', '{}'),
  ('a2050000-0000-4000-8000-000000000010', 'literal-control-x@example.test', '{}'),
  ('a2050000-0000-4000-8000-000000000011', 'literal-underscore@example.test', '{}'),
  ('a2050000-0000-4000-8000-000000000012', 'literal-control-y@example.test', '{}'),
  ('a2050000-0000-4000-8000-000000000013', 'literal-slash@example.test', '{}'),
  ('a2050000-0000-4000-8000-000000000014', 'literal-control-z@example.test', '{}'),
  ('a2050000-0000-4000-8000-000000000015', 'appeal-new-filing@example.test', '{}')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.profiles (id, nickname, email) VALUES
  ('a2050000-0000-4000-8000-000000000001', 'Appeal Owner', 'appeal-owner@example.test'),
  ('a2050000-0000-4000-8000-000000000002', 'Appeal Operator', 'appeal-operator@example.test'),
  ('a2050000-0000-4000-8000-000000000003', 'Appeal Security', 'appeal-security@example.test'),
  ('a2050000-0000-4000-8000-000000000004', 'Appeal Target', 'appeal-target@example.test'),
  ('a2050000-0000-4000-8000-000000000005', 'Appeal Other', 'appeal-other@example.test'),
  ('a2050000-0000-4000-8000-000000000006', 'Appeal Denied', 'appeal-denied@example.test'),
  ('a2050000-0000-4000-8000-000000000007', 'Appeal Expired', 'appeal-expired@example.test'),
  ('a2050000-0000-4000-8000-000000000008', 'Appeal Lifted', 'appeal-lifted@example.test'),
  ('a2050000-0000-4000-8000-000000000009', 'literal%marker', 'literal-percent@example.test'),
  ('a2050000-0000-4000-8000-000000000010', 'literalXmarker', 'literal-control-x@example.test'),
  ('a2050000-0000-4000-8000-000000000011', 'literal_marker', 'literal-underscore@example.test'),
  ('a2050000-0000-4000-8000-000000000012', 'literalYmarker', 'literal-control-y@example.test'),
  (
    'a2050000-0000-4000-8000-000000000013',
    'literal' || pg_catalog.chr(92) || 'marker',
    'literal-slash@example.test'
  ),
  ('a2050000-0000-4000-8000-000000000014', 'literalZmarker', 'literal-control-z@example.test'),
  ('a2050000-0000-4000-8000-000000000015', 'Appeal New Filing', 'appeal-new-filing@example.test')
ON CONFLICT (id) DO UPDATE SET
  nickname = EXCLUDED.nickname,
  email = EXCLUDED.email;

INSERT INTO public.admin_tokens (
  id, token_hash, admin_id, admin_name, admin_email, role, expires_at,
  revoked_at, created_by
) VALUES
  (
    'a2050000-0000-4000-8000-000000000101', pg_catalog.repeat('a', 64),
    'a2050000-0000-4000-8000-000000000001', 'Appeal Owner',
    'appeal-owner@example.test', 'owner', pg_catalog.now() + interval '30 days',
    NULL, 'a2050000-0000-4000-8000-000000000001'
  ),
  (
    'a2050000-0000-4000-8000-000000000102', pg_catalog.repeat('b', 64),
    'a2050000-0000-4000-8000-000000000002', 'Appeal Operator',
    'appeal-operator@example.test', 'operator', pg_catalog.now() + interval '30 days',
    NULL, 'a2050000-0000-4000-8000-000000000001'
  ),
  (
    'a2050000-0000-4000-8000-000000000103', pg_catalog.repeat('c', 64),
    'a2050000-0000-4000-8000-000000000003', 'Appeal Security',
    'appeal-security@example.test', 'security_admin',
    pg_catalog.now() + interval '30 days', NULL,
    'a2050000-0000-4000-8000-000000000001'
  ),
  (
    'a2050000-0000-4000-8000-000000000104', pg_catalog.repeat('d', 64),
    'a2050000-0000-4000-8000-000000000001', 'Expired Owner',
    'appeal-owner@example.test', 'owner', pg_catalog.clock_timestamp(), NULL,
    'a2050000-0000-4000-8000-000000000001'
  );

INSERT INTO public.suspensions (
  id, profile_id, level, reason, category,
  started_at, ends_at, lifted_at, appeal_note, created_at
) VALUES
  (
    'a2050000-0000-4000-8000-000000000201',
    'a2050000-0000-4000-8000-000000000004',
    3, 'active appealed suspension', 'regression',
    pg_catalog.now() - interval '1 day', pg_catalog.now() + interval '7 days',
    NULL, 'Please review the exact appealed suspension.',
    pg_catalog.now() - interval '1 day'
  ),
  (
    'a2050000-0000-4000-8000-000000000202',
    'a2050000-0000-4000-8000-000000000005',
    2, 'security denial target', 'regression',
    pg_catalog.now() - interval '1 day', pg_catalog.now() + interval '7 days',
    NULL, 'Security admins must not decide appeals.',
    pg_catalog.now() - interval '1 day'
  ),
  (
    'a2050000-0000-4000-8000-000000000203',
    'a2050000-0000-4000-8000-000000000002',
    2, 'self-review target', 'regression',
    pg_catalog.now() - interval '1 day', pg_catalog.now() + interval '7 days',
    NULL, 'The operator must not review their own suspension.',
    pg_catalog.now() - interval '1 day'
  ),
  (
    'a2050000-0000-4000-8000-000000000204',
    'a2050000-0000-4000-8000-000000000006',
    2, 'denied appeal target', 'regression',
    pg_catalog.now() - interval '1 day', pg_catalog.now() + interval '7 days',
    NULL, 'This appeal will be denied without lifting.',
    pg_catalog.now() - interval '1 day'
  ),
  (
    'a2050000-0000-4000-8000-000000000205',
    'a2050000-0000-4000-8000-000000000007',
    2, 'expired appeal target', 'regression',
    pg_catalog.now() - interval '8 days', pg_catalog.now() - interval '1 day',
    NULL, 'Expired history remains reviewable.',
    pg_catalog.now() - interval '8 days'
  ),
  (
    'a2050000-0000-4000-8000-000000000206',
    'a2050000-0000-4000-8000-000000000008',
    2, 'already lifted appeal target', 'regression',
    pg_catalog.now() - interval '2 days', pg_catalog.now() + interval '7 days',
    pg_catalog.now() - interval '1 day',
    'Lifted history remains reviewable without a fake second lift.',
    pg_catalog.now() - interval '2 days'
  ),
  (
    'a2050000-0000-4000-8000-000000000207',
    'a2050000-0000-4000-8000-000000000005',
    1, 'longer lower overlap', 'regression',
    pg_catalog.now() - interval '2 days', pg_catalog.now() + interval '30 days',
    NULL, NULL, pg_catalog.now() - interval '2 days'
  ),
  (
    'a2050000-0000-4000-8000-000000000208',
    'a2050000-0000-4000-8000-000000000004',
    2, 'shorter stronger overlap', 'regression',
    pg_catalog.now() - interval '2 days', pg_catalog.now() + interval '3 days',
    NULL, NULL, pg_catalog.now() - interval '2 days'
  ),
  (
    'a2050000-0000-4000-8000-000000000209',
    'a2050000-0000-4000-8000-000000000004',
    1, 'longer weaker overlap', 'regression',
    pg_catalog.now() - interval '2 days', pg_catalog.now() + interval '30 days',
    NULL, NULL, pg_catalog.now() - interval '2 days'
  ),
  (
    'a2050000-0000-4000-8000-000000000210',
    'a2050000-0000-4000-8000-000000000015',
    2, 'old enforcement with a newly filed appeal', 'regression',
    pg_catalog.now() - interval '45 days', pg_catalog.now() + interval '7 days',
    NULL, NULL, pg_catalog.now() - interval '45 days'
  ),
  (
    'a2050000-0000-4000-8000-000000000212',
    'a2050000-0000-4000-8000-000000000008',
    2, 'future restriction must not notify early', 'regression',
    pg_catalog.now() + interval '1 day', pg_catalog.now() + interval '2 days',
    NULL, NULL, pg_catalog.now()
  );

UPDATE public.profiles
   SET suspension_level = CASE
         WHEN id = 'a2050000-0000-4000-8000-000000000004' THEN 3
         WHEN id = 'a2050000-0000-4000-8000-000000000006' THEN 2
         ELSE suspension_level
       END,
       suspended_until = CASE
         WHEN id IN (
           'a2050000-0000-4000-8000-000000000004',
           'a2050000-0000-4000-8000-000000000006'
         ) THEN pg_catalog.now() + interval '7 days'
         ELSE suspended_until
       END,
       shadow_banned = CASE
         WHEN id = 'a2050000-0000-4000-8000-000000000004' THEN true
         ELSE shadow_banned
       END
 WHERE id IN (
   'a2050000-0000-4000-8000-000000000004',
   'a2050000-0000-4000-8000-000000000006'
 );

INSERT INTO public.posts (id, user_id, content, status) VALUES (
  'a2050000-0000-4000-8000-000000000401',
  -- This fixture must belong to a currently unrestricted profile so the
  -- production actor-enforcement trigger permits setup. Profile 0008 has only
  -- a lifted historical row and a future-dated restriction in this scenario.
  'a2050000-0000-4000-8000-000000000008',
  'Bridge-compatible takedown fixture',
  'active'
);

DO $versioned_authorization$
DECLARE
  v1_capabilities text[];
  v1_payload jsonb;
  v1_keys text[];
  v2_row record;
  v2_payload jsonb;
  v2_keys text[];
BEGIN
  SELECT authorization_row.capabilities,
         pg_catalog.to_jsonb(authorization_row)
    INTO STRICT v1_capabilities, v1_payload
    FROM public.admin_token_authorization(pg_catalog.repeat('b', 64))
      AS authorization_row;
  SELECT pg_catalog.array_agg(key ORDER BY key) INTO v1_keys
    FROM pg_catalog.jsonb_object_keys(v1_payload) AS keys(key);
  IF 'decide_appeal' = ANY(v1_capabilities) THEN
    RAISE EXCEPTION 'v1 authorization exposed the new capability';
  END IF;
  IF v1_keys IS DISTINCT FROM ARRAY[
       'admin_email', 'admin_id', 'admin_name', 'capabilities', 'role'
     ]::text[] THEN
    RAISE EXCEPTION 'v1 authorization exact five-column bridge shape drifted';
  END IF;

  SELECT * INTO STRICT v2_row
    FROM public.admin_token_authorization_v2(pg_catalog.repeat('b', 64));
  v2_payload := pg_catalog.to_jsonb(v2_row);
  SELECT pg_catalog.array_agg(key ORDER BY key) INTO v2_keys
    FROM pg_catalog.jsonb_object_keys(v2_payload) AS keys(key);
  IF v2_row.token_id <> 'a2050000-0000-4000-8000-000000000102'::uuid
     OR v2_row.expires_at IS NULL
     OR v2_row.expires_at <= v2_row.server_now
     OR NOT ('decide_appeal' = ANY(v2_row.capabilities))
     OR v2_keys IS DISTINCT FROM ARRAY[
       'admin_email', 'admin_id', 'admin_name', 'capabilities',
       'expires_at', 'role', 'server_now', 'token_id'
     ]::text[]
     OR v2_payload ? 'token_hash' THEN
    RAISE EXCEPTION 'v2 authorization metadata/capabilities drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.admin_token_authorization_v2(pg_catalog.repeat('d', 64))
  ) THEN
    RAISE EXCEPTION 'token at the database-clock expiry boundary authorized';
  END IF;
END;
$versioned_authorization$;

DO $historical_appeals_remain_reviewable$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM public.admin_list_appeals(500, 0)
        WHERE id = 'a2050000-0000-4000-8000-000000000205'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.admin_list_appeals(500, 0)
        WHERE id = 'a2050000-0000-4000-8000-000000000206'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.admin_list_appeals_v2(500, 0)
        WHERE id = 'a2050000-0000-4000-8000-000000000205'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.admin_list_appeals_v2(500, 0)
        WHERE id = 'a2050000-0000-4000-8000-000000000206'
     ) THEN
    RAISE EXCEPTION 'historical unreviewed appeals disappeared from a queue';
  END IF;
END;
$historical_appeals_remain_reviewable$;

DO $database_text_boundary$
BEGIN
  IF public.admin_moderation_reason_valid(
       'unsafe' || pg_catalog.chr(133) || 'reason'
     )
     OR public.admin_moderation_reason_valid(U&'unsafe\061Creason')
     OR public.admin_moderation_reason_valid(U&'unsafe\200Ereason')
     OR public.admin_moderation_reason_valid(U&'unsafe\200Freason') THEN
    RAISE EXCEPTION 'database moderation text boundary accepted control/bidi';
  END IF;
END;
$database_text_boundary$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'a2050000-0000-4000-8000-000000000015',
  true
);
SELECT public.submit_appeal(
  'A newly filed appeal must use its real database filing time.',
  'a2050000-0000-4000-8000-000000000015',
  'a2050000-0000-4000-8000-000000000210'
);
RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);

DO $authoritative_appeal_filing_time$
DECLARE
  stored_time timestamptz;
  projected_time timestamptz;
  enforcement_created_at timestamptz;
BEGIN
  SELECT suspension.appeal_submitted_at, suspension.created_at
    INTO STRICT stored_time, enforcement_created_at
    FROM public.suspensions AS suspension
   WHERE suspension.id = 'a2050000-0000-4000-8000-000000000210';
  SELECT appeal.appeal_submitted_at
    INTO STRICT projected_time
    FROM public.admin_list_appeals_v2(500, 0) AS appeal
   WHERE appeal.id = 'a2050000-0000-4000-8000-000000000210';

  IF stored_time IS NULL
     OR projected_time IS DISTINCT FROM stored_time
     OR stored_time <= enforcement_created_at
     OR stored_time < pg_catalog.clock_timestamp() - interval '5 minutes'
     OR NOT EXISTS (
       SELECT 1
         FROM public.admin_list_appeals_v2(500, 0) AS historical
        WHERE historical.id = 'a2050000-0000-4000-8000-000000000205'
          AND historical.appeal_submitted_at IS NULL
     ) THEN
    RAISE EXCEPTION
      'appeal filing time was fabricated, omitted, or projected from enforcement creation';
  END IF;
END;
$authoritative_appeal_filing_time$;

CREATE TEMP TABLE appeal_regression_results (
  label text PRIMARY KEY,
  result jsonb NOT NULL
) ON COMMIT DROP;
GRANT SELECT, INSERT ON appeal_regression_results TO service_role;

SET LOCAL ROLE service_role;

DO $direct_appeal_audit_requires_mutation_context$
BEGIN
  BEGIN
    PERFORM public.record_audit(
      'appeal_decided',
      'a2050000-0000-4000-8000-000000000002',
      'a2050000-0000-4000-8000-000000000202',
      pg_catalog.jsonb_build_object(
        'decision', 'denied',
        'terminal', true,
        'reason', 'A telemetry call must not create appeal state.',
        'effective_at', pg_catalog.clock_timestamp(),
        'suspension_active', true,
        'lifted_now', false,
        'remains_active', true
      )
    );
    RAISE EXCEPTION 'direct appeal audit unexpectedly reported success';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'appeal_audit_context_required' THEN RAISE; END IF;
  END;

  IF EXISTS (
    SELECT 1
      FROM public.admin_list_owner_audit_log(500, 0, 'appeal_decided') AS audit
     WHERE audit.target_id = 'a2050000-0000-4000-8000-000000000202'
  ) THEN
    RAISE EXCEPTION 'direct appeal audit forged operational state';
  END IF;
END;
$direct_appeal_audit_requires_mutation_context$;

DO $missing_audit_role_fails_closed$
BEGIN
  PERFORM pg_catalog.set_config(
    'admin.actor_id', 'a2050000-0000-4000-8000-000000000002', true
  );
  PERFORM pg_catalog.set_config(
    'admin.token_id', 'a2050000-0000-4000-8000-000000000102', true
  );
  PERFORM pg_catalog.set_config(
    'admin.idempotency_key', 'a2050000-0000-4000-8000-000000000399', true
  );
  PERFORM pg_catalog.set_config('admin.role', '', true);
  PERFORM pg_catalog.set_config('admin.audit_required', 'on', true);

  BEGIN
    PERFORM public.record_audit(
      'ban_applied',
      'a2050000-0000-4000-8000-000000000002',
      'a2050000-0000-4000-8000-000000000004',
      pg_catalog.jsonb_build_object('reason', 'fault injection')
    );
    RAISE EXCEPTION 'required audit without admin.role was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'admin_audit_required_failed' THEN RAISE; END IF;
  END;

  PERFORM pg_catalog.set_config('admin.audit_required', 'off', true);
  PERFORM pg_catalog.set_config('admin.actor_id', '', true);
  PERFORM pg_catalog.set_config('admin.token_id', '', true);
  PERFORM pg_catalog.set_config('admin.idempotency_key', '', true);
END;
$missing_audit_role_fails_closed$;

DO $inconsistent_appeal_audit_fails_closed$
BEGIN
  PERFORM pg_catalog.set_config(
    'admin.actor_id', 'a2050000-0000-4000-8000-000000000002', true
  );
  PERFORM pg_catalog.set_config(
    'admin.token_id', 'a2050000-0000-4000-8000-000000000102', true
  );
  PERFORM pg_catalog.set_config(
    'admin.idempotency_key', 'a2050000-0000-4000-8000-000000000398', true
  );
  PERFORM pg_catalog.set_config('admin.role', 'operator', true);
  PERFORM pg_catalog.set_config('admin.audit_required', 'on', true);

  BEGIN
    PERFORM public.record_audit(
      'appeal_decided',
      'a2050000-0000-4000-8000-000000000002',
      'a2050000-0000-4000-8000-000000000201',
      pg_catalog.jsonb_build_object(
        'decision', 'accepted',
        'terminal', true,
        'reason', 'inconsistent accepted state must fail',
        'effective_at', pg_catalog.clock_timestamp(),
        'suspension_active', true,
        'lifted_now', false,
        'remains_active', false
      )
    );
    RAISE EXCEPTION 'inconsistent appeal audit state was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'admin_audit_required_failed' THEN RAISE; END IF;
  END;

  PERFORM pg_catalog.set_config('admin.audit_required', 'off', true);
  PERFORM pg_catalog.set_config('admin.actor_id', '', true);
  PERFORM pg_catalog.set_config('admin.token_id', '', true);
  PERFORM pg_catalog.set_config('admin.idempotency_key', '', true);
  PERFORM pg_catalog.set_config('admin.role', '', true);
END;
$inconsistent_appeal_audit_fails_closed$;

INSERT INTO appeal_regression_results (label, result)
VALUES (
  'bridge_apply_ban',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'a2050000-0000-4000-8000-000000000314',
    pg_catalog.repeat('4', 64),
    'apply_ban',
    pg_catalog.jsonb_build_object(
      'target_id', 'a2050000-0000-4000-8000-000000000005',
      'level', 1,
      'reason', '  Atomic bridge valid restriction.  ',
      'category', ' regression '
    )
  )
);

INSERT INTO appeal_regression_results (label, result)
VALUES (
  'bridge_apply_ban_replay',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'a2050000-0000-4000-8000-000000000314',
    pg_catalog.repeat('4', 64),
    'apply_ban',
    pg_catalog.jsonb_build_object(
      'target_id', 'a2050000-0000-4000-8000-000000000005',
      'level', 1,
      'reason', '  Atomic bridge valid restriction.  ',
      'category', ' regression '
    )
  )
);

DO $overlapping_apply_state$
BEGIN
  IF (SELECT profile.suspension_level
        FROM public.profiles AS profile
       WHERE profile.id = 'a2050000-0000-4000-8000-000000000005') <> 2
     OR (SELECT profile.suspended_until
           FROM public.profiles AS profile
          WHERE profile.id = 'a2050000-0000-4000-8000-000000000005')
        IS DISTINCT FROM
        (SELECT suspension.ends_at
           FROM public.suspensions AS suspension
          WHERE suspension.id = 'a2050000-0000-4000-8000-000000000202')
     OR (SELECT profile.shadow_banned
           FROM public.profiles AS profile
          WHERE profile.id = 'a2050000-0000-4000-8000-000000000005') THEN
    RAISE EXCEPTION
      'lower overlapping apply corrupted the authoritative profile state';
  END IF;
END;
$overlapping_apply_state$;

INSERT INTO appeal_regression_results (label, result)
VALUES (
  'bridge_lift',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'a2050000-0000-4000-8000-000000000315',
    pg_catalog.repeat('5', 64),
    'lift_suspension',
    pg_catalog.jsonb_build_object(
      'suspension_id', (
        SELECT result ->> 'data'
          FROM appeal_regression_results
         WHERE label = 'bridge_apply_ban'
      ),
      'reason', '  Atomic bridge valid lift.  '
    )
  )
);

INSERT INTO appeal_regression_results (label, result)
VALUES (
  'bridge_takedown',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'a2050000-0000-4000-8000-000000000316',
    pg_catalog.repeat('6', 64),
    'takedown_content',
    pg_catalog.jsonb_build_object(
      'target_type', 'post',
      'target_id', 'a2050000-0000-4000-8000-000000000401',
      'reason', '  Atomic bridge valid takedown.  '
    )
  )
);

DO $direct_helpers_remain_private$
BEGIN
  -- The Supabase PG17.6.1.104 local image currently crashes its backend on a
  -- denied function call (even for a trivial temporary function). Verify the
  -- effective catalog privilege without invoking the known image-level crash;
  -- the bridge calls above still exercise the authorized service path.
  IF pg_catalog.has_function_privilege(
       'service_role',
       'public.apply_ban_level(uuid,smallint,text,text,integer)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'public.lift_suspension(uuid,text)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'public.admin_takedown_content(text,uuid,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'service_role retained direct helper execution';
  END IF;
END;
$direct_helpers_remain_private$;

INSERT INTO appeal_regression_results (label, result)
VALUES (
  'more_info',
  public.admin_execute_mutation(
    pg_catalog.repeat('b', 64),
    'a2050000-0000-4000-8000-000000000301',
    pg_catalog.repeat('1', 64),
    'decide_appeal',
    pg_catalog.jsonb_build_object(
      'suspension_id', 'a2050000-0000-4000-8000-000000000201',
      'decision', 'more_information_required',
      'reason', 'Please provide the transaction receipt.'
    )
  )
);

-- Exact replay must return the already-committed result without a second audit.
INSERT INTO appeal_regression_results (label, result)
VALUES (
  'more_info_replay',
  public.admin_execute_mutation(
    pg_catalog.repeat('b', 64),
    'a2050000-0000-4000-8000-000000000301',
    pg_catalog.repeat('1', 64),
    'decide_appeal',
    pg_catalog.jsonb_build_object(
      'suspension_id', 'a2050000-0000-4000-8000-000000000201',
      'decision', 'more_information_required',
      'reason', 'Please provide the transaction receipt.'
    )
  )
);

INSERT INTO appeal_regression_results (label, result)
VALUES (
  'more_info_second_key',
  public.admin_execute_mutation(
    pg_catalog.repeat('b', 64),
    'a2050000-0000-4000-8000-000000000307',
    pg_catalog.repeat('7', 64),
    'decide_appeal',
    pg_catalog.jsonb_build_object(
      'suspension_id', 'a2050000-0000-4000-8000-000000000201',
      'decision', 'more_information_required',
      'reason', 'Please also provide the original listing screenshot.'
    )
  )
);

INSERT INTO appeal_regression_results (label, result)
VALUES (
  'accepted',
  public.admin_execute_mutation(
    pg_catalog.repeat('b', 64),
    'a2050000-0000-4000-8000-000000000302',
    pg_catalog.repeat('2', 64),
    'decide_appeal',
    pg_catalog.jsonb_build_object(
      'suspension_id', 'a2050000-0000-4000-8000-000000000201',
      'decision', 'accepted',
      'reason', 'The submitted evidence resolves the case.'
    )
  )
);

INSERT INTO appeal_regression_results (label, result)
VALUES
  (
    'denied',
    public.admin_execute_mutation(
      pg_catalog.repeat('a', 64),
      'a2050000-0000-4000-8000-000000000308',
      pg_catalog.repeat('8', 64),
      'decide_appeal',
      pg_catalog.jsonb_build_object(
        'suspension_id', 'a2050000-0000-4000-8000-000000000204',
        'decision', 'denied',
        'reason', 'The independent evidence supports the restriction.'
      )
    )
  ),
  (
    'accepted_expired',
    public.admin_execute_mutation(
      pg_catalog.repeat('a', 64),
      'a2050000-0000-4000-8000-000000000309',
      pg_catalog.repeat('9', 64),
      'decide_appeal',
      pg_catalog.jsonb_build_object(
        'suspension_id', 'a2050000-0000-4000-8000-000000000205',
        'decision', 'accepted',
        'reason', 'Historical review accepted without fabricating a lift.'
      )
    )
  ),
  (
    'accepted_already_lifted',
    public.admin_execute_mutation(
      pg_catalog.repeat('b', 64),
      'a2050000-0000-4000-8000-000000000310',
      pg_catalog.repeat('0', 64),
      'decide_appeal',
      pg_catalog.jsonb_build_object(
        'suspension_id', 'a2050000-0000-4000-8000-000000000206',
        'decision', 'accepted',
        'reason', 'Already-lifted history accepted without a second lift.'
      )
    )
  );

DO $stable_refusals$
BEGIN
  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('a', 64),
      'a2050000-0000-4000-8000-000000000303',
      pg_catalog.repeat('3', 64),
      'decide_appeal',
      pg_catalog.jsonb_build_object(
        'suspension_id', 'a2050000-0000-4000-8000-000000000201',
        'decision', 'denied',
        'reason', 'A second terminal decision must never commit.'
      )
    );
    RAISE EXCEPTION 'second terminal appeal decision was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'appeal_already_decided' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('a', 64),
      'a2050000-0000-4000-8000-000000000311',
      pg_catalog.repeat('1', 64),
      'decide_appeal',
      pg_catalog.jsonb_build_object(
        'suspension_id', 'a2050000-0000-4000-8000-000000000201',
        'decision', 'more_information_required',
        'reason', 'Terminal cases must not reopen as more-information requests.'
      )
    );
    RAISE EXCEPTION 'terminal appeal reopened for more information';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'appeal_already_decided' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('c', 64),
      'a2050000-0000-4000-8000-000000000304',
      pg_catalog.repeat('4', 64),
      'decide_appeal',
      pg_catalog.jsonb_build_object(
        'suspension_id', 'a2050000-0000-4000-8000-000000000202',
        'decision', 'denied',
        'reason', 'Security-role capability refusal fixture.'
      )
    );
    RAISE EXCEPTION 'security admin decided an appeal';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'admin_capability_denied' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('b', 64),
      'a2050000-0000-4000-8000-000000000305',
      pg_catalog.repeat('5', 64),
      'decide_appeal',
      pg_catalog.jsonb_build_object(
        'suspension_id', 'a2050000-0000-4000-8000-000000000203',
        'decision', 'accepted',
        'reason', 'Self review must be rejected.'
      )
    );
    RAISE EXCEPTION 'operator decided their own appeal';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'self_appeal_decision_forbidden' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('b', 64),
      'a2050000-0000-4000-8000-000000000306',
      pg_catalog.repeat('6', 64),
      'lift_suspension',
      pg_catalog.jsonb_build_object(
        'suspension_id', 'a2050000-0000-4000-8000-000000000203',
        'reason', 'Self lift must be rejected.'
      )
    );
    RAISE EXCEPTION 'operator lifted their own suspension';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'self_appeal_decision_forbidden' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('a', 64),
      'a2050000-0000-4000-8000-000000000312',
      pg_catalog.repeat('2', 64),
      'apply_ban',
      pg_catalog.jsonb_build_object(
        'target_id', 'a2050000-0000-4000-8000-000000000005',
        'level', 1,
        'reason', U&'unsafe\200Ereason',
        'category', 'regression'
      )
    );
    RAISE EXCEPTION 'apply-ban reason accepted bidi text';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'admin_mutation_invalid_payload' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('a', 64),
      'a2050000-0000-4000-8000-000000000313',
      pg_catalog.repeat('3', 64),
      'apply_ban',
      pg_catalog.jsonb_build_object(
        'target_id', 'a2050000-0000-4000-8000-000000000005',
        'level', 1,
        'reason', 'valid reason',
        'category', U&'unsafe\061Ccategory'
      )
    );
    RAISE EXCEPTION 'apply-ban category accepted bidi text';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'admin_mutation_invalid_payload' THEN RAISE; END IF;
  END;
END;
$stable_refusals$;

RESET ROLE;

DO $direct_apply_ban_text_boundary$
BEGIN
  BEGIN
    PERFORM public.apply_ban_level(
      'a2050000-0000-4000-8000-000000000005'::uuid,
      1::smallint,
      U&'unsafe\200Freason',
      'regression',
      NULL::integer
    );
    RAISE EXCEPTION 'direct apply-ban helper accepted bidi text';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_reason' THEN RAISE; END IF;
  END;
END;
$direct_apply_ban_text_boundary$;

DO $committed_invariants$
DECLARE
  more_info jsonb;
  replay jsonb;
  accepted jsonb;
  denied jsonb;
  accepted_expired jsonb;
  accepted_already_lifted jsonb;
BEGIN
  SELECT result INTO STRICT more_info
    FROM appeal_regression_results WHERE label = 'more_info';
  SELECT result INTO STRICT replay
    FROM appeal_regression_results WHERE label = 'more_info_replay';
  SELECT result INTO STRICT accepted
    FROM appeal_regression_results WHERE label = 'accepted';
  SELECT result INTO STRICT denied
    FROM appeal_regression_results WHERE label = 'denied';
  SELECT result INTO STRICT accepted_expired
    FROM appeal_regression_results WHERE label = 'accepted_expired';
  SELECT result INTO STRICT accepted_already_lifted
    FROM appeal_regression_results WHERE label = 'accepted_already_lifted';

  IF replay IS DISTINCT FROM more_info
     OR more_info #>> '{data,decision}' <> 'more_information_required'
     OR (more_info #>> '{data,terminal}')::boolean
     OR (more_info #>> '{data,lifted_now}')::boolean
     OR accepted #>> '{data,decision}' <> 'accepted'
     OR NOT (accepted #>> '{data,terminal}')::boolean
     OR NOT (accepted #>> '{data,lifted_now}')::boolean
     OR (accepted #>> '{data,remains_active}')::boolean
     OR denied #>> '{data,decision}' <> 'denied'
     OR NOT (denied #>> '{data,terminal}')::boolean
     OR (denied #>> '{data,lifted_now}')::boolean
     OR NOT (denied #>> '{data,remains_active}')::boolean
     OR (accepted_expired #>> '{data,lifted_now}')::boolean
     OR (accepted_expired #>> '{data,remains_active}')::boolean
     OR (accepted_already_lifted #>> '{data,lifted_now}')::boolean
     OR (accepted_already_lifted #>> '{data,remains_active}')::boolean THEN
    RAISE EXCEPTION 'appeal result/replay invariants drifted';
  END IF;

  IF (SELECT pg_catalog.count(*) FROM public.admin_audit_log
       WHERE target_id = 'a2050000-0000-4000-8000-000000000201'
         AND event_kind = 'appeal_more_information_requested') <> 2
     OR (SELECT pg_catalog.count(*) FROM public.admin_audit_log
          WHERE target_id = 'a2050000-0000-4000-8000-000000000201'
            AND event_kind = 'appeal_decided') <> 1
     OR (SELECT pg_catalog.count(*) FROM public.admin_mutation_requests
          WHERE admin_token_id = 'a2050000-0000-4000-8000-000000000102'
            AND action = 'decide_appeal'
            AND idempotency_key IN (
              'a2050000-0000-4000-8000-000000000301',
              'a2050000-0000-4000-8000-000000000302',
              'a2050000-0000-4000-8000-000000000307'
            )
            AND status = 'completed') <> 3 THEN
    RAISE EXCEPTION 'appeal audit/idempotency cardinality drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.admin_audit_log AS audit
     WHERE audit.target_id IN (
       'a2050000-0000-4000-8000-000000000201',
       'a2050000-0000-4000-8000-000000000204',
       'a2050000-0000-4000-8000-000000000205',
       'a2050000-0000-4000-8000-000000000206'
     )
       AND audit.event_kind IN (
         'appeal_decided', 'appeal_more_information_requested'
       )
       AND (
         audit.details - ARRAY[
           'decision', 'terminal', 'reason', 'effective_at',
           'suspension_active', 'lifted_now', 'remains_active'
         ]::text[] <> '{}'::jsonb
       )
  ) THEN
    RAISE EXCEPTION 'appeal audit details were not minimal';
  END IF;

  IF (SELECT lifted_at FROM public.suspensions
       WHERE id = 'a2050000-0000-4000-8000-000000000201') IS NULL
     OR EXISTS (
       SELECT 1 FROM public.admin_list_appeals_v2(500, 0)
        WHERE id = 'a2050000-0000-4000-8000-000000000201'
     ) THEN
    RAISE EXCEPTION 'accepted appeal remained active/pending';
  END IF;

  IF (SELECT suspension_level FROM public.profiles
       WHERE id = 'a2050000-0000-4000-8000-000000000004') <> 2
     OR (SELECT suspended_until FROM public.profiles
          WHERE id = 'a2050000-0000-4000-8000-000000000004')
        IS DISTINCT FROM
        (SELECT ends_at FROM public.suspensions
          WHERE id = 'a2050000-0000-4000-8000-000000000208')
     OR (SELECT shadow_banned FROM public.profiles
          WHERE id = 'a2050000-0000-4000-8000-000000000004')
     OR (SELECT lifted_at FROM public.suspensions
          WHERE id = 'a2050000-0000-4000-8000-000000000204') IS NOT NULL
     OR (SELECT lifted_at FROM public.suspensions
          WHERE id = 'a2050000-0000-4000-8000-000000000205') IS NOT NULL
     OR (SELECT pg_catalog.count(*) FROM public.admin_audit_log
          WHERE target_id = 'a2050000-0000-4000-8000-000000000201'
            AND event_kind = 'suspension_lifted') <> 0
     OR (SELECT pg_catalog.count(*) FROM public.notifications
          WHERE user_id = 'a2050000-0000-4000-8000-000000000004'
            AND title = '一项处置已解除 · One action was lifted'
            AND body = '另一项账号限制仍在生效 · Another account restriction remains active') <> 1
     OR EXISTS (
       SELECT 1
         FROM public.notifications
        WHERE user_id = 'a2050000-0000-4000-8000-000000000004'
          AND title = '账号限制已解除 · Your restriction was lifted'
     )
     OR EXISTS (
       SELECT 1
         FROM public.notifications
        WHERE user_id IN (
          'a2050000-0000-4000-8000-000000000007',
          'a2050000-0000-4000-8000-000000000008'
        )
          AND title IN (
            '收到一次警告 · You received a warning',
            '账号已被限制 · Your account was restricted'
          )
     ) THEN
    RAISE EXCEPTION 'accepted/denied/historical lift side-effect drifted';
  END IF;
END;
$committed_invariants$;

-- The partial-state branch above must not erase the ordinary single-row lift
-- message. This denied appeal stayed active; a later independent lift now has
-- no other active L2+ row and therefore truthfully closes the account state.
SELECT public.lift_suspension(
  'a2050000-0000-4000-8000-000000000204',
  'Independent follow-up review ended the sole remaining restriction.'
);

DO $single_restriction_lift_notification$
BEGIN
  IF (SELECT pg_catalog.count(*)
        FROM public.notifications
       WHERE user_id = 'a2050000-0000-4000-8000-000000000006'
         AND title = '账号限制已解除 · Your restriction was lifted'
         AND body = '') <> 1 THEN
    RAISE EXCEPTION 'single active restriction lift notification drifted';
  END IF;
END;
$single_restriction_lift_notification$;

DO $bridge_action_invariants$
DECLARE
  applied jsonb;
  replay jsonb;
  bridge_suspension_id uuid;
BEGIN
  SELECT result INTO STRICT applied
    FROM appeal_regression_results WHERE label = 'bridge_apply_ban';
  SELECT result INTO STRICT replay
    FROM appeal_regression_results WHERE label = 'bridge_apply_ban_replay';
  bridge_suspension_id := (applied ->> 'data')::uuid;

  IF applied IS DISTINCT FROM replay
     OR NOT ((SELECT result FROM appeal_regression_results
               WHERE label = 'bridge_lift') ->> 'success')::boolean
     OR ((SELECT result FROM appeal_regression_results
           WHERE label = 'bridge_takedown') #>> '{data,affected}')::integer <> 1
     OR (SELECT pg_catalog.count(*) FROM public.suspensions
          WHERE id = bridge_suspension_id) <> 1
     OR (SELECT lifted_at FROM public.suspensions
          WHERE id = bridge_suspension_id) IS NULL
     OR (SELECT reason FROM public.suspensions
          WHERE id = bridge_suspension_id) <> 'Atomic bridge valid restriction.'
     OR (SELECT category FROM public.suspensions
          WHERE id = bridge_suspension_id) <> 'regression'
     OR (SELECT suspension_level FROM public.profiles
          WHERE id = 'a2050000-0000-4000-8000-000000000005') <> 2
     OR (SELECT suspended_until FROM public.profiles
          WHERE id = 'a2050000-0000-4000-8000-000000000005')
        IS DISTINCT FROM
        (SELECT ends_at FROM public.suspensions
          WHERE id = 'a2050000-0000-4000-8000-000000000202')
     OR (SELECT pg_catalog.count(*) FROM public.admin_audit_log
          WHERE admin_token_id = 'a2050000-0000-4000-8000-000000000101'
            AND idempotency_key IN (
              'a2050000-0000-4000-8000-000000000314',
              'a2050000-0000-4000-8000-000000000315',
              'a2050000-0000-4000-8000-000000000316'
            )) <> 3
     OR (SELECT pg_catalog.count(*) FROM public.notifications
          WHERE user_id = 'a2050000-0000-4000-8000-000000000005'
            AND title = '一项处置已解除 · One action was lifted'
            AND body = '另一项账号限制仍在生效 · Another account restriction remains active') <> 1 THEN
    RAISE EXCEPTION 'atomic bridge compatibility/replay/audit drifted';
  END IF;
END;
$bridge_action_invariants$;

-- Percent and underscore are literal data. These fixtures must not turn an
-- operator query into a wildcard enumeration primitive.
DO $literal_search$
DECLARE
  matched_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.admin_search_users('%', 50))
     OR EXISTS (SELECT 1 FROM public.admin_search_users('_', 50))
     OR EXISTS (SELECT 1 FROM public.admin_search_users('a', 50)) THEN
    RAISE EXCEPTION 'literal/minimum-length search boundary drifted';
  END IF;

  SELECT id INTO STRICT matched_id FROM public.admin_search_users('%m', 50);
  IF matched_id <> 'a2050000-0000-4000-8000-000000000009'::uuid THEN
    RAISE EXCEPTION 'percent was treated as a wildcard';
  END IF;
  SELECT id INTO STRICT matched_id FROM public.admin_search_users('_m', 50);
  IF matched_id <> 'a2050000-0000-4000-8000-000000000011'::uuid THEN
    RAISE EXCEPTION 'underscore was treated as a wildcard';
  END IF;
  SELECT id INTO STRICT matched_id
    FROM public.admin_search_users(pg_catalog.chr(92) || 'm', 50);
  IF matched_id <> 'a2050000-0000-4000-8000-000000000013'::uuid THEN
    RAISE EXCEPTION 'backslash escaping changed literal search semantics';
  END IF;
END;
$literal_search$;

SELECT public.record_audit(
  'token_revoked',
  'a2050000-0000-4000-8000-000000000001',
  'a2050000-0000-4000-8000-000000000103',
  pg_catalog.jsonb_build_object(
    'token_id', 'a2050000-0000-4000-8000-000000000103',
    'case_id', 'CASE-PRIVATE-205',
    'approval_ref', 'APPROVAL-PRIVATE-205'
  )
);

DO $audit_projection_boundary$
DECLARE
  operator_row jsonb;
  legacy_row jsonb;
  owner_row jsonb;
BEGIN
  SELECT pg_catalog.to_jsonb(audit_row) INTO STRICT operator_row
    FROM public.admin_list_moderation_audit_log(
      10, 0, 'appeal_decided'
    ) AS audit_row
   WHERE audit_row.target_id = 'a2050000-0000-4000-8000-000000000201';
  SELECT pg_catalog.to_jsonb(audit_row) INTO STRICT legacy_row
    FROM public.admin_list_audit_log(10, 0, 'appeal_decided') AS audit_row
   WHERE audit_row.target_id = 'a2050000-0000-4000-8000-000000000201';
  SELECT pg_catalog.to_jsonb(audit_row) INTO STRICT owner_row
    FROM public.admin_list_owner_audit_log(10, 0, 'token_revoked') AS audit_row
   WHERE audit_row.target_id = 'a2050000-0000-4000-8000-000000000103';

  IF operator_row::text ~ 'admin_token_id|idempotency_key|admin_role|CASE-PRIVATE'
     OR legacy_row::text ~ 'admin_token_id|idempotency_key|admin_role|CASE-PRIVATE'
     OR EXISTS (
       SELECT 1
         FROM public.admin_list_moderation_audit_log(
           10, 0, 'token_revoked'
         )
     )
     OR owner_row #>> '{details,case_id}' <> 'CASE-PRIVATE-205'
     OR owner_row #>> '{details,approval_ref}' <> 'APPROVAL-PRIVATE-205' THEN
    RAISE EXCEPTION 'operator/owner audit projection boundary drifted';
  END IF;
END;
$audit_projection_boundary$;

ROLLBACK;
