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
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = pg_catalog.to_regclass('realtime.messages')
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'verify_failed: realtime.messages RLS is disabled';
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

  IF pg_catalog.has_table_privilege('anon', 'realtime.messages', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'realtime.messages', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'realtime.messages', 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', 'realtime.messages', 'DELETE')
     OR pg_catalog.has_table_privilege('anon', 'realtime.messages', 'TRUNCATE')
     OR pg_catalog.has_table_privilege('anon', 'realtime.messages', 'REFERENCES')
     OR pg_catalog.has_table_privilege('anon', 'realtime.messages', 'TRIGGER')
     OR NOT pg_catalog.has_table_privilege(
       'authenticated', 'realtime.messages', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'authenticated', 'realtime.messages', 'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'realtime.messages', 'UPDATE'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'realtime.messages', 'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'realtime.messages', 'TRUNCATE'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'realtime.messages', 'REFERENCES'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'realtime.messages', 'TRIGGER'
     ) THEN
    RAISE EXCEPTION 'verify_failed: realtime.messages API role grants drift';
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
