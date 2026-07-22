-- =============================================================================
-- Make the Illini email-code grant a single, caller-bound database transaction.
--
-- The historical edge handler performed a service-role SELECT, a separate
-- read/check/PATCH of attempts, a profile PATCH, and finally a DELETE. Parallel
-- requests could therefore reuse stale attempt counts or leave a granted badge
-- with an unconsumed code. This RPC serializes one user's pending row and keeps
-- every state transition inside one transaction.
-- =============================================================================

DO $migration$
DECLARE
  required_relation text;
BEGIN
  FOREACH required_relation IN ARRAY ARRAY[
    'public.illini_verifications',
    'public.profiles'
  ] LOOP
    IF pg_catalog.to_regclass(required_relation) IS NULL THEN
      RAISE EXCEPTION 'migration_precheck_failed: missing relation %',
        required_relation;
    END IF;
  END LOOP;

  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'migration_precheck_failed: missing function auth.uid()';
  END IF;

  -- The RPC maps a unique_violation by this constraint name to email_taken.
  -- A same-name non-unique/wrong-table/wrong-expression index would silently
  -- remove the cross-account guarantee, so validate the full catalog shape
  -- before granting the callable function.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = index_relation.relnamespace
    JOIN pg_catalog.pg_index AS index_definition
      ON index_definition.indexrelid = index_relation.oid
    JOIN pg_catalog.pg_am AS access_method
      ON access_method.oid = index_relation.relam
    WHERE namespace.nspname = 'public'
      AND index_relation.relname = 'uq_profiles_verified_illini_email'
      AND index_relation.relkind = 'i'
      AND index_definition.indrelid =
        'public.profiles'::pg_catalog.regclass
      AND index_definition.indisunique
      AND index_definition.indisvalid
      AND index_definition.indisready
      AND index_definition.indnkeyatts = 1
      AND index_definition.indnatts = 1
      AND index_definition.indkey::text = '0'
      AND access_method.amname = 'btree'
      AND pg_catalog.pg_get_expr(
        index_definition.indexprs,
        index_definition.indrelid
      ) = 'lower(verified_illini_email)'
      AND pg_catalog.pg_get_expr(
        index_definition.indpred,
        index_definition.indrelid
      ) = '(verified_illini_email IS NOT NULL)'
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: Illini email unique index shape mismatch';
  END IF;
END
$migration$;

CREATE OR REPLACE FUNCTION public.verify_illini_email_code(
  expected_user_id_in uuid,
  submitted_code_hash_in text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  pending_email text;
  pending_code_hash text;
  pending_expires_at timestamptz;
  pending_attempts integer;
  normalized_email text;
  normalized_submitted_hash text := pg_catalog.lower(
    pg_catalog.btrim(COALESCE(submitted_code_hash_in, ''))
  );
  profile_is_verified boolean;
  violation_constraint text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- Bind a page/request captured for account A to the same authenticated user.
  -- This rejects a stale request if the browser session changed to account B.
  IF expected_user_id_in IS NULL OR expected_user_id_in <> caller_id THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;

  -- The row lock is the concurrency boundary. Every same-user guess observes
  -- the attempt count written by the prior committed request; a consumed row
  -- becomes no_pending for the waiter rather than granting twice.
  SELECT
    verification.email,
    verification.code_hash,
    verification.expires_at,
    verification.attempts
  INTO
    pending_email,
    pending_code_hash,
    pending_expires_at,
    pending_attempts
  FROM public.illini_verifications AS verification
  WHERE verification.user_id = expected_user_id_in
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'no_pending';
  END IF;

  IF pending_expires_at <= pg_catalog.statement_timestamp() THEN
    DELETE FROM public.illini_verifications AS verification
    WHERE verification.user_id = expected_user_id_in;
    RETURN 'expired';
  END IF;

  SELECT profile.is_illini_verified
  INTO profile_is_verified
  FROM public.profiles AS profile
  WHERE profile.id = expected_user_id_in
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Keep the pending row so an operational profile repair does not force the
    -- user to request another email code.
    RETURN 'profile_not_found';
  END IF;

  IF profile_is_verified IS TRUE THEN
    DELETE FROM public.illini_verifications AS verification
    WHERE verification.user_id = expected_user_id_in;
    RETURN 'already_verified';
  END IF;

  IF pending_attempts >= 5 THEN
    RETURN 'too_many_attempts';
  END IF;

  -- Invalid direct-RPC input counts as a guess too. The edge route sends only a
  -- SHA-256 hex digest, so plaintext verification codes never cross PostgREST.
  IF pg_catalog.length(normalized_submitted_hash) <> 64
     OR normalized_submitted_hash !~ '^[0-9a-f]{64}$'
     OR normalized_submitted_hash IS DISTINCT FROM
       pg_catalog.lower(pending_code_hash) THEN
    UPDATE public.illini_verifications AS verification
    SET attempts = verification.attempts + 1
    WHERE verification.user_id = expected_user_id_in;
    RETURN 'bad_code';
  END IF;

  normalized_email := pg_catalog.lower(
    pg_catalog.btrim(COALESCE(pending_email, ''))
  );

  -- Defense in depth against a corrupt/manually inserted pending row.
  IF normalized_email !~ '^[^@[:space:]]+@illinois[.]edu$' THEN
    DELETE FROM public.illini_verifications AS verification
    WHERE verification.user_id = expected_user_id_in;
    RETURN 'invalid_email';
  END IF;

  BEGIN
    UPDATE public.profiles AS profile
    SET is_illini_verified = true,
        verified_illini_email = normalized_email
    WHERE profile.id = expected_user_id_in;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS violation_constraint = CONSTRAINT_NAME;
    IF violation_constraint = 'uq_profiles_verified_illini_email' THEN
      -- A correct code cannot be replayed after another account wins the unique
      -- campus-email race. Consume it and return a stable domain result.
      DELETE FROM public.illini_verifications AS verification
      WHERE verification.user_id = expected_user_id_in;
      RETURN 'email_taken';
    END IF;
    RAISE;
  END;

  -- Badge update and code consumption commit (or roll back) together.
  DELETE FROM public.illini_verifications AS verification
  WHERE verification.user_id = expected_user_id_in;

  RETURN 'verified';
END
$function$;

REVOKE ALL ON FUNCTION public.verify_illini_email_code(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_illini_email_code(uuid, text)
  TO authenticated;

COMMENT ON FUNCTION public.verify_illini_email_code(uuid, text) IS
  'Atomically validates and consumes a caller-bound Illini email code digest; returns a stable verification status.';

NOTIFY pgrst, 'reload schema';
