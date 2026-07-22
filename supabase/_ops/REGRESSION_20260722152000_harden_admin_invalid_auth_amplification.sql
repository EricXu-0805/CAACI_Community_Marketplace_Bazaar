-- Isolated rollback-only regression for 20260722152000.
-- NEVER run against production. Use a disposable PostgreSQL 16/17 database.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL search_path = pg_catalog;

DO $identity_contract$
BEGIN
  IF NOT public.admin_token_identity_safe(
       'Safe Admin',
       'safe-admin@example.test'
     ) OR public.admin_token_identity_safe(
       U&'Unsafe\202EAdmin',
       'unsafe-admin@example.test'
     ) THEN
    RAISE EXCEPTION 'admin token identity safety prerequisite drifted';
  END IF;
END;
$identity_contract$;

DO $fixture_hash_is_absent$
DECLARE
  absent_hash text := pg_catalog.repeat('f', 64);
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.token_hash = absent_hash
  ) THEN
    RAISE EXCEPTION 'regression fixture hash unexpectedly exists';
  END IF;
END;
$fixture_hash_is_absent$;

SET LOCAL ROLE service_role;

DO $invalid_candidates_do_not_lock$
DECLARE
  absent_hash text := pg_catalog.repeat('f', 64);
  locks_before integer;
  locks_after integer;
  result_count integer;
BEGIN

  SELECT pg_catalog.count(*)
    INTO locks_before
    FROM pg_catalog.pg_locks AS lock
   WHERE lock.pid = pg_catalog.pg_backend_pid()
     AND lock.locktype = 'advisory';

  SELECT pg_catalog.count(*)
    INTO result_count
    FROM public.admin_token_authorization_v2(absent_hash);
  IF result_count <> 0 THEN
    RAISE EXCEPTION 'absent token hash authenticated';
  END IF;

  SELECT pg_catalog.count(*)
    INTO locks_after
    FROM pg_catalog.pg_locks AS lock
   WHERE lock.pid = pg_catalog.pg_backend_pid()
     AND lock.locktype = 'advisory';
  IF locks_after IS DISTINCT FROM locks_before THEN
    RAISE EXCEPTION 'absent token hash entered advisory-lock domain';
  END IF;

  SELECT pg_catalog.count(*)
    INTO result_count
    FROM public.admin_token_authorization_v2('not-a-sha256');
  IF result_count <> 0 THEN
    RAISE EXCEPTION 'malformed token hash authenticated';
  END IF;
END;
$invalid_candidates_do_not_lock$;

RESET ROLE;

DO $authorization_acl$
DECLARE
  authorization_oid regprocedure :=
    'public.admin_token_authorization_v2(text)'::pg_catalog.regprocedure;
BEGIN
  IF pg_catalog.has_function_privilege(
       'anon', authorization_oid, 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'authenticated', authorization_oid, 'EXECUTE'
     ) OR NOT pg_catalog.has_function_privilege(
       'service_role', authorization_oid, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'authorization RPC ACL regression';
  END IF;
END;
$authorization_acl$;

ROLLBACK;
