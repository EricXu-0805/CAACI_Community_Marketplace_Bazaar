-- Isolated/local behavior regression for administrator token lifecycle.
-- NEVER run against production.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f1900000-0000-4000-8000-000000000001', 'lifecycle-owner@example.test', '{}'::jsonb),
  ('f1900000-0000-4000-8000-000000000002', 'lifecycle-security@example.test', '{}'::jsonb),
  ('f1900000-0000-4000-8000-000000000003', 'lifecycle-operator@example.test', '{}'::jsonb),
  ('f1900000-0000-4000-8000-000000000004', 'departing-admin@example.test', '{}'::jsonb),
  ('f1900000-0000-4000-8000-000000000005', 'new-admin@example.test', '{}'::jsonb),
  ('f1900000-0000-4000-8000-000000000006', 'no-token-delete@example.test', '{}'::jsonb),
  ('f1900000-0000-4000-8000-000000000007', 'direct-profile-delete@example.test', '{}'::jsonb),
  ('f1900000-0000-4000-8000-000000000008', 'old-job-admin@example.test', '{}'::jsonb),
  ('f1900000-0000-4000-8000-000000000009', 'banner-owner-delete@example.test', '{}'::jsonb),
  ('f1900000-0000-4000-8000-000000000010', 'auth-only-delete@example.test', '{}'::jsonb),
  ('f1910000-0000-4000-8000-000000000001', 'profile-recovery@example.test', '{}'::jsonb),
  ('f1910000-0000-4000-8000-000000000002', 'profile-recovery-other@example.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname, email, wechat_openid) VALUES
  ('f1900000-0000-4000-8000-000000000001', 'Lifecycle Owner', 'lifecycle-owner@example.test', NULL),
  ('f1900000-0000-4000-8000-000000000002', 'Lifecycle Security', 'lifecycle-security@example.test', NULL),
  ('f1900000-0000-4000-8000-000000000003', 'Lifecycle Operator', 'lifecycle-operator@example.test', NULL),
  ('f1900000-0000-4000-8000-000000000004', 'Departing Admin', 'departing-admin@example.test', NULL),
  ('f1900000-0000-4000-8000-000000000005', 'Authoritative New Admin', 'new-admin@example.test', NULL),
  ('f1900000-0000-4000-8000-000000000006', 'No Token Delete', 'no-token-delete@example.test', 'wx-no-token-190'),
  ('f1900000-0000-4000-8000-000000000007', 'Direct Profile Delete', 'direct-profile-delete@example.test', NULL),
  ('f1900000-0000-4000-8000-000000000008', 'Old Job Admin', 'old-job-admin@example.test', 'wx-old-job-190'),
  ('f1900000-0000-4000-8000-000000000009', 'Banner Owner Delete', 'banner-owner-delete@example.test', NULL)
ON CONFLICT (id) DO UPDATE SET
  nickname = EXCLUDED.nickname,
  email = EXCLUDED.email,
  wechat_openid = EXCLUDED.wechat_openid;

-- Recreate the historical handle_new_user partial-success state: Auth exists,
-- but its profile insert was swallowed. The f191 identities additionally
-- exercise the authenticated self-service recovery ACL below.
DELETE FROM public.profiles AS profile
 WHERE profile.id IN (
   'f1900000-0000-4000-8000-000000000010'::uuid,
   'f1910000-0000-4000-8000-000000000001'::uuid,
   'f1910000-0000-4000-8000-000000000002'::uuid
 );

INSERT INTO public.admin_tokens (
  id, token_hash, admin_id, admin_name, admin_email, role, expires_at,
  revoked_at, created_by
) VALUES
  (
    'f1900000-0000-4000-8000-000000000011', pg_catalog.repeat('a', 64),
    'f1900000-0000-4000-8000-000000000001', 'Lifecycle Owner',
    'lifecycle-owner@example.test', 'owner', pg_catalog.now() + interval '30 days',
    NULL, 'f1900000-0000-4000-8000-000000000001'
  ),
  (
    'f1900000-0000-4000-8000-000000000012', pg_catalog.repeat('b', 64),
    'f1900000-0000-4000-8000-000000000001', 'Lifecycle Owner Backup',
    'lifecycle-owner@example.test', 'owner', pg_catalog.now() + interval '30 days',
    NULL, 'f1900000-0000-4000-8000-000000000001'
  ),
  (
    'f1900000-0000-4000-8000-000000000013', pg_catalog.repeat('c', 64),
    'f1900000-0000-4000-8000-000000000002', 'Lifecycle Security',
    'lifecycle-security@example.test', 'security_admin',
    pg_catalog.now() + interval '30 days', NULL,
    'f1900000-0000-4000-8000-000000000001'
  ),
  (
    'f1900000-0000-4000-8000-000000000014', pg_catalog.repeat('d', 64),
    'f1900000-0000-4000-8000-000000000003', 'Lifecycle Operator',
    'lifecycle-operator@example.test', 'operator', pg_catalog.now() + interval '30 days',
    NULL, 'f1900000-0000-4000-8000-000000000001'
  ),
  (
    'f1900000-0000-4000-8000-000000000015', pg_catalog.repeat('e', 64),
    'f1900000-0000-4000-8000-000000000002', 'Revoked Security',
    'old-security@example.test', 'security_admin', pg_catalog.now() + interval '30 days',
    pg_catalog.now(), 'f1900000-0000-4000-8000-000000000001'
  ),
  (
    'f1900000-0000-4000-8000-000000000016', pg_catalog.repeat('f', 64),
    'f1900000-0000-4000-8000-000000000002', 'Expired Security',
    'old-security@example.test', 'security_admin', pg_catalog.now() - interval '1 day',
    NULL, 'f1900000-0000-4000-8000-000000000001'
  ),
  (
    'f1900000-0000-4000-8000-000000000017', pg_catalog.repeat('7', 64),
    'f1900000-0000-4000-8000-000000000004', 'Departing Admin Old',
    'cached-old@example.test', 'operator', pg_catalog.now() + interval '30 days',
    NULL, 'f1900000-0000-4000-8000-000000000001'
  ),
  (
    'f1900000-0000-4000-8000-000000000018', pg_catalog.repeat('8', 64),
    'f1900000-0000-4000-8000-000000000004', 'Departing Admin New',
    'cached-new@example.test', 'operator', pg_catalog.now() + interval '30 days',
    NULL, 'f1900000-0000-4000-8000-000000000001'
  ),
  (
    'f1900000-0000-4000-8000-000000000019', pg_catalog.repeat('9', 64),
    'f1900000-0000-4000-8000-000000000005', 'Exact Revoke Target',
    'cached-third@example.test', 'operator', pg_catalog.now() + interval '30 days',
    NULL, 'f1900000-0000-4000-8000-000000000001'
  ),
  (
    'f1900000-0000-4000-8000-000000000020', pg_catalog.repeat('0', 64),
    'f1900000-0000-4000-8000-000000000008', 'Old Job Admin',
    'old-job-admin@example.test', 'operator', pg_catalog.now() + interval '30 days',
    NULL, 'f1900000-0000-4000-8000-000000000001'
  ),
  (
    'f1900000-0000-4000-8000-000000000021', pg_catalog.repeat('4', 64),
    'f1900000-0000-4000-8000-000000000007', 'Direct Profile Delete',
    'direct-profile-delete@example.test', 'operator', pg_catalog.now() + interval '30 days',
    NULL, 'f1900000-0000-4000-8000-000000000001'
  );

-- A normal write cannot produce an active admin credential for an Auth user
-- whose profile is missing: the exact validated profiles FK rejects it.
DO $missing_profile_active_token_fk_refusal$
DECLARE
  violated_constraint text;
BEGIN
  BEGIN
    INSERT INTO public.admin_tokens (
      id, token_hash, admin_id, admin_name, admin_email, role, expires_at,
      revoked_at, created_by
    ) VALUES (
      'f1900000-0000-4000-8000-000000000023',
      pg_catalog.repeat('6', 64),
      'f1900000-0000-4000-8000-000000000010',
      'Impossible Missing Profile',
      'auth-only-delete@example.test',
      'operator',
      pg_catalog.now() + interval '30 days',
      NULL,
      'f1900000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'active admin token with missing profile was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    IF violated_constraint <> 'admin_tokens_admin_id_profiles_fkey_v3' THEN
      RAISE;
    END IF;

  END;
END;
$missing_profile_active_token_fk_refusal$;

-- Fault-inject the otherwise-unreachable row as a restore/import could, then
-- prove both authentication and account-deletion preparation still fail
-- closed. session_replication_role is restored immediately and the row is
-- removed before normal behavior tests continue.
SET LOCAL session_replication_role = replica;
INSERT INTO public.admin_tokens (
  id, token_hash, admin_id, admin_name, admin_email, role, expires_at,
  revoked_at, created_by
) VALUES (
  'f1900000-0000-4000-8000-000000000023',
  pg_catalog.repeat('6', 64),
  'f1900000-0000-4000-8000-000000000010',
  'Corrupted Missing Profile',
  'auth-only-delete@example.test',
  'operator',
  pg_catalog.now() + interval '30 days',
  NULL,
  'f1900000-0000-4000-8000-000000000001'
);
SET LOCAL session_replication_role = origin;

DO $missing_profile_corruption_fail_closed$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.admin_token_authorization(pg_catalog.repeat('6', 64))
  ) THEN
    RAISE EXCEPTION 'corrupted missing-profile token authenticated';
  END IF;

  BEGIN
    PERFORM public.admin_prepare_account_deletion(
      'f1900000-0000-4000-8000-000000000010'
    );
    RAISE EXCEPTION 'missing-profile active-token deletion was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'admin_active_token_profile_missing' THEN RAISE; END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM public.account_deletion_jobs AS deletion_job
     WHERE deletion_job.user_id =
           'f1900000-0000-4000-8000-000000000010'
  ) THEN
    RAISE EXCEPTION 'missing-profile corruption refusal left a deletion job';
  END IF;
END;
$missing_profile_corruption_fail_closed$;

SET LOCAL session_replication_role = replica;
DELETE FROM public.admin_tokens AS token
 WHERE token.id = 'f1900000-0000-4000-8000-000000000023';
SET LOCAL session_replication_role = origin;

-- Simulate a tombstone created by the pre-atomic API. The new preparation RPC
-- must reuse this exact checkpoint while still revoking its attached tokens.
INSERT INTO public.account_deletion_jobs (
  user_id, stage, wechat_openid, requested_at, updated_at
) VALUES (
  'f1900000-0000-4000-8000-000000000008',
  'storage_deleted',
  'wx-old-job-190',
  pg_catalog.now() - interval '2 days',
  pg_catalog.now() - interval '1 day'
);

-- The tail ACL must preserve only the minimal own-profile recovery write.
-- Prove both successful self-healing and refusal of cross-user/protected data.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'f1910000-0000-4000-8000-000000000001',
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"f1910000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

INSERT INTO public.profiles (
  id, nickname, avatar_url, bio, location, status_text, status_emoji
) VALUES (
  'f1910000-0000-4000-8000-000000000001',
  'Recovered Profile',
  NULL,
  'Recovered from historical signup partial success',
  'Champaign',
  'Recovered',
  'ok'
);

DO $profile_recovery_rls_refuses_other_user$
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, nickname) VALUES (
      'f1910000-0000-4000-8000-000000000002',
      'Forged Other Profile'
    );
    RAISE EXCEPTION 'authenticated profile recovery inserted another user';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.profiles (id, nickname, email) VALUES (
      'f1910000-0000-4000-8000-000000000001',
      'Protected Column Attempt',
      'forged-private@example.test'
    );
    RAISE EXCEPTION 'authenticated profile recovery wrote protected email';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$profile_recovery_rls_refuses_other_user$;

RESET ROLE;

CREATE TEMP TABLE admin_token_lifecycle_results (
  label text PRIMARY KEY,
  result jsonb NOT NULL
) ON COMMIT DROP;
GRANT SELECT, INSERT ON admin_token_lifecycle_results TO service_role;

-- Freeze the issue payload once and derive the tested digest from those exact
-- bytes. Replays must never hide payload drift behind a hand-written hash.
CREATE TEMP TABLE admin_token_lifecycle_inputs (
  label text PRIMARY KEY,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$')
) ON COMMIT DROP;
WITH fixed_issue AS (
  SELECT pg_catalog.jsonb_build_object(
    'token_hash', pg_catalog.repeat('1', 64),
    'admin_id', 'f1900000-0000-4000-8000-000000000005',
    'role', 'operator',
    'expires_at', pg_catalog.to_char(
      pg_catalog.date_trunc('second', pg_catalog.now()) + interval '20 days',
      'YYYY-MM-DD"T"HH24:MI:SS.USOF'
    ),
    'case_id', 'CASE-ISSUE-190',
    'approval_ref', 'APPROVAL-OWNER-190'
  ) AS payload
)
INSERT INTO admin_token_lifecycle_inputs (label, payload, payload_hash)
SELECT 'issue',
       fixed_issue.payload,
       pg_catalog.encode(
         pg_catalog.sha256(
           pg_catalog.convert_to(fixed_issue.payload::text, 'UTF8')
         ),
         'hex'
       )
  FROM fixed_issue;
GRANT SELECT ON admin_token_lifecycle_inputs TO service_role;

SET LOCAL ROLE service_role;

DO $raw_token_table_denied_but_rpc_access_works$
DECLARE
  authorized_rows integer;
  inventory_rows integer;
  missing_reconciliation_rows integer;
  reconciliation_payload jsonb;
  reconciliation_keys text[];
BEGIN
  BEGIN
    PERFORM token.token_hash FROM public.admin_tokens AS token LIMIT 1;
    RAISE EXCEPTION 'service_role raw token SELECT was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.account_deletion_jobs (user_id, stage)
    VALUES ('f1900000-0000-4000-8000-000000000005', 'requested');
    RAISE EXCEPTION 'service_role raw deletion-job INSERT was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT pg_catalog.count(*) INTO authorized_rows
    FROM public.admin_token_authorization(pg_catalog.repeat('a', 64));
  SELECT pg_catalog.count(*) INTO inventory_rows
    FROM public.admin_token_inventory();
  IF authorized_rows <> 1 OR inventory_rows < 1 THEN
    RAISE EXCEPTION 'non-secret authorization/inventory RPC became unusable';
  END IF;

  SELECT pg_catalog.to_jsonb(reconciled)
    INTO reconciliation_payload
    FROM public.admin_reconcile_issued_token(
      pg_catalog.repeat('a', 64)
    ) AS reconciled;
  SELECT pg_catalog.array_agg(reconciliation_key ORDER BY reconciliation_key)
    INTO reconciliation_keys
    FROM pg_catalog.jsonb_object_keys(
      reconciliation_payload
    ) AS keys(reconciliation_key);
  IF reconciliation_payload IS NULL
     OR reconciliation_keys IS DISTINCT FROM ARRAY[
       'admin_id', 'expires_at', 'id', 'revoked_at', 'role'
     ]::text[]
     OR reconciliation_payload ->> 'id'
        <> 'f1900000-0000-4000-8000-000000000011'
     OR reconciliation_payload ->> 'admin_id'
        <> 'f1900000-0000-4000-8000-000000000001'
     OR reconciliation_payload ->> 'role' <> 'owner'
     OR reconciliation_payload ->> 'expires_at' IS NULL
     OR reconciliation_payload ->> 'revoked_at' IS NOT NULL THEN
    RAISE EXCEPTION
      'service_role token reconciliation exposed the wrong projection: %',
      reconciliation_payload;
  END IF;

  SELECT pg_catalog.count(*)
    INTO missing_reconciliation_rows
    FROM public.admin_reconcile_issued_token(pg_catalog.repeat('3', 64));
  IF missing_reconciliation_rows <> 0 THEN
    RAISE EXCEPTION 'missing token hash reconciliation returned a row';
  END IF;

  BEGIN
    PERFORM 1
      FROM public.admin_reconcile_issued_token('not-a-sha256-digest');
    RAISE EXCEPTION 'invalid token hash reconciliation was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'admin_token_hash_invalid' THEN RAISE; END IF;
  END;
END;
$raw_token_table_denied_but_rpc_access_works$;

INSERT INTO admin_token_lifecycle_results VALUES (
  'prepare_no_token_first',
  public.admin_prepare_account_deletion(
    'f1900000-0000-4000-8000-000000000006'
  )
);

INSERT INTO admin_token_lifecycle_results VALUES (
  'prepare_no_token_replay',
  public.admin_prepare_account_deletion(
    'f1900000-0000-4000-8000-000000000006'
  )
);

INSERT INTO admin_token_lifecycle_results VALUES (
  'prepare_missing_profile_first',
  public.admin_prepare_account_deletion(
    'f1900000-0000-4000-8000-000000000010'
  )
);

INSERT INTO admin_token_lifecycle_results VALUES (
  'prepare_missing_profile_replay',
  public.admin_prepare_account_deletion(
    'f1900000-0000-4000-8000-000000000010'
  )
);

DO $nonexistent_auth_identity_not_tombstoned$
BEGIN
  BEGIN
    PERFORM public.admin_prepare_account_deletion(
      'f1900000-0000-4000-8000-000000000099'
    );
    RAISE EXCEPTION 'nonexistent Auth identity received a deletion job';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM <> 'account_auth_user_not_found' THEN RAISE; END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM public.account_deletion_jobs AS deletion_job
     WHERE deletion_job.user_id =
           'f1900000-0000-4000-8000-000000000099'
  ) THEN
    RAISE EXCEPTION 'nonexistent Auth refusal left a deletion job';
  END IF;
END;
$nonexistent_auth_identity_not_tombstoned$;

INSERT INTO admin_token_lifecycle_results VALUES (
  'prepare_existing_job_first',
  public.admin_prepare_account_deletion(
    'f1900000-0000-4000-8000-000000000008'
  )
);

INSERT INTO admin_token_lifecycle_results VALUES (
  'prepare_existing_job_replay',
  public.admin_prepare_account_deletion(
    'f1900000-0000-4000-8000-000000000008'
  )
);

INSERT INTO admin_token_lifecycle_results VALUES (
  'prepare_last_owner',
  public.admin_prepare_account_deletion(
    'f1900000-0000-4000-8000-000000000001'
  )
);

RESET ROLE;

DO $last_admin_prepare_refusal$
DECLARE
  readiness jsonb;
BEGIN
  BEGIN
    UPDATE public.admin_tokens AS token
       SET revoked_at = pg_catalog.now()
     WHERE token.admin_id IS DISTINCT FROM
           'f1900000-0000-4000-8000-000000000001'::uuid
       AND token.revoked_at IS NULL;

    readiness := public.admin_prepare_account_deletion(
      'f1900000-0000-4000-8000-000000000001'
    );
    IF readiness IS DISTINCT FROM pg_catalog.jsonb_build_object(
         'ready', false,
         'reason', 'admin_recovery_transfer_required',
         'job', NULL
       ) THEN
      RAISE EXCEPTION 'last active admin account deletion was accepted: %',
        readiness;
    END IF;

    -- Roll back only this synthetic last-admin state after its assertion.
    RAISE EXCEPTION USING ERRCODE = 'P0190', MESSAGE = 'rollback_last_admin_fixture';
  EXCEPTION WHEN SQLSTATE 'P0190' THEN
    IF SQLERRM <> 'rollback_last_admin_fixture' THEN RAISE; END IF;
  END;
END;
$last_admin_prepare_refusal$;

SET LOCAL ROLE service_role;

INSERT INTO admin_token_lifecycle_results VALUES (
  'issue_first',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'f1900000-0000-4000-8000-000000000101',
    (
      SELECT lifecycle_input.payload_hash
        FROM admin_token_lifecycle_inputs AS lifecycle_input
       WHERE lifecycle_input.label = 'issue'
    ),
    'issue_token',
    (
      SELECT lifecycle_input.payload
        FROM admin_token_lifecycle_inputs AS lifecycle_input
       WHERE lifecycle_input.label = 'issue'
    )
  )
);

INSERT INTO admin_token_lifecycle_results VALUES (
  'issue_replay',
  public.admin_execute_mutation(
    pg_catalog.repeat('a', 64),
    'f1900000-0000-4000-8000-000000000101',
    (
      SELECT lifecycle_input.payload_hash
        FROM admin_token_lifecycle_inputs AS lifecycle_input
       WHERE lifecycle_input.label = 'issue'
    ),
    'issue_token',
    (
      SELECT lifecycle_input.payload
        FROM admin_token_lifecycle_inputs AS lifecycle_input
       WHERE lifecycle_input.label = 'issue'
    )
  )
);

DO $issue_idempotency_conflict$
BEGIN
  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('a', 64),
      'f1900000-0000-4000-8000-000000000101',
      pg_catalog.repeat('f', 64),
      'issue_token',
      (
        SELECT lifecycle_input.payload
          FROM admin_token_lifecycle_inputs AS lifecycle_input
         WHERE lifecycle_input.label = 'issue'
      )
    );
    RAISE EXCEPTION 'same-key different payload hash was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'idempotency_conflict' THEN RAISE; END IF;
  END;
END;
$issue_idempotency_conflict$;

DO $inactive_and_unauthorized$
BEGIN
  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('c', 64),
      'f1900000-0000-4000-8000-000000000102',
      pg_catalog.repeat('2', 64),
      'issue_token',
      pg_catalog.jsonb_build_object(
        'token_hash', pg_catalog.repeat('2', 64),
        'admin_id', 'f1900000-0000-4000-8000-000000000005',
        'role', 'operator',
        'expires_at', pg_catalog.now() + interval '10 days',
        'case_id', 'CASE-DENIED-SECURITY',
        'approval_ref', 'NOT-A-SECOND-ACTOR'
      )
    );
    RAISE EXCEPTION 'security_admin issue was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'admin_capability_denied' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('d', 64),
      'f1900000-0000-4000-8000-000000000103',
      pg_catalog.repeat('3', 64),
      'revoke_token',
      pg_catalog.jsonb_build_object(
        'token_id', 'f1900000-0000-4000-8000-000000000019'
      )
    );
    RAISE EXCEPTION 'operator revoke was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'admin_capability_denied' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('e', 64),
      'f1900000-0000-4000-8000-000000000104',
      pg_catalog.repeat('4', 64),
      'revoke_token',
      pg_catalog.jsonb_build_object(
        'token_id', 'f1900000-0000-4000-8000-000000000019'
      )
    );
    RAISE EXCEPTION 'revoked actor token was accepted';
  EXCEPTION WHEN invalid_authorization_specification THEN
    IF SQLERRM <> 'admin_token_inactive' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('f', 64),
      'f1900000-0000-4000-8000-000000000105',
      pg_catalog.repeat('5', 64),
      'revoke_token',
      pg_catalog.jsonb_build_object(
        'token_id', 'f1900000-0000-4000-8000-000000000019'
      )
    );
    RAISE EXCEPTION 'expired actor token was accepted';
  EXCEPTION WHEN invalid_authorization_specification THEN
    IF SQLERRM <> 'admin_token_inactive' THEN RAISE; END IF;
  END;
END;
$inactive_and_unauthorized$;

DO $deletion_tombstone_blocks_token_issue$
BEGIN
  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('a', 64),
      'f1900000-0000-4000-8000-000000000112',
      pg_catalog.repeat('c', 64),
      'issue_token',
      pg_catalog.jsonb_build_object(
        'token_hash', pg_catalog.repeat('6', 64),
        'admin_id', 'f1900000-0000-4000-8000-000000000006',
        'role', 'operator',
        'expires_at', pg_catalog.to_char(
          pg_catalog.now() + interval '10 days',
          'YYYY-MM-DD"T"HH24:MI:SS.USOF'
        ),
        'case_id', 'CASE-DELETE-TOMBSTONE-190',
        'approval_ref', 'APPROVAL-DELETE-TOMBSTONE-190'
      )
    );
    RAISE EXCEPTION 'token issue after deletion tombstone was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'admin_account_deletion_in_progress' THEN RAISE; END IF;
  END;
END;
$deletion_tombstone_blocks_token_issue$;

INSERT INTO admin_token_lifecycle_results VALUES (
  'prepare_non_last_first',
  public.admin_prepare_account_deletion(
    'f1900000-0000-4000-8000-000000000003'
  )
);

INSERT INTO admin_token_lifecycle_results VALUES (
  'prepare_non_last_replay',
  public.admin_prepare_account_deletion(
    'f1900000-0000-4000-8000-000000000003'
  )
);

INSERT INTO admin_token_lifecycle_results VALUES (
  'batch_revoke_first',
  public.admin_execute_mutation(
    pg_catalog.repeat('c', 64),
    'f1900000-0000-4000-8000-000000000106',
    pg_catalog.repeat('6', 64),
    'revoke_admin_tokens',
    pg_catalog.jsonb_build_object(
      'admin_id', 'f1900000-0000-4000-8000-000000000004',
      'case_id', 'CASE-DEPARTURE-190',
      'approval_ref', 'APPROVAL-DEPARTURE-190'
    )
  )
);

INSERT INTO admin_token_lifecycle_results VALUES (
  'batch_revoke_replay',
  public.admin_execute_mutation(
    pg_catalog.repeat('c', 64),
    'f1900000-0000-4000-8000-000000000106',
    pg_catalog.repeat('6', 64),
    'revoke_admin_tokens',
    pg_catalog.jsonb_build_object(
      'admin_id', 'f1900000-0000-4000-8000-000000000004',
      'case_id', 'CASE-DEPARTURE-190',
      'approval_ref', 'APPROVAL-DEPARTURE-190'
    )
  )
);

INSERT INTO admin_token_lifecycle_results VALUES (
  'exact_revoke_first',
  public.admin_execute_mutation(
    pg_catalog.repeat('c', 64),
    'f1900000-0000-4000-8000-000000000107',
    pg_catalog.repeat('7', 64),
    'revoke_token',
    pg_catalog.jsonb_build_object(
      'token_id', 'f1900000-0000-4000-8000-000000000019',
      'case_id', 'CASE-EXACT-190',
      'approval_ref', 'APPROVAL-EXACT-190'
    )
  )
);

INSERT INTO admin_token_lifecycle_results VALUES (
  'exact_revoke_replay',
  public.admin_execute_mutation(
    pg_catalog.repeat('c', 64),
    'f1900000-0000-4000-8000-000000000107',
    pg_catalog.repeat('7', 64),
    'revoke_token',
    pg_catalog.jsonb_build_object(
      'token_id', 'f1900000-0000-4000-8000-000000000019',
      'case_id', 'CASE-EXACT-190',
      'approval_ref', 'APPROVAL-EXACT-190'
    )
  )
);

DO $serialized_duplicate_revoke$
BEGIN
  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('c', 64),
      'f1900000-0000-4000-8000-000000000108',
      pg_catalog.repeat('8', 64),
      'revoke_admin_tokens',
      pg_catalog.jsonb_build_object(
        'admin_id', 'f1900000-0000-4000-8000-000000000004',
        'case_id', 'CASE-DUPLICATE-190',
        'approval_ref', 'APPROVAL-DUPLICATE-190'
      )
    );
    RAISE EXCEPTION 'different-key duplicate batch revoke was accepted';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM <> 'token_not_active' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('c', 64),
      'f1900000-0000-4000-8000-000000000109',
      pg_catalog.repeat('9', 64),
      'revoke_token',
      pg_catalog.jsonb_build_object(
        'token_id', 'f1900000-0000-4000-8000-000000000019',
        'case_id', 'CASE-DUPLICATE-EXACT-190',
        'approval_ref', 'APPROVAL-DUPLICATE-EXACT-190'
      )
    );
    RAISE EXCEPTION 'different-key duplicate exact revoke was accepted';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM <> 'token_not_active' THEN RAISE; END IF;
  END;
END;
$serialized_duplicate_revoke$;

DO $required_revoke_evidence$
BEGIN
  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('c', 64),
      'f1900000-0000-4000-8000-000000000110',
      pg_catalog.repeat('0', 64),
      'revoke_token',
      pg_catalog.jsonb_build_object(
        'token_id', 'f1900000-0000-4000-8000-000000000012'
      )
    );
    RAISE EXCEPTION 'exact revoke without case/approval evidence was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'admin_mutation_invalid_payload' THEN RAISE; END IF;
  END;
END;
$required_revoke_evidence$;

DO $bidi_evidence_rejected$
BEGIN
  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('c', 64),
      'f1900000-0000-4000-8000-000000000111',
      pg_catalog.repeat('b', 64),
      'revoke_token',
      pg_catalog.jsonb_build_object(
        'token_id', 'f1900000-0000-4000-8000-000000000012',
        'case_id', 'CASE-' || U&'\202E' || 'VISUAL-SPOOF',
        'approval_ref', 'APPROVAL-BIDI-REJECTION'
      )
    );
    RAISE EXCEPTION 'bidi-controlled lifecycle evidence was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'admin_mutation_invalid_payload' THEN RAISE; END IF;
  END;
END;
$bidi_evidence_rejected$;

RESET ROLE;

-- A prepared token is already revoked/audited, so detachment must redact it
-- without duplicating token_revoked. A separate unrevoked token proves direct
-- profile deletion still performs one required revoke audit.
--
-- The banner owner fixture covers every live storage-saga state that must
-- survive profile deletion. The attached row is admitted through the real
-- banner triggers rather than being labelled attached by fixture fiat.
INSERT INTO public.admin_tokens (
  id, token_hash, admin_id, admin_name, admin_email, role, expires_at,
  revoked_at, created_by
) VALUES (
  'f1900000-0000-4000-8000-000000000022', pg_catalog.repeat('5', 64),
  'f1900000-0000-4000-8000-000000000009', 'Banner Owner Delete',
  'banner-owner-delete@example.test', 'owner', pg_catalog.now() + interval '30 days',
  NULL, 'f1900000-0000-4000-8000-000000000001'
);

-- Issuance is not recovery proof. Token 11 was successfully presented above;
-- token 22 is an owner on a different live profile but still has last_used_at
-- NULL. Neither the lifecycle revoke guard, the direct table trigger nor
-- account-deletion readiness may count 22 until authorization proves that its
-- plaintext survived. Keep the entire before/after exercise in a rolled-back
-- subtransaction so the remaining saga fixtures retain their original state.
DO $fresh_owner_verification_gate$
DECLARE
  before_readiness jsonb;
  after_readiness jsonb;
  revoke_result jsonb;
  authorization_rows integer;
  inventory_last_used_at timestamptz;
BEGIN
  BEGIN
    IF NOT EXISTS (
         SELECT 1 FROM public.admin_tokens AS token
          WHERE token.id = 'f1900000-0000-4000-8000-000000000011'
            AND token.last_used_at IS NOT NULL
       )
       OR EXISTS (
         SELECT 1 FROM public.admin_tokens AS token
          WHERE token.id IN (
            'f1900000-0000-4000-8000-000000000012'::uuid,
            'f1900000-0000-4000-8000-000000000022'::uuid
          )
            AND token.last_used_at IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'verified/fresh owner fixture precondition drifted';
    END IF;

    BEGIN
      PERFORM public.admin_execute_mutation(
        pg_catalog.repeat('a', 64),
        'f1900000-0000-4000-8000-000000000918',
        pg_catalog.repeat('8', 64),
        'issue_token',
        pg_catalog.jsonb_build_object(
          'token_hash', pg_catalog.repeat('2', 64),
          'admin_id', 'f1900000-0000-4000-8000-000000000005',
          'role', 'owner',
          'expires_at', pg_catalog.clock_timestamp() + interval '23 hours',
          'case_id', 'CASE-SHORT-OWNER-ISSUE-190',
          'approval_ref', 'APPROVAL-SHORT-OWNER-ISSUE-190'
        )
      );
      RAISE EXCEPTION 'owner issue below 24 hours was accepted';
    EXCEPTION WHEN invalid_parameter_value THEN
      IF SQLERRM <> 'admin_mutation_invalid_payload' THEN RAISE; END IF;
    END;

    BEGIN
      PERFORM public.admin_execute_mutation(
        pg_catalog.repeat('c', 64),
        'f1900000-0000-4000-8000-000000000915',
        pg_catalog.repeat('1', 64),
        'revoke_token',
        pg_catalog.jsonb_build_object(
          'token_id', 'f1900000-0000-4000-8000-000000000011',
          'case_id', 'CASE-FRESH-OWNER-REFUSAL-190',
          'approval_ref', 'APPROVAL-FRESH-OWNER-REFUSAL-190'
        )
      );
      RAISE EXCEPTION 'fresh owner replacement allowed lifecycle revoke';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
      IF SQLERRM <> 'last_active_owner_token' THEN RAISE; END IF;
    END;

    BEGIN
      UPDATE public.admin_tokens AS token
         SET revoked_at = pg_catalog.now()
       WHERE token.id = 'f1900000-0000-4000-8000-000000000011';
      RAISE EXCEPTION 'fresh owner replacement allowed direct table revoke';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
      IF SQLERRM <> 'last_active_owner_token' THEN RAISE; END IF;
    END;

    before_readiness := public.admin_prepare_account_deletion(
      'f1900000-0000-4000-8000-000000000001'
    );
    IF before_readiness IS DISTINCT FROM pg_catalog.jsonb_build_object(
         'ready', false,
         'reason', 'admin_recovery_transfer_required',
         'job', NULL
       ) THEN
      RAISE EXCEPTION
        'fresh owner replacement allowed account deletion: %', before_readiness;
    END IF;

    SELECT pg_catalog.count(*) INTO authorization_rows
      FROM public.admin_token_authorization(pg_catalog.repeat('5', 64));
    SELECT inventory.last_used_at INTO inventory_last_used_at
      FROM public.admin_token_inventory() AS inventory
     WHERE inventory.id = 'f1900000-0000-4000-8000-000000000022';
    IF authorization_rows <> 1
       OR inventory_last_used_at IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.admin_tokens AS token
          WHERE token.id = 'f1900000-0000-4000-8000-000000000022'
            AND token.last_used_at IS NOT NULL
       ) THEN
      RAISE EXCEPTION
        'first successful owner authorization did not publish verification signal';
    END IF;

    UPDATE public.admin_tokens AS token
       SET expires_at = pg_catalog.clock_timestamp() + interval '23 hours'
     WHERE token.id = 'f1900000-0000-4000-8000-000000000022';

    BEGIN
      PERFORM public.admin_execute_mutation(
        pg_catalog.repeat('c', 64),
        'f1900000-0000-4000-8000-000000000919',
        pg_catalog.repeat('9', 64),
        'revoke_token',
        pg_catalog.jsonb_build_object(
          'token_id', 'f1900000-0000-4000-8000-000000000011',
          'case_id', 'CASE-SHORT-OWNER-REFUSAL-190',
          'approval_ref', 'APPROVAL-SHORT-OWNER-REFUSAL-190'
        )
      );
      RAISE EXCEPTION 'verified owner below 24 hours allowed lifecycle revoke';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
      IF SQLERRM <> 'last_active_owner_token' THEN RAISE; END IF;
    END;

    BEGIN
      UPDATE public.admin_tokens AS token
         SET revoked_at = pg_catalog.now()
       WHERE token.id = 'f1900000-0000-4000-8000-000000000011';
      RAISE EXCEPTION 'verified owner below 24 hours allowed direct table revoke';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
      IF SQLERRM <> 'last_active_owner_token' THEN RAISE; END IF;
    END;

    before_readiness := public.admin_prepare_account_deletion(
      'f1900000-0000-4000-8000-000000000001'
    );
    IF before_readiness IS DISTINCT FROM pg_catalog.jsonb_build_object(
         'ready', false,
         'reason', 'admin_recovery_transfer_required',
         'job', NULL
       ) THEN
      RAISE EXCEPTION
        'verified owner below 24 hours allowed account deletion: %',
        before_readiness;
    END IF;

    UPDATE public.admin_tokens AS token
       SET expires_at = pg_catalog.clock_timestamp() + interval '25 hours'
     WHERE token.id = 'f1900000-0000-4000-8000-000000000022';

    revoke_result := public.admin_execute_mutation(
      pg_catalog.repeat('c', 64),
      'f1900000-0000-4000-8000-000000000916',
      pg_catalog.repeat('2', 64),
      'revoke_token',
      pg_catalog.jsonb_build_object(
        'token_id', 'f1900000-0000-4000-8000-000000000011',
        'case_id', 'CASE-VERIFIED-OWNER-TRANSFER-190',
        'approval_ref', 'APPROVAL-VERIFIED-OWNER-TRANSFER-190'
      )
    );
    IF revoke_result ->> 'success' <> 'true' THEN
      RAISE EXCEPTION
        'verified owner replacement did not allow lifecycle revoke: %', revoke_result;
    END IF;

    after_readiness := public.admin_prepare_account_deletion(
      'f1900000-0000-4000-8000-000000000001'
    );
    IF after_readiness ->> 'ready' <> 'true'
       OR after_readiness ->> 'reason' IS NOT NULL THEN
      RAISE EXCEPTION
        'verified owner replacement did not allow account deletion: %',
        after_readiness;
    END IF;

    RAISE EXCEPTION USING
      ERRCODE = 'P0191',
      MESSAGE = 'rollback_verified_owner_fixture';
  EXCEPTION WHEN SQLSTATE 'P0191' THEN
    IF SQLERRM <> 'rollback_verified_owner_fixture' THEN RAISE; END IF;
  END;

  IF EXISTS (
       SELECT 1 FROM public.admin_tokens AS token
        WHERE token.id = 'f1900000-0000-4000-8000-000000000022'
          AND token.last_used_at IS NOT NULL
     )
     OR EXISTS (
       SELECT 1 FROM public.admin_tokens AS token
        WHERE token.id = 'f1900000-0000-4000-8000-000000000011'
          AND token.revoked_at IS NOT NULL
     )
     OR EXISTS (
       SELECT 1 FROM public.account_deletion_jobs AS deletion_job
        WHERE deletion_job.user_id = 'f1900000-0000-4000-8000-000000000001'
     )
     OR EXISTS (
       SELECT 1 FROM public.admin_mutation_requests AS request
        WHERE request.idempotency_key IN (
          'f1900000-0000-4000-8000-000000000915'::uuid,
          'f1900000-0000-4000-8000-000000000916'::uuid,
          'f1900000-0000-4000-8000-000000000918'::uuid,
          'f1900000-0000-4000-8000-000000000919'::uuid
        )
     ) THEN
    RAISE EXCEPTION 'verified-owner activation fixture did not roll back cleanly';
  END IF;
END;
$fresh_owner_verification_gate$;

-- Set-wise batch authorization must reason about the complete target array.
-- Two verified owners on one departing profile cannot each count the other
-- before a single UPDATE removes both.
DO $batch_owner_set_guard$
BEGIN
  BEGIN
    UPDATE public.admin_tokens AS token
       SET last_used_at = pg_catalog.clock_timestamp()
     WHERE token.id = 'f1900000-0000-4000-8000-000000000012';

    BEGIN
      PERFORM public.admin_execute_mutation(
        pg_catalog.repeat('c', 64),
        'f1900000-0000-4000-8000-000000000920',
        pg_catalog.repeat('0', 64),
        'revoke_admin_tokens',
        pg_catalog.jsonb_build_object(
          'admin_id', 'f1900000-0000-4000-8000-000000000001',
          'case_id', 'CASE-BATCH-OWNER-SET-190',
          'approval_ref', 'APPROVAL-BATCH-OWNER-SET-190'
        )
      );
      RAISE EXCEPTION 'batch revoked the only two verified owner tokens';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
      IF SQLERRM <> 'last_active_owner_token' THEN RAISE; END IF;
    END;

    RAISE EXCEPTION USING
      ERRCODE = 'P0192',
      MESSAGE = 'rollback_batch_owner_set_fixture';
  EXCEPTION WHEN SQLSTATE 'P0192' THEN
    IF SQLERRM <> 'rollback_batch_owner_set_fixture' THEN RAISE; END IF;
  END;

  IF EXISTS (
       SELECT 1 FROM public.admin_tokens AS token
        WHERE token.id = 'f1900000-0000-4000-8000-000000000012'
          AND token.last_used_at IS NOT NULL
     )
     OR EXISTS (
       SELECT 1 FROM public.admin_tokens AS token
        WHERE token.id IN (
          'f1900000-0000-4000-8000-000000000011'::uuid,
          'f1900000-0000-4000-8000-000000000012'::uuid
        )
          AND token.revoked_at IS NOT NULL
     )
     OR EXISTS (
       SELECT 1 FROM public.admin_mutation_requests AS request
        WHERE request.idempotency_key =
              'f1900000-0000-4000-8000-000000000920'
     ) THEN
    RAISE EXCEPTION 'batch owner set fixture did not roll back cleanly';
  END IF;
END;
$batch_owner_set_guard$;

INSERT INTO public.admin_banner_uploads (
  id, admin_token_id, idempotency_key, actor_id, admin_role, content_hash,
  mime_type, size_bytes, object_name, status, completed_at, gc_after
) VALUES
  (
    'f1900000-0000-4000-8000-000000000031',
    'f1900000-0000-4000-8000-000000000022',
    'f1900000-0000-4000-8000-000000000201',
    'f1900000-0000-4000-8000-000000000009', 'owner',
    pg_catalog.repeat('a', 64), 'image/png', 101,
    'managed/f1900000-0000-4000-8000-000000000022/f1900000-0000-4000-8000-000000000201/'
      || pg_catalog.repeat('a', 64) || '.png',
    'prepared', NULL, pg_catalog.now() + interval '1 hour'
  ),
  (
    'f1900000-0000-4000-8000-000000000032',
    'f1900000-0000-4000-8000-000000000022',
    'f1900000-0000-4000-8000-000000000202',
    'f1900000-0000-4000-8000-000000000009', 'owner',
    pg_catalog.repeat('b', 64), 'image/png', 102,
    'managed/f1900000-0000-4000-8000-000000000022/f1900000-0000-4000-8000-000000000202/'
      || pg_catalog.repeat('b', 64) || '.png',
    'available', pg_catalog.now(), pg_catalog.now() + interval '24 hours'
  ),
  (
    'f1900000-0000-4000-8000-000000000033',
    'f1900000-0000-4000-8000-000000000022',
    'f1900000-0000-4000-8000-000000000203',
    'f1900000-0000-4000-8000-000000000009', 'owner',
    pg_catalog.repeat('c', 64), 'image/png', 103,
    'managed/f1900000-0000-4000-8000-000000000022/f1900000-0000-4000-8000-000000000203/'
      || pg_catalog.repeat('c', 64) || '.png',
    'available', pg_catalog.now(), pg_catalog.now() + interval '24 hours'
  );

INSERT INTO public.banners (id, image_url, title, active)
SELECT 'f1900000-0000-4000-8000-000000000041',
       'https://assets.example.test' || upload.public_path,
       'Retained attached upload fixture',
       true
  FROM public.admin_banner_uploads AS upload
 WHERE upload.id = 'f1900000-0000-4000-8000-000000000033';

-- Complete the upload reconciliation matrix, including terminal GC and the
-- two genuinely non-terminal states. The available-without-completion row is
-- deliberate privileged fault injection for the uncertain fail-closed path.
INSERT INTO public.admin_banner_uploads (
  id, admin_token_id, idempotency_key, actor_id, admin_role, content_hash,
  mime_type, size_bytes, object_name, status, completed_at, gc_after, deleted_at
) VALUES
  (
    'f1900000-0000-4000-8000-000000000034',
    'f1900000-0000-4000-8000-000000000022',
    'f1900000-0000-4000-8000-000000000204',
    'f1900000-0000-4000-8000-000000000009', 'owner',
    pg_catalog.repeat('d', 64), 'image/png', 104,
    'managed/f1900000-0000-4000-8000-000000000022/f1900000-0000-4000-8000-000000000204/'
      || pg_catalog.repeat('d', 64) || '.png',
    'gc_pending', pg_catalog.now(), pg_catalog.now() + interval '1 hour', NULL
  ),
  (
    'f1900000-0000-4000-8000-000000000035',
    'f1900000-0000-4000-8000-000000000022',
    'f1900000-0000-4000-8000-000000000205',
    'f1900000-0000-4000-8000-000000000009', 'owner',
    pg_catalog.repeat('e', 64), 'image/png', 105,
    'managed/f1900000-0000-4000-8000-000000000022/f1900000-0000-4000-8000-000000000205/'
      || pg_catalog.repeat('e', 64) || '.png',
    'gc_pending', NULL, pg_catalog.now() + interval '1 hour', NULL
  ),
  (
    'f1900000-0000-4000-8000-000000000036',
    'f1900000-0000-4000-8000-000000000022',
    'f1900000-0000-4000-8000-000000000206',
    'f1900000-0000-4000-8000-000000000009', 'owner',
    pg_catalog.repeat('f', 64), 'image/png', 106,
    'managed/f1900000-0000-4000-8000-000000000022/f1900000-0000-4000-8000-000000000206/'
      || pg_catalog.repeat('f', 64) || '.png',
    'deleted', NULL, pg_catalog.now() + interval '100 years', pg_catalog.now()
  ),
  (
    'f1900000-0000-4000-8000-000000000037',
    'f1900000-0000-4000-8000-000000000022',
    'f1900000-0000-4000-8000-000000000207',
    'f1900000-0000-4000-8000-000000000009', 'owner',
    pg_catalog.repeat('2', 64), 'image/png', 107,
    'managed/f1900000-0000-4000-8000-000000000022/f1900000-0000-4000-8000-000000000207/'
      || pg_catalog.repeat('2', 64) || '.png',
    'available', NULL, pg_catalog.now() + interval '24 hours', NULL
  ),
  (
    'f1900000-0000-4000-8000-000000000038',
    'f1900000-0000-4000-8000-000000000022',
    'f1900000-0000-4000-8000-000000000909',
    'f1900000-0000-4000-8000-000000000009', 'owner',
    pg_catalog.repeat('3', 64), 'image/png', 108,
    'managed/f1900000-0000-4000-8000-000000000022/f1900000-0000-4000-8000-000000000909/'
      || pg_catalog.repeat('3', 64) || '.png',
    'available', pg_catalog.now(), pg_catalog.now() + interval '24 hours', NULL
  ),
  (
    'f1900000-0000-4000-8000-000000000039',
    'f1900000-0000-4000-8000-000000000022',
    'f1900000-0000-4000-8000-000000000214',
    'f1900000-0000-4000-8000-000000000009', 'owner',
    pg_catalog.repeat('4', 64), 'image/png', 109,
    'managed/f1900000-0000-4000-8000-000000000022/f1900000-0000-4000-8000-000000000214/'
      || pg_catalog.repeat('4', 64) || '.png',
    'prepared', NULL, pg_catalog.now() + interval '1 hour', NULL
  );

-- Same UUID on two historical tokens and the same UUID across both ledgers are
-- both ambiguous. A separate committed running row covers the minimal running
-- response without exposing action, actor, token or payload metadata.
INSERT INTO public.admin_mutation_requests (
  admin_token_id, idempotency_key, actor_id, action, payload_hash,
  status, result, completed_at
) VALUES
  (
    'f1900000-0000-4000-8000-000000000011',
    'f1900000-0000-4000-8000-000000000908',
    'f1900000-0000-4000-8000-000000000001',
    'apply_ban', pg_catalog.repeat('8', 64),
    'completed', '{"success":true}'::jsonb, pg_catalog.now()
  ),
  (
    'f1900000-0000-4000-8000-000000000012',
    'f1900000-0000-4000-8000-000000000908',
    'f1900000-0000-4000-8000-000000000001',
    'apply_ban', pg_catalog.repeat('9', 64),
    'completed', '{"success":true}'::jsonb, pg_catalog.now()
  ),
  (
    'f1900000-0000-4000-8000-000000000011',
    'f1900000-0000-4000-8000-000000000909',
    'f1900000-0000-4000-8000-000000000001',
    'apply_ban', pg_catalog.repeat('3', 64),
    'completed', '{"success":true}'::jsonb, pg_catalog.now()
  ),
  (
    'f1900000-0000-4000-8000-000000000011',
    'f1900000-0000-4000-8000-000000000913',
    'f1900000-0000-4000-8000-000000000001',
    'apply_ban', pg_catalog.repeat('4', 64),
    'running', NULL, NULL
  ),
  (
    'f1900000-0000-4000-8000-000000000011',
    'f1900000-0000-4000-8000-000000000910',
    'f1900000-0000-4000-8000-000000000001',
    'apply_ban', pg_catalog.repeat('5', 64),
    'running', NULL, NULL
  );

SET LOCAL ROLE authenticated;

DO $authenticated_reconciliation_denied$
BEGIN
  BEGIN
    PERFORM public.admin_reconcile_idempotency_outcome(
      pg_catalog.repeat('b', 64),
      'f1900000-0000-4000-8000-000000000901'
    );
    RAISE EXCEPTION 'authenticated idempotency reconciliation was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$authenticated_reconciliation_denied$;

RESET ROLE;

SET LOCAL ROLE service_role;

DO $opaque_idempotency_reconciliation$
DECLARE
  outcome jsonb;
BEGIN
  -- Current owner B can reconcile completed evidence written by historical
  -- owner A, including after A's browser/token context is unavailable.
  outcome := public.admin_reconcile_idempotency_outcome(
    pg_catalog.repeat('b', 64),
    'f1900000-0000-4000-8000-000000000101'
  );
  IF outcome IS DISTINCT FROM '{"status":"completed"}'::jsonb THEN
    RAISE EXCEPTION 'cross-token completed mutation reconciliation drifted: %',
      outcome;
  END IF;

  outcome := public.admin_reconcile_idempotency_outcome(
    pg_catalog.repeat('b', 64),
    'f1900000-0000-4000-8000-000000000913'
  );
  IF outcome IS DISTINCT FROM '{"status":"running"}'::jsonb THEN
    RAISE EXCEPTION 'running mutation reconciliation exposed wrong shape: %',
      outcome;
  END IF;

  outcome := public.admin_reconcile_idempotency_outcome(
    pg_catalog.repeat('b', 64),
    'f1900000-0000-4000-8000-000000000201'
  );
  IF outcome IS DISTINCT FROM '{"status":"running"}'::jsonb THEN
    RAISE EXCEPTION 'prepared banner reconciliation was not running: %', outcome;
  END IF;

  IF public.admin_reconcile_idempotency_outcome(
       pg_catalog.repeat('b', 64),
       'f1900000-0000-4000-8000-000000000202'
     ) IS DISTINCT FROM '{"status":"completed"}'::jsonb
     OR public.admin_reconcile_idempotency_outcome(
       pg_catalog.repeat('b', 64),
       'f1900000-0000-4000-8000-000000000203'
     ) IS DISTINCT FROM '{"status":"completed"}'::jsonb
     OR public.admin_reconcile_idempotency_outcome(
       pg_catalog.repeat('b', 64),
       'f1900000-0000-4000-8000-000000000204'
     ) IS DISTINCT FROM '{"status":"completed"}'::jsonb
     OR public.admin_reconcile_idempotency_outcome(
       pg_catalog.repeat('b', 64),
       'f1900000-0000-4000-8000-000000000205'
     ) IS DISTINCT FROM '{"status":"running"}'::jsonb
     OR public.admin_reconcile_idempotency_outcome(
       pg_catalog.repeat('b', 64),
       'f1900000-0000-4000-8000-000000000206'
     ) IS DISTINCT FROM '{"status":"completed"}'::jsonb THEN
    RAISE EXCEPTION
      'available/attached/gc_pending/deleted banner reconciliation matrix drifted';
  END IF;

  BEGIN
    PERFORM public.admin_reconcile_idempotency_outcome(
      pg_catalog.repeat('b', 64),
      'f1900000-0000-4000-8000-000000000207'
    );
    RAISE EXCEPTION 'inconsistent banner reconciliation was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'admin_idempotency_reconcile_uncertain' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_reconcile_idempotency_outcome(
      pg_catalog.repeat('b', 64),
      'f1900000-0000-4000-8000-000000000908'
    );
    RAISE EXCEPTION 'same UUID across historical tokens was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'admin_idempotency_reconcile_collision' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_reconcile_idempotency_outcome(
      pg_catalog.repeat('b', 64),
      'f1900000-0000-4000-8000-000000000909'
    );
    RAISE EXCEPTION 'same UUID across mutation/banner ledgers was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'admin_idempotency_reconcile_collision' THEN RAISE; END IF;
  END;

  -- A zero-evidence response is an authoritative claim, is idempotent, and has
  -- exactly one opaque status key. Use token 22 for one claim so later profile
  -- deletion proves the fence survives reconciler detachment.
  outcome := public.admin_reconcile_idempotency_outcome(
    pg_catalog.repeat('b', 64),
    'f1900000-0000-4000-8000-000000000901'
  );
  IF outcome IS DISTINCT FROM '{"status":"not_dispatched"}'::jsonb
     OR public.admin_reconcile_idempotency_outcome(
       pg_catalog.repeat('b', 64),
       'f1900000-0000-4000-8000-000000000901'
     ) IS DISTINCT FROM outcome THEN
    RAISE EXCEPTION 'zero-evidence authoritative fence result drifted: %', outcome;
  END IF;

  IF public.admin_reconcile_idempotency_outcome(
       pg_catalog.repeat('5', 64),
       'f1900000-0000-4000-8000-000000000902'
     ) IS DISTINCT FROM '{"status":"not_dispatched"}'::jsonb
     OR public.admin_reconcile_idempotency_outcome(
       pg_catalog.repeat('b', 64),
       'f1900000-0000-4000-8000-000000000911'
     ) IS DISTINCT FROM '{"status":"not_dispatched"}'::jsonb
     OR public.admin_reconcile_idempotency_outcome(
       pg_catalog.repeat('b', 64),
       'f1900000-0000-4000-8000-000000000912'
     ) IS DISTINCT FROM '{"status":"not_dispatched"}'::jsonb THEN
    RAISE EXCEPTION 'additional authoritative fence claims drifted';
  END IF;

  BEGIN
    PERFORM public.admin_reconcile_idempotency_outcome(
      pg_catalog.repeat('c', 64),
      'f1900000-0000-4000-8000-000000000901'
    );
    RAISE EXCEPTION 'non-owner idempotency reconciliation was accepted';
  EXCEPTION WHEN invalid_authorization_specification THEN
    IF SQLERRM <> 'admin_owner_token_inactive' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_reconcile_idempotency_outcome(
      'not-a-sha256-digest',
      'f1900000-0000-4000-8000-000000000901'
    );
    RAISE EXCEPTION 'invalid idempotency reconciliation input was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'admin_idempotency_reconcile_invalid' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_reconcile_idempotency_outcome(
      pg_catalog.repeat('b', 64), NULL
    );
    RAISE EXCEPTION 'null idempotency reconciliation key was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'admin_idempotency_reconcile_invalid' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM fence.idempotency_key
      FROM public.admin_idempotency_reconciliation_fences AS fence LIMIT 1;
    RAISE EXCEPTION 'service_role raw reconciliation fence SELECT was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$opaque_idempotency_reconciliation$;

RESET ROLE;

DO $authoritative_fence_rejects_late_writes$
BEGIN
  BEGIN
    INSERT INTO public.admin_mutation_requests (
      admin_token_id, idempotency_key, actor_id, action, payload_hash
    ) VALUES (
      'f1900000-0000-4000-8000-000000000011',
      'f1900000-0000-4000-8000-000000000901',
      'f1900000-0000-4000-8000-000000000001',
      'apply_ban', pg_catalog.repeat('6', 64)
    );
    RAISE EXCEPTION 'fence accepted a late mutation ledger INSERT';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'admin_idempotency_reconciled' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO public.admin_banner_uploads (
      id, admin_token_id, idempotency_key, actor_id, admin_role, content_hash,
      mime_type, size_bytes, object_name, status, completed_at, gc_after
    ) VALUES (
      'f1900000-0000-4000-8000-000000000040',
      'f1900000-0000-4000-8000-000000000022',
      'f1900000-0000-4000-8000-000000000902',
      'f1900000-0000-4000-8000-000000000009', 'owner',
      pg_catalog.repeat('7', 64), 'image/png', 110,
      'managed/f1900000-0000-4000-8000-000000000022/f1900000-0000-4000-8000-000000000902/'
        || pg_catalog.repeat('7', 64) || '.png',
      'available', pg_catalog.now(), pg_catalog.now() + interval '24 hours'
    );
    RAISE EXCEPTION 'fence accepted a late banner ledger INSERT';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'admin_idempotency_reconciled' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.admin_mutation_requests AS request
       SET idempotency_key = 'f1900000-0000-4000-8000-000000000911'
     WHERE request.idempotency_key = 'f1900000-0000-4000-8000-000000000910';
    RAISE EXCEPTION 'mutation idempotency UPDATE bypassed reconciliation fence';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'admin_idempotency_reconciled' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.admin_banner_uploads AS upload
       SET idempotency_key = 'f1900000-0000-4000-8000-000000000912'
     WHERE upload.idempotency_key = 'f1900000-0000-4000-8000-000000000214';
    RAISE EXCEPTION 'banner idempotency UPDATE bypassed reconciliation fence';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'admin_idempotency_reconciled' THEN RAISE; END IF;
  END;

  IF EXISTS (
       SELECT 1 FROM public.admin_mutation_requests AS request
        WHERE request.idempotency_key =
              'f1900000-0000-4000-8000-000000000901'
     )
     OR EXISTS (
       SELECT 1 FROM public.admin_banner_uploads AS upload
        WHERE upload.idempotency_key =
              'f1900000-0000-4000-8000-000000000902'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.admin_mutation_requests AS request
        WHERE request.idempotency_key =
              'f1900000-0000-4000-8000-000000000910'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.admin_banner_uploads AS upload
        WHERE upload.idempotency_key =
              'f1900000-0000-4000-8000-000000000214'
     )
     OR EXISTS (
       SELECT 1
         FROM public.admin_idempotency_reconciliation_fences AS fence
        WHERE fence.idempotency_key IN (
          'f1900000-0000-4000-8000-000000000908'::uuid,
          'f1900000-0000-4000-8000-000000000909'::uuid
        )
     ) THEN
    RAISE EXCEPTION 'fence rejection/collision left a ledger or claim side effect';
  END IF;
END;
$authoritative_fence_rejects_late_writes$;

DELETE FROM public.profiles AS profile
 WHERE profile.id = 'f1900000-0000-4000-8000-000000000003';
DELETE FROM public.profiles AS profile
 WHERE profile.id = 'f1900000-0000-4000-8000-000000000007';
DELETE FROM public.profiles AS profile
 WHERE profile.id = 'f1900000-0000-4000-8000-000000000009';

DO $detached_reconciler_fence_retained$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_idempotency_reconciliation_fences AS fence
      JOIN public.admin_tokens AS token ON token.id = fence.reconciled_by
     WHERE fence.idempotency_key =
           'f1900000-0000-4000-8000-000000000902'
       AND fence.reconciled_by =
           'f1900000-0000-4000-8000-000000000022'
       AND fence.reconciled_at IS NOT NULL
       AND token.admin_id IS NULL
       AND token.revoked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'authoritative fence was not retained after reconciler profile detachment';
  END IF;
END;
$detached_reconciler_fence_retained$;

SET LOCAL ROLE service_role;

DO $detached_token_reconciliation$
DECLARE
  detached_payload jsonb;
BEGIN
  SELECT pg_catalog.to_jsonb(reconciled)
    INTO detached_payload
    FROM public.admin_reconcile_issued_token(
      pg_catalog.repeat('4', 64)
    ) AS reconciled;

  IF detached_payload IS NULL
     OR detached_payload ->> 'id'
        <> 'f1900000-0000-4000-8000-000000000021'
     OR NOT (detached_payload ? 'admin_id')
     OR detached_payload ->> 'admin_id' IS NOT NULL
     OR detached_payload ->> 'role' <> 'operator'
     OR detached_payload ->> 'revoked_at' IS NULL
     OR detached_payload ? 'token_hash'
     OR detached_payload ? 'admin_name'
     OR detached_payload ? 'admin_email' THEN
    RAISE EXCEPTION
      'detached token reconciliation did not retain safe lifecycle metadata: %',
      detached_payload;
  END IF;
END;
$detached_token_reconciliation$;

RESET ROLE;

DO $last_owner_profile_delete$
BEGIN
  BEGIN
    DELETE FROM public.profiles AS profile
     WHERE profile.id = 'f1900000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'last owner profile deletion was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'last_active_owner_token' THEN RAISE; END IF;
  END;
END;
$last_owner_profile_delete$;

DO $assertions$
DECLARE
  issued_id uuid;
  issued_result jsonb;
  batch_result jsonb;
  no_token_prepare jsonb;
  missing_profile_prepare jsonb;
  existing_job_prepare jsonb;
  non_last_prepare jsonb;
  last_owner_prepare jsonb;
  job_keys text[];
  lifecycle_source text;
  profile_delete_lock_source text;
BEGIN
  SELECT result INTO issued_result
    FROM admin_token_lifecycle_results
   WHERE label = 'issue_first';
  issued_id := (issued_result -> 'data' ->> 'token_id')::uuid;
  SELECT result INTO batch_result
    FROM admin_token_lifecycle_results
   WHERE label = 'batch_revoke_first';
  SELECT result INTO no_token_prepare
    FROM admin_token_lifecycle_results
   WHERE label = 'prepare_no_token_first';
  SELECT result INTO missing_profile_prepare
    FROM admin_token_lifecycle_results
   WHERE label = 'prepare_missing_profile_first';
  SELECT result INTO existing_job_prepare
    FROM admin_token_lifecycle_results
   WHERE label = 'prepare_existing_job_first';
  SELECT result INTO non_last_prepare
    FROM admin_token_lifecycle_results
   WHERE label = 'prepare_non_last_first';
  SELECT result INTO last_owner_prepare
    FROM admin_token_lifecycle_results
   WHERE label = 'prepare_last_owner';

  SELECT pg_catalog.array_agg(job_key ORDER BY job_key)
    INTO job_keys
    FROM pg_catalog.jsonb_object_keys(no_token_prepare -> 'job') AS keys(job_key);

  IF no_token_prepare IS DISTINCT FROM (
       SELECT result FROM admin_token_lifecycle_results
        WHERE label = 'prepare_no_token_replay'
     )
     OR no_token_prepare ->> 'ready' <> 'true'
     OR no_token_prepare ->> 'reason' IS NOT NULL
     OR no_token_prepare -> 'job' ->> 'user_id'
        <> 'f1900000-0000-4000-8000-000000000006'
     OR no_token_prepare -> 'job' ->> 'stage' <> 'requested'
     OR no_token_prepare -> 'job' ->> 'wechat_openid' <> 'wx-no-token-190'
     OR job_keys IS DISTINCT FROM ARRAY[
       'completed_at', 'last_error', 'requested_at', 'stage',
       'updated_at', 'user_id', 'wechat_openid'
     ]::text[] THEN
    RAISE EXCEPTION 'no-token prepare/replay/full-job response drifted: %',
      no_token_prepare;
  END IF;

  IF missing_profile_prepare IS DISTINCT FROM (
       SELECT result FROM admin_token_lifecycle_results
        WHERE label = 'prepare_missing_profile_replay'
     )
     OR missing_profile_prepare ->> 'ready' <> 'true'
     OR missing_profile_prepare ->> 'reason' IS NOT NULL
     OR missing_profile_prepare -> 'job' ->> 'user_id'
        <> 'f1900000-0000-4000-8000-000000000010'
     OR missing_profile_prepare -> 'job' ->> 'stage' <> 'requested'
     OR missing_profile_prepare -> 'job' -> 'wechat_openid'
        IS DISTINCT FROM 'null'::jsonb
     OR NOT EXISTS (
       SELECT 1 FROM auth.users AS auth_user
        WHERE auth_user.id = 'f1900000-0000-4000-8000-000000000010'
     )
     OR EXISTS (
       SELECT 1 FROM public.profiles AS profile
        WHERE profile.id = 'f1900000-0000-4000-8000-000000000010'
     ) THEN
    RAISE EXCEPTION
      'valid Auth identity without profile did not get a null-WeChat deletion job: %',
      missing_profile_prepare;
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM public.profiles AS profile
        WHERE profile.id = 'f1910000-0000-4000-8000-000000000001'
          AND profile.nickname = 'Recovered Profile'
          AND profile.location = 'Champaign'
          AND profile.status_text = 'Recovered'
     )
     OR EXISTS (
       SELECT 1 FROM public.profiles AS profile
        WHERE profile.id = 'f1910000-0000-4000-8000-000000000002'
     ) THEN
    RAISE EXCEPTION
      'exact own-profile recovery INSERT ACL/RLS behavior drifted';
  END IF;

  IF existing_job_prepare IS DISTINCT FROM (
       SELECT result FROM admin_token_lifecycle_results
        WHERE label = 'prepare_existing_job_replay'
     )
     OR existing_job_prepare ->> 'ready' <> 'true'
     OR existing_job_prepare -> 'job' ->> 'stage' <> 'storage_deleted'
     OR existing_job_prepare -> 'job' ->> 'wechat_openid' <> 'wx-old-job-190'
     OR EXISTS (
       SELECT 1 FROM public.admin_tokens AS token
        WHERE token.id = 'f1900000-0000-4000-8000-000000000020'
          AND token.revoked_at IS NULL
     )
     OR (SELECT pg_catalog.count(*) FROM public.admin_audit_log AS audit
          WHERE audit.event_kind = 'token_revoked'
            AND audit.actor_id IS NULL
            AND audit.target_id = 'f1900000-0000-4000-8000-000000000008'
            AND audit.details ->> 'mode' = 'account_deletion_prepared'
            AND (audit.details ->> 'revoked_count')::integer = 1) <> 1 THEN
    RAISE EXCEPTION 'existing-job token revoke/replay/audit drifted: %',
      existing_job_prepare;
  END IF;

  IF non_last_prepare IS DISTINCT FROM (
       SELECT result FROM admin_token_lifecycle_results
        WHERE label = 'prepare_non_last_replay'
     )
     OR non_last_prepare ->> 'ready' <> 'true'
     OR EXISTS (
       SELECT 1 FROM public.admin_tokens AS token
        WHERE token.id = 'f1900000-0000-4000-8000-000000000014'
          AND token.revoked_at IS NULL
     )
     OR (SELECT pg_catalog.count(*) FROM public.admin_audit_log AS audit
          WHERE audit.event_kind = 'token_revoked'
            AND audit.actor_id IS NULL
            AND audit.target_id = 'f1900000-0000-4000-8000-000000000003'
            AND audit.details ->> 'mode' = 'account_deletion_prepared'
            AND (audit.details ->> 'revoked_count')::integer = 1) <> 1 THEN
    RAISE EXCEPTION 'safe non-last admin prepare/replay/audit drifted: %',
      non_last_prepare;
  END IF;

  IF last_owner_prepare IS DISTINCT FROM pg_catalog.jsonb_build_object(
       'ready', false,
       'reason', 'admin_recovery_transfer_required',
       'job', NULL
     )
     OR EXISTS (
       SELECT 1 FROM public.account_deletion_jobs AS deletion_job
        WHERE deletion_job.user_id = 'f1900000-0000-4000-8000-000000000001'
     )
     OR EXISTS (
       SELECT 1 FROM public.admin_audit_log AS audit
        WHERE audit.target_id = 'f1900000-0000-4000-8000-000000000001'
          AND audit.details ->> 'mode' = 'account_deletion_prepared'
     ) THEN
    RAISE EXCEPTION 'last-owner refusal left a job/audit side effect: %',
      last_owner_prepare;
  END IF;

  IF issued_result IS DISTINCT FROM (
       SELECT result FROM admin_token_lifecycle_results WHERE label = 'issue_replay'
     ) OR issued_result::text LIKE '%token_hash%'
     OR issued_result::text LIKE '%' || pg_catalog.repeat('1', 64) || '%' THEN
    RAISE EXCEPTION 'issue replay/result exposed credential hash or drifted';
  END IF;

  IF (SELECT pg_catalog.count(*) FROM public.admin_tokens
       WHERE token_hash = pg_catalog.repeat('1', 64)) <> 1 THEN
    RAISE EXCEPTION 'issue replay inserted zero or duplicate token rows';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.id = issued_id
       AND token.admin_id = 'f1900000-0000-4000-8000-000000000005'
       AND token.admin_name = 'Authoritative New Admin'
       AND token.admin_email = 'new-admin@example.test'
       AND token.created_by = 'f1900000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'issued token identity snapshot/created_by is not authoritative';
  END IF;

  IF (SELECT pg_catalog.count(*) FROM public.admin_audit_log AS audit
       WHERE audit.admin_token_id = 'f1900000-0000-4000-8000-000000000011'
         AND audit.idempotency_key = 'f1900000-0000-4000-8000-000000000101'
         AND audit.event_kind = 'token_issued'
         AND audit.actor_id = 'f1900000-0000-4000-8000-000000000001'
         AND audit.target_id = 'f1900000-0000-4000-8000-000000000005'
         AND audit.details ->> 'case_id' = 'CASE-ISSUE-190'
         AND audit.details ->> 'approval_ref' = 'APPROVAL-OWNER-190') <> 1 THEN
    RAISE EXCEPTION 'token_issued actor/case/approval/idempotency audit drifted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.admin_mutation_requests AS request
     WHERE request.idempotency_key IN (
       'f1900000-0000-4000-8000-000000000102'::uuid,
       'f1900000-0000-4000-8000-000000000103'::uuid,
       'f1900000-0000-4000-8000-000000000104'::uuid,
       'f1900000-0000-4000-8000-000000000105'::uuid,
       'f1900000-0000-4000-8000-000000000108'::uuid,
       'f1900000-0000-4000-8000-000000000109'::uuid,
       'f1900000-0000-4000-8000-000000000110'::uuid,
       'f1900000-0000-4000-8000-000000000111'::uuid,
       'f1900000-0000-4000-8000-000000000112'::uuid
     )
  ) THEN
    RAISE EXCEPTION 'denied/inactive/duplicate request left idempotency state';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.admin_id = 'f1900000-0000-4000-8000-000000000004'
       AND token.revoked_at IS NULL
  ) OR (batch_result -> 'data' ->> 'revoked_count')::integer <> 2
     OR batch_result IS DISTINCT FROM (
       SELECT result FROM admin_token_lifecycle_results
        WHERE label = 'batch_revoke_replay'
     ) THEN
    RAISE EXCEPTION 'admin_id batch revoke/replay did not cover cached-email variants';
  END IF;

  IF (SELECT pg_catalog.count(*) FROM public.admin_audit_log AS audit
       WHERE audit.admin_token_id = 'f1900000-0000-4000-8000-000000000013'
         AND audit.idempotency_key IN (
           'f1900000-0000-4000-8000-000000000106'::uuid,
           'f1900000-0000-4000-8000-000000000107'::uuid
         )
         AND audit.event_kind = 'token_revoked') <> 2 THEN
    RAISE EXCEPTION 'exact/batch revocation audit cardinality drifted';
  END IF;

  IF (SELECT result FROM admin_token_lifecycle_results
       WHERE label = 'exact_revoke_first') IS DISTINCT FROM (
       SELECT result FROM admin_token_lifecycle_results
        WHERE label = 'exact_revoke_replay'
     ) THEN
    RAISE EXCEPTION 'exact revoke idempotent replay drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.id = 'f1900000-0000-4000-8000-000000000014'
       AND token.admin_id IS NULL
       AND token.revoked_at IS NOT NULL
       AND token.admin_name = '[detached]'
       AND token.admin_email = 'detached@invalid.local'
  ) OR EXISTS (
    SELECT 1
      FROM public.admin_token_authorization(pg_catalog.repeat('d', 64))
  ) THEN
    RAISE EXCEPTION 'profile deletion did not retain/de-identify/revoke token evidence';
  END IF;

  IF (SELECT pg_catalog.count(*) FROM public.admin_audit_log AS audit
       WHERE audit.event_kind = 'token_revoked'
         AND audit.admin_token_id = 'f1900000-0000-4000-8000-000000000014'
         AND audit.actor_id IS NULL
         AND audit.target_id = 'f1900000-0000-4000-8000-000000000003'
         AND audit.details ->> 'mode' = 'profile_deleted') <> 0 THEN
    RAISE EXCEPTION 'prepared token emitted a duplicate profile-delete revoke audit';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.id = 'f1900000-0000-4000-8000-000000000021'
       AND token.admin_id IS NULL
       AND token.revoked_at IS NOT NULL
       AND token.admin_name = '[detached]'
       AND token.admin_email = 'detached@invalid.local'
  ) OR EXISTS (
    SELECT 1
      FROM public.admin_token_authorization(pg_catalog.repeat('4', 64))
  ) OR (SELECT pg_catalog.count(*) FROM public.admin_audit_log AS audit
        WHERE audit.event_kind = 'token_revoked'
          AND audit.admin_token_id = 'f1900000-0000-4000-8000-000000000021'
          AND audit.actor_id IS NULL
          AND audit.target_id = 'f1900000-0000-4000-8000-000000000007'
          AND audit.details ->> 'mode' = 'profile_deleted'
          AND audit.details ->> 'identity_snapshot' = 'redacted') <> 1 THEN
    RAISE EXCEPTION 'direct profile deletion revoke/redaction/audit missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles AS profile
     WHERE profile.id = 'f1900000-0000-4000-8000-000000000009'
  ) OR NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.id = 'f1900000-0000-4000-8000-000000000022'
       AND token.admin_id IS NULL
       AND token.revoked_at IS NOT NULL
       AND token.admin_name = '[detached]'
       AND token.admin_email = 'detached@invalid.local'
  ) OR EXISTS (
    SELECT 1
      FROM public.admin_banner_uploads AS upload
     WHERE upload.id IN (
       'f1900000-0000-4000-8000-000000000031'::uuid,
       'f1900000-0000-4000-8000-000000000032'::uuid,
       'f1900000-0000-4000-8000-000000000033'::uuid
     )
       AND (
         upload.actor_id IS NOT NULL
         OR upload.admin_token_id <>
            'f1900000-0000-4000-8000-000000000022'::uuid
         OR upload.admin_role <> 'owner'
         OR upload.object_name IS NULL
         OR upload.public_path IS NULL
         OR upload.gc_after IS NULL
       )
  ) OR (SELECT pg_catalog.count(*)
          FROM public.admin_banner_uploads AS upload
         WHERE upload.id IN (
           'f1900000-0000-4000-8000-000000000031'::uuid,
           'f1900000-0000-4000-8000-000000000032'::uuid,
           'f1900000-0000-4000-8000-000000000033'::uuid
         )) <> 3
     OR NOT EXISTS (
       SELECT 1 FROM public.admin_banner_uploads AS upload
        WHERE upload.id = 'f1900000-0000-4000-8000-000000000031'
          AND upload.status = 'prepared'
          AND upload.completed_at IS NULL
          AND upload.banner_id IS NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.admin_banner_uploads AS upload
        WHERE upload.id = 'f1900000-0000-4000-8000-000000000032'
          AND upload.status = 'available'
          AND upload.completed_at IS NOT NULL
          AND upload.banner_id IS NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.admin_banner_uploads AS upload
        WHERE upload.id = 'f1900000-0000-4000-8000-000000000033'
          AND upload.status = 'attached'
          AND upload.completed_at IS NOT NULL
          AND upload.banner_id = 'f1900000-0000-4000-8000-000000000041'
     ) THEN
    RAISE EXCEPTION
      'profile deletion did not retain prepared/available/attached banner saga evidence';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.admin_tokens AS token
     WHERE token.admin_id = 'f1900000-0000-4000-8000-000000000006'
  ) OR (SELECT pg_catalog.count(*) FROM public.account_deletion_jobs AS deletion_job
        WHERE deletion_job.user_id IN (
          'f1900000-0000-4000-8000-000000000003'::uuid,
          'f1900000-0000-4000-8000-000000000006'::uuid,
          'f1900000-0000-4000-8000-000000000008'::uuid,
          'f1900000-0000-4000-8000-000000000010'::uuid
        )) <> 4 THEN
    RAISE EXCEPTION 'deletion tombstone issuance block/job durability drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
     WHERE profile.id = 'f1900000-0000-4000-8000-000000000001'
  ) OR (SELECT pg_catalog.count(*) FROM public.admin_tokens AS token
       WHERE token.admin_id = 'f1900000-0000-4000-8000-000000000001'
         AND token.role = 'owner'
         AND token.revoked_at IS NULL) <> 2 THEN
    RAISE EXCEPTION 'last-owner profile delete did not roll back atomically';
  END IF;

  SELECT function_row.prosrc INTO lifecycle_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = pg_catalog.to_regprocedure(
     'public.admin_execute_token_lifecycle(text,uuid,text,text,jsonb)'
   );
  SELECT function_row.prosrc INTO profile_delete_lock_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = pg_catalog.to_regprocedure(
     'public.admin_lock_profile_deletion_recovery()'
   );
  IF pg_catalog.strpos(lifecycle_source, 'pg_advisory_xact_lock(20260718180000') = 0
     OR pg_catalog.strpos(lifecycle_source, 'pg_advisory_xact_lock(20260718180000')
        > pg_catalog.strpos(lifecycle_source, 'FOR UPDATE') THEN
    RAISE EXCEPTION 'concurrent lifecycle serialization does not precede row observation';
  END IF;
  IF pg_catalog.strpos(
       profile_delete_lock_source,
       'pg_advisory_xact_lock(20260718180000'
     ) = 0
     OR pg_catalog.strpos(
       profile_delete_lock_source,
       'pg_advisory_xact_lock(20260718190000'
     ) = 0
     OR pg_catalog.strpos(
       profile_delete_lock_source,
       'pg_advisory_xact_lock(20260718180000'
     ) > pg_catalog.strpos(
       profile_delete_lock_source,
       'pg_advisory_xact_lock(20260718190000'
     ) THEN
    RAISE EXCEPTION 'profile deletion advisory lock order drifted';
  END IF;
END;
$assertions$;

ROLLBACK;
