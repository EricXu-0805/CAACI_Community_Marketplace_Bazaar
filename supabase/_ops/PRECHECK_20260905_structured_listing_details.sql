\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $precheck$
BEGIN
  IF to_regclass('public.items') IS NULL OR to_regclass('public.profiles') IS NULL
    OR to_regprocedure('private.assert_text_boundary(text,text,integer,integer,integer,boolean)') IS NULL
    OR to_regprocedure('private.assert_moderated_text(text,text)') IS NULL
    OR to_regprocedure('public.search_items_fuzzy(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Required listing/search/moderation prerequisites missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.items'::regclass) THEN
    RAISE EXCEPTION 'Items RLS must be enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='items' AND column_name='listing_details' AND data_type <> 'jsonb') THEN
    RAISE EXCEPTION 'Conflicting listing_details column';
  END IF;
END;
$precheck$;
ROLLBACK;
