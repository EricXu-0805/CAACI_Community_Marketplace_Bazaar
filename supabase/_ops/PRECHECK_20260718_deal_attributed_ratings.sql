-- Read-only preflight for 20260718210000_deal_attributed_ratings.sql.
-- Run before staging/production migration with psql -X -v ON_ERROR_STOP=1.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  required_relation text;
  required_function text;
  offers_status_definition text;
BEGIN
  FOREACH required_relation IN ARRAY ARRAY[
    'public.items',
    'public.profiles',
    'public.conversations',
    'public.offers',
    'public.ratings',
    'public.notifications'
  ] LOOP
    IF pg_catalog.to_regclass(required_relation) IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: missing relation %', required_relation;
    END IF;
  END LOOP;

  FOREACH required_function IN ARRAY ARRAY[
    'auth.uid()',
    'public.guard_item_lifecycle_boundaries()',
    'public.notify_item_sold()',
    'public.recompute_profile_rating(uuid)'
  ] LOOP
    IF pg_catalog.to_regprocedure(required_function) IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: missing function %', required_function;
    END IF;
  END LOOP;

  IF pg_catalog.to_regnamespace('private') IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: private schema missing';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(offer_constraint.oid)
    INTO offers_status_definition
  FROM pg_catalog.pg_constraint AS offer_constraint
  WHERE offer_constraint.conrelid = 'public.offers'::pg_catalog.regclass
    AND offer_constraint.conname = 'offers_status_check'
    AND offer_constraint.contype = 'c'
    AND offer_constraint.convalidated;

  IF offers_status_definition IS NULL
     OR pg_catalog.strpos(offers_status_definition, '''pending''') = 0
     OR pg_catalog.strpos(offers_status_definition, '''accepted''') = 0
     OR pg_catalog.strpos(offers_status_definition, '''expired''') = 0 THEN
    RAISE EXCEPTION 'precheck_failed: offers status constraint drift';
  END IF;

  IF pg_catalog.to_regclass('private.item_deals') IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.get_item_sale_candidates(uuid,uuid)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.mark_item_sold(uuid,uuid,uuid)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.get_transaction_rating_eligibility(uuid,uuid)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.submit_transaction_rating(uuid,uuid,integer,text,uuid)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'precheck_failed: deal attribution objects already exist';
  END IF;

  IF NOT pg_catalog.has_column_privilege(
       'authenticated', 'public.items', 'status', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'precheck_failed: reserved lifecycle status grant missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS rating_policy
    WHERE rating_policy.schemaname = 'public'
      AND rating_policy.tablename = 'ratings'
      AND rating_policy.policyname = 'Participants can rate sold items'
      AND rating_policy.cmd = 'INSERT'
  ) THEN
    RAISE EXCEPTION 'precheck_failed: historical ratings insert policy drift';
  END IF;
END
$precheck$;

ROLLBACK;
