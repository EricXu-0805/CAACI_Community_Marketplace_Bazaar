-- P4.2 community events: rollback-only regression for
-- 20261120122054_community_events.sql. Disposable L-SQL only (RUNBOOK §5.1):
-- it uses the real ACLs, RLS, triggers and administrator dispatcher of a full
-- replay and must never run against a hosted project.
--
-- Part 1 is the D-49 matrix. Member 1 is put through every moderation state
-- below while the cached profiles.suspension_level column is deliberately
-- wrong in the other direction; the action log in public.suspensions is the
-- only authority. Starting an event and writing a note are seen by other
-- people, so an active level 2-5 restriction must refuse them with SQLSTATE
-- P0001 and the exact suspension_active:<level>:<until> text and leave every
-- watched table as it was. Cancelling one's own event without a note,
-- clearing a note, a retry of a form that already went through and every
-- read must succeed in every state. Every case runs in its own
-- subtransaction and is rolled back, success included.
--
-- Part 2 runs a member's event, the list, the three administrator actions and
-- the rules of the table once each through the real chain.
--
-- The migration leaves the member write channel closed (D-54 2l). Part 0
-- reads that from the catalog and from two real refusals. After it, the three
-- grants that a later migration will make are made here, inside this
-- transaction, so that every case below still runs through
-- create_member_event as a signed-in member; the ROLLBACK at the end takes
-- them back with everything else.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '900s';
SET LOCAL search_path = pg_catalog, public;

CREATE FUNCTION pg_temp.id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('caac1120-2026-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;

-- One statement as a signed-in member; returns its single value as text.
CREATE FUNCTION pg_temp.as_member(member integer, statement text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  answer text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.id(member)::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.id(member), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  EXECUTE statement INTO answer;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN answer;
END
$$;
-- One statement as a visitor. The statement must not call a temporary
-- function: write ids out.
CREATE FUNCTION pg_temp.as_anon(statement text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  answer text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  EXECUTE statement INTO answer;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN answer;
END
$$;
-- One administrator action as the Edge API sends it; the JSON answer, or
-- 'refused:<message>' with nothing written.
CREATE FUNCTION pg_temp.mutate(token text, request integer, action text, payload jsonb) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  answer jsonb;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    SET LOCAL ROLE service_role;
    answer := public.admin_execute_mutation(token, pg_temp.id(request), repeat('f', 64), action, payload);
    RESET ROLE;
    RETURN answer::text;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RETURN 'refused:' || SQLERRM;
  END;
END
$$;
CREATE FUNCTION pg_temp.expect(label text, actual text, wanted text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM wanted THEN
    RAISE EXCEPTION 'EV scenario %: got %, wanted %', label, coalesce(actual, 'NULL'), wanted;
  END IF;
END
$$;

-- Catalog evidence for the report: stored bodies and the triggers on the
-- events table and on topics as they are when this file runs.
DO $evidence$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS signature, md5(p.prosrc) AS body_md5,
           pg_get_userbyid(p.proowner)::text AS owner, p.prosecdef AS secdef,
           coalesce(array_to_string(p.proconfig, ','), '') AS config,
           coalesce(p.proacl::text, '') AS acl
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'public' AND p.proname IN (
            'admin_execute_mutation', 'admin_execute_mutation_pre_community_events', 'admin_execute_community_events',
            'create_member_event', 'list_community_events', 'admin_token_authorization', 'admin_token_authorization_v2',
            'trg_enforce_actor', 'rl_posts_before_insert', 'update_updated_at', 'admin_list_moderation_audit_log'))
       OR (n.nspname = 'private' AND (p.proname LIKE 'community_events_%' OR p.proname = 'assert_moderated_text'))
       OR (n.nspname = 'moderation_private' AND p.proname = 'assert_posting_allowed')
    ORDER BY 1
  LOOP
    RAISE NOTICE 'EV_BODY|%|%|owner=%|secdef=%|%|%',
      r.signature, r.body_md5, r.owner, r.secdef, r.config, r.acl;
  END LOOP;
  FOR r IN
    SELECT t.tgrelid::regclass::text AS relation, t.tgname::text AS name, t.tgfoid::regprocedure::text AS routine,
           t.tgtype::integer AS kind, t.tgenabled::text AS enabled
    FROM pg_trigger AS t
    WHERE t.tgrelid IN ('public.community_events'::regclass, 'public.posts'::regclass) AND NOT t.tgisinternal
    ORDER BY 1, (t.tgtype::integer & 2) DESC, t.tgname::text COLLATE "C"
  LOOP
    RAISE NOTICE 'EV_TRIGGER|%|%|%|type=%|enabled=%', r.relation, r.name, r.routine, r.kind, r.enabled;
  END LOOP;
END
$evidence$;

-- Members: 1 is put through the states; 2 and 3 are verified members; 4
-- administers; 5 is the official account; 6 is spare; 7 has no verified
-- campus email.
INSERT INTO auth.users(id,email,aud,role,raw_user_meta_data)
SELECT pg_temp.id(n),'ev-'||n||'@example.invalid','authenticated','authenticated',
 jsonb_build_object('nickname','EV member '||n) FROM generate_series(1,7) n;
INSERT INTO public.profiles(id,nickname,email)
SELECT pg_temp.id(n),'EV member '||n,'ev-'||n||'@example.invalid' FROM generate_series(1,7) n
ON CONFLICT (id) DO UPDATE SET nickname=excluded.nickname,email=excluded.email;
UPDATE public.profiles SET is_illini_verified=true WHERE id IN (SELECT pg_temp.id(n) FROM generate_series(1,6) n);
INSERT INTO public.admin_tokens(id,token_hash,admin_id,admin_name,admin_email,role,expires_at,revoked_at,created_by) VALUES
 (pg_temp.id(91),repeat('a',64),pg_temp.id(4),'EV Owner','ev-4@example.invalid','owner',now()+interval '30 days',NULL,pg_temp.id(4)),
 (pg_temp.id(92),repeat('b',64),pg_temp.id(4),'EV Operator','ev-4@example.invalid','operator',now()+interval '30 days',NULL,pg_temp.id(4));

-- A word the keyword filter refuses, so the cases below do not depend on what
-- the seeded list holds.
INSERT INTO public.moderation_keywords(keyword) VALUES ('evblockedmarker');

-- Part 0 (D-54 2l): the member write channel as the migration leaves it.
DO $closed$
BEGIN
  IF pg_catalog.to_regclass('private.community_member_event_config') IS NOT NULL THEN
    RAISE NOTICE 'EV_CLOSED|SKIP|member_event_config';
  ELSE
BEGIN
  -- Nobody may execute the function. This is read from the catalog: on this
  -- image a call without EXECUTE under SET ROLE takes the backend down
  -- instead of answering 42501 (scripts/community-events.test.mjs makes the
  -- call on plain PostgreSQL and gets 42501).
  PERFORM pg_temp.expect('nobody executes create_member_event',
    coalesce((SELECT string_agg(r, ',' ORDER BY r) FROM unnest(ARRAY['anon','authenticated','service_role']) AS r
      WHERE has_function_privilege(r, 'public.create_member_event(uuid,text,text,jsonb)', 'EXECUTE')), ''), '');
  PERFORM pg_temp.expect('no client may insert or update any column of an event',
    (SELECT count(*)::text
       FROM pg_attribute AS a, unnest(ARRAY['anon','authenticated','service_role']) AS r, unnest(ARRAY['INSERT','UPDATE']) AS p
      WHERE a.attrelid = 'public.community_events'::regclass AND a.attnum > 0 AND NOT a.attisdropped
        AND has_column_privilege(r, a.attrelid, a.attnum, p)), '0');
  -- A signed-in member's direct writes are refused for want of the privilege.
  BEGIN
    PERFORM pg_temp.as_member(2, $q$INSERT INTO public.community_events(source_type,source_key,organizer_user_id,starts_at,location,registration_mode) VALUES('member',pg_temp.id(60)::text,auth.uid(),now()+interval '1 day','EV','discussion') RETURNING id$q$);
    RAISE EXCEPTION 'EV closed channel: a member inserted an event';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    PERFORM pg_temp.expect('insert without the grant', SQLERRM, 'permission denied for table community_events');
  END;
  BEGIN
    PERFORM pg_temp.as_member(2, $q$UPDATE public.community_events SET cancelled_at=now(),status_note='EV' WHERE organizer_user_id=auth.uid() RETURNING id$q$);
    RAISE EXCEPTION 'EV closed channel: a member updated an event';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    PERFORM pg_temp.expect('update without the grant', SQLERRM, 'permission denied for table community_events');
  END;
  RAISE NOTICE 'EV_CLOSED|PASS';
END;
  END IF;
END
$closed$;

-- What the migration that opens the channel (P4.6) will grant, for the rest
-- of this transaction only.
GRANT EXECUTE ON FUNCTION public.create_member_event(uuid, text, text, jsonb) TO authenticated;
GRANT INSERT (source_type, source_key, organizer_user_id, discussion_post_id, starts_at, ends_at, location, registration_mode)
  ON TABLE public.community_events TO authenticated;
GRANT UPDATE (cancelled_at, status_note) ON TABLE public.community_events TO authenticated;

DO $member_switch$
BEGIN
  IF pg_catalog.to_regclass('private.community_member_event_config') IS NOT NULL THEN
    UPDATE private.community_member_event_config SET enabled = true WHERE singleton;
  END IF;
END
$member_switch$;

-- Organizations' rows, in the three shapes their writers will produce. 51,
-- 52 and 53 start at the same instant; 54 belongs to a partner that withdrew
-- its consent; 55 was withdrawn by its source (two checks did not find it);
-- 56 duplicates 51; 57 is over; 58 is beyond the window; 59 has started and
-- is still on.
INSERT INTO public.community_event_partners(id,slug,name_zh,name_en,consent_ref,consent_recorded_on,contact_role,allowed_link_hosts) VALUES
 (pg_temp.id(41),'ev-chess-club','EV 国际象棋社','EV Chess Club','EV-CONSENT-001','2026-11-01','President',ARRAY['chess.example.test']);
INSERT INTO public.community_event_partners(id,slug,name_zh,name_en,status,revoked_at,consent_ref,consent_recorded_on,contact_role) VALUES
 (pg_temp.id(42),'ev-old-club','EV 旧社团','EV Old Club','revoked',now(),'EV-CONSENT-002','2026-10-01','President');
INSERT INTO public.community_events(id,source_type,source_key,title,title_en,starts_at,ends_at,page_url,register_url,registration_mode,location) VALUES
 (pg_temp.id(51),'caaci',pg_temp.id(9001)::text,'EV 迎新晚会','EV welcome night',now()+interval '3 days',now()+interval '3 days 2 hours',
  'https://caaciorg.com/events/#ev-welcome-night','https://caaciorg.com/events/ev-welcome-night/register/','caaci_site','Illini Union');
INSERT INTO public.community_events(id,source_type,source_key,partner_id,consent_ref,title,summary,starts_at,page_url,registration_mode,location) VALUES
 (pg_temp.id(52),'partner','ev-chess-club|https://chess.example.test/open',pg_temp.id(41),'EV-CONSENT-001','EV 公开赛','EV open tournament.',
  now()+interval '3 days','https://chess.example.test/open','info_only','ARC'),
 (pg_temp.id(54),'partner','ev-old-club|https://old.example.test/meet',pg_temp.id(42),'EV-CONSENT-002','EV 旧活动','EV old meetup.',
  now()+interval '4 days','https://old.example.test/meet','info_only',NULL);
INSERT INTO public.community_events(id,source_type,source_key,title,starts_at,page_url,registration_mode,availability,missing_checks,missing_since) VALUES
 (pg_temp.id(55),'caaci',pg_temp.id(9002)::text,'EV 已撤下',now()+interval '5 days','https://caaciorg.com/events/#ev-gone','info_only','unavailable',2,now()-interval '1 day');
INSERT INTO public.community_events(id,source_type,source_key,organizer_name,title_en,starts_at,ends_at,page_url,registration_mode,location,duplicate_of) VALUES
 (pg_temp.id(53),'campus','7/990001','University Library','EV research workshop',now()+interval '3 days',NULL,'https://calendars.illinois.edu/detail/7/990001','calendar_page','Main Library',NULL),
 (pg_temp.id(56),'campus','7/990002','University Library','EV duplicate of the welcome night',now()+interval '3 days',NULL,'https://calendars.illinois.edu/detail/7/990002','calendar_page',NULL,pg_temp.id(51)),
 (pg_temp.id(57),'campus','7/990003','University Library','EV over last week',now()-interval '7 days',now()-interval '6 days 22 hours','https://calendars.illinois.edu/detail/7/990003','calendar_page',NULL,NULL),
 (pg_temp.id(58),'campus','7/990004','University Library','EV too far ahead',now()+interval '181 days',NULL,'https://calendars.illinois.edu/detail/7/990004','calendar_page',NULL,NULL),
 (pg_temp.id(59),'campus','7/990005','University Library','EV started, still on',now()-interval '1 hour',now()+interval '1 hour','https://calendars.illinois.edu/detail/7/990005','calendar_page',NULL,NULL);

-- Member 1's own event, written the only way a member's event can be:
-- through the function, as the member, before any restriction exists.
DO $fixture$
DECLARE
  made jsonb;
BEGIN
  made := pg_temp.as_member(1, $q$SELECT public.create_member_event(pg_temp.id(61),'EV regression event one','EV regression body one: three of us, three more welcome.',jsonb_build_object('starts_at',now()+interval '2 days','location','EV court one'))$q$)::jsonb;
  -- This whole file is one transaction, and the member guard accepts a topic
  -- written in the same transaction as its event. Date the topic an hour
  -- back, as a topic from an earlier request is, so that case R01 meets what
  -- a client meets when it writes the table directly.
  UPDATE public.posts SET created_at=now()-interval '1 hour', last_activity_at=now()-interval '1 hour' WHERE id=pg_temp.id(61);
  IF (made ->> 'post_id') IS DISTINCT FROM pg_temp.id(61)::text
     OR (SELECT count(*) FROM public.profiles WHERE id IN (SELECT pg_temp.id(n) FROM generate_series(1,7) n)) <> 7
     OR (SELECT count(*) FROM public.profiles WHERE id IN (SELECT pg_temp.id(n) FROM generate_series(1,7) n) AND is_illini_verified) <> 6
     OR (SELECT count(*) FROM public.community_events WHERE id IN (SELECT pg_temp.id(n) FROM generate_series(51,59) n)) <> 9
     OR (SELECT count(*) FROM public.community_events WHERE source_type='member' AND organizer_user_id=pg_temp.id(1)
           AND discussion_post_id=pg_temp.id(61) AND source_key=pg_temp.id(61)::text AND availability='visible' AND id=(made ->> 'event_id')::uuid) <> 1
     OR (SELECT category || ':' || status FROM public.posts WHERE id=pg_temp.id(61) AND user_id=pg_temp.id(1)) IS DISTINCT FROM 'events-social:active' THEN
    RAISE EXCEPTION 'EV fixture is incomplete';
  END IF;
  RAISE NOTICE 'EV_FIXTURE|PASS';
END
$fixture$;

CREATE TEMP TABLE ev_states(ord integer, name text PRIMARY KEY, winning smallint NOT NULL, winning_end text);
INSERT INTO ev_states VALUES
(1,'L0-none',0,NULL),
(2,'L1-finite',1,NULL),
(3,'L1-null',1,NULL),
(4,'L2-finite',2,'in3d'),
(5,'L2-null',2,'null'),
(6,'L3-finite',3,'in3d'),
(7,'L3-infinity',3,'infinity'),
(8,'L4-finite',4,'in3d'),
(9,'L4-null',4,'null'),
(10,'L5-finite',5,'in3d'),
(11,'L5-null',5,'null'),
(12,'L2-expired',0,NULL),
(13,'L3-expired',0,NULL),
(14,'L4-expired',0,NULL),
(15,'L5-expired',0,NULL),
(16,'L5-lifted',0,NULL),
(17,'L5-future',0,NULL),
(18,'overlap-expired-L5-active-L1',1,NULL),
(19,'overlap-expired-L5-active-L3',3,'in3d');
CREATE TEMP TABLE ev_state_rows(state text NOT NULL, level smallint NOT NULL, starts text NOT NULL, ends text NOT NULL, lifted boolean NOT NULL);
INSERT INTO ev_state_rows VALUES
('L1-finite',1,'day_ago','in3d',false),
('L1-null',1,'day_ago','null',false),
('L2-finite',2,'day_ago','in3d',false),
('L2-null',2,'day_ago','null',false),
('L3-finite',3,'day_ago','in3d',false),
('L3-infinity',3,'day_ago','infinity',false),
('L4-finite',4,'day_ago','in3d',false),
('L4-null',4,'day_ago','null',false),
('L5-finite',5,'day_ago','in3d',false),
('L5-null',5,'day_ago','null',false),
('L2-expired',2,'day_ago','hour_ago',false),
('L3-expired',3,'day_ago','hour_ago',false),
('L4-expired',4,'day_ago','hour_ago',false),
('L5-expired',5,'day_ago','hour_ago',false),
('L5-lifted',5,'day_ago','in3d',true),
('L5-future',5,'tomorrow','in3d',false),
('overlap-expired-L5-active-L1',1,'day_ago','in3d',false),
('overlap-expired-L5-active-L1',5,'day_ago','hour_ago',false),
('overlap-expired-L5-active-L3',3,'day_ago','in3d',false),
('overlap-expired-L5-active-L3',5,'day_ago','hour_ago',false);

-- blocked: an active level 2-5 restriction must refuse the action.
-- expected_error: what an account that is not refused for a restriction gets
--   instead of success (SQLSTATE, optionally followed by :message).
-- rows_expected: the action is a plain statement; its row count is the result.
CREATE TEMP TABLE ev_cases(
 name text PRIMARY KEY, blocked boolean NOT NULL, action text NOT NULL,
 after_check text, prepare text NOT NULL, role_name text NOT NULL,
 actor integer NOT NULL, rows_expected integer, expected_error text
);
INSERT INTO ev_cases VALUES
-- Open in every state: reading, and withdrawing one's own content.
($q$A01-list-as-member$q$,false,$q$SELECT bool_or(id=pg_temp.id(51)) AND bool_or(id=pg_temp.id(52)) AND bool_or(id=pg_temp.id(53))
 AND NOT bool_or(id IN (pg_temp.id(54),pg_temp.id(55),pg_temp.id(56),pg_temp.id(57),pg_temp.id(58))) FROM public.list_community_events()$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$A02-read-own-event$q$,false,$q$SELECT count(*)=1 FROM public.community_events WHERE organizer_user_id=auth.uid() AND discussion_post_id=pg_temp.id(61)$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$A03-cancel-without-a-note$q$,false,$q$UPDATE public.community_events SET cancelled_at=now() WHERE discussion_post_id=pg_temp.id(61)$q$,$q$SELECT cancelled_at IS NOT NULL AND status_note IS NULL FROM public.community_events WHERE discussion_post_id=pg_temp.id(61)$q$,$q$$q$,'authenticated',1,1,NULL),
($q$A04-retry-returns-the-pair$q$,false,$q$SELECT public.create_member_event(pg_temp.id(61),'EV regression event one','EV regression body one: three of us, three more welcome.',jsonb_build_object('starts_at',now()+interval '2 days','location','EV court one'))->>'post_id'=pg_temp.id(61)::text$q$,$q$SELECT (SELECT count(*) FROM public.posts WHERE user_id=pg_temp.id(1))=1 AND (SELECT count(*) FROM public.community_events WHERE organizer_user_id=pg_temp.id(1))=1$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A05-clear-a-note$q$,false,$q$UPDATE public.community_events SET status_note=NULL WHERE discussion_post_id=pg_temp.id(61)$q$,$q$SELECT status_note IS NULL FROM public.community_events WHERE discussion_post_id=pg_temp.id(61)$q$,$q$UPDATE public.community_events SET status_note='EV note written earlier' WHERE discussion_post_id=pg_temp.id(61)$q$,'authenticated',1,1,NULL),
-- Refused for an active level 2-5 restriction: other people see these.
($q$B01-start-an-event$q$,true,$q$SELECT public.create_member_event(pg_temp.id(62),'EV regression event two','EV regression body two: bring a racket.',jsonb_build_object('starts_at',now()+interval '3 days','location','EV field two'))->>'post_id'=pg_temp.id(62)::text$q$,$q$SELECT count(*)=1 FROM public.community_events AS e JOIN public.posts AS p ON p.id=e.discussion_post_id
 WHERE e.source_type='member' AND e.source_key=pg_temp.id(62)::text AND e.organizer_user_id=pg_temp.id(1) AND e.availability='visible' AND p.category='events-social' AND p.user_id=pg_temp.id(1)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$B02-write-a-note$q$,true,$q$UPDATE public.community_events SET status_note='EV regression note' WHERE discussion_post_id=pg_temp.id(61)$q$,$q$SELECT status_note='EV regression note' AND cancelled_at IS NULL FROM public.community_events WHERE discussion_post_id=pg_temp.id(61)$q$,$q$$q$,'authenticated',1,1,NULL),
($q$B03-cancel-with-a-note$q$,true,$q$UPDATE public.community_events SET cancelled_at=now(),status_note='EV regression rained out' WHERE discussion_post_id=pg_temp.id(61)$q$,NULL,$q$$q$,'authenticated',1,1,NULL),
($q$B04-third-open-event$q$,true,$q$SELECT public.create_member_event(pg_temp.id(64),'EV regression event four','EV regression body four: one more.',jsonb_build_object('starts_at',now()+interval '4 days','location','EV field four')) IS NOT NULL$q$,NULL,$q$SELECT pg_temp.as_member(1,'SELECT public.create_member_event(pg_temp.id(63),''EV regression event three'',''EV regression body three: a second open event.'',jsonb_build_object(''starts_at'',now()+interval ''3 days'',''location'',''EV field three''))')$q$,'authenticated',1,NULL,'23514:member_event_active_limit'),
($q$B05-beyond-sixty-days$q$,true,$q$SELECT public.create_member_event(pg_temp.id(65),'EV regression event five','EV regression body five: far ahead.',jsonb_build_object('starts_at',now()+interval '61 days','location','EV field five')) IS NOT NULL$q$,NULL,$q$$q$,'authenticated',1,NULL,'22008:member_event_time_out_of_range'),
($q$B06-a-link-in-the-place$q$,true,$q$SELECT public.create_member_event(pg_temp.id(66),'EV regression event six','EV regression body six: see the place.',jsonb_build_object('starts_at',now()+interval '3 days','location','www.example.org lobby')) IS NOT NULL$q$,NULL,$q$$q$,'authenticated',1,NULL,'23514:member_event_link_not_allowed'),
($q$B07-reserved-wording$q$,true,$q$SELECT public.create_member_event(pg_temp.id(67),'Official EV regression event','EV regression body seven: a reserved word.',jsonb_build_object('starts_at',now()+interval '3 days','location','EV field seven')) IS NOT NULL$q$,NULL,$q$$q$,'authenticated',1,NULL,'23514:member_event_reserved_wording'),
-- D-54 2k: the place and the note carry no link, no reserved wording and no
-- word the keyword filter refuses, on insert and on update.
($q$B08-a-link-in-the-note$q$,true,$q$UPDATE public.community_events SET status_note='see www.example.org' WHERE discussion_post_id=pg_temp.id(61)$q$,NULL,$q$$q$,'authenticated',1,1,'23514:member_event_link_not_allowed'),
($q$B09-reserved-wording-in-the-note$q$,true,$q$UPDATE public.community_events SET status_note='Official change of plan' WHERE discussion_post_id=pg_temp.id(61)$q$,NULL,$q$$q$,'authenticated',1,1,'23514:member_event_reserved_wording'),
($q$B10-a-blocked-word-in-the-note$q$,true,$q$UPDATE public.community_events SET cancelled_at=now(),status_note='EV evblockedmarker note' WHERE discussion_post_id=pg_temp.id(61)$q$,NULL,$q$$q$,'authenticated',1,1,'22023:moderation_block:event_status_note:sensitive_word'),
($q$B11-reserved-wording-in-the-place$q$,true,$q$SELECT public.create_member_event(pg_temp.id(76),'EV regression event eleven','EV regression body eleven: a reserved place.',jsonb_build_object('starts_at',now()+interval '3 days','location','官方 EV field')) IS NOT NULL$q$,NULL,$q$$q$,'authenticated',1,NULL,'23514:member_event_reserved_wording'),
($q$B12-a-blocked-word-in-the-place$q$,true,$q$SELECT public.create_member_event(pg_temp.id(77),'EV regression event twelve','EV regression body twelve: a blocked place.',jsonb_build_object('starts_at',now()+interval '3 days','location','EV evblockedmarker hall')) IS NOT NULL$q$,NULL,$q$$q$,'authenticated',1,NULL,'22023:moderation_block:event_location:sensitive_word'),
-- D-54 2m: a member's event may run for 30 days, to the second (the two refusals are R18 and R19).
($q$B13-thirty-days-exactly$q$,true,$q$SELECT public.create_member_event(pg_temp.id(80),'EV regression event fifteen','EV regression body fifteen: a month of it.',jsonb_build_object('starts_at',now()+interval '3 days','ends_at',now()+interval '33 days','location','EV field fifteen'))->>'post_id'=pg_temp.id(80)::text$q$,$q$SELECT ends_at - starts_at = interval '30 days' FROM public.community_events WHERE source_key=pg_temp.id(80)::text$q$,$q$$q$,'authenticated',1,NULL,NULL),
-- A topic and its event written in one transaction around the function (one
-- batched request can do that): the guard holds every rule of the function
-- itself, the restriction (D-49) and the length of the title included. The
-- topic is written first, before the state of the case exists, so in a
-- restricted state it is the guard's own assertion that refuses the event.
($q$B14-topic-then-event-in-one-transaction$q$,true,$q$INSERT INTO public.community_events(source_type,source_key,organizer_user_id,discussion_post_id,starts_at,location,registration_mode) VALUES('member',pg_temp.id(81)::text,auth.uid(),pg_temp.id(81),now()+interval '1 day','EV field sixteen','discussion')$q$,$q$SELECT count(*)=1 FROM public.community_events WHERE source_key=pg_temp.id(81)::text AND organizer_user_id=pg_temp.id(1) AND availability='visible'$q$,$q$SELECT pg_temp.as_member(1,'INSERT INTO public.posts(id,user_id,content,title,category) VALUES(pg_temp.id(81),auth.uid(),''EV regression body sixteen: written directly.'',''EV regression topic sixteen'',''events-social'') RETURNING id')$q$,'authenticated',1,1,NULL),
($q$B15-a-long-title-around-the-function$q$,true,$q$INSERT INTO public.community_events(source_type,source_key,organizer_user_id,discussion_post_id,starts_at,location,registration_mode) VALUES('member',pg_temp.id(82)::text,auth.uid(),pg_temp.id(82),now()+interval '1 day','EV field seventeen','discussion')$q$,NULL,$q$SELECT pg_temp.as_member(1,'INSERT INTO public.posts(id,user_id,content,title,category) VALUES(pg_temp.id(82),auth.uid(),''EV regression body seventeen: a long title.'',repeat(''x'',61),''events-social'') RETURNING id')$q$,'authenticated',1,1,'22023:member_event_title_too_long'),
-- D-55 3c: the same way round the function with no place to meet at. The
-- table refuses a blank place and a missing one by name, so what the guard
-- promises holds for the place as well. In a restricted state the guard's own
-- assertion still answers first.
($q$B16-a-blank-place-around-the-function$q$,true,$q$INSERT INTO public.community_events(source_type,source_key,organizer_user_id,discussion_post_id,starts_at,location,registration_mode) VALUES('member',pg_temp.id(83)::text,auth.uid(),pg_temp.id(83),now()+interval '1 day','   ','discussion')$q$,NULL,$q$SELECT pg_temp.as_member(1,'INSERT INTO public.posts(id,user_id,content,title,category) VALUES(pg_temp.id(83),auth.uid(),''EV regression body eighteen: a blank place.'',''EV regression topic eighteen'',''events-social'') RETURNING id')$q$,'authenticated',1,1,'23514:new row for relation "community_events" violates check constraint "community_events_member_shape"'),
($q$B17-no-place-around-the-function$q$,true,$q$INSERT INTO public.community_events(source_type,source_key,organizer_user_id,discussion_post_id,starts_at,location,registration_mode) VALUES('member',pg_temp.id(84)::text,auth.uid(),pg_temp.id(84),now()+interval '1 day',NULL,'discussion')$q$,NULL,$q$SELECT pg_temp.as_member(1,'INSERT INTO public.posts(id,user_id,content,title,category) VALUES(pg_temp.id(84),auth.uid(),''EV regression body nineteen: no place.'',''EV regression topic nineteen'',''events-social'') RETURNING id')$q$,'authenticated',1,1,'23514:new row for relation "community_events" violates check constraint "community_events_member_shape"'),
-- Refused for everyone, whatever the state.
($q$R01-around-the-function$q$,false,$q$INSERT INTO public.community_events(source_type,source_key,organizer_user_id,discussion_post_id,starts_at,location,registration_mode) VALUES('member',pg_temp.id(61)::text,auth.uid(),pg_temp.id(61),now()+interval '1 day','EV','discussion')$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501:member_event_rpc_required'),
($q$R02-an-organization-row$q$,false,$q$INSERT INTO public.community_events(source_type,source_key,starts_at,registration_mode) VALUES('caaci',pg_temp.id(9009)::text,now(),'info_only')$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$R03-undo-a-cancellation$q$,false,$q$UPDATE public.community_events SET cancelled_at=NULL WHERE discussion_post_id=pg_temp.id(61)$q$,NULL,$q$UPDATE public.community_events SET cancelled_at=now() WHERE discussion_post_id=pg_temp.id(61)$q$,'authenticated',1,NULL,'23514:member_event_cancel_final'),
($q$R04-edit-the-time$q$,false,$q$UPDATE public.community_events SET starts_at=now()+interval '9 days' WHERE discussion_post_id=pg_temp.id(61)$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$R05-delete-own-event$q$,false,$q$DELETE FROM public.community_events WHERE discussion_post_id=pg_temp.id(61)$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$R06-private-columns$q$,false,$q$SELECT count(hidden_reason)>=0 FROM public.community_events$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$R07-cancel-anothers-event$q$,false,$q$UPDATE public.community_events SET cancelled_at=now() WHERE discussion_post_id=pg_temp.id(61)$q$,$q$SELECT cancelled_at IS NULL FROM public.community_events WHERE discussion_post_id=pg_temp.id(61)$q$,$q$$q$,'authenticated',3,0,NULL),
($q$R08-title-too-long$q$,false,$q$SELECT public.create_member_event(pg_temp.id(68),repeat('x',61),'EV regression body eight.',jsonb_build_object('starts_at',now()+interval '3 days','location','EV field eight')) IS NOT NULL$q$,NULL,$q$$q$,'authenticated',1,NULL,'22023:member_event_title_too_long'),
($q$R09-no-place$q$,false,$q$SELECT public.create_member_event(pg_temp.id(69),'EV regression event nine','EV regression body nine.',jsonb_build_object('starts_at',now()+interval '3 days','location','   ')) IS NOT NULL$q$,NULL,$q$$q$,'authenticated',1,NULL,'22023:member_event_location_invalid'),
($q$R10-not-verified$q$,false,$q$SELECT public.create_member_event(pg_temp.id(70),'EV regression event ten','EV regression body ten.',jsonb_build_object('starts_at',now()+interval '3 days','location','EV field ten')) IS NOT NULL$q$,NULL,$q$$q$,'authenticated',7,NULL,'42501:member_event_not_eligible'),
($q$R11-anothers-topic-id$q$,false,$q$SELECT public.create_member_event(pg_temp.id(61),'EV regression event eleven','EV regression body eleven.',jsonb_build_object('starts_at',now()+interval '3 days','location','EV field eleven')) IS NOT NULL$q$,NULL,$q$$q$,'authenticated',3,NULL,'23505'),
-- D-54 2m: an end is an instant within 30 days of the start. The function checks what it is given before
-- anything is written, as it does the title and the place, so the answer is the same in every state.
($q$R18-ends-after-thirty-days$q$,false,$q$SELECT public.create_member_event(pg_temp.id(78),'EV regression event thirteen','EV regression body thirteen: far too long.',jsonb_build_object('starts_at',now()+interval '3 days','ends_at',now()+interval '33 days 1 second','location','EV field thirteen')) IS NOT NULL$q$,NULL,$q$$q$,'authenticated',1,NULL,'22008:member_event_time_out_of_range'),
($q$R19-an-end-that-is-no-instant$q$,false,$q$SELECT public.create_member_event(pg_temp.id(79),'EV regression event fourteen','EV regression body fourteen: no end at all.',jsonb_build_object('starts_at',now()+interval '3 days','ends_at','infinity','location','EV field fourteen')) IS NOT NULL$q$,NULL,$q$$q$,'authenticated',1,NULL,'22008:member_event_time_out_of_range'),
-- A visitor. Ids are written out (#n# is replaced below): a temporary
-- function is not a visitor's to call.
($q$R12-anon-reads-visible-only$q$,false,$q$SELECT count(*) FILTER (WHERE id IN ('#51#','#52#','#53#'))=3 AND count(*) FILTER (WHERE id IN ('#54#','#55#'))=0 FROM public.community_events$q$,NULL,$q$$q$,'anon',1,NULL,NULL),
($q$R13-anon-list$q$,false,$q$SELECT bool_or(id='#51#') AND bool_or(id='#59#') AND NOT bool_or(id IN ('#54#','#55#','#56#','#57#','#58#')) FROM public.list_community_events()$q$,NULL,$q$$q$,'anon',1,NULL,NULL),
($q$R14-anon-private-columns$q$,false,$q$SELECT count(consent_ref)>=0 FROM public.community_events$q$,NULL,$q$$q$,'anon',1,NULL,'42501'),
($q$R15-anon-writes$q$,false,$q$UPDATE public.community_events SET cancelled_at=now()$q$,NULL,$q$$q$,'anon',1,NULL,'42501'),
($q$R16-anon-partners$q$,false,$q$SELECT count(*)=1 AND min(slug)='ev-chess-club' FROM public.community_event_partners WHERE slug LIKE 'ev-%'$q$,NULL,$q$$q$,'anon',1,NULL,NULL),
($q$R17-service-role-only-reads$q$,false,$q$UPDATE public.community_events SET title='x' WHERE source_type='caaci'$q$,NULL,$q$$q$,'service_role',1,NULL,'42501'),
-- Who may execute what, read from the catalog: on this image a call without
-- EXECUTE under SET ROLE takes the backend down instead of answering 42501.
-- G01 reads the grant this file made above: once the channel is open, the
-- function is a member's and nobody else's. Part 0 has what the migration
-- itself leaves.
($q$G01-create-is-for-members$q$,false,$q$SELECT has_function_privilege('authenticated',f,'EXECUTE') AND NOT has_function_privilege('anon',f,'EXECUTE') AND NOT has_function_privilege('service_role',f,'EXECUTE')
 FROM (VALUES ('public.create_member_event(uuid,text,text,jsonb)')) AS v(f)$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$G02-list-is-for-readers$q$,false,$q$SELECT has_function_privilege('anon',f,'EXECUTE') AND has_function_privilege('authenticated',f,'EXECUTE') AND NOT has_function_privilege('service_role',f,'EXECUTE')
 FROM (VALUES ('public.list_community_events(text,text,text,integer)')) AS v(f)$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$G03-dispatcher-is-for-service$q$,false,$q$SELECT bool_and(has_function_privilege(r,'public.admin_execute_mutation(text,uuid,text,text,jsonb)','EXECUTE') = (r = 'service_role'))
 FROM unnest(ARRAY['anon','authenticated','service_role']) AS r$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$G04-the-rest-is-private$q$,false,$q$SELECT NOT bool_or(has_function_privilege(r,f,'EXECUTE'))
 FROM unnest(ARRAY['anon','authenticated','service_role']) AS r,
      unnest(ARRAY['public.admin_execute_community_events(text,uuid,text,text,jsonb)',
        'public.admin_execute_mutation_pre_community_events(text,uuid,text,text,jsonb)',
        'private.community_events_member_guard()','private.community_events_follow_topic()',
        'private.community_events_post_link()','private.community_events_schedule_change()',
        'private.community_events_moderate_text()','private.assert_moderated_text(text,text)']) AS f$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL);

DO $ids$
BEGIN
  FOR n IN 51..59 LOOP
    UPDATE ev_cases SET action = replace(action, '#' || n || '#', pg_temp.id(n)::text) WHERE role_name <> 'authenticated';
  END LOOP;
  IF EXISTS (SELECT 1 FROM ev_cases WHERE action LIKE '%#%') THEN
    RAISE EXCEPTION 'EV case still holds an id placeholder';
  END IF;
END
$ids$;

-- Every table a refused write could have touched, directly or through a trigger.
CREATE TEMP TABLE ev_watch AS
SELECT c.oid::regclass::text AS relation
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND (
    (n.nspname = 'public' AND c.relname IN (
      'community_events', 'community_event_partners', 'community_event_sync_state',
      'posts', 'post_comments', 'post_follows', 'post_bookmarks', 'post_likes', 'post_items', 'profiles', 'suspensions'))
    OR (n.nspname IN ('public', 'private') AND (
      c.relname LIKE '%notification%' OR c.relname LIKE '%email%' OR c.relname LIKE '%deliver%'))
    OR n.nspname = 'translation_private'
  );

DO $watch$
BEGIN
  RAISE NOTICE 'EV_WATCH|%|%', (SELECT count(*) FROM ev_watch),
    (SELECT string_agg(relation, ',' ORDER BY relation) FROM ev_watch);
END
$watch$;

CREATE FUNCTION pg_temp.effects() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  watched text;
  data jsonb;
  result jsonb := '{}';
BEGIN
  FOR watched IN SELECT relation FROM ev_watch ORDER BY 1 LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text), ''[]'') FROM %s AS x', watched)
      INTO data;
    result := result || jsonb_build_object(watched, data);
  END LOOP;
  RETURN result;
END
$$;

CREATE TEMP TABLE ev_results(state text, operation text, passed boolean, reason text, detail text);

DO $matrix$
DECLARE
  t0 constant timestamptz := statement_timestamp();
  s record;
  c record;
  got boolean;
  checked boolean;
  affected bigint;
  passed boolean;
  reason text;
  detail text;
  expected text;
  observed text;
  observed_state text;
  before_effects jsonb;
  restricted boolean;
  end_at timestamptz;
BEGIN
  FOR s IN SELECT * FROM ev_states ORDER BY ord LOOP
    restricted := s.winning >= 2;
    RAISE NOTICE 'EV_STATE|%|effective=L%', s.name, s.winning;
    end_at := CASE s.winning_end
      WHEN 'in3d' THEN t0 + interval '3 days'
      WHEN 'infinity' THEN 'infinity'::timestamptz
      ELSE NULL END;
    expected := 'suspension_active:' || s.winning || ':' || CASE
      WHEN end_at IS NULL OR end_at = 'infinity'::timestamptz THEN 'permanent'
      ELSE to_char(end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END;
    FOR c IN SELECT * FROM ev_cases ORDER BY name LOOP
      passed := false; reason := 'harness'; detail := ''; observed := NULL; observed_state := NULL; got := NULL;
      BEGIN
        IF c.prepare <> '' THEN EXECUTE c.prepare; END IF;
        INSERT INTO public.suspensions(profile_id, level, reason, started_at, ends_at, lifted_at)
        SELECT pg_temp.id(1), r.level, 'EV matrix',
          CASE r.starts WHEN 'day_ago' THEN t0 - interval '1 day' WHEN 'tomorrow' THEN t0 + interval '1 day' ELSE t0 END,
          CASE r.ends WHEN 'in3d' THEN t0 + interval '3 days'
            WHEN 'infinity' THEN 'infinity'::timestamptz WHEN 'hour_ago' THEN t0 - interval '1 hour'
            ELSE NULL END,
          CASE WHEN r.lifted THEN t0 - interval '1 hour' END
        FROM ev_state_rows AS r WHERE r.state = s.name;
        -- The cache lies in the opposite direction; only the action log decides.
        UPDATE public.profiles
        SET suspension_level = CASE WHEN restricted THEN 0 ELSE 5 END,
            suspended_until = CASE WHEN restricted THEN NULL ELSE t0 + interval '10 days' END,
            shadow_banned = false
        WHERE id = pg_temp.id(1);
        IF c.blocked AND restricted THEN before_effects := pg_temp.effects(); END IF;
        BEGIN
          PERFORM set_config('request.jwt.claim.sub',
            CASE WHEN c.role_name = 'authenticated' THEN pg_temp.id(c.actor)::text ELSE '' END, true);
          PERFORM set_config('request.jwt.claims',
            CASE c.role_name WHEN 'service_role' THEN '{"role":"service_role"}'
              WHEN 'anon' THEN '{"role":"anon"}'
              ELSE jsonb_build_object('sub', pg_temp.id(c.actor), 'role', 'authenticated')::text END, true);
          EXECUTE 'SET LOCAL ROLE ' || quote_ident(c.role_name);
          IF c.rows_expected IS NULL THEN
            EXECUTE c.action INTO got;
          ELSE
            EXECUTE c.action;
            GET DIAGNOSTICS affected = ROW_COUNT;
            got := affected = c.rows_expected;
          END IF;
          RESET ROLE;
        EXCEPTION WHEN OTHERS THEN
          observed := SQLERRM; observed_state := SQLSTATE;
          RESET ROLE;
        END;
        PERFORM set_config('request.jwt.claim.sub', '', true);
        PERFORM set_config('request.jwt.claims', '{}', true);
        IF c.blocked AND restricted THEN
          IF observed IS NULL THEN
            reason := 'accepted';
          ELSIF observed_state <> 'P0001' OR observed <> expected THEN
            reason := 'other_error';
          ELSIF before_effects <> pg_temp.effects() THEN
            reason := 'side_effects';
          ELSE
            passed := true;
          END IF;
        ELSIF c.expected_error IS NOT NULL THEN
          IF observed IS NULL THEN
            reason := 'accepted';
          ELSIF observed_state = split_part(c.expected_error, ':', 1)
             AND (position(':' IN c.expected_error) = 0
               OR observed = substring(c.expected_error FROM position(':' IN c.expected_error) + 1)) THEN
            passed := true;
          ELSE
            reason := 'refused';
          END IF;
        ELSIF observed IS NOT NULL THEN
          reason := 'refused';
        ELSE
          checked := true;
          IF c.after_check IS NOT NULL THEN EXECUTE c.after_check INTO checked; END IF;
          IF got IS TRUE AND checked IS TRUE THEN passed := true; ELSE reason := 'wrong_result'; END IF;
        END IF;
        IF passed THEN reason := 'pass'; END IF;
        detail := CASE WHEN observed IS NULL
          THEN 'accepted; result=' || coalesce(got::text, 'NULL') || '; check=' || coalesce(checked::text, 'n/a')
          ELSE observed_state || ':' || observed END;
        -- Roll every case back, success included, and keep only its verdict.
        RAISE EXCEPTION USING ERRCODE = 'Z4953', MESSAGE = 'matrix rollback';
      EXCEPTION
        WHEN SQLSTATE 'Z4953' THEN NULL;
        WHEN OTHERS THEN
          passed := false; reason := 'harness'; detail := 'HARNESS:' || SQLSTATE || ':' || SQLERRM;
      END;
      INSERT INTO ev_results VALUES (s.name, c.name, passed, reason, detail);
      IF NOT passed THEN
        RAISE NOTICE 'EV_FAIL|%|%|%|%', s.name, c.name, reason, detail;
      END IF;
    END LOOP;
  END LOOP;
END
$matrix$;

-- One line per state, then one per case, then the total.
DO $summary$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT s.ord, s.name, s.winning,
           count(*) AS cases,
           count(*) FILTER (WHERE x.passed) AS pass,
           count(*) FILTER (WHERE NOT x.passed) AS fail,
           count(*) FILTER (WHERE x.reason = 'accepted') AS accepted,
           count(*) FILTER (WHERE x.reason = 'other_error') AS other_error,
           count(*) FILTER (WHERE x.reason = 'side_effects') AS side_effects,
           count(*) FILTER (WHERE x.reason = 'refused') AS refused,
           count(*) FILTER (WHERE x.reason = 'wrong_result') AS wrong_result,
           count(*) FILTER (WHERE x.reason = 'harness') AS harness
    FROM ev_results AS x JOIN ev_states AS s ON s.name = x.state
    GROUP BY s.ord, s.name, s.winning ORDER BY s.ord
  LOOP
    RAISE NOTICE 'EV_LEVEL|%|effective=L%|cases=%|pass=%|fail=%|accepted=%|other_error=%|side_effects=%|refused=%|wrong_result=%|harness=%',
      r.name, r.winning, r.cases, r.pass, r.fail, r.accepted, r.other_error, r.side_effects,
      r.refused, r.wrong_result, r.harness;
  END LOOP;
  FOR r IN
    SELECT x.operation, count(*) FILTER (WHERE x.passed) AS pass, count(*) FILTER (WHERE NOT x.passed) AS fail,
           coalesce(string_agg(DISTINCT x.reason, ',') FILTER (WHERE NOT x.passed), '') AS reasons
    FROM ev_results AS x GROUP BY x.operation ORDER BY x.operation
  LOOP
    RAISE NOTICE 'EV_CASE|%|pass=%|fail=%|%', r.operation, r.pass, r.fail, r.reasons;
  END LOOP;
  SELECT count(*) AS cases, count(*) FILTER (WHERE passed) AS pass, count(*) FILTER (WHERE NOT passed) AS fail,
         count(*) FILTER (WHERE reason = 'accepted') AS accepted,
         count(*) FILTER (WHERE reason = 'other_error') AS other_error,
         count(*) FILTER (WHERE reason = 'side_effects') AS side_effects,
         count(*) FILTER (WHERE reason = 'refused') AS refused,
         count(*) FILTER (WHERE reason = 'wrong_result') AS wrong_result,
         count(*) FILTER (WHERE reason = 'harness') AS harness
    INTO r FROM ev_results;
  RAISE NOTICE 'EV_TOTAL|cases=%|pass=%|fail=%|accepted=%|other_error=%|side_effects=%|refused=%|wrong_result=%|harness=%',
    r.cases, r.pass, r.fail, r.accepted, r.other_error, r.side_effects, r.refused, r.wrong_result, r.harness;
  IF r.cases <> (SELECT count(*) FROM ev_states) * (SELECT count(*) FROM ev_cases) THEN
    RAISE EXCEPTION 'EV regression did not run every case: % results', r.cases;
  END IF;
  IF r.fail > 0 THEN
    RAISE EXCEPTION 'EV regression failed: % of % cases', r.fail, r.cases;
  END IF;
END
$summary$;

-- ---------------------------------------------------------------------------
-- Part 2: scenarios through the real chain. Each raises on the first wrong
-- answer and otherwise reports one PASS line.
-- ---------------------------------------------------------------------------
DO $member_event$
DECLARE
  operator constant text := repeat('b', 64);
  call constant text := $q$SELECT public.create_member_event(pg_temp.id(71),'  EV scenario badminton  ','EV scenario body: three of us, three more welcome.',jsonb_build_object('starts_at',now()+interval '2 days','ends_at',now()+interval '2 days 2 hours','location',' EV scenario court '))$q$;
  made jsonb;
  event_id uuid;
  state text;
BEGIN
  -- The topic goes through the real triggers on topics: the payload boundary,
  -- moderation, the posting limits and the topic rules.
  made := pg_temp.as_member(2, call)::jsonb;
  event_id := (made ->> 'event_id')::uuid;
  PERFORM pg_temp.expect('the pair', made ->> 'post_id', pg_temp.id(71)::text);
  PERFORM pg_temp.expect('the topic',
    (SELECT category || '|' || title || '|' || user_id::text || '|' || status FROM public.posts WHERE id = pg_temp.id(71)),
    'events-social|EV scenario badminton|' || pg_temp.id(2)::text || '|active');
  PERFORM pg_temp.expect('the event',
    (SELECT source_type || '|' || source_key || '|' || location || '|' || registration_mode || '|' || availability || '|'
            || (discussion_post_id = pg_temp.id(71))::text || '|' || (ends_at > starts_at)::text
       FROM public.community_events WHERE id = event_id),
    'member|' || pg_temp.id(71)::text || '|EV scenario court|discussion|visible|true|true');
  -- A retry inside the minute: the posting limits would call it a repeated
  -- topic; the pair that exists comes back instead and nothing is written.
  PERFORM pg_temp.expect('a retry returns the pair', pg_temp.as_member(2, call)::jsonb::text, made::text);
  PERFORM pg_temp.expect('one topic, one event',
    (SELECT count(*) FROM public.posts WHERE user_id = pg_temp.id(2))::text || ':'
      || (SELECT count(*) FROM public.community_events WHERE organizer_user_id = pg_temp.id(2))::text, '1:1');
  -- The same text under a new id is still a repeated topic, as for any topic.
  BEGIN
    PERFORM pg_temp.as_member(2, $q$SELECT public.create_member_event(pg_temp.id(72),'EV scenario badminton again','EV scenario body: three of us, three more welcome.',jsonb_build_object('starts_at',now()+interval '2 days','location','EV scenario court'))$q$);
    RAISE EXCEPTION 'EV scenario: a repeated text was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    RESET ROLE;
    IF SQLERRM <> 'duplicate_post' THEN RAISE; END IF;
  END;
  -- The id is not another member's to get.
  BEGIN
    PERFORM pg_temp.as_member(3, $q$SELECT public.create_member_event(pg_temp.id(71),'EV scenario other member','EV scenario body: somebody else with the same id.',jsonb_build_object('starts_at',now()+interval '2 days','location','EV scenario court'))$q$);
    RAISE EXCEPTION 'EV scenario: another member was given the pair';
  EXCEPTION WHEN unique_violation THEN
    RESET ROLE;
  END;

  -- Readers get it with its topic's title and its organizer.
  PERFORM pg_temp.expect('listed for a visitor',
    pg_temp.as_anon(format($q$SELECT title || '|' || coalesce(organizer_nickname, '?') || '|' || coalesce(organizer_is_illini_verified::text, '?') || '|' || discussion_count::text || '|' || source_type
      FROM public.list_community_events(source_in => 'member') WHERE discussion_post_id = %L$q$, pg_temp.id(71))),
    'EV scenario badminton|EV member 2|true|0|member');

  -- The topic is taken down and restored by a moderator: the event follows.
  PERFORM pg_temp.expect('topic takedown',
    pg_temp.mutate(operator, 801, 'takedown_content', jsonb_build_object('target_type', 'post', 'target_id', pg_temp.id(71), 'reason', 'EV scenario takedown')),
    '{"data": {"ok": true, "affected": 1}}');
  PERFORM pg_temp.expect('hidden with its topic',
    (SELECT availability || '|' || coalesce(hidden_reason, '-') FROM public.community_events WHERE id = event_id), 'hidden|post_removed');
  PERFORM pg_temp.expect('gone for a visitor',
    pg_temp.as_anon(format($q$SELECT count(*)::text FROM public.community_events WHERE id = %L$q$, event_id)), '0');
  PERFORM pg_temp.expect('its organizer still reads it',
    pg_temp.as_member(2, format($q$SELECT availability FROM public.community_events WHERE id = %L$q$, event_id)), 'hidden');
  PERFORM pg_temp.expect('topic restore',
    pg_temp.mutate(operator, 802, 'restore_content', jsonb_build_object('target_type', 'post', 'target_id', pg_temp.id(71), 'reason', 'EV scenario restore')),
    '{"data": {"ok": true, "affected": 1}}');
  PERFORM pg_temp.expect('back with its topic',
    (SELECT availability || '|' || coalesce(hidden_reason, '-') FROM public.community_events WHERE id = event_id), 'visible|-');

  -- A takedown of the event itself outlasts its topic's restore, and lifting
  -- it while the topic is down leaves the event hidden for that reason.
  PERFORM pg_temp.expect('event takedown',
    pg_temp.mutate(operator, 803, 'hide_event', jsonb_build_object('event_id', event_id, 'reason', 'EV scenario event takedown')), '{"success": true}');
  PERFORM pg_temp.expect('topic takedown again',
    pg_temp.mutate(operator, 804, 'takedown_content', jsonb_build_object('target_type', 'post', 'target_id', pg_temp.id(71), 'reason', 'EV scenario takedown')),
    '{"data": {"ok": true, "affected": 1}}');
  PERFORM pg_temp.expect('hidden by a moderator',
    (SELECT availability || '|' || coalesce(hidden_reason, '-') FROM public.community_events WHERE id = event_id), 'hidden|admin');
  PERFORM pg_temp.expect('lifting the takedown',
    pg_temp.mutate(operator, 805, 'unhide_event', jsonb_build_object('event_id', event_id, 'reason', 'EV scenario lift')), '{"success": true}');
  PERFORM pg_temp.expect('still hidden for its topic',
    (SELECT availability || '|' || coalesce(hidden_reason, '-') FROM public.community_events WHERE id = event_id), 'hidden|post_removed');
  PERFORM pg_temp.expect('topic restore again',
    pg_temp.mutate(operator, 806, 'restore_content', jsonb_build_object('target_type', 'post', 'target_id', pg_temp.id(71), 'reason', 'EV scenario restore')),
    '{"data": {"ok": true, "affected": 1}}');
  PERFORM pg_temp.expect('visible again',
    (SELECT availability || '|' || coalesce(hidden_reason, '-') FROM public.community_events WHERE id = event_id), 'visible|-');

  -- The organizer cancels with a note and cannot undo it; the event stays
  -- listed, with the replies its topic has.
  PERFORM pg_temp.expect('cancel',
    pg_temp.as_member(2, format($q$UPDATE public.community_events SET cancelled_at = now(), status_note = 'EV scenario: court closed' WHERE id = %L RETURNING status_note$q$, event_id)),
    'EV scenario: court closed');
  BEGIN
    PERFORM pg_temp.as_member(2, format($q$UPDATE public.community_events SET cancelled_at = NULL WHERE id = %L RETURNING id$q$, event_id));
    RAISE EXCEPTION 'EV scenario: a cancellation was undone';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    RESET ROLE;
    IF SQLERRM <> 'member_event_cancel_final' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.as_member(3, $q$INSERT INTO public.post_comments(post_id,user_id,content) VALUES(pg_temp.id(71),auth.uid(),'EV scenario reply: count me in') RETURNING id$q$);
  PERFORM pg_temp.expect('cancelled, listed, with its replies',
    pg_temp.as_anon(format($q$SELECT (cancelled_at IS NOT NULL)::text || '|' || status_note || '|' || discussion_count::text
      FROM public.list_community_events(source_in => 'member') WHERE discussion_post_id = %L$q$, pg_temp.id(71))),
    'true|EV scenario: court closed|1');

  -- The author removes the topic altogether: the link is cleared and the
  -- event is hidden with it.
  PERFORM pg_temp.as_member(2, format($q$DELETE FROM public.posts WHERE id = %L RETURNING id$q$, pg_temp.id(71)));
  PERFORM pg_temp.expect('goes with a deleted topic',
    (SELECT availability || '|' || coalesce(hidden_reason, '-') || '|' || (discussion_post_id IS NULL)::text FROM public.community_events WHERE id = event_id),
    'hidden|post_removed|true');
  -- An event without its topic holds none of its organizer's two places: with
  -- one more open event the member is at one, and a second is accepted.
  PERFORM pg_temp.as_member(2, $q$SELECT public.create_member_event(pg_temp.id(73),'EV scenario run','EV scenario body: an easy five kilometres.',jsonb_build_object('starts_at',now()+interval '4 days','location','EV scenario track'))$q$);
  PERFORM pg_temp.as_member(2, $q$SELECT public.create_member_event(pg_temp.id(74),'EV scenario dinner','EV scenario body: noodles after the run.',jsonb_build_object('starts_at',now()+interval '4 days','location','EV scenario kitchen'))$q$);
  BEGIN
    PERFORM pg_temp.as_member(2, $q$SELECT public.create_member_event(pg_temp.id(75),'EV scenario film','EV scenario body: a film on Sunday.',jsonb_build_object('starts_at',now()+interval '5 days','location','EV scenario hall'))$q$);
    RAISE EXCEPTION 'EV scenario: a third open event was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    RESET ROLE;
    IF SQLERRM <> 'member_event_active_limit' THEN RAISE; END IF;
  END;
  -- A cancellation is dated by the server, whatever instant the client sent.
  PERFORM pg_temp.expect('a cancellation the client dated',
    pg_temp.as_member(2, format($q$UPDATE public.community_events SET cancelled_at = '1970-01-01T00:00:00Z' WHERE source_key = %L RETURNING (cancelled_at = now())::text$q$, pg_temp.id(74)::text)),
    'true');
  RAISE NOTICE 'EV_SCENARIO|member-event|PASS';
END
$member_event$;

DO $list$
DECLARE
  organizations constant text := $q$SELECT string_agg(right(id::text, 2), ',' ORDER BY ordinality) FROM public.list_community_events() WITH ORDINALITY WHERE source_type <> 'member'$q$;
BEGIN
  -- What has started and is still on comes first, then by start; on a tie
  -- caaci, partner, campus. The revoked partner's row, the withdrawn row, the
  -- duplicate, the one that is over and the one beyond the window are absent.
  PERFORM pg_temp.expect('upcoming for a visitor', pg_temp.as_anon(organizations), '59,51,52,53');
  PERFORM pg_temp.expect('upcoming for a member', pg_temp.as_member(3, organizations), '59,51,52,53');
  -- Member 1's event in two days comes before the three in three days; member
  -- 2's two events in four days, left by the scenario above, come after.
  PERFORM pg_temp.expect('member events in their places',
    pg_temp.as_anon($q$SELECT string_agg(CASE WHEN source_type = 'member' THEN 'm' ELSE right(id::text, 2) END, ',' ORDER BY ordinality) FROM public.list_community_events() WITH ORDINALITY$q$),
    '59,m,51,52,53,m,m');
  PERFORM pg_temp.expect('past',
    pg_temp.as_anon($q$SELECT string_agg(right(id::text, 2), ',' ORDER BY ordinality) FROM public.list_community_events(window_in => 'past') WITH ORDINALITY$q$), '57');
  PERFORM pg_temp.expect('one source',
    pg_temp.as_anon($q$SELECT string_agg(right(id::text, 2), ',') FROM public.list_community_events(source_in => 'partner')$q$), '52');
  PERFORM pg_temp.expect('limit',
    pg_temp.as_anon($q$SELECT string_agg(right(id::text, 2), ',') FROM public.list_community_events(limit_in => 1)$q$), '59');
  PERFORM pg_temp.expect('an organization that has given consent',
    pg_temp.as_anon($q$SELECT partner_name_zh || '|' || partner_name_en || '|' || array_to_string(allowed_link_hosts, ',') || '|' || registration_mode
      FROM public.list_community_events(source_in => 'partner')$q$),
    'EV 国际象棋社|EV Chess Club|chess.example.test|info_only');
  -- An organization's event that moves keeps where it was.
  UPDATE public.community_events SET starts_at = starts_at + interval '1 hour' WHERE id = pg_temp.id(53);
  PERFORM pg_temp.expect('a moved event',
    pg_temp.as_anon($q$SELECT revision::text || '|' || (previous_starts_at < starts_at)::text || '|' || (schedule_changed_at IS NOT NULL)::text
      FROM public.list_community_events(source_in => 'campus') WHERE title_en = 'EV research workshop'$q$),
    '2|true|true');
  RAISE NOTICE 'EV_SCENARIO|list|PASS';
END
$list$;

DO $actions$
DECLARE
  owner constant text := repeat('a', 64);
  operator constant text := repeat('b', 64);
  written bigint;
  seeded_audit bigint;
  reply text;
  topic uuid;
BEGIN
  SELECT coalesce(max(id), 0) INTO seeded_audit FROM public.admin_audit_log;
  -- The deployed API compares this list with its own, exactly.
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.expect('owner projection keeps its vocabulary',
    (SELECT (SELECT string_agg(c, ',' ORDER BY c COLLATE "C") FROM unnest(capabilities) AS c) FROM public.admin_token_authorization_v2(owner)),
    'apply_ban,decide_appeal,delete_banner,issue_token,lift_suspension,resolve_target_reports,revoke_admin_tokens,revoke_token,set_post_pinned,takedown_content,update_report_status,upload_banner,upsert_banner');
  PERFORM pg_temp.expect('operator projection keeps its vocabulary',
    (SELECT (SELECT string_agg(c, ',' ORDER BY c COLLATE "C") FROM unnest(capabilities) AS c) FROM public.admin_token_authorization_v2(operator)),
    'apply_ban,decide_appeal,lift_suspension,resolve_target_reports,takedown_content,update_report_status');
  PERFORM pg_temp.expect('v1 projection keeps its vocabulary',
    (SELECT (SELECT string_agg(c, ',' ORDER BY c COLLATE "C") FROM unnest(capabilities) AS c) FROM public.admin_token_authorization(owner)),
    'apply_ban,delete_banner,issue_token,lift_suspension,resolve_target_reports,revoke_admin_tokens,revoke_token,set_post_pinned,takedown_content,update_report_status,upload_banner,upsert_banner');
  RESET ROLE;

  -- create_event_discussion, E6 not done: refused by name, nothing written.
  SELECT (SELECT count(*) FROM public.admin_audit_log) + (SELECT count(*) FROM public.admin_mutation_requests) + (SELECT count(*) FROM public.posts) INTO written;
  PERFORM pg_temp.expect('official account not configured',
    pg_temp.mutate(owner, 901, 'create_event_discussion', jsonb_build_object('event_id', pg_temp.id(51), 'reason', 'EV scenario discussion')),
    'refused:official_profile_not_configured');
  PERFORM pg_temp.expect('official account null',
    pg_temp.mutate(owner, 902, 'create_event_discussion', jsonb_build_object('event_id', pg_temp.id(51), 'reason', 'EV scenario discussion', 'official_profile_id', NULL)),
    'refused:official_profile_not_configured');
  PERFORM pg_temp.expect('official account unknown',
    pg_temp.mutate(owner, 903, 'create_event_discussion', jsonb_build_object('event_id', pg_temp.id(51), 'reason', 'EV scenario discussion', 'official_profile_id', pg_temp.id(9999))),
    'refused:official_profile_not_configured');
  PERFORM pg_temp.expect('nothing written',
    ((SELECT count(*) FROM public.admin_audit_log) + (SELECT count(*) FROM public.admin_mutation_requests) + (SELECT count(*) FROM public.posts) - written
      + (SELECT count(*) FROM public.community_events WHERE id = pg_temp.id(51) AND discussion_post_id IS NOT NULL))::text, '0');

  -- Configured: an owner opens the one discussion of an organization's event,
  -- written as the official account through the real triggers on topics.
  PERFORM pg_temp.expect('a discussion needs an owner',
    pg_temp.mutate(operator, 904, 'create_event_discussion', jsonb_build_object('event_id', pg_temp.id(51), 'reason', 'EV scenario discussion', 'official_profile_id', pg_temp.id(5))),
    'refused:admin_capability_denied');
  reply := pg_temp.mutate(owner, 905, 'create_event_discussion', jsonb_build_object('event_id', pg_temp.id(51), 'reason', '  EV scenario discussion  ', 'official_profile_id', pg_temp.id(5)));
  IF reply LIKE 'refused:%' THEN
    RAISE EXCEPTION 'EV scenario discussion: %', reply;
  END IF;
  topic := (reply::jsonb #>> '{data,post_id}')::uuid;
  PERFORM pg_temp.expect('discussion answer', reply,
    jsonb_build_object('data', jsonb_build_object('event_id', pg_temp.id(51), 'post_id', topic, 'created', true))::text);
  PERFORM pg_temp.expect('official topic',
    (SELECT user_id::text || '|' || is_official::text || '|' || category || '|' || title || '|' || status FROM public.posts WHERE id = topic),
    pg_temp.id(5)::text || '|true|events-social|EV 迎新晚会|active');
  PERFORM pg_temp.expect('linked', (SELECT discussion_post_id::text FROM public.community_events WHERE id = pg_temp.id(51)), topic::text);
  PERFORM pg_temp.expect('asked again',
    pg_temp.mutate(owner, 906, 'create_event_discussion', jsonb_build_object('event_id', pg_temp.id(51), 'reason', 'EV scenario discussion', 'official_profile_id', pg_temp.id(5))),
    jsonb_build_object('data', jsonb_build_object('event_id', pg_temp.id(51), 'post_id', topic, 'created', false))::text);
  PERFORM pg_temp.expect('one topic', (SELECT count(*)::text FROM public.posts WHERE user_id = pg_temp.id(5) AND title = 'EV 迎新晚会'), '1');
  PERFORM pg_temp.expect('readers get the discussion',
    pg_temp.as_anon($q$SELECT (discussion_post_id IS NOT NULL)::text || '|' || discussion_count::text FROM public.list_community_events(source_in => 'caaci')$q$), 'true|0');
  -- Not for a row readers cannot see, a duplicate, or a member's event.
  PERFORM pg_temp.expect('withdrawn by its source',
    pg_temp.mutate(owner, 907, 'create_event_discussion', jsonb_build_object('event_id', pg_temp.id(55), 'reason', 'EV scenario discussion', 'official_profile_id', pg_temp.id(5))),
    'refused:event_discussion_closed');
  PERFORM pg_temp.expect('partner without consent',
    pg_temp.mutate(owner, 908, 'create_event_discussion', jsonb_build_object('event_id', pg_temp.id(54), 'reason', 'EV scenario discussion', 'official_profile_id', pg_temp.id(5))),
    'refused:event_discussion_closed');
  PERFORM pg_temp.expect('duplicate',
    pg_temp.mutate(owner, 909, 'create_event_discussion', jsonb_build_object('event_id', pg_temp.id(56), 'reason', 'EV scenario discussion', 'official_profile_id', pg_temp.id(5))),
    'refused:event_discussion_closed');
  PERFORM pg_temp.expect('a member event has its own topic',
    pg_temp.mutate(owner, 910, 'create_event_discussion', jsonb_build_object('event_id', (SELECT id FROM public.community_events WHERE source_key = pg_temp.id(61)::text),
      'reason', 'EV scenario discussion', 'official_profile_id', pg_temp.id(5))),
    'refused:event_not_found');

  -- Takedown and back for the moderation role, with a replay.
  PERFORM pg_temp.expect('takedown',
    pg_temp.mutate(operator, 911, 'hide_event', jsonb_build_object('event_id', pg_temp.id(52), 'reason', 'EV scenario takedown')), '{"success": true}');
  PERFORM pg_temp.expect('takedown replayed',
    pg_temp.mutate(operator, 911, 'hide_event', jsonb_build_object('event_id', pg_temp.id(52), 'reason', 'EV scenario takedown')), '{"success": true}');
  PERFORM pg_temp.expect('gone from the list',
    pg_temp.as_anon($q$SELECT count(*)::text FROM public.list_community_events(source_in => 'partner')$q$), '0');
  -- Asked again under a new key: answered the same way, and nothing changes.
  PERFORM pg_temp.expect('already taken down',
    pg_temp.mutate(operator, 912, 'hide_event', jsonb_build_object('event_id', pg_temp.id(52), 'reason', 'EV scenario takedown')), '{"success": true}');
  PERFORM pg_temp.expect('still taken down',
    (SELECT availability || '|' || hidden_reason FROM public.community_events WHERE id = pg_temp.id(52)), 'hidden|admin');
  PERFORM pg_temp.expect('no discussion while it is down',
    pg_temp.mutate(owner, 913, 'create_event_discussion', jsonb_build_object('event_id', pg_temp.id(52), 'reason', 'EV scenario discussion', 'official_profile_id', pg_temp.id(5))),
    'refused:event_discussion_closed');
  PERFORM pg_temp.expect('a reason is required',
    pg_temp.mutate(operator, 914, 'unhide_event', jsonb_build_object('event_id', pg_temp.id(52))), 'refused:admin_mutation_invalid_payload');
  PERFORM pg_temp.expect('back',
    pg_temp.mutate(owner, 915, 'unhide_event', jsonb_build_object('event_id', pg_temp.id(52), 'reason', 'EV scenario lift')), '{"success": true}');
  PERFORM pg_temp.expect('listed again',
    pg_temp.as_anon($q$SELECT count(*)::text FROM public.list_community_events(source_in => 'partner')$q$), '1');
  PERFORM pg_temp.expect('already back',
    pg_temp.mutate(operator, 917, 'unhide_event', jsonb_build_object('event_id', pg_temp.id(52), 'reason', 'EV scenario lift')), '{"success": true}');
  PERFORM pg_temp.expect('still listed',
    pg_temp.as_anon($q$SELECT count(*)::text FROM public.list_community_events(source_in => 'partner')$q$), '1');
  -- Only an id that names no event is refused.
  PERFORM pg_temp.expect('no such event',
    pg_temp.mutate(operator, 918, 'hide_event', jsonb_build_object('event_id', pg_temp.id(9998), 'reason', 'EV scenario takedown')), 'refused:event_not_found');
  PERFORM pg_temp.expect('no such event to put back',
    pg_temp.mutate(operator, 919, 'unhide_event', jsonb_build_object('event_id', pg_temp.id(9998), 'reason', 'EV scenario lift')), 'refused:event_not_found');
  -- A row its source withdrew: a takedown and its undo leave it withdrawn.
  -- It does not come back to the list.
  PERFORM pg_temp.expect('takedown of a withdrawn row',
    pg_temp.mutate(operator, 920, 'hide_event', jsonb_build_object('event_id', pg_temp.id(55), 'reason', 'EV scenario takedown')), '{"success": true}');
  PERFORM pg_temp.expect('withdrawn and taken down',
    (SELECT availability || '|' || hidden_reason FROM public.community_events WHERE id = pg_temp.id(55)), 'hidden|admin');
  PERFORM pg_temp.expect('lifting it',
    pg_temp.mutate(owner, 921, 'unhide_event', jsonb_build_object('event_id', pg_temp.id(55), 'reason', 'EV scenario lift')), '{"success": true}');
  PERFORM pg_temp.expect('withdrawn again, and not a visitor''s to read',
    (SELECT availability || '|' || coalesce(hidden_reason, '-') FROM public.community_events WHERE id = pg_temp.id(55)) || '|'
      || pg_temp.as_anon(format($q$SELECT count(*)::text FROM public.community_events WHERE id = %L$q$, pg_temp.id(55))),
    'unavailable|-|0');

  -- One audit row per completed request, with its administrator. A request
  -- that found things already as it asked says so: created or changed is
  -- false. The replay under the same key (911) and the refusals leave none.
  PERFORM pg_temp.expect('audit rows',
    (SELECT string_agg(event_kind || ':' || right(target_id::text, 2) || ':' || coalesce(details ->> 'created', details ->> 'changed'), ',' ORDER BY id)
       FROM public.admin_audit_log WHERE id > seeded_audit AND actor_id = pg_temp.id(4)),
    'event_discussion_created:51:true,event_discussion_created:51:false,event_hidden:52:true,event_hidden:52:false,event_unhidden:52:true,event_unhidden:52:false,event_hidden:55:true,event_unhidden:55:true');
  -- The moderation role's own list, read as the console reads it for an
  -- operator. It carries each takedown and each undoing, and not the owner's
  -- opening of a discussion, which stays in the owner's list (D-55 3b).
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.expect('the moderation list',
    (SELECT string_agg(listed.event_kind || ':' || right(listed.target_id::text, 2), ',' ORDER BY listed.id)
       FROM public.admin_list_moderation_audit_log(500, 0, NULL) AS listed
      WHERE listed.id > seeded_audit AND listed.actor_id = pg_temp.id(4)),
    'event_hidden:52,event_hidden:52,event_unhidden:52,event_unhidden:52,event_hidden:55,event_unhidden:55');
  PERFORM pg_temp.expect('the moderation list, asked for the owner''s kind',
    (SELECT count(*)::text FROM public.admin_list_moderation_audit_log(500, 0, 'event_discussion_created')), '0');
  RESET ROLE;
  -- An earlier action still goes where it went, through the new router.
  PERFORM pg_temp.expect('an earlier action',
    pg_temp.mutate(operator, 916, 'set_post_locked', jsonb_build_object('post_id', topic, 'locked', true, 'reason', 'EV scenario lock')), '{"success": true}');
  RAISE NOTICE 'EV_SCENARIO|actions|PASS';
END
$actions$;

-- The rules of the table itself, whoever writes: here the owner does.
DO $rules$
DECLARE
  bad text;
  violated text;
  old_event constant text := pg_temp.id(73)::text;
BEGIN
  -- D-54 2k: the keyword filter is on the table. An organization's row passes
  -- it as a member's does, on insert and on update.
  BEGIN
    UPDATE public.community_events SET location = 'EV evblockedmarker hall' WHERE id = pg_temp.id(53);
    RAISE EXCEPTION 'EV scenario: a blocked place was written';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    PERFORM pg_temp.expect('a blocked place on an organization''s row', SQLERRM, 'moderation_block:event_location:sensitive_word');
  END;
  BEGIN
    INSERT INTO public.community_events(source_type,source_key,organizer_name,title_en,starts_at,page_url,registration_mode,status_note)
    VALUES ('campus','7/990006','University Library','EV blocked note',now()+interval '6 days','https://calendars.illinois.edu/detail/7/990006','calendar_page','EV evblockedmarker');
    RAISE EXCEPTION 'EV scenario: a blocked note was written';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    PERFORM pg_temp.expect('a blocked note on an organization''s row', SQLERRM, 'moderation_block:event_status_note:sensitive_word');
  END;
  -- A link and reserved wording are a member's rule: an organization's place
  -- may say either.
  UPDATE public.community_events SET location = 'Official residence, www.example.org' WHERE id = pg_temp.id(53);
  -- A text the filter comes to refuse later is not asked again while it stays
  -- as it is, so a refresh that writes the same value back goes through; a
  -- change to it is asked.
  UPDATE public.community_events SET location = 'EV laterblockedmarker hall' WHERE id = pg_temp.id(53);
  INSERT INTO public.moderation_keywords(keyword) VALUES ('laterblockedmarker');
  UPDATE public.community_events SET location = location, summary = 'EV refreshed.' WHERE id = pg_temp.id(53);
  BEGIN
    UPDATE public.community_events SET location = 'EV laterblockedmarker annex' WHERE id = pg_temp.id(53);
    RAISE EXCEPTION 'EV scenario: a changed blocked place was written';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    PERFORM pg_temp.expect('a changed place is asked again', SQLERRM, 'moderation_block:event_location:sensitive_word');
  END;
  PERFORM pg_temp.expect('the place and the summary after the refresh',
    (SELECT location || '|' || summary FROM public.community_events WHERE id = pg_temp.id(53)), 'EV laterblockedmarker hall|EV refreshed.');

  -- D-54 2m: both ends of every event are instants and in order, whatever
  -- the source.
  FOREACH bad IN ARRAY ARRAY[$q$starts_at = 'infinity'$q$, $q$starts_at = '-infinity'$q$, $q$ends_at = 'infinity'$q$,
    $q$ends_at = starts_at - interval '1 second'$q$] LOOP
    BEGIN
      EXECUTE format('UPDATE public.community_events SET %s WHERE id = %L', bad, pg_temp.id(53));
      RAISE EXCEPTION 'EV scenario: accepted %', bad;
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
      PERFORM pg_temp.expect(bad, violated, 'community_events_time_order_check');
    END;
  END LOOP;
  -- D-55 3d: an all-day event is on from the start of its first day to the
  -- start of the day after its last, so it has an end, later than its start.
  -- No end and an end at the start are refused by name; one day in Champaign
  -- is written, and cannot lose its end afterwards.
  FOREACH bad IN ARRAY ARRAY['NULL', $q$timestamptz '2026-11-23 00:00 America/Chicago'$q$] LOOP
    BEGIN
      EXECUTE format($q$INSERT INTO public.community_events(source_type,source_key,organizer_name,title_en,starts_at,ends_at,all_day,page_url,registration_mode)
        VALUES ('campus','7/990007','University Library','EV all day',timestamptz '2026-11-23 00:00 America/Chicago',%s,true,'https://calendars.illinois.edu/detail/7/990007','calendar_page')$q$, bad);
      RAISE EXCEPTION 'EV scenario: an all-day event was written with the end %', bad;
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
      PERFORM pg_temp.expect('an all-day event ending ' || bad, violated, 'community_events_all_day_end_check');
    END;
  END LOOP;
  INSERT INTO public.community_events(source_type,source_key,organizer_name,title_en,starts_at,ends_at,all_day,page_url,registration_mode)
  VALUES ('campus','7/990007','University Library','EV all day',timestamptz '2026-11-23 00:00 America/Chicago',timestamptz '2026-11-24 00:00 America/Chicago',true,'https://calendars.illinois.edu/detail/7/990007','calendar_page');
  BEGIN
    UPDATE public.community_events SET ends_at = NULL WHERE source_key = '7/990007';
    RAISE EXCEPTION 'EV scenario: an all-day event lost its end';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    PERFORM pg_temp.expect('an all-day event keeps its end', violated, 'community_events_all_day_end_check');
  END;
  -- Only a member's event has to end within 30 days of its start. That rule
  -- holds for whoever writes a member's row.
  UPDATE public.community_events SET ends_at = starts_at + interval '90 days' WHERE id = pg_temp.id(53);
  PERFORM pg_temp.expect('an organization''s event may run for months',
    (SELECT (ends_at - starts_at = interval '90 days')::text FROM public.community_events WHERE id = pg_temp.id(53)), 'true');
  BEGIN
    UPDATE public.community_events SET ends_at = starts_at + interval '30 days 1 second' WHERE source_key = pg_temp.id(74)::text;
    RAISE EXCEPTION 'EV scenario: a member''s event of more than 30 days was written';
  EXCEPTION WHEN SQLSTATE '22008' THEN
    PERFORM pg_temp.expect('a member''s event ends within 30 days', SQLERRM, 'member_event_time_out_of_range');
  END;

  -- A partner's row names the consent it is shared under, in the form a
  -- partner's own reference has.
  FOREACH bad IN ARRAY ARRAY['', 'x', 'EV CONSENT 001'] LOOP
    BEGIN
      INSERT INTO public.community_events(source_type,source_key,partner_id,consent_ref,title,summary,starts_at,page_url,registration_mode)
      VALUES ('partner','ev-chess-club|https://chess.example.test/b',pg_temp.id(41),bad,'EV B','EV b.',now()+interval '3 days','https://chess.example.test/b','info_only');
      RAISE EXCEPTION 'EV scenario: consent reference "%" was accepted', bad;
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
      PERFORM pg_temp.expect('consent reference ' || quote_literal(bad), violated, 'community_events_partner_shape');
    END;
  END LOOP;

  -- A row is withdrawn only on its source's evidence: two checks that did
  -- not find it.
  BEGIN
    UPDATE public.community_events SET availability = 'unavailable' WHERE id = pg_temp.id(53);
    RAISE EXCEPTION 'EV scenario: withdrawn without two missed checks';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    PERFORM pg_temp.expect('withdrawn only on evidence', violated, 'community_events_unavailable_check');
  END;

  -- Readers are served what the list can show. Member 2's event 73 is moved
  -- back by the owner, as no member can: 179 days after it a visitor still
  -- reads it; 181 days after, only its organizer does, and the list has it in
  -- neither window.
  UPDATE public.community_events SET starts_at = now() - interval '179 days' WHERE source_key = old_event;
  PERFORM pg_temp.expect('179 days on, for a visitor',
    pg_temp.as_anon(format($q$SELECT count(*)::text FROM public.community_events WHERE source_key = %L$q$, old_event)), '1');
  UPDATE public.community_events SET starts_at = now() - interval '181 days' WHERE source_key = old_event;
  PERFORM pg_temp.expect('181 days on, for a visitor',
    pg_temp.as_anon(format($q$SELECT count(*)::text FROM public.community_events WHERE source_key = %L$q$, old_event)), '0');
  PERFORM pg_temp.expect('181 days on, for another member',
    pg_temp.as_member(3, format($q$SELECT count(*)::text FROM public.community_events WHERE source_key = %L$q$, old_event)), '0');
  PERFORM pg_temp.expect('181 days on, for its organizer',
    pg_temp.as_member(2, format($q$SELECT count(*)::text FROM public.community_events WHERE source_key = %L$q$, old_event)), '1');
  PERFORM pg_temp.expect('181 days on, in neither window of the list',
    pg_temp.as_anon(format($q$SELECT (SELECT count(*) FROM public.list_community_events(source_in => 'member') WHERE discussion_post_id = %L)::text || ':'
      || (SELECT count(*) FROM public.list_community_events(source_in => 'member', window_in => 'past') WHERE discussion_post_id = %L)::text$q$, old_event, old_event)), '0:0');
  RAISE NOTICE 'EV_SCENARIO|rules|PASS';
END
$rules$;

ROLLBACK;
