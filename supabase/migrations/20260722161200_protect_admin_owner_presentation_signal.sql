-- Preserve the final durable owner recovery signal at the table boundary.
--
-- 20260722145042 compares OLD/NEW.last_used_at when deciding whether an owner
-- remains recoverable, but its trigger column list did not fire for a direct
-- last_used_at-only update. Authorization only advances this value, yet a
-- privileged direct write could clear the final recoverable owner's signal
-- without invoking the guard. Extend the existing trigger to that column; do
-- not replace the already-reviewed guard function or its lock ordering.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

SELECT pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
SELECT pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
LOCK TABLE public.admin_tokens IN SHARE ROW EXCLUSIVE MODE;

DO $precheck$
DECLARE
  trigger_function_oid oid := pg_catalog.to_regprocedure(
    'public.admin_protect_recovery_tokens()'
  );
  trigger_source text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'admin_owner_presentation_signal_requires_postgres'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regclass('public.admin_tokens') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR trigger_function_oid IS NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_owner_token_recoverable(uuid,text,timestamptz,timestamptz,timestamptz,text,text)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'admin_owner_presentation_signal_prerequisite_missing'
      USING ERRCODE = '55000';
  END IF;

  SELECT routine.prosrc
    INTO trigger_source
    FROM pg_catalog.pg_proc AS routine
   WHERE routine.oid = trigger_function_oid
     AND routine.proowner = pg_catalog.to_regrole('postgres')::oid
     AND routine.prosecdef
     AND routine.provolatile = 'v'
     AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[];

  IF trigger_source IS NULL
     OR pg_catalog.strpos(
       trigger_source,
       'old_was_recoverable_owner AND NOT new_is_recoverable_owner'
     ) = 0
     OR pg_catalog.strpos(
       trigger_source,
       'admin_owner_token_recoverable('
     ) = 0
     OR pg_catalog.strpos(
       trigger_source,
       'MESSAGE = ''last_active_owner_token'''
     ) = 0 THEN
    RAISE EXCEPTION
      'admin_owner_presentation_signal_guard_drifted'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid =
           'public.admin_tokens'::pg_catalog.regclass
       AND trigger_row.tgname = 'admin_tokens_protect_recovery'
       AND NOT trigger_row.tgisinternal
       AND trigger_row.tgenabled = 'O'
       AND trigger_row.tgfoid = trigger_function_oid
       AND trigger_row.tgtype = 27
       AND pg_catalog.pg_get_triggerdef(trigger_row.oid) ILIKE
           '%BEFORE DELETE OR UPDATE OF admin_id, revoked_at, expires_at, role ON public.admin_tokens%'
       AND pg_catalog.pg_get_triggerdef(trigger_row.oid) NOT ILIKE
           '%last_used_at%'
  ) THEN
    RAISE EXCEPTION
      'admin_owner_presentation_signal_trigger_baseline_drifted'
      USING ERRCODE = '55000';
  END IF;
END;
$precheck$;

DROP TRIGGER admin_tokens_protect_recovery ON public.admin_tokens;
CREATE TRIGGER admin_tokens_protect_recovery
BEFORE UPDATE OF admin_id, revoked_at, expires_at, last_used_at, role OR DELETE
ON public.admin_tokens
FOR EACH ROW
EXECUTE FUNCTION public.admin_protect_recovery_tokens();

COMMENT ON FUNCTION public.admin_protect_recovery_tokens() IS
  'Table-boundary guard preserving the last identity-safe active owner issuer, including its last_used_at presentation signal, and the stronger durable owner recovery horizon.';

COMMIT;
