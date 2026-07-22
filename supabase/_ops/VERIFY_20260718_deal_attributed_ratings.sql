-- Structural/ACL verification for authoritative deal attribution and ratings.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  deal_acl text;
  status_definition text;
  function_signature text;
  function_source text;
BEGIN
  IF pg_catalog.to_regclass('private.item_deals') IS NULL THEN
    RAISE EXCEPTION 'verify_failed: private.item_deals missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS deal_table
    WHERE deal_table.oid = 'private.item_deals'::pg_catalog.regclass
      AND deal_table.relrowsecurity
      AND deal_table.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'verify_failed: private.item_deals RLS/FORCE RLS missing';
  END IF;

  SELECT pg_catalog.array_to_string(deal_table.relacl, ',')
    INTO deal_acl
  FROM pg_catalog.pg_class AS deal_table
  WHERE deal_table.oid = 'private.item_deals'::pg_catalog.regclass;
  IF COALESCE(deal_acl, '') ~ '(anon|authenticated|service_role)=' THEN
    RAISE EXCEPTION 'verify_failed: private deal table has API-role ACL';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS deal_constraint
    WHERE deal_constraint.conrelid = 'private.item_deals'::pg_catalog.regclass
      AND deal_constraint.contype = 'p'
      AND deal_constraint.convalidated
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS deal_constraint
    WHERE deal_constraint.conrelid = 'private.item_deals'::pg_catalog.regclass
      AND deal_constraint.contype = 'u'
      AND deal_constraint.convalidated
      AND pg_catalog.pg_get_constraintdef(deal_constraint.oid) LIKE '%offer_id%'
  ) THEN
    RAISE EXCEPTION 'verify_failed: one-deal/one-offer uniqueness missing';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_constraint AS deal_fk
    WHERE deal_fk.conrelid = 'private.item_deals'::pg_catalog.regclass
      AND deal_fk.contype = 'f'
      AND deal_fk.convalidated
  ) <> 5 THEN
    RAISE EXCEPTION 'verify_failed: private deal FK count drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS item_fk
    WHERE item_fk.conrelid = 'private.item_deals'::pg_catalog.regclass
      AND item_fk.contype = 'f'
      AND item_fk.confrelid = 'public.items'::pg_catalog.regclass
      AND item_fk.confdeltype = 'c'
  ) OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_constraint AS privacy_fk
    WHERE privacy_fk.conrelid = 'private.item_deals'::pg_catalog.regclass
      AND privacy_fk.contype = 'f'
      AND privacy_fk.confdeltype = 'n'
  ) <> 4 THEN
    RAISE EXCEPTION 'verify_failed: deal account-deletion FK semantics drifted';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(offer_constraint.oid)
    INTO status_definition
  FROM pg_catalog.pg_constraint AS offer_constraint
  WHERE offer_constraint.conrelid = 'public.offers'::pg_catalog.regclass
    AND offer_constraint.conname = 'offers_status_check'
    AND offer_constraint.contype = 'c'
    AND offer_constraint.convalidated;
  IF status_definition IS NULL
     OR pg_catalog.strpos(status_definition, '''cancelled''') = 0 THEN
    RAISE EXCEPTION 'verify_failed: cancelled offer terminal state missing';
  END IF;

  FOREACH function_signature IN ARRAY ARRAY[
    'public.get_item_sale_candidates(uuid,uuid)',
    'public.mark_item_sold(uuid,uuid,uuid)',
    'public.get_transaction_rating_eligibility(uuid,uuid)',
    'public.submit_transaction_rating(uuid,uuid,integer,text,uuid)'
  ] LOOP
    IF pg_catalog.to_regprocedure(function_signature) IS NULL THEN
      RAISE EXCEPTION 'verify_failed: function missing: %', function_signature;
    END IF;
    IF pg_catalog.has_function_privilege('anon', function_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege(
         'service_role', function_signature, 'EXECUTE'
       )
       OR NOT pg_catalog.has_function_privilege(
         'authenticated', function_signature, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'verify_failed: function ACL drifted: %', function_signature;
    END IF;
  END LOOP;

  IF pg_catalog.has_table_privilege('anon', 'public.ratings', 'INSERT')
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.ratings', 'INSERT'
     ) OR pg_catalog.has_any_column_privilege(
       'anon', 'public.ratings', 'INSERT'
     ) OR pg_catalog.has_any_column_privilege(
       'authenticated', 'public.ratings', 'INSERT'
     ) OR pg_catalog.has_table_privilege(
       'anon', 'public.ratings', 'DELETE'
     ) OR pg_catalog.has_table_privilege(
       'authenticated', 'public.ratings', 'DELETE'
     ) OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policies AS rating_policy
       WHERE rating_policy.schemaname = 'public'
         AND rating_policy.tablename = 'ratings'
         AND rating_policy.cmd IN ('INSERT', 'DELETE')
     ) THEN
    RAISE EXCEPTION 'verify_failed: direct ratings mutation remains available';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS attribution_trigger
    WHERE attribution_trigger.tgrelid = 'public.items'::pg_catalog.regclass
      AND attribution_trigger.tgname = 'item_deal_attribution_guard'
      AND NOT attribution_trigger.tgisinternal
      AND attribution_trigger.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'verify_failed: direct sold attribution trigger missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.mark_item_sold(uuid,uuid,uuid)'::pg_catalog.regprocedure
  ) INTO function_source;
  IF pg_catalog.strpos(function_source, 'FOR UPDATE') = 0
     OR pg_catalog.strpos(function_source, 'accepted_offer_participants_invalid') = 0
     OR pg_catalog.strpos(function_source, 'status = ''cancelled''') = 0
     OR pg_catalog.strpos(function_source, 'private.item_deals') = 0 THEN
    RAISE EXCEPTION 'verify_failed: mark-sold integrity source drifted';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.submit_transaction_rating(uuid,uuid,integer,text,uuid)'::pg_catalog.regprocedure
  ) INTO function_source;
  IF pg_catalog.strpos(function_source, 'rating_not_permitted') = 0
     OR pg_catalog.strpos(function_source, 'rating_already_submitted') = 0
     OR pg_catalog.strpos(function_source, 'FOR UPDATE') = 0 THEN
    RAISE EXCEPTION 'verify_failed: rating integrity/idempotency source drifted';
  END IF;
END
$verify$;

ROLLBACK;
