-- Run after 20260717143200_fix_moderation_status_enum_guard.sql.
-- Read-only structural checks; behavioral coverage lives in the isolated
-- regression script below so production rows are never mutated for QA.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  guard_oid oid;
  actual_count integer;
BEGIN
  SELECT function.oid INTO guard_oid
  FROM pg_catalog.pg_proc AS function
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = function.pronamespace
  WHERE namespace.nspname = 'public'
    AND function.proname = 'guard_moderation_status'
    AND function.pronargs = 0
    AND function.prorettype = 'trigger'::pg_catalog.regtype;

  SELECT pg_catalog.count(*) INTO actual_count
  FROM pg_catalog.pg_proc AS function
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = function.pronamespace
  WHERE namespace.nspname = 'public'
    AND function.proname = 'guard_moderation_status';

  IF actual_count <> 1 OR guard_oid IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = guard_oid
      AND NOT function.prosecdef
      AND COALESCE(function.proconfig, ARRAY[]::text[])
        @> ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION 'verify_failed: guard_moderation_status identity/security/search_path';
  END IF;

  IF pg_catalog.has_function_privilege('anon', guard_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', guard_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', guard_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.aclexplode(
         COALESCE(
           (SELECT function.proacl FROM pg_catalog.pg_proc AS function WHERE function.oid = guard_oid),
           pg_catalog.acldefault(
             'f',
             (SELECT function.proowner FROM pg_catalog.pg_proc AS function WHERE function.oid = guard_oid)
           )
         )
       ) AS acl
       WHERE acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: guard_moderation_status is directly callable';
  END IF;

  SELECT pg_catalog.count(*) INTO actual_count
  FROM pg_catalog.pg_trigger AS trigger
  WHERE NOT trigger.tgisinternal
    AND trigger.tgfoid = guard_oid;

  IF actual_count <> 2 OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE NOT trigger.tgisinternal
      AND trigger.tgfoid = guard_oid
      AND NOT (
        namespace.nspname = 'public'
        AND relation.relname IN ('items', 'posts')
        AND trigger.tgname = 'guard_moderation_status'
        AND trigger.tgenabled = 'O'
        AND trigger.tgtype = 19
      )
  ) OR EXISTS (
    SELECT expected.table_name
    FROM (VALUES ('items'), ('posts')) AS expected(table_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger
      JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE NOT trigger.tgisinternal
        AND trigger.tgfoid = guard_oid
        AND namespace.nspname = 'public'
        AND relation.relname = expected.table_name
        AND trigger.tgname = 'guard_moderation_status'
        AND trigger.tgenabled = 'O'
        AND trigger.tgtype = 19
    )
  ) THEN
    RAISE EXCEPTION 'verify_failed: expected one enabled BEFORE UPDATE moderation guard on items and posts';
  END IF;

  SELECT pg_catalog.count(*) INTO actual_count
  FROM pg_catalog.pg_proc AS function
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = function.pronamespace
  WHERE namespace.nspname = 'public'
    AND function.proname = 'content_moderation_normalize';

  IF actual_count <> 1
     OR pg_catalog.to_regprocedure('public.content_moderation_normalize(text)') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS function
       WHERE function.oid =
         'public.content_moderation_normalize(text)'::pg_catalog.regprocedure
         AND NOT function.prosecdef
         AND COALESCE(function.proconfig, ARRAY[]::text[])
           @> ARRAY['search_path=pg_catalog']::text[]
     ) THEN
    RAISE EXCEPTION 'verify_failed: content_moderation_normalize identity/security/search_path';
  END IF;
END
$verify$;

SELECT
  p.proname,
  p.prosecdef,
  p.proconfig,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'guard_moderation_status';

SELECT
  c.relname AS table_name,
  t.tgname,
  pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('items', 'posts')
  AND t.tgname = 'guard_moderation_status'
  AND NOT t.tgisinternal
ORDER BY c.relname;

ROLLBACK;
