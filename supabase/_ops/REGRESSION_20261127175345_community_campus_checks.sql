-- Disposable L-SQL only. Never run this write regression on a hosted database.
-- Each scenario rolls back; denied EXECUTE is checked through the catalog here.
-- Actual denied calls run only on stock PostgreSQL in community-campus-checks.test.mjs.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '900s';
SET LOCAL search_path = pg_catalog, public;

INSERT INTO public.moderation_keywords(keyword) VALUES ('campuscheckblockedmarker');
CREATE FUNCTION pg_temp.id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('caac1127-2026-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.seed(n integer, starts timestamptz DEFAULT date_trunc('second',now())+interval '3 days',
  ends timestamptz DEFAULT date_trunc('second',now())+interval '3 days 2 hours', count integer DEFAULT 1)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.community_events (id,source_type,source_key,organizer_name,title_en,starts_at,ends_at,
    occurrence_count,page_url,registration_mode,location)
  VALUES (pg_temp.id(n),'campus','3715/'||(90000000+n),'Synthetic calendar','Synthetic campus gathering '||n,
    starts,ends,count,'https://calendars.illinois.edu/detail/3715/'||(90000000+n),'calendar_page','Synthetic public hall')
$$;
CREATE FUNCTION pg_temp.row(starts timestamptz, ends timestamptz, extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('title_en','Synthetic campus gathering','starts_at',starts,'ends_at',ends,'all_day',false,
    'occurrence_count',1,'location','Synthetic public hall','source_updated_at',now(),'content_hash',repeat('a',64),
    'review_flag',NULL) || extra
$$;
CREATE FUNCTION pg_temp.check(n integer, outcome text, payload jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE target uuid := pg_temp.id(n); answer jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  answer := public.apply_campus_event_check(target, outcome, payload);
  RESET ROLE;
  RETURN answer;
END
$$;
CREATE FUNCTION pg_temp.claim(n integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE answer jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  answer := public.claim_campus_event_checks(n);
  RESET ROLE;
  RETURN coalesce((SELECT string_agg(item.value->>'source_key', ',' ORDER BY item.ordinality)
    FROM jsonb_array_elements(answer) WITH ORDINALITY AS item), '');
END
$$;
CREATE FUNCTION pg_temp.read(n integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE target uuid := pg_temp.id(n); answer text;
BEGIN
  SET LOCAL ROLE anon;
  answer := coalesce((public.community_campus_event_checked_at(target) = now())::text, 'null');
  RESET ROLE;
  RETURN answer;
END
$$;
CREATE FUNCTION pg_temp.state(n integer) RETURNS text LANGUAGE sql AS $$
  SELECT availability||':'||missing_checks FROM public.community_events WHERE id = pg_temp.id(n)
$$;
CREATE FUNCTION pg_temp.expect(label text, actual text, wanted text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM wanted THEN
    RAISE EXCEPTION 'CAMPUS scenario %: got %, wanted %',label,coalesce(actual,'NULL'),wanted;
  END IF;
END
$$;
CREATE FUNCTION pg_temp.error(statement text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RETURN 'accepted';
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN SQLSTATE;
END
$$;

CREATE TEMP TABLE campus_cases(ord integer, name text, statement text);
INSERT INTO campus_cases VALUES
(1,'claim-order-lease',$case$
  PERFORM pg_temp.seed(1);
  PERFORM pg_temp.seed(2);
  PERFORM pg_temp.seed(3);
  PERFORM pg_temp.seed(4,date_trunc('second',now())-interval '2 hours',date_trunc('second',now())-interval '1 minute');
  PERFORM pg_temp.seed(5);
  PERFORM pg_temp.seed(6);
  UPDATE public.community_events SET availability='unavailable',missing_checks=2,
    missing_since=now()-interval '1 day' WHERE id=pg_temp.id(2);
  UPDATE public.community_events SET availability='hidden',hidden_reason='admin' WHERE id=pg_temp.id(3);
  UPDATE public.community_events SET last_checked_at=now()-interval '6 hours 1 second' WHERE id=pg_temp.id(5);
  UPDATE public.community_events SET last_checked_at=now()-interval '6 hours' WHERE id=pg_temp.id(6);
  walk := pg_temp.claim(2)||'|'||pg_temp.claim(2)||'|'||pg_temp.claim(2);
  PERFORM pg_temp.expect('claims',walk,'3715/90000001,3715/90000002|3715/90000005|');
$case$),
(2,'not-found-walk',$case$
  PERFORM pg_temp.seed(1);
  made := pg_temp.check(1,'not_found');
  walk := pg_temp.state(1);
  UPDATE public.community_events SET missing_since=now()-interval '12 hours'+interval '1 second' WHERE id=pg_temp.id(1);
  made := pg_temp.check(1,'not_found');
  walk := walk||','||pg_temp.state(1);
  UPDATE public.community_events SET missing_since=now()-interval '12 hours' WHERE id=pg_temp.id(1);
  made := pg_temp.check(1,'not_found');
  walk := walk||','||pg_temp.state(1);
  made := pg_temp.check(1,'not_found');
  walk := walk||','||pg_temp.state(1);
  PERFORM pg_temp.expect('walk',walk,'visible:1,visible:1,unavailable:2,unavailable:2');
  PERFORM pg_temp.expect('last',(made->>'availability')||':'||(made->>'missing_checks')||':'||(made->>'rejected'),
    'unavailable:2:false');
$case$),
(3,'hidden-not-found',$case$
  PERFORM pg_temp.seed(1);
  UPDATE public.community_events SET availability='hidden',hidden_reason='admin',missing_checks=1,
    missing_since=now()-interval '13 hours' WHERE id=pg_temp.id(1);
  made := pg_temp.check(1,'not_found');
  PERFORM pg_temp.expect('hidden',(SELECT availability||':'||hidden_reason||':'||missing_checks
    FROM public.community_events WHERE id=pg_temp.id(1)),'hidden:admin:2');
$case$),
(4,'error-only-checked',$case$
  PERFORM pg_temp.seed(1);
  UPDATE public.community_events SET missing_checks=1,missing_since=now()-interval '1 hour' WHERE id=pg_temp.id(1);
  before_row := (SELECT to_jsonb(e)-'last_checked_at'-'updated_at' FROM public.community_events AS e
    WHERE e.id=pg_temp.id(1));
  made := pg_temp.check(1,'error');
  PERFORM pg_temp.expect('unchanged',((SELECT to_jsonb(e)-'last_checked_at'-'updated_at'
    FROM public.community_events AS e WHERE e.id=pg_temp.id(1))=before_row)::text,'true');
  PERFORM pg_temp.expect('checked',(SELECT (last_checked_at=now())::text FROM public.community_events
    WHERE id=pg_temp.id(1)),'true');
$case$),
(5,'ok-revives',$case$
  PERFORM pg_temp.seed(1);
  PERFORM pg_temp.seed(2);
  UPDATE public.community_events SET availability='unavailable',missing_checks=2,
    missing_since=now()-interval '1 day' WHERE id=pg_temp.id(1);
  UPDATE public.community_events SET availability='hidden',hidden_reason='admin' WHERE id=pg_temp.id(2);
  made := pg_temp.check(1,'ok',pg_temp.row(date_trunc('second',now())+interval '4 days',date_trunc('second',now())+interval '4 days 2 hours',
    '{"title_en":"Synthetic refreshed gathering","location":"Synthetic second hall"}'));
  made := pg_temp.check(2,'ok',pg_temp.row(date_trunc('second',now())+interval '4 days',date_trunc('second',now())+interval '4 days 2 hours',
    '{"title_en":"Synthetic refreshed gathering","location":"Synthetic second hall"}'));
  PERFORM pg_temp.expect('states',pg_temp.state(1)||','||pg_temp.state(2),'visible:0,hidden:0');
  PERFORM pg_temp.expect('refreshed',(SELECT title_en||'|'||location||'|'||organizer_name||'|'||
    (missing_since IS NULL)::text||'|'||(last_seen_at=now())::text FROM public.community_events WHERE id=pg_temp.id(1)),
    'Synthetic refreshed gathering|Synthetic second hall|Synthetic calendar|true|true');
$case$),
(6,'series-rolls',$case$
  PERFORM pg_temp.seed(1,date_trunc('second',now())-interval '1 day',date_trunc('second',now())+interval '2 days',3);
  made := pg_temp.check(1,'ok',pg_temp.row(date_trunc('second',now()),date_trunc('second',now())+interval '2 days','{"occurrence_count":3}'));
  PERFORM pg_temp.expect('series',(SELECT (previous_starts_at IS NULL)::text||':'||(schedule_changed_at IS NULL)::text||':'||
    coalesce(review_flag,'none')||':'||revision FROM public.community_events WHERE id=pg_temp.id(1)),'true:true:none:2');
$case$),
(7,'real-move-near-start',$case$
  PERFORM pg_temp.seed(1,date_trunc('second',now())+interval '5 days',date_trunc('second',now())+interval '5 days 2 hours');
  made := pg_temp.check(1,'ok',pg_temp.row(date_trunc('second',now())+interval '1 day',date_trunc('second',now())+interval '1 day 2 hours'));
  PERFORM pg_temp.expect('moved',(SELECT (previous_starts_at=date_trunc('second',now())+interval '5 days')::text||':'||review_flag
    FROM public.community_events WHERE id=pg_temp.id(1)),'true:source_time_changed_near_start');
$case$),
(8,'refused-place',$case$
  PERFORM pg_temp.seed(1);
  UPDATE public.community_events SET availability='unavailable',missing_checks=2,
    missing_since=now()-interval '1 day' WHERE id=pg_temp.id(1);
  made := pg_temp.check(1,'ok',pg_temp.row(date_trunc('second',now())+interval '3 days',date_trunc('second',now())+interval '3 days 2 hours',
    '{"location":"campuscheckblockedmarker"}'));
  PERFORM pg_temp.expect('refused',(made->>'availability')||':'||(made->>'missing_checks')||':'||(made->>'rejected'),
    'unavailable:2:true');
  PERFORM pg_temp.expect('kept',(SELECT location||'|'||(missing_since IS NOT NULL)::text
    FROM public.community_events WHERE id=pg_temp.id(1)),'Synthetic public hall|true');
$case$),
(9,'invalid-input',$case$
  PERFORM pg_temp.seed(1);
  walk := pg_temp.error(format('SELECT public.apply_campus_event_check(%L,%L,%L::jsonb)',pg_temp.id(1),'ok',
      pg_temp.row(date_trunc('second',now())+interval '3 days',date_trunc('second',now())+interval '3 days 2 hours','{"organizer_name":"Synthetic organizer"}')))
    ||','||pg_temp.error(format('SELECT public.apply_campus_event_check(%L,%L,NULL)',pg_temp.id(1),'gone'))
    ||','||pg_temp.error(format('SELECT public.apply_campus_event_check(%L,%L,%L::jsonb)',pg_temp.id(1),'error',
      pg_temp.row(date_trunc('second',now())+interval '3 days',date_trunc('second',now())+interval '3 days 2 hours')))
    ||','||pg_temp.error(format('SELECT public.apply_campus_event_check(%L,%L,NULL)',pg_temp.id(99),'error'))
    ||','||pg_temp.error('SELECT public.claim_campus_event_checks(3)');
  PERFORM pg_temp.expect('invalid',walk,'22023,22023,22023,22023,22023');
$case$),
(10,'detail-line',$case$
  PERFORM pg_temp.seed(1);
  PERFORM pg_temp.seed(2);
  PERFORM pg_temp.seed(3);
  PERFORM pg_temp.seed(4,date_trunc('second',now())-interval '181 days 2 hours',date_trunc('second',now())-interval '181 days');
  UPDATE public.community_events SET availability='hidden',hidden_reason='admin' WHERE id=pg_temp.id(2);
  UPDATE public.community_events SET availability='unavailable',missing_checks=2,
    missing_since=now()-interval '1 day' WHERE id=pg_temp.id(3);
  UPDATE public.community_events SET last_seen_at=now() WHERE source_type='campus';
  walk := pg_temp.read(1)||','||pg_temp.read(2)||','||pg_temp.read(3)||','||pg_temp.read(4)||','||pg_temp.read(99);
  PERFORM pg_temp.expect('detail',walk,'true,null,null,null,null');
$case$),
(11,'function-contract',$case$
  PERFORM pg_temp.expect('attributes',(SELECT count(*)::text FROM pg_catalog.pg_proc AS p
    WHERE p.oid IN (
      'public.claim_campus_event_checks(integer)'::regprocedure,
      'public.apply_campus_event_check(uuid,text,jsonb)'::regprocedure,
      'public.community_campus_event_checked_at(uuid)'::regprocedure)
    AND p.prosecdef AND NOT p.proisstrict),'3');
  PERFORM pg_temp.expect('execute',(SELECT string_agg(roles.role_name||':'||routines.label,','
      ORDER BY roles.role_name,routines.label)
    FROM unnest(ARRAY['anon','authenticated','service_role']) AS roles(role_name)
    CROSS JOIN (VALUES ('claim','public.claim_campus_event_checks(integer)'),
      ('apply','public.apply_campus_event_check(uuid,text,jsonb)'),
      ('read','public.community_campus_event_checked_at(uuid)')) AS routines(label,signature)
    WHERE pg_catalog.has_function_privilege(roles.role_name,routines.signature,'EXECUTE')),
    'anon:read,authenticated:read,service_role:apply,service_role:claim');
$case$);

CREATE TEMP TABLE campus_results(name text, passed boolean, detail text);
DO $run$
DECLARE c record; passed boolean; detail text;
BEGIN
  FOR c IN SELECT * FROM campus_cases ORDER BY ord LOOP
    passed := false;
    detail := '';
    BEGIN
      DELETE FROM public.community_event_sync_state WHERE source='campus';
      DELETE FROM public.community_events WHERE source_type='campus';
      EXECUTE 'DO $one$ DECLARE made jsonb; before_row jsonb; walk text := ''''; BEGIN '||c.statement||' END $one$;';
      RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='campus_rollback_success';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN
      passed := true;
    WHEN OTHERS THEN
      detail := SQLSTATE||':'||SQLERRM;
    END;
    INSERT INTO campus_results VALUES(c.name,passed,detail);
    RAISE NOTICE 'CAMPUS_CASE|%|pass=%|%',c.name,passed,detail;
  END LOOP;
END
$run$;
DO $summary$
DECLARE total integer; passed integer;
BEGIN
  SELECT count(*),count(*) FILTER (WHERE r.passed) INTO total,passed FROM campus_results AS r;
  RAISE NOTICE 'CAMPUS_TOTAL|cases=%|pass=%|fail=%',total,passed,total-passed;
  IF total <> (SELECT count(*) FROM campus_cases) OR passed <> total THEN
    RAISE EXCEPTION 'CAMPUS regression failed: %/%',passed,total;
  END IF;
END
$summary$;
ROLLBACK;
