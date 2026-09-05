-- Read-only catalog verification after staging/production applies the candidate.
-- Run before deploying the paired frontend; no customer data is changed.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $verify$
DECLARE fn oid; source text;
BEGIN
  fn := pg_catalog.to_regprocedure('public.search_items_fuzzy(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean)');
  IF fn IS NULL THEN RAISE EXCEPTION 'Search RPC signature missing'; END IF;
  IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid=fn) THEN
    RAISE EXCEPTION 'Search RPC must remain SECURITY INVOKER';
  END IF;
  source := pg_catalog.pg_get_functiondef(fn);
  IF source NOT LIKE '%pickup_term%' OR source NOT LIKE '%伊利尼学生中心%'
    OR source NOT LIKE '%i.title_i18n%' OR source NOT LIKE '%i.id DESC%' THEN
    RAISE EXCEPTION 'Campus search candidate definition is not installed';
  END IF;
  IF NOT pg_catalog.has_function_privilege('anon',fn,'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated',fn,'EXECUTE') THEN
    RAISE EXCEPTION 'Expected public search execute privileges missing';
  END IF;
END;
$verify$;
-- Follow with synthetic UIUC / English spot / Chinese spot / non-campus
-- location searches, pagination, and forbidden-row checks on staging.
ROLLBACK;
