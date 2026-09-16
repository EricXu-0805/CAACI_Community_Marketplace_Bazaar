-- Durable English counterparts. Only public listing copy enters this queue;
-- no account fields, private chat or drafts are sent to the translator.
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='120s';
CREATE SCHEMA IF NOT EXISTS translation_private;
REVOKE ALL ON SCHEMA translation_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA translation_private TO service_role;
CREATE TABLE IF NOT EXISTS translation_private.listing_jobs (
 item_id uuid PRIMARY KEY REFERENCES public.items(id) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 1,
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(),
 lease uuid,
 lease_until timestamptz,
 last_failure text CHECK(last_failure IN ('provider_unavailable','invalid_translation'))
);
ALTER TABLE translation_private.listing_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON translation_private.listing_jobs FROM PUBLIC,anon,authenticated;
GRANT ALL ON translation_private.listing_jobs TO service_role;
CREATE INDEX IF NOT EXISTS listing_translation_ready ON translation_private.listing_jobs(available_at,item_id) WHERE attempts<6;
CREATE OR REPLACE FUNCTION translation_private.needs_english(original_in text,map_in jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(original_in,'') ~ '[㐀-鿿ぁ-ヿ가-힣]'
 AND (coalesce(btrim(map_in->>'en'),'')='' OR (map_in->>'en') ~ '[㐀-鿿ぁ-ヿ가-힣]')
$$;
CREATE OR REPLACE FUNCTION translation_private.sync_listing_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.status='active' AND (
   translation_private.needs_english(NEW.title,NEW.title_i18n)
   OR translation_private.needs_english(NEW.description,NEW.description_i18n)
 ) THEN
   INSERT INTO translation_private.listing_jobs(item_id) VALUES(NEW.id)
   ON CONFLICT(item_id) DO UPDATE SET revision=listing_jobs.revision+1,
    attempts=0,available_at=now(),lease=NULL,lease_until=NULL,last_failure=NULL;
 ELSE DELETE FROM translation_private.listing_jobs WHERE item_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA translation_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION translation_private.needs_english(text,jsonb) TO service_role;
LOCK TABLE public.items IN SHARE ROW EXCLUSIVE MODE;
CREATE TRIGGER queue_listing_english_insert AFTER INSERT ON public.items
FOR EACH ROW EXECUTE FUNCTION translation_private.sync_listing_job();
CREATE TRIGGER queue_listing_english_update AFTER UPDATE ON public.items
FOR EACH ROW WHEN ((OLD.title,OLD.description,OLD.title_i18n,OLD.description_i18n,OLD.status)
 IS DISTINCT FROM (NEW.title,NEW.description,NEW.title_i18n,NEW.description_i18n,NEW.status))
EXECUTE FUNCTION translation_private.sync_listing_job();
INSERT INTO translation_private.listing_jobs(item_id)
SELECT id FROM public.items WHERE status='active' AND (
 translation_private.needs_english(title,title_i18n) OR translation_private.needs_english(description,description_i18n)
) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_listing_translation() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE j translation_private.listing_jobs; i public.items; token uuid:=gen_random_uuid();
BEGIN
 SELECT q.* INTO j FROM translation_private.listing_jobs q
 JOIN public.items item ON item.id=q.item_id
 WHERE q.attempts<6 AND q.available_at<=now() AND (q.lease_until IS NULL OR q.lease_until<now())
 AND item.status='active' AND moderation_private.profile_content_visible(item.user_id)
 ORDER BY q.available_at,q.item_id FOR UPDATE OF q SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO i FROM public.items WHERE id=j.item_id;
 UPDATE translation_private.listing_jobs SET lease=token,lease_until=now()+interval '60 seconds',attempts=attempts+1 WHERE item_id=j.item_id;
 RETURN jsonb_build_object('id',j.item_id,'revision',j.revision,'lease',token,
  'title',i.title,'description',coalesce(i.description,''),
  'title_needed',translation_private.needs_english(i.title,i.title_i18n),
  'description_needed',translation_private.needs_english(i.description,i.description_i18n));
END $$;
CREATE OR REPLACE FUNCTION public.finish_listing_translation(
 id_in uuid,revision_in bigint,lease_in uuid,source_title_in text,source_description_in text,
 title_in text DEFAULT NULL,description_in text DEFAULT NULL,failure_in text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE j translation_private.listing_jobs; i public.items; new_title jsonb; new_description jsonb;
BEGIN
 -- Same item -> job lock order as the write trigger; edits cannot be overwritten
 -- by a translation of an earlier revision, even when a provider returns late.
 SELECT * INTO i FROM public.items WHERE id=id_in FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO j FROM translation_private.listing_jobs WHERE item_id=id_in FOR UPDATE;
 IF NOT FOUND OR j.revision<>revision_in OR j.lease IS DISTINCT FROM lease_in OR j.lease_until<now() THEN RETURN false; END IF;
 IF i.status<>'active' OR NOT moderation_private.profile_content_visible(i.user_id)
 OR i.title IS DISTINCT FROM source_title_in OR coalesce(i.description,'') IS DISTINCT FROM source_description_in THEN
   DELETE FROM translation_private.listing_jobs WHERE item_id=id_in; RETURN false;
 END IF;
 IF failure_in IS NOT NULL THEN
   IF failure_in NOT IN ('provider_unavailable','invalid_translation') THEN RAISE EXCEPTION 'invalid_translation_failure'; END IF;
   UPDATE translation_private.listing_jobs SET lease=NULL,lease_until=NULL,last_failure=failure_in,
    available_at=now()+make_interval(secs=>least(21600,60*power(3,j.attempts)::integer)) WHERE item_id=id_in;
   RETURN true;
 END IF;
 IF translation_private.needs_english(i.title,i.title_i18n) AND (
   coalesce(btrim(title_in),'')='' OR length(title_in)>200 OR octet_length(title_in)>800 OR title_in ~ '[㐀-鿿ぁ-ヿ가-힣]'
 ) THEN RAISE EXCEPTION 'invalid_english_title'; END IF;
 IF translation_private.needs_english(i.description,i.description_i18n) AND (
   coalesce(btrim(description_in),'')='' OR length(description_in)>3000 OR octet_length(description_in)>12000 OR description_in ~ '[㐀-鿿ぁ-ヿ가-힣]'
 ) THEN RAISE EXCEPTION 'invalid_english_description'; END IF;
 new_title:=coalesce(i.title_i18n,'{}'::jsonb);
 new_description:=coalesce(i.description_i18n,'{}'::jsonb);
 IF translation_private.needs_english(i.title,i.title_i18n) THEN new_title:=jsonb_set(new_title,'{en}',to_jsonb(btrim(title_in))); END IF;
 IF translation_private.needs_english(i.description,i.description_i18n) THEN new_description:=jsonb_set(new_description,'{en}',to_jsonb(btrim(description_in))); END IF;
 UPDATE public.items SET title_i18n=new_title,description_i18n=new_description WHERE id=id_in;
 -- Successful update's AFTER trigger also removes the now-complete job.
 DELETE FROM translation_private.listing_jobs WHERE item_id=id_in;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.listing_translation_status() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('pending',count(*) FILTER(WHERE attempts<6),'failed',count(*) FILTER(WHERE attempts>=6))
 FROM translation_private.listing_jobs
$$;
REVOKE ALL ON FUNCTION public.claim_listing_translation(),public.finish_listing_translation(uuid,bigint,uuid,text,text,text,text,text),public.listing_translation_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_listing_translation(),public.finish_listing_translation(uuid,bigint,uuid,text,text,text,text,text),public.listing_translation_status() TO service_role;
