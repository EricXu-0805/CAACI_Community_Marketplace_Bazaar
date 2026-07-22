-- Actor-authorized, atomic administrator token lifecycle.
--
-- The historical mint path inserted directly with a service credential, so
-- neither the actor token nor the approval evidence participated in the same
-- transaction as the credential row. Revocation was atomic for one token but
-- had no authoritative admin_id batch operation for departure response.
--
-- This migration preserves the public admin_execute_mutation signature while
-- routing token lifecycle actions through a focused internal implementation:
--   * issue_token accepts only a SHA-256 digest, never plaintext;
--   * target identity snapshots come from profiles, never cached CLI email;
--   * created_by, actor token, case, approval and idempotency are committed
--     with the token_issued audit row;
--   * revoke_token remains API-compatible and token_id-authoritative;
--   * revoke_admin_tokens revokes every non-actor token for one admin_id in a
--     single transaction and writes one bounded summary audit row;
--   * the pre-existing mutation implementation remains private and unchanged
--     for the nine already-reviewed business actions.

BEGIN;

-- Extend the migration-owned capability vocabulary. Token issue is owner-only:
-- approval_ref is evidence, not a cryptographically independent second actor,
-- so a security administrator must not be able to mint a persistent peer
-- credential. Security administrators retain inventory and revocation duties.
ALTER TABLE public.admin_role_action_capabilities
  DROP CONSTRAINT admin_role_action_capabilities_action_check;

ALTER TABLE public.admin_role_action_capabilities
  ADD CONSTRAINT admin_role_action_capabilities_action_check
  CHECK (action IN (
    'apply_ban',
    'lift_suspension',
    'update_report_status',
    'resolve_target_reports',
    'takedown_content',
    'set_post_pinned',
    'upsert_banner',
    'delete_banner',
    'revoke_token',
    'upload_banner',
    'issue_token',
    'revoke_admin_tokens'
  ));

INSERT INTO public.admin_role_action_capabilities (admin_role, action) VALUES
  ('security_admin', 'revoke_admin_tokens'),
  ('owner', 'issue_token'),
  ('owner', 'revoke_admin_tokens')
ON CONFLICT (admin_role, action) DO NOTHING;

-- Reuse the proven per-actor-token idempotency ledger. The lifecycle helper
-- follows the same insert/replay/conflict/completion protocol as the original
-- dispatcher, so a lost Edge response is safely recoverable with the same key.
ALTER TABLE public.admin_mutation_requests
  DROP CONSTRAINT admin_mutation_requests_action_check;

ALTER TABLE public.admin_mutation_requests
  ADD CONSTRAINT admin_mutation_requests_action_check
  CHECK (action IN (
    'apply_ban',
    'lift_suspension',
    'update_report_status',
    'resolve_target_reports',
    'takedown_content',
    'set_post_pinned',
    'upsert_banner',
    'delete_banner',
    'revoke_token',
    'issue_token',
    'revoke_admin_tokens'
  ));

ALTER TABLE public.admin_audit_log
  DROP CONSTRAINT admin_audit_log_event_kind_check;

ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_event_kind_check
  CHECK (event_kind IN (
    'ban_applied',
    'suspension_lifted',
    'report_status_changed',
    'actor_blocked',
    'admin_login',
    'admin_unauthorized',
    'content_takedown',
    'token_revoked',
    'post_pin_changed',
    'banner_changed',
    'token_issued'
  ));

-- A secret/service key may invoke reviewed RPCs, but it no longer has a raw
-- table escape hatch. token_hash is bearer-equivalent credential material,
-- so even SELECT must go through the non-secret authorization/inventory RPCs.
-- Revoke both relation and possible drifted column grants. The SECURITY
-- DEFINER functions retain owner privileges; break-glass database-owner
-- access remains an explicitly external operational control.
REVOKE ALL PRIVILEGES ON TABLE public.admin_tokens FROM service_role;
REVOKE SELECT (
  id, token_hash, admin_id, admin_name, admin_email, created_at, last_used_at,
  revoked_at, created_by, expires_at, role
), INSERT (
  id, token_hash, admin_id, admin_name, admin_email, created_at, last_used_at,
  revoked_at, created_by, expires_at, role
), UPDATE (
  id, token_hash, admin_id, admin_name, admin_email, created_at, last_used_at,
  revoked_at, created_by, expires_at, role
), REFERENCES (
  id, token_hash, admin_id, admin_name, admin_email, created_at, last_used_at,
  revoked_at, created_by, expires_at, role
) ON TABLE public.admin_tokens FROM service_role;

-- Reconcile the owner recovery definition at the final candidate tail as well
-- as in 18190000. This makes an upgrade from an already-applied older tail
-- safe: issuance alone is not proof that the replacement plaintext survived,
-- and a token with less than 24 hours remaining is not durable recovery.
CREATE OR REPLACE FUNCTION public.admin_owner_token_recoverable(
  p_admin_id uuid,
  p_role text,
  p_revoked_at timestamptz,
  p_expires_at timestamptz,
  p_last_used_at timestamptz
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog
AS $function$
  SELECT p_admin_id IS NOT NULL
     AND p_role = 'owner'
     AND p_revoked_at IS NULL
     AND (
       p_expires_at IS NULL
       OR p_expires_at >= pg_catalog.clock_timestamp() + interval '24 hours'
     )
     AND p_last_used_at IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.admin_owner_token_recoverable(
  uuid, text, timestamptz, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_assert_token_revoke_allowed(
  p_actor_token_id uuid,
  p_target_token_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  target_admin_id uuid;
  target_role text;
  target_revoked_at timestamptz;
  target_expires_at timestamptz;
  target_last_used_at timestamptz;
BEGIN
  IF p_actor_token_id IS NULL OR p_target_token_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_token_revoke_context_invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS actor_token
     WHERE actor_token.id = p_actor_token_id
       AND actor_token.admin_id IS NOT NULL
       AND actor_token.revoked_at IS NULL
       AND (
         actor_token.expires_at IS NULL
         OR actor_token.expires_at > pg_catalog.now()
       )
       AND EXISTS (
         SELECT 1
           FROM public.profiles AS actor_profile
          WHERE actor_profile.id = actor_token.admin_id
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_token_revoke_context_invalid';
  END IF;

  SELECT target_token.admin_id,
         target_token.role,
         target_token.revoked_at,
         target_token.expires_at,
         target_token.last_used_at
    INTO target_admin_id,
         target_role,
         target_revoked_at,
         target_expires_at,
         target_last_used_at
    FROM public.admin_tokens AS target_token
   WHERE target_token.id = p_target_token_id
     AND target_token.revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_token_revoke_context_invalid';
  END IF;

  IF public.admin_owner_token_recoverable(
       target_admin_id,
       target_role,
       target_revoked_at,
       target_expires_at,
       target_last_used_at
     )
     AND EXISTS (
       SELECT 1
         FROM public.profiles AS target_profile
        WHERE target_profile.id = target_admin_id
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.admin_tokens AS owner_token
        WHERE owner_token.id <> p_target_token_id
          AND public.admin_owner_token_recoverable(
            owner_token.admin_id,
            owner_token.role,
            owner_token.revoked_at,
            owner_token.expires_at,
            owner_token.last_used_at
          )
          AND EXISTS (
            SELECT 1
              FROM public.profiles AS owner_profile
             WHERE owner_profile.id = owner_token.admin_id
          )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'last_active_owner_token';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_assert_token_revoke_allowed(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_protect_recovery_tokens()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  old_was_active boolean;
  new_is_active boolean := false;
  old_was_recoverable_owner boolean;
  new_is_recoverable_owner boolean := false;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);

  old_was_active := OLD.admin_id IS NOT NULL
    AND OLD.revoked_at IS NULL
    AND (OLD.expires_at IS NULL OR OLD.expires_at > pg_catalog.now());
  old_was_recoverable_owner := public.admin_owner_token_recoverable(
    OLD.admin_id,
    OLD.role,
    OLD.revoked_at,
    OLD.expires_at,
    OLD.last_used_at
  );

  IF TG_OP = 'UPDATE' THEN
    new_is_active := NEW.admin_id IS NOT NULL
      AND NEW.revoked_at IS NULL
      AND (NEW.expires_at IS NULL OR NEW.expires_at > pg_catalog.now());
    new_is_recoverable_owner := public.admin_owner_token_recoverable(
      NEW.admin_id,
      NEW.role,
      NEW.revoked_at,
      NEW.expires_at,
      NEW.last_used_at
    );
  END IF;

  IF old_was_active AND NOT new_is_active AND NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS other_token
     WHERE other_token.id <> OLD.id
       AND other_token.admin_id IS NOT NULL
       AND other_token.revoked_at IS NULL
       AND (
         other_token.expires_at IS NULL
         OR other_token.expires_at > pg_catalog.now()
       )
       AND EXISTS (
         SELECT 1
           FROM public.profiles AS other_profile
          WHERE other_profile.id = other_token.admin_id
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'last_active_admin_token';
  END IF;

  IF old_was_recoverable_owner
     AND NOT new_is_recoverable_owner
     AND NOT EXISTS (
       SELECT 1
         FROM public.admin_tokens AS other_owner
        WHERE other_owner.id <> OLD.id
          AND public.admin_owner_token_recoverable(
            other_owner.admin_id,
            other_owner.role,
            other_owner.revoked_at,
            other_owner.expires_at,
            other_owner.last_used_at
          )
          AND EXISTS (
            SELECT 1
              FROM public.profiles AS owner_profile
             WHERE owner_profile.id = other_owner.admin_id
          )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'last_active_owner_token';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_protect_recovery_tokens()
  FROM PUBLIC, anon, authenticated, service_role;

-- Reconcile the statement-level token lock fence at the final tail too. A row
-- BEFORE trigger is too late to prevent direct privileged UPDATE/DELETE from
-- taking a tuple lock before 190000 and deadlocking an authorization/deletion
-- transaction which correctly took 190000 before that same tuple.
CREATE OR REPLACE FUNCTION public.admin_lock_token_recovery_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_lock_token_recovery_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

-- FK enforcement and the profile-detach trigger make an active token without
-- a profile unreachable in normal writes. Keep authentication fail-closed as
-- well, so even a privileged restore/import that bypassed constraints cannot
-- turn such a corrupted row into an administrator session.
CREATE OR REPLACE FUNCTION public.admin_token_authorization(p_token_hash text)
RETURNS TABLE (
  admin_id uuid,
  admin_name text,
  admin_email text,
  role text,
  capabilities text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  -- A successful presentation is the event that turns an issued owner token
  -- into a proven recovery credential. Serialize that state transition with
  -- lifecycle/account-deletion decisions before touching the token row.
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);

  RETURN QUERY
  WITH matched AS (
    UPDATE public.admin_tokens AS token
       SET last_used_at = pg_catalog.now()
     WHERE token.token_hash = p_token_hash
       AND token.admin_id IS NOT NULL
       AND token.revoked_at IS NULL
       AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
       AND EXISTS (
         SELECT 1
           FROM public.profiles AS profile
          WHERE profile.id = token.admin_id
       )
    RETURNING token.admin_id, token.admin_name, token.admin_email, token.role
  )
  SELECT matched.admin_id,
         matched.admin_name,
         matched.admin_email,
         matched.role,
         ARRAY(
           SELECT capability.action
             FROM public.admin_role_action_capabilities AS capability
            WHERE capability.admin_role = matched.role
            ORDER BY capability.action
         )::text[]
    FROM matched;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_token_authorization(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_token_authorization(text)
  TO service_role;

-- The API may need to reconcile an ambiguous/lost response after it generated
-- and hashed a token. Keep that lookup behind one exact SECURITY DEFINER
-- projection: callers can learn whether the digest committed and obtain only
-- non-secret lifecycle metadata, never the bearer-equivalent digest or cached
-- profile identity fields.
CREATE FUNCTION public.admin_reconcile_issued_token(p_token_hash text)
RETURNS TABLE (
  id uuid,
  admin_id uuid,
  role text,
  expires_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_token_hash_invalid';
  END IF;

  RETURN QUERY
  SELECT token.id,
         token.admin_id,
         token.role,
         token.expires_at,
         token.revoked_at
    FROM public.admin_tokens AS token
   WHERE token.token_hash = p_token_hash
   LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reconcile_issued_token(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_issued_token(text)
  TO service_role;

COMMENT ON FUNCTION public.admin_reconcile_issued_token(text) IS
  'Service-only exact token-digest reconciliation returning non-secret lifecycle metadata; never returns token_hash or cached identity.';

-- A browser can retain a durable idempotency marker after its administrator
-- token was rotated or revoked. Merely observing that neither ledger currently
-- contains the UUID is not authoritative: an older Vercel request may still
-- reach PostgreSQL later. This minimal fence makes a zero-row reconciliation a
-- durable database decision. Every later ledger INSERT is serialized behind
-- the same lock and rejected, so `not_dispatched` is safe to act on rather than
-- a timing guess.
CREATE TABLE public.admin_idempotency_reconciliation_fences (
  idempotency_key uuid PRIMARY KEY,
  reconciled_by uuid NOT NULL
    REFERENCES public.admin_tokens(id) ON DELETE RESTRICT,
  reconciled_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.admin_idempotency_reconciliation_fences
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_idempotency_reconciliation_fences
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.admin_idempotency_reconciliation_fences IS
  'Opaque service-only claims proving an idempotency UUID had no committed admin mutation/upload before its insertion fence.';

-- The ledgers are unique per token, while recovery is intentionally across
-- every historical token and both mutation families. These key-first indexes
-- keep that bounded lookup independent of token count.
CREATE INDEX admin_mutation_requests_idempotency_key_idx
  ON public.admin_mutation_requests (idempotency_key);
CREATE INDEX admin_banner_uploads_idempotency_key_idx
  ON public.admin_banner_uploads (idempotency_key);

-- Ordinary admin mutations already hold 180000. Re-acquiring it here also
-- protects owner/break-glass direct writes and establishes the exact global
-- order before the cross-ledger fence lock.
CREATE FUNCTION public.admin_lock_mutation_idempotency_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718200000::bigint);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_lock_mutation_idempotency_reconciliation()
  FROM PUBLIC, anon, authenticated, service_role;

-- Banner prepare/complete/GC paths may lock their actor token before writing
-- this ledger. They therefore take only the terminal 200000 lock here. The
-- reconciliation RPC never row-locks the current token while holding 200000,
-- which prevents a token-row <-> fence-lock cycle.
CREATE FUNCTION public.admin_lock_banner_idempotency_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718200000::bigint);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_lock_banner_idempotency_reconciliation()
  FROM PUBLIC, anon, authenticated, service_role;

-- The historical upload functions lock admin_tokens before they write the
-- upload ledger. Once the ledger takes 200000, that old order can deadlock a
-- concurrent token revoke which already owns 180000/200000 and is waiting for
-- the same token row. Keep their reviewed implementations private and put the
-- global locks in thin public wrappers before either implementation can touch
-- a token row.
ALTER FUNCTION public.admin_prepare_banner_upload(
  text, uuid, text, text, integer
) RENAME TO admin_prepare_banner_upload_pre_idempotency_fence;

REVOKE ALL ON FUNCTION public.admin_prepare_banner_upload_pre_idempotency_fence(
  text, uuid, text, text, integer
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.admin_prepare_banner_upload(
  p_token_hash text,
  p_idempotency_key uuid,
  p_content_hash text,
  p_mime_type text,
  p_size_bytes integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718200000::bigint);
  RETURN public.admin_prepare_banner_upload_pre_idempotency_fence(
    p_token_hash,
    p_idempotency_key,
    p_content_hash,
    p_mime_type,
    p_size_bytes
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_prepare_banner_upload(
  text, uuid, text, text, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_prepare_banner_upload(
  text, uuid, text, text, integer
) TO service_role;

ALTER FUNCTION public.admin_complete_banner_upload(text, uuid, text)
  RENAME TO admin_complete_banner_upload_pre_idempotency_fence;

REVOKE ALL ON FUNCTION public.admin_complete_banner_upload_pre_idempotency_fence(
  text, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.admin_complete_banner_upload(
  p_token_hash text,
  p_idempotency_key uuid,
  p_content_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718200000::bigint);
  RETURN public.admin_complete_banner_upload_pre_idempotency_fence(
    p_token_hash,
    p_idempotency_key,
    p_content_hash
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_complete_banner_upload(text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_complete_banner_upload(text, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.admin_prepare_banner_upload(
  text, uuid, text, text, integer
) IS
  'Service-only upload prepare entrypoint; acquires lifecycle then reconciliation locks before the historical token-row implementation.';
COMMENT ON FUNCTION public.admin_complete_banner_upload(text, uuid, text) IS
  'Service-only upload completion entrypoint; acquires lifecycle then reconciliation locks before the historical token-row implementation.';

CREATE FUNCTION public.admin_reject_fenced_idempotency_key()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.admin_idempotency_reconciliation_fences AS fence
     WHERE fence.idempotency_key = NEW.idempotency_key
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'admin_idempotency_reconciled';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reject_fenced_idempotency_key()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER admin_mutation_requests_00_lock_idempotency_reconciliation
BEFORE INSERT OR UPDATE OR DELETE
ON public.admin_mutation_requests
FOR EACH STATEMENT
EXECUTE FUNCTION public.admin_lock_mutation_idempotency_reconciliation();

CREATE TRIGGER admin_mutation_requests_01_reject_fenced_idempotency_key
BEFORE INSERT OR UPDATE OF idempotency_key
ON public.admin_mutation_requests
FOR EACH ROW
EXECUTE FUNCTION public.admin_reject_fenced_idempotency_key();

CREATE TRIGGER admin_banner_uploads_00_lock_idempotency_reconciliation
BEFORE INSERT OR UPDATE OR DELETE
ON public.admin_banner_uploads
FOR EACH STATEMENT
EXECUTE FUNCTION public.admin_lock_banner_idempotency_reconciliation();

CREATE TRIGGER admin_banner_uploads_01_reject_fenced_idempotency_key
BEFORE INSERT OR UPDATE OF idempotency_key
ON public.admin_banner_uploads
FOR EACH ROW
EXECUTE FUNCTION public.admin_reject_fenced_idempotency_key();

CREATE FUNCTION public.admin_reconcile_idempotency_outcome(
  p_token_hash text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  owner_token_id uuid;
  evidence_count integer;
  evidence_kind text;
  evidence_status text;
  evidence_result_present boolean;
  evidence_completed_at timestamptz;
  evidence_deleted_at timestamptz;
  fence_exists boolean;
BEGIN
  IF p_token_hash IS NULL
     OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_idempotency_reconcile_invalid';
  END IF;

  -- Token lifecycle mutations take 180000; every mutation/upload ledger write
  -- takes 200000. Holding both makes the evidence snapshot and a possible
  -- zero-row fence one authoritative decision.
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718200000::bigint);

  -- Deliberately take no token row lock or last_used_at write here. Banner upload
  -- code can hold this token row before waiting on 200000; a row lock here
  -- would create a deadlock. The earlier 180000 lifecycle lock already keeps
  -- reviewed revoke/delete paths from changing owner validity during the call.
  SELECT token.id
    INTO owner_token_id
    FROM public.admin_tokens AS token
   WHERE token.token_hash = p_token_hash
     AND token.role = 'owner'
     AND token.admin_id IS NOT NULL
     AND token.revoked_at IS NULL
     AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
     AND EXISTS (
       SELECT 1
         FROM public.profiles AS owner_profile
        WHERE owner_profile.id = token.admin_id
     )
   LIMIT 1;

  IF owner_token_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '28000',
      MESSAGE = 'admin_owner_token_inactive';
  END IF;

  WITH evidence AS (
    SELECT 'mutation'::text AS kind,
           request.status,
           request.result IS NOT NULL AS result_present,
           request.completed_at,
           NULL::timestamptz AS deleted_at
      FROM public.admin_mutation_requests AS request
     WHERE request.idempotency_key = p_idempotency_key
    UNION ALL
    SELECT 'banner'::text AS kind,
           upload.status,
           false AS result_present,
           upload.completed_at,
           upload.deleted_at
      FROM public.admin_banner_uploads AS upload
     WHERE upload.idempotency_key = p_idempotency_key
  )
  SELECT pg_catalog.count(*)::integer,
         pg_catalog.min(evidence.kind),
         pg_catalog.min(evidence.status),
         COALESCE(pg_catalog.bool_or(evidence.result_present), false),
         pg_catalog.min(evidence.completed_at),
         pg_catalog.min(evidence.deleted_at),
         EXISTS (
           SELECT 1
             FROM public.admin_idempotency_reconciliation_fences AS fence
            WHERE fence.idempotency_key = p_idempotency_key
         )
    INTO evidence_count,
         evidence_kind,
         evidence_status,
         evidence_result_present,
         evidence_completed_at,
         evidence_deleted_at,
         fence_exists
    FROM evidence;

  IF evidence_count = 0 THEN
    IF NOT fence_exists THEN
      INSERT INTO public.admin_idempotency_reconciliation_fences (
        idempotency_key,
        reconciled_by
      ) VALUES (
        p_idempotency_key,
        owner_token_id
      );
    END IF;
    RETURN pg_catalog.jsonb_build_object('status', 'not_dispatched');
  END IF;

  IF fence_exists THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'admin_idempotency_reconcile_fence_conflict';
  END IF;

  IF evidence_count > 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'admin_idempotency_reconcile_collision';
  END IF;

  IF evidence_kind = 'mutation' THEN
    IF evidence_status = 'completed'
       AND evidence_result_present
       AND evidence_completed_at IS NOT NULL
       AND evidence_deleted_at IS NULL THEN
      RETURN pg_catalog.jsonb_build_object('status', 'completed');
    END IF;
    IF evidence_status = 'running'
       AND NOT evidence_result_present
       AND evidence_completed_at IS NULL
       AND evidence_deleted_at IS NULL THEN
      RETURN pg_catalog.jsonb_build_object('status', 'running');
    END IF;
  ELSIF evidence_kind = 'banner' THEN
    IF evidence_status = 'deleted' AND evidence_deleted_at IS NOT NULL THEN
      RETURN pg_catalog.jsonb_build_object('status', 'completed');
    END IF;
    IF evidence_status IN ('available', 'attached', 'gc_pending')
       AND evidence_completed_at IS NOT NULL
       AND evidence_deleted_at IS NULL THEN
      RETURN pg_catalog.jsonb_build_object('status', 'completed');
    END IF;
    IF evidence_status IN ('prepared', 'gc_pending')
       AND evidence_completed_at IS NULL
       AND evidence_deleted_at IS NULL THEN
      RETURN pg_catalog.jsonb_build_object('status', 'running');
    END IF;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'admin_idempotency_reconcile_uncertain';
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reconcile_idempotency_outcome(text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_idempotency_outcome(text, uuid)
  TO service_role;

COMMENT ON FUNCTION public.admin_reconcile_idempotency_outcome(text, uuid) IS
  'Owner-authorized opaque cross-token/cross-ledger reconciliation. Zero evidence is atomically fenced and returned as not_dispatched; collisions and inconsistent states fail closed.';

-- New deletion tombstones must be created only by the atomic preparation RPC
-- below. The worker keeps SELECT/UPDATE for monotonic saga checkpoints, but a
-- raw service-role INSERT can no longer bypass recovery readiness/revocation.
REVOKE INSERT ON TABLE public.account_deletion_jobs FROM service_role;

-- Migration 20260718280000 resets every app-table column ACL. Its original
-- profile grant restored UPDATE but accidentally omitted the minimal INSERT
-- recovery path established by 20260717092804. Reconcile it again here so an
-- upgrade from that already-applied tail migration is safe as well as a fresh
-- replay. Clear column ACL drift first; table-level INSERT remains denied.
DO $reconcile_profile_recovery_insert_acl$
DECLARE
  profile_columns text;
BEGIN
  SELECT pg_catalog.string_agg(
           pg_catalog.quote_ident(column_row.attname),
           ',' ORDER BY column_row.attnum
         )
    INTO STRICT profile_columns
    FROM pg_catalog.pg_attribute AS column_row
   WHERE column_row.attrelid = 'public.profiles'::pg_catalog.regclass
     AND column_row.attnum > 0
     AND NOT column_row.attisdropped;

  EXECUTE pg_catalog.format(
    'REVOKE INSERT (%s) ON TABLE public.profiles FROM PUBLIC, anon, authenticated',
    profile_columns
  );
END;
$reconcile_profile_recovery_insert_acl$;

GRANT INSERT (id, nickname, avatar_url, bio, location, status_text, status_emoji)
  ON TABLE public.profiles TO authenticated;

-- Banner upload rows are the durable storage saga/GC ledger. Deleting the
-- administrator profile must not erase or block those rows: the token,
-- idempotency key, object path, status and banner reference remain sufficient
-- for retry/cleanup, while the live profile reference is detached.
DO $replace_banner_upload_actor_fk$
DECLARE
  actor_fk record;
BEGIN
  FOR actor_fk IN
    SELECT constraint_row.conname
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid =
           'public.admin_banner_uploads'::pg_catalog.regclass
       AND constraint_row.contype = 'f'
       AND constraint_row.confrelid = 'public.profiles'::pg_catalog.regclass
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
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.admin_banner_uploads DROP CONSTRAINT %I',
      actor_fk.conname
    );
  END LOOP;
END;
$replace_banner_upload_actor_fk$;

ALTER TABLE public.admin_banner_uploads
  ALTER COLUMN actor_id DROP NOT NULL,
  ADD CONSTRAINT admin_banner_uploads_actor_id_profiles_fkey_v2
    FOREIGN KEY (actor_id)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL;

COMMENT ON COLUMN public.admin_banner_uploads.actor_id IS
  'Authoritative profiles.id while the administrator profile exists; NULL after deletion while the immutable upload saga and GC evidence remains.';

-- A profile DELETE can otherwise acquire child-row locks through FK actions
-- before admin_tokens_protect_recovery takes the recovery advisory lock. The
-- account-deletion preparation path takes the advisory locks first and then
-- token rows, so that reverse order can deadlock. A BEFORE STATEMENT trigger
-- runs before profile or child rows are touched and establishes one global
-- order for direct deletes, auth-user cascades, and prepared deletion:
-- lifecycle (180000) -> recovery (190000) -> profile/FK child rows.
CREATE FUNCTION public.admin_lock_profile_deletion_recovery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_lock_profile_deletion_recovery()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER profiles_00_lock_admin_recovery_before_delete
BEFORE DELETE
ON public.profiles
FOR EACH STATEMENT
EXECUTE FUNCTION public.admin_lock_profile_deletion_recovery();

-- Preserve token inventory and revocation evidence when a profile is deleted.
-- The historical ON DELETE CASCADE silently erased the credential row. A
-- detached row is now retained, made unusable, de-identified, and audited in
-- the same transaction as the profile deletion. All authentication/mutation
-- entrypoints already reject a NULL admin_id.
DO $replace_admin_actor_fk$
DECLARE
  actor_fk record;
BEGIN
  FOR actor_fk IN
    SELECT constraint_row.conname
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = 'public.admin_tokens'::pg_catalog.regclass
       AND constraint_row.contype = 'f'
       AND constraint_row.confrelid = 'public.profiles'::pg_catalog.regclass
       AND constraint_row.conkey = ARRAY[
         (
           SELECT column_row.attnum
             FROM pg_catalog.pg_attribute AS column_row
            WHERE column_row.attrelid =
                  'public.admin_tokens'::pg_catalog.regclass
              AND column_row.attname = 'admin_id'
              AND NOT column_row.attisdropped
         )
       ]
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.admin_tokens DROP CONSTRAINT %I',
      actor_fk.conname
    );
  END LOOP;
END;
$replace_admin_actor_fk$;

ALTER TABLE public.admin_tokens
  ALTER COLUMN admin_id DROP NOT NULL,
  ADD CONSTRAINT admin_tokens_admin_id_profiles_fkey_v3
    FOREIGN KEY (admin_id)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT admin_tokens_detached_revoked_check
    CHECK (admin_id IS NOT NULL OR revoked_at IS NOT NULL);

COMMENT ON COLUMN public.admin_tokens.admin_id IS
  'Authoritative profiles.id while attached; NULL only on an atomically revoked, de-identified evidence row after profile deletion.';

CREATE FUNCTION public.admin_detach_profile_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF OLD.admin_id IS NOT NULL AND NEW.admin_id IS NULL THEN
    NEW.revoked_at := COALESCE(NEW.revoked_at, pg_catalog.now());
    NEW.admin_name := '[detached]';
    NEW.admin_email := 'detached@invalid.local';

    -- Do not emit a second token_revoked event when atomic account-deletion
    -- preparation already revoked and audited this credential. An unrevoked
    -- row (including an expired credential) is revoked here and gets its one
    -- required profile-deletion audit; failure aborts the parent deletion.
    IF OLD.revoked_at IS NULL THEN
      INSERT INTO public.admin_audit_log (
        event_kind,
        actor_id,
        target_id,
        details,
        admin_token_id,
        idempotency_key
      ) VALUES (
        'token_revoked',
        NULL,
        OLD.admin_id,
        pg_catalog.jsonb_build_object(
          'mode', 'profile_deleted',
          'token_id', OLD.id,
          'admin_id', OLD.admin_id,
          'reason', 'actor_profile_detached',
          'identity_snapshot', 'redacted'
        ),
        OLD.id,
        NULL
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_detach_profile_token()
  FROM PUBLIC, anon, authenticated, service_role;

-- PostgreSQL runs same-event triggers in name order. This trigger therefore
-- deactivates the row before admin_tokens_protect_recovery evaluates whether
-- the profile deletion would remove the last active admin/owner credential.
CREATE TRIGGER admin_tokens_00_detach_profile
BEFORE UPDATE OF admin_id
ON public.admin_tokens
FOR EACH ROW
EXECUTE FUNCTION public.admin_detach_profile_token();

DROP TRIGGER admin_tokens_protect_recovery ON public.admin_tokens;
CREATE TRIGGER admin_tokens_protect_recovery
BEFORE UPDATE OF admin_id, revoked_at, expires_at, role OR DELETE
ON public.admin_tokens
FOR EACH ROW
EXECUTE FUNCTION public.admin_protect_recovery_tokens();

DROP TRIGGER IF EXISTS admin_tokens_00_lock_recovery_mutation
ON public.admin_tokens;
CREATE TRIGGER admin_tokens_00_lock_recovery_mutation
BEFORE UPDATE OR DELETE
ON public.admin_tokens
FOR EACH STATEMENT
EXECUTE FUNCTION public.admin_lock_token_recovery_mutation();

-- Prepare irreversible external account deletion in one durable transaction.
-- The lock order is shared with the admin mutation dispatcher (180000) and
-- table recovery guard (190000). Taking both before any token observation or
-- row lock prevents token issue/revoke from invalidating the readiness result.
-- A durable job is inserted before this function returns, and every unrevoked
-- token for the account is revoked with required system audit evidence in the
-- same transaction. Replays reuse the existing job and do not duplicate audit.
CREATE FUNCTION public.admin_prepare_account_deletion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  job_row public.account_deletion_jobs%ROWTYPE;
  profile_wechat_openid text;
  profile_exists boolean;
  target_active_token_count bigint;
  remaining_active_admin_token_count bigint;
  remaining_recoverable_owner_token_count bigint;
  revoked_token_count bigint;
  revoked_token_ids jsonb;
  revoked_token_ids_truncated boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_account_deletion_invalid';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);

  -- Lock all target rows only after both advisory locks. This preserves the
  -- global order used by lifecycle/recovery mutations and makes the following
  -- readiness counts and revoke set one coherent transaction view.
  PERFORM token.id
    FROM public.admin_tokens AS token
   WHERE token.admin_id = p_user_id
     AND token.revoked_at IS NULL
   ORDER BY token.id
   FOR UPDATE;

  SELECT
    pg_catalog.count(*) FILTER (
      WHERE token.admin_id = p_user_id
        AND token.revoked_at IS NULL
        AND (
          token.expires_at IS NULL
          OR token.expires_at > pg_catalog.now()
        )
    ),
    pg_catalog.count(*) FILTER (
      WHERE token.admin_id IS DISTINCT FROM p_user_id
        AND token.admin_id IS NOT NULL
        AND token.revoked_at IS NULL
        AND (
          token.expires_at IS NULL
          OR token.expires_at > pg_catalog.now()
        )
        AND EXISTS (
          SELECT 1
            FROM public.profiles AS admin_profile
           WHERE admin_profile.id = token.admin_id
        )
    ),
    pg_catalog.count(*) FILTER (
      WHERE token.admin_id IS DISTINCT FROM p_user_id
        AND public.admin_owner_token_recoverable(
          token.admin_id,
          token.role,
          token.revoked_at,
          token.expires_at,
          token.last_used_at
        )
        AND EXISTS (
          SELECT 1
            FROM public.profiles AS owner_profile
           WHERE owner_profile.id = token.admin_id
        )
    )
    INTO target_active_token_count,
         remaining_active_admin_token_count,
         remaining_recoverable_owner_token_count
    FROM public.admin_tokens AS token;

  -- Auth creation can legitimately leave an auth.users row without its
  -- public profile because the historical handle_new_user trigger swallowed
  -- profile-insert errors. Snapshot the optional profile while the same
  -- advisory locks also exclude a concurrent profile deletion. A still-active
  -- token attached to a missing profile violates the credential FK invariant;
  -- fail closed even if a privileged/manual write ever bypassed that FK.
  SELECT profile.wechat_openid
    INTO profile_wechat_openid
    FROM public.profiles AS profile
   WHERE profile.id = p_user_id;
  profile_exists := FOUND;

  IF NOT profile_exists AND target_active_token_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'admin_active_token_profile_missing';
  END IF;

  -- A profile with no active admin token cannot weaken the recovery set.
  -- Otherwise removing the account must leave both an active administrator
  -- credential and a verified/recoverable owner credential on another live
  -- profile. Merely issuing a token does not prove that its plaintext survived.
  IF target_active_token_count > 0
     AND (
       remaining_active_admin_token_count < 1
       OR remaining_recoverable_owner_token_count < 1
     ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'ready', false,
      'reason', 'admin_recovery_transfer_required',
      'job', NULL
    );
  END IF;

  SELECT deletion_job.*
    INTO job_row
    FROM public.account_deletion_jobs AS deletion_job
   WHERE deletion_job.user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    -- A missing profile is recoverable only for a real Auth identity. The
    -- durable job deliberately has no FK so it survives Auth deletion, but
    -- its first creation must never mint a tombstone for an arbitrary UUID.
    IF NOT profile_exists THEN
      PERFORM auth_user.id
        FROM auth.users AS auth_user
       WHERE auth_user.id = p_user_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING
          ERRCODE = 'P0002',
          MESSAGE = 'account_auth_user_not_found';
      END IF;
    END IF;

    INSERT INTO public.account_deletion_jobs (
      user_id,
      stage,
      wechat_openid
    ) VALUES (
      p_user_id,
      'requested',
      profile_wechat_openid
    )
    RETURNING * INTO job_row;
  END IF;

  WITH revoked AS (
    UPDATE public.admin_tokens AS token
       SET revoked_at = pg_catalog.now()
     WHERE token.admin_id = p_user_id
       AND token.revoked_at IS NULL
    RETURNING token.id
  ), revoked_summary AS (
    SELECT pg_catalog.count(*) AS revoked_count FROM revoked
  ), revoked_sample AS (
    SELECT COALESCE(
             pg_catalog.jsonb_agg(sample.id ORDER BY sample.id),
             '[]'::jsonb
           ) AS token_ids
      FROM (
        SELECT revoked.id FROM revoked ORDER BY revoked.id LIMIT 100
      ) AS sample
  )
  SELECT revoked_summary.revoked_count,
         revoked_sample.token_ids,
         revoked_summary.revoked_count > 100
    INTO revoked_token_count,
         revoked_token_ids,
         revoked_token_ids_truncated
    FROM revoked_summary
    CROSS JOIN revoked_sample;

  IF revoked_token_count > 0 THEN
    -- Direct required insert: any audit failure rolls back both the durable
    -- tombstone and token revocation. actor_id NULL marks a system boundary,
    -- while target_id and bounded UUID evidence preserve attribution.
    INSERT INTO public.admin_audit_log (
      event_kind,
      actor_id,
      target_id,
      details,
      admin_token_id,
      idempotency_key
    ) VALUES (
      'token_revoked',
      NULL,
      p_user_id,
      pg_catalog.jsonb_build_object(
        'mode', 'account_deletion_prepared',
        'admin_id', p_user_id,
        'token_ids', revoked_token_ids,
        'token_ids_truncated', revoked_token_ids_truncated,
        'revoked_count', revoked_token_count,
        'via', 'admin_prepare_account_deletion'
      ),
      NULL,
      NULL
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ready', true,
    'reason', NULL,
    'job', pg_catalog.to_jsonb(job_row)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_prepare_account_deletion(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_prepare_account_deletion(uuid)
  TO service_role;

-- Preserve the already-reviewed implementation under an internal-only name.
-- The new public wrapper below delegates every non-lifecycle action to it.
ALTER FUNCTION public.admin_execute_mutation(text, uuid, text, text, jsonb)
  RENAME TO admin_execute_mutation_pre_token_lifecycle;

REVOKE ALL ON FUNCTION public.admin_execute_mutation_pre_token_lifecycle(
  text, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.admin_lifecycle_evidence_valid(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT p_value IS NOT NULL
     AND pg_catalog.length(pg_catalog.btrim(p_value)) > 0
     AND pg_catalog.length(p_value) <= 200
     AND p_value !~ '[[:cntrl:]]'
     AND pg_catalog.strpos(p_value, U&'\202A') = 0
     AND pg_catalog.strpos(p_value, U&'\202B') = 0
     AND pg_catalog.strpos(p_value, U&'\202C') = 0
     AND pg_catalog.strpos(p_value, U&'\202D') = 0
     AND pg_catalog.strpos(p_value, U&'\202E') = 0
     AND pg_catalog.strpos(p_value, U&'\2066') = 0
     AND pg_catalog.strpos(p_value, U&'\2067') = 0
     AND pg_catalog.strpos(p_value, U&'\2068') = 0
     AND pg_catalog.strpos(p_value, U&'\2069') = 0;
$function$;

REVOKE ALL ON FUNCTION public.admin_lifecycle_evidence_valid(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.admin_execute_token_lifecycle(
  p_token_hash text,
  p_idempotency_key uuid,
  p_payload_hash text,
  p_action text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  uuid_pattern constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  actor_token_id uuid;
  actor_id_value uuid;
  actor_role_value text;
  inserted_rows integer;
  existing_action text;
  existing_payload_hash text;
  existing_status text;
  existing_result jsonb;
  result_value jsonb;
  affected_rows integer;
  target_token_id uuid;
  target_admin_id uuid;
  target_role text;
  target_expires_at timestamptz;
  target_admin_name text;
  target_admin_email text;
  case_id_value text;
  approval_ref_value text;
  token_hash_value text;
  target_token_ids uuid[];
  payload_key text;
BEGIN
  -- This is intentionally the same lock as the original dispatcher. Token
  -- issue/revoke therefore has a deterministic order with every admin write,
  -- and duplicate/concurrent revocations cannot both observe an active row.
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);

  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING
      ERRCODE = '28000',
      MESSAGE = 'admin_token_inactive';
  END IF;

  SELECT token.id, token.admin_id, token.role
    INTO actor_token_id, actor_id_value, actor_role_value
    FROM public.admin_tokens AS token
   WHERE token.token_hash = p_token_hash
     AND token.admin_id IS NOT NULL
     AND token.revoked_at IS NULL
     AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
     AND EXISTS (
       SELECT 1
         FROM public.profiles AS actor_profile
        WHERE actor_profile.id = token.admin_id
     )
   FOR UPDATE;

  IF actor_token_id IS NULL OR actor_id_value IS NULL
     OR actor_role_value NOT IN ('operator', 'security_admin', 'owner') THEN
    RAISE EXCEPTION USING
      ERRCODE = '28000',
      MESSAGE = 'admin_token_inactive';
  END IF;

  UPDATE public.admin_tokens AS token
     SET last_used_at = pg_catalog.now()
   WHERE token.id = actor_token_id;

  IF p_idempotency_key IS NULL
     OR p_payload_hash IS NULL
     OR p_payload_hash !~ '^[0-9a-f]{64}$'
     OR p_action NOT IN ('issue_token', 'revoke_token', 'revoke_admin_tokens')
     OR pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_mutation_invalid';
  END IF;

  PERFORM public.admin_assert_mutation_capability(actor_token_id, p_action);

  INSERT INTO public.admin_mutation_requests (
    admin_token_id,
    idempotency_key,
    actor_id,
    action,
    payload_hash
  ) VALUES (
    actor_token_id,
    p_idempotency_key,
    actor_id_value,
    p_action,
    p_payload_hash
  )
  ON CONFLICT (admin_token_id, idempotency_key) DO NOTHING;
  GET DIAGNOSTICS inserted_rows = ROW_COUNT;

  IF inserted_rows = 0 THEN
    SELECT request.action,
           request.payload_hash,
           request.status,
           request.result
      INTO existing_action,
           existing_payload_hash,
           existing_status,
           existing_result
      FROM public.admin_mutation_requests AS request
     WHERE request.admin_token_id = actor_token_id
       AND request.idempotency_key = p_idempotency_key
     FOR UPDATE;

    IF existing_action IS DISTINCT FROM p_action
       OR existing_payload_hash IS DISTINCT FROM p_payload_hash THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'idempotency_conflict';
    END IF;

    IF existing_status = 'completed' AND existing_result IS NOT NULL THEN
      RETURN existing_result;
    END IF;

    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'idempotency_incomplete';
  END IF;

  PERFORM pg_catalog.set_config('admin.actor_id', actor_id_value::text, true);
  PERFORM pg_catalog.set_config('admin.token_id', actor_token_id::text, true);
  PERFORM pg_catalog.set_config(
    'admin.idempotency_key', p_idempotency_key::text, true
  );
  PERFORM pg_catalog.set_config('admin.role', actor_role_value, true);
  PERFORM pg_catalog.set_config('admin.audit_required', 'on', true);

  IF p_action = 'issue_token' THEN
    FOR payload_key IN SELECT pg_catalog.jsonb_object_keys(p_payload) LOOP
      IF payload_key NOT IN (
        'token_hash', 'admin_id', 'role', 'expires_at', 'case_id', 'approval_ref'
      ) THEN
        RAISE EXCEPTION USING
          ERRCODE = '22023',
          MESSAGE = 'admin_mutation_invalid_payload';
      END IF;
    END LOOP;

    token_hash_value := p_payload ->> 'token_hash';
    IF pg_catalog.jsonb_typeof(p_payload -> 'token_hash') IS DISTINCT FROM 'string'
       OR token_hash_value !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;

    IF pg_catalog.jsonb_typeof(p_payload -> 'admin_id') IS DISTINCT FROM 'string'
       OR (p_payload ->> 'admin_id') !~* uuid_pattern THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    target_admin_id := pg_catalog.lower(p_payload ->> 'admin_id')::uuid;

    target_role := p_payload ->> 'role';
    IF pg_catalog.jsonb_typeof(p_payload -> 'role') IS DISTINCT FROM 'string'
       OR target_role NOT IN ('operator', 'security_admin', 'owner') THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    IF actor_role_value <> 'owner' THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'admin_capability_denied';
    END IF;

    IF pg_catalog.jsonb_typeof(p_payload -> 'expires_at') IS DISTINCT FROM 'string'
       OR pg_catalog.length(p_payload ->> 'expires_at') > 64 THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    BEGIN
      target_expires_at := (p_payload ->> 'expires_at')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END;
    IF target_expires_at <= pg_catalog.now()
       OR target_expires_at > pg_catalog.now() + interval '365 days' THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    IF target_role = 'owner'
       AND target_expires_at
           < pg_catalog.clock_timestamp() + interval '24 hours' THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;

    case_id_value := p_payload ->> 'case_id';
    approval_ref_value := p_payload ->> 'approval_ref';
    IF pg_catalog.jsonb_typeof(p_payload -> 'case_id') IS DISTINCT FROM 'string'
       OR NOT public.admin_lifecycle_evidence_valid(case_id_value)
       OR pg_catalog.jsonb_typeof(p_payload -> 'approval_ref') IS DISTINCT FROM 'string'
       OR NOT public.admin_lifecycle_evidence_valid(approval_ref_value) THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;

    SELECT NULLIF(pg_catalog.btrim(profile.nickname), ''),
           NULLIF(pg_catalog.btrim(profile.email), '')
      INTO target_admin_name, target_admin_email
      FROM public.profiles AS profile
     WHERE profile.id = target_admin_id
     FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = 'admin_profile_not_found';
    END IF;
    IF target_admin_name IS NULL
       OR pg_catalog.length(target_admin_name) > 100
       OR target_admin_email IS NULL
       OR pg_catalog.length(target_admin_email) < 3
       OR pg_catalog.length(target_admin_email) > 200
       OR pg_catalog.strpos(target_admin_email, '@') = 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_profile_identity_incomplete';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM public.account_deletion_jobs AS deletion_job
       WHERE deletion_job.user_id = target_admin_id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'admin_account_deletion_in_progress';
    END IF;

    BEGIN
      INSERT INTO public.admin_tokens (
        token_hash,
        admin_id,
        admin_name,
        admin_email,
        role,
        expires_at,
        created_by
      ) VALUES (
        token_hash_value,
        target_admin_id,
        target_admin_name,
        target_admin_email,
        target_role,
        target_expires_at,
        actor_id_value
      )
      RETURNING id INTO target_token_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'admin_token_hash_conflict';
    END;

    PERFORM public.record_audit(
      'token_issued',
      actor_id_value,
      target_admin_id,
      pg_catalog.jsonb_build_object(
        'token_id', target_token_id,
        'admin_id', target_admin_id,
        'role', target_role,
        'expires_at', target_expires_at,
        'created_by', actor_id_value,
        'case_id', case_id_value,
        'approval_ref', approval_ref_value,
        'identity_source', 'profiles'
      )
    );
    result_value := pg_catalog.jsonb_build_object(
      'data', pg_catalog.jsonb_build_object(
        'token_id', target_token_id,
        'admin_id', target_admin_id,
        'role', target_role,
        'expires_at', target_expires_at
      )
    );

  ELSIF p_action = 'revoke_token' THEN
    FOR payload_key IN SELECT pg_catalog.jsonb_object_keys(p_payload) LOOP
      IF payload_key NOT IN ('token_id', 'case_id', 'approval_ref') THEN
        RAISE EXCEPTION USING
          ERRCODE = '22023',
          MESSAGE = 'admin_mutation_invalid_payload';
      END IF;
    END LOOP;

    IF pg_catalog.jsonb_typeof(p_payload -> 'token_id') IS DISTINCT FROM 'string'
       OR (p_payload ->> 'token_id') !~* uuid_pattern THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    target_token_id := pg_catalog.lower(p_payload ->> 'token_id')::uuid;

    case_id_value := p_payload ->> 'case_id';
    approval_ref_value := p_payload ->> 'approval_ref';
    IF pg_catalog.jsonb_typeof(p_payload -> 'case_id') IS DISTINCT FROM 'string'
       OR NOT public.admin_lifecycle_evidence_valid(case_id_value)
       OR pg_catalog.jsonb_typeof(p_payload -> 'approval_ref') IS DISTINCT FROM 'string'
       OR NOT public.admin_lifecycle_evidence_valid(approval_ref_value) THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;

    SELECT token.admin_id, token.expires_at
      INTO target_admin_id, target_expires_at
      FROM public.admin_tokens AS token
     WHERE token.id = target_token_id
       AND token.revoked_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = 'token_not_active';
    END IF;

    -- Preserve the established deterministic sentinel order: loss of the last
    -- active recovery credential wins over the self-revoke sentinel.
    IF (target_expires_at IS NULL OR target_expires_at > pg_catalog.now())
       AND (
         SELECT pg_catalog.count(*)
           FROM public.admin_tokens AS active_token
          WHERE active_token.revoked_at IS NULL
            AND (
              active_token.expires_at IS NULL
              OR active_token.expires_at > pg_catalog.now()
            )
       ) <= 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'last_active_admin_token';
    END IF;

    IF target_token_id = actor_token_id THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'self_revoke_forbidden';
    END IF;

    PERFORM public.admin_assert_token_revoke_allowed(
      actor_token_id,
      target_token_id
    );

    UPDATE public.admin_tokens AS token
       SET revoked_at = pg_catalog.now()
     WHERE token.id = target_token_id
       AND token.revoked_at IS NULL;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = 'token_not_active';
    END IF;

    PERFORM public.record_audit(
      'token_revoked',
      actor_id_value,
      target_admin_id,
      pg_catalog.jsonb_build_object(
        'mode', 'token_id',
        'token_id', target_token_id,
        'admin_id', target_admin_id,
        'case_id', case_id_value,
        'approval_ref', approval_ref_value
      )
    );
    result_value := pg_catalog.jsonb_build_object('success', true);

  ELSE
    FOR payload_key IN SELECT pg_catalog.jsonb_object_keys(p_payload) LOOP
      IF payload_key NOT IN ('admin_id', 'case_id', 'approval_ref') THEN
        RAISE EXCEPTION USING
          ERRCODE = '22023',
          MESSAGE = 'admin_mutation_invalid_payload';
      END IF;
    END LOOP;

    IF pg_catalog.jsonb_typeof(p_payload -> 'admin_id') IS DISTINCT FROM 'string'
       OR (p_payload ->> 'admin_id') !~* uuid_pattern THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    target_admin_id := pg_catalog.lower(p_payload ->> 'admin_id')::uuid;

    case_id_value := p_payload ->> 'case_id';
    approval_ref_value := p_payload ->> 'approval_ref';
    IF pg_catalog.jsonb_typeof(p_payload -> 'case_id') IS DISTINCT FROM 'string'
       OR NOT public.admin_lifecycle_evidence_valid(case_id_value)
       OR pg_catalog.jsonb_typeof(p_payload -> 'approval_ref') IS DISTINCT FROM 'string'
       OR NOT public.admin_lifecycle_evidence_valid(approval_ref_value) THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;

    SELECT pg_catalog.array_agg(locked_token.id ORDER BY locked_token.id)
      INTO target_token_ids
      FROM (
        SELECT token.id
          FROM public.admin_tokens AS token
         WHERE token.admin_id = target_admin_id
           AND token.id <> actor_token_id
           AND token.revoked_at IS NULL
         ORDER BY token.id
         FOR UPDATE
      ) AS locked_token;

    IF COALESCE(pg_catalog.cardinality(target_token_ids), 0) = 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = 'token_not_active';
    END IF;
    IF pg_catalog.cardinality(target_token_ids) > 100 THEN
      RAISE EXCEPTION USING
        ERRCODE = '54000',
        MESSAGE = 'admin_token_batch_too_large';
    END IF;

    -- Evaluate recovery loss against the complete revoke set. Per-token checks
    -- alone let two verified owners in the same batch each see the other before
    -- either row changes; the row trigger is defense in depth, not the set-wise
    -- authorization decision.
    IF EXISTS (
         SELECT 1
           FROM public.admin_tokens AS target_owner
          WHERE target_owner.id = ANY(target_token_ids)
            AND public.admin_owner_token_recoverable(
              target_owner.admin_id,
              target_owner.role,
              target_owner.revoked_at,
              target_owner.expires_at,
              target_owner.last_used_at
            )
            AND EXISTS (
              SELECT 1
                FROM public.profiles AS target_owner_profile
               WHERE target_owner_profile.id = target_owner.admin_id
            )
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.admin_tokens AS remaining_owner
          WHERE NOT (remaining_owner.id = ANY(target_token_ids))
            AND public.admin_owner_token_recoverable(
              remaining_owner.admin_id,
              remaining_owner.role,
              remaining_owner.revoked_at,
              remaining_owner.expires_at,
              remaining_owner.last_used_at
            )
            AND EXISTS (
              SELECT 1
                FROM public.profiles AS remaining_owner_profile
               WHERE remaining_owner_profile.id = remaining_owner.admin_id
            )
       ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'last_active_owner_token';
    END IF;

    FOREACH target_token_id IN ARRAY target_token_ids LOOP
      PERFORM public.admin_assert_token_revoke_allowed(
        actor_token_id,
        target_token_id
      );
    END LOOP;

    UPDATE public.admin_tokens AS token
       SET revoked_at = pg_catalog.now()
     WHERE token.id = ANY(target_token_ids)
       AND token.revoked_at IS NULL;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> pg_catalog.cardinality(target_token_ids) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'admin_token_batch_conflict';
    END IF;

    PERFORM public.record_audit(
      'token_revoked',
      actor_id_value,
      target_admin_id,
      pg_catalog.jsonb_build_object(
        'mode', 'admin_id',
        'admin_id', target_admin_id,
        'token_ids', pg_catalog.to_jsonb(target_token_ids),
        'revoked_count', affected_rows,
        'case_id', case_id_value,
        'approval_ref', approval_ref_value
      )
    );
    result_value := pg_catalog.jsonb_build_object(
      'data', pg_catalog.jsonb_build_object(
        'admin_id', target_admin_id,
        'token_ids', pg_catalog.to_jsonb(target_token_ids),
        'revoked_count', affected_rows
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_audit_log AS audit
     WHERE audit.admin_token_id = actor_token_id
       AND audit.idempotency_key = p_idempotency_key
       AND audit.actor_id = actor_id_value
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'admin_audit_required_missing';
  END IF;

  UPDATE public.admin_mutation_requests AS request
     SET status = 'completed',
         result = result_value,
         completed_at = pg_catalog.now()
   WHERE request.admin_token_id = actor_token_id
     AND request.idempotency_key = p_idempotency_key
     AND request.status = 'running';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'idempotency_completion_failed';
  END IF;

  PERFORM pg_catalog.set_config('admin.audit_required', 'off', true);
  PERFORM pg_catalog.set_config('admin.actor_id', '', true);
  PERFORM pg_catalog.set_config('admin.token_id', '', true);
  PERFORM pg_catalog.set_config('admin.idempotency_key', '', true);
  PERFORM pg_catalog.set_config('admin.role', '', true);

  RETURN result_value;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_execute_token_lifecycle(
  text, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.admin_execute_mutation(
  p_token_hash text,
  p_idempotency_key uuid,
  p_payload_hash text,
  p_action text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_action IN ('issue_token', 'revoke_token', 'revoke_admin_tokens') THEN
    RETURN public.admin_execute_token_lifecycle(
      p_token_hash,
      p_idempotency_key,
      p_payload_hash,
      p_action,
      p_payload
    );
  END IF;

  RETURN public.admin_execute_mutation_pre_token_lifecycle(
    p_token_hash,
    p_idempotency_key,
    p_payload_hash,
    p_action,
    p_payload
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_execute_mutation(
  text, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_execute_mutation(
  text, uuid, text, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.admin_execute_token_lifecycle(
  text, uuid, text, text, jsonb
) IS
  'Internal actor-authorized token issue/exact revoke/admin_id batch revoke with required audit and idempotency.';
COMMENT ON FUNCTION public.admin_prepare_account_deletion(uuid) IS
  'Service-only atomic recovery readiness, durable deletion tombstone, all-token revoke, and system audit boundary.';
COMMENT ON FUNCTION public.admin_execute_mutation(
  text, uuid, text, text, jsonb
) IS
  'Stable service-only admin mutation entrypoint; delegates token lifecycle to its atomic audited implementation.';
COMMENT ON FUNCTION public.admin_execute_mutation_pre_token_lifecycle(
  text, uuid, text, text, jsonb
) IS
  'Internal preserved implementation for pre-lifecycle administrator actions; not directly executable by API roles.';

NOTIFY pgrst, 'reload schema';

COMMIT;
