-- Preserve the last active owner issuer even after that credential falls below
-- the 24-hour durable-recovery horizon (or has not yet been presented).
--
-- The prior guard used admin_owner_token_recoverable() for both the target and
-- the replacement. That predicate is intentionally strict: a candidate needs
-- last_used_at plus at least 24 hours of life before it may justify removing an
-- old owner. It is too strict for the target side, however. A still-active owner
-- below that horizon can authenticate and issue a durable replacement. A
-- security_admin could revoke that final issuer because the target no longer
-- counted as "recoverable", leaving only roles that cannot issue owner tokens.
--
-- A second mismatch existed at the application boundary: PostgreSQL stamped
-- last_used_at before the Edge layer rejected cached identities containing
-- control/bidi characters. Align issuance, authorization, inventory, and
-- recovery so an application-rejected credential is never an owner issuer.
--
-- Target side: protect every identity-safe, attached, unrevoked, unexpired
-- owner issuer. Replacement side: require identity safety plus the stronger
-- presentation and 24-hour recovery predicate.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

-- Preserve the global order shared by authorization, lifecycle mutation,
-- direct token writes, account deletion, and profile deletion.
SELECT pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
SELECT pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
LOCK TABLE public.admin_tokens IN SHARE ROW EXCLUSIVE MODE;

-- Keep the database authorization contract aligned with the Edge validator.
-- A token identity containing controls or bidi overrides is not render-safe
-- and the API refuses it. Such a row must never be stamped as presented or be
-- allowed to justify removal of the last usable owner.
CREATE OR REPLACE FUNCTION public.admin_token_identity_safe(
  p_admin_name text,
  p_admin_email text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT p_admin_name IS NOT NULL
     AND pg_catalog.length(p_admin_name) BETWEEN 1 AND 100
     AND p_admin_name !~ '[[:cntrl:]]'
     AND pg_catalog.strpos(p_admin_name, U&'\061C') = 0
     AND pg_catalog.strpos(p_admin_name, U&'\200E') = 0
     AND pg_catalog.strpos(p_admin_name, U&'\200F') = 0
     AND pg_catalog.strpos(p_admin_name, U&'\202A') = 0
     AND pg_catalog.strpos(p_admin_name, U&'\202B') = 0
     AND pg_catalog.strpos(p_admin_name, U&'\202C') = 0
     AND pg_catalog.strpos(p_admin_name, U&'\202D') = 0
     AND pg_catalog.strpos(p_admin_name, U&'\202E') = 0
     AND pg_catalog.strpos(p_admin_name, U&'\2066') = 0
     AND pg_catalog.strpos(p_admin_name, U&'\2067') = 0
     AND pg_catalog.strpos(p_admin_name, U&'\2068') = 0
     AND pg_catalog.strpos(p_admin_name, U&'\2069') = 0
     AND p_admin_email IS NOT NULL
     AND pg_catalog.length(p_admin_email) BETWEEN 3 AND 200
     AND pg_catalog.strpos(p_admin_email, '@') > 0
     AND p_admin_email !~ '[[:cntrl:]]'
     AND pg_catalog.strpos(p_admin_email, U&'\061C') = 0
     AND pg_catalog.strpos(p_admin_email, U&'\200E') = 0
     AND pg_catalog.strpos(p_admin_email, U&'\200F') = 0
     AND pg_catalog.strpos(p_admin_email, U&'\202A') = 0
     AND pg_catalog.strpos(p_admin_email, U&'\202B') = 0
     AND pg_catalog.strpos(p_admin_email, U&'\202C') = 0
     AND pg_catalog.strpos(p_admin_email, U&'\202D') = 0
     AND pg_catalog.strpos(p_admin_email, U&'\202E') = 0
     AND pg_catalog.strpos(p_admin_email, U&'\2066') = 0
     AND pg_catalog.strpos(p_admin_email, U&'\2067') = 0
     AND pg_catalog.strpos(p_admin_email, U&'\2068') = 0
     AND pg_catalog.strpos(p_admin_email, U&'\2069') = 0;
$function$;

REVOKE ALL ON FUNCTION public.admin_token_identity_safe(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Explicit-row overload for transition rows and scans that already have the
-- cached identity. The original five-argument signature remains available to
-- previously deployed callers below.
CREATE OR REPLACE FUNCTION public.admin_owner_token_recoverable(
  p_admin_id uuid,
  p_role text,
  p_revoked_at timestamptz,
  p_expires_at timestamptz,
  p_last_used_at timestamptz,
  p_admin_name text,
  p_admin_email text
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
     AND p_last_used_at IS NOT NULL
     AND public.admin_token_identity_safe(p_admin_name, p_admin_email);
$function$;

REVOKE ALL ON FUNCTION public.admin_owner_token_recoverable(
  uuid, text, timestamptz, timestamptz, timestamptz, text, text
) FROM PUBLIC, anon, authenticated, service_role;

-- Compatibility wrapper for older lifecycle functions. Their five values
-- identify a stable table row. Requiring every matching row to have a safe
-- cached identity is deliberately conservative if historical rows collide on
-- all five lifecycle fields.
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
     AND p_last_used_at IS NOT NULL
     AND COALESCE(
       (
         SELECT pg_catalog.bool_and(
           public.admin_token_identity_safe(
             token.admin_name,
             token.admin_email
           )
         )
           FROM public.admin_tokens AS token
          WHERE token.admin_id IS NOT DISTINCT FROM p_admin_id
            AND token.role IS NOT DISTINCT FROM p_role
            AND token.revoked_at IS NOT DISTINCT FROM p_revoked_at
            AND token.expires_at IS NOT DISTINCT FROM p_expires_at
            AND token.last_used_at IS NOT DISTINCT FROM p_last_used_at
       ),
       false
     );
$function$;

REVOKE ALL ON FUNCTION public.admin_owner_token_recoverable(
  uuid, text, timestamptz, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_validate_token_identity_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.revoked_at IS NULL
     AND NOT public.admin_token_identity_safe(
       NEW.admin_name,
       NEW.admin_email
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_token_identity_unsafe';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_validate_token_identity_write()
  FROM PUBLIC, anon, authenticated, service_role;

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
  target_admin_name text;
  target_admin_email text;
  target_is_active_owner boolean;
  check_time timestamptz := pg_catalog.clock_timestamp();
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
         OR actor_token.expires_at > check_time
       )
       AND public.admin_token_identity_safe(
         actor_token.admin_name,
         actor_token.admin_email
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
         target_token.admin_name,
         target_token.admin_email
    INTO target_admin_id,
         target_role,
         target_revoked_at,
         target_expires_at,
         target_admin_name,
         target_admin_email
    FROM public.admin_tokens AS target_token
   WHERE target_token.id = p_target_token_id
     AND target_token.revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_token_revoke_context_invalid';
  END IF;

  target_is_active_owner := target_admin_id IS NOT NULL
    AND target_role = 'owner'
    AND target_revoked_at IS NULL
    AND (target_expires_at IS NULL OR target_expires_at > check_time)
    AND public.admin_token_identity_safe(
      target_admin_name,
      target_admin_email
    )
    AND EXISTS (
      SELECT 1
        FROM public.profiles AS target_profile
       WHERE target_profile.id = target_admin_id
    );

  -- A short-lived or never-presented owner is not a durable replacement, but
  -- while it is active it remains the only role capable of issuing one. Do not
  -- let revocation remove that final recovery path. Every *remaining* owner
  -- must still meet the stronger, independently verified recovery predicate.
  IF target_is_active_owner
     AND NOT EXISTS (
       SELECT 1
         FROM public.admin_tokens AS owner_token
        WHERE owner_token.id <> p_target_token_id
          AND public.admin_owner_token_recoverable(
            owner_token.admin_id,
            owner_token.role,
            owner_token.revoked_at,
            owner_token.expires_at,
            owner_token.last_used_at,
            owner_token.admin_name,
            owner_token.admin_email
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
  old_was_active_owner boolean;
  new_is_active_owner boolean := false;
  old_was_recoverable_owner boolean;
  new_is_recoverable_owner boolean := false;
  check_time timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);

  old_was_active := OLD.admin_id IS NOT NULL
    AND OLD.revoked_at IS NULL
    AND (OLD.expires_at IS NULL OR OLD.expires_at > check_time)
    AND public.admin_token_identity_safe(
      OLD.admin_name,
      OLD.admin_email
    );
  old_was_active_owner := old_was_active AND OLD.role = 'owner';
  old_was_recoverable_owner := public.admin_owner_token_recoverable(
    OLD.admin_id,
    OLD.role,
    OLD.revoked_at,
    OLD.expires_at,
    OLD.last_used_at,
    OLD.admin_name,
    OLD.admin_email
  );

  IF TG_OP = 'UPDATE' THEN
    new_is_active := NEW.admin_id IS NOT NULL
      AND NEW.revoked_at IS NULL
      AND (NEW.expires_at IS NULL OR NEW.expires_at > check_time)
      AND public.admin_token_identity_safe(
        NEW.admin_name,
        NEW.admin_email
      );
    new_is_active_owner := new_is_active AND NEW.role = 'owner';
    new_is_recoverable_owner := public.admin_owner_token_recoverable(
      NEW.admin_id,
      NEW.role,
      NEW.revoked_at,
      NEW.expires_at,
      NEW.last_used_at,
      NEW.admin_name,
      NEW.admin_email
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
         OR other_token.expires_at > check_time
       )
       AND public.admin_token_identity_safe(
         other_token.admin_name,
         other_token.admin_email
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

  -- Preserve both parts of the invariant:
  --   * an active owner may not be removed without a recoverable replacement;
  --   * an already-recoverable owner may not be shortened/downgraded below the
  --     recovery predicate without a recoverable replacement.
  IF old_was_active_owner
     AND (
       NOT new_is_active_owner
       OR (old_was_recoverable_owner AND NOT new_is_recoverable_owner)
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.admin_tokens AS other_owner
        WHERE other_owner.id <> OLD.id
          AND public.admin_owner_token_recoverable(
            other_owner.admin_id,
            other_owner.role,
            other_owner.revoked_at,
            other_owner.expires_at,
            other_owner.last_used_at,
            other_owner.admin_name,
            other_owner.admin_email
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

-- Reject unsafe cached identity before stamping last_used_at. This is the
-- authoritative presentation event used by owner recovery; an Edge-rejected
-- row must remain unpresented in both v1 and v2 projections.
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
DECLARE
  authorization_time timestamptz;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
  authorization_time := pg_catalog.clock_timestamp();

  RETURN QUERY
  WITH matched AS (
    UPDATE public.admin_tokens AS token
       SET last_used_at = authorization_time
     WHERE token.token_hash = p_token_hash
       AND token.admin_id IS NOT NULL
       AND token.revoked_at IS NULL
       AND (token.expires_at IS NULL OR token.expires_at > authorization_time)
       AND public.admin_token_identity_safe(
         token.admin_name,
         token.admin_email
       )
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
              AND capability.action <> 'decide_appeal'
            ORDER BY capability.action
         )::text[]
    FROM matched;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_token_authorization(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_token_authorization(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_token_authorization_v2(
  p_token_hash text
)
RETURNS TABLE (
  token_id uuid,
  admin_id uuid,
  admin_name text,
  admin_email text,
  role text,
  expires_at timestamptz,
  server_now timestamptz,
  capabilities text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  authorization_time timestamptz;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
  authorization_time := pg_catalog.clock_timestamp();

  RETURN QUERY
  WITH matched AS (
    UPDATE public.admin_tokens AS token
       SET last_used_at = authorization_time
     WHERE token.token_hash = p_token_hash
       AND token.admin_id IS NOT NULL
       AND token.revoked_at IS NULL
       AND (token.expires_at IS NULL OR token.expires_at > authorization_time)
       AND public.admin_token_identity_safe(
         token.admin_name,
         token.admin_email
       )
       AND EXISTS (
         SELECT 1
           FROM public.profiles AS profile
          WHERE profile.id = token.admin_id
       )
    RETURNING
      token.id,
      token.admin_id,
      token.admin_name,
      token.admin_email,
      token.role,
      token.expires_at
  )
  SELECT matched.id,
         matched.admin_id,
         matched.admin_name,
         matched.admin_email,
         matched.role,
         matched.expires_at,
         authorization_time,
         ARRAY(
           SELECT capability.action
             FROM public.admin_role_action_capabilities AS capability
            WHERE capability.admin_role = matched.role
            ORDER BY capability.action
         )::text[]
    FROM matched;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_token_authorization_v2(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_token_authorization_v2(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_reconcile_issued_token(
  p_token_hash text
)
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
     AND public.admin_token_identity_safe(
       token.admin_name,
       token.admin_email
     )
   LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reconcile_issued_token(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_issued_token(text)
  TO service_role;

-- Preserve the exact inventory row shape. Unsafe historical snapshots are
-- still discoverable/revocable by id, but controls are not reflected to the
-- admin UI and their last_used_at is withheld so recovery health cannot count
-- a presentation that the application would reject.
CREATE OR REPLACE FUNCTION public.admin_token_inventory()
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
         CASE
           WHEN public.admin_token_identity_safe(
             token.admin_name,
             token.admin_email
           ) THEN token.admin_name
           ELSE '[unsafe identity]'
         END,
         CASE
           WHEN public.admin_token_identity_safe(
             token.admin_name,
             token.admin_email
           ) THEN token.admin_email
           ELSE 'unsafe@invalid.local'
         END,
         token.role,
         token.created_at,
         CASE
           WHEN public.admin_token_identity_safe(
             token.admin_name,
             token.admin_email
           ) THEN token.last_used_at
           ELSE NULL
         END,
         token.expires_at,
         token.revoked_at
    FROM public.admin_tokens AS token
   ORDER BY token.created_at DESC, token.id DESC;
$function$;

REVOKE ALL ON FUNCTION public.admin_token_inventory()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_token_inventory()
  TO service_role;

-- Reassert the exact row-trigger topology in case a partially applied repair
-- replaced only the function body. The statement-level ordered lock trigger is
-- preserved unchanged.
DROP TRIGGER IF EXISTS admin_tokens_01_validate_active_identity
ON public.admin_tokens;
CREATE TRIGGER admin_tokens_01_validate_active_identity
BEFORE INSERT OR UPDATE OF admin_name, admin_email, revoked_at
ON public.admin_tokens
FOR EACH ROW
EXECUTE FUNCTION public.admin_validate_token_identity_write();

DROP TRIGGER IF EXISTS admin_tokens_protect_recovery ON public.admin_tokens;
CREATE TRIGGER admin_tokens_protect_recovery
BEFORE UPDATE OF admin_id, revoked_at, expires_at, role OR DELETE
ON public.admin_tokens
FOR EACH ROW
EXECUTE FUNCTION public.admin_protect_recovery_tokens();

COMMENT ON FUNCTION public.admin_assert_token_revoke_allowed(uuid, uuid) IS
  'Internal fail-closed revoke guard: any usable active owner target requires a different identity-safe verified owner with at least 24 hours remaining.';
COMMENT ON FUNCTION public.admin_protect_recovery_tokens() IS
  'Table-boundary guard preserving the last identity-safe active owner issuer and the stronger durable owner recovery horizon.';
COMMENT ON FUNCTION public.admin_token_identity_safe(text, text) IS
  'Canonical DB equivalent of the admin Edge identity shape/control/bidi validator.';
COMMENT ON FUNCTION public.admin_validate_token_identity_write() IS
  'Rejects active administrator token inserts/reactivations with an application-rejected cached identity.';
COMMENT ON FUNCTION public.admin_owner_token_recoverable(
  uuid, text, timestamptz, timestamptz, timestamptz, text, text
) IS
  'Explicit-row owner recovery predicate requiring safe cached identity, presentation, and at least 24 hours remaining.';
COMMENT ON FUNCTION public.admin_owner_token_recoverable(
  uuid, text, timestamptz, timestamptz, timestamptz
) IS
  'Compatibility owner recovery predicate that fail-closes unless every matching stable token row has a safe cached identity.';
COMMENT ON FUNCTION public.admin_token_authorization_v2(text) IS
  'Service-only authorization that validates cached identity before recording successful presentation.';
COMMENT ON FUNCTION public.admin_token_authorization(text) IS
  'Service-only v1 authorization that validates cached identity before recording successful presentation.';
COMMENT ON FUNCTION public.admin_reconcile_issued_token(text) IS
  'Service-only exact digest reconciliation; application-rejected identity snapshots fail closed as non-reconcilable.';
COMMENT ON FUNCTION public.admin_token_inventory() IS
  'Service-only token inventory; unsafe historical identity snapshots are redacted and never expose a recovery presentation signal.';

NOTIFY pgrst, 'reload schema';

COMMIT;
