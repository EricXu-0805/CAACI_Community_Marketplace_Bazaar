-- D-49 restricted account writes: rollback-only regression for
-- 20261114015420_restricted_account_writes.sql. Disposable L-SQL only
-- (RUNBOOK §5.1): it uses the real ACLs, RLS, triggers and RPCs of a full
-- replay and must never run against a hosted project.
--
-- Member 1 is put through every moderation state below while the cached
-- profiles.suspension_level column is deliberately wrong in the other
-- direction; the action log in public.suspensions is the only authority.
-- Every case runs in its own subtransaction and is rolled back, success
-- included, so quotas, duplicates and earlier answers cannot mask a later case.
-- A refused write must raise SQLSTATE P0001 with the exact
-- suspension_active:<level>:<until> text and leave every watched table as it
-- was. Storage here means SQL authorization and metadata, not HTTP or bytes.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '900s';
SET LOCAL search_path = pg_catalog, public;

CREATE FUNCTION pg_temp.id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('caac1149-2026-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.image_url() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT 'https://example12.supabase.co/storage/v1/object/public/item-images/items/' ||
 pg_temp.id(1)::text || '/old.jpg' $$;
CREATE FUNCTION pg_temp.media(n integer) RETURNS text LANGUAGE sql STABLE AS
$$ SELECT 'items/' || pg_temp.id(1)::text || '/' || pg_temp.id(31)::text || '/' ||
 pg_temp.id(n)::text || '.jpg' $$;
CREATE FUNCTION pg_temp.video(n integer) RETURNS text LANGUAGE sql STABLE AS
$$ SELECT 'items/' || pg_temp.id(1)::text || '/' || pg_temp.id(31)::text || '/' ||
 pg_temp.id(n)::text || '.mp4' $$;

-- Catalog evidence for the report: stored bodies and guard attachments as they
-- are when this file runs (before the migration on a baseline run, after it on
-- a full run).
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
            'make_offer', 'respond_to_offer', 'propose_meetup', 'respond_to_meetup',
            'reschedule_accepted_meetup', 'submit_transaction_rating',
            'enforce_chat_block_boundary', 'trg_enforce_actor', 'is_posting_allowed',
            'get_my_profile'))
       OR (n.nspname = 'private' AND p.proname IN (
            'chat_media_access', 'current_account_storage_writes_allowed',
            'enforce_restricted_account_write', 'assert_current_account_posting_allowed'))
       OR (n.nspname = 'moderation_private' AND p.proname IN (
            'current_profile_state', 'assert_posting_allowed'))
    ORDER BY 1
  LOOP
    RAISE NOTICE 'D49_BODY|%|%|owner=%|secdef=%|%|%',
      r.signature, r.body_md5, r.owner, r.secdef, r.config, r.acl;
  END LOOP;
  FOR r IN
    SELECT t.tgrelid::regclass::text AS relation, t.tgname::text AS name,
           t.tgfoid::regprocedure::text AS routine, t.tgtype::integer AS kind,
           t.tgenabled::text AS enabled
    FROM pg_trigger AS t
    WHERE NOT t.tgisinternal
      AND (left(t.tgname::text, 3) = 'aa_' OR left(t.tgname::text, 14) = 'enforce_actor_')
    ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'D49_GUARD_TRIGGER|%|%|%|type=%|enabled=%',
      r.relation, r.name, r.routine, r.kind, r.enabled;
  END LOOP;
  FOR r IN
    SELECT p.polname::text AS name, p.polpermissive AS permissive, p.polcmd::text AS command
    FROM pg_policy AS p
    WHERE p.polrelid = 'storage.objects'::regclass
    ORDER BY 1
  LOOP
    RAISE NOTICE 'D49_STORAGE_POLICY|%|permissive=%|cmd=%', r.name, r.permissive, r.command;
  END LOOP;
END
$evidence$;

-- Seed every piece of user-authored evidence while the accounts are eligible.
INSERT INTO auth.users(id,email,aud,role,raw_user_meta_data)
SELECT pg_temp.id(n),'d49-'||n||'@example.invalid','authenticated','authenticated',
 jsonb_build_object('nickname','D49 member '||n) FROM generate_series(1,4) n;
INSERT INTO public.items(id,user_id,title,price,status,negotiable)
SELECT pg_temp.id(n),CASE WHEN n=12 THEN pg_temp.id(2) ELSE pg_temp.id(1) END,
 'D49 desk '||n,40,CASE WHEN n=13 THEN 'reserved' ELSE 'active' END::public.item_status,true
FROM generate_series(11,16) n;
INSERT INTO public.posts(id,user_id,content) VALUES
 (pg_temp.id(21),pg_temp.id(1),'D49 original post'),(pg_temp.id(22),pg_temp.id(2),'D49 peer post');
INSERT INTO public.post_comments(id,post_id,user_id,content,content_i18n) VALUES
 (pg_temp.id(23),pg_temp.id(21),pg_temp.id(1),'D49 original comment','{"en":"Original"}'),
 (pg_temp.id(24),pg_temp.id(22),pg_temp.id(2),'D49 peer comment','{"en":"Peer"}');
INSERT INTO public.conversations(id,item_id,buyer_id,seller_id,last_message_at)
SELECT pg_temp.id(c),pg_temp.id(i),pg_temp.id(2),pg_temp.id(1),now()-interval '1 day'
FROM (VALUES (31,11),(32,13),(33,16),(34,14),(35,15)) v(c,i);
INSERT INTO public.offers(id,conversation_id,item_id,from_user,to_user,price,status,expires_at,created_at,updated_at)
SELECT pg_temp.id(o),pg_temp.id(c),pg_temp.id(i),pg_temp.id(2),pg_temp.id(1),30,s,
 now()+CASE WHEN o=52 THEN interval '-1 hour' ELSE interval '1 day' END,
 now()-interval '2 hours',now()-interval '2 hours'
FROM (VALUES (51,31,11,'pending'),(52,31,11,'pending'),(54,34,14,'accepted'),
 (55,34,14,'pending'),(56,35,15,'accepted')) v(o,c,i,s);
INSERT INTO public.meetups(id,conversation_id,item_id,from_user,to_user,spot,meet_at,status,expires_at)
SELECT pg_temp.id(m),pg_temp.id(c),pg_temp.id(i),pg_temp.id(2),pg_temp.id(1),'Library',
 now()+interval '2 days',s,now()+CASE WHEN m=63 THEN interval '-1 hour' ELSE interval '1 day' END
FROM (VALUES (61,31,11,'pending'),(62,32,13,'accepted'),(63,31,11,'pending')) v(m,c,i,s);
SELECT set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(1),'role','authenticated')::text,true);
SELECT public.mark_item_sold(pg_temp.id(15),pg_temp.id(56),pg_temp.id(1));
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
INSERT INTO storage.objects(bucket_id,name,metadata)
VALUES ('item-images','items/'||pg_temp.id(1)::text||'/old.jpg','{"mimetype":"image/jpeg","size":100}'),
 ('chat-media',pg_temp.media(42),'{"mimetype":"image/jpeg","size":100}'),
 ('chat-media',pg_temp.media(43),'{"mimetype":"image/jpeg","size":100}'),
 ('chat-media',pg_temp.video(44),'{"mimetype":"video/mp4","size":100}');
INSERT INTO public.messages(id,conversation_id,sender_id,content,message_type)
VALUES (pg_temp.id(41),pg_temp.id(31),pg_temp.id(2),'Old unread message','text');
-- An attachment is accepted only from its own sender.
SELECT set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(1),'role','authenticated')::text,true);
INSERT INTO public.messages(id,conversation_id,sender_id,content,message_type)
VALUES (pg_temp.id(42),pg_temp.id(31),pg_temp.id(1),pg_temp.media(42),'image');
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
INSERT INTO public.notifications(id,user_id,type,title,body)
VALUES(pg_temp.id(71),pg_temp.id(1),'system','D49 notice','Existing notice');
-- An appeal-eligible history row is available in every state, level 0 included.
INSERT INTO public.suspensions(id,profile_id,level,reason,started_at,ends_at)
VALUES(pg_temp.id(91),pg_temp.id(1),0,'D49 appeal fixture',now()-interval '3 days',now()-interval '2 days');
-- Member 3: unrestricted, but the cached columns claim a permanent level 5.
UPDATE public.profiles SET suspension_level=5,suspended_until=NULL WHERE id=pg_temp.id(3);
-- Member 4: under an active level 3 restriction, but the cached columns look clean.
INSERT INTO public.suspensions(profile_id,level,reason,started_at,ends_at)
VALUES(pg_temp.id(4),3,'D49 peer fixture',now()-interval '1 day',now()+interval '30 days');
UPDATE public.profiles SET suspension_level=0,suspended_until=NULL,shadow_banned=false WHERE id=pg_temp.id(4);

DO $fixture$
BEGIN
  IF (SELECT count(*) FROM public.profiles WHERE id IN (pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(4))) <> 4
     OR (SELECT count(*) FROM public.messages WHERE conversation_id=pg_temp.id(31)) <> 2
     OR (SELECT count(*) FROM storage.objects
         WHERE name IN ('items/'||pg_temp.id(1)::text||'/old.jpg',pg_temp.media(42),pg_temp.media(43),pg_temp.video(44))) <> 4
     OR (SELECT count(*) FROM private.item_deals WHERE item_id=pg_temp.id(15)) <> 1
     OR (SELECT status FROM public.items WHERE id=pg_temp.id(15)) <> 'sold'
     OR (SELECT onboarded_at FROM public.profiles WHERE id=pg_temp.id(1)) IS NOT NULL
     OR (SELECT nickname FROM public.profiles WHERE id=pg_temp.id(1)) <> 'D49 member 1' THEN
    RAISE EXCEPTION 'D49 fixture is incomplete';
  END IF;
  RAISE NOTICE 'D49_FIXTURE|PASS';
END
$fixture$;

CREATE TEMP TABLE d49_states(ord integer, name text PRIMARY KEY, winning smallint NOT NULL, winning_end text);
INSERT INTO d49_states VALUES
(1,'L0-none',0,NULL),
(2,'L0-active',0,NULL),
(3,'L1-finite',1,NULL),
(4,'L1-null',1,NULL),
(5,'L1-infinity',1,NULL),
(6,'L2-finite',2,'in3d'),
(7,'L2-null',2,'null'),
(8,'L2-infinity',2,'infinity'),
(9,'L3-finite',3,'in3d'),
(10,'L3-null',3,'null'),
(11,'L3-infinity',3,'infinity'),
(12,'L4-finite',4,'in3d'),
(13,'L4-null',4,'null'),
(14,'L4-infinity',4,'infinity'),
(15,'L5-finite',5,'in3d'),
(16,'L5-null',5,'null'),
(17,'L5-infinity',5,'infinity'),
(18,'L2-expired',0,NULL),
(19,'L3-expired',0,NULL),
(20,'L4-expired',0,NULL),
(21,'L5-expired',0,NULL),
(22,'L5-lifted',0,NULL),
(23,'L5-future',0,NULL),
(24,'L4-ends-this-instant',0,NULL),
(25,'L3-starts-this-instant',3,'in3d'),
(26,'overlap-expired-L5-active-L3',3,'in3d'),
(27,'overlap-expired-L5-active-L1',1,NULL),
(28,'overlap-active-L2-and-L4',4,'in3d'),
(29,'overlap-L3-finite-and-open',3,'null'),
(30,'overlap-lifted-L5-active-L2',2,'in7d');
CREATE TEMP TABLE d49_state_rows(state text NOT NULL, level smallint NOT NULL, starts text NOT NULL, ends text NOT NULL, lifted boolean NOT NULL);
INSERT INTO d49_state_rows VALUES
('L0-active',0,'day_ago','in3d',false),
('L1-finite',1,'day_ago','in3d',false),
('L1-null',1,'day_ago','null',false),
('L1-infinity',1,'day_ago','infinity',false),
('L2-finite',2,'day_ago','in3d',false),
('L2-null',2,'day_ago','null',false),
('L2-infinity',2,'day_ago','infinity',false),
('L3-finite',3,'day_ago','in3d',false),
('L3-null',3,'day_ago','null',false),
('L3-infinity',3,'day_ago','infinity',false),
('L4-finite',4,'day_ago','in3d',false),
('L4-null',4,'day_ago','null',false),
('L4-infinity',4,'day_ago','infinity',false),
('L5-finite',5,'day_ago','in3d',false),
('L5-null',5,'day_ago','null',false),
('L5-infinity',5,'day_ago','infinity',false),
('L2-expired',2,'day_ago','hour_ago',false),
('L3-expired',3,'day_ago','hour_ago',false),
('L4-expired',4,'day_ago','hour_ago',false),
('L5-expired',5,'day_ago','hour_ago',false),
('L5-lifted',5,'day_ago','in3d',true),
('L5-future',5,'tomorrow','in3d',false),
('L4-ends-this-instant',4,'day_ago','t0',false),
('L3-starts-this-instant',3,'t0','in3d',false),
('overlap-expired-L5-active-L3',3,'day_ago','in3d',false),
('overlap-expired-L5-active-L3',5,'day_ago','hour_ago',false),
('overlap-expired-L5-active-L1',1,'day_ago','in3d',false),
('overlap-expired-L5-active-L1',5,'day_ago','hour_ago',false),
('overlap-active-L2-and-L4',2,'day_ago','in7d',false),
('overlap-active-L2-and-L4',4,'day_ago','in3d',false),
('overlap-L3-finite-and-open',3,'day_ago','in3d',false),
('overlap-L3-finite-and-open',3,'day_ago','null',false),
('overlap-lifted-L5-active-L2',5,'day_ago','in3d',true),
('overlap-lifted-L5-active-L2',2,'day_ago','in7d',false);

-- blocked: an active level 2-5 restriction must refuse the action.
-- expected_error: what an account that is not refused for a restriction gets
--   instead of success (SQLSTATE, optionally followed by :message).
-- rows_expected: the action is a plain statement; its row count is the result.
CREATE TEMP TABLE d49_cases(
 name text PRIMARY KEY, blocked boolean NOT NULL, action text NOT NULL,
 after_check text, prepare text NOT NULL, role_name text NOT NULL,
 actor integer NOT NULL, rows_expected integer, expected_error text
);
INSERT INTO d49_cases VALUES
($q$B01-post$q$,true,$q$WITH x AS (INSERT INTO public.posts(user_id,content,title,category) VALUES(auth.uid(),'A new campus update','Campus probe','campus-life') RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B02-comment$q$,true,$q$WITH x AS (INSERT INTO public.post_comments(post_id,user_id,content) VALUES(pg_temp.id(21),auth.uid(),'A new campus reply') RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B02-reply$q$,true,$q$WITH x AS (INSERT INTO public.post_comments(post_id,user_id,content,parent_comment_id) VALUES(pg_temp.id(21),auth.uid(),'A reply to another reply',pg_temp.id(23)) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B03-item$q$,true,$q$WITH x AS (INSERT INTO public.items(id,user_id,title,price) VALUES(pg_temp.id(19),auth.uid(),'A new desk lamp',20) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B04-text$q$,true,$q$WITH x AS (INSERT INTO public.messages(id,conversation_id,sender_id,content) VALUES(pg_temp.id(49),pg_temp.id(31),auth.uid(),'A new message') RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B04-sticker$q$,true,$q$WITH x AS (INSERT INTO public.messages(id,conversation_id,sender_id,content) VALUES(pg_temp.id(49),pg_temp.id(31),auth.uid(),'[sticker:smile]') RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B04-image$q$,true,$q$WITH x AS (INSERT INTO public.messages(id,conversation_id,sender_id,content,message_type) VALUES(pg_temp.id(43),pg_temp.id(31),auth.uid(),pg_temp.media(43),'image') RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B04-video$q$,true,$q$WITH x AS (INSERT INTO public.messages(id,conversation_id,sender_id,content,message_type) VALUES(pg_temp.id(44),pg_temp.id(31),auth.uid(),pg_temp.video(44),'video') RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B05-item-thread$q$,true,$q$WITH x AS (INSERT INTO public.conversations(item_id,buyer_id,seller_id) VALUES(pg_temp.id(12),auth.uid(),pg_temp.id(2)) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B06-direct-thread$q$,true,$q$WITH x AS (INSERT INTO public.conversations(buyer_id,seller_id,is_direct) VALUES(auth.uid(),pg_temp.id(3),true) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B06-direct-restricted-peer$q$,true,$q$WITH x AS (INSERT INTO public.conversations(buyer_id,seller_id,is_direct) VALUES(auth.uid(),pg_temp.id(4),true) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501:conversation_unavailable'),
($q$B07-make$q$,true,$q$SELECT (public.make_offer(pg_temp.id(31),25,auth.uid(),'A fair offer')).id IS NOT NULL$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B07-accept$q$,true,$q$SELECT (public.respond_to_offer(pg_temp.id(51),'accept',auth.uid())).status='accepted'$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B07-decline$q$,true,$q$SELECT (public.respond_to_offer(pg_temp.id(51),'decline',auth.uid())).status='declined'$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B07-counter$q$,true,$q$SELECT (public.respond_to_offer(pg_temp.id(51),'counter',auth.uid(),30,'Counter')).parent_offer_id=pg_temp.id(51)$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B07-expired$q$,true,$q$SELECT (public.respond_to_offer(pg_temp.id(52),'accept',auth.uid())).status='expired'$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B08-propose$q$,true,$q$SELECT (public.propose_meetup(pg_temp.id(33),'Library',now()+interval '2 days',auth.uid(),'At the entrance')).id IS NOT NULL$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B08-accept$q$,true,$q$SELECT (public.respond_to_meetup(pg_temp.id(61),'accept',auth.uid())).status='accepted'$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B08-decline$q$,true,$q$SELECT (public.respond_to_meetup(pg_temp.id(61),'decline',auth.uid())).status='declined'$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B08-reschedule$q$,true,$q$SELECT (public.respond_to_meetup(pg_temp.id(61),'reschedule',auth.uid(),'Union',now()+interval '3 days','New time')).parent_meetup_id=pg_temp.id(61)$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B08-accepted-reschedule$q$,true,$q$SELECT (public.reschedule_accepted_meetup(pg_temp.id(62),'Union',now()+interval '3 days',auth.uid(),'New time')).parent_meetup_id=pg_temp.id(62)$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B08-expired$q$,true,$q$SELECT (public.respond_to_meetup(pg_temp.id(63),'accept',auth.uid())).status='expired'$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B09-rating$q$,true,$q$SELECT (public.submit_transaction_rating(pg_temp.id(15),pg_temp.id(2),5,'Good exchange',auth.uid())).stars=5$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B09-rating-retry$q$,true,$q$SELECT (public.submit_transaction_rating(pg_temp.id(15),pg_temp.id(2),5,'Good exchange',auth.uid())).stars=5$q$,$q$SELECT count(*)=1 FROM public.ratings WHERE item_id=pg_temp.id(15) AND rater_id=pg_temp.id(1)$q$,$q$SELECT set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);
 SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(1),'role','authenticated')::text,true);
 SELECT public.submit_transaction_rating(pg_temp.id(15),pg_temp.id(2),5,'Good exchange',pg_temp.id(1));
 SELECT set_config('request.jwt.claim.sub','',true);
 SELECT set_config('request.jwt.claims','{}',true)$q$,'authenticated',1,NULL,NULL),
($q$B10-follow$q$,true,$q$WITH x AS (INSERT INTO public.follows(follower_id,followee_id) VALUES(auth.uid(),pg_temp.id(2)) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B10-follow-replay$q$,true,$q$INSERT INTO public.follows(follower_id,followee_id) VALUES(auth.uid(),pg_temp.id(2)) ON CONFLICT DO NOTHING$q$,NULL,$q$INSERT INTO public.follows(follower_id,followee_id) VALUES(pg_temp.id(1),pg_temp.id(2))$q$,'authenticated',1,0,NULL),
($q$B11-post-like$q$,true,$q$WITH x AS (INSERT INTO public.post_likes(post_id,user_id) VALUES(pg_temp.id(22),auth.uid()) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B12-comment-like$q$,true,$q$WITH x AS (INSERT INTO public.post_comment_likes(comment_id,user_id) VALUES(pg_temp.id(24),auth.uid()) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B13-title$q$,true,$q$WITH x AS (UPDATE public.items SET title='Edited desk' WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B13-description$q$,true,$q$WITH x AS (UPDATE public.items SET description='Edited description' WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B13-price$q$,true,$q$WITH x AS (UPDATE public.items SET price=19 WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B13-images$q$,true,$q$WITH x AS (UPDATE public.items SET images=ARRAY[pg_temp.image_url()] WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B13-image_dimensions$q$,true,$q$WITH x AS (UPDATE public.items SET image_dimensions='[{"w":100,"h":100}]'::jsonb WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$SELECT set_config('request.jwt.claims','{"iss":"https://example12.supabase.co/auth/v1"}',true);
 UPDATE public.items SET images=ARRAY[pg_temp.image_url()] WHERE id=pg_temp.id(11)$q$,'authenticated',1,NULL,NULL),
($q$B13-location$q$,true,$q$WITH x AS (UPDATE public.items SET location='Urbana' WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B13-category$q$,true,$q$WITH x AS (UPDATE public.items SET category='books' WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B13-listing_details$q$,true,$q$WITH x AS (UPDATE public.items SET listing_details=NULL WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$UPDATE public.items SET category='housing',
 listing_details='{"kind":"housing","available_from":"2026-12-01","available_to":"2027-06-01","price_unit":"month","room_type":"private"}'
 WHERE id=pg_temp.id(11)$q$,'authenticated',1,NULL,NULL),
($q$B13-negotiable$q$,true,$q$WITH x AS (UPDATE public.items SET negotiable=false WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B13-condition$q$,true,$q$WITH x AS (UPDATE public.items SET condition='new' WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B13-title_i18n$q$,true,$q$WITH x AS (UPDATE public.items SET title_i18n='{"en":"Desk"}'::jsonb WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B13-description_i18n$q$,true,$q$WITH x AS (UPDATE public.items SET description_i18n='{"en":"A desk"}'::jsonb WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B13-source_lang$q$,true,$q$WITH x AS (UPDATE public.items SET source_lang='zh' WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B13-location_check_token$q$,true,$q$WITH x AS (UPDATE public.items SET location_check_token=pg_temp.id(81) WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B13-relist$q$,true,$q$WITH x AS (UPDATE public.items SET status='active' WHERE id=pg_temp.id(13) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B13-edit-and-reserve$q$,true,$q$WITH x AS (UPDATE public.items SET title='Edited and reserved',status='reserved' WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B14-post-i18n$q$,true,$q$WITH x AS (UPDATE public.posts SET content_i18n='{"en":"Updated text"}' WHERE id=pg_temp.id(21) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B15-comment-content$q$,true,$q$WITH x AS (UPDATE public.post_comments SET content='An edited reply' WHERE id=pg_temp.id(23) RETURNING 1) SELECT count(*)=1 FROM x$q$,$q$SELECT content_i18n IS NULL FROM public.post_comments WHERE id=pg_temp.id(23)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$B16-nickname$q$,true,$q$WITH x AS (UPDATE public.profiles SET nickname='New nickname' WHERE id=auth.uid() RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B16-bio$q$,true,$q$WITH x AS (UPDATE public.profiles SET bio='New biography' WHERE id=auth.uid() RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B16-status_text$q$,true,$q$WITH x AS (UPDATE public.profiles SET status_text='Available' WHERE id=auth.uid() RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B16-status_emoji$q$,true,$q$WITH x AS (UPDATE public.profiles SET status_emoji='Hi' WHERE id=auth.uid() RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B16-location$q$,true,$q$WITH x AS (UPDATE public.profiles SET location='Urbana' WHERE id=auth.uid() RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B16-avatar_url$q$,true,$q$WITH x AS (UPDATE public.profiles SET avatar_url=pg_temp.image_url() WHERE id=auth.uid() RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B16-onboarding$q$,true,$q$SELECT true FROM public.mark_onboarded('New display name','Campus',auth.uid())$q$,$q$SELECT nickname='New display name' AND onboarded_at IS NOT NULL FROM public.profiles WHERE id=pg_temp.id(1)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$B16-profile-upsert$q$,true,$q$WITH x AS (INSERT INTO public.profiles(id,nickname) VALUES(auth.uid(),'Upsert name') ON CONFLICT(id) DO UPDATE SET nickname=excluded.nickname RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B17-item-upload$q$,true,$q$WITH x AS (INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('item-images','items/'||auth.uid()::text||'/new.jpg','{"mimetype":"image/jpeg","size":100}') RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B17-item-replace$q$,true,$q$INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('item-images','items/'||auth.uid()::text||'/old.jpg','{"mimetype":"image/jpeg","size":200}')
 ON CONFLICT (bucket_id,name) DO UPDATE SET metadata=excluded.metadata$q$,NULL,$q$$q$,'authenticated',1,1,'42501'),
($q$B18-chat-upload$q$,true,$q$WITH x AS (INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('chat-media',pg_temp.media(49),pg_temp.id(49)::text,'{"mimetype":"image/jpeg","size":100}') RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B18-preflight$q$,true,$q$WITH x AS (INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('chat-media',pg_temp.media(49),'1','{"mimetype":"image/jpeg","contentLength":100}') RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$B19-attachment$q$,true,$q$WITH x AS (INSERT INTO public.post_items(post_id,item_id,display_order) VALUES(pg_temp.id(21),pg_temp.id(11),0) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$A01-reads$q$,false,$q$SELECT (SELECT count(*) FROM public.conversations WHERE id=pg_temp.id(31))=1
 AND (SELECT count(*) FROM public.posts WHERE id=pg_temp.id(21))=1
 AND (SELECT count(*) FROM public.items WHERE id=pg_temp.id(11))=1
 AND (SELECT count(*) FROM public.offers WHERE id=pg_temp.id(51))=1
 AND (SELECT count(*) FROM public.meetups WHERE id=pg_temp.id(61))=1
 AND (SELECT count(*) FROM public.messages WHERE conversation_id=pg_temp.id(31))=2
 AND (SELECT suspension_level IS NOT NULL FROM public.get_my_profile())$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$A02-view$q$,false,$q$SELECT true FROM public.increment_view_count(pg_temp.id(12))$q$,$q$SELECT view_count=1 FROM public.items WHERE id=pg_temp.id(12)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A03-delete-item$q$,false,$q$WITH x AS (DELETE FROM public.items WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,$q$SELECT item_id IS NULL FROM public.conversations WHERE id=pg_temp.id(31)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A04-delete-post$q$,false,$q$WITH x AS (DELETE FROM public.posts WHERE id=pg_temp.id(21) RETURNING 1) SELECT count(*)=1 FROM x$q$,$q$SELECT count(*)=0 FROM public.post_comments WHERE post_id=pg_temp.id(21)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A04-delete-comment$q$,false,$q$WITH x AS (DELETE FROM public.post_comments WHERE id=pg_temp.id(23) RETURNING 1) SELECT count(*)=1 FROM x$q$,$q$SELECT comment_count=0 FROM public.posts WHERE id=pg_temp.id(21)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A05-reserve$q$,false,$q$WITH x AS (UPDATE public.items SET status='reserved' WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$A06-sold$q$,false,$q$SELECT (public.mark_item_sold(pg_temp.id(14),pg_temp.id(54),auth.uid())).status='sold'$q$,$q$SELECT (SELECT count(*) FROM private.item_deals WHERE item_id=pg_temp.id(14))=1
 AND (SELECT status FROM public.offers WHERE id=pg_temp.id(55))='cancelled'$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A07-report$q$,false,$q$INSERT INTO public.reports(reporter_id,target_type,target_id,reason,note) VALUES(auth.uid(),'post',pg_temp.id(22),'other','Please review this content')$q$,$q$SELECT count(*)=1 FROM public.reports WHERE reporter_id=pg_temp.id(1) AND target_snapshot IS NOT NULL$q$,$q$$q$,'authenticated',1,1,NULL),
($q$A08-block$q$,false,$q$WITH x AS (INSERT INTO public.blocks(blocker_id,blocked_id) VALUES(auth.uid(),pg_temp.id(2)) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$A09-favorite$q$,false,$q$WITH x AS (INSERT INTO public.favorites(user_id,item_id) VALUES(auth.uid(),pg_temp.id(12)) RETURNING 1) SELECT count(*)=1 FROM x$q$,$q$SELECT favorite_count=1 FROM public.items WHERE id=pg_temp.id(12)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A10-unfollow$q$,false,$q$WITH x AS (DELETE FROM public.follows WHERE follower_id=auth.uid() AND followee_id=pg_temp.id(2) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$INSERT INTO public.follows(follower_id,followee_id) VALUES(pg_temp.id(1),pg_temp.id(2))$q$,'authenticated',1,NULL,NULL),
($q$A10-unlike-post$q$,false,$q$WITH x AS (DELETE FROM public.post_likes WHERE user_id=auth.uid() AND post_id=pg_temp.id(22) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$INSERT INTO public.post_likes(user_id,post_id) VALUES(pg_temp.id(1),pg_temp.id(22))$q$,'authenticated',1,NULL,NULL),
($q$A10-unlike-comment$q$,false,$q$WITH x AS (DELETE FROM public.post_comment_likes WHERE user_id=auth.uid() AND comment_id=pg_temp.id(24) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$INSERT INTO public.post_comment_likes(user_id,comment_id) VALUES(pg_temp.id(1),pg_temp.id(24))$q$,'authenticated',1,NULL,NULL),
($q$A11-save-search$q$,false,$q$WITH x AS (INSERT INTO public.saved_searches(user_id,keyword) VALUES(auth.uid(),'desk') RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$A12-hide$q$,false,$q$WITH x AS (INSERT INTO public.hidden_items(user_id,item_id) VALUES(auth.uid(),pg_temp.id(12)) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$A13-notification-read$q$,false,$q$WITH x AS (UPDATE public.notifications SET is_read=true WHERE id=pg_temp.id(71) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$A13-notification-delete$q$,false,$q$WITH x AS (DELETE FROM public.notifications WHERE id=pg_temp.id(71) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$A14-flags$q$,false,$q$WITH x AS (UPDATE public.conversations SET is_pinned_seller=true,is_muted_seller=true WHERE id=pg_temp.id(31) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$A14-read$q$,false,$q$SELECT true FROM public.set_conversation_read_state(pg_temp.id(31),auth.uid(),false)$q$,$q$SELECT is_read FROM public.messages WHERE id=pg_temp.id(41)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A14-archive$q$,false,$q$SELECT true FROM public.archive_conversation(pg_temp.id(31),auth.uid())$q$,$q$SELECT count(*)=1 FROM public.conversation_archives WHERE conversation_id=pg_temp.id(31) AND user_id=pg_temp.id(1)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A15-appeal$q$,false,$q$SELECT true FROM public.submit_appeal('Please review my restriction.',auth.uid(),pg_temp.id(91))$q$,$q$SELECT appeal_note='Please review my restriction.' AND appeal_submitted_at IS NOT NULL FROM public.suspensions WHERE id=pg_temp.id(91)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A16-consent-2026-07-18$q$,false,$q$SELECT true FROM public.record_consent('2026-07-18',auth.uid())$q$,$q$SELECT tos_version='2026-07-18' AND consented_at IS NOT NULL FROM public.profiles WHERE id=pg_temp.id(1)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A16-consent-2026-08-01$q$,false,$q$SELECT true FROM public.record_consent('2026-08-01',auth.uid())$q$,$q$SELECT tos_version='2026-08-01' AND consented_at IS NOT NULL FROM public.profiles WHERE id=pg_temp.id(1)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A16-consent-2026-09-03$q$,false,$q$SELECT true FROM public.record_consent('2026-09-03',auth.uid())$q$,$q$SELECT tos_version='2026-09-03' AND consented_at IS NOT NULL FROM public.profiles WHERE id=pg_temp.id(1)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A16-consent-2026-09-16$q$,false,$q$SELECT true FROM public.record_consent('2026-09-16',auth.uid())$q$,$q$SELECT tos_version='2026-09-16' AND consented_at IS NOT NULL FROM public.profiles WHERE id=pg_temp.id(1)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A16-consent-2026-09-17$q$,false,$q$SELECT true FROM public.record_consent('2026-09-17',auth.uid())$q$,$q$SELECT tos_version='2026-09-17' AND consented_at IS NOT NULL FROM public.profiles WHERE id=pg_temp.id(1)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A16-consent-2026-09-19$q$,false,$q$SELECT true FROM public.record_consent('2026-09-19',auth.uid())$q$,$q$SELECT tos_version='2026-09-19' AND consented_at IS NOT NULL FROM public.profiles WHERE id=pg_temp.id(1)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A16-onboarding-without-display-change$q$,false,$q$SELECT true FROM public.mark_onboarded((SELECT nickname FROM public.profiles WHERE id=auth.uid()),'Campus',auth.uid())$q$,$q$SELECT nickname='D49 member 1' AND onboarded_at IS NOT NULL FROM public.profiles WHERE id=pg_temp.id(1)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A18-email-language$q$,false,$q$SELECT true FROM public.set_my_email_language('en')$q$,$q$SELECT count(*)=1 FROM public.user_email_prefs WHERE user_id=pg_temp.id(1) AND lang='en'$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A20-item-media-delete$q$,false,$q$WITH x AS (DELETE FROM storage.objects WHERE bucket_id='item-images' AND name='items/'||auth.uid()::text||'/old.jpg' RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$A20-chat-media-read$q$,false,$q$SELECT count(*)=1 FROM storage.objects WHERE bucket_id='chat-media' AND name=pg_temp.media(42)$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$A20-chat-draft-delete$q$,false,$q$WITH x AS (DELETE FROM storage.objects WHERE bucket_id='chat-media' AND name=pg_temp.media(43) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$A20-referenced-media-kept$q$,false,$q$DELETE FROM storage.objects WHERE bucket_id='chat-media' AND name=pg_temp.media(42)$q$,$q$SELECT count(*)=1 FROM storage.objects WHERE name=pg_temp.media(42)$q$,$q$$q$,'authenticated',1,0,NULL),
($q$A21-fingerprint$q$,false,$q$SELECT true FROM public.record_fingerprint(repeat('a',64),'D49 local regression')$q$,$q$SELECT last_fp_hash=repeat('a',64) FROM public.profiles WHERE id=pg_temp.id(1)$q$,$q$$q$,'authenticated',1,NULL,NULL),
($q$A-content-noop$q$,false,$q$WITH x AS (UPDATE public.items SET title=title WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$A-profile-noop$q$,false,$q$WITH x AS (UPDATE public.profiles SET nickname=nickname WHERE id=auth.uid() RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',1,NULL,NULL),
($q$A-peer-view$q$,false,$q$SELECT true FROM public.increment_view_count(pg_temp.id(11))$q$,$q$SELECT view_count=1 FROM public.items WHERE id=pg_temp.id(11)$q$,$q$$q$,'authenticated',2,NULL,NULL),
($q$A-peer-favorite$q$,false,$q$WITH x AS (INSERT INTO public.favorites(user_id,item_id) VALUES(auth.uid(),pg_temp.id(11)) RETURNING 1) SELECT count(*)=1 FROM x$q$,$q$SELECT favorite_count=1 FROM public.items WHERE id=pg_temp.id(11)$q$,$q$$q$,'authenticated',2,NULL,NULL),
($q$A-peer-like$q$,false,$q$WITH x AS (INSERT INTO public.post_likes(post_id,user_id) VALUES(pg_temp.id(21),auth.uid()) RETURNING 1) SELECT count(*)=1 FROM x$q$,$q$SELECT like_count=1 FROM public.posts WHERE id=pg_temp.id(21)$q$,$q$$q$,'authenticated',2,NULL,NULL),
($q$A-peer-comment$q$,false,$q$WITH x AS (INSERT INTO public.post_comments(post_id,user_id,content) VALUES(pg_temp.id(21),auth.uid(),'A reply from the other member') RETURNING 1) SELECT count(*)=1 FROM x$q$,$q$SELECT comment_count=2 FROM public.posts WHERE id=pg_temp.id(21)$q$,$q$$q$,'authenticated',2,NULL,NULL),
($q$A-peer-follow$q$,false,$q$WITH x AS (INSERT INTO public.follows(follower_id,followee_id) VALUES(auth.uid(),pg_temp.id(1)) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'authenticated',2,NULL,NULL),
($q$A-worker-item-translation$q$,false,$q$WITH x AS (UPDATE public.items SET title_i18n='{"en":"Worker translation"}' WHERE id=pg_temp.id(11) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'service_role',1,NULL,NULL),
($q$A-worker-post-translation$q$,false,$q$WITH x AS (UPDATE public.posts SET content_i18n='{"en":"Worker translation"}' WHERE id=pg_temp.id(21) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'service_role',1,NULL,NULL),
($q$A-worker-comment-translation$q$,false,$q$WITH x AS (UPDATE public.post_comments SET content_i18n='{"en":"Worker translation"}' WHERE id=pg_temp.id(23) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'service_role',1,NULL,NULL),
($q$A-worker-storage-row$q$,false,$q$WITH x AS (INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('item-images','items/'||pg_temp.id(1)::text||'/worker.jpg','{"mimetype":"image/jpeg","size":100}') RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'service_role',1,NULL,NULL),
($q$A-worker-profile-field$q$,false,$q$WITH x AS (UPDATE public.profiles SET nickname='Service value' WHERE id=pg_temp.id(1) RETURNING 1) SELECT count(*)=1 FROM x$q$,NULL,$q$$q$,'service_role',1,NULL,NULL),
($q$ACL-post-content$q$,false,$q$UPDATE public.posts SET content='Not granted' WHERE id=pg_temp.id(21)$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$ACL-post-title$q$,false,$q$UPDATE public.posts SET title='Not granted' WHERE id=pg_temp.id(21)$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$ACL-comment-translation$q$,false,$q$UPDATE public.post_comments SET content_i18n='{}' WHERE id=pg_temp.id(23)$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$ACL-item-listing-type$q$,false,$q$UPDATE public.items SET listing_type='wanted' WHERE id=pg_temp.id(11)$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$ACL-offer-direct$q$,false,$q$UPDATE public.offers SET note='Not granted' WHERE id=pg_temp.id(51)$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$ACL-meetup-direct$q$,false,$q$UPDATE public.meetups SET note='Not granted' WHERE id=pg_temp.id(61)$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$ACL-rating-delete$q$,false,$q$DELETE FROM public.ratings WHERE item_id=pg_temp.id(15)$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501'),
($q$RPC-account-mismatch$q$,false,$q$SELECT public.make_offer(pg_temp.id(31),20,pg_temp.id(2))$q$,NULL,$q$$q$,'authenticated',1,NULL,'42501:account_changed');

-- Every table a refused write could have touched, directly or through a
-- trigger: content, counters, notifications, mail and delivery ledgers, jobs.
CREATE TEMP TABLE d49_watch AS
SELECT c.oid::regclass::text AS relation
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND (
    (n.nspname = 'public' AND c.relname IN (
      'items', 'posts', 'post_comments', 'profiles', 'messages', 'conversations',
      'conversation_archives', 'offers', 'meetups', 'ratings', 'post_likes',
      'post_comment_likes', 'follows', 'post_items', 'favorites', 'reports', 'blocks',
      'saved_searches', 'hidden_items', 'suspensions'))
    OR (n.nspname IN ('public', 'private') AND (
      c.relname LIKE '%notification%' OR c.relname LIKE '%email%' OR c.relname LIKE '%deliver%'))
    OR (n.nspname = 'private' AND c.relname IN (
      'item_deals', 'street_location_checks', 'video_moderation_jobs', 'chat_media_gc'))
    OR n.nspname = 'translation_private'
    OR (n.nspname = 'storage' AND c.relname = 'objects')
  );

DO $watch$
BEGIN
  RAISE NOTICE 'D49_WATCH|%|%', (SELECT count(*) FROM d49_watch),
    (SELECT string_agg(relation, ',' ORDER BY relation) FROM d49_watch);
END
$watch$;

CREATE FUNCTION pg_temp.effects() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  watched text;
  data jsonb;
  result jsonb := '{}';
BEGIN
  FOR watched IN SELECT relation FROM d49_watch ORDER BY 1 LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text), ''[]'') FROM %s AS x', watched)
      INTO data;
    result := result || jsonb_build_object(watched, data);
  END LOOP;
  RETURN result;
END
$$;

CREATE TEMP TABLE d49_results(state text, operation text, passed boolean, reason text, detail text);

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
  FOR s IN SELECT * FROM d49_states ORDER BY ord LOOP
    restricted := s.winning >= 2;
    RAISE NOTICE 'D49_STATE|%|effective=L%', s.name, s.winning;
    end_at := CASE s.winning_end
      WHEN 'in3d' THEN t0 + interval '3 days'
      WHEN 'in7d' THEN t0 + interval '7 days'
      WHEN 'infinity' THEN 'infinity'::timestamptz
      ELSE NULL END;
    expected := 'suspension_active:' || s.winning || ':' || CASE
      WHEN end_at IS NULL OR end_at = 'infinity'::timestamptz THEN 'permanent'
      ELSE to_char(end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END;
    FOR c IN SELECT * FROM d49_cases ORDER BY name LOOP
      passed := false; reason := 'harness'; detail := ''; observed := NULL; observed_state := NULL; got := NULL;
      BEGIN
        IF c.prepare <> '' THEN EXECUTE c.prepare; END IF;
        INSERT INTO public.suspensions(profile_id, level, reason, started_at, ends_at, lifted_at)
        SELECT pg_temp.id(1), r.level, 'D49 matrix',
          CASE r.starts WHEN 'day_ago' THEN t0 - interval '1 day' WHEN 'tomorrow' THEN t0 + interval '1 day' ELSE t0 END,
          CASE r.ends WHEN 'in3d' THEN t0 + interval '3 days' WHEN 'in7d' THEN t0 + interval '7 days'
            WHEN 'infinity' THEN 'infinity'::timestamptz WHEN 'hour_ago' THEN t0 - interval '1 hour'
            WHEN 't0' THEN t0 ELSE NULL END,
          CASE WHEN r.lifted THEN t0 - interval '1 hour' END
        FROM d49_state_rows AS r WHERE r.state = s.name;
        -- The cache lies in the opposite direction; only the action log decides.
        UPDATE public.profiles
        SET suspension_level = CASE WHEN restricted THEN 0 ELSE 5 END,
            suspended_until = CASE WHEN restricted THEN NULL ELSE t0 + interval '10 days' END,
            shadow_banned = false
        WHERE id = pg_temp.id(1);
        IF c.blocked AND restricted THEN before_effects := pg_temp.effects(); END IF;
        BEGIN
          PERFORM set_config('request.jwt.claim.sub',
            CASE WHEN c.role_name = 'service_role' THEN '' ELSE pg_temp.id(c.actor)::text END, true);
          PERFORM set_config('request.jwt.claims',
            CASE WHEN c.role_name = 'service_role' THEN '{"role":"service_role"}'
              ELSE jsonb_build_object('sub', pg_temp.id(c.actor), 'role', 'authenticated',
                'iss', 'https://example12.supabase.co/auth/v1')::text END, true);
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
        RAISE EXCEPTION USING ERRCODE = 'Z4949', MESSAGE = 'matrix rollback';
      EXCEPTION
        WHEN SQLSTATE 'Z4949' THEN NULL;
        WHEN OTHERS THEN
          passed := false; reason := 'harness'; detail := 'HARNESS:' || SQLSTATE || ':' || SQLERRM;
      END;
      INSERT INTO d49_results VALUES (s.name, c.name, passed, reason, detail);
      IF NOT passed THEN
        RAISE NOTICE 'D49_FAIL|%|%|%|%', s.name, c.name, reason, detail;
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
    FROM d49_results AS x JOIN d49_states AS s ON s.name = x.state
    GROUP BY s.ord, s.name, s.winning ORDER BY s.ord
  LOOP
    RAISE NOTICE 'D49_LEVEL|%|effective=L%|cases=%|pass=%|fail=%|accepted=%|other_error=%|side_effects=%|refused=%|wrong_result=%|harness=%',
      r.name, r.winning, r.cases, r.pass, r.fail, r.accepted, r.other_error, r.side_effects,
      r.refused, r.wrong_result, r.harness;
  END LOOP;
  FOR r IN
    SELECT x.operation, count(*) FILTER (WHERE x.passed) AS pass, count(*) FILTER (WHERE NOT x.passed) AS fail,
           coalesce(string_agg(DISTINCT x.reason, ',') FILTER (WHERE NOT x.passed), '') AS reasons
    FROM d49_results AS x GROUP BY x.operation ORDER BY x.operation
  LOOP
    RAISE NOTICE 'D49_CASE|%|pass=%|fail=%|%', r.operation, r.pass, r.fail, r.reasons;
  END LOOP;
  SELECT count(*) AS cases, count(*) FILTER (WHERE passed) AS pass, count(*) FILTER (WHERE NOT passed) AS fail,
         count(*) FILTER (WHERE reason = 'accepted') AS accepted,
         count(*) FILTER (WHERE reason = 'other_error') AS other_error,
         count(*) FILTER (WHERE reason = 'side_effects') AS side_effects,
         count(*) FILTER (WHERE reason = 'refused') AS refused,
         count(*) FILTER (WHERE reason = 'wrong_result') AS wrong_result,
         count(*) FILTER (WHERE reason = 'harness') AS harness
    INTO r FROM d49_results;
  RAISE NOTICE 'D49_TOTAL|cases=%|pass=%|fail=%|accepted=%|other_error=%|side_effects=%|refused=%|wrong_result=%|harness=%',
    r.cases, r.pass, r.fail, r.accepted, r.other_error, r.side_effects, r.refused, r.wrong_result, r.harness;
  IF r.cases <> (SELECT count(*) FROM d49_states) * (SELECT count(*) FROM d49_cases) THEN
    RAISE EXCEPTION 'D49 regression did not run every case: % results', r.cases;
  END IF;
  IF r.fail > 0 THEN
    RAISE EXCEPTION 'D49 regression failed: % of % cases', r.fail, r.cases;
  END IF;
END
$summary$;
ROLLBACK;
