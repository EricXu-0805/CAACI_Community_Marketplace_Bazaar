-- =============================================================================
-- Preserve private transaction history while keeping "delete conversation"
-- semantics local to one participant, and retain authoritative evidence for
-- reports even if trusted account-deletion/moderation maintenance later removes
-- the live target row.
--
-- This migration intentionally does not hard-delete any existing data.
-- Item/post image evidence here is URL metadata only. Storage deletion can make
-- those pointers unavailable; binary-media preservation needs a separately
-- authorized private moderation-retention design. The existing reports ->
-- reporter FK cascade is also unchanged, so reporter account deletion still
-- removes that reporter's history pending an explicit privacy/retention policy.
-- =============================================================================

-- Fail with a targeted error if this migration is replayed onto an unexpected
-- schema. The normal deployment path has all of these objects from migrations
-- 004/051/052/078 and the six 2026-07-17 audit migrations.
DO $migration$
DECLARE
  required_relation text;
  required_function text;
  required_column record;
BEGIN
  FOREACH required_relation IN ARRAY ARRAY[
    'public.profiles',
    'public.items',
    'public.posts',
    'public.post_comments',
    'public.conversations',
    'public.messages',
    'public.offers',
    'public.meetups',
    'public.blocks',
    'public.reports'
  ] LOOP
    IF pg_catalog.to_regclass(required_relation) IS NULL THEN
      RAISE EXCEPTION 'migration_precheck_failed: missing relation %',
        required_relation;
    END IF;
  END LOOP;

  FOREACH required_function IN ARRAY ARRAY[
    'auth.uid()',
    'private.current_user_can_access_pair(uuid,uuid)',
    'public.admin_get_report_detail(uuid)'
  ] LOOP
    IF pg_catalog.to_regprocedure(required_function) IS NULL THEN
      RAISE EXCEPTION 'migration_precheck_failed: missing function %',
      required_function;
    END IF;
  END LOOP;

  FOR required_column IN
    SELECT spec.table_name, column_name
    FROM (VALUES
      ('profiles', ARRAY[
        'id', 'nickname', 'avatar_url', 'bio', 'status_text', 'status_emoji',
        'created_at'
      ]::text[]),
      ('items', ARRAY[
        'id', 'user_id', 'title', 'description', 'images', 'status',
        'created_at'
      ]::text[]),
      ('posts', ARRAY[
        'id', 'user_id', 'content', 'images', 'status', 'created_at'
      ]::text[]),
      ('post_comments', ARRAY[
        'id', 'post_id', 'user_id', 'content', 'status', 'created_at'
      ]::text[]),
      ('conversations', ARRAY['id', 'buyer_id', 'seller_id']::text[]),
      ('messages', ARRAY[
        'id', 'conversation_id', 'sender_id', 'content', 'message_type',
        'created_at'
      ]::text[]),
      ('blocks', ARRAY['blocker_id', 'blocked_id']::text[]),
      ('reports', ARRAY[
        'id', 'reporter_id', 'target_type', 'target_id', 'reason', 'note',
        'status', 'created_at'
      ]::text[])
    ) AS spec(table_name, column_names)
    CROSS JOIN LATERAL pg_catalog.unnest(spec.column_names) AS column_name
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS actual_column
      WHERE actual_column.table_schema = 'public'
        AND actual_column.table_name = required_column.table_name
        AND actual_column.column_name = required_column.column_name
    ) THEN
      RAISE EXCEPTION 'migration_precheck_failed: missing column public.%.%',
        required_column.table_name,
      required_column.column_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS protected_relation
    WHERE protected_relation.oid IN (
      'public.profiles'::pg_catalog.regclass,
      'public.items'::pg_catalog.regclass,
      'public.posts'::pg_catalog.regclass,
      'public.post_comments'::pg_catalog.regclass,
      'public.conversations'::pg_catalog.regclass,
      'public.messages'::pg_catalog.regclass,
      'public.blocks'::pg_catalog.regclass,
      'public.reports'::pg_catalog.regclass
    )
      AND NOT protected_relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: report visibility dependency has RLS disabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('profiles', 'Public profile rows readable'),
      ('items', 'Anyone can view active items'),
      ('posts', 'Anyone can view active posts'),
      ('post_comments', 'Anyone can view comments')
    ) AS expected_policy(table_name, policy_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies AS actual_policy
      WHERE actual_policy.schemaname = 'public'
        AND actual_policy.tablename = expected_policy.table_name
        AND actual_policy.policyname = expected_policy.policy_name
        AND actual_policy.cmd = 'SELECT'
        AND actual_policy.permissive = 'PERMISSIVE'
    )
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: public target visibility policy drift';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS report_policy
    WHERE report_policy.schemaname = 'public'
      AND report_policy.tablename = 'reports'
      AND report_policy.policyname = 'Users can create reports'
      AND report_policy.cmd = 'INSERT'
      AND report_policy.permissive = 'PERMISSIVE'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS report_policy
    WHERE report_policy.schemaname = 'public'
      AND report_policy.tablename = 'reports'
      AND report_policy.policyname = 'Users can view own reports'
      AND report_policy.cmd = 'SELECT'
      AND report_policy.permissive = 'PERMISSIVE'
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: report insert/read policy drift';
  END IF;

  FOR required_column IN
    SELECT spec.table_name, column_name
    FROM (VALUES
      ('profiles', ARRAY[
        'id', 'nickname', 'avatar_url', 'bio', 'status_text', 'status_emoji',
        'created_at'
      ]::text[]),
      ('items', ARRAY[
        'id', 'user_id', 'title', 'description', 'images', 'status',
        'created_at'
      ]::text[]),
      ('posts', ARRAY[
        'id', 'user_id', 'content', 'images', 'status', 'created_at'
      ]::text[]),
      ('post_comments', ARRAY[
        'id', 'post_id', 'user_id', 'content', 'status', 'created_at'
      ]::text[]),
      ('conversations', ARRAY['id', 'buyer_id', 'seller_id']::text[]),
      ('messages', ARRAY[
        'id', 'conversation_id', 'sender_id', 'content', 'message_type',
        'created_at'
      ]::text[])
    ) AS spec(table_name, column_names)
    CROSS JOIN LATERAL pg_catalog.unnest(spec.column_names) AS column_name
  LOOP
    IF NOT pg_catalog.has_column_privilege(
      'authenticated',
      pg_catalog.format('public.%I', required_column.table_name),
      required_column.column_name,
      'SELECT'
    ) THEN
      RAISE EXCEPTION
        'migration_precheck_failed: authenticated lacks SELECT on public.%.%',
        required_column.table_name,
        required_column.column_name;
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'private.current_user_can_access_pair(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: authenticated cannot evaluate block visibility';
  END IF;
END
$migration$;

-- -----------------------------------------------------------------------------
-- 1. Per-participant conversation archive state.
--
-- The shared conversation and its evidence remain intact. A row here means the
-- conversation is hidden from that user's inbox until a new message, offer, or
-- meaningful meetup/offer state change clears the archive. The application can
-- migrate from its old hard-delete button to this RPC without changing any
-- shared chat rows.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversation_archives (
  user_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL
    REFERENCES public.conversations(id) ON DELETE CASCADE,
  archived_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (user_id, conversation_id)
);

-- CREATE TABLE IF NOT EXISTS must not silently accept a same-named but
-- incompatible manual table on a partial/replayed rollout.
DO $migration$
DECLARE
  archived_at_default text;
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM information_schema.columns AS actual
    WHERE actual.table_schema = 'public'
      AND actual.table_name = 'conversation_archives'
  ) <> 3 THEN
    RAISE EXCEPTION
      'migration_precheck_failed: conversation_archives must have exactly 3 columns';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('user_id', 'uuid'::text, true),
      ('conversation_id', 'uuid'::text, true),
      ('archived_at', 'timestamp with time zone'::text, true)
    ) AS expected(column_name, data_type, is_not_null)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = 'conversation_archives'
        AND actual.column_name = expected.column_name
        AND actual.data_type = expected.data_type
        AND (actual.is_nullable = 'NO') = expected.is_not_null
    )
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: incompatible public.conversation_archives columns';
  END IF;

  SELECT pg_catalog.pg_get_expr(
    attribute.adbin,
    attribute.adrelid
  )
  INTO archived_at_default
  FROM pg_catalog.pg_attrdef AS attribute
  INNER JOIN pg_catalog.pg_attribute AS column_definition
    ON column_definition.attrelid = attribute.adrelid
   AND column_definition.attnum = attribute.adnum
  WHERE attribute.adrelid =
    'public.conversation_archives'::pg_catalog.regclass
    AND column_definition.attname = 'archived_at'
    AND NOT column_definition.attisdropped;

  IF archived_at_default IS NULL
     OR archived_at_default NOT IN ('now()', 'pg_catalog.now()') THEN
    RAISE EXCEPTION
      'migration_precheck_failed: conversation_archives archived_at default mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS table_constraint
    WHERE table_constraint.conrelid =
      'public.conversation_archives'::pg_catalog.regclass
      AND table_constraint.contype = 'p'
      AND table_constraint.conkey = ARRAY[
        (
          SELECT attribute.attnum
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid =
            'public.conversation_archives'::pg_catalog.regclass
            AND attribute.attname = 'user_id'
            AND NOT attribute.attisdropped
        ),
        (
          SELECT attribute.attnum
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid =
            'public.conversation_archives'::pg_catalog.regclass
            AND attribute.attname = 'conversation_id'
            AND NOT attribute.attisdropped
        )
      ]::smallint[]
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: conversation_archives primary key mismatch';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_constraint AS table_constraint
    WHERE table_constraint.conrelid =
      'public.conversation_archives'::pg_catalog.regclass
      AND table_constraint.contype = 'p'
  ) <> 1 THEN
    RAISE EXCEPTION
      'migration_precheck_failed: conversation_archives primary key count mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS foreign_key
    WHERE foreign_key.conrelid =
      'public.conversation_archives'::pg_catalog.regclass
      AND foreign_key.contype = 'f'
      AND foreign_key.convalidated
      AND foreign_key.confdeltype = 'c'
      AND foreign_key.confrelid = 'public.profiles'::pg_catalog.regclass
      AND foreign_key.conkey = ARRAY[
        (
          SELECT column_definition.attnum
          FROM pg_catalog.pg_attribute AS column_definition
          WHERE column_definition.attrelid =
            'public.conversation_archives'::pg_catalog.regclass
            AND column_definition.attname = 'user_id'
            AND NOT column_definition.attisdropped
        )
      ]::smallint[]
      AND foreign_key.confkey = ARRAY[
        (
          SELECT column_definition.attnum
          FROM pg_catalog.pg_attribute AS column_definition
          WHERE column_definition.attrelid =
            'public.profiles'::pg_catalog.regclass
            AND column_definition.attname = 'id'
            AND NOT column_definition.attisdropped
        )
      ]::smallint[]
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS foreign_key
    WHERE foreign_key.conrelid =
      'public.conversation_archives'::pg_catalog.regclass
      AND foreign_key.contype = 'f'
      AND foreign_key.convalidated
      AND foreign_key.confdeltype = 'c'
      AND foreign_key.confrelid = 'public.conversations'::pg_catalog.regclass
      AND foreign_key.conkey = ARRAY[
        (
          SELECT column_definition.attnum
          FROM pg_catalog.pg_attribute AS column_definition
          WHERE column_definition.attrelid =
            'public.conversation_archives'::pg_catalog.regclass
            AND column_definition.attname = 'conversation_id'
            AND NOT column_definition.attisdropped
        )
      ]::smallint[]
      AND foreign_key.confkey = ARRAY[
        (
          SELECT column_definition.attnum
          FROM pg_catalog.pg_attribute AS column_definition
          WHERE column_definition.attrelid =
            'public.conversations'::pg_catalog.regclass
            AND column_definition.attname = 'id'
            AND NOT column_definition.attisdropped
        )
      ]::smallint[]
  ) OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_constraint AS foreign_key
    WHERE foreign_key.conrelid =
      'public.conversation_archives'::pg_catalog.regclass
      AND foreign_key.contype = 'f'
  ) <> 2 THEN
    RAISE EXCEPTION
      'migration_precheck_failed: conversation_archives foreign keys mismatch';
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS conversation_archives_conversation_idx
  ON public.conversation_archives(conversation_id);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_relation
    INNER JOIN pg_catalog.pg_index AS index_definition
      ON index_definition.indexrelid = index_relation.oid
    WHERE index_relation.oid =
      pg_catalog.to_regclass('public.conversation_archives_conversation_idx')
      AND index_definition.indrelid =
        'public.conversation_archives'::pg_catalog.regclass
      AND index_definition.indisvalid
      AND index_definition.indisready
      AND index_definition.indpred IS NULL
      AND index_definition.indexprs IS NULL
      AND index_definition.indnkeyatts = 1
      AND index_definition.indkey::text = (
        SELECT column_definition.attnum::text
        FROM pg_catalog.pg_attribute AS column_definition
        WHERE column_definition.attrelid =
          'public.conversation_archives'::pg_catalog.regclass
          AND column_definition.attname = 'conversation_id'
          AND NOT column_definition.attisdropped
        )
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: conversation archive lookup index mismatch';
  END IF;
END
$migration$;

ALTER TABLE public.conversation_archives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own conversation archives"
  ON public.conversation_archives;
CREATE POLICY "Users can view own conversation archives"
  ON public.conversation_archives
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.conversation_archives FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conversation_archives TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_archives
  TO service_role;

CREATE OR REPLACE FUNCTION public.archive_conversation(
  conversation_id_in uuid,
  expected_user_id_in uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS NULL OR expected_user_id_in <> caller_id THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;
  IF conversation_id_in IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.conversations AS conversation
    WHERE conversation.id = conversation_id_in
      AND caller_id IN (conversation.buyer_id, conversation.seller_id)
  ) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;

  -- Serialize archive intent with activity-trigger clearing. If activity wins
  -- after an archive it reopens the inbox row; if the user archives after the
  -- activity commits, their later explicit intent remains authoritative.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(conversation_id_in::text, 20260718)
  );

  INSERT INTO public.conversation_archives AS archive (
    user_id,
    conversation_id,
    archived_at
  ) VALUES (
    caller_id,
    conversation_id_in,
    pg_catalog.statement_timestamp()
  )
  ON CONFLICT (user_id, conversation_id) DO UPDATE
  SET archived_at = EXCLUDED.archived_at;
END
$function$;

REVOKE ALL ON FUNCTION public.archive_conversation(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.archive_conversation(uuid, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_conversation_archives_on_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.conversation_id::text, 20260718)
  );

  DELETE FROM public.conversation_archives AS archive
  WHERE archive.conversation_id = NEW.conversation_id;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.clear_conversation_archives_on_activity()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_clear_archives_message_insert ON public.messages;
CREATE TRIGGER trg_clear_archives_message_insert
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_conversation_archives_on_activity();

DROP TRIGGER IF EXISTS trg_clear_archives_offer_insert ON public.offers;
CREATE TRIGGER trg_clear_archives_offer_insert
  AFTER INSERT ON public.offers
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_conversation_archives_on_activity();

DROP TRIGGER IF EXISTS trg_clear_archives_offer_update ON public.offers;
CREATE TRIGGER trg_clear_archives_offer_update
  AFTER UPDATE OF status ON public.offers
  FOR EACH ROW
  -- Expiry is a background lifecycle transition and does not emit a realtime
  -- notification. Reopening an archived row here would therefore create a
  -- cross-device inbox entry with no user-visible activity to explain it.
  WHEN (
    NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status <> 'expired'
  )
  EXECUTE FUNCTION public.clear_conversation_archives_on_activity();

DROP TRIGGER IF EXISTS trg_clear_archives_meetup_insert ON public.meetups;
CREATE TRIGGER trg_clear_archives_meetup_insert
  AFTER INSERT ON public.meetups
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_conversation_archives_on_activity();

DROP TRIGGER IF EXISTS trg_clear_archives_meetup_update ON public.meetups;
CREATE TRIGGER trg_clear_archives_meetup_update
  AFTER UPDATE OF status, spot, meet_at, note ON public.meetups
  FOR EACH ROW
  WHEN (
    (
      NEW.status IS DISTINCT FROM OLD.status
      OR NEW.spot IS DISTINCT FROM OLD.spot
      OR NEW.meet_at IS DISTINCT FROM OLD.meet_at
      OR NEW.note IS DISTINCT FROM OLD.note
    )
    -- A pure background pending -> expired transition has no notification and
    -- is not new conversation activity. If place/time/note changes in the same
    -- write, it remains a real signal and still clears the archive.
    AND NOT (
      NEW.status = 'expired'
      AND NEW.status IS DISTINCT FROM OLD.status
      AND NEW.spot IS NOT DISTINCT FROM OLD.spot
      AND NEW.meet_at IS NOT DISTINCT FROM OLD.meet_at
      AND NEW.note IS NOT DISTINCT FROM OLD.note
    )
  )
  EXECUTE FUNCTION public.clear_conversation_archives_on_activity();

-- A participant may no longer erase the counterparty's shared evidence. Hard
-- deletes remain available to trusted owner/service/account-deletion cascades.
REVOKE DELETE ON public.conversations FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Participants can delete conversations"
  ON public.conversations;
DROP POLICY IF EXISTS "Unblocked participants can delete conversations"
  ON public.conversations;

REVOKE DELETE ON public.messages FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Senders can delete own messages" ON public.messages;
DROP POLICY IF EXISTS "Unblocked senders can delete own messages"
  ON public.messages;

-- -----------------------------------------------------------------------------
-- 2. Server-authored evidence snapshot for every reportable target.
-- -----------------------------------------------------------------------------
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS target_snapshot jsonb;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reports'
      AND column_name = 'target_snapshot'
      AND data_type = 'jsonb'
      AND is_nullable = 'YES'
      AND column_default IS NULL
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: reports.target_snapshot shape mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'reports_target_snapshot_object'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS snapshot_constraint
    WHERE snapshot_constraint.conrelid = 'public.reports'::pg_catalog.regclass
      AND snapshot_constraint.conname = 'reports_target_snapshot_object'
      AND snapshot_constraint.contype = 'c'
      AND pg_catalog.pg_get_expr(
        snapshot_constraint.conbin,
        snapshot_constraint.conrelid
      ) = '((target_snapshot IS NULL) OR (jsonb_typeof(target_snapshot) = ''object''::text))'
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: reports_target_snapshot_object mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.reports'::pg_catalog.regclass
      AND conname = 'reports_target_snapshot_object'
  ) THEN
    ALTER TABLE public.reports
      ADD CONSTRAINT reports_target_snapshot_object
      CHECK (
        target_snapshot IS NULL
        OR pg_catalog.jsonb_typeof(target_snapshot) = 'object'
      ) NOT VALID;
  END IF;
END
$migration$;

ALTER TABLE public.reports
  VALIDATE CONSTRAINT reports_target_snapshot_object;

-- Preserve trustworthy evidence only where the target is still visible under
-- the public product contract. Old reports were not target-validated, so
-- hidden/arbitrary legacy IDs must never be upgraded into a data-exfiltration
-- path for the reporter who can SELECT their own reports.
UPDATE public.reports AS report
SET target_snapshot = pg_catalog.jsonb_build_object(
  'target_type', 'message',
  'target_id', message.id,
  'target_user_id', message.sender_id,
  'target_user_nickname', target_profile.nickname,
  'message_id', message.id,
  'conversation_id', message.conversation_id,
  'sender_id', message.sender_id,
  'content', message.content,
  'message_type', message.message_type,
  'created_at', message.created_at,
  'captured_at', pg_catalog.statement_timestamp()
)
FROM public.messages AS message
INNER JOIN public.conversations AS conversation
  ON conversation.id = message.conversation_id
INNER JOIN public.profiles AS target_profile
  ON target_profile.id = message.sender_id
WHERE report.target_type = 'message'
  AND report.target_id = message.id
  AND report.target_snapshot IS NULL
  AND report.reporter_id IN (conversation.buyer_id, conversation.seller_id)
  AND report.reporter_id <> message.sender_id
  AND NOT EXISTS (
    SELECT 1
    FROM public.blocks AS block_relation
    WHERE (
      block_relation.blocker_id = conversation.buyer_id
      AND block_relation.blocked_id = conversation.seller_id
    ) OR (
      block_relation.blocker_id = conversation.seller_id
      AND block_relation.blocked_id = conversation.buyer_id
    )
  );

UPDATE public.reports AS report
SET target_snapshot = pg_catalog.jsonb_build_object(
  'target_type', 'item',
  'target_id', item.id,
  'target_user_id', item.user_id,
  'target_user_nickname', target_profile.nickname,
  'title', item.title,
  'description', item.description,
  'images', item.images,
  'created_at', item.created_at,
  'captured_at', pg_catalog.statement_timestamp()
)
FROM public.items AS item
INNER JOIN public.profiles AS target_profile
  ON target_profile.id = item.user_id
WHERE report.target_type = 'item'
  AND report.target_id = item.id
  AND report.target_snapshot IS NULL
  AND report.reporter_id <> item.user_id
  AND item.status <> 'deleted'::public.item_status;

UPDATE public.reports AS report
SET target_snapshot = pg_catalog.jsonb_build_object(
  'target_type', 'post',
  'target_id', post.id,
  'target_user_id', post.user_id,
  'target_user_nickname', target_profile.nickname,
  'content', post.content,
  'images', post.images,
  'created_at', post.created_at,
  'captured_at', pg_catalog.statement_timestamp()
)
FROM public.posts AS post
INNER JOIN public.profiles AS target_profile
  ON target_profile.id = post.user_id
WHERE report.target_type = 'post'
  AND report.target_id = post.id
  AND report.target_snapshot IS NULL
  AND report.reporter_id <> post.user_id
  AND post.status = 'active';

UPDATE public.reports AS report
SET target_snapshot = pg_catalog.jsonb_build_object(
  'target_type', 'comment',
  'target_id', comment.id,
  'target_user_id', comment.user_id,
  'target_user_nickname', target_profile.nickname,
  'post_id', comment.post_id,
  'content', comment.content,
  'created_at', comment.created_at,
  'captured_at', pg_catalog.statement_timestamp()
)
FROM public.post_comments AS comment
INNER JOIN public.posts AS parent_post
  ON parent_post.id = comment.post_id
INNER JOIN public.profiles AS target_profile
  ON target_profile.id = comment.user_id
WHERE report.target_type = 'comment'
  AND report.target_id = comment.id
  AND report.target_snapshot IS NULL
  AND report.reporter_id <> comment.user_id
  AND comment.status = 'active'
  AND parent_post.status = 'active';

UPDATE public.reports AS report
SET target_snapshot = pg_catalog.jsonb_build_object(
  'target_type', 'user',
  'target_id', target_profile.id,
  'target_user_id', target_profile.id,
  'target_user_nickname', target_profile.nickname,
  'avatar_url', target_profile.avatar_url,
  'bio', target_profile.bio,
  'status_text', target_profile.status_text,
  'status_emoji', target_profile.status_emoji,
  'created_at', target_profile.created_at,
  'captured_at', pg_catalog.statement_timestamp()
)
FROM public.profiles AS target_profile
WHERE report.target_type = 'user'
  AND report.target_id = target_profile.id
  AND report.target_snapshot IS NULL
  AND report.reporter_id <> target_profile.id;

CREATE OR REPLACE FUNCTION public.capture_report_target_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  reported_target record;
BEGIN
  -- Invoker rights deliberately keep RLS and column grants in force. Explicit
  -- predicates below mirror the product's current reportable states and make
  -- the contract reviewable even if an RLS policy is later broadened.
  IF caller_id IS NOT NULL AND caller_id <> NEW.reporter_id THEN
    RAISE EXCEPTION 'report_target_unavailable' USING ERRCODE = '42501';
  END IF;

  IF NEW.target_type = 'message' THEN
    SELECT
      message.id,
      message.conversation_id,
      message.sender_id,
      message.content,
      message.message_type,
      message.created_at,
      conversation.buyer_id,
      conversation.seller_id,
      target_profile.nickname AS target_user_nickname
    INTO reported_target
    FROM public.messages AS message
    INNER JOIN public.conversations AS conversation
      ON conversation.id = message.conversation_id
    INNER JOIN public.profiles AS target_profile
      ON target_profile.id = message.sender_id
    WHERE message.id = NEW.target_id
      AND NEW.reporter_id IN (
        conversation.buyer_id,
        conversation.seller_id
      )
      AND NEW.reporter_id <> message.sender_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'report_target_unavailable' USING ERRCODE = '42501';
    END IF;

    -- Coordinate with the symmetric block migration. Rechecking blocks after
    -- the shared pair lock closes the report-vs-block race without revealing
    -- who blocked whom.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        LEAST(
          reported_target.buyer_id::text,
          reported_target.seller_id::text
        ) || ':' || GREATEST(
          reported_target.buyer_id::text,
          reported_target.seller_id::text
        ),
        0
      )
    );

    IF (
      caller_id IS NOT NULL
      AND NOT private.current_user_can_access_pair(
        reported_target.buyer_id,
        reported_target.seller_id
      )
    ) OR (
      caller_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.blocks AS block_relation
        WHERE (
          block_relation.blocker_id = reported_target.buyer_id
          AND block_relation.blocked_id = reported_target.seller_id
        ) OR (
          block_relation.blocker_id = reported_target.seller_id
          AND block_relation.blocked_id = reported_target.buyer_id
        )
      )
    ) THEN
      RAISE EXCEPTION 'report_target_unavailable' USING ERRCODE = '42501';
    END IF;

    NEW.target_snapshot := pg_catalog.jsonb_build_object(
      'target_type', 'message',
      'target_id', reported_target.id,
      'target_user_id', reported_target.sender_id,
      'target_user_nickname', reported_target.target_user_nickname,
      'message_id', reported_target.id,
      'conversation_id', reported_target.conversation_id,
      'sender_id', reported_target.sender_id,
      'content', reported_target.content,
      'message_type', reported_target.message_type,
      'created_at', reported_target.created_at,
      'captured_at', pg_catalog.statement_timestamp()
    );
  ELSIF NEW.target_type = 'item' THEN
    SELECT
      item.id,
      item.user_id,
      item.title,
      item.description,
      item.images,
      item.created_at,
      target_profile.nickname AS target_user_nickname
    INTO reported_target
    FROM public.items AS item
    INNER JOIN public.profiles AS target_profile
      ON target_profile.id = item.user_id
    WHERE item.id = NEW.target_id
      AND item.status <> 'deleted'::public.item_status
      AND item.user_id <> NEW.reporter_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'report_target_unavailable' USING ERRCODE = '42501';
    END IF;

    NEW.target_snapshot := pg_catalog.jsonb_build_object(
      'target_type', 'item',
      'target_id', reported_target.id,
      'target_user_id', reported_target.user_id,
      'target_user_nickname', reported_target.target_user_nickname,
      'title', reported_target.title,
      'description', reported_target.description,
      'images', reported_target.images,
      'created_at', reported_target.created_at,
      'captured_at', pg_catalog.statement_timestamp()
    );
  ELSIF NEW.target_type = 'post' THEN
    SELECT
      post.id,
      post.user_id,
      post.content,
      post.images,
      post.created_at,
      target_profile.nickname AS target_user_nickname
    INTO reported_target
    FROM public.posts AS post
    INNER JOIN public.profiles AS target_profile
      ON target_profile.id = post.user_id
    WHERE post.id = NEW.target_id
      AND post.status = 'active'
      AND post.user_id <> NEW.reporter_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'report_target_unavailable' USING ERRCODE = '42501';
    END IF;

    NEW.target_snapshot := pg_catalog.jsonb_build_object(
      'target_type', 'post',
      'target_id', reported_target.id,
      'target_user_id', reported_target.user_id,
      'target_user_nickname', reported_target.target_user_nickname,
      'content', reported_target.content,
      'images', reported_target.images,
      'created_at', reported_target.created_at,
      'captured_at', pg_catalog.statement_timestamp()
    );
  ELSIF NEW.target_type = 'comment' THEN
    SELECT
      comment.id,
      comment.post_id,
      comment.user_id,
      comment.content,
      comment.created_at,
      target_profile.nickname AS target_user_nickname
    INTO reported_target
    FROM public.post_comments AS comment
    INNER JOIN public.posts AS parent_post
      ON parent_post.id = comment.post_id
    INNER JOIN public.profiles AS target_profile
      ON target_profile.id = comment.user_id
    WHERE comment.id = NEW.target_id
      AND comment.status = 'active'
      AND parent_post.status = 'active'
      AND comment.user_id <> NEW.reporter_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'report_target_unavailable' USING ERRCODE = '42501';
    END IF;

    NEW.target_snapshot := pg_catalog.jsonb_build_object(
      'target_type', 'comment',
      'target_id', reported_target.id,
      'target_user_id', reported_target.user_id,
      'target_user_nickname', reported_target.target_user_nickname,
      'post_id', reported_target.post_id,
      'content', reported_target.content,
      'created_at', reported_target.created_at,
      'captured_at', pg_catalog.statement_timestamp()
    );
  ELSIF NEW.target_type = 'user' THEN
    SELECT
      target_profile.id,
      target_profile.nickname,
      target_profile.avatar_url,
      target_profile.bio,
      target_profile.status_text,
      target_profile.status_emoji,
      target_profile.created_at
    INTO reported_target
    FROM public.profiles AS target_profile
    WHERE target_profile.id = NEW.target_id
      AND target_profile.id <> NEW.reporter_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'report_target_unavailable' USING ERRCODE = '42501';
    END IF;

    NEW.target_snapshot := pg_catalog.jsonb_build_object(
      'target_type', 'user',
      'target_id', reported_target.id,
      'target_user_id', reported_target.id,
      'target_user_nickname', reported_target.nickname,
      'avatar_url', reported_target.avatar_url,
      'bio', reported_target.bio,
      'status_text', reported_target.status_text,
      'status_emoji', reported_target.status_emoji,
      'created_at', reported_target.created_at,
      'captured_at', pg_catalog.statement_timestamp()
    );
  ELSE
    RAISE EXCEPTION 'report_target_unavailable' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.capture_report_target_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_capture_report_target_snapshot ON public.reports;
CREATE TRIGGER trg_capture_report_target_snapshot
  BEFORE INSERT ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_report_target_snapshot();

CREATE OR REPLACE FUNCTION public.guard_report_target_snapshot_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.reporter_id IS DISTINCT FROM OLD.reporter_id
     OR NEW.target_type IS DISTINCT FROM OLD.target_type
     OR NEW.target_id IS DISTINCT FROM OLD.target_id
     OR NEW.target_snapshot IS DISTINCT FROM OLD.target_snapshot THEN
    RAISE EXCEPTION 'report_target_evidence_immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.guard_report_target_snapshot_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_guard_report_target_snapshot_immutable
  ON public.reports;
CREATE TRIGGER trg_guard_report_target_snapshot_immutable
  BEFORE UPDATE OF reporter_id, target_type, target_id, target_snapshot
  ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_report_target_snapshot_immutable();

-- Reassert that authenticated clients can supply only reporter-authored fields.
REVOKE INSERT (target_snapshot), UPDATE (target_snapshot)
  ON public.reports FROM PUBLIC, anon, authenticated;

-- The immutable snapshot is internal moderation evidence, not a durable copy
-- for the reporter to retrieve after the target edits or deletes the content.
-- Keep the existing own-report RLS policy useful for safe metadata, but remove
-- table-wide SELECT before granting only the reporter-facing columns.
REVOKE SELECT ON public.reports FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, reporter_id, target_type, target_id, reason, note, status, created_at
) ON public.reports TO authenticated;
GRANT SELECT ON public.reports TO service_role;

-- Keep the exact 078 return shape. Every target resolves from the live row
-- first and falls back to the immutable server snapshot after a trusted
-- cascade or moderation cleanup removes that row.
CREATE OR REPLACE FUNCTION public.admin_get_report_detail(
  report_id_in uuid
)
RETURNS TABLE (
  id                    uuid,
  reporter_id           uuid,
  reporter_nickname     text,
  reporter_email        text,
  target_type           text,
  target_id             uuid,
  target_user_id        uuid,
  target_user_nickname  text,
  target_preview        text,
  target_image          text,
  reason                text,
  note                  text,
  status                text,
  created_at            timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH resolved AS (
    SELECT
      report.id,
      report.reporter_id,
      report.target_type,
      report.target_id,
      report.reason,
      report.note,
      report.status,
      report.created_at,
      report.target_snapshot ->> 'target_user_nickname'
        AS snapshot_target_user_nickname,
      CASE report.target_type
        WHEN 'user' THEN report.target_id
        WHEN 'item' THEN COALESCE(
          (
            SELECT item.user_id
            FROM public.items AS item
            WHERE item.id = report.target_id
          ),
          CASE WHEN (report.target_snapshot ->> 'target_user_id') ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (report.target_snapshot ->> 'target_user_id')::uuid END
        )
        WHEN 'post' THEN COALESCE(
          (
            SELECT post.user_id
            FROM public.posts AS post
            WHERE post.id = report.target_id
          ),
          CASE WHEN (report.target_snapshot ->> 'target_user_id') ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (report.target_snapshot ->> 'target_user_id')::uuid END
        )
        WHEN 'message' THEN COALESCE(
          (
            SELECT message.sender_id
            FROM public.messages AS message
            WHERE message.id = report.target_id
          ),
          CASE WHEN (report.target_snapshot ->> 'target_user_id') ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (report.target_snapshot ->> 'target_user_id')::uuid END,
          CASE WHEN (report.target_snapshot ->> 'sender_id') ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (report.target_snapshot ->> 'sender_id')::uuid END
        )
        WHEN 'comment' THEN COALESCE(
          (
            SELECT comment.user_id
            FROM public.post_comments AS comment
            WHERE comment.id = report.target_id
          ),
          CASE WHEN (report.target_snapshot ->> 'target_user_id') ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (report.target_snapshot ->> 'target_user_id')::uuid END
        )
      END AS resolved_user_id,
      CASE report.target_type
        WHEN 'item' THEN COALESCE(
          (
            SELECT pg_catalog.left(item.title, 120)
            FROM public.items AS item
            WHERE item.id = report.target_id
          ),
          pg_catalog.left(report.target_snapshot ->> 'title', 120)
        )
        WHEN 'post' THEN COALESCE(
          (
            SELECT pg_catalog.left(post.content, 120)
            FROM public.posts AS post
            WHERE post.id = report.target_id
          ),
          pg_catalog.left(report.target_snapshot ->> 'content', 120)
        )
        WHEN 'message' THEN COALESCE(
          (
            SELECT pg_catalog.left(message.content, 120)
            FROM public.messages AS message
            WHERE message.id = report.target_id
          ),
          pg_catalog.left(report.target_snapshot ->> 'content', 120)
        )
        WHEN 'comment' THEN COALESCE(
          (
            SELECT pg_catalog.left(comment.content, 120)
            FROM public.post_comments AS comment
            WHERE comment.id = report.target_id
          ),
          pg_catalog.left(report.target_snapshot ->> 'content', 120)
        )
        ELSE NULL
      END AS resolved_preview,
      CASE report.target_type
        WHEN 'item' THEN COALESCE(
          (
            SELECT (item.images)[1]
            FROM public.items AS item
            WHERE item.id = report.target_id
          ),
          report.target_snapshot -> 'images' ->> 0
        )
        WHEN 'post' THEN COALESCE(
          (
            SELECT (post.images)[1]
            FROM public.posts AS post
            WHERE post.id = report.target_id
          ),
          report.target_snapshot -> 'images' ->> 0
        )
        ELSE NULL
      END AS resolved_image
    FROM public.reports AS report
    WHERE report.id = report_id_in
  )
  SELECT
    resolved.id,
    resolved.reporter_id,
    reporter.nickname,
    reporter.email,
    resolved.target_type,
    resolved.target_id,
    resolved.resolved_user_id,
    COALESCE(
      target.nickname,
      resolved.snapshot_target_user_nickname
    ),
    resolved.resolved_preview,
    resolved.resolved_image,
    resolved.reason,
    resolved.note,
    resolved.status,
    resolved.created_at
  FROM resolved
  INNER JOIN public.profiles AS reporter
    ON reporter.id = resolved.reporter_id
  LEFT JOIN public.profiles AS target
    ON target.id = resolved.resolved_user_id
$function$;

REVOKE ALL ON FUNCTION public.admin_get_report_detail(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_report_detail(uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
