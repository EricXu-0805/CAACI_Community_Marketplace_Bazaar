\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $verify$
DECLARE fn oid; guard oid; src text;
BEGIN
  fn := to_regprocedure('public.search_items_fuzzy_v2(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean,date,text)');
  guard := to_regprocedure('private.guard_listing_details()');
  IF fn IS NULL OR guard IS NULL THEN RAISE EXCEPTION 'Category-aware functions missing'; END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid=fn) OR NOT (SELECT prosecdef FROM pg_proc WHERE oid=guard) THEN
    RAISE EXCEPTION 'Unexpected function security mode';
  END IF;
  IF has_function_privilege('anon',guard,'EXECUTE') OR has_function_privilege('authenticated',guard,'EXECUTE')
    OR has_function_privilege('service_role',guard,'EXECUTE') THEN RAISE EXCEPTION 'Private trigger exposed'; END IF;
  IF NOT has_function_privilege('anon',fn,'EXECUTE') OR NOT has_function_privilege('authenticated',fn,'EXECUTE')
    OR NOT has_column_privilege('anon','public.items','listing_details','SELECT')
    OR NOT has_column_privilege('authenticated','public.items','listing_details','INSERT')
    OR NOT has_column_privilege('authenticated','public.items','listing_details','UPDATE') THEN
    RAISE EXCEPTION 'Expected category field privileges missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.items'::regclass AND tgname='guard_listing_details' AND tgenabled='O')
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.items'::regclass)
    OR to_regclass('public.items_housing_dates_idx') IS NULL OR to_regclass('public.items_rideshare_date_idx') IS NULL THEN
    RAISE EXCEPTION 'Listing guard, RLS or date indexes missing';
  END IF;
  src := pg_get_functiondef(fn);
  IF src NOT LIKE '%detail_date_in%' OR src NOT LIKE '%price_unit_in%' OR src NOT LIKE '%i.listing_details%' OR src NOT LIKE '%i.id DESC%' THEN
    RAISE EXCEPTION 'Versioned search definition mismatch';
  END IF;
  IF private.valid_listing_details('housing','{"kind":"housing","available_from":"2026-09-05","available_to":"2026-09-30","price_unit":"month","room_type":"private"}'::jsonb) IS NOT TRUE
    OR private.valid_listing_details('housing','{"kind":"housing","available_from":"2026-02-30","available_to":"2026-09-30","price_unit":"month","room_type":"private"}'::jsonb) IS NOT FALSE THEN
    RAISE EXCEPTION 'Category validation contract mismatch';
  END IF;
END;
$verify$;
-- Follow with synthetic authenticated create/edit/search and cross-account denial.
ROLLBACK;
