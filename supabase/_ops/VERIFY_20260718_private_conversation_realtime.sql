-- Read-only post-deploy verification for
-- 20260718240000_private_conversation_realtime.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  receive_qual text;
  send_check text;
  source_table text;
  owner_oid oid;
  owner_name text;
  maintain_mismatch_count integer := 0;
BEGIN
  SELECT relation.relowner, owner_role.rolname
    INTO STRICT owner_oid, owner_name
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_roles AS owner_role
    ON owner_role.oid = relation.relowner
  WHERE relation.oid = pg_catalog.to_regclass('realtime.messages');

  IF owner_name NOT IN ('supabase_admin', 'supabase_realtime_admin') THEN
    RAISE EXCEPTION 'verify_failed: unexpected managed Realtime owner %',
      owner_name;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = pg_catalog.to_regclass('realtime.messages')
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION
      'verify_failed: realtime.messages RLS is disabled; managed-schema owner intervention required';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
  ) <> 2 OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'realtime'
      AND policy.tablename = 'messages'
      AND (
        policy.permissive IS DISTINCT FROM 'PERMISSIVE'
        OR policy.roles IS DISTINCT FROM ARRAY['authenticated']::name[]
        OR (policy.policyname, policy.cmd) NOT IN (
          (
            'Conversation participants can receive private realtime',
            'SELECT'
          ),
          (
            'Conversation participants can send private realtime',
            'INSERT'
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'verify_failed: realtime.messages policy set drift';
  END IF;

  SELECT policy.qual
    INTO receive_qual
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'realtime'
    AND policy.tablename = 'messages'
    AND policy.policyname =
      'Conversation participants can receive private realtime';
  SELECT policy.with_check
    INTO send_check
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'realtime'
    AND policy.tablename = 'messages'
    AND policy.policyname =
      'Conversation participants can send private realtime';

  IF receive_qual IS NULL OR send_check IS NULL
     OR pg_catalog.strpos(receive_qual, 'realtime.topic') = 0
     OR pg_catalog.strpos(send_check, 'realtime.topic') = 0
     OR pg_catalog.strpos(receive_qual, 'conversation:') = 0
     OR pg_catalog.strpos(send_check, 'conversation:') = 0
     OR pg_catalog.strpos(receive_qual, 'current_user_can_access_pair') = 0
     OR pg_catalog.strpos(send_check, 'current_user_can_access_pair') = 0
     OR pg_catalog.strpos(receive_qual, 'broadcast') = 0
     OR pg_catalog.strpos(receive_qual, 'presence') = 0
     OR pg_catalog.strpos(send_check, 'broadcast') = 0
     OR pg_catalog.strpos(send_check, 'presence') = 0 THEN
    RAISE EXCEPTION 'verify_failed: participant/topic/extension predicate drift';
  END IF;

  -- realtime.messages is owned and ACL-managed by Supabase Realtime. Hosted
  -- projects intentionally retain owner-issued S/I/U for API roles; the exact
  -- authenticated SELECT/INSERT policies above are the authorization layer.
  -- Verify the supported managed boundary instead of demanding an unsupported
  -- application-side REVOKE of those base grants.
  IF NOT pg_catalog.has_table_privilege(
       'authenticated', 'realtime.messages', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'authenticated', 'realtime.messages', 'INSERT'
     ) THEN
    RAISE EXCEPTION
      'verify_failed: authenticated managed Realtime base grants are missing';
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
    WHERE relation.oid = pg_catalog.to_regclass('realtime.messages')
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
      'verify_failed: managed realtime.messages direct ACL provenance drift';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = pg_catalog.to_regclass('realtime.messages')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attacl IS NOT NULL
      AND pg_catalog.cardinality(attribute.attacl) > 0
  ) THEN
    RAISE EXCEPTION
      'verify_failed: managed realtime.messages column ACL drift';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS api(role_name)
    JOIN pg_catalog.pg_roles AS api_role ON api_role.rolname = api.role_name
    CROSS JOIN pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
    WHERE relation.oid = pg_catalog.to_regclass('realtime.messages')
      AND acl.grantee <> 0
      AND acl.grantee <> api_role.oid
      AND pg_catalog.pg_has_role(api_role.oid, acl.grantee, 'MEMBER')
  ) THEN
    RAISE EXCEPTION
      'verify_failed: inherited realtime.messages ACL drift';
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
      'verify_failed: dangerous effective realtime.messages ACL drift';
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
      RAISE EXCEPTION
        'verify_failed: realtime.messages MAINTAIN ACL drift %',
        maintain_mismatch_count;
    END IF;
  END IF;

  FOREACH source_table IN ARRAY ARRAY[
    'messages', 'offers', 'meetups', 'notifications'
  ] LOOP
    IF NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_class AS relation
         WHERE relation.oid = pg_catalog.to_regclass('public.' || source_table)
           AND relation.relrowsecurity
       )
       -- Realtime's WAL authorization is column-aware: it requires the primary
       -- key and emits only columns selectable by the subscriber role. The
       -- final app ACL intentionally replaces table-level SELECT with an exact
       -- projection, so verify the keys used by these subscriptions instead of
       -- requiring a future-column-expanding table grant.
       OR NOT pg_catalog.has_column_privilege(
         'authenticated', 'public.' || source_table, 'id', 'SELECT'
       )
       OR (
         source_table = 'messages'
         AND (
           NOT pg_catalog.has_column_privilege(
             'authenticated', 'public.messages', 'conversation_id', 'SELECT'
           )
           OR NOT pg_catalog.has_column_privilege(
             'authenticated', 'public.messages', 'sender_id', 'SELECT'
           )
         )
       )
       OR (
         source_table IN ('offers', 'meetups')
         AND NOT pg_catalog.has_column_privilege(
           'authenticated', 'public.' || source_table,
           'conversation_id', 'SELECT'
         )
       )
       OR (
         source_table = 'notifications'
         AND NOT pg_catalog.has_column_privilege(
           'authenticated', 'public.notifications', 'user_id', 'SELECT'
         )
       )
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_policy AS policy
         WHERE policy.polrelid = pg_catalog.to_regclass('public.' || source_table)
           AND policy.polcmd IN ('r', '*')
           AND (
             0::oid = ANY(policy.polroles)
             OR (
               SELECT role.oid
               FROM pg_catalog.pg_roles AS role
               WHERE role.rolname = 'authenticated'
             ) = ANY(policy.polroles)
           )
       )
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_publication_tables AS publication
         WHERE publication.pubname = 'supabase_realtime'
           AND publication.schemaname = 'public'
           AND publication.tablename = source_table
       ) THEN
      RAISE EXCEPTION
        'verify_failed: private Postgres Changes source % drift', source_table;
    END IF;
  END LOOP;
END;
$verify$;

SELECT policyname, cmd, roles
FROM pg_catalog.pg_policies
WHERE schemaname = 'realtime'
  AND tablename = 'messages'
ORDER BY policyname;

ROLLBACK;
