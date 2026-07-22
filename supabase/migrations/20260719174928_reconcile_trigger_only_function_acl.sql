-- Forward-only repair for the currency-exchange trigger-only function.
--
-- The trigger itself is the intended enforcement boundary.  The function has
-- no direct API contract, so running it as SECURITY DEFINER with the default
-- PUBLIC EXECUTE grant is both unnecessary and unsafe.  Preserve the exact
-- business body and the exact BEFORE INSERT / UPDATE OF category trigger while
-- converging the function to SECURITY INVOKER, a pg_catalog-only search_path,
-- and no direct or inherited API-role execution path.

BEGIN;
SET LOCAL search_path = pg_catalog;

DO $guard$
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
    RAISE EXCEPTION 'trigger_only_acl_unsupported_postgres_version'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS required(role_name)
    WHERE pg_catalog.to_regrole(required.role_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'trigger_only_acl_api_role_missing'
      USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'trigger_only_acl_function_identity_drift'
      USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'trigger_only_acl_function_business_contract_drift'
      USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'trigger_only_acl_items_category_contract_drift'
      USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'trigger_only_acl_trigger_contract_drift'
      USING ERRCODE = '55000';
  END IF;

  -- Direct grants issued by the owner are repairable.  A different grantor
  -- or a parent-role grant cannot be removed by this narrow REVOKE safely.
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
    RAISE EXCEPTION 'trigger_only_acl_foreign_grantor_drift: %',
      foreign_grantor_count USING ERRCODE = '55000';
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
      'trigger_only_acl_inherited_or_owner_drift: inherited %, owner_membership %',
      inherited_count, owner_membership_count USING ERRCODE = '55000';
  END IF;
END;
$guard$;

ALTER FUNCTION public.block_currency_exchange_items() SECURITY INVOKER;
ALTER FUNCTION public.block_currency_exchange_items() RESET ALL;
ALTER FUNCTION public.block_currency_exchange_items()
  SET search_path = pg_catalog;
REVOKE ALL PRIVILEGES ON FUNCTION public.block_currency_exchange_items()
  FROM PUBLIC, anon, authenticated, service_role;

DO $postcondition$
DECLARE
  function_oid oid;
  function_count integer;
  function_definition record;
  items_oid oid;
  category_attnum smallint;
  trigger_count integer;
  direct_count integer;
  public_count integer;
  effective_count integer;
  inherited_count integer;
  owner_membership_count integer;
BEGIN
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
    RAISE EXCEPTION 'trigger_only_acl_postcondition_function_identity';
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
    routine.prosecdef,
    routine.proconfig,
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
     OR function_definition.prosecdef IS DISTINCT FROM false
     OR function_definition.proconfig IS DISTINCT FROM
       ARRAY['search_path=pg_catalog']::text[]
     OR pg_catalog.btrim(pg_catalog.regexp_replace(
          function_definition.prosrc, '[[:space:]]+', ' ', 'g'
        )) IS DISTINCT FROM
        'BEGIN IF NEW.category = ''currency_exchange'' THEN RAISE EXCEPTION ''category_not_allowed'' USING HINT = ''Currency exchange listings are not permitted.''; END IF; RETURN NEW; END;'
  THEN
    RAISE EXCEPTION 'trigger_only_acl_postcondition_function_contract';
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

  SELECT pg_catalog.count(*)::integer
  INTO trigger_count
  FROM pg_catalog.pg_trigger AS trigger_row
  WHERE NOT trigger_row.tgisinternal
    AND trigger_row.tgfoid = function_oid;

  IF items_oid IS NULL
     OR category_attnum IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_enum AS enum_value
       WHERE enum_value.enumtypid = pg_catalog.to_regtype('public.item_category')
         AND enum_value.enumlabel = 'currency_exchange'
     )
     OR trigger_count <> 1
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
    RAISE EXCEPTION 'trigger_only_acl_postcondition_trigger_contract';
  END IF;

  -- Direct ACL truth includes grantor and grant-option provenance.  The exact
  -- API/PUBLIC target is the empty set.
  SELECT pg_catalog.count(*)::integer
  INTO direct_count
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
    AND (
      acl.privilege_type = 'EXECUTE'
      OR acl.grantor IS NOT NULL
      OR acl.is_grantable IN (true, false)
    );

  IF direct_count <> 0 THEN
    RAISE EXCEPTION 'trigger_only_acl_postcondition_direct_acl: %',
      direct_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO public_count
  FROM pg_catalog.pg_proc AS routine
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      routine.proacl,
      pg_catalog.acldefault('f', routine.proowner)
    )
  ) AS acl
  WHERE routine.oid = function_oid
    AND acl.grantee = 0
    AND acl.privilege_type = 'EXECUTE';

  SELECT pg_catalog.count(*)::integer
  INTO effective_count
  FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
    AS api_role(role_name)
  WHERE pg_catalog.has_function_privilege(
          api_role.role_name, function_oid, 'EXECUTE'
        )
     OR pg_catalog.has_function_privilege(
          api_role.role_name, function_oid, 'EXECUTE WITH GRANT OPTION'
        );

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

  IF public_count <> 0
     OR effective_count <> 0
     OR inherited_count <> 0
     OR owner_membership_count <> 0 THEN
    RAISE EXCEPTION
      'trigger_only_acl_postcondition_effective_or_inherited: public %, effective %, inherited %, owner_membership %',
      public_count, effective_count, inherited_count, owner_membership_count;
  END IF;
END;
$postcondition$;

COMMIT;
