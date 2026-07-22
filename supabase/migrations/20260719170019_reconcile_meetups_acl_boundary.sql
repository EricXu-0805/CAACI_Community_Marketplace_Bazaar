-- Forward-only repair for the final public.meetups Data API contract.
--
-- Production had already applied 20260718250000, but historical platform
-- defaults still left all table privileges on meetups for every API role.
-- That made the server-owned reminded_at state client-mutable and blocked the
-- atomic reminder migration.  Clear both table and column ACL drift, then
-- install exactly the narrower contract that 20260718280000 retains:
--   * service_role: table-level SELECT/INSERT/UPDATE/DELETE
--   * authenticated: SELECT on the reviewed client projection only
--   * anon/PUBLIC: no access
-- Client writes remain available only through the three guarded meetup RPCs.

BEGIN;
SET LOCAL search_path = public, pg_catalog;

DO $guard$
DECLARE
  policy_count integer;
  policy_command "char";
  policy_permissive boolean;
  policy_roles text[];
  policy_using text;
  policy_check text;
  rpc_signature text;
  rpc_oid regprocedure;
  rpc_definition record;
  inherited_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS required(role_name)
    WHERE pg_catalog.to_regrole(required.role_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'meetups_acl_api_role_missing' USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = pg_catalog.to_regclass('public.meetups')
      AND relation.relkind = 'r'
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'meetups_acl_rls_prerequisite_missing'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(ARRAY[
      'id','conversation_id','item_id','from_user','to_user','spot','meet_at',
      'status','parent_meetup_id','note','expires_at','reminded_at','created_at',
      'updated_at'
    ]::text[]) AS required(column_name)
    LEFT JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = 'public.meetups'::pg_catalog.regclass
     AND attribute.attname = required.column_name
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    WHERE attribute.attname IS NULL
  ) THEN
    RAISE EXCEPTION 'meetups_acl_column_prerequisite_missing'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO policy_count
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'public.meetups'::pg_catalog.regclass
    AND policy.polname = 'meetups_select';

  IF policy_count = 1 THEN
    SELECT
      policy.polcmd,
      policy.polpermissive,
      policy_roles.role_names,
      pg_catalog.lower(pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
        '[[:space:]]+', '', 'g'
      )),
      pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
    INTO STRICT policy_command, policy_permissive, policy_roles,
         policy_using, policy_check
    FROM pg_catalog.pg_policy AS policy
  CROSS JOIN LATERAL (
    SELECT pg_catalog.array_agg(
      CASE WHEN policy_role.role_oid = 0
        THEN 'PUBLIC'::text ELSE role.rolname::text END
      ORDER BY CASE WHEN policy_role.role_oid = 0
        THEN 'PUBLIC'::text ELSE role.rolname::text END
    ) AS role_names
    FROM pg_catalog.unnest(policy.polroles) AS policy_role(role_oid)
    LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = policy_role.role_oid
  ) AS policy_roles
    WHERE policy.polrelid = 'public.meetups'::pg_catalog.regclass
      AND policy.polname = 'meetups_select';
  END IF;

  IF policy_count <> 1
     OR policy_command IS DISTINCT FROM 'r'::"char"
     OR policy_permissive IS DISTINCT FROM true
     OR policy_roles IS DISTINCT FROM ARRAY['authenticated']::text[]
     OR policy_using IS DISTINCT FROM
       'private.current_user_can_access_conversation(conversation_id)'
     OR policy_check IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policy AS other_policy
       WHERE other_policy.polrelid = 'public.meetups'::pg_catalog.regclass
         AND other_policy.polname <> 'meetups_select'
     ) THEN
    RAISE EXCEPTION 'meetups_acl_policy_contract_drift'
      USING ERRCODE = '55000';
  END IF;

  FOREACH rpc_signature IN ARRAY ARRAY[
    'public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)',
    'public.respond_to_meetup(uuid,text,uuid,text,timestamp with time zone,text)',
    'public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,uuid,text)'
  ]::text[] LOOP
    rpc_oid := pg_catalog.to_regprocedure(rpc_signature);
    IF rpc_oid IS NULL THEN
      RAISE EXCEPTION 'meetups_acl_rpc_missing: %', rpc_signature
        USING ERRCODE = '55000';
    END IF;

    SELECT routine.prosecdef, routine.proconfig
    INTO STRICT rpc_definition
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = rpc_oid;

    IF NOT rpc_definition.prosecdef
       OR rpc_definition.proconfig IS DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
       OR NOT pg_catalog.has_function_privilege(
         'authenticated', rpc_oid, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege('anon', rpc_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', rpc_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege(
         'authenticated', rpc_oid, 'EXECUTE WITH GRANT OPTION'
       ) THEN
      RAISE EXCEPTION 'meetups_acl_rpc_contract_drift: %', rpc_signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  -- Parent-role ACLs cannot be repaired by revoking grants from the API role.
  -- Refuse to proceed instead of claiming the direct ACL reset is sufficient.
  SELECT pg_catalog.count(*)::integer
  INTO inherited_count
  FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
    AS member_role(role_name)
  CROSS JOIN pg_catalog.pg_class AS relation
  CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
  WHERE relation.oid = 'public.meetups'::pg_catalog.regclass
    AND acl.grantee <> 0
    AND acl.grantee <> pg_catalog.to_regrole(member_role.role_name)::oid
    AND pg_catalog.pg_has_role(
      pg_catalog.to_regrole(member_role.role_name), acl.grantee, 'MEMBER'
    );
  IF inherited_count <> 0 THEN
    RAISE EXCEPTION 'meetups_acl_inherited_table_provenance_drift: %',
      inherited_count USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO inherited_count
  FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
    AS member_role(role_name)
  CROSS JOIN pg_catalog.pg_attribute AS attribute
  CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
  WHERE attribute.attrelid = 'public.meetups'::pg_catalog.regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND acl.grantee <> 0
    AND acl.grantee <> pg_catalog.to_regrole(member_role.role_name)::oid
    AND pg_catalog.pg_has_role(
      pg_catalog.to_regrole(member_role.role_name), acl.grantee, 'MEMBER'
    );
  IF inherited_count <> 0 THEN
    RAISE EXCEPTION 'meetups_acl_inherited_column_provenance_drift: %',
      inherited_count USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO inherited_count
  FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
    AS member_role(role_name)
  CROSS JOIN pg_catalog.pg_proc AS routine
  CROSS JOIN LATERAL pg_catalog.aclexplode(routine.proacl) AS acl
  WHERE routine.oid IN (
    'public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)'::pg_catalog.regprocedure,
    'public.respond_to_meetup(uuid,text,uuid,text,timestamp with time zone,text)'::pg_catalog.regprocedure,
    'public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,uuid,text)'::pg_catalog.regprocedure
  )
    AND acl.grantee <> 0
    AND acl.grantee <> pg_catalog.to_regrole(member_role.role_name)::oid
    AND pg_catalog.pg_has_role(
      pg_catalog.to_regrole(member_role.role_name), acl.grantee, 'MEMBER'
    );
  IF inherited_count <> 0 THEN
    RAISE EXCEPTION 'meetups_acl_inherited_rpc_provenance_drift: %',
      inherited_count USING ERRCODE = '55000';
  END IF;
END;
$guard$;

DO $clear_acl$
DECLARE
  column_list text;
BEGIN
  SELECT pg_catalog.string_agg(
    pg_catalog.quote_ident(attribute.attname),
    ',' ORDER BY attribute.attnum
  )
  INTO STRICT column_list
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.meetups'::pg_catalog.regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  EXECUTE pg_catalog.format(
    'REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON TABLE public.meetups FROM PUBLIC, anon, authenticated, service_role',
    column_list
  );
  REVOKE ALL PRIVILEGES ON TABLE public.meetups
    FROM PUBLIC, anon, authenticated, service_role;
END;
$clear_acl$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meetups TO service_role;
GRANT SELECT (
  id, conversation_id, item_id, from_user, to_user, spot, meet_at, status,
  parent_meetup_id, note, expires_at, created_at, updated_at
) ON TABLE public.meetups TO authenticated;

DO $postcondition$
DECLARE
  mismatch_count integer;
  maintain_count integer;
  rpc_signature text;
  rpc_oid regprocedure;
  rpc_definition record;
  policy_count integer;
  policy_command "char";
  policy_permissive boolean;
  policy_roles text[];
  policy_using text;
  policy_check text;
BEGIN
  -- Direct table ACL, including grantor and WITH GRANT OPTION provenance.
  WITH expected(grantee, relation_oid, privilege_type, grantor, is_grantable) AS (
    SELECT
      pg_catalog.to_regrole('service_role')::oid,
      relation.oid,
      privilege_type,
      relation.relowner,
      false
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN pg_catalog.unnest(
      ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]
    ) AS required(privilege_type)
    WHERE relation.oid = 'public.meetups'::pg_catalog.regclass
  ), actual AS (
    SELECT acl.grantee, relation.oid, acl.privilege_type,
           acl.grantor, acl.is_grantable
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
    WHERE relation.oid = 'public.meetups'::pg_catalog.regclass
      AND (
        acl.grantee = 0
        OR acl.grantee IN (
          pg_catalog.to_regrole('anon')::oid,
          pg_catalog.to_regrole('authenticated')::oid,
          pg_catalog.to_regrole('service_role')::oid
        )
      )
  ), differences AS (
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*)::integer INTO mismatch_count FROM differences;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'meetups_acl_postcondition_direct_table_mismatch: %',
      mismatch_count;
  END IF;

  -- Direct column ACL is exactly the authenticated SELECT projection.
  WITH expected(grantee, relation_oid, privilege_type, attnum, grantor, is_grantable) AS (
    SELECT
      pg_catalog.to_regrole('authenticated')::oid,
      relation.oid,
      'SELECT'::text,
      attribute.attnum,
      relation.relowner,
      false
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
     AND attribute.attname = ANY(ARRAY[
       'id','conversation_id','item_id','from_user','to_user','spot','meet_at',
       'status','parent_meetup_id','note','expires_at','created_at','updated_at'
     ]::text[])
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    WHERE relation.oid = 'public.meetups'::pg_catalog.regclass
  ), actual AS (
    SELECT acl.grantee, relation.oid, acl.privilege_type,
           attribute.attnum, acl.grantor, acl.is_grantable
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
    WHERE relation.oid = 'public.meetups'::pg_catalog.regclass
      AND (
        acl.grantee = 0
        OR acl.grantee IN (
          pg_catalog.to_regrole('anon')::oid,
          pg_catalog.to_regrole('authenticated')::oid,
          pg_catalog.to_regrole('service_role')::oid
        )
      )
  ), differences AS (
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*)::integer INTO mismatch_count FROM differences;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'meetups_acl_postcondition_direct_column_mismatch: %',
      mismatch_count;
  END IF;

  -- Effective table privileges catch PUBLIC, role inheritance, and ownership.
  WITH roles(role_name) AS (
    VALUES ('anon'), ('authenticated'), ('service_role')
  ), privileges(privilege_type) AS (
    VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
           ('REFERENCES'), ('TRIGGER')
  ), expected(role_name, privilege_type) AS (
    SELECT 'service_role', privilege_type
    FROM pg_catalog.unnest(
      ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]
    ) AS required(privilege_type)
  ), actual AS (
    SELECT role_name, privilege_type
    FROM roles CROSS JOIN privileges
    WHERE pg_catalog.has_table_privilege(
      role_name, 'public.meetups', privilege_type
    )
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*)::integer INTO mismatch_count FROM differences;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'meetups_acl_postcondition_effective_table_mismatch: %',
      mismatch_count;
  END IF;

  -- Effective column truth matrix includes rights inherited from table ACLs.
  WITH roles(role_name) AS (
    VALUES ('anon'), ('authenticated'), ('service_role')
  ), privileges(privilege_type) AS (
    VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')
  ), columns(column_name) AS (
    SELECT attribute.attname
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.meetups'::pg_catalog.regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ), expected(role_name, column_name, privilege_type) AS (
    SELECT 'service_role', column_name, privilege_type
    FROM columns
    CROSS JOIN pg_catalog.unnest(
      ARRAY['SELECT','INSERT','UPDATE']::text[]
    ) AS service_privilege(privilege_type)
    UNION ALL
    SELECT 'authenticated', column_name, 'SELECT'
    FROM pg_catalog.unnest(ARRAY[
      'id','conversation_id','item_id','from_user','to_user','spot','meet_at',
      'status','parent_meetup_id','note','expires_at','created_at','updated_at'
    ]::text[]) AS selected(column_name)
  ), actual AS (
    SELECT role_name, column_name, privilege_type
    FROM roles CROSS JOIN columns CROSS JOIN privileges
    WHERE pg_catalog.has_column_privilege(
      role_name, 'public.meetups', column_name, privilege_type
    )
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*)::integer INTO mismatch_count FROM differences;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'meetups_acl_postcondition_effective_column_mismatch: %',
      mismatch_count;
  END IF;

  -- No API role may inherit a target-relation ACL from another role.
  SELECT pg_catalog.count(*)::integer
  INTO mismatch_count
  FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
    AS member_role(role_name)
  CROSS JOIN pg_catalog.pg_class AS relation
  CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
  WHERE relation.oid = 'public.meetups'::pg_catalog.regclass
    AND acl.grantee <> 0
    AND acl.grantee <> pg_catalog.to_regrole(member_role.role_name)::oid
    AND pg_catalog.pg_has_role(
      pg_catalog.to_regrole(member_role.role_name), acl.grantee, 'MEMBER'
    );
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'meetups_acl_postcondition_inherited_table_provenance: %',
      mismatch_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO mismatch_count
  FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
    AS member_role(role_name)
  CROSS JOIN pg_catalog.pg_attribute AS attribute
  CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
  WHERE attribute.attrelid = 'public.meetups'::pg_catalog.regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND acl.grantee <> 0
    AND acl.grantee <> pg_catalog.to_regrole(member_role.role_name)::oid
    AND pg_catalog.pg_has_role(
      pg_catalog.to_regrole(member_role.role_name), acl.grantee, 'MEMBER'
    );
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'meetups_acl_postcondition_inherited_column_provenance: %',
      mismatch_count;
  END IF;

  -- Expected privileges are not delegable either directly or through a parent.
  SELECT pg_catalog.count(*)::integer
  INTO mismatch_count
  FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
    AS api_role(role_name)
  CROSS JOIN pg_catalog.unnest(ARRAY[
    'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
  ]::text[]) AS candidate(privilege_type)
  WHERE pg_catalog.has_table_privilege(
    api_role.role_name,
    'public.meetups',
    candidate.privilege_type || ' WITH GRANT OPTION'
  );
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'meetups_acl_postcondition_table_grant_option: %',
      mismatch_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO mismatch_count
  FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
    AS api_role(role_name)
  CROSS JOIN pg_catalog.pg_attribute AS attribute
  CROSS JOIN pg_catalog.unnest(
    ARRAY['SELECT','INSERT','UPDATE','REFERENCES']::text[]
  ) AS candidate(privilege_type)
  WHERE attribute.attrelid = 'public.meetups'::pg_catalog.regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND pg_catalog.has_column_privilege(
      api_role.role_name,
      'public.meetups',
      attribute.attname,
      candidate.privilege_type || ' WITH GRANT OPTION'
    );
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'meetups_acl_postcondition_column_grant_option: %',
      mismatch_count;
  END IF;

  -- PostgreSQL 17 adds MAINTAIN. Dynamic SQL keeps this migration replayable
  -- on PostgreSQL 16 while proving no API role retains it in production.
  IF pg_catalog.current_setting('server_version_num')::integer >= 170000 THEN
    EXECUTE $maintain$
      SELECT pg_catalog.count(*)::integer
      FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
        AS api_role(role_name)
      WHERE pg_catalog.has_table_privilege(
              api_role.role_name, 'public.meetups', 'MAINTAIN'
            )
         OR pg_catalog.has_table_privilege(
              api_role.role_name,
              'public.meetups',
              'MAINTAIN WITH GRANT OPTION'
            )
    $maintain$ INTO maintain_count;
    IF maintain_count <> 0 THEN
      RAISE EXCEPTION 'meetups_acl_postcondition_pg17_maintain: %',
        maintain_count;
    END IF;
  END IF;

  -- The RLS contract and the three authenticated-only write RPCs were not
  -- changed. Prove they remain usable before committing the ACL change.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.meetups'::pg_catalog.regclass
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'meetups_acl_postcondition_rls_disabled';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO policy_count
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'public.meetups'::pg_catalog.regclass
    AND policy.polname = 'meetups_select';

  IF policy_count = 1 THEN
    SELECT
      policy.polcmd,
      policy.polpermissive,
      policy_roles.role_names,
      pg_catalog.lower(pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
        '[[:space:]]+', '', 'g'
      )),
      pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
    INTO STRICT policy_command, policy_permissive, policy_roles,
         policy_using, policy_check
    FROM pg_catalog.pg_policy AS policy
    CROSS JOIN LATERAL (
      SELECT pg_catalog.array_agg(
        CASE WHEN policy_role.role_oid = 0
          THEN 'PUBLIC'::text ELSE role.rolname::text END
        ORDER BY CASE WHEN policy_role.role_oid = 0
          THEN 'PUBLIC'::text ELSE role.rolname::text END
      ) AS role_names
      FROM pg_catalog.unnest(policy.polroles) AS policy_role(role_oid)
      LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = policy_role.role_oid
    ) AS policy_roles
    WHERE policy.polrelid = 'public.meetups'::pg_catalog.regclass
      AND policy.polname = 'meetups_select';
  END IF;

  IF policy_count <> 1
     OR policy_command IS DISTINCT FROM 'r'::"char"
     OR policy_permissive IS DISTINCT FROM true
     OR policy_roles IS DISTINCT FROM ARRAY['authenticated']::text[]
     OR policy_using IS DISTINCT FROM
       'private.current_user_can_access_conversation(conversation_id)'
     OR policy_check IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policy AS other_policy
       WHERE other_policy.polrelid = 'public.meetups'::pg_catalog.regclass
         AND other_policy.polname <> 'meetups_select'
     ) THEN
    RAISE EXCEPTION 'meetups_acl_postcondition_policy_drift';
  END IF;

  WITH functions(rpc_oid) AS (
    VALUES
      ('public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)'::pg_catalog.regprocedure),
      ('public.respond_to_meetup(uuid,text,uuid,text,timestamp with time zone,text)'::pg_catalog.regprocedure),
      ('public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,uuid,text)'::pg_catalog.regprocedure)
  ), expected(grantee, rpc_oid, privilege_type, grantor, is_grantable) AS (
    SELECT pg_catalog.to_regrole('authenticated')::oid,
           routine.oid, 'EXECUTE'::text, routine.proowner, false
    FROM functions
    JOIN pg_catalog.pg_proc AS routine ON routine.oid = functions.rpc_oid
  ), actual AS (
    SELECT acl.grantee, routine.oid, acl.privilege_type,
           acl.grantor, acl.is_grantable
    FROM functions
    JOIN pg_catalog.pg_proc AS routine ON routine.oid = functions.rpc_oid
    CROSS JOIN LATERAL pg_catalog.aclexplode(routine.proacl) AS acl
    WHERE acl.grantee = 0
       OR acl.grantee IN (
         pg_catalog.to_regrole('anon')::oid,
         pg_catalog.to_regrole('authenticated')::oid,
         pg_catalog.to_regrole('service_role')::oid
       )
  ), differences AS (
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*)::integer INTO mismatch_count FROM differences;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'meetups_acl_postcondition_direct_rpc_mismatch: %',
      mismatch_count;
  END IF;

  FOREACH rpc_signature IN ARRAY ARRAY[
    'public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)',
    'public.respond_to_meetup(uuid,text,uuid,text,timestamp with time zone,text)',
    'public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,uuid,text)'
  ]::text[] LOOP
    rpc_oid := pg_catalog.to_regprocedure(rpc_signature);
    IF rpc_oid IS NULL THEN
      RAISE EXCEPTION 'meetups_acl_postcondition_rpc_missing: %',
        rpc_signature;
    END IF;

    SELECT routine.prosecdef, routine.proconfig
    INTO STRICT rpc_definition
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = rpc_oid;

    IF NOT rpc_definition.prosecdef
       OR rpc_definition.proconfig IS DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
       OR NOT pg_catalog.has_function_privilege(
         'authenticated', rpc_oid, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege('anon', rpc_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', rpc_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege(
         'authenticated', rpc_oid, 'EXECUTE WITH GRANT OPTION'
       ) THEN
      RAISE EXCEPTION 'meetups_acl_postcondition_rpc_drift: %', rpc_signature;
    END IF;
  END LOOP;

  -- Recheck parent-role provenance inside the postcondition. A concurrent
  -- inherited grant must not slip between the guard and the final commit.
  SELECT pg_catalog.count(*)::integer
  INTO mismatch_count
  FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
    AS member_role(role_name)
  CROSS JOIN pg_catalog.pg_proc AS routine
  CROSS JOIN LATERAL pg_catalog.aclexplode(routine.proacl) AS acl
  WHERE routine.oid IN (
    'public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)'::pg_catalog.regprocedure,
    'public.respond_to_meetup(uuid,text,uuid,text,timestamp with time zone,text)'::pg_catalog.regprocedure,
    'public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,uuid,text)'::pg_catalog.regprocedure
  )
    AND acl.grantee <> 0
    AND acl.grantee <> pg_catalog.to_regrole(member_role.role_name)::oid
    AND pg_catalog.pg_has_role(
      pg_catalog.to_regrole(member_role.role_name), acl.grantee, 'MEMBER'
    );
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'meetups_acl_postcondition_inherited_rpc_provenance: %',
      mismatch_count;
  END IF;

  IF pg_catalog.has_any_column_privilege(
       'authenticated', 'public.meetups', 'UPDATE'
     )
     OR pg_catalog.has_column_privilege(
       'authenticated', 'public.meetups', 'reminded_at', 'SELECT'
     )
     OR NOT pg_catalog.has_column_privilege(
       'authenticated', 'public.meetups', 'id', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'meetups_acl_postcondition_client_boundary_drift';
  END IF;
END;
$postcondition$;

COMMIT;
