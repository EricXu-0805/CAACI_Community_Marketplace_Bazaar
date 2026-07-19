-- =============================================================================
-- Bind suspension appeals to both the initiating account and the exact row.
--
-- The historical submit_appeal(text) selected whichever unappealed suspension
-- was newest and then updated it in a separate statement. A session switch
-- could therefore execute account A's text as account B, while concurrent
-- submissions could overwrite the same appeal. The replacement performs one
-- conditional UPDATE and accepts the suspension id shown to the user.
--
-- Eligibility intentionally preserves the existing lifted_at-only rule. The
-- product copy also mentions expiry/7-day concepts, but changing that policy is
-- a separate product/legal decision and is not smuggled into this integrity fix.
-- =============================================================================

DO $migration_precheck$
BEGIN
  IF pg_catalog.to_regclass('public.suspensions') IS NULL THEN
    RAISE EXCEPTION 'migration_precheck_failed: missing public.suspensions';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('id', 'uuid'),
      ('profile_id', 'uuid'),
      ('lifted_at', 'timestamp with time zone'),
      ('appeal_note', 'text'),
      ('created_at', 'timestamp with time zone')
    ) AS required(column_name, formatted_type)
    LEFT JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = 'public.suspensions'::pg_catalog.regclass
     AND attribute.attname = required.column_name
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    WHERE attribute.attname IS NULL
       OR pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
          <> required.formatted_type
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: suspension appeal columns missing or wrong type';
  END IF;

  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'migration_precheck_failed: missing auth.uid()';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS required(role_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = required.role_name
    )
  ) THEN
    RAISE EXCEPTION 'migration_precheck_failed: required API role is missing';
  END IF;
END
$migration_precheck$;

-- Keep the historical signature callable while old and new app bundles may
-- coexist.  It cannot express an exact row or page-captured account intent, so
-- it is intentionally conservative: derive the account only from auth.uid(),
-- target the caller's newest active suspension (whether or not it already has
-- an appeal), and perform a conditional single-statement update.  Concurrent
-- or delayed retries therefore cannot overwrite the first appeal or fall back
-- to an older row.  Retire this overload only in a future migration after
-- expected-account/exact-suspension client adoption is proven.
CREATE OR REPLACE FUNCTION public.submit_appeal(note_in text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  cleaned_note text;
  updated_suspension_id uuid;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  cleaned_note := pg_catalog.btrim(COALESCE(note_in, ''));
  IF pg_catalog.length(cleaned_note) < 10
     OR pg_catalog.length(cleaned_note) > 2000 THEN
    RAISE EXCEPTION 'invalid_appeal_length' USING ERRCODE = '22023';
  END IF;

  UPDATE public.suspensions AS suspension
  SET appeal_note = cleaned_note
  WHERE suspension.id = (
    SELECT newest_suspension.id
    FROM public.suspensions AS newest_suspension
    WHERE newest_suspension.profile_id = caller_id
      AND newest_suspension.lifted_at IS NULL
    ORDER BY newest_suspension.created_at DESC, newest_suspension.id DESC
    LIMIT 1
  )
    AND suspension.profile_id = caller_id
    AND suspension.lifted_at IS NULL
    AND suspension.appeal_note IS NULL
  RETURNING suspension.id INTO updated_suspension_id;

  IF updated_suspension_id IS NULL THEN
    RAISE EXCEPTION 'appeal_unavailable' USING ERRCODE = '55000';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.submit_appeal(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_appeal(text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_appeal(
  note_in text,
  expected_user_id_in uuid,
  expected_suspension_id_in uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  cleaned_note text;
  updated_suspension_id uuid;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM caller_id THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;

  cleaned_note := pg_catalog.btrim(COALESCE(note_in, ''));
  IF pg_catalog.length(cleaned_note) < 10
     OR pg_catalog.length(cleaned_note) > 2000 THEN
    RAISE EXCEPTION 'invalid_appeal_length' USING ERRCODE = '22023';
  END IF;

  -- One statement is the ownership, target-selection, active-state, and
  -- first-writer-wins boundary. Under concurrent UPDATEs PostgreSQL waits for
  -- the winner and rechecks appeal_note IS NULL, so the loser returns zero
  -- rows instead of overwriting the committed appeal.
  UPDATE public.suspensions AS suspension
  SET appeal_note = cleaned_note
  WHERE suspension.id = expected_suspension_id_in
    AND suspension.profile_id = caller_id
    AND suspension.lifted_at IS NULL
    AND suspension.appeal_note IS NULL
  RETURNING suspension.id INTO updated_suspension_id;

  IF updated_suspension_id IS NULL THEN
    -- Deliberately collapse missing, wrong-owner, lifted, and already-appealed
    -- rows into one stable result so the RPC is not a suspension-row oracle.
    RAISE EXCEPTION 'appeal_unavailable' USING ERRCODE = '55000';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.submit_appeal(text, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_appeal(text, uuid, uuid)
  TO authenticated;

DO $migration_acl_gate$
DECLARE
  intent_rpc oid := pg_catalog.to_regprocedure(
    'public.submit_appeal(text,uuid,uuid)'
  );
  legacy_rpc oid := pg_catalog.to_regprocedure('public.submit_appeal(text)');
BEGIN
  IF intent_rpc IS NULL
     OR NOT pg_catalog.has_function_privilege('authenticated', intent_rpc, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', intent_rpc, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', intent_rpc, 'EXECUTE') THEN
    RAISE EXCEPTION 'submit appeal boundary drift: intent RPC ACL mismatch';
  END IF;

  IF legacy_rpc IS NULL
     OR NOT pg_catalog.has_function_privilege('authenticated', legacy_rpc, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', legacy_rpc, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', legacy_rpc, 'EXECUTE') THEN
    RAISE EXCEPTION 'submit appeal boundary drift: legacy RPC ACL mismatch';
  END IF;
END
$migration_acl_gate$;

NOTIFY pgrst, 'reload schema';
