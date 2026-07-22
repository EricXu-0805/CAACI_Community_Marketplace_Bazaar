-- Read-only structural verification for
-- 20260717143223_harden_saved_search_boundaries.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  actual_count integer;
  constraint_expression text;
  matcher_oid oid;
BEGIN
  SELECT pg_catalog.count(*) INTO actual_count
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.saved_searches'::pg_catalog.regclass
    AND constraint_row.conname IN (
      'saved_searches_price_min_nonnegative',
      'saved_searches_price_max_nonnegative'
    );
  IF actual_count <> 2 THEN
    RAISE EXCEPTION 'verify_failed: expected exactly two named saved-search price constraints';
  END IF;

  SELECT pg_catalog.regexp_replace(
    pg_catalog.replace(
      pg_catalog.lower(
        pg_catalog.pg_get_expr(constraint_row.conbin, constraint_row.conrelid)
      ),
      '::numeric',
      ''
    ),
    '[[:space:]()]',
    '',
    'g'
  ) INTO constraint_expression
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.saved_searches'::pg_catalog.regclass
    AND constraint_row.conname = 'saved_searches_price_min_nonnegative'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;
  IF constraint_expression IS DISTINCT FROM 'price_minisnullorprice_min>=0' THEN
    RAISE EXCEPTION 'verify_failed: price_min constraint semantics/validation';
  END IF;

  SELECT pg_catalog.regexp_replace(
    pg_catalog.replace(
      pg_catalog.lower(
        pg_catalog.pg_get_expr(constraint_row.conbin, constraint_row.conrelid)
      ),
      '::numeric',
      ''
    ),
    '[[:space:]()]',
    '',
    'g'
  ) INTO constraint_expression
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.saved_searches'::pg_catalog.regclass
    AND constraint_row.conname = 'saved_searches_price_max_nonnegative'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;
  IF constraint_expression IS DISTINCT FROM 'price_maxisnullorprice_max>=0' THEN
    RAISE EXCEPTION 'verify_failed: price_max constraint semantics/validation';
  END IF;

  SELECT function.oid INTO matcher_oid
  FROM pg_catalog.pg_proc AS function
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = function.pronamespace
  WHERE namespace.nspname = 'public'
    AND function.proname = 'notify_saved_search_matches'
    AND function.pronargs = 0
    AND function.prorettype = 'trigger'::pg_catalog.regtype;

  SELECT pg_catalog.count(*) INTO actual_count
  FROM pg_catalog.pg_proc AS function
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = function.pronamespace
  WHERE namespace.nspname = 'public'
    AND function.proname = 'notify_saved_search_matches';

  IF actual_count <> 1 OR matcher_oid IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = matcher_oid
      AND function.prosecdef
      AND COALESCE(function.proconfig, ARRAY[]::text[])
        @> ARRAY['search_path=""']::text[]
      AND pg_catalog.strpos(
        pg_catalog.lower(function.prosrc),
        'pg_catalog.strpos'
      ) > 0
      AND pg_catalog.lower(function.prosrc) !~ '\m(like|ilike)\M'
  ) THEN
    RAISE EXCEPTION 'verify_failed: saved-search matcher identity/security/search_path/body';
  END IF;

  IF pg_catalog.has_function_privilege('anon', matcher_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', matcher_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', matcher_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.aclexplode(
         COALESCE(
           (SELECT function.proacl FROM pg_catalog.pg_proc AS function WHERE function.oid = matcher_oid),
           pg_catalog.acldefault(
             'f',
             (SELECT function.proowner FROM pg_catalog.pg_proc AS function WHERE function.oid = matcher_oid)
           )
         )
       ) AS acl
       WHERE acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: saved-search trigger function is directly callable';
  END IF;

  SELECT pg_catalog.count(*) INTO actual_count
  FROM pg_catalog.pg_trigger AS trigger
  WHERE NOT trigger.tgisinternal
    AND trigger.tgfoid = matcher_oid;
  IF actual_count <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE NOT trigger.tgisinternal
      AND trigger.tgfoid = matcher_oid
      AND namespace.nspname = 'public'
      AND relation.relname = 'items'
      AND trigger.tgname = 'trg_notify_saved_search_matches'
      AND trigger.tgenabled = 'O'
      AND trigger.tgtype = 5
  ) THEN
    RAISE EXCEPTION 'verify_failed: saved-search matcher trigger identity/timing';
  END IF;
END
$verify$;

SELECT
  conname AS constraint_name,
  convalidated AS is_validated,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.saved_searches'::regclass
  AND conname IN (
    'saved_searches_price_min_nonnegative',
    'saved_searches_price_max_nonnegative'
  )
ORDER BY conname;

SELECT
  p.proname,
  p.prosecdef AS is_security_definer,
  p.proconfig,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    WHERE acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) AS public_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'notify_saved_search_matches'
  AND p.pronargs = 0;

SELECT
  t.tgname,
  t.tgenabled,
  pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger AS t
WHERE t.tgrelid = 'public.items'::regclass
  AND t.tgname = 'trg_notify_saved_search_matches'
  AND NOT t.tgisinternal;

ROLLBACK;
