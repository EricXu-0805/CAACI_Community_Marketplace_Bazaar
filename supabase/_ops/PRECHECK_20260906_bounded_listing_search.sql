\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $precheck$
BEGIN
  IF to_regprocedure('public.search_items_fuzzy_v2(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean,date,text)') IS NULL
    OR to_regprocedure('public.search_items_fuzzy(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'apply_structured_listing_details_first';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid IN ('public.search_items_fuzzy'::regproc,'public.search_items_fuzzy_v2'::regproc) AND prosecdef)
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.items'::regclass) THEN
    RAISE EXCEPTION 'search_security_boundary_drift';
  END IF;
END;
$precheck$;
ROLLBACK;
