-- Private, participant-only Realtime Presence/Broadcast for marketplace chat.
--
-- Client topics are exactly `conversation:<uuid>`. PostgreSQL Changes keep
-- their existing table RLS and also use private channels client-side; this
-- policy grants only the Broadcast/Presence capabilities needed by typing and
-- counterpart online state. Production's Realtime "Allow public access"
-- setting remains an explicit post-migration release gate.
--
-- Supabase documents that realtime.messages authorization controls Broadcast
-- and Presence, while both private and public channels may carry Postgres
-- Changes; those rows remain authorized by RLS on the source table:
-- https://supabase.com/docs/guides/realtime/authorization#interaction-with-postgres-changes

DO $migration_gate$
DECLARE
  unexpected_policies text;
  source_table text;
BEGIN
  IF pg_catalog.to_regclass('realtime.messages') IS NULL THEN
    RAISE EXCEPTION 'migration_blocked: realtime.messages is missing';
  END IF;
  IF pg_catalog.to_regclass('public.conversations') IS NULL
     OR pg_catalog.to_regprocedure('realtime.topic()') IS NULL
     OR pg_catalog.to_regprocedure(
       'private.current_user_can_access_pair(uuid,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'migration_blocked: conversation Realtime dependencies are missing';
  END IF;
  IF NOT pg_catalog.has_table_privilege(
       'authenticated', 'public.conversations', 'SELECT'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated',
       'private.current_user_can_access_pair(uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'migration_blocked: conversation Realtime dependency grants are missing';
  END IF;

  -- `private: true` does not route Postgres Changes through
  -- realtime.messages. Those subscriptions still require a published source
  -- table, authenticated SELECT, and source-table RLS. Prove every channel the
  -- H5 client opens before production is switched to private-only mode.
  FOREACH source_table IN ARRAY ARRAY[
    'messages', 'offers', 'meetups', 'notifications'
  ] LOOP
    IF pg_catalog.to_regclass('public.' || source_table) IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_class AS relation
         WHERE relation.oid = pg_catalog.to_regclass('public.' || source_table)
           AND relation.relrowsecurity
       )
       OR NOT pg_catalog.has_table_privilege(
         'authenticated', 'public.' || source_table, 'SELECT'
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
        'migration_blocked: private Postgres Changes source % is not RLS/select/published ready',
        source_table;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('topic', 'text'),
      ('extension', 'text')
    ) AS required(column_name, formatted_type)
    LEFT JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = pg_catalog.to_regclass('realtime.messages')
     AND attribute.attname = required.column_name
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    WHERE attribute.attname IS NULL
       OR pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
          <> required.formatted_type
  ) THEN
    RAISE EXCEPTION 'migration_blocked: realtime.messages column drift';
  END IF;

  -- Hosted Supabase owns realtime.messages with its managed Realtime role.
  -- The application migration must not try to ALTER that managed table as
  -- postgres. Realtime Authorization already requires RLS, so fail closed if
  -- the platform invariant is ever absent instead of attempting owner-only
  -- remediation here.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = pg_catalog.to_regclass('realtime.messages')
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION
      'migration_blocked: realtime.messages RLS is disabled; managed-schema owner intervention required';
  END IF;

  -- Permissive policies are ORed together. An unknown existing policy could
  -- bypass the participant predicate, so stop instead of silently stacking a
  -- restrictive policy beside it. Re-running this migration is still safe.
  SELECT pg_catalog.string_agg(policy.policyname, ', ' ORDER BY policy.policyname)
    INTO unexpected_policies
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'realtime'
    AND policy.tablename = 'messages'
    AND policy.policyname NOT IN (
      'Conversation participants can receive private realtime',
      'Conversation participants can send private realtime'
    );
  IF unexpected_policies IS NOT NULL THEN
    RAISE EXCEPTION 'migration_blocked: unexpected realtime.messages policies: %',
      unexpected_policies;
  END IF;
END;
$migration_gate$;

-- Public channels bypass Realtime Authorization at the service layer until
-- the Dashboard release gate is closed. At the database layer, anon receives
-- no capability and authenticated users need both these grants and RLS.
REVOKE ALL ON TABLE realtime.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE realtime.messages TO authenticated;

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
