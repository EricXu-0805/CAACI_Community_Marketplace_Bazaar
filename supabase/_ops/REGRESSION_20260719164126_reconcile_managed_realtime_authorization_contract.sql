-- LOCAL/ISOLATED POSTGRESQL ONLY. NEVER run against staging or production.
-- Every behavior and adversarial ACL fixture is rolled back.

\set ON_ERROR_STOP on

BEGIN;

DO $prerequisites$
BEGIN
  IF pg_catalog.to_regclass('realtime.messages') IS NULL
     OR pg_catalog.to_regrole('supabase_realtime_admin') IS NULL THEN
    RAISE EXCEPTION 'regression_failed: managed Realtime fixture missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'realtime.messages'::pg_catalog.regclass
      AND relation.relowner =
        pg_catalog.to_regrole('supabase_realtime_admin')::oid
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'regression_failed: managed owner/RLS fixture drift';
  END IF;
END;
$prerequisites$;

-- Restore the hosted owner-issued S/I/U shape even if an older local replay
-- removed it before the later forward migration was introduced.
SET LOCAL ROLE supabase_realtime_admin;
GRANT SELECT, INSERT, UPDATE ON realtime.messages
  TO anon, authenticated, service_role;
RESET ROLE;

-- Managed base grants do not authorize rows without a matching RLS policy.
SET LOCAL ROLE anon;
DO $anon_behavior$
DECLARE
  visible_count integer;
BEGIN
  SELECT pg_catalog.count(*) INTO visible_count FROM realtime.messages;
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'regression_failed: anon saw managed Realtime rows';
  END IF;

  BEGIN
    INSERT INTO realtime.messages (topic, extension, event, private)
    VALUES ('conversation:00000000-0000-0000-0000-000000000000',
            'broadcast', 'probe', true);
    RAISE EXCEPTION 'regression_failed: anon inserted a Realtime probe';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$anon_behavior$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000001',
  true
);
SELECT pg_catalog.set_config(
  'realtime.topic',
  'conversation:00000000-0000-4000-8000-000000000002',
  true
);
DO $authenticated_behavior$
DECLARE
  changed_count integer;
BEGIN
  UPDATE realtime.messages SET event = 'forbidden-update';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION
      'regression_failed: authenticated UPDATE escaped policy boundary';
  END IF;
END;
$authenticated_behavior$;
RESET ROLE;

-- Policy predicates are only usable when authenticated can traverse both
-- schemas, read the three projected conversation columns, and execute the
-- private block/suspension helper. Prove each effective dependency gate fails
-- closed when its grant disappears.
REVOKE SELECT ON TABLE public.conversations FROM authenticated;
REVOKE SELECT (id, buyer_id, seller_id)
  ON TABLE public.conversations FROM authenticated;
DO $conversation_dependency_acl$
BEGIN
  IF pg_catalog.has_column_privilege(
       'authenticated', 'public.conversations', 'id', 'SELECT'
     )
     OR pg_catalog.has_column_privilege(
       'authenticated', 'public.conversations', 'buyer_id', 'SELECT'
     )
     OR pg_catalog.has_column_privilege(
       'authenticated', 'public.conversations', 'seller_id', 'SELECT'
     ) THEN
    RAISE EXCEPTION
      'regression_failed: conversation dependency revoke escaped detection';
  END IF;
END;
$conversation_dependency_acl$;
GRANT SELECT (id, buyer_id, seller_id)
  ON TABLE public.conversations TO authenticated;

SET LOCAL ROLE supabase_realtime_admin;
REVOKE USAGE ON SCHEMA realtime FROM authenticated;
RESET ROLE;
DO $realtime_schema_dependency_acl$
BEGIN
  IF pg_catalog.has_schema_privilege(
    'authenticated', 'realtime', 'USAGE'
  ) THEN
    RAISE EXCEPTION
      'regression_failed: realtime schema revoke escaped detection';
  END IF;
END;
$realtime_schema_dependency_acl$;
SET LOCAL ROLE supabase_realtime_admin;
GRANT USAGE ON SCHEMA realtime TO authenticated;
RESET ROLE;

REVOKE USAGE ON SCHEMA auth FROM PUBLIC, authenticated;
DO $auth_schema_dependency_acl$
BEGIN
  IF pg_catalog.has_schema_privilege(
    'authenticated', 'auth', 'USAGE'
  ) THEN
    RAISE EXCEPTION
      'regression_failed: auth schema revoke escaped detection';
  END IF;
END;
$auth_schema_dependency_acl$;
GRANT USAGE ON SCHEMA auth TO authenticated;

REVOKE USAGE ON SCHEMA public FROM PUBLIC, authenticated;
DO $public_schema_dependency_acl$
BEGIN
  IF pg_catalog.has_schema_privilege(
    'authenticated', 'public', 'USAGE'
  ) THEN
    RAISE EXCEPTION
      'regression_failed: public schema revoke escaped detection';
  END IF;
END;
$public_schema_dependency_acl$;
GRANT USAGE ON SCHEMA public TO authenticated;

REVOKE USAGE ON SCHEMA private FROM authenticated;
DO $private_schema_dependency_acl$
BEGIN
  IF pg_catalog.has_schema_privilege(
    'authenticated', 'private', 'USAGE'
  ) THEN
    RAISE EXCEPTION
      'regression_failed: private schema revoke escaped detection';
  END IF;
END;
$private_schema_dependency_acl$;
GRANT USAGE ON SCHEMA private TO authenticated;

REVOKE EXECUTE ON FUNCTION realtime.topic() FROM PUBLIC, authenticated;
DO $topic_dependency_acl$
BEGIN
  IF pg_catalog.has_function_privilege(
    'authenticated', 'realtime.topic()', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'regression_failed: topic execute revoke escaped detection';
  END IF;
END;
$topic_dependency_acl$;
GRANT EXECUTE ON FUNCTION realtime.topic() TO authenticated;

REVOKE EXECUTE ON FUNCTION auth.uid() FROM PUBLIC, authenticated;
DO $uid_dependency_acl$
BEGIN
  IF pg_catalog.has_function_privilege(
    'authenticated', 'auth.uid()', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'regression_failed: uid execute revoke escaped detection';
  END IF;
END;
$uid_dependency_acl$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

REVOKE EXECUTE ON FUNCTION
  private.current_user_can_access_pair(uuid, uuid)
  FROM PUBLIC, authenticated;
DO $helper_dependency_acl$
BEGIN
  IF pg_catalog.has_function_privilege(
    'authenticated',
    'private.current_user_can_access_pair(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'regression_failed: helper execute revoke escaped detection';
  END IF;
END;
$helper_dependency_acl$;
GRANT EXECUTE ON FUNCTION
  private.current_user_can_access_pair(uuid, uuid)
  TO authenticated;

DO $roles$
BEGIN
  IF pg_catalog.to_regrole('realtime_acl_regression_parent') IS NULL THEN
    CREATE ROLE realtime_acl_regression_parent NOLOGIN;
  END IF;
  IF pg_catalog.to_regrole('realtime_acl_regression_delegate') IS NULL THEN
    CREATE ROLE realtime_acl_regression_delegate NOLOGIN;
  END IF;
END;
$roles$;

-- PUBLIC is never an acceptable managed base grantee.
SET LOCAL ROLE supabase_realtime_admin;
GRANT SELECT ON realtime.messages TO PUBLIC;
RESET ROLE;
DO $public_acl$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
    WHERE relation.oid = 'realtime.messages'::pg_catalog.regclass
      AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'regression_failed: PUBLIC ACL fixture escaped detection';
  END IF;
END;
$public_acl$;

-- API roles must never receive a grant option from the managed owner.
SET LOCAL ROLE supabase_realtime_admin;
GRANT SELECT ON realtime.messages TO anon WITH GRANT OPTION;
RESET ROLE;
DO $grant_option$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
    WHERE relation.oid = 'realtime.messages'::pg_catalog.regclass
      AND acl.grantee = pg_catalog.to_regrole('anon')::oid
      AND acl.is_grantable
  ) THEN
    RAISE EXCEPTION
      'regression_failed: grant-option fixture escaped detection';
  END IF;
END;
$grant_option$;

-- A parent role must not reintroduce a privilege through membership.
SET LOCAL ROLE supabase_realtime_admin;
GRANT SELECT ON realtime.messages TO realtime_acl_regression_parent;
RESET ROLE;
GRANT realtime_acl_regression_parent TO anon;
DO $inherited_acl$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
    WHERE relation.oid = 'realtime.messages'::pg_catalog.regclass
      AND acl.grantee =
        pg_catalog.to_regrole('realtime_acl_regression_parent')::oid
      AND pg_catalog.pg_has_role(
        pg_catalog.to_regrole('anon'), acl.grantee, 'MEMBER'
      )
  ) THEN
    RAISE EXCEPTION
      'regression_failed: inherited ACL fixture escaped detection';
  END IF;
END;
$inherited_acl$;

-- A delegate grant proves provenance cannot be inferred from the grantee.
SET LOCAL ROLE supabase_realtime_admin;
GRANT USAGE ON SCHEMA realtime TO realtime_acl_regression_delegate;
GRANT SELECT ON realtime.messages
  TO realtime_acl_regression_delegate WITH GRANT OPTION;
RESET ROLE;
SET LOCAL ROLE realtime_acl_regression_delegate;
GRANT SELECT ON realtime.messages TO authenticated;
RESET ROLE;
DO $unknown_grantor$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
    WHERE relation.oid = 'realtime.messages'::pg_catalog.regclass
      AND acl.grantee = pg_catalog.to_regrole('authenticated')::oid
      AND acl.grantor <>
        pg_catalog.to_regrole('supabase_realtime_admin')::oid
  ) THEN
    RAISE EXCEPTION
      'regression_failed: unknown grantor fixture escaped detection';
  END IF;
END;
$unknown_grantor$;

-- Column grants survive table-level reasoning and must be rejected explicitly.
SET LOCAL ROLE supabase_realtime_admin;
GRANT SELECT (topic) ON realtime.messages TO anon;
RESET ROLE;
DO $column_acl$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'realtime.messages'::pg_catalog.regclass
      AND attribute.attname = 'topic'
      AND attribute.attacl IS NOT NULL
      AND pg_catalog.cardinality(attribute.attacl) > 0
  ) THEN
    RAISE EXCEPTION 'regression_failed: column ACL fixture escaped detection';
  END IF;
END;
$column_acl$;

-- DELETE and PG17 MAINTAIN are not part of the accepted managed S/I/U base.
SET LOCAL ROLE supabase_realtime_admin;
GRANT DELETE ON realtime.messages TO authenticated;
RESET ROLE;
DO $dangerous_acl$
DECLARE
  maintain_detected integer := 0;
BEGIN
  IF NOT pg_catalog.has_table_privilege(
    'authenticated', 'realtime.messages', 'DELETE'
  ) THEN
    RAISE EXCEPTION 'regression_failed: dangerous ACL fixture escaped detection';
  END IF;

  IF pg_catalog.current_setting('server_version_num')::integer >= 170000 THEN
    EXECUTE 'GRANT MAINTAIN ON realtime.messages TO anon';
    EXECUTE $maintain$
      SELECT pg_catalog.count(*)::integer
      FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
        AS api(role_name)
      WHERE pg_catalog.has_table_privilege(
        api.role_name, 'realtime.messages', 'MAINTAIN'
      )
    $maintain$
    INTO maintain_detected;
    IF maintain_detected = 0 THEN
      RAISE EXCEPTION
        'regression_failed: MAINTAIN ACL fixture escaped detection';
    END IF;
  END IF;
END;
$dangerous_acl$;

ROLLBACK;
