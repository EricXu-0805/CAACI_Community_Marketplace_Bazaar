-- Rollback-only regression for a disposable local PostgreSQL database.
-- Runner: python3 supabase/_ops/run_support_email_ledger_local.py
-- NEVER run on hosted staging or production.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '30s';
DO $local_only$
BEGIN
  IF current_database() <> 'support_email_ledger_regression'
     OR current_setting('port') <> '55437' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'support_email_regression_requires_disposable_local_database';
  END IF;
END;
$local_only$;

INSERT INTO public.profiles (id, nickname, email) VALUES
 ('ea110000-0000-4000-8000-000000000001','Support Owner A','a@example.test'),
 ('ea110000-0000-4000-8000-000000000002','Support Owner B','b@example.test');
INSERT INTO public.admin_tokens
  (id, token_hash, admin_id, admin_name, admin_email, role, expires_at)
VALUES
 ('ea110000-0000-4000-8000-000000000011',repeat('a',64),'ea110000-0000-4000-8000-000000000001','Support A','a@example.test','owner',now()+interval '1 day'),
 ('ea110000-0000-4000-8000-000000000012',repeat('b',64),'ea110000-0000-4000-8000-000000000002','Support B','b@example.test','owner',now()+interval '1 day'),
 ('ea110000-0000-4000-8000-000000000013',repeat('c',64),'ea110000-0000-4000-8000-000000000001','Support A2','a@example.test','owner',now()+interval '1 day'),
 ('ea110000-0000-4000-8000-000000000014',repeat('d',64),'ea110000-0000-4000-8000-000000000001','Support Op','a@example.test','operator',now()+interval '1 day'),
 ('ea110000-0000-4000-8000-000000000015',repeat('e',64),'ea110000-0000-4000-8000-000000000001','Support Sec','a@example.test','security_admin',now()+interval '1 day');

CREATE FUNCTION pg_temp.expect_error(query_text text, expected_message text)
RETURNS void LANGUAGE plpgsql AS $function$
DECLARE caught boolean := false;
BEGIN
  BEGIN EXECUTE query_text;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> expected_message THEN RAISE; END IF;
    caught := true;
  END;
  IF NOT caught THEN RAISE EXCEPTION 'expected error did not occur:%', expected_message; END IF;
END;
$function$;

SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT public.admin_support_email_status(repeat('f',64))$q$,'support_email_invalid_token');
SELECT pg_temp.expect_error($q$SELECT public.admin_support_email_status('bad')$q$,'support_email_invalid_token');
SELECT pg_temp.expect_error($q$SELECT public.admin_support_email_status(repeat('d',64))$q$,'support_email_forbidden');
SELECT pg_temp.expect_error($q$SELECT public.admin_support_email_status(repeat('e',64))$q$,'support_email_forbidden');
DO $claim_and_replay$
DECLARE result jsonb;
BEGIN
  IF public.admin_support_email_status(repeat('a',64)) <> '{"available":true}'::jsonb THEN
    RAISE EXCEPTION 'owner status unavailable';
  END IF;
  result := public.admin_support_email_claim(repeat('a',64), 'ea110000-0000-4000-8000-000000000021', repeat('1',64), 'recipient@example.test', 'A support reply');
  IF result->>'claimed' <> 'true' OR result#>>'{receipt,status}' <> 'pending'
     OR result#>'{receipt,provider_id}' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'initial claim failed:%', result;
  END IF;
  result := public.admin_support_email_claim(repeat('c',64), 'ea110000-0000-4000-8000-000000000021', repeat('1',64), 'recipient@example.test', 'A support reply');
  IF result->>'claimed' <> 'false' THEN RAISE EXCEPTION 'rotated token reclaimed request'; END IF;
END;
$claim_and_replay$;
SELECT pg_temp.expect_error($q$SELECT public.admin_support_email_claim(repeat('a',64),'ea110000-0000-4000-8000-000000000021',repeat('2',64),'recipient@example.test','A support reply')$q$,'support_email_request_conflict');
SELECT pg_temp.expect_error($q$SELECT public.admin_support_email_claim(repeat('a',64),'ea110000-0000-4000-8000-000000000021',repeat('1',64),'changed@example.test','A support reply')$q$,'support_email_request_conflict');
SELECT pg_temp.expect_error($q$SELECT public.admin_support_email_claim(repeat('a',64),'ea110000-0000-4000-8000-000000000021',repeat('1',64),'recipient@example.test','Changed subject')$q$,'support_email_request_conflict');
SELECT pg_temp.expect_error($q$SELECT public.admin_support_email_claim(repeat('b',64),'ea110000-0000-4000-8000-000000000021',repeat('1',64),'recipient@example.test','A support reply')$q$,'support_email_request_conflict');
SELECT pg_temp.expect_error($q$SELECT public.admin_support_email_receipt(repeat('b',64),'ea110000-0000-4000-8000-000000000021')$q$,'support_email_not_found');
SELECT pg_temp.expect_error($q$SELECT public.admin_support_email_finish(repeat('c',64),'ea110000-0000-4000-8000-000000000021',repeat('1',64),'sent','ea110000-0000-4000-8000-000000000099')$q$,'support_email_not_found');
SELECT pg_temp.expect_error($q$SELECT public.admin_support_email_finish(repeat('a',64),'ea110000-0000-4000-8000-000000000021',repeat('1',64),'sent','invalid-provider-id')$q$,'support_email_invalid_request');
RESET ROLE;

DO $audit_and_boundaries$
BEGIN
  IF (SELECT count(*) FROM public.admin_audit_log WHERE event_kind='support_email_claimed') <> 1
     OR (SELECT details FROM public.admin_audit_log WHERE event_kind='support_email_claimed') <>
        '{"via":"admin_support_email_claim","request_id":"ea110000-0000-4000-8000-000000000021"}'::jsonb THEN
    RAISE EXCEPTION 'claim audit missing, duplicated, or over-retaining';
  END IF;
END;
$audit_and_boundaries$;
UPDATE public.admin_support_email_requests SET created_at=now()-interval '2 days'
 WHERE request_id='ea110000-0000-4000-8000-000000000021';
SET LOCAL ROLE service_role;
DO $stale_pending_never_reclaims$
DECLARE result jsonb;
BEGIN
  result := public.admin_support_email_claim(repeat('a',64),'ea110000-0000-4000-8000-000000000021',repeat('1',64),'recipient@example.test','A support reply');
  IF result->>'claimed' <> 'false' OR result#>>'{receipt,status}' <> 'unknown' THEN
    RAISE EXCEPTION 'stale pending reclaimed:%',result;
  END IF;
END;
$stale_pending_never_reclaims$;
RESET ROLE;
UPDATE public.admin_tokens SET revoked_at=now() WHERE token_hash=repeat('a',64);
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT public.admin_support_email_claim(repeat('a',64),'ea110000-0000-4000-8000-000000000022',repeat('1',64),'recipient@example.test','A support reply')$q$,'support_email_invalid_token');
SELECT pg_temp.expect_error($q$SELECT public.admin_support_email_receipt(repeat('a',64),'ea110000-0000-4000-8000-000000000021')$q$,'support_email_invalid_token');
DO $finish_after_revocation$
DECLARE result jsonb;
BEGIN
  result := public.admin_support_email_finish(repeat('a',64),'ea110000-0000-4000-8000-000000000021',repeat('1',64),'sent','ea110000-0000-4000-8000-000000000099');
  IF result->>'status' <> 'sent' THEN RAISE EXCEPTION 'post-send revoke lost receipt'; END IF;
  IF public.admin_support_email_finish(repeat('a',64),'ea110000-0000-4000-8000-000000000021',repeat('1',64),'sent','ea110000-0000-4000-8000-000000000099') <> result THEN
    RAISE EXCEPTION 'finish replay changed result';
  END IF;
  IF public.admin_support_email_receipt(repeat('c',64),'ea110000-0000-4000-8000-000000000021') <> result THEN
    RAISE EXCEPTION 'replacement owner could not read actor receipt';
  END IF;
END;
$finish_after_revocation$;
SELECT pg_temp.expect_error($q$SELECT public.admin_support_email_finish(repeat('a',64),'ea110000-0000-4000-8000-000000000021',repeat('1',64),'failed',NULL)$q$,'support_email_request_conflict');

DO $rate_limit_spans_tokens_and_terminal_states$
DECLARE request_uuid uuid; result jsonb;
BEGIN
  FOR i IN 1..10 LOOP
    request_uuid := ('ea110000-0000-4000-8000-'||lpad((100+i)::text,12,'0'))::uuid;
    result := public.admin_support_email_claim(repeat('c',64),request_uuid,repeat('3',64),'recipient@example.test','Rate test');
    IF result->>'claimed' <> 'true' THEN RAISE EXCEPTION 'new claim failed'; END IF;
    PERFORM public.admin_support_email_finish(repeat('c',64),request_uuid,repeat('3',64),CASE WHEN i%2=0 THEN 'failed' ELSE 'unknown' END,NULL);
  END LOOP;
  result := public.admin_support_email_claim(repeat('c',64),request_uuid,repeat('3',64),'recipient@example.test','Rate test');
  IF result->>'claimed' <> 'false' THEN RAISE EXCEPTION 'rate limit replay resent'; END IF;
END;
$rate_limit_spans_tokens_and_terminal_states$;
SELECT pg_temp.expect_error($q$SELECT public.admin_support_email_claim(repeat('c',64),'ea110000-0000-4000-8000-000000000199',repeat('3',64),'recipient@example.test','Rate test')$q$,'support_email_rate_limited');
RESET ROLE;

-- Inject a real required-audit failure, then prove no durable claim remains.
CREATE FUNCTION pg_temp.fail_support_audit() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN IF NEW.event_kind='support_email_claimed' THEN RAISE EXCEPTION 'injected_audit_failure'; END IF; RETURN NEW; END;
$function$;
CREATE TRIGGER regression_fail_support_audit BEFORE INSERT ON public.admin_audit_log
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_support_audit();
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT public.admin_support_email_claim(repeat('b',64),'ea110000-0000-4000-8000-000000000200',repeat('3',64),'recipient@example.test','Audit failure')$q$,'injected_audit_failure');
RESET ROLE;
DO $audit_failure_rolls_back_claim$
BEGIN
  IF EXISTS (SELECT 1 FROM public.admin_support_email_requests WHERE request_id='ea110000-0000-4000-8000-000000000200') THEN
    RAISE EXCEPTION 'audit failure left a claim';
  END IF;
END;
$audit_failure_rolls_back_claim$;
ROLLBACK;
