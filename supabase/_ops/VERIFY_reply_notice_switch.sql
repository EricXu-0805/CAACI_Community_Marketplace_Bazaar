-- Read-only check of what the reply notice switch turns on (RUNBOOK.md, "Reply
-- notice switch", step 1), for a database where a community migration later
-- than 20261120100354_community_watch_save_activity is applied. There
-- VERIFY_20261120100354 stops by design, and the VERIFY of the later migration
-- does not look at these objects. Run as postgres. Whether the switch is on is
-- reported at the end and not judged.
--
-- The three parts are copied from
-- VERIFY_20261120100354_community_watch_save_activity.sql with their pinned
-- values as they stand there: six function rows of its section 1 (a note of
-- 'this migration' in a row means 20261120100354), the reply triggers of its
-- section 5, and its section 5a. Only the names of the errors differ.
--
-- A migration that changes one of these functions, a reply trigger or the
-- switch table updates the pinned values here in the same commit, and with
-- them the test in scripts/community-events.test.mjs that keeps the pinned
-- values and checking logic equal to VERIFY_20261120100354, excluding
-- exception names and comments.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
-- Catalog text below (column types, keys) is printed relative to this path.
SET LOCAL search_path = pg_catalog, public;
DO $verify$
DECLARE
  expected record;
  routine record;
  listed text;
  object_name text;
BEGIN
  -- 1. The functions a new reply runs through. private.notify_topic_reply()
  --    is the only one that reads the switch, and it calls the last two. For
  --    each: stored body, owner, security, settings, volatility, and exactly
  --    the API roles that may execute it (none means owner only; 'internal'
  --    means not PUBLIC, anon or authenticated).
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.update_post_comment_count()', 'ca13bad5aaed7d210451ba6dc8159616', 'this migration', true, 'v', 'search_path=public', 'internal'),
    ('private.reject_reply_to_locked_post()', '3b6872071d2eb7fb20cfec67a633a1c5', 'this migration', true, 'v', 'search_path=pg_catalog', ''),
    ('private.validate_comment_reply_target()', '4795236eac69a88568327a0c0cd61563', 'this migration', true, 'v', 'search_path=pg_catalog', ''),
    ('private.notify_topic_reply()', 'aca99f42836280e42523f3e64f722908', 'this migration', true, 'v', 'search_path=pg_catalog', ''),
    ('private.enqueue_activity_notification(uuid,uuid,text,text,text,uuid,text)', 'fdb7928eb1930389cdd68173ea7f55eb', 'unchanged', true, 'v', 'search_path=pg_catalog', 'internal'),
    ('moderation_private.current_profile_state(uuid)', '9c0b020a7ecdaa83372062a1cc85edc6', 'unchanged', true, 's', 'search_path=pg_catalog', 'internal')
    ) AS known(signature, body_md5, note, definer, volatility, settings, api_roles)
  LOOP
    SELECT pg_catalog.md5(p.prosrc) AS body_md5, p.prosecdef, p.provolatile::text AS volatility,
           pg_catalog.pg_get_userbyid(p.proowner)::text AS owner,
           coalesce(pg_catalog.array_to_string(p.proconfig, '|'), '') AS settings, p.proacl
      INTO routine
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = pg_catalog.to_regprocedure(expected.signature);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'reply_notice_switch_function_missing:%', expected.signature;
    END IF;
    IF routine.body_md5 IS DISTINCT FROM expected.body_md5 THEN
      RAISE EXCEPTION 'reply_notice_switch_function_body:%:%:%', expected.signature, routine.body_md5, expected.note;
    END IF;
    IF routine.prosecdef IS DISTINCT FROM expected.definer OR routine.owner <> 'postgres'
       OR routine.settings IS DISTINCT FROM expected.settings
       OR routine.volatility IS DISTINCT FROM expected.volatility THEN
      RAISE EXCEPTION 'reply_notice_switch_function_attributes:%:%:%:%', expected.signature, routine.prosecdef, routine.volatility, routine.settings;
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
      RAISE EXCEPTION 'reply_notice_switch_function_grants:%:%', expected.signature, listed;
    END IF;
  END LOOP;

  -- 2. Reply triggers: the lock refusal right after the restriction refusal,
  --    the reply target check right after that, and all three before every
  --    other BEFORE INSERT rule that sorts after them; the counter and both
  --    notice triggers attached and enabled.
  FOR expected IN
    SELECT * FROM (VALUES
    ('enforce_actor_post_comments', 'public.trg_enforce_actor()', 7),
    ('enforce_locked_post_reply', 'private.reject_reply_to_locked_post()', 7),
    ('enforce_reply_target', 'private.validate_comment_reply_target()', 7),
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
      RAISE EXCEPTION 'reply_notice_switch_reply_trigger:%', expected.trigger_name;
    END IF;
  END LOOP;
  SELECT pg_catalog.string_agg(t.tgname::text, ',' ORDER BY t.tgname::text COLLATE "C") INTO listed
    FROM pg_catalog.pg_trigger AS t
   WHERE t.tgrelid = 'public.post_comments'::pg_catalog.regclass AND NOT t.tgisinternal
     AND (t.tgtype::integer & 67) = 3 AND (t.tgtype::integer & 4) <> 0
     AND t.tgname::text COLLATE "C" > 'enforce_actor_post_comments'
     AND t.tgname::text COLLATE "C" < 'enforce_reply_target';
  IF listed IS DISTINCT FROM 'enforce_locked_post_reply' THEN
    RAISE EXCEPTION 'reply_notice_switch_trigger_order:%', coalesce(listed, 'none');
  END IF;

  -- 3. The switch itself: one row, row security on with no policy, and an
  --    access list that holds nothing but the owner's own entry. Whether it
  --    is on is reported and not judged: it is turned on per database, by
  --    the steps of the runbook section named above.
  IF pg_catalog.to_regclass('private.community_reply_notice_config') IS NULL THEN
    RAISE EXCEPTION 'reply_notice_switch_table_missing';
  END IF;
  SELECT pg_catalog.string_agg(a.attname::text || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
           || ':' || coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attnum) INTO listed
    FROM pg_catalog.pg_attribute AS a
    LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'private.community_reply_notice_config'::pg_catalog.regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF listed IS DISTINCT FROM 'singleton:boolean:true:true,enabled:boolean:true:false' THEN
    RAISE EXCEPTION 'reply_notice_switch_table_columns:%', listed;
  END IF;
  SELECT pg_catalog.string_agg(c.contype::text || ':' || pg_catalog.pg_get_constraintdef(c.oid), ' | '
           ORDER BY c.contype::text COLLATE "C" DESC) INTO listed
    FROM pg_catalog.pg_constraint AS c
   WHERE c.conrelid = 'private.community_reply_notice_config'::pg_catalog.regclass AND c.convalidated;
  IF listed IS DISTINCT FROM 'p:PRIMARY KEY (singleton) | c:CHECK (singleton)' THEN
    RAISE EXCEPTION 'reply_notice_switch_table_keys:%', listed;
  END IF;
  SELECT c.relrowsecurity::text || ':' || pg_catalog.pg_get_userbyid(c.relowner)::text
           || ':' || (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy AS p WHERE p.polrelid = c.oid)::text
           || ':' || (SELECT pg_catalog.count(*) FROM pg_catalog.aclexplode(c.relacl) AS entry WHERE entry.grantee <> c.relowner)::text
           || ':' || (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger AS t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal)::text INTO listed
    FROM pg_catalog.pg_class AS c
   WHERE c.oid = 'private.community_reply_notice_config'::pg_catalog.regclass;
  IF listed IS DISTINCT FROM 'true:postgres:0:0:0' THEN
    RAISE EXCEPTION 'reply_notice_switch_table_closed:%', listed;
  END IF;
  FOREACH object_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_table_privilege(object_name, 'private.community_reply_notice_config', 'SELECT')
       OR pg_catalog.has_table_privilege(object_name, 'private.community_reply_notice_config', 'INSERT')
       OR pg_catalog.has_table_privilege(object_name, 'private.community_reply_notice_config', 'UPDATE')
       OR pg_catalog.has_table_privilege(object_name, 'private.community_reply_notice_config', 'DELETE')
       OR pg_catalog.has_table_privilege(object_name, 'private.community_reply_notice_config', 'TRUNCATE') THEN
      RAISE EXCEPTION 'reply_notice_switch_table_privilege:%', object_name;
    END IF;
  END LOOP;
  SELECT pg_catalog.count(*)::text || ':' || coalesce(pg_catalog.bool_and(switch.singleton)::text, 'none') INTO listed
    FROM private.community_reply_notice_config AS switch;
  IF listed IS DISTINCT FROM '1:true' THEN
    RAISE EXCEPTION 'reply_notice_switch_row:%', listed;
  END IF;
  RAISE NOTICE 'community_reply_notice_switch|enabled=%',
    (SELECT switch.enabled FROM private.community_reply_notice_config AS switch);
END;
$verify$;
ROLLBACK;
