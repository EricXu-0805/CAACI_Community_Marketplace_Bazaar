-- Read-only deployment precheck for 20261120122054_community_events.sql
-- (D-53 item 4, ENGINEERING §5.0). Run as postgres right before the migration.
--
-- The md5(prosrc) values are what the local L-SQL replay
-- (docker.io/supabase/postgres:17.6.1.104, RUNBOOK §5.1) reads right after
-- 20261120100354_community_watch_save_activity.sql. Beside each value is the
-- migration and line that holds the latest definition. A different value
-- means the hosted function was changed outside this repository, and what the
-- migration renames, wraps, calls or relies on must be reviewed against it.
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
  -- 1. The dispatcher the migration renames and wraps, the helpers its new
  --    code calls, and two triggers on topics it relies on: trg_enforce_actor
  --    refuses a restricted account's topic (D-49), and rl_posts_before_insert
  --    lets an official topic through and names a repeated text
  --    duplicate_post, which create_member_event answers from the pair that
  --    exists. Stored body, owner, security, settings, volatility and the API
  --    roles that may execute them ('internal' means not PUBLIC, anon or
  --    authenticated).
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.admin_execute_mutation(text,uuid,text,text,jsonb)', '64d6f1d37e03577d534ccc5e1d496499', '20261120100354:1129', true, 'v', 'search_path=pg_catalog', 'service_role'),
    ('public.admin_assert_mutation_capability(uuid,text)', '51c79ee5189f512333e2e8a3e4b47ba0', '20260718190000:74', true, 'v', 'search_path=pg_catalog', 'internal'),
    ('public.record_audit(text,uuid,uuid,jsonb)', '38cb635c4cf81051966bc563ebf6142d', '20260720035037:384', true, 'v', 'search_path=pg_catalog', 'service_role'),
    ('public.admin_moderation_reason_valid(text)', '3f75864d5dfc236033a8cd232238baf2', '20260720035037:22', false, 'i', 'search_path=pg_catalog', 'internal'),
    ('moderation_private.profile_content_visible(uuid)', 'a41223ba4e42754a12eec610e9ab03cf', '20260718160000:342', true, 's', 'search_path=pg_catalog', 'anon,authenticated,service_role'),
    ('moderation_private.assert_posting_allowed(uuid)', 'bce717345cade3cf4d4656b20d5ae2df', '20261114015420:54', true, 's', 'search_path=pg_catalog', 'internal'),
    ('public.update_updated_at()', 'da5ac28a58c8b4bb30209bf0d3d7082c', '001:140', false, 'v', 'search_path=public', 'PUBLIC,anon,authenticated,service_role'),
    ('public.trg_enforce_actor()', '9f2166257b987ce4147e11eb4f441dbf', '20260718160000:633', true, 'v', 'search_path=pg_catalog', 'internal'),
    ('public.rl_posts_before_insert()', '9a9c58f8ae22fc7785f85cead870e834', '044:73', true, 'v', 'search_path=public', 'internal')
    ) AS known(signature, body_md5, note, definer, volatility, settings, api_roles)
  LOOP
    SELECT pg_catalog.md5(p.prosrc) AS body_md5, p.prosecdef, p.provolatile::text AS volatility,
           pg_catalog.pg_get_userbyid(p.proowner)::text AS owner,
           coalesce(pg_catalog.array_to_string(p.proconfig, '|'), '') AS settings, p.proacl
      INTO routine
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = pg_catalog.to_regprocedure(expected.signature);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'community_events_function_missing:%', expected.signature;
    END IF;
    IF routine.body_md5 IS DISTINCT FROM expected.body_md5 THEN
      RAISE EXCEPTION 'community_events_function_body:%:%:%', expected.signature, routine.body_md5, expected.note;
    END IF;
    IF routine.prosecdef IS DISTINCT FROM expected.definer OR routine.owner <> 'postgres'
       OR routine.settings IS DISTINCT FROM expected.settings
       OR routine.volatility IS DISTINCT FROM expected.volatility THEN
      RAISE EXCEPTION 'community_events_function_attributes:%:%:%:%', expected.signature, routine.prosecdef, routine.volatility, routine.settings;
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
      RAISE EXCEPTION 'community_events_function_grants:%:%', expected.signature, listed;
    END IF;
  END LOOP;

  -- 2. Nothing the migration creates may exist already.
  FOREACH object_name IN ARRAY ARRAY[
    'public.community_event_partners', 'public.community_events', 'public.community_event_sync_state', 'public.community_events_list_idx', 'public.community_events_organizer_idx', 'public.community_events_campus_check_idx'] LOOP
    IF pg_catalog.to_regclass(object_name) IS NOT NULL THEN
      RAISE EXCEPTION 'community_events_relation_already_exists:%', object_name;
    END IF;
  END LOOP;
  FOREACH object_name IN ARRAY ARRAY[
    'private.community_events_schedule_change()',
    'private.community_events_member_guard()',
    'private.community_events_post_link()',
    'private.community_events_follow_topic()',
    'public.create_member_event(uuid,text,text,jsonb)',
    'public.list_community_events(text,text,text,integer)',
    'public.admin_execute_community_events(text,uuid,text,text,jsonb)',
    'public.admin_execute_mutation_pre_community_events(text,uuid,text,text,jsonb)'] LOOP
    IF pg_catalog.to_regprocedure(object_name) IS NOT NULL THEN
      RAISE EXCEPTION 'community_events_function_already_exists:%', object_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
              WHERE tgrelid = 'public.posts'::pg_catalog.regclass AND tgname = 'community_events_follow_topic') THEN
    RAISE EXCEPTION 'community_events_trigger_already_exists';
  END IF;

  -- 3. The three administrator vocabularies the migration restates, and the
  --    capability rows it adds to, exactly as 20261120100354 left them. A
  --    value somebody added elsewhere would be dropped by the restatement.
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.admin_mutation_requests', 'admin_mutation_requests_action_check', 'apply_ban,decide_appeal,delete_banner,issue_token,lift_suspension,resolve_target_reports,restore_content,revoke_admin_tokens,revoke_token,set_post_category,set_post_featured,set_post_locked,set_post_official,set_post_pinned,takedown_content,update_report_status,upsert_banner'),
    ('public.admin_role_action_capabilities', 'admin_role_action_capabilities_action_check', 'apply_ban,decide_appeal,delete_banner,issue_token,lift_suspension,resolve_target_reports,restore_content,revoke_admin_tokens,revoke_token,set_post_category,set_post_featured,set_post_locked,set_post_official,set_post_pinned,takedown_content,update_report_status,upload_banner,upsert_banner'),
    ('public.admin_audit_log', 'admin_audit_log_event_kind_check', 'actor_blocked,admin_login,admin_unauthorized,appeal_decided,appeal_more_information_requested,ban_applied,banner_changed,content_restored,content_takedown,post_category_changed,post_featured_changed,post_lock_changed,post_official_changed,post_pin_changed,report_status_changed,support_email_claimed,suspension_lifted,token_issued,token_revoked')
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
      RAISE EXCEPTION 'community_events_vocabulary:%:%', expected.constraint_name, coalesce(listed, 'missing');
    END IF;
  END LOOP;
  SELECT pg_catalog.string_agg(capability.admin_role || ':' || capability.action, ','
           ORDER BY (capability.admin_role || ':' || capability.action) COLLATE "C") INTO listed
    FROM public.admin_role_action_capabilities AS capability;
  IF listed IS DISTINCT FROM 'operator:apply_ban,operator:decide_appeal,operator:lift_suspension,operator:resolve_target_reports,operator:restore_content,operator:set_post_category,operator:set_post_locked,operator:takedown_content,operator:update_report_status,owner:apply_ban,owner:decide_appeal,owner:delete_banner,owner:issue_token,owner:lift_suspension,owner:resolve_target_reports,owner:restore_content,owner:revoke_admin_tokens,owner:revoke_token,owner:set_post_category,owner:set_post_featured,owner:set_post_locked,owner:set_post_official,owner:set_post_pinned,owner:takedown_content,owner:update_report_status,owner:upload_banner,owner:upsert_banner,security_admin:revoke_admin_tokens,security_admin:revoke_token' THEN
    RAISE EXCEPTION 'community_events_capability_rows:%', listed;
  END IF;

  -- 4. Topics, as the new code meets them. A member cannot name created_at or
  --    is_official on insert: the member guard's proof that a topic was
  --    written by create_member_event in the same transaction rests on that,
  --    together with the column default.
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.posts', 'anon', 'SELECT', 'answered_at,category,comment_count,content,content_i18n,created_at,id,image_dimensions,images,is_featured,is_official,is_pinned,last_activity_at,like_count,locked_at,region,source_lang,status,title,updated_at,user_id'),
    ('public.posts', 'authenticated', 'SELECT', 'answered_at,category,comment_count,content,content_i18n,created_at,id,image_dimensions,images,is_featured,is_official,is_pinned,last_activity_at,like_count,locked_at,region,source_lang,status,title,updated_at,user_id'),
    ('public.posts', 'anon', 'INSERT', ''),
    ('public.posts', 'authenticated', 'INSERT', 'category,content,content_i18n,id,image_dimensions,images,source_lang,title,user_id'),
    ('public.posts', 'anon', 'UPDATE', ''),
    ('public.posts', 'authenticated', 'UPDATE', 'content_i18n')
    ) AS target(relation, role_name, privilege, columns)
  LOOP
    SELECT coalesce(pg_catalog.string_agg(a.attname::text, ',' ORDER BY a.attname::text COLLATE "C"), '') INTO listed
      FROM pg_catalog.pg_attribute AS a
     WHERE a.attrelid = pg_catalog.to_regclass(expected.relation)
       AND a.attnum > 0 AND NOT a.attisdropped
       AND pg_catalog.has_column_privilege(expected.role_name, a.attrelid, a.attnum, expected.privilege);
    IF listed IS DISTINCT FROM expected.columns THEN
      RAISE EXCEPTION 'community_events_column_privileges:%:%:%:%', expected.relation, expected.role_name, expected.privilege, listed;
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid)
        FROM pg_catalog.pg_attribute AS a
        JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = 'public.posts'::pg_catalog.regclass AND a.attname = 'created_at') IS DISTINCT FROM 'now()' THEN
    RAISE EXCEPTION 'community_events_topic_created_at_default';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid = 'public.posts'::pg_catalog.regclass AND conname = 'posts_topic_metadata_check'
                    AND contype = 'c' AND convalidated
                    AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(oid), '''events-social''') > 0
                    AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(oid), '(title = btrim(title))') > 0
                    AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(oid), 'char_length(title) <= 120') > 0) THEN
    RAISE EXCEPTION 'community_events_topic_board_or_title_rule';
  END IF;
  FOR expected IN
    SELECT * FROM (VALUES
    ('Anyone can view active posts', 'r'),
    ('Authenticated users can create posts', 'a'),
    ('Users can delete own posts', 'd')
    ) AS target(policy_name, command)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
                    WHERE polrelid = 'public.posts'::pg_catalog.regclass AND polname = expected.policy_name
                      AND polcmd::text = expected.command) THEN
      RAISE EXCEPTION 'community_events_topic_policy_missing:%', expected.policy_name;
    END IF;
  END LOOP;
  -- One author's topic inserts run one at a time, which is what makes the
  -- limit of two open events hold when two requests arrive together.
  FOR expected IN
    SELECT * FROM (VALUES
    ('enforce_actor_posts', 'public.trg_enforce_actor()', 7),
    ('serialize_public_write_actor', 'private.serialize_public_write_actor()', 7),
    ('trg_rl_posts_before_insert', 'public.rl_posts_before_insert()', 7)
    ) AS target(trigger_name, routine, kind)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger AS t
       WHERE t.tgrelid = 'public.posts'::pg_catalog.regclass
         AND t.tgname = expected.trigger_name AND NOT t.tgisinternal
         AND t.tgfoid = pg_catalog.to_regprocedure(expected.routine)
         AND t.tgtype::integer = expected.kind AND t.tgenabled::text = 'O') THEN
      RAISE EXCEPTION 'community_events_topic_trigger:%', expected.trigger_name;
    END IF;
  END LOOP;

  -- 5. The list function reads an organizer's public profile as the caller.
  FOR expected IN
    SELECT role_name, column_name
      FROM pg_catalog.unnest(ARRAY['anon', 'authenticated']) AS role_name,
           pg_catalog.unnest(ARRAY['id', 'nickname', 'avatar_url', 'is_illini_verified']) AS column_name
  LOOP
    IF NOT pg_catalog.has_column_privilege(expected.role_name, 'public.profiles', expected.column_name, 'SELECT') THEN
      RAISE EXCEPTION 'community_events_profile_column_not_readable:%:%', expected.role_name, expected.column_name;
    END IF;
  END LOOP;

  -- 6. The new policies call a helper in this schema as the reader.
  IF NOT pg_catalog.has_schema_privilege('authenticated', 'moderation_private', 'USAGE')
     OR NOT pg_catalog.has_schema_privilege('anon', 'moderation_private', 'USAGE') THEN
    RAISE EXCEPTION 'community_events_schema_usage_missing';
  END IF;

  -- 7. D-49: the restricted-account guard is attached where 20261114015420
  --    put it. This migration does not attach it to the new table; the member
  --    guard calls the assertion itself, and VERIFY expects the same count.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger
       WHERE tgfoid = pg_catalog.to_regprocedure('private.enforce_restricted_account_write()')
         AND NOT tgisinternal) <> 10 THEN
    RAISE EXCEPTION 'community_events_restricted_account_guard_count';
  END IF;
END;
$precheck$;
ROLLBACK;
