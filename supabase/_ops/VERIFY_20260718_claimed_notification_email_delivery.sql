-- Structural and ACL verification for shared notification-email claims.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  required_column text;
  signature text;
  function_config text[];
  function_source text;
  state_constraint text;
BEGIN
  FOREACH required_column IN ARRAY ARRAY[
    'email_delivery_kind',
    'email_delivery_key',
    'email_claim_token',
    'email_claimed_at',
    'email_claim_expires_at',
    'email_provider_attempted_at'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = 'public.notifications'::pg_catalog.regclass
        AND attribute.attname = required_column
        AND NOT attribute.attisdropped
    ) THEN
      RAISE EXCEPTION 'verify_failed: notifications.% missing', required_column;
    END IF;
    IF pg_catalog.has_column_privilege(
         'authenticated', 'public.notifications', required_column, 'UPDATE'
       ) THEN
      RAISE EXCEPTION 'verify_failed: authenticated can mutate %', required_column;
    END IF;
  END LOOP;

  SELECT pg_catalog.pg_get_constraintdef(constraint_entry.oid)
  INTO state_constraint
  FROM pg_catalog.pg_constraint AS constraint_entry
  WHERE constraint_entry.conrelid = 'public.notifications'::pg_catalog.regclass
    AND constraint_entry.conname = 'notifications_email_delivery_state_check'
    AND constraint_entry.contype = 'c'
    AND constraint_entry.convalidated;
  IF state_constraint IS NULL
     OR pg_catalog.strpos(state_constraint, '''immediate''') = 0
     OR pg_catalog.strpos(state_constraint, '''digest''') = 0
     OR pg_catalog.strpos(state_constraint, 'email_provider_attempted_at') = 0 THEN
    RAISE EXCEPTION 'verify_failed: delivery state constraint drifted';
  END IF;

  IF pg_catalog.to_regclass('public.notifications_email_delivery_key_idx') IS NULL
     OR pg_catalog.to_regclass('public.notifications_email_claim_expiry_idx') IS NULL THEN
    RAISE EXCEPTION 'verify_failed: delivery claim indexes missing';
  END IF;

  FOREACH signature IN ARRAY ARRAY[
    'public.claim_notification_email_delivery(uuid[],text,integer)',
    'public.renew_notification_email_delivery(uuid,text,integer)',
    'public.begin_notification_email_delivery(uuid,text,integer)',
    'public.complete_notification_email_delivery(uuid,text)',
    'public.release_notification_email_delivery(uuid,text)'
  ] LOOP
    IF pg_catalog.to_regprocedure(signature) IS NULL THEN
      RAISE EXCEPTION 'verify_failed: function missing: %', signature;
    END IF;
    SELECT routine.proconfig, pg_catalog.pg_get_functiondef(routine.oid)
    INTO function_config, function_source
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = pg_catalog.to_regprocedure(signature)
      AND routine.prosecdef;
    IF function_source IS NULL
       OR function_config IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
       OR pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'verify_failed: SECURITY DEFINER/ACL drifted: %', signature;
    END IF;
  END LOOP;

  SELECT pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.claim_notification_email_delivery(uuid[],text,integer)'
    )
  ) INTO function_source;
  IF pg_catalog.strpos(function_source, 'FOR UPDATE') = 0
     OR pg_catalog.strpos(function_source, 'email_provider_attempted_at') = 0
     OR pg_catalog.strpos(function_source, 'email_claim_expires_at') = 0
     OR pg_catalog.strpos(function_source, 'email_delivery_kind') = 0
     OR pg_catalog.strpos(function_source, 'email_delivery_key') = 0 THEN
    RAISE EXCEPTION 'verify_failed: atomic/sticky claim source drifted';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.release_notification_email_delivery(uuid,text)'
    )
  ) INTO function_source;
  IF pg_catalog.strpos(function_source, 'email_provider_attempted_at IS NULL') = 0
     OR pg_catalog.strpos(function_source, 'email_claim_token = NULL') = 0 THEN
    RAISE EXCEPTION 'verify_failed: safe release semantics drifted';
  END IF;
END
$verify$;

ROLLBACK;
