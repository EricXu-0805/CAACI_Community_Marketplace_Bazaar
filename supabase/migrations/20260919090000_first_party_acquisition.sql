-- First-party campaign sessions and verified new-account cohorts. No referrer,
-- full URL, IP, fingerprint, message content or email is stored here.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='60s';
CREATE TABLE public.acquisition_visits (
 id uuid PRIMARY KEY,
 source text NOT NULL CHECK(source IN ('caaci','wechat_students','wechat_local','xiaohongshu','facebook','reddit','instagram','x','linkedin')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acquisition_message_sender_created_idx ON public.messages(sender_id,created_at);
CREATE INDEX acquisition_visits_created_at_idx ON public.acquisition_visits(created_at);
CREATE TABLE public.acquisition_accounts (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 visit_id uuid NOT NULL UNIQUE REFERENCES public.acquisition_visits(id) ON DELETE CASCADE,
 registered_at timestamptz NOT NULL,
 excluded boolean NOT NULL DEFAULT false
);
ALTER TABLE public.acquisition_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acquisition_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.acquisition_visits,public.acquisition_accounts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.acquisition_visits,public.acquisition_accounts TO service_role;
CREATE FUNCTION public.record_acquisition(visit_in uuid,source_in text,user_in uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE registered timestamptz; confirmed timestamptz; visited timestamptz;
BEGIN
 IF source_in IS NULL OR source_in NOT IN ('caaci','wechat_students','wechat_local','xiaohongshu','facebook','reddit','instagram','x','linkedin') OR visit_in IS NULL THEN
  RAISE EXCEPTION 'invalid_acquisition';
 END IF;
 -- Bounded cleanup; hourly data-retention also calls the same retention helper.
 PERFORM public.purge_acquisition();
 IF user_in IS NULL THEN
  INSERT INTO public.acquisition_visits(id,source) VALUES(visit_in,source_in) ON CONFLICT(id) DO NOTHING;
  RETURN;
 END IF;
 SELECT v.created_at INTO visited FROM public.acquisition_visits v WHERE v.id=visit_in AND v.source=source_in;
 IF visited IS NULL OR visited<now()-interval '24 hours' THEN RETURN; END IF;
 SELECT u.created_at,u.email_confirmed_at INTO registered,confirmed FROM auth.users u WHERE u.id=user_in;
 -- Existing accounts, unconfirmed signups and stale attribution cannot be
 -- counted as newly acquired. Google verified-email users use the same gate.
 IF registered IS NULL OR confirmed IS NULL OR registered<visited OR registered<now()-interval '24 hours'
    OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=user_in AND p.tos_version>='2026-09-19') THEN RETURN; END IF;
 INSERT INTO public.acquisition_accounts(user_id,visit_id,registered_at)
 VALUES(user_in,visit_in,registered) ON CONFLICT DO NOTHING;
END;
$$;
CREATE FUNCTION public.purge_acquisition() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE removed integer;
BEGIN
 DELETE FROM public.acquisition_visits WHERE id IN (
  SELECT id FROM public.acquisition_visits WHERE created_at<now()-interval '30 days' ORDER BY created_at LIMIT 500
 );
 GET DIAGNOSTICS removed=ROW_COUNT; RETURN removed;
END;
$$;
CREATE FUNCTION public.acquisition_report(days_in integer DEFAULT 7)
RETURNS TABLE(source text,visits bigint,registrations bigint,publishers bigint,contacts bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF days_in<1 OR days_in>30 OR days_in IS NULL THEN RAISE EXCEPTION 'invalid_report_window'; END IF;
 RETURN QUERY SELECT v.source,count(*),count(a.user_id),
 count(*) FILTER(WHERE a.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.items i WHERE i.user_id=a.user_id AND i.created_at>=a.registered_at AND i.status<>'deleted')),
 count(*) FILTER(WHERE a.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.messages m WHERE m.sender_id=a.user_id AND m.created_at>=a.registered_at))
 FROM public.acquisition_visits v LEFT JOIN public.acquisition_accounts a ON a.visit_id=v.id
 WHERE v.created_at>=now()-make_interval(days=>days_in) AND coalesce(a.excluded,false)=false
 GROUP BY v.source ORDER BY count(*) DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.record_acquisition(uuid,text,uuid),public.purge_acquisition(),public.acquisition_report(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_acquisition(uuid,text,uuid),public.purge_acquisition(),public.acquisition_report(integer) TO service_role;
-- Preserve the existing cron response contract while adding bounded cleanup.
ALTER FUNCTION public.run_ephemeral_data_retention() RENAME TO run_ephemeral_data_retention_before_acquisition;
CREATE FUNCTION public.run_ephemeral_data_retention()
RETURNS TABLE(edge_rate_limits_deleted integer,illini_verifications_deleted integer,wechat_media_checks_deleted integer,has_more boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous record; cleaned integer;
BEGIN
 SELECT * INTO previous FROM public.run_ephemeral_data_retention_before_acquisition();
 cleaned:=public.purge_acquisition();
 RETURN QUERY SELECT previous.edge_rate_limits_deleted,previous.illini_verifications_deleted,previous.wechat_media_checks_deleted,
  previous.has_more OR cleaned=500;
END;
$$;
REVOKE ALL ON FUNCTION public.run_ephemeral_data_retention(),public.run_ephemeral_data_retention_before_acquisition() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.run_ephemeral_data_retention() TO service_role;
COMMIT;
