-- Read-only preflight for
-- 20260719174928_reconcile_trigger_only_function_acl.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;

DO $precheck$
DECLARE
  function_oid oid;
  function_count integer;
  function_definition record;
  items_oid oid;
  category_attnum smallint;
  trigger_count integer;
  foreign_grantor_count integer;
  inherited_count integer;
  owner_membership_count integer;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION 'precheck_failed: PostgreSQL 16 or newer is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS required(role_name)
    WHERE pg_catalog.to_regrole(required.role_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'precheck_failed: API role missing';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO function_count
  FROM pg_catalog.pg_proc AS routine
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname = 'public'
    AND routine.proname = 'block_currency_exchange_items';

  SELECT routine.oid
  INTO function_oid
  FROM pg_catalog.pg_proc AS routine
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname = 'public'
    AND routine.proname = 'block_currency_exchange_items'
    AND routine.prokind = 'f'
    AND routine.pronargs = 0
    AND routine.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype;

  IF function_count <> 1 OR function_oid IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: trigger-only function identity drift';
  END IF;

  SELECT
    routine.prokind,
    routine.pronargs,
    routine.pronargdefaults,
    routine.prorettype,
    routine.proretset,
    language.lanname,
    routine.provolatile,
    routine.proparallel,
    routine.proisstrict,
    routine.proleakproof,
    routine.prosrc,
    routine.proowner
  INTO STRICT function_definition
  FROM pg_catalog.pg_proc AS routine
  JOIN pg_catalog.pg_language AS language ON language.oid = routine.prolang
  WHERE routine.oid = function_oid;

  IF function_definition.prokind IS DISTINCT FROM 'f'::"char"
     OR function_definition.pronargs IS DISTINCT FROM 0::smallint
     OR function_definition.pronargdefaults IS DISTINCT FROM 0::smallint
     OR function_definition.prorettype IS DISTINCT FROM
       'pg_catalog.trigger'::pg_catalog.regtype
     OR function_definition.proretset IS DISTINCT FROM false
     OR function_definition.lanname IS DISTINCT FROM 'plpgsql'
     OR function_definition.provolatile IS DISTINCT FROM 'v'::"char"
     OR function_definition.proparallel IS DISTINCT FROM 'u'::"char"
     OR function_definition.proisstrict IS DISTINCT FROM false
     OR function_definition.proleakproof IS DISTINCT FROM false
     OR pg_catalog.btrim(pg_catalog.regexp_replace(
          function_definition.prosrc, '[[:space:]]+', ' ', 'g'
        )) IS DISTINCT FROM
        'BEGIN IF NEW.category = ''currency_exchange'' THEN RAISE EXCEPTION ''category_not_allowed'' USING HINT = ''Currency exchange listings are not permitted.''; END IF; RETURN NEW; END;'
  THEN
    RAISE EXCEPTION 'precheck_failed: trigger-only function business contract drift';
  END IF;

  SELECT relation.oid
  INTO items_oid
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'items'
    AND relation.relkind = 'r';

  SELECT attribute.attnum
  INTO category_attnum
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = items_oid
    AND attribute.attname = 'category'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.atttypid = pg_catalog.to_regtype('public.item_category');

  IF items_oid IS NULL
     OR category_attnum IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_enum AS enum_value
       WHERE enum_value.enumtypid = pg_catalog.to_regtype('public.item_category')
         AND enum_value.enumlabel = 'currency_exchange'
     ) THEN
    RAISE EXCEPTION 'precheck_failed: items/category contract drift';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO trigger_count
  FROM pg_catalog.pg_trigger AS trigger_row
  WHERE NOT trigger_row.tgisinternal
    AND trigger_row.tgfoid = function_oid;

  IF trigger_count <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS trigger_row
       WHERE NOT trigger_row.tgisinternal
         AND trigger_row.tgfoid = function_oid
         AND trigger_row.tgrelid = items_oid
         AND trigger_row.tgname = 'trg_block_currency_exchange'
         AND trigger_row.tgenabled = 'O'
         AND trigger_row.tgtype = 23
         AND trigger_row.tgnargs = 0
         AND trigger_row.tgattr::text = category_attnum::text
         AND trigger_row.tgqual IS NULL
         AND trigger_row.tgconstraint = 0
         AND NOT trigger_row.tgdeferrable
         AND NOT trigger_row.tginitdeferred
         AND trigger_row.tgoldtable IS NULL
         AND trigger_row.tgnewtable IS NULL
         AND trigger_row.tgparentid = 0
     ) THEN
    RAISE EXCEPTION 'precheck_failed: exact currency block trigger contract drift';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO foreign_grantor_count
  FROM pg_catalog.pg_proc AS routine
  CROSS JOIN LATERAL pg_catalog.aclexplode(routine.proacl) AS acl
  WHERE routine.oid = function_oid
    AND (
      acl.grantee = 0
      OR acl.grantee IN (
        pg_catalog.to_regrole('anon')::oid,
        pg_catalog.to_regrole('authenticated')::oid,
        pg_catalog.to_regrole('service_role')::oid
      )
    )
    AND acl.grantor <> routine.proowner;

  IF foreign_grantor_count <> 0 THEN
    RAISE EXCEPTION 'precheck_failed: non-owner function ACL grantor count %',
      foreign_grantor_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO inherited_count
  FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
    AS api_role(role_name)
  CROSS JOIN pg_catalog.pg_proc AS routine
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      routine.proacl,
      pg_catalog.acldefault('f', routine.proowner)
    )
  ) AS acl
  WHERE routine.oid = function_oid
    AND acl.privilege_type = 'EXECUTE'
    AND acl.grantee <> 0
    AND acl.grantee <> pg_catalog.to_regrole(api_role.role_name)::oid
    AND pg_catalog.pg_has_role(
      pg_catalog.to_regrole(api_role.role_name), acl.grantee, 'MEMBER'
    );

  SELECT pg_catalog.count(*)::integer
  INTO owner_membership_count
  FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
    AS api_role(role_name)
  WHERE pg_catalog.pg_has_role(
    pg_catalog.to_regrole(api_role.role_name),
    function_definition.proowner,
    'MEMBER'
  );

  IF inherited_count <> 0 OR owner_membership_count <> 0 THEN
    RAISE EXCEPTION
      'precheck_failed: inherited/owner execution provenance counts %, %',
      inherited_count, owner_membership_count;
  END IF;
END;
$precheck$;

SELECT
  routine.oid::pg_catalog.regprocedure AS function_signature,
  routine.prosecdef AS security_definer,
  routine.proconfig,
  routine.proacl,
  pg_catalog.has_function_privilege(
    'anon', routine.oid, 'EXECUTE'
  ) AS anon_execute,
  pg_catalog.has_function_privilege(
    'authenticated', routine.oid, 'EXECUTE'
  ) AS authenticated_execute,
  pg_catalog.has_function_privilege(
    'service_role', routine.oid, 'EXECUTE'
  ) AS service_role_execute
FROM pg_catalog.pg_proc AS routine
WHERE routine.oid =
  'public.block_currency_exchange_items()'::pg_catalog.regprocedure;

SELECT
  trigger_row.tgname,
  trigger_row.tgenabled,
  trigger_row.tgtype,
  trigger_row.tgattr::text AS update_columns,
  pg_catalog.pg_get_triggerdef(trigger_row.oid) AS trigger_definition
FROM pg_catalog.pg_trigger AS trigger_row
WHERE NOT trigger_row.tgisinternal
  AND trigger_row.tgfoid =
    'public.block_currency_exchange_items()'::pg_catalog.regprocedure;

ROLLBACK;
