-- Disposable L-SQL only: never run this write regression on a hosted database.
-- Every case, including a success, rolls back its own subtransaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '900s';
SET LOCAL search_path = pg_catalog, public;

CREATE FUNCTION pg_temp.id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('caac1122-2026-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;

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
    RAISE EXCEPTION 'MEV scenario %: got %, wanted %', label, coalesce(actual, 'NULL'), wanted;
  END IF;
END
$$;


CREATE FUNCTION pg_temp.create_sql(n integer, place text DEFAULT 'ARC', title text DEFAULT 'MEV badminton')
RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT public.create_member_event(%L,%L,%L,
    jsonb_build_object('starts_at',now()+interval '2 days','location',%L))$q$,
    pg_temp.id(n),title,'MEV event details '||n,place)
$$;
CREATE FUNCTION pg_temp.member_error(statement text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_member(1,statement);
  RETURN 'accepted';
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN SQLSTATE||':'||SQLERRM;
END
$$;
CREATE FUNCTION pg_temp.constraint_error(statement text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  constraint_name text;
BEGIN
  EXECUTE statement;
  RETURN 'accepted';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
  RETURN SQLSTATE||':'||constraint_name;
END
$$;

INSERT INTO auth.users(id,email,aud,role,raw_user_meta_data)
SELECT pg_temp.id(n),'mev-'||n||'@example.invalid','authenticated','authenticated',
  jsonb_build_object('nickname','MEV member '||n) FROM generate_series(1,4) n;
INSERT INTO public.profiles(id,nickname,email)
SELECT pg_temp.id(n),'MEV member '||n,'mev-'||n||'@example.invalid' FROM generate_series(1,4) n
ON CONFLICT (id) DO UPDATE SET nickname=excluded.nickname,email=excluded.email;
UPDATE public.profiles SET is_illini_verified=true WHERE id IN (pg_temp.id(1),pg_temp.id(2));
INSERT INTO public.admin_tokens(id,token_hash,admin_id,admin_name,admin_email,role,expires_at,revoked_at,created_by)
VALUES(pg_temp.id(91),repeat('b',64),pg_temp.id(4),'MEV Operator','mev-4@example.invalid','operator',now()+interval '30 days',NULL,pg_temp.id(4));

CREATE TEMP TABLE mev_cases(ord integer, name text, opens boolean, statement text);
INSERT INTO mev_cases VALUES
(1,'switch-default',false,$case$PERFORM pg_temp.expect('default', (SELECT enabled::text FROM private.community_member_event_config), 'false');$case$),
(2,'switch-anon',false,$case$PERFORM pg_temp.expect('anon read', pg_temp.as_anon('SELECT public.community_member_events_open()'), 'false');$case$),
(3,'switch-member',false,$case$PERFORM pg_temp.expect('member read', pg_temp.as_member(1, 'SELECT public.community_member_events_open()'), 'false');$case$),
(4,'switch-refusal-atomic',false,$case$PERFORM pg_temp.expect('closed create', pg_temp.member_error(pg_temp.create_sql(101)), 'P0001:member_events_closed');
PERFORM pg_temp.expect('closed posts', (SELECT count(*)::text FROM public.posts WHERE user_id=pg_temp.id(1)), '0');
PERFORM pg_temp.expect('closed events', (SELECT count(*)::text FROM public.community_events WHERE organizer_user_id=pg_temp.id(1)), '0');$case$),
(5,'switch-open-pair-close-cancel',true,$case$made := pg_temp.as_member(1, pg_temp.create_sql(102))::jsonb;
PERFORM pg_temp.expect('pair', (SELECT count(*)::text FROM public.posts WHERE id=pg_temp.id(102)) || ':' ||
  (SELECT count(*)::text FROM public.community_events WHERE discussion_post_id=pg_temp.id(102)), '1:1');
UPDATE private.community_member_event_config SET enabled=false WHERE singleton;
PERFORM pg_temp.expect('cancel closed', pg_temp.as_member(1, format('UPDATE public.community_events SET cancelled_at=now() WHERE id=%L RETURNING (cancelled_at IS NOT NULL)::text',made->>'event_id')), 'true');$case$),
(6,'location-leading-tab',true,$case$made := pg_temp.as_member(1, pg_temp.create_sql(103, chr(9)||'ARC'))::jsonb;
PERFORM pg_temp.expect('normalized place', (SELECT location FROM public.community_events WHERE id=(made->>'event_id')::uuid), 'ARC');$case$),
(7,'location-trailing-wide',true,$case$made := pg_temp.as_member(1, pg_temp.create_sql(103, 'ARC'||chr(12288)))::jsonb;
PERFORM pg_temp.expect('normalized place', (SELECT location FROM public.community_events WHERE id=(made->>'event_id')::uuid), 'ARC');$case$),
(8,'location-nbsp',true,$case$made := pg_temp.as_member(1, pg_temp.create_sql(103, chr(160)||'ARC'||chr(160)))::jsonb;
PERFORM pg_temp.expect('normalized place', (SELECT location FROM public.community_events WHERE id=(made->>'event_id')::uuid), 'ARC');$case$),
(9,'location-line-feed',true,$case$made := pg_temp.as_member(1, pg_temp.create_sql(103, 'Grainger'||chr(10)||'Library'))::jsonb;
PERFORM pg_temp.expect('normalized place', (SELECT location FROM public.community_events WHERE id=(made->>'event_id')::uuid), 'Grainger Library');$case$),
(10,'location-line-separator',true,$case$made := pg_temp.as_member(1, pg_temp.create_sql(103, 'A'||chr(8232)||'B'))::jsonb;
PERFORM pg_temp.expect('normalized place', (SELECT location FROM public.community_events WHERE id=(made->>'event_id')::uuid), 'A B');$case$),
(11,'location-eighty',true,$case$made := pg_temp.as_member(1, pg_temp.create_sql(103, chr(12288)||repeat('x',80)||chr(12288)))::jsonb;
PERFORM pg_temp.expect('normalized place', (SELECT location FROM public.community_events WHERE id=(made->>'event_id')::uuid), repeat('x',80));$case$),
(12,'location-only-space',true,$case$PERFORM pg_temp.expect('invalid place', pg_temp.member_error(pg_temp.create_sql(104, chr(9)||chr(10)||chr(12288)||chr(160)||chr(65279))), '22023:member_event_location_invalid');$case$),
(13,'location-eighty-one',true,$case$PERFORM pg_temp.expect('invalid place', pg_temp.member_error(pg_temp.create_sql(104, repeat('x',81))), '22023:member_event_location_invalid');$case$),
(14,'title-wide',true,$case$made := pg_temp.as_member(1, pg_temp.create_sql(105, 'ARC', chr(12288)||'周六羽毛球'||chr(12288)))::jsonb;
PERFORM pg_temp.expect('normalized title', (SELECT title FROM public.posts WHERE id=pg_temp.id(105)), '周六羽毛球');$case$),
(15,'title-line-break',true,$case$made := pg_temp.as_member(1, pg_temp.create_sql(105, 'ARC', 'Saturday'||chr(10)||'badminton'))::jsonb;
PERFORM pg_temp.expect('normalized title', (SELECT title FROM public.posts WHERE id=pg_temp.id(105)), 'Saturday badminton');$case$),
(16,'constraint-place',true,$case$ALTER TABLE public.community_events DISABLE TRIGGER community_events_member_guard;
PERFORM pg_temp.expect('independent member shape', pg_temp.constraint_error(format($q$INSERT INTO public.community_events(source_type,source_key,organizer_user_id,starts_at,location,status_note,registration_mode)
 VALUES('member',%L,%L,now()+interval '1 day',chr(12288)||'ARC',NULL,'discussion')$q$,pg_temp.id(106)::text,pg_temp.id(1))), '23514:community_events_member_shape');$case$),
(17,'constraint-note',true,$case$ALTER TABLE public.community_events DISABLE TRIGGER community_events_member_guard;
PERFORM pg_temp.expect('independent member shape', pg_temp.constraint_error(format($q$INSERT INTO public.community_events(source_type,source_key,organizer_user_id,starts_at,location,status_note,registration_mode)
 VALUES('member',%L,%L,now()+interval '1 day','ARC',chr(160)||'x','discussion')$q$,pg_temp.id(106)::text,pg_temp.id(1))), '23514:community_events_member_shape');$case$),
(18,'note-normalized',true,$case$made := pg_temp.as_member(1, pg_temp.create_sql(107))::jsonb;
PERFORM pg_temp.expect('normalized note', pg_temp.as_member(1, format($q$UPDATE public.community_events SET status_note=chr(12288)||'改期'||chr(9) WHERE id=%L RETURNING status_note$q$,made->>'event_id')), '改期');$case$),
(19,'cancel-whitespace-note',true,$case$made := pg_temp.as_member(1, pg_temp.create_sql(108))::jsonb;
PERFORM pg_temp.expect('empty note', pg_temp.as_member(1, format($q$UPDATE public.community_events SET cancelled_at=now(),status_note=chr(160)||chr(65279) WHERE id=%L RETURNING (status_note IS NULL)::text$q$,made->>'event_id')), 'true');$case$),
(20,'direct-open',true,$case$PERFORM pg_temp.expect('direct open', pg_temp.member_error(format($q$INSERT INTO public.community_events(source_type,source_key,organizer_user_id,starts_at,location,registration_mode) VALUES('member',%L,%L,now()+interval '1 day','ARC','discussion')$q$,pg_temp.id(109)::text,pg_temp.id(1))), '42501:member_event_rpc_required');$case$),
(21,'direct-closed',false,$case$PERFORM pg_temp.expect('direct closed', pg_temp.member_error(format($q$INSERT INTO public.community_events(source_type,source_key,organizer_user_id,starts_at,location,registration_mode) VALUES('member',%L,%L,now()+interval '1 day','ARC','discussion')$q$,pg_temp.id(109)::text,pg_temp.id(1))), 'P0001:member_events_closed');$case$),
(22,'column-and-delete-grants',true,$case$made := pg_temp.as_member(1, pg_temp.create_sql(110))::jsonb;
PERFORM pg_temp.expect('starts_at denied', split_part(pg_temp.member_error('UPDATE public.community_events SET starts_at=now()'),':',1), '42501');
PERFORM pg_temp.expect('delete denied', split_part(pg_temp.member_error('DELETE FROM public.community_events'),':',1), '42501');$case$),
(23,'quota-visibility-delete-cancel',true,$case$made := pg_temp.as_member(1, pg_temp.create_sql(111))::jsonb;
second := pg_temp.as_member(1, pg_temp.create_sql(112))::jsonb;
PERFORM pg_temp.expect('third denied', pg_temp.member_error(pg_temp.create_sql(113)), '23514:member_event_active_limit');
PERFORM pg_temp.expect('hide event', pg_temp.mutate(repeat('b',64),901,'hide_event',jsonb_build_object('event_id',made->>'event_id','reason','Reviewed member event')), '{"success": true}');
PERFORM pg_temp.expect('hidden event holds quota', pg_temp.member_error(pg_temp.create_sql(113)), '23514:member_event_active_limit');
PERFORM pg_temp.expect('hide topic', pg_temp.mutate(repeat('b',64),902,'takedown_content',jsonb_build_object('target_type','post','target_id',pg_temp.id(112),'reason','Reviewed member topic')), '{"data": {"ok": true, "affected": 1}}');
PERFORM pg_temp.expect('hidden topic holds quota', pg_temp.member_error(pg_temp.create_sql(113)), '23514:member_event_active_limit');
PERFORM pg_temp.as_member(1,format('DELETE FROM public.posts WHERE id=%L RETURNING id',pg_temp.id(111)));
PERFORM pg_temp.as_member(1,pg_temp.create_sql(113));
PERFORM pg_temp.as_member(1,format('UPDATE public.community_events SET cancelled_at=now() WHERE id=%L RETURNING id',second->>'event_id'));
PERFORM pg_temp.as_member(1,pg_temp.create_sql(114));
PERFORM pg_temp.expect('two active after release', (SELECT count(*)::text FROM public.community_events WHERE organizer_user_id=pg_temp.id(1) AND cancelled_at IS NULL AND discussion_post_id IS NOT NULL), '2');$case$),
(24,'posting-hour-limit',true,$case$FOR n IN 1..10 LOOP
  PERFORM pg_temp.as_member(1,format('INSERT INTO public.posts(id,user_id,content) VALUES(%L,%L,%L) RETURNING id',pg_temp.id(200+n),pg_temp.id(1),'MEV ordinary topic '||n));
END LOOP;
PERFORM pg_temp.expect('hour limit', pg_temp.member_error(pg_temp.create_sql(211)), 'P0001:rate_limit_posts_hour');
PERFORM pg_temp.expect('no partial pair', (SELECT count(*)::text FROM public.posts WHERE user_id=pg_temp.id(1))||':'||
  (SELECT count(*)::text FROM public.community_events WHERE organizer_user_id=pg_temp.id(1)), '10:0');$case$),
(25,'account-deletion-order',true,$case$made := pg_temp.as_member(2,pg_temp.create_sql(115))::jsonb;
-- api/auth/delete-account.js prepares the deletion, sweeps Storage, deletes
-- Auth, sweeps again, then retires the WeChat credential. These fixtures have
-- neither stored objects nor a WeChat credential; the two sweeps are empty.
SET LOCAL ROLE service_role;
second := public.admin_prepare_account_deletion(pg_temp.id(2));
RESET ROLE;
PERFORM pg_temp.expect('deletion ready',second->>'ready','true');
UPDATE public.account_deletion_jobs SET stage='storage_deleted',updated_at=now(),last_error=NULL
 WHERE user_id=pg_temp.id(2) AND stage='requested';
DELETE FROM auth.users WHERE id=pg_temp.id(2);
UPDATE public.account_deletion_jobs SET stage='auth_deleted',updated_at=now(),last_error=NULL
 WHERE user_id=pg_temp.id(2) AND stage='storage_deleted';
UPDATE public.account_deletion_jobs SET stage='completed',updated_at=now(),last_error=NULL,completed_at=now(),wechat_openid=NULL
 WHERE user_id=pg_temp.id(2) AND stage='auth_deleted';
PERFORM pg_temp.expect('deleted member events',(SELECT count(*)::text FROM public.community_events WHERE organizer_user_id=pg_temp.id(2)),'0');
PERFORM pg_temp.expect('anon list after deletion',pg_temp.as_anon(format('SELECT count(*)::text FROM public.list_community_events() WHERE organizer_user_id=%L',pg_temp.id(2))),'0');
PERFORM pg_temp.expect('member list after deletion',pg_temp.as_member(1,format('SELECT count(*)::text FROM public.list_community_events() WHERE organizer_user_id=%L',pg_temp.id(2))),'0');$case$);
INSERT INTO mev_cases VALUES
(26,'location-only-zero-width',true,$case$PERFORM pg_temp.expect('invisible place',
  pg_temp.member_error(pg_temp.create_sql(116,chr(8203))), '22023:member_event_location_invalid');$case$),
(27,'reserved-location-zero-width',true,$case$PERFORM pg_temp.expect('reserved place',
  pg_temp.member_error(pg_temp.create_sql(116,'hos'||chr(8203)||'ted by')), '23514:member_event_reserved_wording');$case$),
(28,'reserved-title-zero-width',true,$case$PERFORM pg_temp.expect('reserved title',
  pg_temp.member_error(pg_temp.create_sql(116,'ARC','hos'||chr(8203)||'ted by')), '23514:member_event_reserved_wording');$case$),
(29,'reserved-note-zero-width',true,$case$made := pg_temp.as_member(1,pg_temp.create_sql(116))::jsonb;
PERFORM pg_temp.expect('reserved note',pg_temp.member_error(format(
  'UPDATE public.community_events SET status_note=%L WHERE id=%L RETURNING id',
  'hos'||chr(8203)||'ted by',made->>'event_id')), '23514:member_event_reserved_wording');$case$),
(30,'reserved-chinese-title-zero-width',true,$case$PERFORM pg_temp.expect('reserved Chinese title',
  pg_temp.member_error(pg_temp.create_sql(116,'ARC','官'||chr(8203)||'方')), '23514:member_event_reserved_wording');$case$),
(31,'location-hostedby-without-space',true,$case$made := pg_temp.as_member(1,pg_temp.create_sql(116,'hosted'||chr(8203)||'by'))::jsonb;
PERFORM pg_temp.expect('nonreserved place', (SELECT location FROM public.community_events WHERE id=(made->>'event_id')::uuid), 'hostedby');$case$),
(32,'location-direction-marker',true,$case$made := pg_temp.as_member(1,pg_temp.create_sql(116,chr(8238)||'ARC'))::jsonb;
PERFORM pg_temp.expect('direction-free place', (SELECT location FROM public.community_events WHERE id=(made->>'event_id')::uuid), 'ARC');$case$),
(33,'title-keeps-emoji-joiners',true,$case$made := pg_temp.as_member(1,pg_temp.create_sql(116,'ARC',chr(128104)||chr(8205)||chr(128105)||chr(8205)||chr(128103)||' picnic'))::jsonb;
PERFORM pg_temp.expect('original emoji title', (SELECT title FROM public.posts WHERE id=pg_temp.id(116)),
  chr(128104)||chr(8205)||chr(128105)||chr(8205)||chr(128103)||' picnic');$case$),
(34,'title-only-zero-width-atomic',true,$case$PERFORM pg_temp.expect('invisible title',
  pg_temp.member_error(pg_temp.create_sql(116,'ARC',chr(8203))), '22023:public_write_boundary:post_title_size');
PERFORM pg_temp.expect('no invisible-title posts', (SELECT count(*)::text FROM public.posts WHERE user_id=pg_temp.id(1)), '0');
PERFORM pg_temp.expect('no invisible-title events', (SELECT count(*)::text FROM public.community_events WHERE organizer_user_id=pg_temp.id(1)), '0');$case$),
(35,'empty-title-control-atomic',true,$case$PERFORM pg_temp.expect('empty title',
  pg_temp.member_error(pg_temp.create_sql(116,'ARC','')), '22023:public_write_boundary:post_title_size');
PERFORM pg_temp.expect('no empty-title posts', (SELECT count(*)::text FROM public.posts WHERE user_id=pg_temp.id(1)), '0');
PERFORM pg_temp.expect('no empty-title events', (SELECT count(*)::text FROM public.community_events WHERE organizer_user_id=pg_temp.id(1)), '0');$case$),
(36,'content-link-zero-width',true,$case$PERFORM pg_temp.expect('hidden content link',
  pg_temp.member_error(format($q$SELECT public.create_member_event(%L,%L,%L,
    jsonb_build_object('starts_at',now()+interval '2 days','location','ARC'))$q$,
    pg_temp.id(116),'MEV badminton','htt'||chr(8203)||'ps://example.test')), '23514:member_event_link_not_allowed');$case$),
(37,'note-only-zero-width-is-null',true,$case$made := pg_temp.as_member(1,pg_temp.create_sql(116))::jsonb;
PERFORM pg_temp.expect('invisible note cleared',pg_temp.as_member(1,format(
  'UPDATE public.community_events SET status_note=chr(8203) WHERE id=%L RETURNING (status_note IS NULL)::text',
  made->>'event_id')), 'true');$case$),
(38,'note-keeps-visible-text-joiner',true,$case$made := pg_temp.as_member(1,pg_temp.create_sql(116))::jsonb;
PERFORM pg_temp.expect('original nonempty note',pg_temp.as_member(1,format(
  'UPDATE public.community_events SET status_note=%L WHERE id=%L RETURNING status_note',
  'Bring'||chr(8205)||' water',made->>'event_id')), 'Bring'||chr(8205)||' water');$case$);
CREATE TEMP TABLE mev_results(name text, passed boolean, detail text);
DO $run$
DECLARE
  c record;
  passed boolean;
  detail text;
BEGIN
  FOR c IN SELECT * FROM mev_cases ORDER BY ord LOOP
    passed := false;
    detail := '';
    BEGIN
      IF c.opens THEN
        UPDATE private.community_member_event_config SET enabled=true WHERE singleton;
      END IF;
      EXECUTE 'DO $one$ DECLARE made jsonb; second jsonb; n integer; BEGIN '||c.statement||' END $one$;';
      RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='mev_rollback_success';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN
      passed := true;
    WHEN OTHERS THEN
      detail := SQLSTATE||':'||SQLERRM;
    END;
    INSERT INTO mev_results VALUES(c.name,passed,detail);
    RAISE NOTICE 'MEV_CASE|%|pass=%|%', c.name,passed,detail;
  END LOOP;
END
$run$;
DO $summary$
DECLARE
  passed integer;
  total integer;
BEGIN
  SELECT count(*) FILTER (WHERE r.passed),count(*) INTO passed,total FROM mev_results AS r;
  RAISE NOTICE 'MEV_TOTAL %/%',passed,total;
  IF total <> 38 OR passed <> total THEN
    RAISE EXCEPTION 'MEV regression failed: %/%',passed,total;
  END IF;
  IF (SELECT enabled FROM private.community_member_event_config WHERE singleton) THEN
    RAISE EXCEPTION 'MEV regression leaked switch state';
  END IF;
END
$summary$;
ROLLBACK;
