-- Isolated rollback-only regression for
-- 20260719174928_reconcile_trigger_only_function_acl.sql.
-- NEVER run against production.  Run only as a role allowed to create roles
-- and schema objects in a disposable PostgreSQL 16/17 database.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL search_path = pg_catalog;

DO $baseline_contract$
DECLARE
  function_oid oid :=
    'public.block_currency_exchange_items()'::pg_catalog.regprocedure;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS api_role(role_name)
    WHERE pg_catalog.has_function_privilege(
            api_role.role_name, function_oid, 'EXECUTE'
          )
       OR pg_catalog.has_function_privilege(
            api_role.role_name, function_oid, 'EXECUTE WITH GRANT OPTION'
          )
  ) THEN
    RAISE EXCEPTION 'baseline API function ACL is not locked down';
  END IF;
END;
$baseline_contract$;

-- Prove the trigger path does not depend on direct EXECUTE.  This is a real
-- SET ROLE test with an ordinary write, a blocked INSERT, a blocked UPDATE,
-- and a direct-call denial.
SAVEPOINT real_set_role_trigger_path;
CREATE TABLE public.trigger_only_acl_regression_items (
  id integer PRIMARY KEY,
  category public.item_category NOT NULL DEFAULT 'other'
);
CREATE TRIGGER trigger_only_acl_regression_block
  BEFORE INSERT OR UPDATE OF category
  ON public.trigger_only_acl_regression_items
  FOR EACH ROW EXECUTE FUNCTION public.block_currency_exchange_items();
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON TYPE public.item_category TO authenticated;
GRANT SELECT, INSERT, UPDATE
  ON TABLE public.trigger_only_acl_regression_items TO authenticated;

SET LOCAL ROLE authenticated;
INSERT INTO public.trigger_only_acl_regression_items (id, category)
VALUES (1, 'other');

DO $currency_insert_blocked$
DECLARE
  blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.trigger_only_acl_regression_items (id, category)
    VALUES (2, 'currency_exchange');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM = 'category_not_allowed' THEN
      blocked := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'currency exchange INSERT escaped trigger';
  END IF;
END;
$currency_insert_blocked$;

DO $currency_update_blocked$
DECLARE
  blocked boolean := false;
BEGIN
  BEGIN
    UPDATE public.trigger_only_acl_regression_items
    SET category = 'currency_exchange'
    WHERE id = 1;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM = 'category_not_allowed' THEN
      blocked := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'currency exchange UPDATE escaped trigger';
  END IF;
END;
$currency_update_blocked$;

DO $direct_call_denied$
DECLARE
  denied boolean := false;
BEGIN
  BEGIN
    EXECUTE 'SELECT public.block_currency_exchange_items()';
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;

  IF NOT denied THEN
    RAISE EXCEPTION 'authenticated direct trigger-function call was not denied';
  END IF;
END;
$direct_call_denied$;
RESET ROLE;

DO $ordinary_write_preserved$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.trigger_only_acl_regression_items
    WHERE id = 1 AND category = 'other'
  ) THEN
    RAISE EXCEPTION 'ordinary authenticated trigger-path write was not preserved';
  END IF;
END;
$ordinary_write_preserved$;
ROLLBACK TO SAVEPOINT real_set_role_trigger_path;

SAVEPOINT direct_acl_drift;
GRANT EXECUTE ON FUNCTION public.block_currency_exchange_items()
  TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.block_currency_exchange_items()
  TO authenticated WITH GRANT OPTION;
DO $direct_acl_drift_detected$
DECLARE
  function_oid oid :=
    'public.block_currency_exchange_items()'::pg_catalog.regprocedure;
  direct_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
  INTO direct_count
  FROM pg_catalog.pg_proc AS routine
  CROSS JOIN LATERAL pg_catalog.aclexplode(routine.proacl) AS acl
  WHERE routine.oid = function_oid
    AND (
      acl.grantee = 0
      OR acl.grantee IN (
        pg_catalog.to_regrole('anon')::oid,
        pg_catalog.to_regrole('authenticated')::oid,
        pg_catalog.to_regrole('service_role')::oid
      )
    )
    AND acl.privilege_type = 'EXECUTE'
    AND acl.grantor = routine.proowner;

  IF direct_count <> 4
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', function_oid, 'EXECUTE WITH GRANT OPTION'
     ) THEN
    RAISE EXCEPTION 'direct ACL/grant-option fixture escaped detection';
  END IF;
END;
$direct_acl_drift_detected$;
ROLLBACK TO SAVEPOINT direct_acl_drift;

SAVEPOINT inherited_acl_drift;
CREATE ROLE trigger_only_acl_regression_parent NOLOGIN;
GRANT EXECUTE ON FUNCTION public.block_currency_exchange_items()
  TO trigger_only_acl_regression_parent WITH GRANT OPTION;
GRANT trigger_only_acl_regression_parent TO authenticated;
DO $inherited_acl_drift_detected$
DECLARE
  function_oid oid :=
    'public.block_currency_exchange_items()'::pg_catalog.regprocedure;
  inherited_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
  INTO inherited_count
  FROM pg_catalog.pg_proc AS routine
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      routine.proacl,
      pg_catalog.acldefault('f', routine.proowner)
    )
  ) AS acl
  WHERE routine.oid = function_oid
    AND acl.grantee <> 0
    AND acl.grantee <>
      pg_catalog.to_regrole('authenticated')::oid
    AND pg_catalog.pg_has_role(
      pg_catalog.to_regrole('authenticated'), acl.grantee, 'MEMBER'
    )
    AND acl.privilege_type = 'EXECUTE'
    AND acl.is_grantable;

  IF inherited_count <> 1
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', function_oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', function_oid, 'EXECUTE WITH GRANT OPTION'
     ) THEN
    RAISE EXCEPTION 'inherited ACL/grant-option fixture escaped detection';
  END IF;
END;
$inherited_acl_drift_detected$;
ROLLBACK TO SAVEPOINT inherited_acl_drift;

SAVEPOINT foreign_grantor_drift;
CREATE ROLE trigger_only_acl_regression_delegator NOLOGIN;
GRANT EXECUTE ON FUNCTION public.block_currency_exchange_items()
  TO trigger_only_acl_regression_delegator WITH GRANT OPTION;
SET LOCAL ROLE trigger_only_acl_regression_delegator;
GRANT EXECUTE ON FUNCTION public.block_currency_exchange_items()
  TO anon WITH GRANT OPTION;
RESET ROLE;
DO $foreign_grantor_drift_detected$
DECLARE
  function_oid oid :=
    'public.block_currency_exchange_items()'::pg_catalog.regprocedure;
  foreign_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
  INTO foreign_count
  FROM pg_catalog.pg_proc AS routine
  CROSS JOIN LATERAL pg_catalog.aclexplode(routine.proacl) AS acl
  WHERE routine.oid = function_oid
    AND acl.grantee = pg_catalog.to_regrole('anon')::oid
    AND acl.privilege_type = 'EXECUTE'
    AND acl.grantor <> routine.proowner
    AND acl.is_grantable;

  IF foreign_count <> 1 THEN
    RAISE EXCEPTION 'foreign ACL grantor fixture escaped detection';
  END IF;
END;
$foreign_grantor_drift_detected$;
ROLLBACK TO SAVEPOINT foreign_grantor_drift;

SAVEPOINT function_security_drift;
ALTER FUNCTION public.block_currency_exchange_items() SECURITY DEFINER;
ALTER FUNCTION public.block_currency_exchange_items() RESET ALL;
ALTER FUNCTION public.block_currency_exchange_items() SET search_path = public;
DO $function_security_drift_detected$
DECLARE
  drift_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
  INTO drift_count
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid =
      'public.block_currency_exchange_items()'::pg_catalog.regprocedure
    AND (
      routine.prosecdef
      OR routine.proconfig IS DISTINCT FROM
        ARRAY['search_path=pg_catalog']::text[]
    );
  IF drift_count <> 1 THEN
    RAISE EXCEPTION 'function security/search_path drift escaped detection';
  END IF;
END;
$function_security_drift_detected$;
ROLLBACK TO SAVEPOINT function_security_drift;

SAVEPOINT function_body_drift;
CREATE OR REPLACE FUNCTION public.block_currency_exchange_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RETURN NEW;
END;
$$;
DO $function_body_drift_detected$
DECLARE
  normalized_body text;
BEGIN
  SELECT pg_catalog.btrim(pg_catalog.regexp_replace(
           routine.prosrc, '[[:space:]]+', ' ', 'g'
         ))
  INTO normalized_body
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid =
    'public.block_currency_exchange_items()'::pg_catalog.regprocedure;

  IF normalized_body =
    'BEGIN IF NEW.category = ''currency_exchange'' THEN RAISE EXCEPTION ''category_not_allowed'' USING HINT = ''Currency exchange listings are not permitted.''; END IF; RETURN NEW; END;'
  THEN
    RAISE EXCEPTION 'function business-body drift escaped detection';
  END IF;
END;
$function_body_drift_detected$;
ROLLBACK TO SAVEPOINT function_body_drift;

SAVEPOINT trigger_contract_drift;
ALTER TABLE public.items DISABLE TRIGGER trg_block_currency_exchange;
DO $trigger_contract_drift_detected$
DECLARE
  mismatch_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
  INTO mismatch_count
  FROM pg_catalog.pg_trigger AS trigger_row
  WHERE trigger_row.tgrelid = 'public.items'::pg_catalog.regclass
    AND trigger_row.tgname = 'trg_block_currency_exchange'
    AND NOT trigger_row.tgisinternal
    AND (
      trigger_row.tgenabled <> 'O'
      OR trigger_row.tgtype <> 23
      OR trigger_row.tgnargs <> 0
      OR trigger_row.tgqual IS NOT NULL
    );
  IF mismatch_count <> 1 THEN
    RAISE EXCEPTION 'trigger enable/event contract drift escaped detection';
  END IF;
END;
$trigger_contract_drift_detected$;
ROLLBACK TO SAVEPOINT trigger_contract_drift;

SAVEPOINT overload_drift;
CREATE FUNCTION public.block_currency_exchange_items(integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
RETURN $1;
DO $overload_drift_detected$
DECLARE
  overload_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
  INTO overload_count
  FROM pg_catalog.pg_proc AS routine
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname = 'public'
    AND routine.proname = 'block_currency_exchange_items';
  IF overload_count <> 2 THEN
    RAISE EXCEPTION 'function overload drift escaped detection';
  END IF;
END;
$overload_drift_detected$;
ROLLBACK TO SAVEPOINT overload_drift;

ROLLBACK;
