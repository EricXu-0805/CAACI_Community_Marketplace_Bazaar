-- Read-only pre-deploy checks for
-- 20260717194334_preserve_conversation_and_report_evidence.sql.
-- Safe on staging/production: this script performs no writes.
-- Scope note: target_image snapshots are URL pointers, not retained media
-- bytes. This check also does not change the existing reporter-delete cascade.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  required_name text;
  required_column record;
BEGIN
  FOREACH required_name IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = required_name
    ) THEN
      RAISE EXCEPTION 'precheck_failed: missing role %', required_name;
    END IF;
  END LOOP;

  FOREACH required_name IN ARRAY ARRAY[
    'public.profiles', 'public.items', 'public.posts', 'public.post_comments',
    'public.conversations', 'public.messages', 'public.offers',
    'public.meetups', 'public.blocks', 'public.reports'
  ] LOOP
    IF pg_catalog.to_regclass(required_name) IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: missing relation %', required_name;
    END IF;
  END LOOP;

  FOREACH required_name IN ARRAY ARRAY[
    'auth.uid()', 'private.current_user_can_access_pair(uuid,uuid)',
    'public.admin_get_report_detail(uuid)'
  ] LOOP
    IF pg_catalog.to_regprocedure(required_name) IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: missing function %', required_name;
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
      ('offers', ARRAY['conversation_id', 'status']::text[]),
      ('meetups', ARRAY[
        'conversation_id', 'status', 'spot', 'meet_at', 'note'
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
      RAISE EXCEPTION 'precheck_failed: missing column public.%.%',
        required_column.table_name,
        required_column.column_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reports'
      AND column_name = 'target_snapshot'
      AND (
        data_type <> 'jsonb'
        OR is_nullable <> 'YES'
        OR column_default IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: existing reports.target_snapshot shape mismatch';
  END IF;

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
    RAISE EXCEPTION 'precheck_failed: report visibility dependency lacks RLS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('profiles', 'Public profile rows readable', 'SELECT'),
      ('items', 'Anyone can view active items', 'SELECT'),
      ('posts', 'Anyone can view active posts', 'SELECT'),
      ('post_comments', 'Anyone can view comments', 'SELECT'),
      ('reports', 'Users can create reports', 'INSERT'),
      ('reports', 'Users can view own reports', 'SELECT')
    ) AS expected_policy(table_name, policy_name, command_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies AS actual_policy
      WHERE actual_policy.schemaname = 'public'
        AND actual_policy.tablename = expected_policy.table_name
        AND actual_policy.policyname = expected_policy.policy_name
        AND actual_policy.cmd = expected_policy.command_name
        AND actual_policy.permissive = 'PERMISSIVE'
    )
  ) THEN
    RAISE EXCEPTION 'precheck_failed: report visibility policy drift';
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
      RAISE EXCEPTION 'precheck_failed: authenticated lacks SELECT on public.%.%',
        required_column.table_name,
        required_column.column_name;
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'private.current_user_can_access_pair(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'precheck_failed: block visibility helper ACL';
  END IF;
END
$precheck$;

-- Legacy evidence quality. Only valid participant reports with a still-live
-- counterparty message can be backfilled into an authoritative snapshot.
SELECT
  count(*) FILTER (WHERE report.target_type = 'message')
    AS legacy_message_reports,
  count(*) FILTER (
    WHERE report.target_type = 'message' AND message.id IS NULL
  ) AS missing_live_message,
  count(*) FILTER (
    WHERE report.target_type = 'message'
      AND message.id IS NOT NULL
      AND report.reporter_id NOT IN (
        conversation.buyer_id,
        conversation.seller_id
      )
  ) AS nonparticipant_message_reports,
  count(*) FILTER (
    WHERE report.target_type = 'message'
      AND message.id IS NOT NULL
      AND report.reporter_id = message.sender_id
  ) AS own_message_reports
FROM public.reports AS report
LEFT JOIN public.messages AS message
  ON report.target_type = 'message'
 AND message.id = report.target_id
LEFT JOIN public.conversations AS conversation
  ON conversation.id = message.conversation_id;

-- Snapshot backfill eligibility by public target type. Ineligible legacy rows
-- remain visible to moderators but are intentionally not exposed back to the
-- reporter as a server snapshot.
SELECT
  report.target_type,
  pg_catalog.count(*) AS legacy_reports,
  pg_catalog.count(*) FILTER (
    WHERE (
      (
        report.target_type = 'item'
        AND item.id IS NOT NULL
        AND item.status <> 'deleted'::public.item_status
        AND report.reporter_id <> item.user_id
      ) OR (
        report.target_type = 'post'
        AND post.id IS NOT NULL
        AND post.status = 'active'
        AND report.reporter_id <> post.user_id
      ) OR (
        report.target_type = 'comment'
        AND comment.id IS NOT NULL
        AND comment.status = 'active'
        AND parent_post.status = 'active'
        AND report.reporter_id <> comment.user_id
      ) OR (
        report.target_type = 'user'
        AND target_profile.id IS NOT NULL
        AND report.reporter_id <> target_profile.id
      )
    )
  ) AS eligible_public_backfill
FROM public.reports AS report
LEFT JOIN public.items AS item
  ON report.target_type = 'item' AND item.id = report.target_id
LEFT JOIN public.posts AS post
  ON report.target_type = 'post' AND post.id = report.target_id
LEFT JOIN public.post_comments AS comment
  ON report.target_type = 'comment' AND comment.id = report.target_id
LEFT JOIN public.posts AS parent_post
  ON parent_post.id = comment.post_id
LEFT JOIN public.profiles AS target_profile
  ON report.target_type = 'user' AND target_profile.id = report.target_id
WHERE report.target_type IN ('item', 'post', 'comment', 'user')
GROUP BY report.target_type
ORDER BY report.target_type;

SELECT
  pg_catalog.has_table_privilege(
    'authenticated', 'public.conversations', 'DELETE'
  ) AS authenticated_can_delete_conversations,
  pg_catalog.has_table_privilege(
    'authenticated', 'public.messages', 'DELETE'
  ) AS authenticated_can_delete_messages,
  pg_catalog.pg_get_function_result(
    'public.admin_get_report_detail(uuid)'::pg_catalog.regprocedure
  ) AS admin_report_detail_result;

SELECT
  tablename,
  policyname,
  cmd,
  roles
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('conversations', 'messages')
  AND cmd = 'DELETE'
ORDER BY tablename, policyname;

ROLLBACK;
