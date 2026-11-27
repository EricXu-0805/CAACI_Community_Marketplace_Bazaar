-- Disposable L-SQL only. Never run this write regression on a hosted database.
-- Each scenario rolls back; denied EXECUTE is checked through the catalog here.
-- Actual denied calls run only on stock PostgreSQL in community-event-sync.test.mjs.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '900s';
SET LOCAL search_path = pg_catalog, public;

CREATE FUNCTION pg_temp.key(n integer) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT 'caac1123-2026-4000-8000-' || lpad(n::text,12,'0') $$;
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
    RAISE EXCEPTION 'SYNC scenario %: got %, wanted %',label,coalesce(actual,'NULL'),wanted;
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

-- The real moderation trigger reads the real keyword table during full replay.
INSERT INTO public.moderation_keywords(keyword) VALUES ('syncblockedmarker');
CREATE TEMP TABLE sync_cases(ord integer, name text, statement text);
INSERT INTO sync_cases VALUES
(1,'complete-upsert',$case$
  made := pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  PERFORM pg_temp.expect('result',made::text,'{"complete": true, "rejected": 0}');
  PERFORM pg_temp.expect('source data',(SELECT title||':'||organizer_name||':'||location
    FROM public.community_events WHERE source_key=pg_temp.key(1)),'Synthetic event 1:CAACI:Synthetic hall');
  PERFORM pg_temp.expect('seen',(SELECT (first_seen_at=now() AND last_seen_at=now()
    AND missing_checks=0 AND missing_since IS NULL)::text FROM public.community_events WHERE source_key=pg_temp.key(1)),'true');
$case$),
(2,'partial-upserts-without-absence',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1),pg_temp.row(2)));
  made := pg_temp.apply(false,jsonb_build_array(pg_temp.row(1)||'{"title":"Updated"}'::jsonb));
  PERFORM pg_temp.expect('result',made::text,'{"complete": false, "rejected": 0}');
  PERFORM pg_temp.expect('update',(SELECT title FROM public.community_events WHERE source_key=pg_temp.key(1)),'Updated');
  PERFORM pg_temp.expect('absent',(SELECT missing_checks::text FROM public.community_events WHERE source_key=pg_temp.key(2)),'0');
$case$),
(3,'complete-missing-twice',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  PERFORM pg_temp.apply(true,'[]');
  PERFORM pg_temp.expect('first',(SELECT availability||':'||missing_checks||':'||(missing_since=now())::text
    FROM public.community_events WHERE source_key=pg_temp.key(1)),'visible:1:true');
  PERFORM pg_temp.apply(true,'[]');
  PERFORM pg_temp.expect('second',(SELECT availability||':'||missing_checks FROM public.community_events
    WHERE source_key=pg_temp.key(1)),'unavailable:2');
$case$),
(4,'present-after-one-missing',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  PERFORM pg_temp.apply(true,'[]');
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  PERFORM pg_temp.expect('reset',(SELECT availability||':'||missing_checks||':'||(missing_since IS NULL)::text
    FROM public.community_events WHERE source_key=pg_temp.key(1)),'visible:0:true');
$case$),
(5,'unavailable-reappears-with-new-fields',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  PERFORM pg_temp.apply(true,'[]');
  PERFORM pg_temp.apply(true,'[]');
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)||'{"location":"New synthetic hall"}'::jsonb));
  PERFORM pg_temp.expect('revived',(SELECT availability||':'||missing_checks||':'||location||':'||(missing_since IS NULL)::text
    FROM public.community_events WHERE source_key=pg_temp.key(1)),'visible:0:New synthetic hall:true');
$case$),
(6,'hidden-present-stays-hidden',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  UPDATE public.community_events SET availability='hidden',hidden_reason='admin',missing_checks=1,missing_since=now()-interval '1 day'
    WHERE source_key=pg_temp.key(1);
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)||'{"title":"Updated"}'::jsonb));
  PERFORM pg_temp.expect('hidden',(SELECT availability||':'||hidden_reason||':'||missing_checks||':'||title
    FROM public.community_events WHERE source_key=pg_temp.key(1)),'hidden:admin:0:Updated');
$case$),
(7,'hidden-missing-stays-hidden',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  UPDATE public.community_events SET availability='hidden',hidden_reason='admin' WHERE source_key=pg_temp.key(1);
  PERFORM pg_temp.apply(true,'[]');
  PERFORM pg_temp.apply(true,'[]');
  PERFORM pg_temp.expect('hidden absent',(SELECT availability||':'||hidden_reason||':'||missing_checks
    FROM public.community_events WHERE source_key=pg_temp.key(1)),'hidden:admin:2');
$case$),
(8,'window-effective-end-and-exact-boundary',$case$
  PERFORM pg_temp.apply(false,jsonb_build_array(
    pg_temp.row(1)||jsonb_build_object('starts_at',now()-interval '180 days','ends_at',now()-interval '179 days 1 second'),
    pg_temp.row(2)||jsonb_build_object('starts_at',now()-interval '180 days','ends_at',now()-interval '179 days'),
    pg_temp.row(3)||jsonb_build_object('starts_at',now()-interval '179 days','ends_at',NULL),
    pg_temp.row(4)||jsonb_build_object('starts_at',now()-interval '179 days 1 second','ends_at',NULL)));
  PERFORM pg_temp.apply(true,'[]');
  PERFORM pg_temp.expect('window',(SELECT string_agg(missing_checks::text,',' ORDER BY source_key)
    FROM public.community_events WHERE source_key IN (pg_temp.key(1),pg_temp.key(2),pg_temp.key(3),pg_temp.key(4))),'0,1,1,0');
$case$),
(9,'schedule-change-near-start',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)||jsonb_build_object('starts_at',now()+interval '48 hours')));
  PERFORM pg_temp.expect('schedule',(SELECT (previous_starts_at=now()+interval '3 days'
    AND schedule_changed_at=now() AND revision=2)::text||':'||review_flag
    FROM public.community_events WHERE source_key=pg_temp.key(1)),'true:source_time_changed_near_start');
$case$),
(10,'schedule-change-outside-near-window',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)||jsonb_build_object('starts_at',now()+interval '48 hours 1 second')));
  PERFORM pg_temp.expect('schedule',(SELECT (previous_starts_at=now()+interval '3 days'
    AND revision=2 AND review_flag IS NULL)::text FROM public.community_events WHERE source_key=pg_temp.key(1)),'true');
$case$),
(11,'unchanged-schedule-keeps-revision',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  UPDATE public.community_events SET first_seen_at=now()-interval '2 days',last_seen_at=now()-interval '1 day'
    WHERE source_key=pg_temp.key(1);
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  PERFORM pg_temp.expect('unchanged',(SELECT (revision=1 AND previous_starts_at IS NULL AND schedule_changed_at IS NULL
    AND first_seen_at=now()-interval '2 days' AND last_seen_at=now())::text
    FROM public.community_events WHERE source_key=pg_temp.key(1)),'true');
$case$),
(12,'claim-absent-then-not-due',$case$
  PERFORM pg_temp.expect('first',pg_temp.claim()::text,'true');
  PERFORM pg_temp.expect('state',(SELECT (last_attempt_at=now())::text FROM public.community_event_sync_state WHERE source='caaci'),'true');
  PERFORM pg_temp.expect('second',pg_temp.claim()::text,'false');
$case$),
(13,'claim-exact-interval-refused',$case$
  INSERT INTO public.community_event_sync_state(source,last_attempt_at) VALUES('caaci',now()-interval '12 minutes');
  PERFORM pg_temp.expect('edge',pg_temp.claim()::text,'false');
$case$),
(14,'claim-older-than-interval',$case$
  INSERT INTO public.community_event_sync_state(source,last_attempt_at) VALUES('caaci',now()-interval '12 minutes 1 second');
  PERFORM pg_temp.expect('due',pg_temp.claim()::text,'true');
$case$),
(15,'claim-infinity-refused',$case$
  INSERT INTO public.community_event_sync_state(source,last_attempt_at) VALUES('caaci','infinity');
  PERFORM pg_temp.expect('stopped',pg_temp.claim()::text,'false');
$case$),
(16,'claim-null-and-campus',$case$
  INSERT INTO public.community_event_sync_state(source) VALUES('caaci');
  PERFORM pg_temp.expect('null',pg_temp.claim()::text,'true');
  PERFORM pg_temp.expect('campus',pg_temp.claim('campus')::text,'true');
$case$),
(17,'claim-invalid-source-constraint',$case$
  PERFORM pg_temp.expect('source',pg_temp.error($q$SELECT pg_temp.claim('other')$q$),'23514');
$case$),
(18,'finish-ok-writes-success',$case$
  INSERT INTO public.community_event_sync_state(source,last_attempt_at,last_success_at,last_outcome,last_error_code)
    VALUES('caaci',now()-interval '1 minute',now()-interval '1 day','failed','http_503');
  PERFORM pg_temp.expect('answer',pg_temp.finish('ok')::text,'true');
  PERFORM pg_temp.expect('state',(SELECT (last_success_at=now() AND last_attempt_at=now()-interval '1 minute'
    AND last_outcome='ok' AND last_error_code IS NULL)::text FROM public.community_event_sync_state WHERE source='caaci'),'true');
$case$),
(19,'finish-partial-writes-success-and-code',$case$
  INSERT INTO public.community_event_sync_state(source,last_attempt_at,last_success_at)
    VALUES('caaci','infinity',now()-interval '1 day');
  PERFORM pg_temp.expect('answer',pg_temp.finish('partial','rows_rejected')::text,'true');
  PERFORM pg_temp.expect('state',(SELECT (last_success_at=now() AND last_attempt_at='infinity'
    AND last_outcome='partial' AND last_error_code='rows_rejected')::text FROM public.community_event_sync_state WHERE source='caaci'),'true');
  PERFORM pg_temp.expect('still stopped',pg_temp.claim()::text,'false');
$case$),
(20,'finish-failed-preserves-success',$case$
  INSERT INTO public.community_event_sync_state(source,last_attempt_at,last_success_at)
    VALUES('caaci','infinity',now()-interval '1 day');
  PERFORM pg_temp.expect('answer',pg_temp.finish('failed','http_503')::text,'true');
  PERFORM pg_temp.expect('state',(SELECT (last_success_at=now()-interval '1 day' AND last_attempt_at='infinity'
    AND last_outcome='failed' AND last_error_code='http_503')::text FROM public.community_event_sync_state WHERE source='caaci'),'true');
$case$),
(21,'finish-absent-returns-false',$case$
  PERFORM pg_temp.expect('absent',pg_temp.finish('ok')::text,'false');
  PERFORM pg_temp.expect('no insertion',(SELECT count(*)::text FROM public.community_event_sync_state),'0');
$case$),
(22,'moderated-visible-counts-as-seen',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1),pg_temp.row(2)));
  PERFORM pg_temp.apply(true,'[]');
  made := pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)||jsonb_build_object(
    'location','syncblockedmarker','starts_at',now()+interval '1 day')));
  PERFORM pg_temp.expect('rejected',made::text,'{"complete": true, "rejected": 1}');
  PERFORM pg_temp.expect('seen',(SELECT (availability='visible' AND missing_checks=0 AND missing_since IS NULL
    AND location='Synthetic hall' AND starts_at=now()+interval '3 days' AND revision=1
    AND previous_starts_at IS NULL)::text FROM public.community_events WHERE source_key=pg_temp.key(1)),'true');
  PERFORM pg_temp.expect('other absent',(SELECT availability||':'||missing_checks FROM public.community_events
    WHERE source_key=pg_temp.key(2)),'unavailable:2');
$case$),
(23,'moderated-hidden-counts-as-seen',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  UPDATE public.community_events SET availability='hidden',hidden_reason='admin',missing_checks=1,missing_since=now()-interval '1 day'
    WHERE source_key=pg_temp.key(1);
  made := pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)||'{"location":"syncblockedmarker"}'::jsonb));
  PERFORM pg_temp.expect('rejected',made->>'rejected','1');
  PERFORM pg_temp.expect('hidden',(SELECT availability||':'||hidden_reason||':'||missing_checks||':'||(missing_since IS NULL)::text
    FROM public.community_events WHERE source_key=pg_temp.key(1)),'hidden:admin:0:true');
$case$),
(24,'moderated-unavailable-retains-all-state',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  UPDATE public.community_events SET availability='unavailable',missing_checks=4,missing_since=now()-interval '1 day'
    WHERE source_key=pg_temp.key(1);
  SELECT to_jsonb(event) INTO before_row FROM public.community_events AS event WHERE source_key=pg_temp.key(1);
  made := pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)||'{"location":"syncblockedmarker"}'::jsonb));
  PERFORM pg_temp.expect('rejected',made::text,'{"complete": true, "rejected": 1}');
  PERFORM pg_temp.expect('unchanged',(SELECT (to_jsonb(event)=before_row)::text FROM public.community_events AS event
    WHERE source_key=pg_temp.key(1)),'true');
$case$),
(25,'rejected-new-row-does-not-block-good-row',$case$
  made := pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)||'{"location":"syncblockedmarker"}'::jsonb,pg_temp.row(2)));
  PERFORM pg_temp.expect('rejected',made::text,'{"complete": true, "rejected": 1}');
  PERFORM pg_temp.expect('survivor',(SELECT string_agg(source_key,',') FROM public.community_events WHERE source_type='caaci'),pg_temp.key(2));
$case$),
(26,'bad-key-downgrades-whole-snapshot',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  PERFORM pg_temp.apply(true,'[]');
  made := pg_temp.apply(true,jsonb_build_array(pg_temp.row(2),pg_temp.row(3)||'{"source_key":"invalid"}'::jsonb));
  PERFORM pg_temp.expect('partial',made::text,'{"complete": false, "rejected": 1}');
  PERFORM pg_temp.expect('old count',(SELECT availability||':'||missing_checks FROM public.community_events
    WHERE source_key=pg_temp.key(1)),'visible:1');
  PERFORM pg_temp.expect('good row',(SELECT title FROM public.community_events WHERE source_key=pg_temp.key(2)),'Synthetic event 2');
$case$),
(27,'missing-and-uppercase-keys-downgrade',$case$
  made := pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)-'source_key',
    pg_temp.row(2)||jsonb_build_object('source_key',upper(pg_temp.key(2)))));
  PERFORM pg_temp.expect('bad keys',made::text,'{"complete": false, "rejected": 2}');
$case$),
(28,'non-caaci-row-rejected',$case$
  made := pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)||'{"source_type":"campus"}'::jsonb));
  PERFORM pg_temp.expect('source',made::text,'{"complete": true, "rejected": 1}');
  PERFORM pg_temp.expect('no row',(SELECT count(*)::text FROM public.community_events WHERE source_key=pg_temp.key(1)),'0');
$case$),
(29,'payload-cannot-set-local-fields',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)||jsonb_build_object(
    'id',pg_temp.key(999),'availability','hidden','hidden_reason','admin','missing_checks',50,
    'missing_since',now()-interval '1 year','first_seen_at',now()-interval '1 year',
    'discussion_post_id',pg_temp.key(999),'organizer_user_id',pg_temp.key(999),
    'partner_id',pg_temp.key(999),'consent_ref','injected','created_by',pg_temp.key(999),
    'cancelled_at',now(),'status_note','injected','duplicate_of',pg_temp.key(999),
    'review_flag','title_says_cancelled','revision',99,'previous_starts_at',now(),'last_checked_at',now())));
  PERFORM pg_temp.expect('whitelist',(SELECT (id<>pg_temp.key(999)::uuid AND availability='visible'
    AND hidden_reason IS NULL AND missing_checks=0 AND missing_since IS NULL AND first_seen_at=now()
    AND discussion_post_id IS NULL AND organizer_user_id IS NULL AND partner_id IS NULL AND consent_ref IS NULL
    AND created_by IS NULL AND cancelled_at IS NULL AND status_note IS NULL AND duplicate_of IS NULL
    AND review_flag IS NULL AND revision=1 AND previous_starts_at IS NULL AND last_checked_at IS NULL)::text
    FROM public.community_events WHERE source_key=pg_temp.key(1)),'true');
$case$),
(30,'unexpected-cast-error-rolls-back-entire-snapshot',$case$
  PERFORM pg_temp.apply(true,jsonb_build_array(pg_temp.row(1)));
  PERFORM pg_temp.expect('unexpected',pg_temp.error($q$
    SELECT pg_temp.apply(true,jsonb_build_array(pg_temp.row(2),
      pg_temp.row(3)||'{"starts_at":"not-a-date"}'::jsonb))$q$),'22007');
  PERFORM pg_temp.expect('atomic',(SELECT string_agg(source_key||':'||missing_checks,',' ORDER BY source_key)
    FROM public.community_events WHERE source_type='caaci'),pg_temp.key(1)||':0');
$case$),
(31,'check-and-not-null-errors-are-row-local',$case$
  made := pg_temp.apply(true,jsonb_build_array(
    pg_temp.row(1)||jsonb_build_object('starts_at',NULL),
    pg_temp.row(2)||jsonb_build_object('title',repeat('x',161)),pg_temp.row(3)));
  PERFORM pg_temp.expect('two refused',made::text,'{"complete": true, "rejected": 2}');
  PERFORM pg_temp.expect('survivor',(SELECT string_agg(source_key,',') FROM public.community_events WHERE source_type='caaci'),pg_temp.key(3));
$case$),
(32,'invalid-top-level-snapshot-refused',$case$
  PERFORM pg_temp.expect('null flag',pg_temp.error($q$SELECT pg_temp.apply(NULL,'[]')$q$),'22023');
  PERFORM pg_temp.expect('object rows',pg_temp.error($q$SELECT pg_temp.apply(true,'{}')$q$),'22023');
  PERFORM pg_temp.expect('null rows',pg_temp.error($q$SELECT pg_temp.apply(true,NULL)$q$),'22023');
$case$),
(33,'six-client-execute-privileges-denied',$case$
  PERFORM pg_temp.expect('denied',(SELECT count(*)::text
    FROM unnest(ARRAY['anon','authenticated']) AS role
    CROSS JOIN unnest(ARRAY['public.claim_community_event_sync(text,interval)',
      'public.apply_caaci_event_snapshot(boolean,jsonb)','public.finish_community_event_sync(text,text,text)']) AS signature
    WHERE NOT has_function_privilege(role,signature,'EXECUTE')),'6');
$case$),
(34,'service-has-no-direct-insert-or-update',$case$
  PERFORM pg_temp.expect('table writes',(SELECT count(*)::text
    FROM unnest(ARRAY['public.community_events','public.community_event_sync_state']) AS relation
    CROSS JOIN unnest(ARRAY['INSERT','UPDATE']) AS operation
    WHERE has_any_column_privilege('service_role',relation,operation)),'0');
$case$),
(35,'absence-is-caaci-only',$case$
  INSERT INTO public.community_events(source_type,source_key,organizer_name,title_en,starts_at,page_url,registration_mode)
    VALUES('campus','7/123','Synthetic organizer','Synthetic event',now()+interval '1 day',
      'https://calendars.illinois.edu/detail/7/123','calendar_page');
  PERFORM pg_temp.apply(true,'[]');
  PERFORM pg_temp.apply(true,'[]');
  PERFORM pg_temp.expect('other source',(SELECT availability||':'||missing_checks FROM public.community_events WHERE source_key='7/123'),'visible:0');
$case$);

CREATE TEMP TABLE sync_results(name text, passed boolean, detail text);
DO $run$
DECLARE c record; passed boolean; detail text;
BEGIN
  FOR c IN SELECT * FROM sync_cases ORDER BY ord LOOP
    passed := false;
    detail := '';
    BEGIN
      DELETE FROM public.community_event_sync_state;
      DELETE FROM public.community_events WHERE source_type='caaci';
      EXECUTE 'DO $one$ DECLARE made jsonb; before_row jsonb; BEGIN '||c.statement||' END $one$;';
      RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='sync_rollback_success';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN
      passed := true;
    WHEN OTHERS THEN
      detail := SQLSTATE||':'||SQLERRM;
    END;
    INSERT INTO sync_results VALUES(c.name,passed,detail);
    RAISE NOTICE 'SYNC_CASE|%|pass=%|%',c.name,passed,detail;
  END LOOP;
END
$run$;
DO $summary$
DECLARE total integer; passed integer;
BEGIN
  SELECT count(*),count(*) FILTER (WHERE r.passed) INTO total,passed FROM sync_results AS r;
  RAISE NOTICE 'SYNC_TOTAL|cases=%|pass=%|fail=%',total,passed,total-passed;
  IF total <> (SELECT count(*) FROM sync_cases) OR passed <> total THEN
    RAISE EXCEPTION 'SYNC regression failed: %/%',passed,total;
  END IF;
END
$summary$;
ROLLBACK;
