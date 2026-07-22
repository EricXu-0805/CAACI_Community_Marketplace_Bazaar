-- Read-only verification for the forward-only managed Realtime policy contract.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = public, pg_catalog;

DO $verify$
DECLARE
  owner_oid oid;
  owner_name text;
  receive_qual text;
  send_check text;
  maintain_mismatch_count integer := 0;
  expected_predicate constant text := $predicate$((extension=ANY(ARRAY['broadcast'::text,'presence'::text]))AND(EXISTS(SELECT1FROMconversationsconversationWHERE((conversation.id=CASEWHEN((SELECTrealtime.topic()AStopic)~'^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text)THEN(substr((SELECTrealtime.topic()AStopic),14))::uuidELSENULL::uuidEND)AND(((SELECTauth.uid()ASuid)=conversation.buyer_id)OR((SELECTauth.uid()ASuid)=conversation.seller_id))ANDprivate.current_user_can_access_pair(conversation.buyer_id,conversation.seller_id)))))$predicate$;
BEGIN
  SELECT relation.relowner, owner_role.rolname
    INTO STRICT owner_oid, owner_name
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_roles AS owner_role
    ON owner_role.oid = relation.relowner
  WHERE relation.oid = 'realtime.messages'::pg_catalog.regclass;

  IF owner_name NOT IN ('supabase_admin', 'supabase_realtime_admin') THEN
    RAISE EXCEPTION 'verify_failed: unexpected managed Realtime owner %',
      owner_name;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'realtime.messages'::pg_catalog.regclass
      AND relation.relrowsecurity
  )
  OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'realtime.messages'::pg_catalog.regclass
  ) <> 2
  OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'realtime.messages'::pg_catalog.regclass
      AND (
        NOT policy.polpermissive
        OR policy.polroles IS DISTINCT FROM ARRAY[
          pg_catalog.to_regrole('authenticated')::oid
        ]
        OR (policy.polname, policy.polcmd) NOT IN (
          ('Conversation participants can receive private realtime', 'r'),
          ('Conversation participants can send private realtime', 'a')
        )
      )
  ) THEN
    RAISE EXCEPTION 'verify_failed: exact managed Realtime policy set drift';
  END IF;

  SELECT pg_catalog.pg_get_expr(policy.polqual, policy.polrelid, false)
    INTO STRICT receive_qual
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'realtime.messages'::pg_catalog.regclass
    AND policy.polname =
      'Conversation participants can receive private realtime';
  SELECT pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid, false)
    INTO STRICT send_check
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'realtime.messages'::pg_catalog.regclass
    AND policy.polname =
      'Conversation participants can send private realtime';

  IF receive_qual IS NULL
     OR send_check IS NULL
     OR pg_catalog.regexp_replace(
       receive_qual, '[[:space:]]+', '', 'g'
     ) IS DISTINCT FROM expected_predicate
     OR pg_catalog.regexp_replace(
       send_check, '[[:space:]]+', '', 'g'
     ) IS DISTINCT FROM expected_predicate THEN
    RAISE EXCEPTION
      'verify_failed: exact managed Realtime policy predicate drift';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'authenticated', 'realtime.messages', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'authenticated', 'realtime.messages', 'INSERT'
     ) THEN
    RAISE EXCEPTION
      'verify_failed: authenticated managed Realtime base grants missing';
  END IF;

  IF NOT pg_catalog.has_column_privilege(
       'authenticated', 'public.conversations', 'id', 'SELECT'
     )
     OR NOT pg_catalog.has_column_privilege(
       'authenticated', 'public.conversations', 'buyer_id', 'SELECT'
     )
     OR NOT pg_catalog.has_column_privilege(
       'authenticated', 'public.conversations', 'seller_id', 'SELECT'
     )
     OR NOT pg_catalog.has_schema_privilege(
       'authenticated', 'realtime', 'USAGE'
     )
     OR NOT pg_catalog.has_schema_privilege(
       'authenticated', 'auth', 'USAGE'
     )
     OR NOT pg_catalog.has_schema_privilege(
       'authenticated', 'public', 'USAGE'
     )
     OR NOT pg_catalog.has_schema_privilege(
       'authenticated', 'private', 'USAGE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', 'realtime.topic()', 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', 'auth.uid()', 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated',
       'private.current_user_can_access_pair(uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'verify_failed: managed Realtime policy dependency grants missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS api_role
    WHERE api_role.rolname IN ('anon', 'authenticated')
      AND (
        api_role.rolsuper
        OR api_role.rolbypassrls
        OR api_role.oid = owner_oid
        OR pg_catalog.pg_has_role(api_role.oid, owner_oid, 'MEMBER')
        OR pg_catalog.pg_has_role(api_role.oid, owner_oid, 'USAGE')
      )
  ) THEN
    RAISE EXCEPTION
      'verify_failed: anon/authenticated bypass managed Realtime RLS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
    LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE relation.oid = 'realtime.messages'::pg_catalog.regclass
      AND (
        acl.grantee = 0
        OR (
          grantee.rolname IN ('anon', 'authenticated', 'service_role')
          AND (
            acl.grantor <> owner_oid
            OR acl.is_grantable
            OR acl.privilege_type NOT IN ('SELECT', 'INSERT', 'UPDATE')
          )
        )
      )
  ) THEN
    RAISE EXCEPTION
      'verify_failed: managed Realtime direct ACL provenance drift';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'realtime.messages'::pg_catalog.regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attacl IS NOT NULL
      AND pg_catalog.cardinality(attribute.attacl) > 0
  ) THEN
    RAISE EXCEPTION 'verify_failed: managed Realtime column ACL drift';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS api(role_name)
    JOIN pg_catalog.pg_roles AS api_role ON api_role.rolname = api.role_name
    CROSS JOIN pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
    WHERE relation.oid = 'realtime.messages'::pg_catalog.regclass
      AND acl.grantee <> 0
      AND acl.grantee <> api_role.oid
      AND pg_catalog.pg_has_role(api_role.oid, acl.grantee, 'MEMBER')
  ) THEN
    RAISE EXCEPTION 'verify_failed: inherited managed Realtime ACL drift';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS api(role_name)
    CROSS JOIN (VALUES
      ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
    ) AS denied(privilege_type)
    WHERE pg_catalog.has_table_privilege(
      api.role_name, 'realtime.messages', denied.privilege_type
    )
  ) THEN
    RAISE EXCEPTION
      'verify_failed: dangerous effective managed Realtime ACL drift';
  END IF;

  IF pg_catalog.current_setting('server_version_num')::integer >= 170000 THEN
    EXECUTE $maintain$
      SELECT pg_catalog.count(*)::integer
      FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
        AS api(role_name)
      WHERE pg_catalog.has_table_privilege(
        api.role_name, 'realtime.messages', 'MAINTAIN'
      )
    $maintain$
    INTO maintain_mismatch_count;
    IF maintain_mismatch_count <> 0 THEN
      RAISE EXCEPTION 'verify_failed: managed Realtime MAINTAIN drift %',
        maintain_mismatch_count;
    END IF;
  END IF;
END;
$verify$;

SELECT policyname, cmd, roles, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'realtime'
  AND tablename = 'messages'
ORDER BY policyname;

ROLLBACK;
