-- P3 watch, save, activity, reply notices and governance: rollback-only
-- regression for 20261120100354_community_watch_save_activity.sql. Disposable
-- L-SQL only (RUNBOOK §5.1): it uses the real ACLs, RLS, triggers and
-- administrator dispatcher of a full replay and must never run against a
-- hosted project.
--
-- Part 1 is the D-49 matrix. Member 1 is put through every moderation state
-- below while the cached profiles.suspension_level column is deliberately
-- wrong in the other direction; the action log in public.suspensions is the
-- only authority. A watch and a save are private and notify nobody, so they
-- must succeed in every state. A reply is seen by others, so an active level
-- 2-5 restriction must refuse it with SQLSTATE P0001 and the exact
-- suspension_active:<level>:<until> text, before the new lock rule answers,
-- and leave every watched table as it was. Every case runs in its own
-- subtransaction and is rolled back, success included.
--
-- Part 2 runs the reply notices, the orderings and the five administrator
-- actions once each through the real chain, and then restores a reply that
-- was hidden when the migration ran.
--
-- D-54 2c: the two new reply notices ship switched off. This file is where
-- that is asserted (VERIFY only reports the value). After the assertion the
-- switch is turned on inside this transaction, which is rolled back at the
-- end, and one matrix case turns it off again to show that nothing is written.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '900s';
SET LOCAL search_path = pg_catalog, public;

CREATE FUNCTION pg_temp.id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('caac1120-2026-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;

-- Catalog evidence for the report: stored bodies and the reply triggers as
-- they are when this file runs.
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
            'update_post_comment_count', 'search_community_posts', 'admin_execute_mutation',
            'admin_execute_mutation_pre_community_governance', 'admin_execute_community_governance',
            'admin_token_authorization', 'admin_token_authorization_v2', 'admin_list_moderation_audit_log',
            'admin_list_community_posts', 'admin_list_report_queue', 'community_post_state',
            'list_own_hidden_posts', 'trg_enforce_actor', 'notify_post_comment'))
       OR (n.nspname = 'private' AND p.proname IN (
            'reject_reply_to_locked_post', 'validate_comment_reply_target', 'notify_topic_reply',
            'enqueue_activity_notification'))
       OR (n.nspname = 'moderation_private' AND p.proname IN ('current_profile_state', 'profile_content_visible'))
    ORDER BY 1
  LOOP
    RAISE NOTICE 'P3_BODY|%|%|owner=%|secdef=%|%|%',
      r.signature, r.body_md5, r.owner, r.secdef, r.config, r.acl;
  END LOOP;
  FOR r IN
    SELECT t.tgname::text AS name, t.tgfoid::regprocedure::text AS routine,
           t.tgtype::integer AS kind, t.tgenabled::text AS enabled
    FROM pg_trigger AS t
    WHERE t.tgrelid = 'public.post_comments'::regclass AND NOT t.tgisinternal
    ORDER BY (t.tgtype::integer & 2) DESC, t.tgname::text COLLATE "C"
  LOOP
    RAISE NOTICE 'P3_REPLY_TRIGGER|%|%|type=%|enabled=%', r.name, r.routine, r.kind, r.enabled;
  END LOOP;
END
$evidence$;

-- Members: 1 is put through the states; 2 writes the topics; 3 replies and
-- watches; 4 administers; 5 is the official account; 6 has blocked member 1;
-- member 1 has blocked 7.
INSERT INTO auth.users(id,email,aud,role,raw_user_meta_data)
SELECT pg_temp.id(n),'p3-'||n||'@example.invalid','authenticated','authenticated',
 jsonb_build_object('nickname','P3 member '||n) FROM generate_series(1,7) n;
INSERT INTO public.profiles(id,nickname,email)
SELECT pg_temp.id(n),'P3 member '||n,'p3-'||n||'@example.invalid' FROM generate_series(1,7) n
ON CONFLICT (id) DO UPDATE SET nickname=excluded.nickname,email=excluded.email;
INSERT INTO public.blocks(blocker_id,blocked_id) VALUES
 (pg_temp.id(6),pg_temp.id(1)),(pg_temp.id(1),pg_temp.id(7));
INSERT INTO public.posts(id,user_id,content,title,category,created_at) VALUES
 (pg_temp.id(21),pg_temp.id(2),'P3 regression body one','P3 regression topic one','campus-life',now()-interval '6 hours'),
 (pg_temp.id(22),pg_temp.id(2),'P3 regression body two','P3 regression topic two','campus-life',now()-interval '5 hours'),
 (pg_temp.id(23),pg_temp.id(2),'P3 regression body three','P3 regression topic three','campus-life',now()-interval '4 hours'),
 (pg_temp.id(24),pg_temp.id(6),'P3 regression body four','P3 regression topic four','campus-life',now()-interval '3 hours'),
 (pg_temp.id(25),pg_temp.id(7),'P3 regression body five','P3 regression topic five','campus-life',now()-interval '3 hours'),
 (pg_temp.id(26),pg_temp.id(1),'P3 regression body six','P3 regression topic six','campus-life',now()-interval '2 hours'),
 (pg_temp.id(27),pg_temp.id(5),'P3 regression body seven','P3 regression topic seven','campus-life',now()-interval '2 hours'),
 (pg_temp.id(29),pg_temp.id(2),'P3 regression body nine','P3 regression topic nine','settling-market',now()-interval '1 hour'),
 (pg_temp.id(30),pg_temp.id(3),'P3 regression body ten','P3 regression topic ten','campus-life',now()-interval '1 hour');
INSERT INTO public.posts(id,user_id,content,created_at) VALUES
 (pg_temp.id(28),pg_temp.id(2),'P3 regression update without a title',now()-interval '30 minutes');
-- A topic a client posts gets both times from the same default; these were
-- backdated, so place their activity where they were posted.
UPDATE public.posts SET last_activity_at=created_at WHERE id IN (SELECT pg_temp.id(n) FROM generate_series(21,30) n);
INSERT INTO public.post_comments(id,post_id,user_id,content) VALUES
 (pg_temp.id(31),pg_temp.id(21),pg_temp.id(3),'P3 regression first reply');
-- Topic 22 is closed to replies; 23 and 26 were taken down.
UPDATE public.posts SET locked_at=now() WHERE id=pg_temp.id(22);
UPDATE public.posts SET status='hidden' WHERE id IN (pg_temp.id(23),pg_temp.id(26));
INSERT INTO public.admin_audit_log(event_kind,actor_id,target_id,details) VALUES
 ('content_takedown',pg_temp.id(4),pg_temp.id(26),'{"target_type":"post","reason":"P3 regression reason","affected":1}');
INSERT INTO public.admin_tokens(id,token_hash,admin_id,admin_name,admin_email,role,expires_at,revoked_at,created_by) VALUES
 (pg_temp.id(41),repeat('a',64),pg_temp.id(4),'P3 Owner','p3-4@example.invalid','owner',now()+interval '30 days',NULL,pg_temp.id(4)),
 (pg_temp.id(42),repeat('b',64),pg_temp.id(4),'P3 Operator','p3-4@example.invalid','operator',now()+interval '30 days',NULL,pg_temp.id(4));
DELETE FROM public.notifications;

-- D-54 2c: off as shipped, then on for everything below.
DO $switch$
BEGIN
  IF (SELECT count(*) = 1 AND bool_and(singleton) AND NOT bool_or(enabled)
        FROM private.community_reply_notice_config) IS NOT TRUE THEN
    RAISE EXCEPTION 'P3 reply notice switch is not one row that is off';
  END IF;
  -- The seeded reply above was written with the switch off: the topic author
  -- was told as always (deleted above with every other row), nobody else was.
  RAISE NOTICE 'P3_SWITCH|default=off|PASS';
END
$switch$;
UPDATE private.community_reply_notice_config SET enabled = true;

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

DO $fixture$
BEGIN
  IF (SELECT count(*) FROM public.profiles WHERE id IN (SELECT pg_temp.id(n) FROM generate_series(1,7) n)) <> 7
     OR (SELECT count(*) FROM public.posts WHERE id IN (SELECT pg_temp.id(n) FROM generate_series(21,30) n)) <> 10
     OR (SELECT comment_count FROM public.posts WHERE id=pg_temp.id(21)) <> 1
     OR (SELECT answered_at IS NULL OR last_activity_at <= created_at FROM public.posts WHERE id=pg_temp.id(21))
     OR (SELECT answered_at IS NOT NULL OR last_activity_at <> created_at FROM public.posts WHERE id=pg_temp.id(29)) THEN
    RAISE EXCEPTION 'P3 fixture is incomplete';
  END IF;
  RAISE NOTICE 'P3_FIXTURE|PASS';
END
$fixture$;

CREATE TEMP TABLE p3_states(ord integer, name text PRIMARY KEY, winning smallint NOT NULL, winning_end text);
INSERT INTO p3_states VALUES
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
CREATE TEMP TABLE p3_state_rows(state text NOT NULL, level smallint NOT NULL, starts text NOT NULL, ends text NOT NULL, lifted boolean NOT NULL);
INSERT INTO p3_state_rows VALUES
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
CREATE TEMP TABLE p3_cases(
 name text PRIMARY KEY, blocked boolean NOT NULL, action text NOT NULL,
 after_check text, prepare text NOT NULL, role_name text NOT NULL,
 actor integer NOT NULL, rows_expected integer, expected_error text
);
INSERT INTO p3_cases VALUES
-- Open in every state (D-49: private to the member, notifies nobody).
($q$A01-watch$q$,false,$q$WITH x AS (INSERT INTO public.post_follows(user_id,post_id) VALUES(auth.uid(),pg_temp.id(21)) RETURNING 1) SELECT count(*)=1 FROM x$q$,$q$SELECT count(*)=1 FROM public.post_follows WHERE user_id=pg_temp.id(1) AND post_id=pg_temp.id(21)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A02-unwatch$q$,false,$q$WITH x AS (DELETE FROM public.post_follows WHERE post_id=pg_temp.id(21) RETURNING 1) SELECT count(*)=1 FROM x$q$,$q$SELECT count(*)=0 FROM public.post_follows WHERE user_id=pg_temp.id(1)$q$,$q$INSERT INTO public.post_follows(user_id,post_id) VALUES(pg_temp.id(1),pg_temp.id(21))$q$,'authenticated',1,NULL,NULL),
($q$A03-save$q$,false,$q$WITH x AS (INSERT INTO public.post_bookmarks(user_id,post_id) VALUES(auth.uid(),pg_temp.id(21)) RETURNING 1) SELECT count(*)=1 FROM x$q$,$q$SELECT count(*)=1 FROM public.post_bookmarks WHERE user_id=pg_temp.id(1) AND post_id=pg_temp.id(21)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A04-unsave$q$,false,$q$WITH x AS (DELETE FROM public.post_bookmarks WHERE post_id=pg_temp.id(21) RETURNING 1) SELECT count(*)=1 FROM x$q$,$q$SELECT count(*)=0 FROM public.post_bookmarks WHERE user_id=pg_temp.id(1)$q$,$q$INSERT INTO public.post_bookmarks(user_id,post_id) VALUES(pg_temp.id(1),pg_temp.id(21))$q$,'authenticated',1,NULL,NULL),
($q$A05-own-lists-only$q$,false,$q$SELECT (SELECT count(*) FROM public.post_follows)=1 AND (SELECT count(*) FROM public.post_bookmarks)=1$q$,NULL,$q$INSERT INTO public.post_follows(user_id,post_id) VALUES(pg_temp.id(1),pg_temp.id(21)),(pg_temp.id(3),pg_temp.id(21));
 INSERT INTO public.post_bookmarks(user_id,post_id) VALUES(pg_temp.id(1),pg_temp.id(29)),(pg_temp.id(3),pg_temp.id(29))$q$,'authenticated',1,NULL,NULL),
($q$A06-save-an-update$q$,false,$q$WITH x AS (INSERT INTO public.post_bookmarks(user_id,post_id) VALUES(auth.uid(),pg_temp.id(28)) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$A07-topic-state$q$,false,$q$SELECT public.community_post_state(pg_temp.id(21))='active' AND public.community_post_state(pg_temp.id(23))='hidden'
 AND public.community_post_state(pg_temp.id(99))='missing'$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
-- D-54 2e: the author reads their own text back and nothing the moderator wrote (the fixture recorded a reason).
($q$A08-own-hidden-topic$q$,false,$q$SELECT count(*)=1 AND min(id::text)=pg_temp.id(26)::text AND min(content)='P3 regression body six'
 AND bool_and((SELECT string_agg(k, ',' ORDER BY k COLLATE "C") FROM jsonb_object_keys(to_jsonb(t)) AS k)='category,content,created_at,id,title')
 AND bool_and(position('P3 regression reason' IN to_jsonb(t)::text)=0)
 FROM public.list_own_hidden_posts() AS t$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$A09-search-by-activity$q$,false,$q$SELECT count(*)>=3 FROM public.search_community_posts(ARRAY['P3 regression'],'active')$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
-- Somebody else replies; the member under test is told as a watcher in any state.
($q$A10-told-as-watcher$q$,false,$q$WITH x AS (INSERT INTO public.post_comments(post_id,user_id,content) VALUES(pg_temp.id(29),auth.uid(),'A reply from another member') RETURNING 1) SELECT count(*)=1 FROM x$q$,$q$SELECT count(*)=1 FROM public.notifications WHERE user_id=pg_temp.id(1) AND type='post_comment' AND body='followed_post_reply:'||pg_temp.id(29)::text$q$,$q$INSERT INTO public.post_follows(user_id,post_id) VALUES(pg_temp.id(1),pg_temp.id(29))$q$,'authenticated',3,NULL,NULL),
-- D-54 2d: a notice follows the right to read. The member under test wrote this topic; another member
-- replies and a third one watches. The watcher is told exactly when they can still open the topic.
($q$A11-notice-follows-read-permission$q$,false,$q$WITH x AS (INSERT INTO public.post_comments(post_id,user_id,content) VALUES(pg_temp.id(32),auth.uid(),'A reply to a topic that may be hidden') RETURNING 1) SELECT count(*)=1 FROM x$q$,$q$SELECT (SELECT count(*) FROM public.notifications WHERE user_id=pg_temp.id(3) AND body='followed_post_reply:'||pg_temp.id(32)::text)
 = pg_temp.as_member(3, 'SELECT count(*) FROM public.posts WHERE id=pg_temp.id(32)')::bigint$q$,$q$INSERT INTO public.posts(id,user_id,content,title,category) VALUES(pg_temp.id(32),pg_temp.id(1),'P3 regression body twelve','P3 regression topic twelve','campus-life');
 INSERT INTO public.post_follows(user_id,post_id) VALUES(pg_temp.id(3),pg_temp.id(32))$q$,'authenticated',2,NULL,NULL),
-- D-54 2c: with the switch off a reply writes neither new notice; the topic author is told as always.
-- (A restriction placed on the member under test writes its own notice, so the count is of this topic's.)
($q$A12-switch-off-writes-neither-notice$q$,false,$q$WITH x AS (INSERT INTO public.post_comments(post_id,user_id,content,parent_comment_id,reply_to_comment_id) VALUES(pg_temp.id(21),auth.uid(),'A reply while the switch is off',pg_temp.id(31),pg_temp.id(31)) RETURNING 1) SELECT count(*)=1 FROM x$q$,$q$SELECT count(*) FILTER (WHERE body LIKE 'followed_post_reply:%' OR body LIKE 'comment_reply:%')=0
 AND count(*) FILTER (WHERE body LIKE '%:'||pg_temp.id(21)::text)=1
 AND count(*) FILTER (WHERE user_id=pg_temp.id(2) AND body='post_comment:'||pg_temp.id(21)::text)=1 FROM public.notifications$q$,$q$UPDATE private.community_reply_notice_config SET enabled=false;
 INSERT INTO public.post_follows(user_id,post_id) VALUES(pg_temp.id(1),pg_temp.id(21))$q$,'authenticated',5,NULL,NULL),
-- Refused for an active level 2-5 restriction, before any other rule.
($q$B01-reply$q$,true,$q$WITH x AS (INSERT INTO public.post_comments(post_id,user_id,content) VALUES(pg_temp.id(29),auth.uid(),'A new reply to the topic') RETURNING 1) SELECT count(*)=1 FROM x$q$,$q$SELECT comment_count=1 AND answered_at IS NOT NULL AND last_activity_at>created_at FROM public.posts WHERE id=pg_temp.id(29)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$B02-reply-to-a-reply$q$,true,$q$WITH x AS (INSERT INTO public.post_comments(post_id,user_id,content,parent_comment_id) VALUES(pg_temp.id(21),auth.uid(),'An answer to the first reply',pg_temp.id(31)) RETURNING 1) SELECT count(*)=1 FROM x$q$,$q$SELECT count(*)=1 FROM public.notifications WHERE user_id=pg_temp.id(3) AND body='comment_reply:'||pg_temp.id(21)::text$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$B03-reply-to-a-locked-topic$q$,true,$q$WITH x AS (INSERT INTO public.post_comments(post_id,user_id,content) VALUES(pg_temp.id(22),auth.uid(),'A reply to a closed topic') RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,'P0001:post_locked'),
-- D-54 2f: an answer to a reply inside a thread tells that reply's author (member 5), not the thread's first
-- author (member 3, who already has one comment_reply from the reply seeded here).
($q$B04-reply-to-a-nested-reply$q$,true,$q$WITH x AS (INSERT INTO public.post_comments(post_id,user_id,content,parent_comment_id,reply_to_comment_id) VALUES(pg_temp.id(21),auth.uid(),'An answer to the reply inside the thread',pg_temp.id(31),pg_temp.id(33)) RETURNING 1) SELECT count(*)=1 FROM x$q$,$q$SELECT (SELECT count(*) FROM public.notifications WHERE user_id=pg_temp.id(5) AND body='comment_reply:'||pg_temp.id(21)::text)=1
 AND (SELECT count(*) FROM public.notifications WHERE user_id=pg_temp.id(3) AND body='comment_reply:'||pg_temp.id(21)::text)=1
 AND (SELECT count(*) FROM public.post_comments WHERE user_id=pg_temp.id(1) AND reply_to_comment_id=pg_temp.id(33))=1$q$,$q$INSERT INTO public.post_comments(id,post_id,user_id,content,parent_comment_id,reply_to_comment_id) VALUES(pg_temp.id(33),pg_temp.id(21),pg_temp.id(5),'A reply inside the thread',pg_temp.id(31),pg_temp.id(31))$q$,'authenticated',1,NULL,NULL),
-- A reply target in another topic is refused by name; a restricted account hears about its restriction first.
($q$B05-reply-target-in-another-topic$q$,true,$q$WITH x AS (INSERT INTO public.post_comments(post_id,user_id,content,parent_comment_id,reply_to_comment_id) VALUES(pg_temp.id(21),auth.uid(),'An answer aimed at another topic',pg_temp.id(31),pg_temp.id(34)) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$INSERT INTO public.post_comments(id,post_id,user_id,content) VALUES(pg_temp.id(34),pg_temp.id(29),pg_temp.id(2),'A reply in another topic')$q$,'authenticated',1,NULL,'23514:comment_reply_target_invalid'),
-- Refused for everyone by row security or grants, whatever the state.
($q$R01-watch-hidden$q$,false,$q$INSERT INTO public.post_follows(user_id,post_id) VALUES(auth.uid(),pg_temp.id(23))$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$R02-watch-for-another$q$,false,$q$INSERT INTO public.post_follows(user_id,post_id) VALUES(pg_temp.id(3),pg_temp.id(21))$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$R03-watch-author-blocked-me$q$,false,$q$INSERT INTO public.post_follows(user_id,post_id) VALUES(auth.uid(),pg_temp.id(24))$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$R04-watch-author-i-blocked$q$,false,$q$INSERT INTO public.post_follows(user_id,post_id) VALUES(auth.uid(),pg_temp.id(25))$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$R05-save-hidden$q$,false,$q$INSERT INTO public.post_bookmarks(user_id,post_id) VALUES(auth.uid(),pg_temp.id(23))$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$R06-save-for-another$q$,false,$q$INSERT INTO public.post_bookmarks(user_id,post_id) VALUES(pg_temp.id(3),pg_temp.id(21))$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$R07-save-author-blocked-me$q$,false,$q$INSERT INTO public.post_bookmarks(user_id,post_id) VALUES(auth.uid(),pg_temp.id(24))$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$R08-save-author-i-blocked$q$,false,$q$INSERT INTO public.post_bookmarks(user_id,post_id) VALUES(auth.uid(),pg_temp.id(25))$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$R09-remove-anothers-watch$q$,false,$q$DELETE FROM public.post_follows WHERE user_id=pg_temp.id(3)$q$,$q$SELECT count(*)=1 FROM public.post_follows WHERE user_id=pg_temp.id(3)$q$,$q$INSERT INTO public.post_follows(user_id,post_id) VALUES(pg_temp.id(3),pg_temp.id(21))$q$,'authenticated',1,0,NULL),
($q$R10-edit-a-watch$q$,false,$q$UPDATE public.post_follows SET created_at=now()$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$R11-lock-column$q$,false,$q$UPDATE public.posts SET locked_at=now() WHERE id=pg_temp.id(26)$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$R12-featured-column$q$,false,$q$UPDATE public.posts SET is_featured=true WHERE id=pg_temp.id(26)$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$R13-activity-column$q$,false,$q$UPDATE public.posts SET last_activity_at=now(),answered_at=now() WHERE id=pg_temp.id(26)$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$R14-hidden-row-itself$q$,false,$q$SELECT count(*)=0 FROM public.posts WHERE id=pg_temp.id(26)$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$R15-delete-hidden-row$q$,false,$q$DELETE FROM public.posts WHERE id=pg_temp.id(26)$q$,$q$SELECT count(*)=1 FROM public.posts WHERE id=pg_temp.id(26)$q$,$q$$q$,'authenticated',1,0,NULL),
($q$R16-anon-watches$q$,false,$q$SELECT count(*)=0 FROM public.post_follows$q$,NULL,$q$$q$,'anon',1,NULL,'42501'),
($q$R17-anon-topic-state$q$,false,$q$SELECT public.community_post_state('caac1120-2026-4000-8000-000000000023')='hidden'
 AND public.community_post_state('caac1120-2026-4000-8000-000000000021')='active'$q$,NULL,$q$$q$,'anon',1,NULL,NULL),
-- Who may execute what, read from the catalog: on this image a call without
-- EXECUTE under SET ROLE takes the backend down instead of answering 42501.
($q$R18-own-hidden-is-for-members$q$,false,$q$SELECT has_function_privilege('authenticated','public.list_own_hidden_posts(uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.list_own_hidden_posts(uuid)','EXECUTE')$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$R19-console-lists-are-for-service$q$,false,$q$SELECT bool_and(has_function_privilege(r,f,'EXECUTE') = (r = 'service_role'))
 FROM unnest(ARRAY['anon','authenticated','service_role']) AS r,
      unnest(ARRAY['public.admin_list_community_posts(integer,integer,text)','public.admin_list_report_queue(integer,integer)',
        'public.admin_execute_mutation(text,uuid,text,text,jsonb)']) AS f$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$R20-governance-is-private$q$,false,$q$SELECT NOT bool_or(has_function_privilege(r,f,'EXECUTE'))
 FROM unnest(ARRAY['anon','authenticated','service_role']) AS r,
      unnest(ARRAY['public.admin_execute_community_governance(text,uuid,text,text,jsonb)',
        'public.admin_execute_mutation_pre_community_governance(text,uuid,text,text,jsonb)',
        'private.notify_topic_reply()','private.reject_reply_to_locked_post()','private.validate_comment_reply_target()']) AS f$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL);

-- Every table a refused reply could have touched, directly or through a trigger.
CREATE TEMP TABLE p3_watch AS
SELECT c.oid::regclass::text AS relation
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND (
    (n.nspname = 'public' AND c.relname IN (
      'posts', 'post_comments', 'post_follows', 'post_bookmarks', 'post_likes', 'post_items', 'profiles', 'suspensions'))
    OR (n.nspname IN ('public', 'private') AND (
      c.relname LIKE '%notification%' OR c.relname LIKE '%email%' OR c.relname LIKE '%deliver%'))
    OR n.nspname = 'translation_private'
  );

DO $watch$
BEGIN
  RAISE NOTICE 'P3_WATCH|%|%', (SELECT count(*) FROM p3_watch),
    (SELECT string_agg(relation, ',' ORDER BY relation) FROM p3_watch);
END
$watch$;

CREATE FUNCTION pg_temp.effects() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  watched text;
  data jsonb;
  result jsonb := '{}';
BEGIN
  FOR watched IN SELECT relation FROM p3_watch ORDER BY 1 LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text), ''[]'') FROM %s AS x', watched)
      INTO data;
    result := result || jsonb_build_object(watched, data);
  END LOOP;
  RETURN result;
END
$$;

CREATE TEMP TABLE p3_results(state text, operation text, passed boolean, reason text, detail text);

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
  FOR s IN SELECT * FROM p3_states ORDER BY ord LOOP
    restricted := s.winning >= 2;
    RAISE NOTICE 'P3_STATE|%|effective=L%', s.name, s.winning;
    end_at := CASE s.winning_end
      WHEN 'in3d' THEN t0 + interval '3 days'
      WHEN 'infinity' THEN 'infinity'::timestamptz
      ELSE NULL END;
    expected := 'suspension_active:' || s.winning || ':' || CASE
      WHEN end_at IS NULL OR end_at = 'infinity'::timestamptz THEN 'permanent'
      ELSE to_char(end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END;
    FOR c IN SELECT * FROM p3_cases ORDER BY name LOOP
      passed := false; reason := 'harness'; detail := ''; observed := NULL; observed_state := NULL; got := NULL;
      BEGIN
        IF c.prepare <> '' THEN EXECUTE c.prepare; END IF;
        INSERT INTO public.suspensions(profile_id, level, reason, started_at, ends_at, lifted_at)
        SELECT pg_temp.id(1), r.level, 'P3 matrix',
          CASE r.starts WHEN 'day_ago' THEN t0 - interval '1 day' WHEN 'tomorrow' THEN t0 + interval '1 day' ELSE t0 END,
          CASE r.ends WHEN 'in3d' THEN t0 + interval '3 days'
            WHEN 'infinity' THEN 'infinity'::timestamptz WHEN 'hour_ago' THEN t0 - interval '1 hour'
            ELSE NULL END,
          CASE WHEN r.lifted THEN t0 - interval '1 hour' END
        FROM p3_state_rows AS r WHERE r.state = s.name;
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
      INSERT INTO p3_results VALUES (s.name, c.name, passed, reason, detail);
      IF NOT passed THEN
        RAISE NOTICE 'P3_FAIL|%|%|%|%', s.name, c.name, reason, detail;
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
    FROM p3_results AS x JOIN p3_states AS s ON s.name = x.state
    GROUP BY s.ord, s.name, s.winning ORDER BY s.ord
  LOOP
    RAISE NOTICE 'P3_LEVEL|%|effective=L%|cases=%|pass=%|fail=%|accepted=%|other_error=%|side_effects=%|refused=%|wrong_result=%|harness=%',
      r.name, r.winning, r.cases, r.pass, r.fail, r.accepted, r.other_error, r.side_effects,
      r.refused, r.wrong_result, r.harness;
  END LOOP;
  FOR r IN
    SELECT x.operation, count(*) FILTER (WHERE x.passed) AS pass, count(*) FILTER (WHERE NOT x.passed) AS fail,
           coalesce(string_agg(DISTINCT x.reason, ',') FILTER (WHERE NOT x.passed), '') AS reasons
    FROM p3_results AS x GROUP BY x.operation ORDER BY x.operation
  LOOP
    RAISE NOTICE 'P3_CASE|%|pass=%|fail=%|%', r.operation, r.pass, r.fail, r.reasons;
  END LOOP;
  SELECT count(*) AS cases, count(*) FILTER (WHERE passed) AS pass, count(*) FILTER (WHERE NOT passed) AS fail,
         count(*) FILTER (WHERE reason = 'accepted') AS accepted,
         count(*) FILTER (WHERE reason = 'other_error') AS other_error,
         count(*) FILTER (WHERE reason = 'side_effects') AS side_effects,
         count(*) FILTER (WHERE reason = 'refused') AS refused,
         count(*) FILTER (WHERE reason = 'wrong_result') AS wrong_result,
         count(*) FILTER (WHERE reason = 'harness') AS harness
    INTO r FROM p3_results;
  RAISE NOTICE 'P3_TOTAL|cases=%|pass=%|fail=%|accepted=%|other_error=%|side_effects=%|refused=%|wrong_result=%|harness=%',
    r.cases, r.pass, r.fail, r.accepted, r.other_error, r.side_effects, r.refused, r.wrong_result, r.harness;
  IF r.cases <> (SELECT count(*) FROM p3_states) * (SELECT count(*) FROM p3_cases) THEN
    RAISE EXCEPTION 'P3 regression did not run every case: % results', r.cases;
  END IF;
  IF r.fail > 0 THEN
    RAISE EXCEPTION 'P3 regression failed: % of % cases', r.fail, r.cases;
  END IF;
END
$summary$;

-- ---------------------------------------------------------------------------
-- Part 2: scenarios through the real chain. Each raises on the first wrong
-- answer and otherwise reports one PASS line.
-- ---------------------------------------------------------------------------
-- pg_temp.as_member is defined above the matrix, which uses it too.
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
    RAISE EXCEPTION 'P3 scenario %: got %, wanted %', label, coalesce(actual, 'NULL'), wanted;
  END IF;
END
$$;

DO $notices$
DECLARE
  first_reply uuid;
  child_reply uuid;
  removed_reply uuid;
  kept_reply uuid;
BEGIN
  DELETE FROM public.notifications;
  -- Member 3 watches topic 29 (by member 2); member 7 replies.
  INSERT INTO public.post_follows(user_id, post_id) VALUES (pg_temp.id(3), pg_temp.id(29)), (pg_temp.id(7), pg_temp.id(29));
  first_reply := pg_temp.as_member(7, $q$INSERT INTO public.post_comments(post_id,user_id,content) VALUES(pg_temp.id(29),auth.uid(),'Scenario first reply') RETURNING id$q$)::uuid;
  PERFORM pg_temp.expect('one reply, three people',
    (SELECT string_agg(right(user_id::text, 1) || ':' || body || ':' || source_event_key, ' ' ORDER BY user_id) FROM public.notifications),
    '2:post_comment:' || pg_temp.id(29) || ':post-comment:' || first_reply
      || ' 3:followed_post_reply:' || pg_temp.id(29) || ':followed-reply:' || first_reply || ':' || pg_temp.id(3));
  PERFORM pg_temp.expect('notice and reply share one instant',
    (SELECT bool_and(n.created_at = c.created_at AND n.type = 'post_comment' AND n.title = '收到新评论 · New comment')::text
       FROM public.notifications AS n, public.post_comments AS c WHERE c.id = first_reply), 'true');
  -- Member 3 answers that reply: its author (7) is told once, as the person
  -- answered, and not again as a watcher; the topic author keeps post_comment.
  DELETE FROM public.notifications;
  child_reply := pg_temp.as_member(3, format($q$INSERT INTO public.post_comments(post_id,user_id,content,parent_comment_id) VALUES(pg_temp.id(29),auth.uid(),'Scenario answer to the reply',%L) RETURNING id$q$, first_reply))::uuid;
  PERFORM pg_temp.expect('a reply to a reply',
    (SELECT string_agg(right(user_id::text, 1) || ':' || split_part(body, ':', 1) || ':' || split_part(source_event_key, ':', 1), ' ' ORDER BY user_id) FROM public.notifications),
    '2:post_comment:post-comment 7:comment_reply:comment-reply');
  -- D-54 2f: member 5 answers member 3's reply inside member 7's thread. Member 3 is the person
  -- answered; member 7 started the thread, was not answered, and is told only as a watcher.
  DELETE FROM public.notifications;
  PERFORM pg_temp.as_member(5, format($q$INSERT INTO public.post_comments(post_id,user_id,content,parent_comment_id,reply_to_comment_id) VALUES(pg_temp.id(29),auth.uid(),'Scenario answer inside the thread',%L,%L) RETURNING id$q$, first_reply, child_reply));
  PERFORM pg_temp.expect('an answer to a reply inside a thread',
    (SELECT string_agg(right(user_id::text, 1) || ':' || split_part(body, ':', 1) || ':' || split_part(source_event_key, ':', 1), ' ' ORDER BY user_id) FROM public.notifications),
    '2:post_comment:post-comment 3:comment_reply:comment-reply 7:followed_post_reply:followed-reply');
  -- Removing a reply keeps the answers to it: they stay, and stop naming it. The author removes it
  -- as a member would, so every UPDATE trigger on replies gets its say about the cleared pointer.
  removed_reply := pg_temp.as_member(5, format($q$INSERT INTO public.post_comments(post_id,user_id,content,parent_comment_id,reply_to_comment_id) VALUES(pg_temp.id(29),auth.uid(),'Scenario reply that will be removed',%L,%L) RETURNING id$q$, first_reply, first_reply))::uuid;
  kept_reply := pg_temp.as_member(7, format($q$INSERT INTO public.post_comments(post_id,user_id,content,parent_comment_id,reply_to_comment_id) VALUES(pg_temp.id(29),auth.uid(),'Scenario answer that outlives its target',%L,%L) RETURNING id$q$, first_reply, removed_reply))::uuid;
  PERFORM pg_temp.expect('the answer names its target',
    (SELECT (reply_to_comment_id = removed_reply)::text FROM public.post_comments WHERE id = kept_reply), 'true');
  PERFORM pg_temp.expect('its author removes the target',
    pg_temp.as_member(5, format($q$WITH gone AS (DELETE FROM public.post_comments WHERE id = %L RETURNING 1) SELECT count(*) FROM gone$q$, removed_reply)), '1');
  PERFORM pg_temp.expect('the answer stays and names nothing',
    (SELECT count(*) || ':' || count(reply_to_comment_id) FROM public.post_comments WHERE id = kept_reply), '1:0');
  -- D-54 2d: the topic author comes under an active level 3 restriction. The topic is now hidden from
  -- everyone else, so the same kind of reply that told two people above tells only the author. The
  -- restriction and what follows it are rolled back here, like a matrix case.
  BEGIN
    INSERT INTO public.suspensions(profile_id, level, reason, started_at) VALUES (pg_temp.id(2), 3, 'P3 scenario', now() - interval '1 day');
    DELETE FROM public.notifications;
    PERFORM pg_temp.expect('the watcher cannot open the topic', pg_temp.as_member(3, 'SELECT count(*) FROM public.posts WHERE id=pg_temp.id(29)'), '0');
    PERFORM pg_temp.as_member(5, format($q$INSERT INTO public.post_comments(post_id,user_id,content,parent_comment_id,reply_to_comment_id) VALUES(pg_temp.id(29),auth.uid(),'Scenario reply to a hidden author',%L,%L) RETURNING id$q$, first_reply, child_reply));
    PERFORM pg_temp.expect('a topic nobody else can open',
      (SELECT coalesce(string_agg(right(user_id::text, 1) || ':' || split_part(body, ':', 1), ' ' ORDER BY user_id), '') FROM public.notifications),
      '2:post_comment');
    RAISE EXCEPTION USING ERRCODE = 'Z4953', MESSAGE = 'scenario rollback';
  EXCEPTION WHEN SQLSTATE 'Z4953' THEN NULL;
  END;
  -- 501 watchers: the first 500 by watch time are told, the last one is not.
  INSERT INTO auth.users(id,email,aud,role,raw_user_meta_data)
  SELECT pg_temp.id(10000+n),'p3-w'||n||'@example.invalid','authenticated','authenticated',jsonb_build_object('nickname','P3 watcher '||n)
  FROM generate_series(1,501) n;
  INSERT INTO public.profiles(id,nickname) SELECT pg_temp.id(10000+n),'P3 watcher '||n FROM generate_series(1,501) n
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.post_follows(user_id,post_id,created_at)
  SELECT pg_temp.id(10000+n),pg_temp.id(30),now()-interval '1 day'+n*interval '1 second' FROM generate_series(1,501) n;
  DELETE FROM public.notifications;
  PERFORM pg_temp.as_member(7, $q$INSERT INTO public.post_comments(post_id,user_id,content) VALUES(pg_temp.id(30),auth.uid(),'Scenario reply to a busy topic') RETURNING id$q$);
  PERFORM pg_temp.expect('501 watchers',
    (SELECT count(*) FILTER (WHERE body LIKE 'followed_post_reply:%') || ':' || count(DISTINCT user_id) FILTER (WHERE body LIKE 'followed_post_reply:%')
        || ':' || count(*) FILTER (WHERE user_id = pg_temp.id(10501)) || ':' || count(*) FILTER (WHERE user_id = pg_temp.id(10500))
        || ':' || count(*) FILTER (WHERE user_id = pg_temp.id(3) AND body LIKE 'post_comment:%')
       FROM public.notifications), '500:500:0:1:1');
  RAISE NOTICE 'P3_SCENARIO|reply-notices|PASS';
END
$notices$;

DO $ordering$
DECLARE
  listed text;
BEGIN
  -- Campus-life topics still visible: 21 (the oldest, replied to when it was
  -- seeded), 22, 24, 25, 27 and 30. Topic 30 got a reply in the previous
  -- scenario; put it back where it was posted. The term is short on purpose:
  -- every title matches it with the same rank, so the ordering decides.
  UPDATE public.posts SET last_activity_at = created_at, answered_at = NULL WHERE id = pg_temp.id(30);
  PERFORM pg_temp.as_member(3, $q$INSERT INTO public.post_comments(post_id,user_id,content) VALUES(pg_temp.id(27),auth.uid(),'Scenario reply that moves the topic') RETURNING id$q$);
  SELECT string_agg(right(id::text, 2), ',' ORDER BY ordinality) INTO listed
    FROM public.search_community_posts(ARRAY['P3'], 'active', 3, 0, 'campus-life') WITH ORDINALITY;
  PERFORM pg_temp.expect('latest activity first', listed, '27,21,30');
  SELECT string_agg(right(id::text, 2), ',' ORDER BY ordinality) INTO listed
    FROM public.search_community_posts(ARRAY['P3'], 'recent', 3, 0, 'campus-life') WITH ORDINALITY;
  PERFORM pg_temp.expect('newest first', listed, '30,27,25');
  SELECT string_agg(right(id::text, 2), ',' ORDER BY ordinality) INTO listed
    FROM public.search_community_posts(ARRAY['P3'], 'unanswered', 20, 0) WITH ORDINALITY;
  PERFORM pg_temp.expect('unanswered topics only', listed, '30,25,24,22');
  PERFORM pg_temp.expect('the keyset page after topic 21 by activity',
    (SELECT string_agg(right(id::text, 2), ',' ORDER BY last_activity_at DESC, id DESC) FROM (
       SELECT id, last_activity_at FROM public.posts
        WHERE status = 'active' AND region = 'cu' AND category = 'campus-life' AND title LIKE 'P3 regression%'
          AND (last_activity_at, id) < (SELECT last_activity_at, id FROM public.posts WHERE id = pg_temp.id(21))
        ORDER BY last_activity_at DESC, id DESC LIMIT 2) AS page), '30,25');
  RAISE NOTICE 'P3_SCENARIO|ordering|PASS';
END
$ordering$;

DO $governance$
DECLARE
  owner constant text := repeat('a', 64);
  operator constant text := repeat('b', 64);
  written bigint;
  seeded_audit bigint;
BEGIN
  SELECT max(id) INTO seeded_audit FROM public.admin_audit_log;
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

  -- An earlier action still runs end to end through the renamed dispatcher:
  -- take topic 29 down, and its author reads the reason.
  PERFORM pg_temp.expect('takedown through the chain',
    pg_temp.mutate(operator, 901, 'takedown_content', jsonb_build_object('target_type', 'post', 'target_id', pg_temp.id(29), 'reason', '  Scenario takedown reason  ')),
    '{"data": {"ok": true, "affected": 1}}');
  -- D-54 2e: the author reads their own topic back, and none of what the moderator just typed.
  PERFORM pg_temp.expect('the author does not read the moderator''s note',
    pg_temp.as_member(2, $q$SELECT string_agg((SELECT string_agg(k, ',' ORDER BY k COLLATE "C") FROM jsonb_object_keys(to_jsonb(t)) AS k)
      || ':' || position('Scenario takedown reason' IN to_jsonb(t)::text), ' ') FROM public.list_own_hidden_posts(pg_temp.id(29)) AS t$q$),
    'category,content,created_at,id,title:0');
  PERFORM pg_temp.expect('others see that it is hidden',
    pg_temp.as_member(3, $q$SELECT public.community_post_state(pg_temp.id(29))$q$), 'hidden');
  PERFORM pg_temp.expect('pin through the chain',
    pg_temp.mutate(owner, 902, 'set_post_pinned', jsonb_build_object('post_id', pg_temp.id(21), 'pinned', true)), '{"success": true}');

  -- restore_content: back in the list, counted in the audit, replayed once.
  PERFORM pg_temp.expect('restore',
    pg_temp.mutate(operator, 903, 'restore_content', jsonb_build_object('target_type', 'post', 'target_id', pg_temp.id(29), 'reason', 'Scenario restore')),
    '{"data": {"ok": true, "affected": 1}}');
  PERFORM pg_temp.expect('restore replayed',
    pg_temp.mutate(operator, 903, 'restore_content', jsonb_build_object('target_type', 'post', 'target_id', pg_temp.id(29), 'reason', 'Scenario restore')),
    '{"data": {"ok": true, "affected": 1}}');
  PERFORM pg_temp.expect('restored topic',
    (SELECT status || ':' || (SELECT count(*) FROM public.admin_audit_log WHERE event_kind = 'content_restored' AND target_id = pg_temp.id(29))
       FROM public.posts WHERE id = pg_temp.id(29)), 'active:1');
  PERFORM pg_temp.expect('restore of a visible topic',
    pg_temp.mutate(operator, 904, 'restore_content', jsonb_build_object('target_type', 'post', 'target_id', pg_temp.id(29), 'reason', 'Scenario restore')),
    'refused:content_not_found');

  -- set_post_locked: nobody replies to a closed topic; it reopens.
  PERFORM pg_temp.expect('lock',
    pg_temp.mutate(operator, 905, 'set_post_locked', jsonb_build_object('post_id', pg_temp.id(29), 'locked', true, 'reason', 'Scenario lock')), '{"success": true}');
  BEGIN
    PERFORM pg_temp.as_member(3, $q$INSERT INTO public.post_comments(post_id,user_id,content) VALUES(pg_temp.id(29),auth.uid(),'Scenario reply to a closed topic') RETURNING id$q$);
    RAISE EXCEPTION 'P3 scenario: a reply to a locked topic was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    RESET ROLE;
    IF SQLERRM <> 'post_locked' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.expect('unlock',
    pg_temp.mutate(operator, 906, 'set_post_locked', jsonb_build_object('post_id', pg_temp.id(29), 'locked', false, 'reason', 'Scenario unlock')), '{"success": true}');
  PERFORM pg_temp.expect('reply after reopening',
    (pg_temp.as_member(3, $q$INSERT INTO public.post_comments(post_id,user_id,content) VALUES(pg_temp.id(29),auth.uid(),'Scenario reply after reopening') RETURNING id$q$) IS NOT NULL)::text, 'true');

  -- set_post_category: the real topic validation still applies.
  PERFORM pg_temp.expect('move',
    pg_temp.mutate(operator, 907, 'set_post_category', jsonb_build_object('post_id', pg_temp.id(29), 'category', 'local-deals', 'reason', 'Scenario move')), '{"success": true}');
  PERFORM pg_temp.expect('moved topic', (SELECT category FROM public.posts WHERE id = pg_temp.id(29)), 'local-deals');
  PERFORM pg_temp.expect('an update has no board',
    pg_temp.mutate(operator, 908, 'set_post_category', jsonb_build_object('post_id', pg_temp.id(28), 'category', 'campus-life', 'reason', 'Scenario move')), 'refused:post_not_topic');

  -- set_post_official, E6 not done: refused by name, nothing written.
  SELECT (SELECT count(*) FROM public.admin_audit_log) + (SELECT count(*) FROM public.admin_mutation_requests) INTO written;
  PERFORM pg_temp.expect('official account not configured',
    pg_temp.mutate(owner, 909, 'set_post_official', jsonb_build_object('post_id', pg_temp.id(27), 'official', true, 'reason', 'Scenario official')),
    'refused:official_profile_not_configured');
  PERFORM pg_temp.expect('nothing written',
    ((SELECT count(*) FROM public.admin_audit_log) + (SELECT count(*) FROM public.admin_mutation_requests) - written
      + (SELECT count(*) FROM public.posts WHERE id = pg_temp.id(27) AND is_official))::text, '0');
  -- Configured: that account's posts only, and only for an owner.
  PERFORM pg_temp.expect('not the official account',
    pg_temp.mutate(owner, 910, 'set_post_official', jsonb_build_object('post_id', pg_temp.id(21), 'official', true, 'reason', 'Scenario official', 'official_profile_id', pg_temp.id(5))),
    'refused:post_not_official_account');
  PERFORM pg_temp.expect('official needs an owner',
    pg_temp.mutate(operator, 911, 'set_post_official', jsonb_build_object('post_id', pg_temp.id(27), 'official', true, 'reason', 'Scenario official', 'official_profile_id', pg_temp.id(5))),
    'refused:admin_capability_denied');
  PERFORM pg_temp.expect('official',
    pg_temp.mutate(owner, 912, 'set_post_official', jsonb_build_object('post_id', pg_temp.id(27), 'official', true, 'reason', 'Scenario official', 'official_profile_id', pg_temp.id(5))),
    '{"success": true}');

  -- set_post_featured: official posts only.
  PERFORM pg_temp.expect('featured needs an official post',
    pg_temp.mutate(owner, 913, 'set_post_featured', jsonb_build_object('post_id', pg_temp.id(21), 'featured', true, 'reason', 'Scenario featured')), 'refused:post_not_official');
  PERFORM pg_temp.expect('featured',
    pg_temp.mutate(owner, 914, 'set_post_featured', jsonb_build_object('post_id', pg_temp.id(27), 'featured', true, 'reason', 'Scenario featured')), '{"success": true}');
  PERFORM pg_temp.expect('an official, featured, pinned topic',
    (SELECT is_official::text || ':' || is_featured::text FROM public.posts WHERE id = pg_temp.id(27)), 'true:true');

  -- What the console reads back.
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.expect('moderation audit list',
    (SELECT string_agg(event_kind, ',' ORDER BY id) FROM public.admin_list_moderation_audit_log(100, 0, NULL)
      WHERE event_kind IN ('content_takedown', 'content_restored', 'post_lock_changed', 'post_category_changed', 'post_official_changed', 'post_featured_changed')
        AND actor_id = pg_temp.id(4) AND id > seeded_audit),
    'content_takedown,content_restored,post_lock_changed,post_lock_changed,post_category_changed');
  PERFORM pg_temp.expect('console topic list',
    (SELECT string_agg(right(id::text, 2) || ':' || is_official::text || ':' || is_featured::text || ':' || (locked_at IS NOT NULL)::text, ' ' ORDER BY id)
       FROM public.admin_list_community_posts(200, 0, 'active') WHERE id IN (pg_temp.id(22), pg_temp.id(27), pg_temp.id(29))),
    '22:false:false:true 27:true:true:false 29:false:false:false');
  PERFORM pg_temp.expect('console hidden list',
    (SELECT string_agg(right(id::text, 2), ',' ORDER BY id) FROM public.admin_list_community_posts(200, 0, 'hidden')
      WHERE id IN (SELECT pg_temp.id(n) FROM generate_series(21, 30) n)), '23,26');
  RESET ROLE;

  -- The report queue: longest wait first, a handled target not at all.
  INSERT INTO public.reports(reporter_id, target_type, target_id, reason, note, status, created_at) VALUES
    (pg_temp.id(3), 'post', pg_temp.id(21), 'spam', 'P3 queue', 'resolved', now() - interval '100 hours'),
    (pg_temp.id(3), 'post', pg_temp.id(22), 'spam', 'P3 queue', 'pending', now() - interval '50 hours'),
    (pg_temp.id(7), 'post', pg_temp.id(21), 'spam', 'P3 queue', 'pending', now() - interval '30 hours'),
    (pg_temp.id(3), 'post', pg_temp.id(27), 'spam', 'P3 queue', 'dismissed', now() - interval '200 hours');
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.expect('report queue',
    (SELECT string_agg(right(target_id::text, 2) || ':' || pending_count || ':' || report_count || ':' || (oldest_pending_at > first_created_at)::text, ' ' ORDER BY ordinality)
       FROM public.admin_list_report_queue(50, 0) WITH ORDINALITY WHERE last_note = 'P3 queue'),
    '22:1:1:false 21:1:2:true');
  RESET ROLE;
  RAISE NOTICE 'P3_SCENARIO|governance|PASS';
END
$governance$;

-- A reply that was hidden when the migration ran. The backfill counts visible
-- replies only, so it left the topic unanswered and last active when it was
-- posted. Restoring the reply has to answer the topic and move it forward
-- then. Otherwise the topic stays in the unanswered list with an answer on
-- it, and VERIFY, which may be run again at any time, stops on its backfill
-- check (section 8).
DO $reply_restore$
DECLARE
  operator constant text := repeat('b', 64);
  topic constant uuid := pg_temp.id(51);
  reply uuid;
  replied_at timestamptz;
BEGIN
  INSERT INTO public.posts(id,user_id,content,title,category,created_at) VALUES
   (topic,pg_temp.id(2),'P3 regression body eleven','P3 regression topic eleven','local-deals',now()-interval '2 days');
  UPDATE public.posts SET last_activity_at=created_at WHERE id=topic;
  -- Member 3 answers and the reply is taken down, both through the real chain.
  reply := pg_temp.as_member(3, $q$INSERT INTO public.post_comments(post_id,user_id,content) VALUES(pg_temp.id(51),auth.uid(),'Scenario answer that is taken down') RETURNING id$q$)::uuid;
  SELECT created_at INTO replied_at FROM public.post_comments WHERE id = reply;
  PERFORM pg_temp.expect('reply takedown through the chain',
    pg_temp.mutate(operator, 921, 'takedown_content', jsonb_build_object('target_type', 'comment', 'target_id', reply, 'reason', 'Scenario reply takedown')),
    '{"data": {"ok": true, "affected": 1}}');
  -- What the backfill wrote for a topic whose only answer was hidden.
  UPDATE public.posts SET last_activity_at=created_at, answered_at=NULL WHERE id=topic;
  PERFORM pg_temp.expect('a topic whose only answer is hidden',
    (SELECT comment_count::text || ':' || (last_activity_at = created_at)::text || ':' || (answered_at IS NULL)::text FROM public.posts WHERE id = topic),
    '0:true:true');
  PERFORM pg_temp.expect('listed as unanswered',
    (SELECT count(*)::text FROM public.search_community_posts(ARRAY['P3'], 'unanswered', 50, 0) WHERE id = topic), '1');

  PERFORM pg_temp.expect('reply restore',
    pg_temp.mutate(operator, 922, 'restore_content', jsonb_build_object('target_type', 'comment', 'target_id', reply, 'reason', 'Scenario reply restore')),
    '{"data": {"ok": true, "affected": 1}}');
  PERFORM pg_temp.expect('the restored reply answers its topic and moves it forward',
    (SELECT (SELECT status FROM public.post_comments WHERE id = reply) || ':' || comment_count::text
            || ':' || (last_activity_at = replied_at)::text || ':' || (answered_at IS NOT DISTINCT FROM replied_at)::text
       FROM public.posts WHERE id = topic),
    'active:1:true:true');
  PERFORM pg_temp.expect('no longer listed as unanswered',
    (SELECT count(*)::text FROM public.search_community_posts(ARRAY['P3'], 'unanswered', 50, 0) WHERE id = topic), '0');
  -- What section 8 of VERIFY counts, for this topic.
  PERFORM pg_temp.expect('nothing for VERIFY to stop on',
    (SELECT count(*)::text FROM public.posts AS post
      WHERE post.id = topic AND post.answered_at IS NULL AND EXISTS (
        SELECT 1 FROM public.post_comments AS answer
         WHERE answer.post_id = post.id AND answer.status = 'active' AND answer.user_id <> post.user_id)),
    '0');
  RAISE NOTICE 'P3_SCENARIO|reply-restore|PASS';
END
$reply_restore$;

ROLLBACK;
