-- Exact post-deploy verification for the public.meetups ACL repair.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = public, pg_catalog;

DO $verify$
DECLARE
  mismatch_count integer;
  maintain_count integer;
  policy_count integer;
  policy_command "char";
  policy_permissive boolean;
  policy_roles text[];
  policy_using text;
  policy_check text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = pg_catalog.to_regclass('public.meetups')
      AND relation.relkind = 'r'
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'verify_failed: public.meetups base table/RLS missing';
  END IF;

  -- Direct table ACL is owner-issued, non-delegable service_role CRUD only.
  WITH expected(grantee, relation_oid, privilege_type, grantor, is_grantable) AS (
    SELECT
      pg_catalog.to_regrole('service_role')::oid,
      relation.oid,
      required.privilege_type,
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
    RAISE EXCEPTION 'verify_failed: direct meetups table ACL mismatch %',
      mismatch_count;
  END IF;

  -- Direct column ACL is exactly the authenticated client projection.
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
    RAISE EXCEPTION 'verify_failed: direct meetups column ACL mismatch %',
      mismatch_count;
  END IF;

  -- Exact effective table truth matrix catches PUBLIC, membership and owner
  -- paths. Column SELECT does not count as table-level SELECT here.
  WITH roles(role_name) AS (
    VALUES ('anon'), ('authenticated'), ('service_role')
  ), privileges(privilege_type) AS (
    VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
           ('REFERENCES'), ('TRIGGER')
  ), expected(role_name, privilege_type) AS (
    SELECT 'service_role', required.privilege_type
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
    RAISE EXCEPTION 'verify_failed: effective meetups table ACL mismatch %',
      mismatch_count;
  END IF;

  -- Exact effective column truth matrix includes table-level rights inherited
  -- by each column. reminded_at is deliberately absent for authenticated.
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
    SELECT 'service_role', column_name, service_privilege.privilege_type
    FROM columns
    CROSS JOIN pg_catalog.unnest(
      ARRAY['SELECT','INSERT','UPDATE']::text[]
    ) AS service_privilege(privilege_type)
    UNION ALL
    SELECT 'authenticated', selected.column_name, 'SELECT'
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
    RAISE EXCEPTION 'verify_failed: effective meetups column ACL mismatch %',
      mismatch_count;
  END IF;

  -- No target role may receive the relation through an inherited parent ACL.
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
    RAISE EXCEPTION 'verify_failed: inherited meetups table ACL provenance %',
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
    RAISE EXCEPTION 'verify_failed: inherited meetups column ACL provenance %',
      mismatch_count;
  END IF;

  -- Every table/column right is non-delegable, including an inherited grant
  -- option whose base privilege happens to match the expected truth matrix.
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
    RAISE EXCEPTION 'verify_failed: meetups table grant option %',
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
    RAISE EXCEPTION 'verify_failed: meetups column grant option %',
      mismatch_count;
  END IF;

  -- PostgreSQL 17-only MAINTAIN stays absent; dynamic SQL parses on PG16.
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
      RAISE EXCEPTION 'verify_failed: effective PG17 MAINTAIN drift %',
        maintain_count;
    END IF;
  END IF;

  -- Exact policy shape proves the ACL repair did not weaken or replace RLS.
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
    RAISE EXCEPTION 'verify_failed: exact meetups_select policy drift';
  END IF;

  -- Direct and effective RPC ACLs stay authenticated-only and owner-issued.
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
    RAISE EXCEPTION 'verify_failed: direct meetup RPC ACL mismatch %',
      mismatch_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(ARRAY[
      'public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)',
      'public.respond_to_meetup(uuid,text,uuid,text,timestamp with time zone,text)',
      'public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,uuid,text)'
    ]::text[]) AS required(rpc_signature)
    LEFT JOIN pg_catalog.pg_proc AS routine
      ON routine.oid = pg_catalog.to_regprocedure(required.rpc_signature)
    WHERE routine.oid IS NULL
       OR NOT routine.prosecdef
       OR routine.proconfig IS DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
       OR NOT pg_catalog.has_function_privilege(
         'authenticated', routine.oid, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege(
         'service_role', routine.oid, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'authenticated', routine.oid, 'EXECUTE WITH GRANT OPTION'
       )
  ) THEN
    RAISE EXCEPTION 'verify_failed: effective meetup RPC contract drift';
  END IF;

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
    RAISE EXCEPTION 'verify_failed: inherited meetup RPC ACL provenance %',
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
     )
     OR pg_catalog.has_any_column_privilege(
       'anon', 'public.meetups', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'verify_failed: meetup client/server column boundary drift';
  END IF;
END;
$verify$;

ROLLBACK;
