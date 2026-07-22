-- Read-only pre-deploy gate for 20260719010000_admin_token_lifecycle_rpc.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  capability_check text;
  mutation_check text;
  audit_check text;
BEGIN
  IF pg_catalog.to_regclass('public.admin_tokens') IS NULL
     OR pg_catalog.to_regclass('public.admin_audit_log') IS NULL
     OR pg_catalog.to_regclass('public.admin_mutation_requests') IS NULL
     OR pg_catalog.to_regclass('public.admin_role_action_capabilities') IS NULL
     OR pg_catalog.to_regclass('public.account_deletion_jobs') IS NULL
     OR pg_catalog.to_regclass('public.admin_banner_uploads') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: administrator token prerequisites missing';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.admin_execute_mutation(text,uuid,text,text,jsonb)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_assert_mutation_capability(uuid,text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_assert_token_revoke_allowed(uuid,uuid)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.record_audit(text,uuid,uuid,jsonb)'
     ) IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: atomic mutation/capability/audit functions missing';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.admin_execute_token_lifecycle(text,uuid,text,text,jsonb)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_execute_mutation_pre_token_lifecycle(text,uuid,text,text,jsonb)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_prepare_account_deletion(uuid)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_lock_profile_deletion_recovery()'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_reconcile_issued_token(text)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_reconcile_idempotency_outcome(text,uuid)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_lock_mutation_idempotency_reconciliation()'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_lock_banner_idempotency_reconciliation()'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_reject_fenced_idempotency_key()'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_prepare_banner_upload_pre_idempotency_fence(text,uuid,text,text,integer)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_complete_banner_upload_pre_idempotency_fence(text,uuid,text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'precheck_failed: partial/previous token lifecycle migration exists';
  END IF;

  IF pg_catalog.to_regclass(
       'public.admin_idempotency_reconciliation_fences'
     ) IS NOT NULL
     OR pg_catalog.to_regclass(
       'public.admin_mutation_requests_idempotency_key_idx'
     ) IS NOT NULL
     OR pg_catalog.to_regclass(
       'public.admin_banner_uploads_idempotency_key_idx'
     ) IS NOT NULL THEN
    RAISE EXCEPTION
      'precheck_failed: partial idempotency reconciliation fence exists';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
    INTO capability_check
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid =
         'public.admin_role_action_capabilities'::pg_catalog.regclass
     AND constraint_row.conname = 'admin_role_action_capabilities_action_check'
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
     OR pg_catalog.strpos(capability_check, 'revoke_token') = 0
     OR pg_catalog.strpos(mutation_check, 'revoke_token') = 0
     OR pg_catalog.strpos(audit_check, 'token_revoked') = 0 THEN
    RAISE EXCEPTION 'precheck_failed: token capability/ledger/audit constraints drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.admin_id IS NULL
        OR token.role NOT IN ('operator', 'security_admin', 'owner')
  ) THEN
    RAISE EXCEPTION 'precheck_failed: unattributed or invalid-role token rows remain';
  END IF;

  -- This migration deliberately converts the banner saga's live actor link
  -- from deletion-blocking evidence to nullable retained evidence. Require the
  -- exact predecessor shape so a drifted/partially patched FK is not silently
  -- replaced without operator review.
  IF NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS column_row
        WHERE column_row.attrelid =
              'public.admin_banner_uploads'::pg_catalog.regclass
          AND column_row.attname = 'actor_id'
          AND column_row.attnotnull
          AND NOT column_row.attisdropped
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid =
              'public.admin_banner_uploads'::pg_catalog.regclass
          AND constraint_row.contype = 'f'
          AND constraint_row.confrelid = 'public.profiles'::pg_catalog.regclass
          AND constraint_row.confdeltype = 'r'
          AND constraint_row.convalidated
          AND constraint_row.conkey = ARRAY[
            (
              SELECT column_row.attnum
                FROM pg_catalog.pg_attribute AS column_row
               WHERE column_row.attrelid =
                     'public.admin_banner_uploads'::pg_catalog.regclass
                 AND column_row.attname = 'actor_id'
                 AND NOT column_row.attisdropped
            )
          ]
     ) THEN
    RAISE EXCEPTION
      'precheck_failed: banner upload actor FK predecessor shape drifted';
  END IF;

  -- A legacy worker may already have deleted Storage/Auth before this atomic
  -- gate exists. Do not silently treat those irreversible, partially advanced
  -- jobs as fresh requests; reconcile them explicitly before deployment.
  IF EXISTS (
    SELECT 1
      FROM public.account_deletion_jobs AS deletion_job
     WHERE deletion_job.stage IN ('storage_deleted', 'auth_deleted')
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: advanced account deletion jobs require reconciliation';
  END IF;
END;
$precheck$;

SELECT
  pg_catalog.count(*) AS token_rows,
  pg_catalog.count(*) FILTER (
    WHERE token.revoked_at IS NULL
      AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
  ) AS active_token_rows,
  pg_catalog.count(DISTINCT token.admin_id) FILTER (
    WHERE token.revoked_at IS NULL
      AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
  ) AS active_admin_ids,
  pg_catalog.count(*) FILTER (
    WHERE token.admin_id IS NOT NULL
      AND token.role = 'owner'
      AND token.revoked_at IS NULL
      AND (
        token.expires_at IS NULL
        OR token.expires_at >=
           pg_catalog.clock_timestamp() + interval '24 hours'
      )
      AND token.last_used_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.profiles AS owner_profile
         WHERE owner_profile.id = token.admin_id
      )
  ) AS verified_recoverable_owner_tokens
FROM public.admin_tokens AS token;

SELECT admin_role, pg_catalog.array_agg(action ORDER BY action) AS actions
FROM public.admin_role_action_capabilities
GROUP BY admin_role
ORDER BY admin_role;

SELECT deletion_job.stage,
       pg_catalog.count(*) AS job_count,
       pg_catalog.min(deletion_job.requested_at) AS oldest_requested_at,
       pg_catalog.min(deletion_job.updated_at) AS oldest_updated_at
FROM public.account_deletion_jobs AS deletion_job
GROUP BY deletion_job.stage
ORDER BY deletion_job.stage;

SELECT upload.status,
       pg_catalog.count(*) AS upload_rows,
       pg_catalog.count(*) FILTER (WHERE upload.actor_id IS NULL)
         AS detached_actor_rows
FROM public.admin_banner_uploads AS upload
GROUP BY upload.status
ORDER BY upload.status;

-- Cross-token and cross-ledger UUID reuse is not silently collapsed. Existing
-- collisions do not prevent deployment, but the new RPC will refuse each one
-- until an operator reconciles the evidence explicitly.
WITH evidence AS (
  SELECT request.idempotency_key, 'mutation'::text AS ledger
    FROM public.admin_mutation_requests AS request
  UNION ALL
  SELECT upload.idempotency_key, 'banner'::text AS ledger
    FROM public.admin_banner_uploads AS upload
), grouped AS (
  SELECT evidence.idempotency_key,
         pg_catalog.count(*) AS evidence_rows,
         pg_catalog.count(DISTINCT evidence.ledger) AS ledger_kinds
    FROM evidence
   GROUP BY evidence.idempotency_key
)
SELECT
  pg_catalog.count(*) FILTER (WHERE grouped.evidence_rows > 1)
    AS colliding_idempotency_keys,
  pg_catalog.count(*) FILTER (WHERE grouped.ledger_kinds > 1)
    AS cross_ledger_collisions
FROM grouped;

-- Current production-shaped readiness census. This is read-only and exposes
-- all four deployment-relevant classes: no-token, safe non-last admin,
-- last-active-admin blocker, and last-active-owner blocker.
WITH active_totals AS (
  SELECT
    pg_catalog.count(*) FILTER (
      WHERE token.admin_id IS NOT NULL
        AND token.revoked_at IS NULL
        AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
        AND EXISTS (
          SELECT 1 FROM public.profiles AS admin_profile
           WHERE admin_profile.id = token.admin_id
        )
    ) AS active_admin_tokens,
    pg_catalog.count(*) FILTER (
      WHERE token.admin_id IS NOT NULL
        AND token.role = 'owner'
        AND token.revoked_at IS NULL
        AND (
          token.expires_at IS NULL
          OR token.expires_at >=
             pg_catalog.clock_timestamp() + interval '24 hours'
        )
        AND token.last_used_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.profiles AS owner_profile
           WHERE owner_profile.id = token.admin_id
        )
    ) AS recoverable_owner_tokens
  FROM public.admin_tokens AS token
), per_profile AS (
  SELECT
    profile.id,
    pg_catalog.count(token.id) AS token_rows,
    pg_catalog.count(token.id) FILTER (
      WHERE token.revoked_at IS NULL
        AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
    ) AS active_tokens,
    pg_catalog.count(token.id) FILTER (
      WHERE token.role = 'owner'
        AND token.revoked_at IS NULL
        AND (
          token.expires_at IS NULL
          OR token.expires_at >=
             pg_catalog.clock_timestamp() + interval '24 hours'
        )
        AND token.last_used_at IS NOT NULL
    ) AS recoverable_owner_tokens
  FROM public.profiles AS profile
  LEFT JOIN public.admin_tokens AS token ON token.admin_id = profile.id
  GROUP BY profile.id
), readiness AS (
  SELECT per_profile.*,
         active_totals.active_admin_tokens - per_profile.active_tokens
           AS remaining_admin_tokens,
         active_totals.recoverable_owner_tokens - per_profile.recoverable_owner_tokens
           AS remaining_owner_tokens
  FROM per_profile
  CROSS JOIN active_totals
)
SELECT
  pg_catalog.count(*) FILTER (WHERE token_rows = 0) AS no_token_profiles,
  pg_catalog.count(*) FILTER (
    WHERE active_tokens > 0
      AND remaining_admin_tokens >= 1
      AND remaining_owner_tokens >= 1
  ) AS safe_non_last_admin_profiles,
  pg_catalog.count(*) FILTER (
    WHERE active_tokens > 0 AND remaining_admin_tokens < 1
  ) AS last_admin_blockers,
  pg_catalog.count(*) FILTER (
    WHERE active_tokens > 0
      AND remaining_admin_tokens >= 1
      AND remaining_owner_tokens < 1
  ) AS last_owner_blockers
FROM readiness;

ROLLBACK;
