-- Isolated/local behavior regression for the last active owner issuer guard.
-- NEVER run against production. This script temporarily revokes every other
-- owner token inside a transaction and always ends with ROLLBACK.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $require_local_superuser$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'regression_refused: run only as local/staging postgres, got %',
      current_user;
  END IF;
END;
$require_local_superuser$;

SELECT pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
SELECT pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
LOCK TABLE public.admin_tokens IN SHARE ROW EXCLUSIVE MODE;

-- Fault-isolate this rollback-only fixture from any owner tokens already in
-- the local database. Disabling triggers here is deliberate test setup; all
-- behavior assertions below run with normal trigger enforcement restored.
SET LOCAL session_replication_role = replica;
DELETE FROM public.admin_tokens AS token
 WHERE token.id IN (
   'f2224504-0000-4000-8000-000000000011'::uuid,
   'f2224504-0000-4000-8000-000000000012'::uuid,
   'f2224504-0000-4000-8000-000000000013'::uuid,
   'f2224504-0000-4000-8000-000000000014'::uuid
 )
    OR token.admin_id IN (
      'f2224504-0000-4000-8000-000000000001'::uuid,
      'f2224504-0000-4000-8000-000000000002'::uuid,
      'f2224504-0000-4000-8000-000000000003'::uuid
    )
    OR token.token_hash IN (
      pg_catalog.repeat('6', 64),
      pg_catalog.repeat('7', 64),
      pg_catalog.repeat('8', 64),
      pg_catalog.repeat('9', 64)
    );
UPDATE public.admin_tokens AS token
   SET revoked_at = COALESCE(token.revoked_at, pg_catalog.clock_timestamp())
 WHERE token.role = 'owner'
   AND token.revoked_at IS NULL;
SET LOCAL session_replication_role = origin;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (
    'f2224504-0000-4000-8000-000000000001',
    'owner-continuity-owner@example.test',
    '{}'::jsonb
  ),
  (
    'f2224504-0000-4000-8000-000000000002',
    'owner-continuity-security@example.test',
    '{}'::jsonb
  ),
  (
    'f2224504-0000-4000-8000-000000000003',
    'owner-continuity-unsafe@example.test',
    '{}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname, email, wechat_openid) VALUES
  (
    'f2224504-0000-4000-8000-000000000001',
    'Owner Continuity Owner',
    'owner-continuity-owner@example.test',
    NULL
  ),
  (
    'f2224504-0000-4000-8000-000000000002',
    'Owner Continuity Security',
    'owner-continuity-security@example.test',
    NULL
  ),
  (
    'f2224504-0000-4000-8000-000000000003',
    U&'Unsafe\202EOwner',
    'owner-continuity-unsafe@example.test',
    NULL
  )
ON CONFLICT (id) DO UPDATE SET
  nickname = EXCLUDED.nickname,
  email = EXCLUDED.email,
  wechat_openid = EXCLUDED.wechat_openid;

INSERT INTO public.admin_tokens (
  id,
  token_hash,
  admin_id,
  admin_name,
  admin_email,
  role,
  expires_at,
  last_used_at,
  revoked_at,
  created_by
) VALUES
  (
    'f2224504-0000-4000-8000-000000000011',
    pg_catalog.repeat('6', 64),
    'f2224504-0000-4000-8000-000000000001',
    'Owner Continuity Owner',
    'owner-continuity-owner@example.test',
    'owner',
    pg_catalog.clock_timestamp() + interval '23 hours',
    pg_catalog.clock_timestamp(),
    NULL,
    'f2224504-0000-4000-8000-000000000001'
  ),
  (
    'f2224504-0000-4000-8000-000000000012',
    pg_catalog.repeat('7', 64),
    'f2224504-0000-4000-8000-000000000002',
    'Owner Continuity Security',
    'owner-continuity-security@example.test',
    'security_admin',
    pg_catalog.clock_timestamp() + interval '30 days',
    pg_catalog.clock_timestamp(),
    NULL,
    'f2224504-0000-4000-8000-000000000001'
  );

DO $fixture_shape$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.id = 'f2224504-0000-4000-8000-000000000011'
       AND token.role = 'owner'
       AND token.revoked_at IS NULL
       AND token.expires_at > pg_catalog.clock_timestamp()
       AND NOT public.admin_owner_token_recoverable(
         token.admin_id,
         token.role,
         token.revoked_at,
         token.expires_at,
         token.last_used_at
       )
  ) OR EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.id <>
           'f2224504-0000-4000-8000-000000000011'::uuid
       AND public.admin_owner_token_recoverable(
         token.admin_id,
         token.role,
         token.revoked_at,
         token.expires_at,
         token.last_used_at
       )
       AND EXISTS (
         SELECT 1
           FROM public.profiles AS profile
          WHERE profile.id = token.admin_id
       )
  ) THEN
    RAISE EXCEPTION
      'regression_fixture_invalid: expected one active owner below 24 hours and no recoverable replacement';
  END IF;
END;
$fixture_shape$;

SET LOCAL ROLE service_role;

DO $short_sole_owner_exact_revoke_refused$
BEGIN
  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('7', 64),
      'f2224504-0000-4000-8000-000000000101',
      pg_catalog.repeat('a', 64),
      'revoke_token',
      pg_catalog.jsonb_build_object(
        'token_id', 'f2224504-0000-4000-8000-000000000011',
        'case_id', 'CASE-SHORT-SOLE-OWNER-EXACT-222',
        'approval_ref', 'APPROVAL-SHORT-SOLE-OWNER-EXACT-222'
      )
    );
    RAISE EXCEPTION 'short sole owner exact revoke was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'last_active_owner_token' THEN
      RAISE;
    END IF;
  END;
END;
$short_sole_owner_exact_revoke_refused$;

DO $short_sole_owner_batch_revoke_refused$
BEGIN
  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('7', 64),
      'f2224504-0000-4000-8000-000000000102',
      pg_catalog.repeat('b', 64),
      'revoke_admin_tokens',
      pg_catalog.jsonb_build_object(
        'admin_id', 'f2224504-0000-4000-8000-000000000001',
        'case_id', 'CASE-SHORT-SOLE-OWNER-BATCH-222',
        'approval_ref', 'APPROVAL-SHORT-SOLE-OWNER-BATCH-222'
      )
    );
    RAISE EXCEPTION 'short sole owner batch revoke was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'last_active_owner_token' THEN
      RAISE;
    END IF;
  END;
END;
$short_sole_owner_batch_revoke_refused$;

RESET ROLE;

DO $short_sole_owner_direct_revoke_refused$
BEGIN
  BEGIN
    UPDATE public.admin_tokens AS token
       SET revoked_at = pg_catalog.clock_timestamp()
     WHERE token.id = 'f2224504-0000-4000-8000-000000000011';
    RAISE EXCEPTION 'short sole owner direct table revoke was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'last_active_owner_token' THEN
      RAISE;
    END IF;
  END;
END;
$short_sole_owner_direct_revoke_refused$;

DO $refusals_are_atomic$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.id = 'f2224504-0000-4000-8000-000000000011'
       AND token.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'owner continuity refusal changed the target token';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.admin_mutation_requests AS request
     WHERE request.idempotency_key IN (
       'f2224504-0000-4000-8000-000000000101'::uuid,
       'f2224504-0000-4000-8000-000000000102'::uuid
     )
  ) OR EXISTS (
    SELECT 1
      FROM public.admin_audit_log AS audit
     WHERE audit.idempotency_key IN (
       'f2224504-0000-4000-8000-000000000101'::uuid,
       'f2224504-0000-4000-8000-000000000102'::uuid
     )
  ) THEN
    RAISE EXCEPTION
      'owner continuity refusal left an idempotency or audit side effect';
  END IF;
END;
$refusals_are_atomic$;

-- Positive control: once a different owner is independently presented and has
-- more than 24 hours remaining, security_admin may revoke the short owner.
INSERT INTO public.admin_tokens (
  id,
  token_hash,
  admin_id,
  admin_name,
  admin_email,
  role,
  expires_at,
  last_used_at,
  revoked_at,
  created_by
) VALUES (
  'f2224504-0000-4000-8000-000000000013',
  pg_catalog.repeat('8', 64),
  'f2224504-0000-4000-8000-000000000001',
  'Owner Continuity Replacement',
  'owner-continuity-owner@example.test',
  'owner',
  pg_catalog.clock_timestamp() + interval '30 days',
  pg_catalog.clock_timestamp(),
  NULL,
  'f2224504-0000-4000-8000-000000000001'
);

SET LOCAL ROLE service_role;

DO $recoverable_replacement_allows_exact_revoke$
DECLARE
  result_value jsonb;
BEGIN
  result_value := public.admin_execute_mutation(
    pg_catalog.repeat('7', 64),
    'f2224504-0000-4000-8000-000000000103',
    pg_catalog.repeat('c', 64),
    'revoke_token',
    pg_catalog.jsonb_build_object(
      'token_id', 'f2224504-0000-4000-8000-000000000011',
      'case_id', 'CASE-RECOVERABLE-OWNER-TRANSFER-222',
      'approval_ref', 'APPROVAL-RECOVERABLE-OWNER-TRANSFER-222'
    )
  );

  IF result_value ->> 'success' <> 'true' THEN
    RAISE EXCEPTION
      'recoverable owner replacement did not allow exact revoke: %',
      result_value;
  END IF;
END;
$recoverable_replacement_allows_exact_revoke$;

RESET ROLE;

DO $positive_control_is_durable_and_audited$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.id = 'f2224504-0000-4000-8000-000000000011'
       AND token.revoked_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.id = 'f2224504-0000-4000-8000-000000000013'
       AND public.admin_owner_token_recoverable(
         token.admin_id,
         token.role,
         token.revoked_at,
         token.expires_at,
         token.last_used_at
       )
  ) THEN
    RAISE EXCEPTION
      'recoverable replacement success did not preserve owner continuity';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM public.admin_mutation_requests AS request
     WHERE request.idempotency_key =
           'f2224504-0000-4000-8000-000000000103'::uuid
       AND request.status = 'completed'
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
      FROM public.admin_audit_log AS audit
     WHERE audit.idempotency_key =
           'f2224504-0000-4000-8000-000000000103'::uuid
       AND audit.event_kind = 'token_revoked'
  ) <> 1 THEN
    RAISE EXCEPTION
      'recoverable replacement success lost its ledger or audit evidence';
  END IF;
END;
$positive_control_is_durable_and_audited$;

-- A profile containing a bidi override is still admissible marketplace data
-- in the historical schema, but it is not a valid administrator credential
-- snapshot. Issuance must now fail atomically at the token table boundary.
SET LOCAL ROLE service_role;

DO $unsafe_identity_issue_refused$
BEGIN
  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('8', 64),
      'f2224504-0000-4000-8000-000000000104',
      pg_catalog.repeat('d', 64),
      'issue_token',
      pg_catalog.jsonb_build_object(
        'token_hash', pg_catalog.repeat('9', 64),
        'admin_id', 'f2224504-0000-4000-8000-000000000003',
        'role', 'owner',
        'expires_at', (
          pg_catalog.clock_timestamp() + interval '30 days'
        )::text,
        'case_id', 'CASE-UNSAFE-OWNER-ISSUE-222',
        'approval_ref', 'APPROVAL-UNSAFE-OWNER-ISSUE-222'
      )
    );
    RAISE EXCEPTION 'unsafe administrator identity was issued a token';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'admin_token_identity_unsafe' THEN
      RAISE;
    END IF;
  END;
END;
$unsafe_identity_issue_refused$;

RESET ROLE;

DO $unsafe_issue_refusal_is_atomic$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.token_hash = pg_catalog.repeat('9', 64)
  ) OR EXISTS (
    SELECT 1
      FROM public.admin_mutation_requests AS request
     WHERE request.idempotency_key =
           'f2224504-0000-4000-8000-000000000104'::uuid
  ) OR EXISTS (
    SELECT 1
      FROM public.admin_audit_log AS audit
     WHERE audit.idempotency_key =
           'f2224504-0000-4000-8000-000000000104'::uuid
  ) THEN
    RAISE EXCEPTION
      'unsafe identity issuance refusal left token/ledger/audit state';
  END IF;
END;
$unsafe_issue_refusal_is_atomic$;

-- Fault-inject the pre-migration state: the old issuance path could cache this
-- profile identity, and the old auth RPC could stamp last_used_at before Edge
-- rejected the returned row. Normal writes cannot create this state now.
SET LOCAL session_replication_role = replica;
INSERT INTO public.admin_tokens (
  id,
  token_hash,
  admin_id,
  admin_name,
  admin_email,
  role,
  expires_at,
  last_used_at,
  revoked_at,
  created_by
) VALUES (
  'f2224504-0000-4000-8000-000000000014',
  pg_catalog.repeat('9', 64),
  'f2224504-0000-4000-8000-000000000003',
  U&'Unsafe\202EOwner',
  'owner-continuity-unsafe@example.test',
  'owner',
  pg_catalog.clock_timestamp() + interval '30 days',
  NULL,
  NULL,
  'f2224504-0000-4000-8000-000000000001'
);
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE service_role;

DO $unsafe_identity_never_authorizes$
DECLARE
  authorization_v1_rows integer;
  authorization_v2_rows integer;
  reconciliation_rows integer;
  inventory_name text;
  inventory_email text;
  inventory_last_used_at timestamptz;
BEGIN
  SELECT pg_catalog.count(*)
    INTO authorization_v1_rows
    FROM public.admin_token_authorization(pg_catalog.repeat('9', 64));
  SELECT pg_catalog.count(*)
    INTO authorization_v2_rows
    FROM public.admin_token_authorization_v2(pg_catalog.repeat('9', 64));
  SELECT pg_catalog.count(*)
    INTO reconciliation_rows
    FROM public.admin_reconcile_issued_token(pg_catalog.repeat('9', 64));
  SELECT inventory.admin_name,
         inventory.admin_email,
         inventory.last_used_at
    INTO inventory_name,
         inventory_email,
         inventory_last_used_at
    FROM public.admin_token_inventory() AS inventory
   WHERE inventory.id = 'f2224504-0000-4000-8000-000000000014';

  IF authorization_v1_rows <> 0
     OR authorization_v2_rows <> 0
     OR reconciliation_rows <> 0 THEN
    RAISE EXCEPTION
      'unsafe administrator identity authorized or reconciled: v1 %, v2 %, reconcile %',
      authorization_v1_rows,
      authorization_v2_rows,
      reconciliation_rows;
  END IF;

  IF inventory_name <> '[unsafe identity]'
     OR inventory_email <> 'unsafe@invalid.local'
     OR inventory_last_used_at IS NOT NULL THEN
    RAISE EXCEPTION
      'unsafe identity inventory was not redacted/unverified: %, %, %',
      inventory_name,
      inventory_email,
      inventory_last_used_at;
  END IF;
END;
$unsafe_identity_never_authorizes$;

RESET ROLE;

DO $unsafe_authorization_left_no_presentation_signal$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.id = 'f2224504-0000-4000-8000-000000000014'
       AND token.last_used_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'unsafe administrator authorization stamped last_used_at';
  END IF;
END;
$unsafe_authorization_left_no_presentation_signal$;

-- Model a last_used_at value already written by the old RPC. Both the explicit
-- row predicate and the compatibility signature must still reject this token
-- as a recovery candidate.
UPDATE public.admin_tokens AS token
   SET last_used_at = pg_catalog.clock_timestamp()
 WHERE token.id = 'f2224504-0000-4000-8000-000000000014';

DO $unsafe_identity_not_recoverable$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.id = 'f2224504-0000-4000-8000-000000000014'
       AND (
         public.admin_owner_token_recoverable(
           token.admin_id,
           token.role,
           token.revoked_at,
           token.expires_at,
           token.last_used_at
         )
         OR public.admin_owner_token_recoverable(
           token.admin_id,
           token.role,
           token.revoked_at,
           token.expires_at,
           token.last_used_at,
           token.admin_name,
           token.admin_email
         )
       )
  ) THEN
    RAISE EXCEPTION
      'unsafe administrator identity counted as a recoverable owner';
  END IF;
END;
$unsafe_identity_not_recoverable$;

-- The only remaining usable owner is token 013. A long-lived, presented but
-- application-rejected owner must not satisfy exact, batch, or direct guards.
SET LOCAL ROLE service_role;

DO $unsafe_owner_exact_replacement_refused$
BEGIN
  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('7', 64),
      'f2224504-0000-4000-8000-000000000105',
      pg_catalog.repeat('e', 64),
      'revoke_token',
      pg_catalog.jsonb_build_object(
        'token_id', 'f2224504-0000-4000-8000-000000000013',
        'case_id', 'CASE-UNSAFE-OWNER-EXACT-222',
        'approval_ref', 'APPROVAL-UNSAFE-OWNER-EXACT-222'
      )
    );
    RAISE EXCEPTION 'unsafe owner replacement allowed exact revoke';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'last_active_owner_token' THEN
      RAISE;
    END IF;
  END;
END;
$unsafe_owner_exact_replacement_refused$;

DO $unsafe_owner_batch_replacement_refused$
BEGIN
  BEGIN
    PERFORM public.admin_execute_mutation(
      pg_catalog.repeat('7', 64),
      'f2224504-0000-4000-8000-000000000106',
      pg_catalog.repeat('f', 64),
      'revoke_admin_tokens',
      pg_catalog.jsonb_build_object(
        'admin_id', 'f2224504-0000-4000-8000-000000000001',
        'case_id', 'CASE-UNSAFE-OWNER-BATCH-222',
        'approval_ref', 'APPROVAL-UNSAFE-OWNER-BATCH-222'
      )
    );
    RAISE EXCEPTION 'unsafe owner replacement allowed batch revoke';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'last_active_owner_token' THEN
      RAISE;
    END IF;
  END;
END;
$unsafe_owner_batch_replacement_refused$;

RESET ROLE;

DO $unsafe_owner_direct_replacement_refused$
BEGIN
  BEGIN
    UPDATE public.admin_tokens AS token
       SET revoked_at = pg_catalog.clock_timestamp()
     WHERE token.id = 'f2224504-0000-4000-8000-000000000013';
    RAISE EXCEPTION 'unsafe owner replacement allowed direct table revoke';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'last_active_owner_token' THEN
      RAISE;
    END IF;
  END;
END;
$unsafe_owner_direct_replacement_refused$;

DO $unsafe_replacement_refusals_are_atomic$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.id = 'f2224504-0000-4000-8000-000000000013'
       AND token.revoked_at IS NULL
  ) OR EXISTS (
    SELECT 1
      FROM public.admin_mutation_requests AS request
     WHERE request.idempotency_key IN (
       'f2224504-0000-4000-8000-000000000105'::uuid,
       'f2224504-0000-4000-8000-000000000106'::uuid
     )
  ) OR EXISTS (
    SELECT 1
      FROM public.admin_audit_log AS audit
     WHERE audit.idempotency_key IN (
       'f2224504-0000-4000-8000-000000000105'::uuid,
       'f2224504-0000-4000-8000-000000000106'::uuid
     )
  ) THEN
    RAISE EXCEPTION
      'unsafe owner replacement refusal changed token/ledger/audit state';
  END IF;
END;
$unsafe_replacement_refusals_are_atomic$;

ROLLBACK;
