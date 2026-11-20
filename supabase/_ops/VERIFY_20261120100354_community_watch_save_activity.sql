-- Read-only verification for 20261120100354_community_watch_save_activity.sql
-- (D-53 item 4, ENGINEERING §5.0). Run as postgres right after the migration.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
-- Catalog text below (keys, policies) is printed relative to this path.
SET LOCAL search_path = pg_catalog, public;
DO $verify$
DECLARE
  expected record;
  routine record;
  tally record;
  listed text;
  object_name text;
BEGIN
  -- 1. The thirteen bodies this migration issues, the previous dispatcher under
  --    its new name, and the helpers left as they were: stored body, owner,
  --    security, settings, volatility, and exactly the API roles that may
  --    execute them (none means owner only; 'internal' means not PUBLIC, anon
  --    or authenticated).
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.update_post_comment_count()', 'ca13bad5aaed7d210451ba6dc8159616', 'this migration', true, 'v', 'search_path=public', 'internal'),
    ('public.search_community_posts(text[],text,integer,integer,text,text)', 'c88cfb3edcd3f4933ccec83a153ad4fe', 'this migration', false, 's', 'search_path=pg_catalog, public, extensions|statement_timeout=3s', 'anon,authenticated'),
    ('public.admin_token_authorization(text)', 'fc2446534ec9ec9b89aa901f9fd81ea6', 'this migration', true, 'v', 'search_path=pg_catalog', 'service_role'),
    ('public.admin_token_authorization_v2(text)', '37d5ed1fbb3fc8a098ba942442479110', 'this migration', true, 'v', 'search_path=pg_catalog', 'service_role'),
    ('public.admin_list_moderation_audit_log(integer,integer,text)', '42d02d7ac06498a48e2172c35d5ff517', 'this migration', true, 's', 'search_path=pg_catalog', 'service_role'),
    ('public.admin_execute_mutation(text,uuid,text,text,jsonb)', '64d6f1d37e03577d534ccc5e1d496499', 'this migration', true, 'v', 'search_path=pg_catalog', 'service_role'),
    ('public.admin_execute_community_governance(text,uuid,text,text,jsonb)', 'e6ddf89b765c544d9434a843478ccf42', 'this migration', true, 'v', 'search_path=pg_catalog', ''),
    ('private.reject_reply_to_locked_post()', '3b6872071d2eb7fb20cfec67a633a1c5', 'this migration', true, 'v', 'search_path=pg_catalog', ''),
    ('private.notify_topic_reply()', 'f107a228866a9f5a4e696161998c6c94', 'this migration', true, 'v', 'search_path=pg_catalog', ''),
    ('public.admin_list_community_posts(integer,integer,text)', '0aa2db04914b8bfc46e2b4eba003f7c8', 'this migration', true, 's', 'search_path=pg_catalog', 'service_role'),
    ('public.admin_list_report_queue(integer,integer)', '3afa8483a029388e50dd33ebba2fb1de', 'this migration', true, 's', 'search_path=pg_catalog', 'service_role'),
    ('public.community_post_state(uuid)', '48bdf464da6b44e5d669e32ad7b59a2a', 'this migration', true, 's', 'search_path=pg_catalog|statement_timeout=3s', 'anon,authenticated'),
    ('public.list_own_hidden_posts(uuid)', '52103427ec4da7533bb880b5d56f9f6b', 'this migration', true, 's', 'search_path=pg_catalog|statement_timeout=3s', 'authenticated'),
    ('public.admin_execute_mutation_pre_community_governance(text,uuid,text,text,jsonb)', 'a30b6224c23ab4ebdef61b54eb37af5a', 'renamed, body unchanged', true, 'v', 'search_path=pg_catalog', ''),
    ('private.enqueue_activity_notification(uuid,uuid,text,text,text,uuid,text)', 'fdb7928eb1930389cdd68173ea7f55eb', 'unchanged', true, 'v', 'search_path=pg_catalog', 'internal'),
    ('moderation_private.profile_content_visible(uuid)', 'a41223ba4e42754a12eec610e9ab03cf', 'unchanged', true, 's', 'search_path=pg_catalog', 'anon,authenticated,service_role'),
    ('private.current_user_can_access_pair(uuid,uuid)', '3602822522f16a11d5b110fe20c63dc6', 'unchanged', true, 's', 'search_path=pg_catalog', 'authenticated'),
    ('public.admin_assert_mutation_capability(uuid,text)', '51c79ee5189f512333e2e8a3e4b47ba0', 'unchanged', true, 'v', 'search_path=pg_catalog', 'internal'),
    ('public.record_audit(text,uuid,uuid,jsonb)', '38cb635c4cf81051966bc563ebf6142d', 'unchanged', true, 'v', 'search_path=pg_catalog', 'service_role'),
    ('public.admin_moderation_reason_valid(text)', '3f75864d5dfc236033a8cd232238baf2', 'unchanged', false, 'i', 'search_path=pg_catalog', 'internal'),
    ('public.notify_post_comment()', '1875e3c65f24a596c05ec8670907f302', 'unchanged', true, 'v', 'search_path=pg_catalog', 'internal'),
    ('public.trg_enforce_actor()', '9f2166257b987ce4147e11eb4f441dbf', 'unchanged', true, 'v', 'search_path=pg_catalog', 'internal')
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

  -- 2. The two tables: columns, keys, row security, three policies each for
  --    the signed-in role only, and exactly the column grants.
  FOREACH object_name IN ARRAY ARRAY['public.post_follows', 'public.post_bookmarks'] LOOP
    IF pg_catalog.to_regclass(object_name) IS NULL THEN
      RAISE EXCEPTION 'community_watch_save_table_missing:%', object_name;
    END IF;
    SELECT pg_catalog.string_agg(a.attname::text || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
             || ':' || coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attnum) INTO listed
      FROM pg_catalog.pg_attribute AS a
      LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = pg_catalog.to_regclass(object_name) AND a.attnum > 0 AND NOT a.attisdropped;
    IF listed IS DISTINCT FROM 'user_id:uuid:true:,post_id:uuid:true:,created_at:timestamp with time zone:true:now()' THEN
      RAISE EXCEPTION 'community_watch_save_table_columns:%:%', object_name, listed;
    END IF;
    SELECT pg_catalog.string_agg(c.contype::text || ':' || pg_catalog.pg_get_constraintdef(c.oid), ' | '
             ORDER BY c.contype::text COLLATE "C" DESC, pg_catalog.pg_get_constraintdef(c.oid) COLLATE "C") INTO listed
      FROM pg_catalog.pg_constraint AS c
     WHERE c.conrelid = pg_catalog.to_regclass(object_name) AND c.convalidated;
    IF listed IS DISTINCT FROM 'p:PRIMARY KEY (user_id, post_id) | f:FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE | f:FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE' THEN
      RAISE EXCEPTION 'community_watch_save_table_keys:%:%', object_name, listed;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = pg_catalog.to_regclass(object_name)) THEN
      RAISE EXCEPTION 'community_watch_save_row_security_off:%', object_name;
    END IF;
    SELECT pg_catalog.string_agg(p.polcmd::text || ':' || p.polpermissive::text || ':' || (
             SELECT pg_catalog.string_agg(pg_catalog.pg_get_userbyid(r.role_id)::text, ',')
               FROM pg_catalog.unnest(p.polroles) AS r(role_id)), ' ' ORDER BY p.polcmd::text COLLATE "C") INTO listed
      FROM pg_catalog.pg_policy AS p
     WHERE p.polrelid = pg_catalog.to_regclass(object_name);
    IF listed IS DISTINCT FROM 'a:true:authenticated d:true:authenticated r:true:authenticated' THEN
      RAISE EXCEPTION 'community_watch_save_policies:%:%', object_name, listed;
    END IF;
    -- The insert rule names the member, a visible topic and an unblocked pair.
    SELECT coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '') INTO listed
      FROM pg_catalog.pg_policy AS p
     WHERE p.polrelid = pg_catalog.to_regclass(object_name) AND p.polcmd = 'a';
    IF pg_catalog.strpos(listed, 'uid()') = 0
       OR pg_catalog.strpos(listed, 'status = ''active''') = 0
       OR pg_catalog.strpos(listed, 'moderation_private.profile_content_visible(post.user_id)') = 0
       OR pg_catalog.strpos(listed, 'private.current_user_can_access_pair(') = 0 THEN
      RAISE EXCEPTION 'community_watch_save_insert_policy:%:%', object_name, listed;
    END IF;
    FOR expected IN
      SELECT * FROM (VALUES
      ('anon', 'SELECT', ''), ('anon', 'INSERT', ''), ('anon', 'UPDATE', ''),
      ('authenticated', 'SELECT', 'created_at,post_id,user_id'),
      ('authenticated', 'INSERT', 'post_id,user_id'),
      ('authenticated', 'UPDATE', '')
      ) AS target(role_name, privilege, columns)
    LOOP
      SELECT coalesce(pg_catalog.string_agg(a.attname::text, ',' ORDER BY a.attname::text COLLATE "C"), '') INTO listed
        FROM pg_catalog.pg_attribute AS a
       WHERE a.attrelid = pg_catalog.to_regclass(object_name) AND a.attnum > 0 AND NOT a.attisdropped
         AND pg_catalog.has_column_privilege(expected.role_name, a.attrelid, a.attnum, expected.privilege);
      IF listed IS DISTINCT FROM expected.columns THEN
        RAISE EXCEPTION 'community_watch_save_table_privileges:%:%:%:%', object_name, expected.role_name, expected.privilege, listed;
      END IF;
    END LOOP;
    IF NOT pg_catalog.has_table_privilege('authenticated', object_name, 'DELETE')
       OR pg_catalog.has_table_privilege('anon', object_name, 'DELETE')
       OR pg_catalog.has_table_privilege('authenticated', object_name, 'TRUNCATE')
       OR pg_catalog.has_table_privilege('anon', object_name, 'TRUNCATE')
       OR NOT pg_catalog.has_table_privilege('service_role', object_name, 'SELECT')
       OR NOT pg_catalog.has_table_privilege('service_role', object_name, 'INSERT')
       OR NOT pg_catalog.has_table_privilege('service_role', object_name, 'UPDATE')
       OR NOT pg_catalog.has_table_privilege('service_role', object_name, 'DELETE') THEN
      RAISE EXCEPTION 'community_watch_save_table_level_privileges:%', object_name;
    END IF;
    -- D-49: a watch and a save stay open to restricted accounts, so the
    -- restricted-account guard is attached to neither table.
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                WHERE tgrelid = pg_catalog.to_regclass(object_name) AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'community_watch_save_unexpected_trigger:%', object_name;
    END IF;
  END LOOP;

  -- 3. Indexes, by definition.
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.post_follows_post_idx', '(post_id, created_at)'),
    ('public.post_bookmarks_user_idx', '(user_id, created_at DESC, post_id)'),
    ('public.post_bookmarks_post_idx', '(post_id)'),
    ('public.posts_board_activity_idx', '(region, category, last_activity_at DESC, id DESC) WHERE (status = ''active''::text)'),
    ('public.posts_activity_idx', '(region, last_activity_at DESC, id DESC) WHERE (status = ''active''::text)'),
    ('public.posts_unanswered_idx', '(region, created_at DESC, id DESC) WHERE ((status = ''active''::text) AND (title IS NOT NULL) AND (answered_at IS NULL))')
    ) AS target(index_name, definition)
  LOOP
    SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO listed
      FROM pg_catalog.pg_index AS i
     WHERE i.indexrelid = pg_catalog.to_regclass(expected.index_name) AND i.indisvalid AND i.indisready;
    IF listed IS NULL OR pg_catalog.right(listed, pg_catalog.length(expected.definition)) <> expected.definition THEN
      RAISE EXCEPTION 'community_watch_save_index:%:%', expected.index_name, coalesce(listed, 'missing');
    END IF;
  END LOOP;

  -- 4. The four topic columns, their constraint, and what clients may read
  --    and write: four more readable columns, nothing more writable.
  SELECT pg_catalog.string_agg(a.attname::text || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
           || ':' || coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attname::text COLLATE "C") INTO listed
    FROM pg_catalog.pg_attribute AS a
    LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.posts'::pg_catalog.regclass AND NOT a.attisdropped
     AND a.attname IN ('last_activity_at', 'answered_at', 'is_featured', 'locked_at');
  IF listed IS DISTINCT FROM 'answered_at:timestamp with time zone:false:,is_featured:boolean:true:false,last_activity_at:timestamp with time zone:true:now(),locked_at:timestamp with time zone:false:' THEN
    RAISE EXCEPTION 'community_watch_save_post_columns:%', listed;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid = 'public.posts'::pg_catalog.regclass AND conname = 'posts_featured_official_only'
                    AND contype = 'c' AND convalidated
                    AND pg_catalog.pg_get_constraintdef(oid) = 'CHECK (((NOT is_featured) OR is_official))') THEN
    RAISE EXCEPTION 'community_watch_save_featured_constraint';
  END IF;
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.posts', 'anon', 'SELECT', 'answered_at,category,comment_count,content,content_i18n,created_at,id,image_dimensions,images,is_featured,is_official,is_pinned,last_activity_at,like_count,locked_at,region,source_lang,status,title,updated_at,user_id'),
    ('public.posts', 'authenticated', 'SELECT', 'answered_at,category,comment_count,content,content_i18n,created_at,id,image_dimensions,images,is_featured,is_official,is_pinned,last_activity_at,like_count,locked_at,region,source_lang,status,title,updated_at,user_id'),
    ('public.posts', 'anon', 'INSERT', ''),
    ('public.posts', 'authenticated', 'INSERT', 'category,content,content_i18n,id,image_dimensions,images,source_lang,title,user_id'),
    ('public.posts', 'anon', 'UPDATE', ''),
    -- 20261114015420 guards exactly this list; no writable column was added.
    ('public.posts', 'authenticated', 'UPDATE', 'content_i18n')
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

  -- 5. Reply triggers: the lock refusal right after the restriction refusal
  --    and before every other BEFORE INSERT rule; the counter and both notice
  --    triggers attached and enabled.
  FOR expected IN
    SELECT * FROM (VALUES
    ('enforce_actor_post_comments', 'public.trg_enforce_actor()', 7),
    ('enforce_locked_post_reply', 'private.reject_reply_to_locked_post()', 7),
    ('trg_post_comments_count', 'public.update_post_comment_count()', 13),
    ('trg_notify_post_comment', 'public.notify_post_comment()', 5),
    ('trg_notify_topic_reply', 'private.notify_topic_reply()', 5)
    ) AS target(trigger_name, routine, kind)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger AS t
       WHERE t.tgrelid = 'public.post_comments'::pg_catalog.regclass
         AND t.tgname = expected.trigger_name AND NOT t.tgisinternal
         AND t.tgfoid = pg_catalog.to_regprocedure(expected.routine)
         AND t.tgtype::integer = expected.kind AND t.tgenabled::text = 'O' AND t.tgqual IS NULL) THEN
      RAISE EXCEPTION 'community_watch_save_reply_trigger:%', expected.trigger_name;
    END IF;
  END LOOP;
  SELECT pg_catalog.string_agg(t.tgname::text, ',' ORDER BY t.tgname::text COLLATE "C") INTO listed
    FROM pg_catalog.pg_trigger AS t
   WHERE t.tgrelid = 'public.post_comments'::pg_catalog.regclass AND NOT t.tgisinternal
     AND (t.tgtype::integer & 67) = 3 AND (t.tgtype::integer & 4) <> 0
     AND t.tgname::text COLLATE "C" > 'enforce_actor_post_comments'
     AND t.tgname::text COLLATE "C" < 'enforce_locked_post_reply';
  IF listed IS NOT NULL THEN
    RAISE EXCEPTION 'community_watch_save_trigger_order:%', listed;
  END IF;

  -- 6. Administrator vocabularies and capability rows after the migration.
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
      RAISE EXCEPTION 'community_watch_save_vocabulary:%:%', expected.constraint_name, coalesce(listed, 'missing');
    END IF;
  END LOOP;
  SELECT pg_catalog.string_agg(capability.admin_role || ':' || capability.action, ','
           ORDER BY (capability.admin_role || ':' || capability.action) COLLATE "C") INTO listed
    FROM public.admin_role_action_capabilities AS capability;
  IF listed IS DISTINCT FROM 'operator:apply_ban,operator:decide_appeal,operator:lift_suspension,operator:resolve_target_reports,operator:restore_content,operator:set_post_category,operator:set_post_locked,operator:takedown_content,operator:update_report_status,owner:apply_ban,owner:decide_appeal,owner:delete_banner,owner:issue_token,owner:lift_suspension,owner:resolve_target_reports,owner:restore_content,owner:revoke_admin_tokens,owner:revoke_token,owner:set_post_category,owner:set_post_featured,owner:set_post_locked,owner:set_post_official,owner:set_post_pinned,owner:takedown_content,owner:update_report_status,owner:upload_banner,owner:upsert_banner,security_admin:revoke_admin_tokens,security_admin:revoke_token' THEN
    RAISE EXCEPTION 'community_watch_save_capability_rows:%', listed;
  END IF;

  -- 7. D-49: the restricted-account guard is where 20261114015420 put it and
  --    nowhere else.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger
       WHERE tgfoid = pg_catalog.to_regprocedure('private.enforce_restricted_account_write()')
         AND NOT tgisinternal) <> 10 THEN
    RAISE EXCEPTION 'community_watch_save_restricted_account_guard_count';
  END IF;

  -- 8. The backfill: every topic has an activity time no earlier than its own,
  --    a topic with a visible reply from somebody else is answered, and
  --    nothing is featured without being official.
  SELECT pg_catalog.count(*) FILTER (WHERE post.last_activity_at < post.created_at) AS backwards,
         pg_catalog.count(*) FILTER (WHERE post.answered_at IS NULL AND EXISTS (
           SELECT 1 FROM public.post_comments AS reply
            WHERE reply.post_id = post.id AND reply.status = 'active' AND reply.user_id <> post.user_id)) AS unanswered,
         pg_catalog.count(*) FILTER (WHERE post.is_featured AND NOT post.is_official) AS featured
    INTO tally
    FROM public.posts AS post;
  IF tally.backwards <> 0 OR tally.unanswered <> 0 OR tally.featured <> 0 THEN
    RAISE EXCEPTION 'community_watch_save_backfill:%:%:%', tally.backwards, tally.unanswered, tally.featured;
  END IF;
END;
$verify$;
ROLLBACK;
