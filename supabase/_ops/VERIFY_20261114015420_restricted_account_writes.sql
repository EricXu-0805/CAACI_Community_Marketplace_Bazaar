-- Read-only verification for 20261114015420_restricted_account_writes.sql
-- (D-49, ENGINEERING §5.0). Run as postgres right after the migration.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
DO $verify$
DECLARE
  expected record;
  routine record;
  guard record;
  listed text;
  object_name text;
  role_name text;
  attached integer;
BEGIN
  -- 1. The three new functions and the eight reissued ones: stored body,
  --    owner, SECURITY DEFINER, fixed search_path, volatility, and exactly the
  --    API roles that may execute them (none means owner only).
  FOR expected IN
    SELECT * FROM (VALUES
    ('moderation_private.assert_posting_allowed(uuid)', 'bce717345cade3cf4d4656b20d5ae2df', 's', ''),
    ('private.assert_current_account_posting_allowed()', '92cb2630b2ede5e1fbf32ab3241c3eaa', 's', 'authenticated'),
    ('private.enforce_restricted_account_write()', 'a24e049ab3c5926bbb8b80979b00728d', 'v', ''),
    ('public.make_offer(uuid,numeric,uuid,text)', '1bbf7069e0ed4019eea3ee95019abb44', 'v', 'authenticated'),
    ('public.respond_to_offer(uuid,text,uuid,numeric,text)', 'b762965ef122f0458af8f5c51f378dd2', 'v', 'authenticated'),
    ('public.propose_meetup(uuid,text,timestamptz,uuid,text)', 'f12395a1a79372db206037846e552d84', 'v', 'authenticated'),
    ('public.respond_to_meetup(uuid,text,uuid,text,timestamptz,text)', '353c3c3191ed8b96aeb5e3daedfe52da', 'v', 'authenticated'),
    ('public.reschedule_accepted_meetup(uuid,text,timestamptz,uuid,text)', '9dc04ae646fe8daeb64fc82c5100f550', 'v', 'authenticated'),
    ('public.submit_transaction_rating(uuid,uuid,integer,text,uuid)', '7b42793c41dc26c0cbc0f98afa612d8d', 'v', 'authenticated'),
    ('public.enforce_chat_block_boundary()', '5e471e1bc792fe4d13e49e8179fbb3c3', 'v', ''),
    ('private.chat_media_access(text,boolean)', '04f7c711f411431a73935cd814c6a677', 's', 'authenticated')
    ) AS known(signature, body_md5, volatility, api_roles)
  LOOP
    SELECT p.oid, pg_catalog.md5(p.prosrc) AS body_md5, p.prosecdef, p.provolatile::text AS volatility,
           pg_catalog.pg_get_userbyid(p.proowner)::text AS owner,
           coalesce(p.proconfig, ARRAY[]::text[]) AS config, p.proacl
      INTO routine
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = pg_catalog.to_regprocedure(expected.signature);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'restricted_account_writes_function_missing:%', expected.signature;
    END IF;
    IF routine.body_md5 IS DISTINCT FROM expected.body_md5 THEN
      RAISE EXCEPTION 'restricted_account_writes_function_body:%:%', expected.signature, routine.body_md5;
    END IF;
    IF NOT routine.prosecdef OR routine.owner <> 'postgres'
       OR NOT ('search_path=pg_catalog' = ANY (routine.config))
       OR routine.volatility <> expected.volatility THEN
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

  -- 2. The helpers the decision rests on are the ones that were reviewed.
  FOR expected IN
    SELECT * FROM (VALUES
    ('moderation_private.current_profile_state(uuid)', '9c0b020a7ecdaa83372062a1cc85edc6'),
    ('public.is_posting_allowed(uuid)', 'f572629404dca4e2f487fb437cd1b12d'),
    ('public.trg_enforce_actor()', '9f2166257b987ce4147e11eb4f441dbf'),
    ('public.get_my_profile()', 'e4e09e4d119542f14a84a4765a0a71f1'),
    ('private.current_account_storage_writes_allowed()', '71fbf20d326d176094196b7a2dbb7974')
    ) AS known(signature, body_md5)
  LOOP
    SELECT pg_catalog.md5(p.prosrc) INTO listed
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = pg_catalog.to_regprocedure(expected.signature);
    IF listed IS DISTINCT FROM expected.body_md5 THEN
      RAISE EXCEPTION 'restricted_account_writes_helper_drift:%:%', expected.signature, coalesce(listed, 'missing');
    END IF;
  END LOOP;

  -- 3. Ten attachments of the row trigger: enabled, BEFORE ROW, the expected
  --    events and column list, no WHEN clause, and first in firing order.
  attached := 0;
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.conversations', 7, ''),
    ('public.follows', 7, ''),
    ('public.post_likes', 7, ''),
    ('public.post_comment_likes', 7, ''),
    ('public.post_items', 7, ''),
    ('public.items', 19, 'category,condition,description,description_i18n,image_dimensions,images,listing_details,location,location_check_token,negotiable,price,source_lang,status,title,title_i18n'),
    ('public.posts', 19, 'category,content,content_i18n,image_dimensions,images,source_lang,title'),
    ('public.post_comments', 19, 'content,content_i18n'),
    ('public.profiles', 19, 'avatar_url,bio,location,nickname,status_emoji,status_text'),
    ('storage.objects', 23, '')
    ) AS target(relation, kind, guarded)
  LOOP
    SELECT t.oid, t.tgrelid, t.tgtype::integer AS kind, t.tgenabled::text AS enabled,
           t.tgqual IS NULL AS unconditional,
           coalesce((
             SELECT pg_catalog.string_agg(a.attname::text, ',' ORDER BY a.attname::text COLLATE "C")
               FROM pg_catalog.unnest(pg_catalog.string_to_array(t.tgattr::text, ' ')) AS k(attnum)
               JOIN pg_catalog.pg_attribute AS a
                 ON a.attrelid = t.tgrelid AND a.attnum = k.attnum::smallint
              WHERE k.attnum <> ''), '') AS guarded
      INTO guard
      FROM pg_catalog.pg_trigger AS t
     WHERE t.tgrelid = pg_catalog.to_regclass(expected.relation)
       AND t.tgname = 'aa_restricted_account_write' AND NOT t.tgisinternal
       AND t.tgfoid = pg_catalog.to_regprocedure('private.enforce_restricted_account_write()');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'restricted_account_writes_trigger_missing:%', expected.relation;
    END IF;
    IF guard.kind <> expected.kind OR guard.enabled <> 'O' OR NOT guard.unconditional
       OR guard.guarded IS DISTINCT FROM expected.guarded THEN
      RAISE EXCEPTION 'restricted_account_writes_trigger_shape:%:%:%:%',
        expected.relation, guard.kind, guard.enabled, guard.guarded;
    END IF;
    SELECT pg_catalog.string_agg(other.tgname::text, ',') INTO listed
      FROM pg_catalog.pg_trigger AS other
     WHERE other.tgrelid = guard.tgrelid AND NOT other.tgisinternal AND other.oid <> guard.oid
       AND (other.tgtype::integer & 67) = 3
       AND (other.tgtype::integer & guard.kind & 28) <> 0
       AND other.tgname::text COLLATE "C" < 'aa_restricted_account_write';
    IF listed IS NOT NULL THEN
      RAISE EXCEPTION 'restricted_account_writes_trigger_order:%:%', expected.relation, listed;
    END IF;
    attached := attached + 1;
  END LOOP;
  IF attached <> 10 OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger
                         WHERE tgfoid = pg_catalog.to_regprocedure('private.enforce_restricted_account_write()')
                           AND NOT tgisinternal) <> 10 THEN
    RAISE EXCEPTION 'restricted_account_writes_trigger_count';
  END IF;

  -- 4. New posts, replies, listings and messages keep their original gate.
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

  -- 5. Two RESTRICTIVE Storage policies for authenticated; the existing
  --    policies are all still there and no read or delete rule was added.
  FOR expected IN
    SELECT * FROM (VALUES
    ('restricted_account_blocks_upload_insert', 'a'), ('restricted_account_blocks_upload_update', 'w')
    ) AS target(policy_name, command)
  LOOP
    SELECT p.polpermissive, p.polcmd::text AS command,
           (SELECT pg_catalog.string_agg(pg_catalog.pg_get_userbyid(r.role_id)::text, ',')
              FROM pg_catalog.unnest(p.polroles) AS r(role_id)) AS roles,
           coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '') AS using_text,
           coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '') AS check_text
      INTO guard
      FROM pg_catalog.pg_policy AS p
     WHERE p.polrelid = 'storage.objects'::pg_catalog.regclass AND p.polname = expected.policy_name;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'restricted_account_writes_policy_missing:%', expected.policy_name;
    END IF;
    IF guard.polpermissive OR guard.command <> expected.command
       OR guard.roles IS DISTINCT FROM 'authenticated'
       OR guard.using_text NOT IN ('', 'true')
       OR pg_catalog.strpos(guard.check_text, 'CASE') = 0
       OR pg_catalog.strpos(guard.check_text, '''item-images''') = 0
       OR pg_catalog.strpos(guard.check_text, '''chat-media''') = 0
       OR pg_catalog.strpos(guard.check_text, 'private.assert_current_account_posting_allowed()') = 0
       OR pg_catalog.strpos(guard.check_text, 'ELSE true') = 0 THEN
      RAISE EXCEPTION 'restricted_account_writes_policy_shape:%:%:%:%',
        expected.policy_name, guard.roles, guard.using_text, guard.check_text;
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
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy
              WHERE polrelid = 'storage.objects'::pg_catalog.regclass
                AND polname LIKE 'restricted\_account\_%' AND polcmd IN ('r', 'd', '*')) THEN
    RAISE EXCEPTION 'restricted_account_writes_read_or_delete_policy_added';
  END IF;
  IF NOT pg_catalog.has_schema_privilege('authenticated', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'restricted_account_writes_private_schema_usage_missing';
  END IF;

  -- 6. No client-writable column sits outside the guard, and the tables that
  --    are written through RPCs only are still closed to direct writes.
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.items', 'category,condition,description,description_i18n,image_dimensions,images,listing_details,location,location_check_token,negotiable,price,source_lang,status,title,title_i18n'),
    ('public.posts', 'category,content,content_i18n,image_dimensions,images,source_lang,title'),
    ('public.post_comments', 'content,content_i18n'),
    ('public.profiles', 'avatar_url,bio,location,nickname,status_emoji,status_text')
    ) AS target(relation, guarded)
  LOOP
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
$verify$;
ROLLBACK;
