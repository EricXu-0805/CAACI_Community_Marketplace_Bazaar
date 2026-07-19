-- Reconcile the application-owned Realtime Authorization policy contract
-- without mutating Supabase-managed grants on realtime.messages.
--
-- Hosted Supabase owns this table with supabase_realtime_admin and protects
-- its ACLs from application migrations. The managed owner currently grants
-- SELECT/INSERT/UPDATE to API roles; RLS policies, not an application-side
-- REVOKE, authorize private Broadcast and Presence joins. Keep the two layers
-- explicit and fail closed on grant options, unmanaged grantors, column ACLs,
-- role inheritance, or non-RLS privileges.

BEGIN;
SET LOCAL search_path = public, pg_catalog;

DO $managed_realtime_guard$
DECLARE
  api_role_name text;
  owner_oid oid;
  owner_name text;
  maintain_mismatch_count integer := 0;
BEGIN
  IF pg_catalog.to_regclass('realtime.messages') IS NULL
     OR pg_catalog.to_regclass('public.conversations') IS NULL
     OR pg_catalog.to_regprocedure('realtime.topic()') IS NULL
     OR pg_catalog.to_regprocedure(
       'private.current_user_can_access_pair(uuid,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'managed_realtime_prerequisite_missing'
      USING ERRCODE = '55000';
  END IF;

  SELECT relation.relowner, owner_role.rolname
    INTO STRICT owner_oid, owner_name
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_roles AS owner_role
    ON owner_role.oid = relation.relowner
  WHERE relation.oid = 'realtime.messages'::pg_catalog.regclass;

  IF owner_name NOT IN ('supabase_admin', 'supabase_realtime_admin') THEN
    RAISE EXCEPTION 'managed_realtime_unexpected_owner: %', owner_name
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'realtime.messages'::pg_catalog.regclass
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'managed_realtime_rls_disabled'
      USING ERRCODE = '55000';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'authenticated', 'realtime.messages', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'authenticated', 'realtime.messages', 'INSERT'
     ) THEN
    RAISE EXCEPTION 'managed_realtime_authenticated_base_grant_missing'
      USING ERRCODE = '55000';
  END IF;

  -- 18280000 intentionally replaces conversations table SELECT with a
  -- column projection. Realtime policy evaluation needs exactly these lookup
  -- columns plus both schema traversals and the block/suspension helper.
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
    RAISE EXCEPTION 'managed_realtime_policy_dependency_grant_missing'
      USING ERRCODE = '55000';
  END IF;

  -- Same-name policy drift is repairable below. A third permissive policy is
  -- not: permissive policies are ORed, so refuse to stack beside one.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'realtime.messages'::pg_catalog.regclass
      AND policy.polname NOT IN (
        'Conversation participants can receive private realtime',
        'Conversation participants can send private realtime'
      )
  ) THEN
    RAISE EXCEPTION 'managed_realtime_unknown_policy'
      USING ERRCODE = '55000';
  END IF;

  -- anon/authenticated must never bypass the policy layer or inherit the
  -- managed table owner's implicit privileges.
  FOREACH api_role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS api_role
      WHERE api_role.rolname = api_role_name
        AND (
          api_role.rolsuper
          OR api_role.rolbypassrls
          OR api_role.oid = owner_oid
          OR pg_catalog.pg_has_role(api_role.oid, owner_oid, 'MEMBER')
          OR pg_catalog.pg_has_role(api_role.oid, owner_oid, 'USAGE')
        )
    ) THEN
      RAISE EXCEPTION 'managed_realtime_identity_bypasses_rls: %',
        api_role_name USING ERRCODE = '55000';
    END IF;
  END LOOP;

  -- The platform baseline is owner-issued, non-grantable S/I/U. Do not try to
  -- replace it. Reject PUBLIC, another grantor, grant options, and privileges
  -- that are not protected by the two SELECT/INSERT policies.
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
    RAISE EXCEPTION 'managed_realtime_direct_acl_provenance_drift'
      USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'managed_realtime_column_acl_drift'
      USING ERRCODE = '55000';
  END IF;

  -- A parent role can restore a privilege after the direct ACL is inspected.
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
    RAISE EXCEPTION 'managed_realtime_inherited_acl_drift'
      USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'managed_realtime_dangerous_effective_acl_drift'
      USING ERRCODE = '55000';
  END IF;

  -- PostgreSQL 17 adds MAINTAIN. Keep the migration parseable on PG16.
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
      RAISE EXCEPTION 'managed_realtime_maintain_acl_drift: %',
        maintain_mismatch_count USING ERRCODE = '55000';
    END IF;
  END IF;
END;
$managed_realtime_guard$;

DROP POLICY IF EXISTS
  "Conversation participants can receive private realtime"
  ON realtime.messages;
DROP POLICY IF EXISTS
  "Conversation participants can send private realtime"
  ON realtime.messages;

CREATE POLICY "Conversation participants can receive private realtime"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND EXISTS (
      SELECT 1
      FROM public.conversations AS conversation
      WHERE conversation.id = CASE
        WHEN (SELECT realtime.topic()) ~
          '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN pg_catalog.substr((SELECT realtime.topic()), 14)::uuid
        ELSE NULL
      END
        AND (SELECT auth.uid()) IN (
          conversation.buyer_id,
          conversation.seller_id
        )
        AND private.current_user_can_access_pair(
          conversation.buyer_id,
          conversation.seller_id
        )
    )
  );

CREATE POLICY "Conversation participants can send private realtime"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND EXISTS (
      SELECT 1
      FROM public.conversations AS conversation
      WHERE conversation.id = CASE
        WHEN (SELECT realtime.topic()) ~
          '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN pg_catalog.substr((SELECT realtime.topic()), 14)::uuid
        ELSE NULL
      END
        AND (SELECT auth.uid()) IN (
          conversation.buyer_id,
          conversation.seller_id
        )
        AND private.current_user_can_access_pair(
          conversation.buyer_id,
          conversation.seller_id
        )
    )
  );

DO $managed_realtime_postcondition$
DECLARE
  receive_qual text;
  send_check text;
  owner_oid oid;
  owner_name text;
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
    RAISE EXCEPTION 'managed_realtime_unexpected_owner: %', owner_name
      USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'managed_realtime_exact_policy_set_drift'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.pg_get_expr(
           policy.polqual, policy.polrelid, false
         )
    INTO STRICT receive_qual
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'realtime.messages'::pg_catalog.regclass
    AND policy.polname =
      'Conversation participants can receive private realtime';

  SELECT pg_catalog.pg_get_expr(
           policy.polwithcheck, policy.polrelid, false
         )
    INTO STRICT send_check
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'realtime.messages'::pg_catalog.regclass
    AND policy.polname =
      'Conversation participants can send private realtime';

  -- public is pinned first in search_path above. PG16 and hosted PG17 deparse
  -- this expression identically after whitespace removal; anchored equality
  -- rejects a third extension, changed helper arguments, operator changes, or
  -- any additional branch rather than merely counting familiar tokens.
  IF receive_qual IS NULL
     OR send_check IS NULL
     OR pg_catalog.regexp_replace(
       receive_qual, '[[:space:]]+', '', 'g'
     ) IS DISTINCT FROM expected_predicate
     OR pg_catalog.regexp_replace(
       send_check, '[[:space:]]+', '', 'g'
     ) IS DISTINCT FROM expected_predicate THEN
    RAISE EXCEPTION 'managed_realtime_exact_policy_predicate_drift'
      USING ERRCODE = '55000';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'authenticated', 'realtime.messages', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'authenticated', 'realtime.messages', 'INSERT'
     ) THEN
    RAISE EXCEPTION 'managed_realtime_authenticated_base_grant_missing'
      USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'managed_realtime_policy_dependency_grant_missing'
      USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'managed_realtime_identity_bypasses_rls'
      USING ERRCODE = '55000';
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
  )
  OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'realtime.messages'::pg_catalog.regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attacl IS NOT NULL
      AND pg_catalog.cardinality(attribute.attacl) > 0
  )
  OR EXISTS (
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
    RAISE EXCEPTION 'managed_realtime_acl_provenance_drift'
      USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'managed_realtime_dangerous_effective_acl_drift'
      USING ERRCODE = '55000';
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
      RAISE EXCEPTION 'managed_realtime_maintain_acl_drift: %',
        maintain_mismatch_count USING ERRCODE = '55000';
    END IF;
  END IF;
END;
$managed_realtime_postcondition$;

COMMIT;
