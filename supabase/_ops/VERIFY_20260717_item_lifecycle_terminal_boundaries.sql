-- Run after 20260717145701_enforce_item_lifecycle_terminal_boundaries.sql.
-- Read-only structural verification; it does not inspect or mutate user rows.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  function_oid oid;
  trigger_count integer;
  trigger_definition text;
BEGIN
  SELECT p.oid
  INTO function_oid
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'guard_item_lifecycle_boundaries'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) = '';

  IF function_oid IS NULL THEN
    RAISE EXCEPTION 'guard_item_lifecycle_boundaries() is missing';
  END IF;

  IF (SELECT p.prosecdef FROM pg_catalog.pg_proc AS p WHERE p.oid = function_oid) THEN
    RAISE EXCEPTION 'guard_item_lifecycle_boundaries() must remain SECURITY INVOKER';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p,
         unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS setting
    WHERE p.oid = function_oid
      AND setting = 'search_path=pg_catalog'
  ) THEN
    RAISE EXCEPTION 'guard_item_lifecycle_boundaries() search_path is not pinned';
  END IF;

  IF pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'client roles must not execute the trigger function directly';
  END IF;

  SELECT count(*)
  INTO trigger_count
  FROM pg_catalog.pg_trigger AS t
  JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'items'
    AND NOT t.tgisinternal
    AND t.tgfoid = function_oid
    AND t.tgname IN (
      'item_lifecycle_guard_update',
      'item_lifecycle_guard_delete'
    )
    AND t.tgenabled = 'O';

  IF trigger_count <> 2 THEN
    RAISE EXCEPTION 'expected two enabled item lifecycle triggers, found %', trigger_count;
  END IF;

  SELECT pg_catalog.pg_get_triggerdef(t.oid)
  INTO trigger_definition
  FROM pg_catalog.pg_trigger AS t
  JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'items'
    AND t.tgname = 'item_lifecycle_guard_update'
    AND NOT t.tgisinternal;

  IF trigger_definition IS NULL
     OR trigger_definition NOT ILIKE '%BEFORE UPDATE ON public.items%'
     OR trigger_definition ILIKE '%BEFORE UPDATE OF %' THEN
    RAISE EXCEPTION 'item lifecycle update trigger has an unexpected definition: %',
      trigger_definition;
  END IF;

  SELECT pg_catalog.pg_get_triggerdef(t.oid)
  INTO trigger_definition
  FROM pg_catalog.pg_trigger AS t
  JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'items'
    AND t.tgname = 'item_lifecycle_guard_delete'
    AND NOT t.tgisinternal;

  IF trigger_definition IS NULL
     OR trigger_definition NOT ILIKE '%BEFORE DELETE ON public.items%' THEN
    RAISE EXCEPTION 'item lifecycle delete trigger has an unexpected definition: %',
      trigger_definition;
  END IF;
END
$verify$;

SELECT
  p.proname,
  p.prosecdef,
  p.proconfig,
  pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AS authenticated_execute
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'guard_item_lifecycle_boundaries';

SELECT
  t.tgname,
  t.tgenabled,
  pg_catalog.pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_catalog.pg_trigger AS t
JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'items'
  AND t.tgname IN ('item_lifecycle_guard_update', 'item_lifecycle_guard_delete')
  AND NOT t.tgisinternal
ORDER BY t.tgname;

ROLLBACK;
