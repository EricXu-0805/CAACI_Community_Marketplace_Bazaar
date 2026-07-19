-- Read-only preflight for 20260717141822_enforce_symmetric_chat_block_boundary.sql.
-- Safe on production: this file does not create, update, or delete anything.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

-- This is a deployment gate, not merely an inventory query.  The policy
-- checks deliberately accept only the complete historical shape or the
-- complete post-migration shape.  An unknown permissive policy is dangerous
-- because PostgreSQL ORs permissive policies together, so fail closed instead
-- of guessing that it is safe to drop.
DO $precheck$
DECLARE
  policy_shape_ok boolean;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('blocks'),
      ('conversations'),
      ('messages'),
      ('offers'),
      ('meetups'),
      ('items'),
      ('notifications')
    ) AS required(table_name)
    WHERE pg_catalog.to_regclass('public.' || required.table_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'precheck_failed: required chat table is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('blocks', 'blocker_id'),
      ('blocks', 'blocked_id'),
      ('conversations', 'id'),
      ('conversations', 'item_id'),
      ('conversations', 'buyer_id'),
      ('conversations', 'seller_id'),
      ('messages', 'id'),
      ('messages', 'conversation_id'),
      ('offers', 'id'),
      ('offers', 'conversation_id'),
      ('meetups', 'id'),
      ('meetups', 'conversation_id'),
      ('items', 'id'),
      ('notifications', 'conversation_id')
    ) AS required(table_name, column_name)
    LEFT JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = pg_catalog.to_regclass(
        'public.' || required.table_name
      )
     AND attribute.attname = required.column_name
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    WHERE attribute.attname IS NULL
       OR pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) <> 'uuid'
  ) THEN
    RAISE EXCEPTION 'precheck_failed: required UUID chat column is missing or has the wrong type';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.items'::pg_catalog.regclass
      AND attribute.attname = 'status'
      AND attribute.atttypid = 'public.item_status'::pg_catalog.regtype
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.items'::pg_catalog.regclass
      AND attribute.attname = 'negotiable'
      AND attribute.atttypid = 'boolean'::pg_catalog.regtype
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'precheck_failed: required item lifecycle columns are missing or have the wrong type';
  END IF;

  -- First deployment starts from the historical signatures. A replay starts
  -- from the account-intent signatures (and normally also retains the revoked
  -- legacy overloads). Accept either exact identity per write RPC, never an
  -- arbitrary same-name overload.
  IF pg_catalog.to_regprocedure('public.get_last_messages(uuid[])') IS NULL
     OR EXISTS (
    SELECT 1
    FROM (VALUES
      (
        'public.make_offer(uuid,numeric,text)',
        'public.make_offer(uuid,numeric,uuid,text)'
      ),
      (
        'public.respond_to_offer(uuid,text,numeric,text)',
        'public.respond_to_offer(uuid,text,uuid,numeric,text)'
      ),
      (
        'public.propose_meetup(uuid,text,timestamp with time zone,text)',
        'public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)'
      ),
      (
        'public.respond_to_meetup(uuid,text,text,timestamp with time zone,text)',
        'public.respond_to_meetup(uuid,text,uuid,text,timestamp with time zone,text)'
      ),
      (
        'public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,text)',
        'public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,uuid,text)'
      )
    ) AS required(legacy_signature, intent_signature)
    WHERE pg_catalog.to_regprocedure(required.legacy_signature) IS NULL
      AND pg_catalog.to_regprocedure(required.intent_signature) IS NULL
  ) THEN
    RAISE EXCEPTION 'precheck_failed: required chat RPC signature is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS required(role_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = required.role_name
    )
  ) THEN
    RAISE EXCEPTION 'precheck_failed: required API role is missing';
  END IF;

  SELECT
    (
      pg_catalog.count(*) = 1
      AND pg_catalog.count(*) FILTER (
        WHERE policyname = 'Users manage own blocks' AND cmd = 'ALL'
      ) = 1
    ) OR (
      pg_catalog.count(*) = 3
      AND pg_catalog.count(*) FILTER (
        WHERE (policyname, cmd) IN (
          ('Blockers can view own blocks', 'SELECT'),
          ('Blockers can create own blocks', 'INSERT'),
          ('Blockers can remove own blocks', 'DELETE')
        )
      ) = 3
    )
  INTO policy_shape_ok
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'blocks'
    AND permissive = 'PERMISSIVE';
  IF NOT COALESCE(policy_shape_ok, false) THEN
    RAISE EXCEPTION 'precheck_failed: blocks permissive-policy set is not an approved complete shape';
  END IF;

  SELECT (pg_catalog.count(*) = 4 AND (
    pg_catalog.count(*) FILTER (
      WHERE (policyname, cmd) IN (
        ('Participants can view conversations', 'SELECT'),
        ('Authenticated users can create conversations', 'INSERT'),
        ('Participants can update conversations', 'UPDATE'),
        ('Participants can delete conversations', 'DELETE')
      )
    ) = 4
    OR pg_catalog.count(*) FILTER (
      WHERE (policyname, cmd) IN (
        ('Unblocked participants can view conversations', 'SELECT'),
        ('Unblocked buyers can create conversations', 'INSERT'),
        ('Unblocked participants can update conversations', 'UPDATE'),
        ('Unblocked participants can delete conversations', 'DELETE')
      )
    ) = 4
  )) OR (
    pg_catalog.to_regclass('public.conversation_archives') IS NOT NULL
    AND pg_catalog.count(*) = 3
    AND pg_catalog.count(*) FILTER (
      WHERE (policyname, cmd) IN (
        ('Unblocked participants can view conversations', 'SELECT'),
        ('Unblocked buyers can create conversations', 'INSERT'),
        ('Unblocked participants can update conversations', 'UPDATE')
      )
    ) = 3
  )
  INTO policy_shape_ok
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'conversations'
    AND permissive = 'PERMISSIVE';
  IF NOT COALESCE(policy_shape_ok, false) THEN
    RAISE EXCEPTION 'precheck_failed: conversations permissive-policy set is not an approved complete shape';
  END IF;

  SELECT (pg_catalog.count(*) = 4 AND (
    (
      pg_catalog.count(*) FILTER (
        WHERE policyname = 'Participants can view messages' AND cmd = 'SELECT'
      ) = 1
      AND pg_catalog.count(*) FILTER (
        WHERE policyname = 'Participants can send messages' AND cmd = 'INSERT'
      ) = 1
      AND pg_catalog.count(*) FILTER (
        WHERE policyname IN (
          'Participants can update messages',
          'Recipients can mark messages read'
        ) AND cmd = 'UPDATE'
      ) = 1
      AND pg_catalog.count(*) FILTER (
        WHERE policyname = 'Senders can delete own messages' AND cmd = 'DELETE'
      ) = 1
    ) OR pg_catalog.count(*) FILTER (
      WHERE (policyname, cmd) IN (
        ('Unblocked participants can view messages', 'SELECT'),
        ('Unblocked participants can send messages', 'INSERT'),
        ('Unblocked recipients can mark messages read', 'UPDATE'),
        ('Unblocked senders can delete own messages', 'DELETE')
      )
    ) = 4
  )) OR (
    pg_catalog.to_regclass('public.conversation_archives') IS NOT NULL
    AND pg_catalog.count(*) = 3
    AND pg_catalog.count(*) FILTER (
      WHERE (policyname, cmd) IN (
        ('Unblocked participants can view messages', 'SELECT'),
        ('Unblocked participants can send messages', 'INSERT'),
        ('Unblocked recipients can mark messages read', 'UPDATE')
      )
    ) = 3
  )
  INTO policy_shape_ok
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'messages'
    AND permissive = 'PERMISSIVE';
  IF NOT COALESCE(policy_shape_ok, false) THEN
    RAISE EXCEPTION 'precheck_failed: messages permissive-policy set is not an approved complete shape';
  END IF;

  SELECT pg_catalog.count(*) = 1
    AND pg_catalog.count(*) FILTER (
      WHERE policyname = 'offers_select' AND cmd = 'SELECT'
    ) = 1
  INTO policy_shape_ok
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'offers'
    AND permissive = 'PERMISSIVE';
  IF NOT COALESCE(policy_shape_ok, false) THEN
    RAISE EXCEPTION 'precheck_failed: offers permissive-policy set is not the approved shape';
  END IF;

  SELECT pg_catalog.count(*) = 1
    AND pg_catalog.count(*) FILTER (
      WHERE policyname = 'meetups_select' AND cmd = 'SELECT'
    ) = 1
  INTO policy_shape_ok
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'meetups'
    AND permissive = 'PERMISSIVE';
  IF NOT COALESCE(policy_shape_ok, false) THEN
    RAISE EXCEPTION 'precheck_failed: meetups permissive-policy set is not the approved shape';
  END IF;
END
$precheck$;

SELECT
  to_regclass('public.blocks') AS blocks_table,
  to_regclass('public.conversations') AS conversations_table,
  to_regclass('public.messages') AS messages_table,
  to_regclass('public.offers') AS offers_table,
  to_regclass('public.meetups') AS meetups_table,
  to_regclass('public.items') AS items_table,
  to_regclass('public.notifications') AS notifications_table;

SELECT
  to_regprocedure('public.get_last_messages(uuid[])') AS get_last_messages,
  to_regprocedure('public.make_offer(uuid,numeric,text)') AS legacy_make_offer,
  to_regprocedure('public.make_offer(uuid,numeric,uuid,text)') AS intent_make_offer,
  to_regprocedure('public.respond_to_offer(uuid,text,numeric,text)') AS legacy_respond_to_offer,
  to_regprocedure('public.respond_to_offer(uuid,text,uuid,numeric,text)') AS intent_respond_to_offer,
  to_regprocedure('public.propose_meetup(uuid,text,timestamp with time zone,text)') AS legacy_propose_meetup,
  to_regprocedure('public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)') AS intent_propose_meetup,
  to_regprocedure('public.respond_to_meetup(uuid,text,text,timestamp with time zone,text)') AS legacy_respond_to_meetup,
  to_regprocedure('public.respond_to_meetup(uuid,text,uuid,text,timestamp with time zone,text)') AS intent_respond_to_meetup,
  to_regprocedure('public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,text)') AS legacy_reschedule_accepted_meetup,
  to_regprocedure('public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,uuid,text)') AS intent_reschedule_accepted_meetup;

SELECT table_name, column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'blocks' AND column_name IN ('blocker_id', 'blocked_id'))
    OR (table_name = 'conversations' AND column_name IN ('id', 'item_id', 'buyer_id', 'seller_id'))
    OR (table_name IN ('messages', 'offers', 'meetups') AND column_name IN ('id', 'conversation_id'))
    OR (table_name = 'items' AND column_name IN ('id', 'status', 'negotiable'))
    OR (table_name = 'notifications' AND column_name = 'conversation_id')
  )
ORDER BY table_name, ordinal_position;

SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('blocks', 'conversations', 'messages', 'offers', 'meetups')
ORDER BY tablename, policyname;

ROLLBACK;
