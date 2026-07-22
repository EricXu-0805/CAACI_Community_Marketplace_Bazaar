-- Bound unauthenticated admin-token probes before they contend with the
-- serialized mutation/recovery lock domain.
--
-- The Edge route already hashes a syntactically valid bearer before calling
-- this service-only RPC. Historically every random hash acquired both global
-- admin advisory locks and only then discovered that no token row matched.
-- A public caller could therefore turn invalid credentials into control-plane
-- lock contention. The unlocked probe below is only a fast negative check;
-- every positive candidate is still revalidated by the original UPDATE after
-- both locks, so revoke/expiry/profile races remain fail-closed.

BEGIN;

DO $precheck$
DECLARE
  authorization_source text;
BEGIN
  IF pg_catalog.to_regclass('public.admin_tokens') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.admin_role_action_capabilities') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_token_identity_safe(text,text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_token_authorization_v2(text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'admin_invalid_auth_hardening_prerequisite_missing'
      USING ERRCODE = '55000';
  END IF;

  SELECT function.prosrc
    INTO authorization_source
    FROM pg_catalog.pg_proc AS function
   WHERE function.oid = pg_catalog.to_regprocedure(
     'public.admin_token_authorization_v2(text)'
   );

  IF authorization_source IS NULL
     OR pg_catalog.strpos(
       authorization_source,
       'pg_advisory_xact_lock(20260718180000::bigint)'
     ) = 0
     OR pg_catalog.strpos(
       authorization_source,
       'pg_advisory_xact_lock(20260718190000::bigint)'
     ) = 0
     OR pg_catalog.strpos(authorization_source, 'SET last_used_at') = 0
     OR pg_catalog.strpos(
       authorization_source,
       'admin_token_identity_safe('
     ) = 0 THEN
    RAISE EXCEPTION 'admin_invalid_auth_hardening_baseline_drifted'
      USING ERRCODE = '55000';
  END IF;
END
$precheck$;

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

  authorization_time := pg_catalog.clock_timestamp();

  -- This is deliberately an unlocked, read-only negative probe. It prevents
  -- random/revoked/expired hashes from entering the global lock domain. A
  -- positive candidate receives no authority here and is checked again below.
  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS candidate
     WHERE candidate.token_hash = p_token_hash
       AND candidate.admin_id IS NOT NULL
       AND candidate.revoked_at IS NULL
       AND (
         candidate.expires_at IS NULL
         OR candidate.expires_at > authorization_time
       )
       AND public.admin_token_identity_safe(
         candidate.admin_name,
         candidate.admin_email
       )
       AND EXISTS (
         SELECT 1
           FROM public.profiles AS profile
          WHERE profile.id = candidate.admin_id
       )
  ) THEN
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

COMMENT ON FUNCTION public.admin_token_authorization_v2(text) IS
  'Service-only active admin-token authorization. Missing, inactive, or identity-unsafe candidates exit after an indexed read-only probe; positive candidates are revalidated under both admin advisory locks before last_used_at is updated.';

NOTIFY pgrst, 'reload schema';

COMMIT;
