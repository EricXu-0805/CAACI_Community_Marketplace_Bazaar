-- Read-only verification for 20261122035253_community_member_events.sql.
-- Run as postgres. A later migration changing a checked object must update
-- this file and its equality test in scripts/community-member-events.test.mjs
-- in the same commit.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
-- Catalog text below (constraints, policies) is printed relative to this path.
SET LOCAL search_path = pg_catalog, public;
DO $verify$
DECLARE
  expected record;
  routine record;
  listed text;
BEGIN
  -- 1. The ten bodies this migration issues (the audit list of the moderation
  --    role among them, with two more kinds: D-55 3b), the previous
  --    dispatcher under its new name, the helpers and topic triggers left as
  --    they were, and
  --    the functions that report the administrator vocabulary to the deployed
  --    API, which must not have changed: stored body, owner, security,
  --    settings, volatility, and exactly the API roles that may execute them
  --    (none means owner only; 'internal' means not PUBLIC, anon or
  --    authenticated). This migration grants the member write channel; new
  --    events require the member event switch to be on.
  FOR expected IN
    SELECT * FROM (VALUES
    ('private.community_events_schedule_change()', 'e4a2e33f688e3f6d4e192a3426b0ea36', 'this migration', false, 'v', 'search_path=pg_catalog', ''),
    ('private.community_events_member_guard()', 'd865909286d0bf4a90d0796ca898b6eb', 'this migration', true, 'v', 'search_path=pg_catalog', ''),
    ('private.community_events_moderate_text()', 'c3da68f508cbcee6724a6926892300ed', 'this migration', true, 'v', 'search_path=pg_catalog', ''),
    ('private.community_events_post_link()', '2831761c52a0d5280010f9cb6a9a406e', 'this migration', false, 'v', 'search_path=pg_catalog', ''),
    ('private.community_events_follow_topic()', '5f543fbda17b88b20d579d2d27023e99', 'this migration', true, 'v', 'search_path=pg_catalog', ''),
    ('public.create_member_event(uuid,text,text,jsonb)', '5fc68d086e78fa45463110a8f7413e87', 'this migration', false, 'v', 'search_path=pg_catalog', 'authenticated'),
    ('public.community_member_events_open()', '8d82d9012631e5eee8b23e19af62a64a', 'this migration', true, 's', 'search_path=pg_catalog|statement_timeout=3s', 'anon,authenticated'),
    ('public.list_community_events(text,text,text,integer)', '51369430c8c82f1816a168ed8754f736', 'this migration', false, 's', 'search_path=pg_catalog|statement_timeout=3s', 'anon,authenticated'),
    ('public.admin_execute_community_events(text,uuid,text,text,jsonb)', 'f3095aaa03fcc202ae3b5e99e1eede08', 'this migration', true, 'v', 'search_path=pg_catalog', ''),
    ('public.admin_execute_mutation(text,uuid,text,text,jsonb)', '7fe35010e58dd31b96b0c9bc454cb2dc', 'this migration', true, 'v', 'search_path=pg_catalog', 'service_role'),
    ('public.admin_execute_mutation_pre_community_events(text,uuid,text,text,jsonb)', '64d6f1d37e03577d534ccc5e1d496499', 'renamed, body unchanged', true, 'v', 'search_path=pg_catalog', ''),
    ('public.admin_assert_mutation_capability(uuid,text)', '51c79ee5189f512333e2e8a3e4b47ba0', 'unchanged', true, 'v', 'search_path=pg_catalog', 'internal'),
    ('public.record_audit(text,uuid,uuid,jsonb)', '38cb635c4cf81051966bc563ebf6142d', 'unchanged', true, 'v', 'search_path=pg_catalog', 'service_role'),
    ('public.admin_moderation_reason_valid(text)', '3f75864d5dfc236033a8cd232238baf2', 'unchanged', false, 'i', 'search_path=pg_catalog', 'internal'),
    ('moderation_private.profile_content_visible(uuid)', 'a41223ba4e42754a12eec610e9ab03cf', 'unchanged', true, 's', 'search_path=pg_catalog', 'anon,authenticated,service_role'),
    ('moderation_private.assert_posting_allowed(uuid)', 'bce717345cade3cf4d4656b20d5ae2df', 'unchanged', true, 's', 'search_path=pg_catalog', 'internal'),
    ('public.update_updated_at()', 'da5ac28a58c8b4bb30209bf0d3d7082c', 'unchanged', false, 'v', 'search_path=public', 'PUBLIC,anon,authenticated,service_role'),
    ('private.assert_moderated_text(text,text)', 'bae3b8646a2fb7121a92f0ba17a90c1d', 'unchanged', true, 's', 'search_path=pg_catalog', 'internal'),
    ('public.trg_enforce_actor()', '9f2166257b987ce4147e11eb4f441dbf', 'unchanged', true, 'v', 'search_path=pg_catalog', 'internal'),
    ('public.rl_posts_before_insert()', '9a9c58f8ae22fc7785f85cead870e834', 'unchanged', true, 'v', 'search_path=public', 'internal'),
    ('public.admin_token_authorization(text)', 'fc2446534ec9ec9b89aa901f9fd81ea6', 'unchanged', true, 'v', 'search_path=pg_catalog', 'service_role'),
    ('public.admin_token_authorization_v2(text)', '37d5ed1fbb3fc8a098ba942442479110', 'unchanged', true, 'v', 'search_path=pg_catalog', 'service_role'),
    ('public.admin_list_moderation_audit_log(integer,integer,text)', '720fe81c9d72c7729ce2d184a8a8fd36', 'this migration', true, 's', 'search_path=pg_catalog', 'service_role'),
    ('public.admin_execute_community_governance(text,uuid,text,text,jsonb)', 'fedabd431c829a5b2303e4a46961a855', 'unchanged', true, 'v', 'search_path=pg_catalog', ''),
    ('public.admin_execute_mutation_pre_community_governance(text,uuid,text,text,jsonb)', 'a30b6224c23ab4ebdef61b54eb37af5a', 'unchanged', true, 'v', 'search_path=pg_catalog', '')
    ) AS known(signature, body_md5, note, definer, volatility, settings, api_roles)
  LOOP
    SELECT pg_catalog.md5(p.prosrc) AS body_md5, p.prosecdef, p.provolatile::text AS volatility,
           pg_catalog.pg_get_userbyid(p.proowner)::text AS owner,
           coalesce(pg_catalog.array_to_string(p.proconfig, '|'), '') AS settings, p.proacl
      INTO routine
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = pg_catalog.to_regprocedure(expected.signature);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'community_member_events_function_missing:%', expected.signature;
    END IF;
    IF routine.body_md5 IS DISTINCT FROM expected.body_md5 THEN
      RAISE EXCEPTION 'community_member_events_function_body:%:%:%', expected.signature, routine.body_md5, expected.note;
    END IF;
    IF routine.prosecdef IS DISTINCT FROM expected.definer OR routine.owner <> 'postgres'
       OR routine.settings IS DISTINCT FROM expected.settings
       OR routine.volatility IS DISTINCT FROM expected.volatility THEN
      RAISE EXCEPTION 'community_member_events_function_attributes:%:%:%:%', expected.signature, routine.prosecdef, routine.volatility, routine.settings;
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
      RAISE EXCEPTION 'community_member_events_function_grants:%:%', expected.signature, listed;
    END IF;
  END LOOP;

  -- 2. The three tables: columns, every validated constraint, row security,
  --    every policy, and exactly the column privileges. Constraint and policy
  --    text is compared as PostgreSQL prints it, with runs of white space
  --    folded to one space.
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.community_event_partners', $d$id:uuid:true:gen_random_uuid(),slug:text:true:,name_zh:text:true:,name_en:text:true:,status:text:true:'active'::text,consent_ref:text:true:,consent_recorded_on:date:true:,contact_role:text:true:,allowed_link_hosts:text[]:true:'{}'::text[],revoked_at:timestamp with time zone:false:,created_at:timestamp with time zone:true:now(),updated_at:timestamp with time zone:true:now()$d$),
    ('public.community_events', $d$id:uuid:true:gen_random_uuid(),source_type:text:true:,source_key:text:true:,region:text:true:'cu'::text,organizer_name:text:false:,partner_id:uuid:false:,consent_ref:text:false:,title:text:false:,title_en:text:false:,summary:text:false:,summary_en:text:false:,starts_at:timestamp with time zone:true:,ends_at:timestamp with time zone:false:,all_day:boolean:true:false,occurrence_count:integer:true:1,time_zone:text:true:'America/Chicago'::text,location:text:false:,page_url:text:false:,register_url:text:false:,registration_mode:text:true:,takes_registrations:boolean:false:,registration_open:boolean:false:,organizer_user_id:uuid:false:,discussion_post_id:uuid:false:,availability:text:true:'visible'::text,hidden_reason:text:false:,cancelled_at:timestamp with time zone:false:,status_note:text:false:,previous_starts_at:timestamp with time zone:false:,schedule_changed_at:timestamp with time zone:false:,revision:integer:true:1,review_flag:text:false:,duplicate_of:uuid:false:,content_hash:text:false:,source_updated_at:timestamp with time zone:false:,last_checked_at:timestamp with time zone:false:,first_seen_at:timestamp with time zone:false:,last_seen_at:timestamp with time zone:false:,missing_since:timestamp with time zone:false:,missing_checks:smallint:true:0,created_by:uuid:false:,created_at:timestamp with time zone:true:now(),updated_at:timestamp with time zone:true:now()$d$),
    ('public.community_event_sync_state', $d$source:text:true:,last_attempt_at:timestamp with time zone:false:,last_success_at:timestamp with time zone:false:,last_outcome:text:false:,last_error_code:text:false:$d$)
    ) AS known(relation, columns)
  LOOP
    IF pg_catalog.to_regclass(expected.relation) IS NULL THEN
      RAISE EXCEPTION 'community_member_events_table_missing:%', expected.relation;
    END IF;
    SELECT pg_catalog.string_agg(a.attname::text || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
             || ':' || coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attnum) INTO listed
      FROM pg_catalog.pg_attribute AS a
      LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = pg_catalog.to_regclass(expected.relation) AND a.attnum > 0 AND NOT a.attisdropped;
    IF listed IS DISTINCT FROM expected.columns THEN
      RAISE EXCEPTION 'community_member_events_table_columns:%:%', expected.relation, listed;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = pg_catalog.to_regclass(expected.relation)) THEN
      RAISE EXCEPTION 'community_member_events_row_security_off:%', expected.relation;
    END IF;
    -- The tables belong to postgres, like the functions.
    IF (SELECT pg_catalog.pg_get_userbyid(c.relowner)::text FROM pg_catalog.pg_class AS c
         WHERE c.oid = pg_catalog.to_regclass(expected.relation)) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION 'community_member_events_table_owner:%', expected.relation;
    END IF;
    -- No API role holds a table-level privilege other than reading, and
    -- PUBLIC holds none: nobody inserts, updates, deletes, truncates,
    -- references or adds a trigger, and the service role only reads. (The
    -- column lists further down say the same of every single column.)
    IF EXISTS (
         SELECT 1
           FROM pg_catalog.unnest(ARRAY['anon', 'authenticated', 'service_role']) AS api(role_name),
                pg_catalog.unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS denied(privilege)
          WHERE pg_catalog.has_table_privilege(api.role_name, expected.relation, denied.privilege))
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_class AS c, pg_catalog.aclexplode(c.relacl) AS entry
          WHERE c.oid = pg_catalog.to_regclass(expected.relation) AND entry.grantee = 0)
       OR NOT pg_catalog.has_table_privilege('service_role', expected.relation, 'SELECT') THEN
      RAISE EXCEPTION 'community_member_events_table_level_privileges:%', expected.relation;
    END IF;
  END LOOP;
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.community_event_partners', 'community_event_partners_allowed_link_hosts_check', 'c', $d$CHECK ((cardinality(allowed_link_hosts) <= 5))$d$),
    ('public.community_event_partners', 'community_event_partners_check', 'c', $d$CHECK (((status = 'revoked'::text) = (revoked_at IS NOT NULL)))$d$),
    ('public.community_event_partners', 'community_event_partners_consent_ref_check', 'c', $d$CHECK ((consent_ref ~ '^[A-Za-z0-9-]{3,40}$'::text))$d$),
    ('public.community_event_partners', 'community_event_partners_contact_role_check', 'c', $d$CHECK (((char_length(contact_role) >= 2) AND (char_length(contact_role) <= 60)))$d$),
    ('public.community_event_partners', 'community_event_partners_name_en_check', 'c', $d$CHECK (((char_length(name_en) >= 1) AND (char_length(name_en) <= 80)))$d$),
    ('public.community_event_partners', 'community_event_partners_name_zh_check', 'c', $d$CHECK (((char_length(name_zh) >= 1) AND (char_length(name_zh) <= 40)))$d$),
    ('public.community_event_partners', 'community_event_partners_pkey', 'p', $d$PRIMARY KEY (id)$d$),
    ('public.community_event_partners', 'community_event_partners_slug_check', 'c', $d$CHECK ((slug ~ '^[a-z0-9-]{2,32}$'::text))$d$),
    ('public.community_event_partners', 'community_event_partners_slug_key', 'u', $d$UNIQUE (slug)$d$),
    ('public.community_event_partners', 'community_event_partners_status_check', 'c', $d$CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'revoked'::text])))$d$),
    ('public.community_events', 'community_events_all_day_end_check', 'c', $d$CHECK (((NOT all_day) OR ((ends_at IS NOT NULL) AND (ends_at > starts_at))))$d$),
    ('public.community_events', 'community_events_availability_check', 'c', $d$CHECK ((availability = ANY (ARRAY['visible'::text, 'unavailable'::text, 'hidden'::text])))$d$),
    ('public.community_events', 'community_events_caaci_shape', 'c', $d$CHECK (((source_type <> 'caaci'::text) OR ((source_key ~ '^[0-9a-f-]{36}$'::text) AND (page_url ~ '^https://caaciorg[.]com/events/#[A-Za-z0-9-]+$'::text) AND ((register_url IS NULL) OR (register_url ~ '^https://caaciorg[.]com/events/[a-z0-9-]+/register/$'::text)) AND (registration_mode = ANY (ARRAY['caaci_site'::text, 'info_only'::text])) AND (partner_id IS NULL) AND (organizer_user_id IS NULL))))$d$),
    ('public.community_events', 'community_events_campus_shape', 'c', $d$CHECK (((source_type <> 'campus'::text) OR ((source_key ~ '^[0-9]{1,6}/[0-9]{1,12}$'::text) AND (page_url = ('https://calendars.illinois.edu/detail/'::text || source_key)) AND (register_url IS NULL) AND (registration_mode = 'calendar_page'::text) AND (organizer_name IS NOT NULL) AND (COALESCE(title_en, ''::text) <> ''::text) AND (partner_id IS NULL) AND (organizer_user_id IS NULL))))$d$),
    ('public.community_events', 'community_events_cancel_member_check', 'c', $d$CHECK (((cancelled_at IS NULL) OR (source_type = 'member'::text)))$d$),
    ('public.community_events', 'community_events_created_by_fkey', 'f', $d$FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL$d$),
    ('public.community_events', 'community_events_discussion_post_id_fkey', 'f', $d$FOREIGN KEY (discussion_post_id) REFERENCES posts(id) ON DELETE SET NULL$d$),
    ('public.community_events', 'community_events_discussion_post_id_key', 'u', $d$UNIQUE (discussion_post_id)$d$),
    ('public.community_events', 'community_events_display_title_check', 'c', $d$CHECK (((source_type = 'member'::text) OR (COALESCE(title, ''::text) <> ''::text) OR (COALESCE(title_en, ''::text) <> ''::text)))$d$),
    ('public.community_events', 'community_events_duplicate_check', 'c', $d$CHECK (((duplicate_of IS NULL) OR (duplicate_of <> id)))$d$),
    ('public.community_events', 'community_events_duplicate_of_fkey', 'f', $d$FOREIGN KEY (duplicate_of) REFERENCES community_events(id) ON DELETE SET NULL$d$),
    ('public.community_events', 'community_events_hidden_pair_check', 'c', $d$CHECK (((availability = 'hidden'::text) = (hidden_reason IS NOT NULL)))$d$),
    ('public.community_events', 'community_events_hidden_reason_check', 'c', $d$CHECK ((hidden_reason = ANY (ARRAY['admin'::text, 'post_removed'::text])))$d$),
    ('public.community_events', 'community_events_location_check', 'c', $d$CHECK ((char_length(location) <= 160))$d$),
    ('public.community_events', 'community_events_member_shape', 'c', $d$CHECK (((source_type <> 'member'::text) OR ((organizer_user_id IS NOT NULL) AND (source_key ~ '^[0-9a-f-]{36}$'::text) AND (page_url IS NULL) AND (register_url IS NULL) AND (registration_mode = 'discussion'::text) AND (title IS NULL) AND (title_en IS NULL) AND (occurrence_count = 1) AND (location IS NOT NULL) AND (location = btrim(regexp_replace(location, '[\u0009-\u000D \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+'::text, ' '::text, 'g'::text), ' '::text)) AND ((char_length(location) >= 1) AND (char_length(location) <= 80)) AND ((status_note IS NULL) OR (status_note = btrim(regexp_replace(status_note, '[\u0009-\u000D \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+'::text, ' '::text, 'g'::text), ' '::text))))))$d$),
    ('public.community_events', 'community_events_occurrence_count_check', 'c', $d$CHECK (((occurrence_count >= 1) AND (occurrence_count <= 400)))$d$),
    ('public.community_events', 'community_events_organizer_name_check', 'c', $d$CHECK (((char_length(organizer_name) >= 2) AND (char_length(organizer_name) <= 80)))$d$),
    ('public.community_events', 'community_events_organizer_user_id_fkey', 'f', $d$FOREIGN KEY (organizer_user_id) REFERENCES profiles(id) ON DELETE CASCADE$d$),
    ('public.community_events', 'community_events_page_url_check', 'c', $d$CHECK ((char_length(page_url) <= 500))$d$),
    ('public.community_events', 'community_events_partner_id_fkey', 'f', $d$FOREIGN KEY (partner_id) REFERENCES community_event_partners(id)$d$),
    ('public.community_events', 'community_events_partner_shape', 'c', $d$CHECK (((source_type <> 'partner'::text) OR ((partner_id IS NOT NULL) AND (consent_ref IS NOT NULL) AND (consent_ref ~ '^[A-Za-z0-9-]{3,40}$'::text) AND (page_url ~ '^https://'::text) AND ((register_url IS NULL) OR (register_url ~ '^https://'::text)) AND (registration_mode = ANY (ARRAY['external_link'::text, 'info_only'::text])) AND ((registration_mode = 'external_link'::text) = (register_url IS NOT NULL)) AND (COALESCE(summary, ''::text) <> ''::text) AND (organizer_user_id IS NULL))))$d$),
    ('public.community_events', 'community_events_pkey', 'p', $d$PRIMARY KEY (id)$d$),
    ('public.community_events', 'community_events_region_check', 'c', $d$CHECK ((region = 'cu'::text))$d$),
    ('public.community_events', 'community_events_register_url_check', 'c', $d$CHECK ((char_length(register_url) <= 500))$d$),
    ('public.community_events', 'community_events_registration_mode_check', 'c', $d$CHECK ((registration_mode = ANY (ARRAY['caaci_site'::text, 'info_only'::text, 'external_link'::text, 'calendar_page'::text, 'discussion'::text])))$d$),
    ('public.community_events', 'community_events_review_flag_check', 'c', $d$CHECK ((review_flag = ANY (ARRAY['title_says_cancelled'::text, 'source_time_changed_near_start'::text])))$d$),
    ('public.community_events', 'community_events_source_key_check', 'c', $d$CHECK (((char_length(source_key) >= 1) AND (char_length(source_key) <= 600)))$d$),
    ('public.community_events', 'community_events_source_type_check', 'c', $d$CHECK ((source_type = ANY (ARRAY['caaci'::text, 'partner'::text, 'campus'::text, 'member'::text])))$d$),
    ('public.community_events', 'community_events_source_unique', 'u', $d$UNIQUE (source_type, source_key)$d$),
    ('public.community_events', 'community_events_status_note_check', 'c', $d$CHECK (((char_length(status_note) >= 1) AND (char_length(status_note) <= 80)))$d$),
    ('public.community_events', 'community_events_summary_check', 'c', $d$CHECK ((char_length(summary) <= 280))$d$),
    ('public.community_events', 'community_events_summary_en_check', 'c', $d$CHECK ((char_length(summary_en) <= 280))$d$),
    ('public.community_events', 'community_events_time_order_check', 'c', $d$CHECK ((isfinite(starts_at) AND ((ends_at IS NULL) OR (isfinite(ends_at) AND (ends_at >= starts_at)))))$d$),
    ('public.community_events', 'community_events_time_zone_check', 'c', $d$CHECK ((time_zone = 'America/Chicago'::text))$d$),
    ('public.community_events', 'community_events_title_check', 'c', $d$CHECK ((char_length(title) <= 160))$d$),
    ('public.community_events', 'community_events_title_en_check', 'c', $d$CHECK ((char_length(title_en) <= 160))$d$),
    ('public.community_events', 'community_events_unavailable_check', 'c', $d$CHECK (((availability <> 'unavailable'::text) OR (missing_checks >= 2)))$d$),
    ('public.community_event_sync_state', 'community_event_sync_state_last_error_code_check', 'c', $d$CHECK ((last_error_code ~ '^[a-z0-9_]{1,40}$'::text))$d$),
    ('public.community_event_sync_state', 'community_event_sync_state_last_outcome_check', 'c', $d$CHECK ((last_outcome = ANY (ARRAY['ok'::text, 'partial'::text, 'failed'::text])))$d$),
    ('public.community_event_sync_state', 'community_event_sync_state_pkey', 'p', $d$PRIMARY KEY (source)$d$),
    ('public.community_event_sync_state', 'community_event_sync_state_source_check', 'c', $d$CHECK ((source = ANY (ARRAY['caaci'::text, 'campus'::text])))$d$)
    ) AS known(relation, constraint_name, kind, definition)
  LOOP
    SELECT pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid), '\s+', ' ', 'g') INTO listed
      FROM pg_catalog.pg_constraint AS c
     WHERE c.conrelid = pg_catalog.to_regclass(expected.relation) AND c.conname = expected.constraint_name
       AND c.contype::text = expected.kind AND c.convalidated;
    IF listed IS DISTINCT FROM expected.definition THEN
      RAISE EXCEPTION 'community_member_events_constraint:%:%:%', expected.relation, expected.constraint_name, coalesce(listed, 'missing');
    END IF;
  END LOOP;
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.community_event_partners', 10, 1),
    ('public.community_events', 37, 4),
    ('public.community_event_sync_state', 4, 1)
    ) AS known(relation, constraints, policies)
  LOOP
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint WHERE conrelid = pg_catalog.to_regclass(expected.relation)) <> expected.constraints
       OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy WHERE polrelid = pg_catalog.to_regclass(expected.relation)) <> expected.policies THEN
      RAISE EXCEPTION 'community_member_events_unexpected_constraint_or_policy:%', expected.relation;
    END IF;
  END LOOP;
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.community_event_partners', 'Anyone can view active partners', 'r', 'anon,authenticated', $d$(status = 'active'::text)$d$, $d$-$d$),
    ('public.community_events', 'Anyone can view visible events', 'r', 'anon,authenticated', $d$((availability = 'visible'::text) AND (COALESCE(ends_at, starts_at) >= (now() - '180 days'::interval)) AND ((partner_id IS NULL) OR (EXISTS ( SELECT 1 FROM community_event_partners partner WHERE ((partner.id = community_events.partner_id) AND (partner.status = 'active'::text))))) AND ((source_type <> 'member'::text) OR moderation_private.profile_content_visible(organizer_user_id)))$d$, $d$-$d$),
    ('public.community_events', 'Members can create own events', 'a', 'authenticated', $d$-$d$, $d$((source_type = 'member'::text) AND (organizer_user_id = ( SELECT auth.uid() AS uid)))$d$),
    ('public.community_events', 'Organizers can cancel own events', 'w', 'authenticated', $d$((source_type = 'member'::text) AND (organizer_user_id = ( SELECT auth.uid() AS uid)))$d$, $d$((source_type = 'member'::text) AND (organizer_user_id = ( SELECT auth.uid() AS uid)))$d$),
    ('public.community_events', 'Organizers can view own events', 'r', 'authenticated', $d$(organizer_user_id = ( SELECT auth.uid() AS uid))$d$, $d$-$d$),
    ('public.community_event_sync_state', 'Anyone can view sync state', 'r', 'anon,authenticated', $d$true$d$, $d$-$d$)
    ) AS known(relation, policy_name, command, roles, using_text, check_text)
  LOOP
    SELECT p.polcmd::text || '|' || p.polpermissive::text || '|' || (
             SELECT pg_catalog.string_agg(pg_catalog.pg_get_userbyid(r.role_id)::text, ',' ORDER BY pg_catalog.pg_get_userbyid(r.role_id)::text COLLATE "C")
               FROM pg_catalog.unnest(p.polroles) AS r(role_id))
           || '|' || pg_catalog.regexp_replace(coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '-'), '\s+', ' ', 'g')
           || '|' || pg_catalog.regexp_replace(coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '-'), '\s+', ' ', 'g') INTO listed
      FROM pg_catalog.pg_policy AS p
     WHERE p.polrelid = pg_catalog.to_regclass(expected.relation) AND p.polname = expected.policy_name;
    IF listed IS DISTINCT FROM expected.command || '|true|' || expected.roles || '|' || expected.using_text || '|' || expected.check_text THEN
      RAISE EXCEPTION 'community_member_events_policy:%:%:%', expected.relation, expected.policy_name, coalesce(listed, 'missing');
    END IF;
  END LOOP;
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.community_event_partners', 'anon', 'SELECT', 'allowed_link_hosts,id,name_en,name_zh,slug,status'),
    ('public.community_event_partners', 'anon', 'INSERT', ''),
    ('public.community_event_partners', 'anon', 'UPDATE', ''),
    ('public.community_event_partners', 'authenticated', 'SELECT', 'allowed_link_hosts,id,name_en,name_zh,slug,status'),
    ('public.community_event_partners', 'authenticated', 'INSERT', ''),
    ('public.community_event_partners', 'authenticated', 'UPDATE', ''),
    ('public.community_event_partners', 'service_role', 'SELECT', 'allowed_link_hosts,consent_recorded_on,consent_ref,contact_role,created_at,id,name_en,name_zh,revoked_at,slug,status,updated_at'),
    ('public.community_event_partners', 'service_role', 'INSERT', ''),
    ('public.community_event_partners', 'service_role', 'UPDATE', ''),
    ('public.community_events', 'anon', 'SELECT', 'all_day,availability,cancelled_at,created_at,discussion_post_id,duplicate_of,ends_at,id,location,occurrence_count,organizer_name,organizer_user_id,page_url,partner_id,previous_starts_at,region,register_url,registration_mode,registration_open,revision,schedule_changed_at,source_key,source_type,starts_at,status_note,summary,summary_en,takes_registrations,time_zone,title,title_en,updated_at'),
    ('public.community_events', 'anon', 'INSERT', ''),
    ('public.community_events', 'anon', 'UPDATE', ''),
    ('public.community_events', 'authenticated', 'SELECT', 'all_day,availability,cancelled_at,created_at,discussion_post_id,duplicate_of,ends_at,id,location,occurrence_count,organizer_name,organizer_user_id,page_url,partner_id,previous_starts_at,region,register_url,registration_mode,registration_open,revision,schedule_changed_at,source_key,source_type,starts_at,status_note,summary,summary_en,takes_registrations,time_zone,title,title_en,updated_at'),
    ('public.community_events', 'authenticated', 'INSERT', 'discussion_post_id,ends_at,location,organizer_user_id,registration_mode,source_key,source_type,starts_at'),
    ('public.community_events', 'authenticated', 'UPDATE', 'cancelled_at,status_note'),
    ('public.community_events', 'service_role', 'SELECT', 'all_day,availability,cancelled_at,consent_ref,content_hash,created_at,created_by,discussion_post_id,duplicate_of,ends_at,first_seen_at,hidden_reason,id,last_checked_at,last_seen_at,location,missing_checks,missing_since,occurrence_count,organizer_name,organizer_user_id,page_url,partner_id,previous_starts_at,region,register_url,registration_mode,registration_open,review_flag,revision,schedule_changed_at,source_key,source_type,source_updated_at,starts_at,status_note,summary,summary_en,takes_registrations,time_zone,title,title_en,updated_at'),
    ('public.community_events', 'service_role', 'INSERT', ''),
    ('public.community_events', 'service_role', 'UPDATE', ''),
    ('public.community_event_sync_state', 'anon', 'SELECT', 'last_attempt_at,last_error_code,last_outcome,last_success_at,source'),
    ('public.community_event_sync_state', 'anon', 'INSERT', ''),
    ('public.community_event_sync_state', 'anon', 'UPDATE', ''),
    ('public.community_event_sync_state', 'authenticated', 'SELECT', 'last_attempt_at,last_error_code,last_outcome,last_success_at,source'),
    ('public.community_event_sync_state', 'authenticated', 'INSERT', ''),
    ('public.community_event_sync_state', 'authenticated', 'UPDATE', ''),
    ('public.community_event_sync_state', 'service_role', 'SELECT', 'last_attempt_at,last_error_code,last_outcome,last_success_at,source'),
    ('public.community_event_sync_state', 'service_role', 'INSERT', ''),
    ('public.community_event_sync_state', 'service_role', 'UPDATE', '')
    ) AS target(relation, role_name, privilege, columns)
  LOOP
    SELECT coalesce(pg_catalog.string_agg(a.attname::text, ',' ORDER BY a.attname::text COLLATE "C"), '') INTO listed
      FROM pg_catalog.pg_attribute AS a
     WHERE a.attrelid = pg_catalog.to_regclass(expected.relation)
       AND a.attnum > 0 AND NOT a.attisdropped
       AND pg_catalog.has_column_privilege(expected.role_name, a.attrelid, a.attnum, expected.privilege);
    IF listed IS DISTINCT FROM expected.columns THEN
      RAISE EXCEPTION 'community_member_events_column_privileges:%:%:%:%', expected.relation, expected.role_name, expected.privilege, listed;
    END IF;
  END LOOP;

  -- 2a. The member channel is granted only to authenticated, and creation
  --     is controlled by the private switch. Visitors cannot write events.
  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.create_member_event(uuid,text,text,jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.create_member_event(uuid,text,text,jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.create_member_event(uuid,text,text,jsonb)', 'EXECUTE')
     OR pg_catalog.has_any_column_privilege('anon', 'public.community_events', 'INSERT')
     OR pg_catalog.has_any_column_privilege('anon', 'public.community_events', 'UPDATE') THEN
    RAISE EXCEPTION 'community_member_events_member_channel_grants';
  END IF;

  -- 2b. None of the three tables is published: no change of an event, a
  --     partner or the sync state is pushed to clients.
  SELECT pg_catalog.string_agg(published.pubname::text || ':' || published.tablename::text, ','
           ORDER BY published.pubname::text COLLATE "C", published.tablename::text COLLATE "C") INTO listed
    FROM pg_catalog.pg_publication_tables AS published
   WHERE published.schemaname = 'public'
     AND published.tablename IN ('community_events', 'community_event_partners', 'community_event_sync_state');
  IF listed IS NOT NULL THEN
    RAISE EXCEPTION 'community_member_events_published:%', listed;
  END IF;

  -- 2c. One owner-only switch row; report its value without judging it.
  IF pg_catalog.to_regclass('private.community_member_event_config') IS NULL THEN
    RAISE EXCEPTION 'community_member_events_switch_table_missing';
  END IF;
  SELECT pg_catalog.string_agg(a.attname::text || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
           || ':' || coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attnum) INTO listed
    FROM pg_catalog.pg_attribute AS a
    LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'private.community_member_event_config'::pg_catalog.regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF listed IS DISTINCT FROM 'singleton:boolean:true:true,enabled:boolean:true:false' THEN
    RAISE EXCEPTION 'community_member_events_switch_table_columns:%', listed;
  END IF;
  SELECT pg_catalog.string_agg(c.contype::text || ':' || pg_catalog.pg_get_constraintdef(c.oid), ' | '
           ORDER BY c.contype::text COLLATE "C" DESC) INTO listed
    FROM pg_catalog.pg_constraint AS c
   WHERE c.conrelid = 'private.community_member_event_config'::pg_catalog.regclass AND c.convalidated;
  IF listed IS DISTINCT FROM 'p:PRIMARY KEY (singleton) | c:CHECK (singleton)' THEN
    RAISE EXCEPTION 'community_member_events_switch_table_keys:%', listed;
  END IF;
  SELECT c.relrowsecurity::text || ':' || pg_catalog.pg_get_userbyid(c.relowner)::text
           || ':' || (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy AS p WHERE p.polrelid = c.oid)::text
           || ':' || (SELECT pg_catalog.count(*) FROM pg_catalog.aclexplode(c.relacl) AS entry WHERE entry.grantee <> c.relowner)::text
           || ':' || (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger AS t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal)::text INTO listed
    FROM pg_catalog.pg_class AS c
   WHERE c.oid = 'private.community_member_event_config'::pg_catalog.regclass;
  IF listed IS DISTINCT FROM 'true:postgres:0:0:0' THEN
    RAISE EXCEPTION 'community_member_events_switch_table_closed:%', listed;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.unnest(ARRAY['anon', 'authenticated', 'service_role']) AS api(role_name),
      pg_catalog.unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS denied(privilege)
    WHERE pg_catalog.has_table_privilege(api.role_name, 'private.community_member_event_config', denied.privilege)
  ) THEN
    RAISE EXCEPTION 'community_member_events_switch_table_privilege';
  END IF;
  SELECT pg_catalog.count(*)::text || ':' || coalesce(pg_catalog.bool_and(switch.singleton)::text, 'none') INTO listed
    FROM private.community_member_event_config AS switch;
  IF listed IS DISTINCT FROM '1:true' THEN
    RAISE EXCEPTION 'community_member_events_switch_row:%', listed;
  END IF;
  RAISE NOTICE 'community_member_events_switch|enabled=%',
    (SELECT switch.enabled FROM private.community_member_event_config AS switch);

  -- 3. Indexes, by definition.
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.community_events_list_idx', $d$(region, starts_at, id) WHERE ((availability = 'visible'::text) AND (duplicate_of IS NULL))$d$),
    ('public.community_events_organizer_idx', $d$(organizer_user_id, starts_at) WHERE (source_type = 'member'::text)$d$),
    ('public.community_events_campus_check_idx', $d$(last_checked_at NULLS FIRST) WHERE ((source_type = 'campus'::text) AND (availability <> 'hidden'::text))$d$)
    ) AS target(index_name, definition)
  LOOP
    SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO listed
      FROM pg_catalog.pg_index AS i
     WHERE i.indexrelid = pg_catalog.to_regclass(expected.index_name) AND i.indisvalid AND i.indisready;
    IF listed IS NULL OR pg_catalog.right(listed, pg_catalog.length(expected.definition)) <> expected.definition THEN
      RAISE EXCEPTION 'community_member_events_index:%:%', expected.index_name, coalesce(listed, 'missing');
    END IF;
  END LOOP;

  -- 4. Triggers: five on the events table, one on topics, all enabled; the
  --    three column triggers fire for their columns only. The keyword filter
  --    of the place and the note (D-54 2k) sorts after the member guard, so a
  --    restricted member is told about the restriction first.
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.community_events', 'community_events_touch', 'public.update_updated_at()', 19, ''),
    ('public.community_events', 'community_events_schedule_change', 'private.community_events_schedule_change()', 19, ''),
    ('public.community_events', 'community_events_member_guard', 'private.community_events_member_guard()', 23, ''),
    ('public.community_events', 'community_events_moderate_text', 'private.community_events_moderate_text()', 23, 'location,status_note'),
    ('public.community_events', 'community_events_post_link', 'private.community_events_post_link()', 19, 'discussion_post_id'),
    ('public.posts', 'community_events_follow_topic', 'private.community_events_follow_topic()', 17, 'status')
    ) AS target(relation, trigger_name, routine, kind, of_column)
  LOOP
    SELECT coalesce((SELECT pg_catalog.string_agg(a.attname::text, ',' ORDER BY a.attname::text COLLATE "C")
                       FROM pg_catalog.pg_attribute AS a
                      WHERE a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::smallint[])), '') INTO listed
      FROM pg_catalog.pg_trigger AS t
     WHERE t.tgrelid = pg_catalog.to_regclass(expected.relation)
       AND t.tgname = expected.trigger_name AND NOT t.tgisinternal
       AND t.tgfoid = pg_catalog.to_regprocedure(expected.routine)
       AND t.tgtype::integer = expected.kind AND t.tgenabled::text = 'O' AND t.tgqual IS NULL;
    IF listed IS DISTINCT FROM expected.of_column THEN
      RAISE EXCEPTION 'community_member_events_trigger:%:%', expected.trigger_name, coalesce(listed, 'missing');
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public.community_events'::pg_catalog.regclass AND NOT tgisinternal) <> 5
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                 WHERE tgrelid IN ('public.community_event_partners'::pg_catalog.regclass, 'public.community_event_sync_state'::pg_catalog.regclass)
                   AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'community_member_events_unexpected_trigger';
  END IF;
  -- D-49: the restricted-account guard is where 20261114015420 put it and
  -- nowhere else. The member guard calls the same assertion for the two
  -- writes other people see, and a cancellation without a note stays open.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger
       WHERE tgfoid = pg_catalog.to_regprocedure('private.enforce_restricted_account_write()')
         AND NOT tgisinternal) <> 10 THEN
    RAISE EXCEPTION 'community_member_events_restricted_account_guard_count';
  END IF;

  -- 5. Administrator vocabularies and capability rows after the migration.
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.admin_mutation_requests', 'admin_mutation_requests_action_check', 'apply_ban,create_event_discussion,decide_appeal,delete_banner,hide_event,issue_token,lift_suspension,resolve_target_reports,restore_content,revoke_admin_tokens,revoke_token,set_post_category,set_post_featured,set_post_locked,set_post_official,set_post_pinned,takedown_content,unhide_event,update_report_status,upsert_banner'),
    ('public.admin_role_action_capabilities', 'admin_role_action_capabilities_action_check', 'apply_ban,create_event_discussion,decide_appeal,delete_banner,hide_event,issue_token,lift_suspension,resolve_target_reports,restore_content,revoke_admin_tokens,revoke_token,set_post_category,set_post_featured,set_post_locked,set_post_official,set_post_pinned,takedown_content,unhide_event,update_report_status,upload_banner,upsert_banner'),
    ('public.admin_audit_log', 'admin_audit_log_event_kind_check', 'actor_blocked,admin_login,admin_unauthorized,appeal_decided,appeal_more_information_requested,ban_applied,banner_changed,content_restored,content_takedown,event_discussion_created,event_hidden,event_unhidden,post_category_changed,post_featured_changed,post_lock_changed,post_official_changed,post_pin_changed,report_status_changed,support_email_claimed,suspension_lifted,token_issued,token_revoked')
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
      RAISE EXCEPTION 'community_member_events_vocabulary:%:%', expected.constraint_name, coalesce(listed, 'missing');
    END IF;
  END LOOP;
  SELECT pg_catalog.string_agg(capability.admin_role || ':' || capability.action, ','
           ORDER BY (capability.admin_role || ':' || capability.action) COLLATE "C") INTO listed
    FROM public.admin_role_action_capabilities AS capability;
  IF listed IS DISTINCT FROM 'operator:apply_ban,operator:decide_appeal,operator:hide_event,operator:lift_suspension,operator:resolve_target_reports,operator:restore_content,operator:set_post_category,operator:set_post_locked,operator:takedown_content,operator:unhide_event,operator:update_report_status,owner:apply_ban,owner:create_event_discussion,owner:decide_appeal,owner:delete_banner,owner:hide_event,owner:issue_token,owner:lift_suspension,owner:resolve_target_reports,owner:restore_content,owner:revoke_admin_tokens,owner:revoke_token,owner:set_post_category,owner:set_post_featured,owner:set_post_locked,owner:set_post_official,owner:set_post_pinned,owner:takedown_content,owner:unhide_event,owner:update_report_status,owner:upload_banner,owner:upsert_banner,security_admin:revoke_admin_tokens,security_admin:revoke_token' THEN
    RAISE EXCEPTION 'community_member_events_capability_rows:%', listed;
  END IF;

  -- 5a. Every trigger on topics, by name and kind: the set PRECHECK read,
  --     plus the one this migration adds (community_events_follow_topic).
  SELECT pg_catalog.string_agg(t.tgname::text || ':' || t.tgtype::text, ',' ORDER BY t.tgname::text COLLATE "C") INTO listed
    FROM pg_catalog.pg_trigger AS t
   WHERE t.tgrelid = 'public.posts'::pg_catalog.regclass AND NOT t.tgisinternal;
  IF listed IS DISTINCT FROM 'aa_restricted_account_write:19,authoritative_public_write_boundary:23,community_events_follow_topic:17,enforce_actor_posts:7,enqueue_moderation_media_cleanup:21,guard_moderation_status:19,invalidate_post_english:19,moderate_posts:23,queue_public_post_english:29,serialize_public_write_actor:7,set_posts_updated_at:19,trg_rl_posts_before_insert:7,validate_post_topic:23' THEN
    RAISE EXCEPTION 'community_member_events_topic_triggers:%', coalesce(listed, 'none');
  END IF;

  -- 6. Topics: what clients may read and write there is what it was.
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
      RAISE EXCEPTION 'community_member_events_column_privileges:%:%:%:%', expected.relation, expected.role_name, expected.privilege, listed;
    END IF;
  END LOOP;
END;
$verify$;
ROLLBACK;
