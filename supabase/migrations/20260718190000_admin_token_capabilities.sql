-- Least-privilege administrator token roles and capability enforcement.
--
-- Existing tokens are deliberately backfilled to the least-privileged
-- operator role. No mutable name/email field is used to infer elevated access;
-- security_admin and owner must be assigned through a reviewed service-side
-- operation after deployment.

BEGIN;

ALTER TABLE public.admin_tokens
  ADD COLUMN role text;

UPDATE public.admin_tokens
   SET role = 'operator'
 WHERE role IS NULL;

ALTER TABLE public.admin_tokens
  ALTER COLUMN role SET DEFAULT 'operator',
  ALTER COLUMN role SET NOT NULL,
  ADD CONSTRAINT admin_tokens_role_check
    CHECK (role IN ('operator', 'security_admin', 'owner'));

COMMENT ON COLUMN public.admin_tokens.role IS
  'Least-privilege administrator role snapshot: operator, security_admin, or owner.';

CREATE TABLE public.admin_role_action_capabilities (
  admin_role text NOT NULL CHECK (
    admin_role IN ('operator', 'security_admin', 'owner')
  ),
  action text NOT NULL CHECK (action IN (
    'apply_ban',
    'lift_suspension',
    'update_report_status',
    'resolve_target_reports',
    'takedown_content',
    'set_post_pinned',
    'upsert_banner',
    'delete_banner',
    'revoke_token',
    'upload_banner'
  )),
  PRIMARY KEY (admin_role, action)
);

ALTER TABLE public.admin_role_action_capabilities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_role_action_capabilities
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.admin_role_action_capabilities TO service_role;

INSERT INTO public.admin_role_action_capabilities (admin_role, action) VALUES
  ('operator', 'apply_ban'),
  ('operator', 'lift_suspension'),
  ('operator', 'update_report_status'),
  ('operator', 'resolve_target_reports'),
  ('operator', 'takedown_content'),
  ('security_admin', 'revoke_token'),
  ('owner', 'apply_ban'),
  ('owner', 'lift_suspension'),
  ('owner', 'update_report_status'),
  ('owner', 'resolve_target_reports'),
  ('owner', 'takedown_content'),
  ('owner', 'set_post_pinned'),
  ('owner', 'upsert_banner'),
  ('owner', 'delete_banner'),
  ('owner', 'revoke_token'),
  ('owner', 'upload_banner');

COMMENT ON TABLE public.admin_role_action_capabilities IS
  'Migration-owned allowlist used by the internal admin mutation capability hook.';

-- The 180000 wrapper invokes this hook after locking/revalidating the caller
-- token and before inserting an idempotency ledger row. A denial therefore
-- leaves business state, audit state, and the request ledger unchanged.
CREATE OR REPLACE FUNCTION public.admin_assert_mutation_capability(
  p_token_id uuid,
  p_action text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  token_role text;
BEGIN
  IF p_token_id IS NULL OR p_action IS NULL OR p_action = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_mutation_capability_invalid';
  END IF;

  SELECT token.role
    INTO token_role
    FROM public.admin_tokens AS token
   WHERE token.id = p_token_id
     AND token.revoked_at IS NULL
     AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now());

  IF token_role IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.admin_role_action_capabilities AS capability
     WHERE capability.admin_role = token_role
       AND capability.action = p_action
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'admin_capability_denied';
  END IF;

  PERFORM pg_catalog.set_config('admin.role', token_role, true);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_assert_mutation_capability(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- A newly issued digest is not yet a proven recovery credential: its plaintext
-- may have been lost with the issue response. The first successful
-- admin_token_authorization call stamps last_used_at, proving the holder can
-- actually present it. It must also retain at least 24 hours of usable life so
-- a credential at the expiry cliff cannot authorize removal of the old owner.
-- Keep this lifecycle predicate centralized; callers
-- additionally require a live profile when scanning other token rows. The
-- recovery trigger can trust OLD.admin_id because its validated FK was live
-- before a profile-detach action began.
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

-- Preserve an independently verified owner recovery credential. An active but
-- never-presented replacement cannot authorize loss of the last usable owner.
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
       AND actor_token.revoked_at IS NULL
       AND (
         actor_token.expires_at IS NULL
         OR actor_token.expires_at > pg_catalog.now()
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

-- The operational revoke script performs a direct service-role PATCH. Enforce
-- the recovery invariants at the table boundary as well as in the JSON RPC so
-- that a direct revoke cannot bypass last-token protection. The advisory lock
-- serializes two direct revocations that target different token rows.
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

-- Row-level BEFORE triggers run after PostgreSQL has selected/locked the tuple.
-- Acquire the global lifecycle/recovery locks at statement start so a direct
-- owner/break-glass UPDATE cannot hold a token tuple while waiting on 190000,
-- opposite authorization/account deletion which hold 190000 then lock tuples.
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

CREATE TRIGGER admin_tokens_00_lock_recovery_mutation
BEFORE UPDATE OR DELETE
ON public.admin_tokens
FOR EACH STATEMENT
EXECUTE FUNCTION public.admin_lock_token_recovery_mutation();

CREATE TRIGGER admin_tokens_protect_recovery
BEFORE UPDATE OF revoked_at, expires_at, role OR DELETE
ON public.admin_tokens
FOR EACH ROW
EXECUTE FUNCTION public.admin_protect_recovery_tokens();

-- Preserve the 180000 required-audit rollback behavior while adding the role
-- observed by the capability hook to every atomic mutation audit row.
CREATE OR REPLACE FUNCTION public.record_audit(
  event_kind_in text,
  actor_id_in uuid,
  target_id_in uuid,
  details_in jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  audit_required boolean := COALESCE(
    pg_catalog.current_setting('admin.audit_required', true),
    'off'
  ) = 'on';
  context_actor_id uuid;
  context_token_id uuid;
  context_key uuid;
  context_role text;
  effective_actor_id uuid;
  effective_details jsonb;
BEGIN
  context_actor_id := NULLIF(
    pg_catalog.current_setting('admin.actor_id', true),
    ''
  )::uuid;
  context_token_id := NULLIF(
    pg_catalog.current_setting('admin.token_id', true),
    ''
  )::uuid;
  context_key := NULLIF(
    pg_catalog.current_setting('admin.idempotency_key', true),
    ''
  )::uuid;
  context_role := NULLIF(
    pg_catalog.current_setting('admin.role', true),
    ''
  );

  IF audit_required AND (
    context_actor_id IS NULL
    OR context_token_id IS NULL
    OR context_key IS NULL
    OR context_role IS NULL
    OR context_role NOT IN ('operator', 'security_admin', 'owner')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'admin_audit_context_missing';
  END IF;

  effective_actor_id := COALESCE(context_actor_id, actor_id_in);
  effective_details := COALESCE(details_in, '{}'::jsonb);
  IF context_token_id IS NOT NULL AND context_key IS NOT NULL THEN
    effective_details := effective_details || pg_catalog.jsonb_build_object(
      'via', 'admin_execute_mutation',
      'admin_token_id', context_token_id,
      'idempotency_key', context_key
    );
    IF context_role IS NOT NULL THEN
      effective_details := effective_details || pg_catalog.jsonb_build_object(
        'admin_role', context_role
      );
    END IF;
  END IF;

  INSERT INTO public.admin_audit_log (
    event_kind,
    actor_id,
    target_id,
    details,
    admin_token_id,
    idempotency_key
  ) VALUES (
    event_kind_in,
    effective_actor_id,
    target_id_in,
    effective_details,
    context_token_id,
    context_key
  );
EXCEPTION WHEN OTHERS THEN
  IF audit_required THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'admin_audit_required_failed';
  END IF;
  RAISE LOG 'record_audit best-effort failure: event_kind=% sqlstate=%',
    event_kind_in, SQLSTATE;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_audit(text, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_audit(text, uuid, uuid, jsonb)
  TO service_role;

-- Role-aware replacement for API authentication. The legacy validation RPC is
-- retained unchanged for compatibility. Invalid/inactive hashes return zero
-- rows; transport/provider failures remain distinguishable by HTTP status.
CREATE FUNCTION public.admin_token_authorization(p_token_hash text)
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

  -- A successful presentation is what promotes a freshly issued owner digest
  -- into the verified recovery set. Serialize that promotion with lifecycle
  -- revoke and table recovery checks before stamping last_used_at.
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
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_token_authorization(text)
  TO service_role;

CREATE FUNCTION public.admin_token_inventory()
RETURNS TABLE (
  id uuid,
  admin_id uuid,
  admin_name text,
  admin_email text,
  role text,
  created_at timestamptz,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT token.id,
         token.admin_id,
         token.admin_name,
         token.admin_email,
         token.role,
         token.created_at,
         token.last_used_at,
         token.expires_at,
         token.revoked_at
    FROM public.admin_tokens AS token
   ORDER BY token.created_at DESC, token.id DESC;
$function$;

REVOKE ALL ON FUNCTION public.admin_token_inventory()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_token_inventory()
  TO service_role;

COMMENT ON FUNCTION public.admin_assert_mutation_capability(uuid, text) IS
  'Internal pre-ledger exact role/action authorization hook for admin_execute_mutation.';
COMMENT ON FUNCTION public.admin_assert_token_revoke_allowed(uuid, uuid) IS
  'Internal last-recoverable-owner guard; owner tokens require successful presentation and at least 24 hours remaining.';
COMMENT ON FUNCTION public.admin_protect_recovery_tokens() IS
  'Table-level direct-PATCH/DELETE protection for last active admin and last verified owner recovery tokens.';
COMMENT ON FUNCTION public.admin_lock_token_recovery_mutation() IS
  'Internal statement-level 180000 then 190000 fence preventing token-row/advisory lock inversion for direct UPDATE or DELETE.';
COMMENT ON FUNCTION public.admin_token_authorization(text) IS
  'Service-only active token authorization with role/capability snapshot; last_used_at proves presentation while recovery also requires 24 hours remaining.';
COMMENT ON FUNCTION public.admin_token_inventory() IS
  'Service-only administrator token inventory including last_used_at, the authoritative owner recovery verification signal.';

NOTIFY pgrst, 'reload schema';

COMMIT;
