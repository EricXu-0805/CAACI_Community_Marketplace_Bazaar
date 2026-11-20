-- Read-only deployment precheck for 20261114015420_restricted_account_writes.sql
-- (D-49, ENGINEERING §5.0). Run as postgres right before the migration.
--
-- The md5(prosrc) values are what the local L-SQL replay
-- (docker.io/supabase/postgres:17.6.1.104, RUNBOOK §5.1) reads right after
-- 20261112120000_community_post_topics.sql. Beside each value is the migration
-- and line that holds the latest definition; origin/main (7b18f20) has none
-- later. A different value means the hosted function was changed outside this
-- repository, and the body this migration reissues must be reviewed against it.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
DO $precheck$
DECLARE
  expected record;
  routine record;
  listed text;
  object_name text;
  role_name text;
BEGIN
  -- 1. The eight bodies the migration reissues and the helpers its decision
  --    rests on: stored body, owner, SECURITY DEFINER, fixed search_path, and
  --    exactly the API roles that may execute them (none means owner only).
  --    CREATE OR REPLACE keeps these grants, and VERIFY expects the same.
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.make_offer(uuid,numeric,uuid,text)', 'eee96bd736e5e44d28404fb5ffe2e42f', '20260717141822:537', 'authenticated'),
    ('public.respond_to_offer(uuid,text,uuid,numeric,text)', 'eedd35bdc442a1555de118ec9db12b54', '20260717141822:625', 'authenticated'),
    ('public.propose_meetup(uuid,text,timestamptz,uuid,text)', '63858426acbe8afa26138e97d8be06c3', '20260718250000:192', 'authenticated'),
    ('public.respond_to_meetup(uuid,text,uuid,text,timestamptz,text)', '4441017e1efe799192671e4f10f7e473', '20260718250000:308', 'authenticated'),
    ('public.reschedule_accepted_meetup(uuid,text,timestamptz,uuid,text)', '6f76780627aae2944da4af8ea57081ee', '20260718250000:476', 'authenticated'),
    ('public.submit_transaction_rating(uuid,uuid,integer,text,uuid)', '28afadd43500f64e6e481917239875df', '20260718210000:450', 'authenticated'),
    ('public.enforce_chat_block_boundary()', '8feb985943e203fb4a9b1f6f5bf6a506', '20260916050227:27', ''),
    ('private.chat_media_access(text,boolean)', 'e6ff430f3706418b337508bcb7ae013c', '20260916192738:17', 'authenticated'),
    ('moderation_private.current_profile_state(uuid)', '9c0b020a7ecdaa83372062a1cc85edc6', '20260718160000:284', ''),
    ('public.is_posting_allowed(uuid)', 'f572629404dca4e2f487fb437cd1b12d', '20260718160000:686', 'service_role'),
    ('public.trg_enforce_actor()', '9f2166257b987ce4147e11eb4f441dbf', '20260718160000:633', ''),
    ('public.get_my_profile()', 'e4e09e4d119542f14a84a4765a0a71f1', '20260718160000:708', 'authenticated'),
    ('private.current_account_storage_writes_allowed()', '71fbf20d326d176094196b7a2dbb7974', '20260717194646:308', 'authenticated')
    ) AS known(signature, body_md5, source, api_roles)
  LOOP
    SELECT pg_catalog.md5(p.prosrc) AS body_md5, p.prosecdef,
           pg_catalog.pg_get_userbyid(p.proowner)::text AS owner,
           coalesce(p.proconfig, ARRAY[]::text[]) AS config, p.proacl
      INTO routine
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = pg_catalog.to_regprocedure(expected.signature);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'restricted_account_writes_function_missing:%', expected.signature;
    END IF;
    IF routine.body_md5 IS DISTINCT FROM expected.body_md5 THEN
      RAISE EXCEPTION 'restricted_account_writes_function_drift:%:%:latest definition %',
        expected.signature, routine.body_md5, expected.source;
    END IF;
    IF NOT routine.prosecdef OR routine.owner <> 'postgres'
       OR NOT ('search_path=pg_catalog' = ANY (routine.config)) THEN
      RAISE EXCEPTION 'restricted_account_writes_function_attributes:%', expected.signature;
    END IF;
    SELECT coalesce(pg_catalog.string_agg(
             CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                  ELSE pg_catalog.pg_get_userbyid(acl.grantee)::text END,
             ',' ORDER BY acl.grantee), '')
      INTO listed
      FROM pg_catalog.aclexplode(routine.proacl) AS acl
     WHERE acl.privilege_type = 'EXECUTE'
       AND (acl.grantee = 0
         OR pg_catalog.pg_get_userbyid(acl.grantee)::text IN ('anon', 'authenticated', 'service_role'));
    IF routine.proacl IS NULL OR listed IS DISTINCT FROM expected.api_roles THEN
      RAISE EXCEPTION 'restricted_account_writes_function_grants:%:%', expected.signature, listed;
    END IF;
  END LOOP;

  -- 2. Nothing the migration creates may exist already.
  FOREACH object_name IN ARRAY ARRAY[
    'moderation_private.assert_posting_allowed(uuid)',
    'private.assert_current_account_posting_allowed()',
    'private.enforce_restricted_account_write()'] LOOP
    IF pg_catalog.to_regprocedure(object_name) IS NOT NULL THEN
      RAISE EXCEPTION 'restricted_account_writes_function_already_exists:%', object_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
              WHERE tgname = 'aa_restricted_account_write' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'restricted_account_writes_trigger_already_exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy
              WHERE polrelid = 'storage.objects'::pg_catalog.regclass
                AND polname IN ('restricted_account_blocks_upload_insert',
                                'restricted_account_blocks_upload_update')) THEN
    RAISE EXCEPTION 'restricted_account_writes_policy_already_exists';
  END IF;

  -- 3. No BEFORE ROW trigger may sort ahead of the new one on a guarded table
  --    for the same event, or the refusal would not be the first answer.
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.conversations', 4), ('public.follows', 4), ('public.post_likes', 4),
    ('public.post_comment_likes', 4), ('public.post_items', 4),
    ('public.items', 16), ('public.posts', 16), ('public.post_comments', 16),
    ('public.profiles', 16), ('storage.objects', 20)
    ) AS target(relation, events)
  LOOP
    IF pg_catalog.to_regclass(expected.relation) IS NULL THEN
      RAISE EXCEPTION 'restricted_account_writes_table_missing:%', expected.relation;
    END IF;
    SELECT pg_catalog.string_agg(t.tgname::text, ',') INTO listed
      FROM pg_catalog.pg_trigger AS t
     WHERE t.tgrelid = pg_catalog.to_regclass(expected.relation)
       AND NOT t.tgisinternal
       AND (t.tgtype::integer & 67) = 3
       AND (t.tgtype::integer & expected.events) <> 0
       AND t.tgname::text COLLATE "C" < 'aa_restricted_account_write';
    IF listed IS NOT NULL THEN
      RAISE EXCEPTION 'restricted_account_writes_trigger_order:%:%', expected.relation, listed;
    END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
           WHERE oid = 'storage.objects'::pg_catalog.regclass) THEN
    RAISE EXCEPTION 'restricted_account_writes_storage_rls_disabled';
  END IF;
  -- The existing gates and Storage policies the migration builds on. VERIFY
  -- expects the same ones afterwards, so a missing one is found here first.
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.posts', 'enforce_actor_posts'), ('public.post_comments', 'enforce_actor_post_comments'),
    ('public.items', 'enforce_actor_items'), ('public.messages', 'enforce_actor_messages')
    ) AS target(relation, trigger_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger AS t
       WHERE t.tgrelid = pg_catalog.to_regclass(expected.relation)
         AND t.tgname = expected.trigger_name AND NOT t.tgisinternal
         AND t.tgfoid = pg_catalog.to_regprocedure('public.trg_enforce_actor()')
         AND t.tgtype::integer = 7 AND t.tgenabled::text = 'O') THEN
      RAISE EXCEPTION 'restricted_account_writes_actor_trigger:%', expected.relation;
    END IF;
  END LOOP;
  FOREACH object_name IN ARRAY ARRAY[
    'Authenticated users can upload to own folder', 'Owner can list own images',
    'Users can delete own images', 'account_deletion_tombstone_blocks_item_image_insert',
    'account_deletion_tombstone_blocks_item_image_update', 'chat_media_participant_read',
    'chat_media_sender_insert', 'chat_media_unlinked_delete'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
                    WHERE polrelid = 'storage.objects'::pg_catalog.regclass AND polname = object_name) THEN
      RAISE EXCEPTION 'restricted_account_writes_existing_policy_missing:%', object_name;
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_schema_privilege('authenticated', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'restricted_account_writes_private_schema_usage_missing';
  END IF;

  -- 4. The guard names every authored column. A client-writable column outside
  --    that list would be an edit path the guard does not see.
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.items', 'category,condition,description,description_i18n,image_dimensions,images,listing_details,location,location_check_token,negotiable,price,source_lang,status,title,title_i18n'),
    ('public.posts', 'category,content,content_i18n,image_dimensions,images,source_lang,title'),
    ('public.post_comments', 'content,content_i18n'),
    ('public.profiles', 'avatar_url,bio,location,nickname,status_emoji,status_text')
    ) AS target(relation, guarded)
  LOOP
    SELECT pg_catalog.string_agg(c.name, ',' ORDER BY c.name COLLATE "C") INTO listed
      FROM pg_catalog.unnest(pg_catalog.string_to_array(expected.guarded, ',')) AS c(name)
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute AS a
        WHERE a.attrelid = pg_catalog.to_regclass(expected.relation)
          AND a.attname = c.name AND a.attnum > 0 AND NOT a.attisdropped);
    IF listed IS NOT NULL THEN
      RAISE EXCEPTION 'restricted_account_writes_column_missing:%:%', expected.relation, listed;
    END IF;
    SELECT pg_catalog.string_agg(a.attname::text, ',' ORDER BY a.attname::text COLLATE "C") INTO listed
      FROM pg_catalog.pg_attribute AS a
     WHERE a.attrelid = pg_catalog.to_regclass(expected.relation)
       AND a.attnum > 0 AND NOT a.attisdropped
       AND (pg_catalog.has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
         OR pg_catalog.has_column_privilege('anon', a.attrelid, a.attnum, 'UPDATE'))
       AND NOT (a.attname::text = ANY (pg_catalog.string_to_array(expected.guarded, ',')));
    IF listed IS NOT NULL THEN
      RAISE EXCEPTION 'restricted_account_writes_unguarded_writable_column:%:%', expected.relation, listed;
    END IF;
  END LOOP;

  -- 5. Offers, meetups and ratings are written through the six RPCs only, and
  --    the retired overloads without expected_user_id_in stay closed.
  FOREACH object_name IN ARRAY ARRAY['public.offers', 'public.meetups', 'public.ratings'] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF pg_catalog.has_any_column_privilege(role_name, object_name, 'INSERT,UPDATE')
         OR pg_catalog.has_table_privilege(role_name, object_name, 'DELETE') THEN
        RAISE EXCEPTION 'restricted_account_writes_direct_write_open:%:%', object_name, role_name;
      END IF;
    END LOOP;
  END LOOP;
  SELECT pg_catalog.string_agg(p.oid::pg_catalog.regprocedure::text, ',') INTO listed
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('make_offer', 'respond_to_offer', 'propose_meetup',
                       'respond_to_meetup', 'reschedule_accepted_meetup',
                       'submit_transaction_rating')
     AND NOT ('expected_user_id_in' = ANY (coalesce(p.proargnames, ARRAY[]::text[])))
     AND (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'));
  IF listed IS NOT NULL THEN
    RAISE EXCEPTION 'restricted_account_writes_legacy_overload_callable:%', listed;
  END IF;
END;
$precheck$;
ROLLBACK;
