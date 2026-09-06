\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $verify$
DECLARE fn oid; src text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.search_items_fuzzy'::regproc::oid,'public.search_items_fuzzy_v2'::regproc::oid] LOOP
    src:=pg_get_functiondef(fn);
    IF (SELECT prosecdef FROM pg_proc WHERE oid=fn)
      OR src NOT LIKE '%cardinality(terms_in)>12%'
      OR src NOT LIKE '%invalid_search_terms%'
      OR src NOT LIKE '%field(value, is_title)%'
      OR src NOT LIKE '%ANY(terms_in)%'
      OR src NOT LIKE '%i.id DESC%'
      OR NOT has_function_privilege('anon',fn,'EXECUTE')
      OR NOT has_function_privilege('authenticated',fn,'EXECUTE') THEN
      RAISE EXCEPTION 'bounded_search_definition_or_privilege_drift';
    END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.items'::regclass) THEN
    RAISE EXCEPTION 'items_rls_disabled';
  END IF;
END;
$verify$;
ROLLBACK;
