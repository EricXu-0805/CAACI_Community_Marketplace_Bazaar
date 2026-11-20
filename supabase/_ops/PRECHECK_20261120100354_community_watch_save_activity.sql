-- Read-only deployment precheck for 20261120100354_community_watch_save_activity.sql
-- (D-53 item 4, ENGINEERING §5.0). Run as postgres right before the migration.
--
-- The md5(prosrc) values are what the local L-SQL replay
-- (docker.io/supabase/postgres:17.6.1.104, RUNBOOK §5.1) reads right after
-- 20261114015420_restricted_account_writes.sql. Beside each value is the
-- migration and line that holds the latest definition; the branch this one is
-- stacked on (PR #377, dd44f98) has none later. A different value means the
-- hosted function was changed outside this repository, and what the migration
-- reissues, wraps or calls must be reviewed against it.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
DO $precheck$
DECLARE
  expected record;
  routine record;
  listed text;
  object_name text;
BEGIN
  -- 1. The six bodies the migration reissues, drops or renames, and the
  --    helpers its new code calls: stored body, owner, security, settings,
  --    volatility and the API roles that may execute them. 'internal' means
  --    not executable by PUBLIC, anon or authenticated.
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.update_post_comment_count()', 'a524f02212c525205f59103e2e1f6bdc', '085:280', true, 'v', 'search_path=public', 'internal'),
    ('public.search_community_posts(text[],text,integer,integer,text,text)', '1dfd91b93a4d7979d7f9e9dd121295b8', '20261112120000:64', false, 's', 'search_path=pg_catalog, public, extensions|statement_timeout=3s', 'anon,authenticated'),
    ('public.admin_execute_mutation(text,uuid,text,text,jsonb)', 'a30b6224c23ab4ebdef61b54eb37af5a', '20260720035037:1697', true, 'v', 'search_path=pg_catalog', 'service_role'),
    ('public.admin_token_authorization(text)', '67d3ce854d107b7ff701edf8542f4ff6', '20260722145042:429', true, 'v', 'search_path=pg_catalog', 'service_role'),
    ('public.admin_token_authorization_v2(text)', '720c6f6cb2e550107a9f9cba88aa7ec9', '20260722152000:58', true, 'v', 'search_path=pg_catalog', 'service_role'),
    ('public.admin_list_moderation_audit_log(integer,integer,text)', '2e788091d546d9fc34c908c3d7951d94', '20260720035037:1171', true, 's', 'search_path=pg_catalog', 'service_role'),
    ('private.enqueue_activity_notification(uuid,uuid,text,text,text,uuid,text)', 'fdb7928eb1930389cdd68173ea7f55eb', '20260903070000:53', true, 'v', 'search_path=pg_catalog', 'internal'),
    ('moderation_private.profile_content_visible(uuid)', 'a41223ba4e42754a12eec610e9ab03cf', '20260718160000:342', true, 's', 'search_path=pg_catalog', 'anon,authenticated,service_role'),
    ('private.current_user_can_access_pair(uuid,uuid)', '3602822522f16a11d5b110fe20c63dc6', '20260717141822:30', true, 's', 'search_path=pg_catalog', 'authenticated'),
    ('public.admin_assert_mutation_capability(uuid,text)', '51c79ee5189f512333e2e8a3e4b47ba0', '20260718190000:74', true, 'v', 'search_path=pg_catalog', 'internal'),
    ('public.record_audit(text,uuid,uuid,jsonb)', '38cb635c4cf81051966bc563ebf6142d', '20260720035037:384', true, 'v', 'search_path=pg_catalog', 'service_role'),
    ('public.admin_moderation_reason_valid(text)', '3f75864d5dfc236033a8cd232238baf2', '20260720035037:22', false, 'i', 'search_path=pg_catalog', 'internal'),
    ('public.notify_post_comment()', '1875e3c65f24a596c05ec8670907f302', '20260903070000:168', true, 'v', 'search_path=pg_catalog', 'internal'),
    ('public.trg_enforce_actor()', '9f2166257b987ce4147e11eb4f441dbf', '20260718160000:633', true, 'v', 'search_path=pg_catalog', 'internal'),
    ('moderation_private.assert_posting_allowed(uuid)', 'bce717345cade3cf4d4656b20d5ae2df', '20261114015420:54', true, 's', 'search_path=pg_catalog', 'internal')
    ) AS known(signature, body_md5, note, definer, volatility, settings, api_roles)
  LOOP
    SELECT pg_catalog.md5(p.prosrc) AS body_md5, p.prosecdef, p.provolatile::text AS volatility,
           pg_catalog.pg_get_userbyid(p.proowner)::text AS owner,
           coalesce(pg_catalog.array_to_string(p.proconfig, '|'), '') AS settings, p.proacl
      INTO routine
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = pg_catalog.to_regprocedure(expected.signature);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'community_watch_save_function_missing:%', expected.signature;
    END IF;
    IF routine.body_md5 IS DISTINCT FROM expected.body_md5 THEN
      RAISE EXCEPTION 'community_watch_save_function_body:%:%:%', expected.signature, routine.body_md5, expected.note;
    END IF;
    IF routine.prosecdef IS DISTINCT FROM expected.definer OR routine.owner <> 'postgres'
       OR routine.settings IS DISTINCT FROM expected.settings
       OR routine.volatility IS DISTINCT FROM expected.volatility THEN
      RAISE EXCEPTION 'community_watch_save_function_attributes:%:%:%:%', expected.signature, routine.prosecdef, routine.volatility, routine.settings;
    END IF;
    SELECT coalesce(pg_catalog.string_agg(api.grantee, ',' ORDER BY api.grantee COLLATE "C"), '')
      INTO listed
      FROM (
        SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(acl.grantee)::text END AS grantee
          FROM pg_catalog.aclexplode(routine.proacl) AS acl
         WHERE acl.privilege_type = 'EXECUTE'
           AND (acl.grantee = 0
             OR pg_catalog.pg_get_userbyid(acl.grantee)::text IN ('anon', 'authenticated', 'service_role'))
      ) AS api;
    IF routine.proacl IS NULL
       OR (expected.api_roles = 'internal' AND listed NOT IN ('', 'service_role'))
       OR (expected.api_roles <> 'internal' AND listed IS DISTINCT FROM expected.api_roles) THEN
      RAISE EXCEPTION 'community_watch_save_function_grants:%:%', expected.signature, listed;
    END IF;
  END LOOP;

  -- 2. Nothing the migration creates may exist already.
  FOREACH object_name IN ARRAY ARRAY[
    'public.post_follows', 'public.post_bookmarks', 'public.post_follows_post_idx',
    'public.post_bookmarks_user_idx', 'public.post_bookmarks_post_idx',
    'public.posts_board_activity_idx', 'public.posts_activity_idx', 'public.posts_unanswered_idx'] LOOP
    IF pg_catalog.to_regclass(object_name) IS NOT NULL THEN
      RAISE EXCEPTION 'community_watch_save_relation_already_exists:%', object_name;
    END IF;
  END LOOP;
  FOREACH object_name IN ARRAY ARRAY[
    'private.reject_reply_to_locked_post()', 'private.notify_topic_reply()',
    'public.admin_execute_community_governance(text,uuid,text,text,jsonb)',
    'public.admin_execute_mutation_pre_community_governance(text,uuid,text,text,jsonb)',
    'public.admin_list_community_posts(integer,integer,text)',
    'public.admin_list_report_queue(integer,integer)',
    'public.community_post_state(uuid)', 'public.list_own_hidden_posts(uuid)'] LOOP
    IF pg_catalog.to_regprocedure(object_name) IS NOT NULL THEN
      RAISE EXCEPTION 'community_watch_save_function_already_exists:%', object_name;
    END IF;
  END LOOP;
  SELECT pg_catalog.string_agg(a.attname::text, ',') INTO listed
    FROM pg_catalog.pg_attribute AS a
   WHERE a.attrelid = 'public.posts'::pg_catalog.regclass AND NOT a.attisdropped
     AND a.attname IN ('last_activity_at', 'answered_at', 'is_featured', 'locked_at');
  IF listed IS NOT NULL THEN
    RAISE EXCEPTION 'community_watch_save_column_already_exists:%', listed;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
              WHERE tgrelid = 'public.post_comments'::pg_catalog.regclass
                AND tgname IN ('enforce_locked_post_reply', 'trg_notify_topic_reply')) THEN
    RAISE EXCEPTION 'community_watch_save_trigger_already_exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
              WHERE conrelid = 'public.posts'::pg_catalog.regclass AND conname = 'posts_featured_official_only') THEN
    RAISE EXCEPTION 'community_watch_save_constraint_already_exists';
  END IF;

  -- 3. The three administrator vocabularies the migration restates, and the
  --    capability rows it adds to. A value somebody added elsewhere would be
  --    dropped by the restatement, so any difference stops here.
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.admin_mutation_requests', 'admin_mutation_requests_action_check', 'apply_ban,decide_appeal,delete_banner,issue_token,lift_suspension,resolve_target_reports,revoke_admin_tokens,revoke_token,set_post_pinned,takedown_content,update_report_status,upsert_banner'),
    ('public.admin_role_action_capabilities', 'admin_role_action_capabilities_action_check', 'apply_ban,decide_appeal,delete_banner,issue_token,lift_suspension,resolve_target_reports,revoke_admin_tokens,revoke_token,set_post_pinned,takedown_content,update_report_status,upload_banner,upsert_banner'),
    ('public.admin_audit_log', 'admin_audit_log_event_kind_check', 'actor_blocked,admin_login,admin_unauthorized,appeal_decided,appeal_more_information_requested,ban_applied,banner_changed,content_takedown,post_pin_changed,report_status_changed,support_email_claimed,suspension_lifted,token_issued,token_revoked')
    ) AS known(relation, constraint_name, vocabulary)
  LOOP
    SELECT pg_catalog.string_agg(accepted.value, ',' ORDER BY accepted.value COLLATE "C") INTO listed
      FROM pg_catalog.pg_constraint AS definition
      CROSS JOIN LATERAL (
        SELECT (pg_catalog.regexp_matches(
          pg_catalog.pg_get_constraintdef(definition.oid), '''([a-z_]+)''::text', 'g'
        ))[1] AS value
      ) AS accepted
     WHERE definition.conrelid = pg_catalog.to_regclass(expected.relation)
       AND definition.conname = expected.constraint_name
       AND definition.contype = 'c' AND definition.convalidated;
    IF listed IS DISTINCT FROM expected.vocabulary THEN
      RAISE EXCEPTION 'community_watch_save_vocabulary:%:%', expected.constraint_name, coalesce(listed, 'missing');
    END IF;
  END LOOP;
  SELECT pg_catalog.string_agg(capability.admin_role || ':' || capability.action, ','
           ORDER BY (capability.admin_role || ':' || capability.action) COLLATE "C") INTO listed
    FROM public.admin_role_action_capabilities AS capability;
  IF listed IS DISTINCT FROM 'operator:apply_ban,operator:decide_appeal,operator:lift_suspension,operator:resolve_target_reports,operator:takedown_content,operator:update_report_status,owner:apply_ban,owner:decide_appeal,owner:delete_banner,owner:issue_token,owner:lift_suspension,owner:resolve_target_reports,owner:revoke_admin_tokens,owner:revoke_token,owner:set_post_pinned,owner:takedown_content,owner:update_report_status,owner:upload_banner,owner:upsert_banner,security_admin:revoke_admin_tokens,security_admin:revoke_token' THEN
    RAISE EXCEPTION 'community_watch_save_capability_rows:%', listed;
  END IF;

  -- 4. The reply triggers the new ones sit beside, and nothing that would sort
  --    between the restriction refusal and the new lock refusal.
  FOR expected IN
    SELECT * FROM (VALUES
    ('enforce_actor_post_comments', 'public.trg_enforce_actor()', 7),
    ('trg_post_comments_count', 'public.update_post_comment_count()', 13),
    ('trg_notify_post_comment', 'public.notify_post_comment()', 5)
    ) AS target(trigger_name, routine, kind)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger AS t
       WHERE t.tgrelid = 'public.post_comments'::pg_catalog.regclass
         AND t.tgname = expected.trigger_name AND NOT t.tgisinternal
         AND t.tgfoid = pg_catalog.to_regprocedure(expected.routine)
         AND t.tgtype::integer = expected.kind AND t.tgenabled::text = 'O') THEN
      RAISE EXCEPTION 'community_watch_save_reply_trigger:%', expected.trigger_name;
    END IF;
  END LOOP;
  SELECT pg_catalog.string_agg(t.tgname::text, ',') INTO listed
    FROM pg_catalog.pg_trigger AS t
   WHERE t.tgrelid = 'public.post_comments'::pg_catalog.regclass AND NOT t.tgisinternal
     AND (t.tgtype::integer & 67) = 3 AND (t.tgtype::integer & 4) <> 0
     AND t.tgname::text COLLATE "C" > 'enforce_actor_post_comments'
     AND t.tgname::text COLLATE "C" < 'enforce_locked_post_reply';
  IF listed IS NOT NULL THEN
    RAISE EXCEPTION 'community_watch_save_trigger_order:%', listed;
  END IF;

  -- 5. What clients may read and write on topics today. VERIFY expects four
  --    more readable columns and nothing else, so the restricted-account
  --    guard of 20261114015420 (present, checked here) still covers every
  --    column a client can write.
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.posts', 'anon', 'SELECT', 'category,comment_count,content,content_i18n,created_at,id,image_dimensions,images,is_official,is_pinned,like_count,region,source_lang,status,title,updated_at,user_id'),
    ('public.posts', 'authenticated', 'SELECT', 'category,comment_count,content,content_i18n,created_at,id,image_dimensions,images,is_official,is_pinned,like_count,region,source_lang,status,title,updated_at,user_id'),
    ('public.posts', 'anon', 'INSERT', ''),
    ('public.posts', 'authenticated', 'INSERT', 'category,content,content_i18n,id,image_dimensions,images,source_lang,title,user_id'),
    ('public.posts', 'anon', 'UPDATE', ''),
    ('public.posts', 'authenticated', 'UPDATE', 'content_i18n'),
    -- The client cannot read source_event_key; it finds the reply a notice is
    -- about by topic and instant instead.
    ('public.notifications', 'authenticated', 'SELECT', 'body,conversation_id,created_at,id,is_read,item_id,title,type,user_id')
    ) AS target(relation, role_name, privilege, columns)
  LOOP
    SELECT coalesce(pg_catalog.string_agg(a.attname::text, ',' ORDER BY a.attname::text COLLATE "C"), '') INTO listed
      FROM pg_catalog.pg_attribute AS a
     WHERE a.attrelid = pg_catalog.to_regclass(expected.relation)
       AND a.attnum > 0 AND NOT a.attisdropped
       AND pg_catalog.has_column_privilege(expected.role_name, a.attrelid, a.attnum, expected.privilege);
    IF listed IS DISTINCT FROM expected.columns THEN
      RAISE EXCEPTION 'community_watch_save_column_privileges:%:%:%:%', expected.relation, expected.role_name, expected.privilege, listed;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                  WHERE tgrelid = 'public.posts'::pg_catalog.regclass AND tgname = 'aa_restricted_account_write'
                    AND tgfoid = pg_catalog.to_regprocedure('private.enforce_restricted_account_write()')) THEN
    RAISE EXCEPTION 'community_watch_save_restricted_account_guard_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
                  WHERE polrelid = 'public.posts'::pg_catalog.regclass AND polname = 'Anyone can view active posts' AND polcmd = 'r') THEN
    RAISE EXCEPTION 'community_watch_save_post_read_policy_missing';
  END IF;

  -- 6. Notifications: the one writer relies on this unique key and type.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index AS i
     WHERE i.indrelid = 'public.notifications'::pg_catalog.regclass AND i.indisunique AND i.indpred IS NOT NULL
       AND pg_catalog.strpos(pg_catalog.pg_get_indexdef(i.indexrelid), '(source_event_key)') > 0) THEN
    RAISE EXCEPTION 'community_watch_save_notification_key_index_missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.notifications'::pg_catalog.regclass AND conname = 'notifications_type_check'
       AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(oid), '''post_comment''') > 0) THEN
    RAISE EXCEPTION 'community_watch_save_notification_type_missing';
  END IF;

  -- 7. The new policies call helpers in these schemas as the signed-in member.
  IF NOT pg_catalog.has_schema_privilege('authenticated', 'private', 'USAGE')
     OR NOT pg_catalog.has_schema_privilege('authenticated', 'moderation_private', 'USAGE')
     OR NOT pg_catalog.has_schema_privilege('anon', 'moderation_private', 'USAGE') THEN
    RAISE EXCEPTION 'community_watch_save_schema_usage_missing';
  END IF;
END;
$precheck$;
ROLLBACK;
