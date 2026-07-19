-- Local/isolated adversarial regression for 20260719170019.
-- NEVER run against production. Every ACL, policy, and role mutation rolls back.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL search_path = public, pg_catalog;

DO $baseline_contract$
DECLARE
  rpc_signature text;
BEGIN
  IF pg_catalog.has_table_privilege(
       'authenticated', 'public.meetups', 'UPDATE'
     )
     OR pg_catalog.has_any_column_privilege(
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
    RAISE EXCEPTION 'baseline meetup client/server ACL is not closed';
  END IF;

  FOREACH rpc_signature IN ARRAY ARRAY[
    'public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)',
    'public.respond_to_meetup(uuid,text,uuid,text,timestamp with time zone,text)',
    'public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,uuid,text)'
  ]::text[] LOOP
    IF NOT pg_catalog.has_function_privilege(
         'authenticated', rpc_signature, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege('anon', rpc_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege(
         'service_role', rpc_signature, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'baseline meetup RPC ACL drift: %', rpc_signature;
    END IF;
  END LOOP;
END;
$baseline_contract$;

-- Exercise the actual Data API role, not only catalog helpers. The reviewed
-- projection remains queryable while a reminder-state UPDATE is rejected at
-- the privilege layer even when no row matches.
SET LOCAL ROLE authenticated;
SELECT
  id, conversation_id, item_id, from_user, to_user, spot, meet_at, status,
  parent_meetup_id, note, expires_at, created_at, updated_at
FROM public.meetups
LIMIT 0;

DO $authenticated_update_denied$
BEGIN
  BEGIN
    UPDATE public.meetups
    SET reminded_at = pg_catalog.clock_timestamp()
    WHERE false;
    RAISE EXCEPTION 'authenticated reminded_at UPDATE unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$authenticated_update_denied$;
RESET ROLE;

SAVEPOINT public_and_direct_grants;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.meetups TO PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.meetups TO anon, authenticated WITH GRANT OPTION;
GRANT SELECT (reminded_at), UPDATE (reminded_at)
  ON public.meetups TO authenticated WITH GRANT OPTION;
DO $direct_drift_detected$
BEGIN
  IF NOT pg_catalog.has_table_privilege(
       'anon', 'public.meetups', 'UPDATE'
     )
     OR NOT pg_catalog.has_column_privilege(
       'authenticated', 'public.meetups', 'reminded_at', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'authenticated', 'public.meetups', 'UPDATE WITH GRANT OPTION'
     ) THEN
    RAISE EXCEPTION 'direct/PUBLIC/grant-option attack fixture ineffective';
  END IF;
END;
$direct_drift_detected$;
ROLLBACK TO SAVEPOINT public_and_direct_grants;

SAVEPOINT inherited_table_privilege;
CREATE ROLE meetups_acl_regression_parent NOLOGIN;
GRANT UPDATE ON public.meetups TO meetups_acl_regression_parent;
GRANT meetups_acl_regression_parent TO authenticated;
DO $inherited_table_drift_detected$
DECLARE
  provenance_count integer;
BEGIN
  IF NOT pg_catalog.has_table_privilege(
    'authenticated', 'public.meetups', 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'inherited UPDATE attack fixture ineffective';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO provenance_count
  FROM pg_catalog.pg_class AS relation
  CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
  WHERE relation.oid = 'public.meetups'::pg_catalog.regclass
    AND acl.grantee <> 0
    AND acl.grantee <> pg_catalog.to_regrole('authenticated')::oid
    AND pg_catalog.pg_has_role(
      pg_catalog.to_regrole('authenticated'), acl.grantee, 'MEMBER'
    )
    AND acl.privilege_type = 'UPDATE';

  IF provenance_count <> 1 THEN
    RAISE EXCEPTION 'inherited table ACL escaped provenance detection';
  END IF;
END;
$inherited_table_drift_detected$;
ROLLBACK TO SAVEPOINT inherited_table_privilege;

SAVEPOINT inherited_column_grant_option;
CREATE ROLE meetups_acl_regression_column_parent NOLOGIN;
GRANT SELECT (id) ON public.meetups
  TO meetups_acl_regression_column_parent WITH GRANT OPTION;
GRANT meetups_acl_regression_column_parent TO authenticated;
DO $inherited_column_grant_option_detected$
DECLARE
  provenance_count integer;
BEGIN
  IF NOT pg_catalog.has_column_privilege(
    'authenticated', 'public.meetups', 'id', 'SELECT WITH GRANT OPTION'
  ) THEN
    RAISE EXCEPTION 'inherited column grant-option fixture ineffective';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO provenance_count
  FROM pg_catalog.pg_attribute AS attribute
  CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
  WHERE attribute.attrelid = 'public.meetups'::pg_catalog.regclass
    AND attribute.attname = 'id'
    AND acl.grantee <> 0
    AND acl.grantee <> pg_catalog.to_regrole('authenticated')::oid
    AND pg_catalog.pg_has_role(
      pg_catalog.to_regrole('authenticated'), acl.grantee, 'MEMBER'
    )
    AND acl.privilege_type = 'SELECT'
    AND acl.is_grantable;

  IF provenance_count <> 1 THEN
    RAISE EXCEPTION 'inherited column grant option escaped provenance detection';
  END IF;
END;
$inherited_column_grant_option_detected$;
ROLLBACK TO SAVEPOINT inherited_column_grant_option;

SAVEPOINT duplicate_grantor;
CREATE ROLE meetups_acl_regression_delegator NOLOGIN;
GRANT USAGE ON SCHEMA public TO meetups_acl_regression_delegator;
GRANT SELECT (id) ON public.meetups
  TO meetups_acl_regression_delegator WITH GRANT OPTION;
SET LOCAL ROLE meetups_acl_regression_delegator;
GRANT SELECT (id) ON public.meetups TO authenticated;
RESET ROLE;
DO $duplicate_grantor_detected$
DECLARE
  grantor_count integer;
BEGIN
  SELECT pg_catalog.count(DISTINCT acl.grantor)::integer
  INTO grantor_count
  FROM pg_catalog.pg_attribute AS attribute
  CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
  WHERE attribute.attrelid = 'public.meetups'::pg_catalog.regclass
    AND attribute.attname = 'id'
    AND acl.grantee = pg_catalog.to_regrole('authenticated')::oid
    AND acl.privilege_type = 'SELECT';

  IF grantor_count < 2 THEN
    RAISE EXCEPTION 'duplicate meetup ACL grantor escaped detection';
  END IF;
END;
$duplicate_grantor_detected$;
ROLLBACK TO SAVEPOINT duplicate_grantor;

SAVEPOINT foreign_rpc_grantor;
CREATE ROLE meetups_acl_regression_rpc_delegator NOLOGIN;
GRANT USAGE ON SCHEMA public TO meetups_acl_regression_rpc_delegator;
GRANT EXECUTE ON FUNCTION public.propose_meetup(
  uuid, text, timestamptz, uuid, text
) TO meetups_acl_regression_rpc_delegator WITH GRANT OPTION;
SET LOCAL ROLE meetups_acl_regression_rpc_delegator;
GRANT EXECUTE ON FUNCTION public.propose_meetup(
  uuid, text, timestamptz, uuid, text
) TO authenticated;
RESET ROLE;
DO $foreign_rpc_grantor_detected$
DECLARE
  mismatch_count integer;
BEGIN
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

  IF mismatch_count = 0 THEN
    RAISE EXCEPTION 'foreign meetup RPC grantor escaped exact precheck detection';
  END IF;
END;
$foreign_rpc_grantor_detected$;
ROLLBACK TO SAVEPOINT foreign_rpc_grantor;

SAVEPOINT public_true_policy;
DROP POLICY meetups_select ON public.meetups;
CREATE POLICY meetups_select
  ON public.meetups FOR SELECT TO PUBLIC USING (true);
DO $policy_drift_detected$
DECLARE
  role_names text[];
  using_expression text;
BEGIN
  SELECT
    ARRAY(
      SELECT CASE WHEN policy_role.role_oid = 0
        THEN 'PUBLIC' ELSE role.rolname::text END
      FROM pg_catalog.pg_policy AS inner_policy
      CROSS JOIN pg_catalog.unnest(inner_policy.polroles)
        AS policy_role(role_oid)
      LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = policy_role.role_oid
      WHERE inner_policy.polrelid = 'public.meetups'::pg_catalog.regclass
        AND inner_policy.polname = 'meetups_select'
      ORDER BY 1
    ),
    pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
      '[[:space:]]+', '', 'g'
    ))
  INTO STRICT role_names, using_expression
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'public.meetups'::pg_catalog.regclass
    AND policy.polname = 'meetups_select';

  IF role_names IS NOT DISTINCT FROM ARRAY['authenticated']::text[]
     AND using_expression IS NOT DISTINCT FROM
       'private.current_user_can_access_conversation(conversation_id)' THEN
    RAISE EXCEPTION 'PUBLIC/true meetups policy escaped exact detection';
  END IF;
END;
$policy_drift_detected$;
ROLLBACK TO SAVEPOINT public_true_policy;

SAVEPOINT inherited_rpc_execute;
CREATE ROLE meetups_acl_regression_rpc_parent NOLOGIN;
GRANT EXECUTE ON FUNCTION public.propose_meetup(
  uuid, text, timestamptz, uuid, text
) TO meetups_acl_regression_rpc_parent WITH GRANT OPTION;
GRANT meetups_acl_regression_rpc_parent TO anon;
DO $inherited_rpc_drift_detected$
DECLARE
  provenance_count integer;
BEGIN
  IF NOT pg_catalog.has_function_privilege(
    'anon',
    'public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)',
    'EXECUTE WITH GRANT OPTION'
  ) THEN
    RAISE EXCEPTION 'inherited RPC attack fixture ineffective';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO provenance_count
  FROM pg_catalog.pg_proc AS routine
  CROSS JOIN LATERAL pg_catalog.aclexplode(routine.proacl) AS acl
  WHERE routine.oid =
    'public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)'::pg_catalog.regprocedure
    AND acl.grantee <> 0
    AND acl.grantee <> pg_catalog.to_regrole('anon')::oid
    AND pg_catalog.pg_has_role(
      pg_catalog.to_regrole('anon'), acl.grantee, 'MEMBER'
    )
    AND acl.privilege_type = 'EXECUTE'
    AND acl.is_grantable;

  IF provenance_count <> 1 THEN
    RAISE EXCEPTION 'inherited RPC grant option escaped provenance detection';
  END IF;
END;
$inherited_rpc_drift_detected$;
ROLLBACK TO SAVEPOINT inherited_rpc_execute;

SAVEPOINT inherited_maintain;
CREATE ROLE meetups_acl_regression_maintainer NOLOGIN;
GRANT meetups_acl_regression_maintainer TO authenticated;
DO $pg17_maintain_drift_detected$
DECLARE
  maintain_count integer;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer >= 170000 THEN
    EXECUTE
      'GRANT MAINTAIN ON public.meetups TO meetups_acl_regression_maintainer';
    EXECUTE $maintain$
      SELECT pg_catalog.count(*)::integer
      FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
        AS api_role(role_name)
      WHERE pg_catalog.has_table_privilege(
        api_role.role_name, 'public.meetups', 'MAINTAIN'
      )
    $maintain$ INTO maintain_count;
    IF maintain_count = 0 THEN
      RAISE EXCEPTION 'inherited PG17 MAINTAIN escaped detection';
    END IF;
  END IF;
END;
$pg17_maintain_drift_detected$;
ROLLBACK TO SAVEPOINT inherited_maintain;

ROLLBACK;
