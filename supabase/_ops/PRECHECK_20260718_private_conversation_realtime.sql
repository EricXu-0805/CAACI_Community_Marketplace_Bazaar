-- Read-only deployment gate for
-- 20260718240000_private_conversation_realtime.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  unexpected_policies text;
  source_table text;
BEGIN
  IF pg_catalog.to_regclass('realtime.messages') IS NULL
     OR pg_catalog.to_regclass('public.conversations') IS NULL
     OR pg_catalog.to_regprocedure('realtime.topic()') IS NULL
     OR pg_catalog.to_regprocedure(
       'private.current_user_can_access_pair(uuid,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: private Realtime dependency is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('realtime', 'messages', 'topic', 'text'),
      ('realtime', 'messages', 'extension', 'text'),
      ('public', 'conversations', 'id', 'uuid'),
      ('public', 'conversations', 'buyer_id', 'uuid'),
      ('public', 'conversations', 'seller_id', 'uuid')
    ) AS required(schema_name, table_name, column_name, formatted_type)
    LEFT JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = pg_catalog.to_regclass(
        required.schema_name || '.' || required.table_name
      )
     AND attribute.attname = required.column_name
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    WHERE attribute.attname IS NULL
       OR pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
          <> required.formatted_type
  ) THEN
    RAISE EXCEPTION 'precheck_failed: private Realtime column drift';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = pg_catalog.to_regclass('realtime.messages')
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'precheck_failed: realtime.messages RLS is disabled';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
    'authenticated', 'realtime.messages', 'SELECT'
  ) OR NOT pg_catalog.has_table_privilege(
    'authenticated', 'realtime.messages', 'INSERT'
  ) THEN
    RAISE EXCEPTION 'precheck_failed: authenticated Realtime base grants are missing';
  END IF;
  IF NOT pg_catalog.has_table_privilege(
       'authenticated', 'public.conversations', 'SELECT'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated',
       'private.current_user_can_access_pair(uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'precheck_failed: conversation Realtime dependency grants are missing';
  END IF;

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
        'precheck_failed: private Postgres Changes source % is not RLS/select/published ready',
        source_table;
    END IF;
  END LOOP;

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
    RAISE EXCEPTION 'precheck_failed: unexpected realtime.messages policies: %',
      unexpected_policies;
  END IF;
END;
$precheck$;

SELECT
  pg_catalog.count(*) AS existing_approved_policy_count
FROM pg_catalog.pg_policies
WHERE schemaname = 'realtime'
  AND tablename = 'messages';

ROLLBACK;
