-- LOCAL/STAGING ONLY, synthetic accounts; every write is rolled back.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('97000000-0000-4000-8000-000000000001','street-a@example.test','{}'),
 ('97000000-0000-4000-8000-000000000002','street-b@example.test','{}');
INSERT INTO public.profiles(id,nickname) VALUES
 ('97000000-0000-4000-8000-000000000001','Street fixture A'),
 ('97000000-0000-4000-8000-000000000002','Street fixture B') ON CONFLICT(id) DO NOTHING;
INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES
 ('97000000-0000-4000-8000-000000000011','97000000-0000-4000-8000-000000000001',now(),now()),
 ('97000000-0000-4000-8000-000000000012','97000000-0000-4000-8000-000000000002',now(),now());
CREATE TEMP TABLE receipt (value jsonb);
INSERT INTO receipt SELECT public.issue_street_location_check(
 '97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000011',
 '97000000-0000-4000-8000-000000000021','Green Street, Champaign');
GRANT SELECT ON receipt TO authenticated;
SELECT set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"97000000-0000-4000-8000-000000000011"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF has_function_privilege(current_user,'public.issue_street_location_check(uuid,uuid,uuid,text)','EXECUTE')
 OR has_column_privilege(current_user,'public.items','location_verified','UPDATE')
 OR has_column_privilege(current_user,'public.items','location_checked_at','UPDATE') THEN RAISE EXCEPTION 'client_can_forge'; END IF;
END $$;
INSERT INTO public.items(id,user_id,title,description,price,category,condition,location,location_check_token)
 SELECT '97000000-0000-4000-8000-000000000021','97000000-0000-4000-8000-000000000001',
 'Street fixture desk','Synthetic test desk',20,'furniture','good','Green Street, Champaign',(value->>'token')::uuid FROM receipt;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.items WHERE id='97000000-0000-4000-8000-000000000021' AND location_verified AND location_checked_at IS NOT NULL)
 THEN RAISE EXCEPTION 'valid_receipt_not_applied'; END IF;
END $$;
UPDATE public.items SET location='Urbana manual pickup' WHERE id='97000000-0000-4000-8000-000000000021';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.items WHERE id='97000000-0000-4000-8000-000000000021' AND (location_verified OR location_checked_at IS NOT NULL))
 THEN RAISE EXCEPTION 'edit_retained_badge'; END IF;
END $$;
-- Consumed token cannot re-verify even the original item.
UPDATE public.items SET location='Green Street, Champaign',location_check_token=(SELECT (value->>'token')::uuid FROM receipt)
 WHERE id='97000000-0000-4000-8000-000000000021';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.items WHERE id='97000000-0000-4000-8000-000000000021' AND location_verified)
 THEN RAISE EXCEPTION 'receipt_replayed'; END IF; END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.items WHERE location_check_token IS NOT NULL) THEN RAISE EXCEPTION 'public_receipt_leaked'; END IF;
 IF public.issue_street_location_check('97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000012','97000000-0000-4000-8000-000000000021','Green Street, Champaign') IS NOT NULL THEN RAISE EXCEPTION 'foreign_session_accepted'; END IF;
END $$;
-- Expiry and sign-out fail closed while manual publication remains possible.
DELETE FROM receipt;
INSERT INTO receipt SELECT public.issue_street_location_check('97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000011','97000000-0000-4000-8000-000000000021','Green Street, Champaign');
UPDATE private.street_location_checks SET expires_at=now()-interval '1 second';
SET LOCAL ROLE authenticated;
UPDATE public.items SET location_check_token=(SELECT (value->>'token')::uuid FROM receipt) WHERE id='97000000-0000-4000-8000-000000000021';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.items WHERE id='97000000-0000-4000-8000-000000000021' AND location_verified) THEN RAISE EXCEPTION 'expired_accepted'; END IF; END $$;
RESET ROLE;
DELETE FROM receipt;
INSERT INTO receipt SELECT public.issue_street_location_check('97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000011','97000000-0000-4000-8000-000000000021','Green Street, Champaign');
DELETE FROM auth.sessions WHERE id='97000000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
UPDATE public.items SET location_check_token=(SELECT (value->>'token')::uuid FROM receipt) WHERE id='97000000-0000-4000-8000-000000000021';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.items WHERE id='97000000-0000-4000-8000-000000000021' AND location_verified) THEN RAISE EXCEPTION 'revoked_session_accepted'; END IF; END $$;
RESET ROLE;
ROLLBACK;
