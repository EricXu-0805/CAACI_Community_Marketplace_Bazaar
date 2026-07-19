-- Read-only preflight for 20260719170019_reconcile_meetups_acl_boundary.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = public, pg_catalog;

DO $precheck$
DECLARE
  policy_count integer;
  policy_command "char";
  policy_permissive boolean;
  policy_roles text[];
  policy_using text;
  policy_check text;
  rpc_signature text;
  rpc_oid regprocedure;
  rpc_acl_mismatch integer;
  inherited_count integer;
  foreign_grantor_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS required(role_name)
    WHERE pg_catalog.to_regrole(required.role_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'precheck_failed: meetup API role missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = pg_catalog.to_regclass('public.meetups')
      AND relation.relkind = 'r'
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'precheck_failed: public.meetups base table/RLS missing';
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
    RAISE EXCEPTION 'precheck_failed: public.meetups column contract drift';
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
    RAISE EXCEPTION 'precheck_failed: meetups_select policy contract drift';
  END IF;

  FOREACH rpc_signature IN ARRAY ARRAY[
    'public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)',
    'public.respond_to_meetup(uuid,text,uuid,text,timestamp with time zone,text)',
    'public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,uuid,text)'
  ]::text[] LOOP
    rpc_oid := pg_catalog.to_regprocedure(rpc_signature);
    IF rpc_oid IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc AS routine
         WHERE routine.oid = rpc_oid
           AND routine.prosecdef
           AND routine.proconfig IS NOT DISTINCT FROM
             ARRAY['search_path=pg_catalog']::text[]
       )
       OR NOT pg_catalog.has_function_privilege(
         'authenticated', rpc_oid, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege('anon', rpc_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', rpc_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege(
         'authenticated', rpc_oid, 'EXECUTE WITH GRANT OPTION'
       ) THEN
      RAISE EXCEPTION 'precheck_failed: meetup RPC contract drift: %',
        rpc_signature;
    END IF;
  END LOOP;

  -- Match the migration postcondition exactly: the effective checks above do
  -- not reveal a duplicate authenticated grant issued by another grantor.
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
  SELECT pg_catalog.count(*)::integer
  INTO rpc_acl_mismatch
  FROM differences;
  IF rpc_acl_mismatch <> 0 THEN
    RAISE EXCEPTION 'precheck_failed: direct meetup RPC ACL mismatch %',
      rpc_acl_mismatch;
  END IF;

  -- A direct owner-issued grant can be cleared atomically. Grants issued by a
  -- different grantor and inherited parent-role ACLs cannot be safely repaired
  -- by this narrow migration, so fail closed before taking locks.
  SELECT pg_catalog.count(*)::integer
  INTO foreign_grantor_count
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
    AND acl.grantor <> relation.relowner;

  SELECT foreign_grantor_count + pg_catalog.count(*)::integer
  INTO foreign_grantor_count
  FROM pg_catalog.pg_attribute AS attribute
  JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
  CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
  WHERE attribute.attrelid = 'public.meetups'::pg_catalog.regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND (
      acl.grantee = 0
      OR acl.grantee IN (
        pg_catalog.to_regrole('anon')::oid,
        pg_catalog.to_regrole('authenticated')::oid,
        pg_catalog.to_regrole('service_role')::oid
      )
    )
    AND acl.grantor <> relation.relowner;
  IF foreign_grantor_count <> 0 THEN
    RAISE EXCEPTION 'precheck_failed: non-owner meetup ACL grantor count %',
      foreign_grantor_count;
  END IF;

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

  SELECT inherited_count + pg_catalog.count(*)::integer
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

  SELECT inherited_count + pg_catalog.count(*)::integer
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
    RAISE EXCEPTION 'precheck_failed: inherited meetup ACL provenance count %',
      inherited_count;
  END IF;
END;
$precheck$;

SELECT
  pg_catalog.has_table_privilege(
    'authenticated', 'public.meetups', 'UPDATE'
  ) AS authenticated_meetups_update_before,
  pg_catalog.has_column_privilege(
    'authenticated', 'public.meetups', 'reminded_at', 'UPDATE'
  ) AS authenticated_reminded_at_update_before,
  pg_catalog.has_table_privilege(
    'anon', 'public.meetups', 'SELECT'
  ) AS anon_meetups_select_before;

ROLLBACK;
