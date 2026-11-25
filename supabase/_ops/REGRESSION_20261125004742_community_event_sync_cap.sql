-- Disposable L-SQL only. Never run this write regression on a hosted database.
-- Each scenario rolls back; denied EXECUTE is checked through the catalog here.
-- Actual denied calls run only on stock PostgreSQL in community-event-sync.test.mjs.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '900s';
SET LOCAL search_path = pg_catalog, public;

CREATE FUNCTION pg_temp.key(n integer) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT 'caac1124-2026-4000-8000-' || lpad(n::text,12,'0') $$;
CREATE FUNCTION pg_temp.row(n integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'source_type','caaci','source_key',pg_temp.key(n),'organizer_name','CAACI',
    'title','Synthetic event '||n,'title_en','Synthetic event '||n,
    'summary','Synthetic description.','summary_en','Synthetic description.',
    'starts_at',now()+interval '3 days','ends_at',now()+interval '3 days 2 hours',
    'location','Synthetic hall','page_url','https://caaciorg.com/events/#synthetic-'||n,
    'registration_mode','info_only','takes_registrations',false,'registration_open',false)
$$;
CREATE FUNCTION pg_temp.apply(complete boolean, rows jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE answer jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  answer := public.apply_caaci_event_snapshot(complete, rows);
  RESET ROLE;
  RETURN answer;
END
$$;
CREATE FUNCTION pg_temp.claim(source text DEFAULT 'caaci') RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE answer boolean;
BEGIN
  SET LOCAL ROLE service_role;
  answer := public.claim_community_event_sync(source, interval '12 minutes');
  RESET ROLE;
  RETURN answer;
END
$$;
CREATE FUNCTION pg_temp.finish(outcome text, code text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE answer boolean;
BEGIN
  SET LOCAL ROLE service_role;
  answer := public.finish_community_event_sync('caaci', outcome, code);
  RESET ROLE;
  RETURN answer;
END
$$;
CREATE FUNCTION pg_temp.expect(label text, actual text, wanted text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM wanted THEN
    RAISE EXCEPTION 'CAP scenario %: got %, wanted %',label,coalesce(actual,'NULL'),wanted;
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

CREATE TEMP TABLE cap_cases(ord integer, name text, statement text);
INSERT INTO cap_cases VALUES
(1,'cap-from-32767-unavailable',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1),pg_temp.row(2)));
  UPDATE public.community_events SET availability='unavailable',missing_checks=32767,
    missing_since=now()-interval '300 days' WHERE source_key=pg_temp.key(1);
  made := pg_temp.apply(true,jsonb_build_array(pg_temp.row(2)||'{"title":"Fresh"}'::jsonb));
  PERFORM pg_temp.expect('result',made::text,'{"complete": true, "rejected": 0}');
  PERFORM pg_temp.expect('cap',(SELECT availability||':'||missing_checks FROM public.community_events
    WHERE source_key=pg_temp.key(1)),'unavailable:2');
  PERFORM pg_temp.expect('fresh row',(SELECT title FROM public.community_events
    WHERE source_key=pg_temp.key(2)),'Fresh');
$case$),
(2,'cap-from-32767-hidden',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1),pg_temp.row(2)));
  UPDATE public.community_events SET availability='hidden',hidden_reason='admin',missing_checks=32767,
    missing_since=now()-interval '300 days' WHERE source_key=pg_temp.key(1);
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(2)));
  PERFORM pg_temp.expect('hidden cap',(SELECT availability||':'||hidden_reason||':'||missing_checks
    FROM public.community_events WHERE source_key=pg_temp.key(1)),'hidden:admin:2');
$case$),
(3,'three-absences',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  PERFORM pg_temp.apply(true,'[]');
  SELECT availability||':'||missing_checks INTO walk FROM public.community_events
    WHERE source_key=pg_temp.key(1);
  PERFORM pg_temp.apply(true,'[]');
  walk := walk||','||(SELECT availability||':'||missing_checks FROM public.community_events
    WHERE source_key=pg_temp.key(1));
  PERFORM pg_temp.apply(true,'[]');
  walk := walk||','||(SELECT availability||':'||missing_checks FROM public.community_events
    WHERE source_key=pg_temp.key(1));
  PERFORM pg_temp.expect('three absences',walk,'visible:1,unavailable:2,unavailable:2');
$case$),
(4,'missing-since-kept',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  UPDATE public.community_events SET availability='unavailable',missing_checks=2,
    missing_since=now()-interval '5 days' WHERE source_key=pg_temp.key(1);
  PERFORM pg_temp.apply(true,'[]');
  PERFORM pg_temp.expect('missing since',(SELECT (missing_since=now()-interval '5 days')::text
    FROM public.community_events WHERE source_key=pg_temp.key(1)),'true');
  PERFORM pg_temp.expect('count',(SELECT missing_checks::text FROM public.community_events
    WHERE source_key=pg_temp.key(1)),'2');
$case$),
(5,'reappear-after-cap',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  UPDATE public.community_events SET availability='unavailable',missing_checks=2,
    missing_since=now()-interval '5 days' WHERE source_key=pg_temp.key(1);
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  PERFORM pg_temp.expect('reappeared',(SELECT availability||':'||missing_checks||':'||
    (missing_since IS NULL)::text FROM public.community_events WHERE source_key=pg_temp.key(1)),
    'visible:0:true');
$case$),
(6,'outside-window-untouched',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  UPDATE public.community_events SET starts_at=now()-interval '200 days 2 hours',
    ends_at=now()-interval '200 days',availability='unavailable',missing_checks=32767,
    missing_since=now()-interval '300 days' WHERE source_key=pg_temp.key(1);
  PERFORM pg_temp.apply(true,'[]');
  PERFORM pg_temp.expect('outside window',(SELECT missing_checks::text FROM public.community_events
    WHERE source_key=pg_temp.key(1)),'32767');
$case$),
(7,'partial-keeps-count',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  PERFORM pg_temp.apply(true,'[]');
  PERFORM pg_temp.apply(true,'[]');
  PERFORM pg_temp.apply(false,'[]');
  PERFORM pg_temp.expect('partial',(SELECT availability||':'||missing_checks FROM public.community_events
    WHERE source_key=pg_temp.key(1)),'unavailable:2');
$case$),
(8,'function-contract',$case$
  PERFORM pg_temp.expect('attributes',(SELECT count(*)::text FROM pg_catalog.pg_proc AS p
    WHERE p.oid IN (
      'public.claim_community_event_sync(text,interval)'::regprocedure,
      'public.apply_caaci_event_snapshot(boolean,jsonb)'::regprocedure,
      'public.finish_community_event_sync(text,text,text)'::regprocedure)
    AND NOT p.proisstrict AND p.prosecdef),'3');
  PERFORM pg_temp.expect('denied execute',(SELECT count(*)::text
    FROM unnest(ARRAY['anon','authenticated']) AS roles(role_name)
    CROSS JOIN unnest(ARRAY[
      'public.claim_community_event_sync(text,interval)',
      'public.apply_caaci_event_snapshot(boolean,jsonb)',
      'public.finish_community_event_sync(text,text,text)']) AS routines(signature)
    WHERE NOT pg_catalog.has_function_privilege(roles.role_name,routines.signature,'EXECUTE')),'6');
$case$);

CREATE TEMP TABLE cap_results(name text, passed boolean, detail text);
DO $run$
DECLARE c record; passed boolean; detail text;
BEGIN
  FOR c IN SELECT * FROM cap_cases ORDER BY ord LOOP
    passed := false;
    detail := '';
    BEGIN
      DELETE FROM public.community_event_sync_state;
      DELETE FROM public.community_events WHERE source_type='caaci';
      EXECUTE 'DO $one$ DECLARE made jsonb; before_row jsonb; walk text := ''''; BEGIN '||c.statement||' END $one$;';
      RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='cap_rollback_success';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN
      passed := true;
    WHEN OTHERS THEN
      detail := SQLSTATE||':'||SQLERRM;
    END;
    INSERT INTO cap_results VALUES(c.name,passed,detail);
    RAISE NOTICE 'CAP_CASE|%|pass=%|%',c.name,passed,detail;
  END LOOP;
END
$run$;
DO $summary$
DECLARE total integer; passed integer;
BEGIN
  SELECT count(*),count(*) FILTER (WHERE r.passed) INTO total,passed FROM cap_results AS r;
  RAISE NOTICE 'CAP_TOTAL|cases=%|pass=%|fail=%',total,passed,total-passed;
  IF total <> (SELECT count(*) FROM cap_cases) OR passed <> total THEN
    RAISE EXCEPTION 'CAP regression failed: %/%',passed,total;
  END IF;
END
$summary$;
ROLLBACK;
