BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.post_comments ADD COLUMN content_i18n jsonb;
GRANT SELECT(content_i18n) ON public.post_comments TO anon,authenticated;
GRANT SELECT,UPDATE(content_i18n) ON public.post_comments TO service_role;
CREATE TABLE translation_private.public_content_jobs (
 kind text NOT NULL CHECK(kind IN ('post','comment')),
 content_id uuid NOT NULL,
 revision bigint NOT NULL DEFAULT 1,
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(),
 lease uuid, lease_until timestamptz,
 last_failure text CHECK(last_failure IN ('provider_unavailable','invalid_translation')),
 PRIMARY KEY(kind,content_id)
);
ALTER TABLE translation_private.public_content_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON translation_private.public_content_jobs FROM PUBLIC,anon,authenticated;
GRANT ALL ON translation_private.public_content_jobs TO service_role;
CREATE INDEX public_content_translation_ready ON translation_private.public_content_jobs(available_at) WHERE attempts<6;

CREATE FUNCTION translation_private.sync_public_content_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE content_kind text:=CASE WHEN TG_TABLE_NAME='posts' THEN 'post' ELSE 'comment' END;
BEGIN
 IF TG_OP='DELETE' THEN
  DELETE FROM translation_private.public_content_jobs WHERE kind=content_kind AND content_id=OLD.id; RETURN OLD;
 END IF;
 IF NEW.status='active' AND translation_private.needs_english(NEW.content,NEW.content_i18n) THEN
  INSERT INTO translation_private.public_content_jobs(kind,content_id) VALUES(content_kind,NEW.id)
  ON CONFLICT(kind,content_id) DO UPDATE SET revision=public_content_jobs.revision+1,attempts=0,
   available_at=now(),lease=NULL,lease_until=NULL,last_failure=NULL;
 ELSE DELETE FROM translation_private.public_content_jobs WHERE kind=content_kind AND content_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION translation_private.sync_public_content_job() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER queue_public_post_english AFTER INSERT OR DELETE OR UPDATE OF content,content_i18n,status ON public.posts
FOR EACH ROW EXECUTE FUNCTION translation_private.sync_public_content_job();
CREATE TRIGGER queue_public_comment_english AFTER INSERT OR DELETE OR UPDATE OF content,content_i18n,status ON public.post_comments
FOR EACH ROW EXECUTE FUNCTION translation_private.sync_public_content_job();
-- Invalidate a translated comment when its source changes, including direct
-- database/API edits. Clients cannot write the server-owned translation map.
CREATE FUNCTION translation_private.invalidate_comment_english() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN IF NEW.content IS DISTINCT FROM OLD.content THEN NEW.content_i18n:=NULL; END IF; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION translation_private.invalidate_comment_english() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER invalidate_comment_english BEFORE UPDATE OF content ON public.post_comments
FOR EACH ROW EXECUTE FUNCTION translation_private.invalidate_comment_english();
-- Keep a price/metadata edit's translation, but never carry an unchanged
-- translation map across a source-text edit. Explicit authored replacements
-- are retained; missing English is then queued by the AFTER trigger.
CREATE FUNCTION translation_private.invalidate_post_english() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.content IS DISTINCT FROM OLD.content AND NEW.content_i18n IS NOT DISTINCT FROM OLD.content_i18n
 THEN NEW.content_i18n:=NULL; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION translation_private.invalidate_post_english() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER invalidate_post_english BEFORE UPDATE OF content ON public.posts
FOR EACH ROW EXECUTE FUNCTION translation_private.invalidate_post_english();
INSERT INTO translation_private.public_content_jobs(kind,content_id)
 SELECT 'post',id FROM public.posts WHERE status='active' AND translation_private.needs_english(content,content_i18n)
 UNION ALL SELECT 'comment',id FROM public.post_comments WHERE status='active' AND translation_private.needs_english(content,content_i18n);

CREATE FUNCTION public.claim_public_content_translation() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j translation_private.public_content_jobs; source_text text; token uuid:=gen_random_uuid();
BEGIN
 SELECT q.* INTO j FROM translation_private.public_content_jobs q WHERE q.attempts<6 AND q.available_at<=now()
  AND (q.lease_until IS NULL OR q.lease_until<now()) AND (
   (q.kind='post' AND EXISTS(SELECT 1 FROM public.posts p WHERE p.id=q.content_id AND p.status='active' AND moderation_private.profile_content_visible(p.user_id)))
   OR (q.kind='comment' AND EXISTS(SELECT 1 FROM public.post_comments c JOIN public.posts p ON p.id=c.post_id
     WHERE c.id=q.content_id AND c.status='active' AND p.status='active'
     AND moderation_private.profile_content_visible(c.user_id) AND moderation_private.profile_content_visible(p.user_id)))
  ) ORDER BY q.available_at,q.content_id FOR UPDATE OF q SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF j.kind='post' THEN SELECT content INTO source_text FROM public.posts WHERE id=j.content_id;
 ELSE SELECT content INTO source_text FROM public.post_comments WHERE id=j.content_id; END IF;
 UPDATE translation_private.public_content_jobs SET lease=token,lease_until=now()+interval '60 seconds',attempts=attempts+1
 WHERE kind=j.kind AND content_id=j.content_id;
 RETURN jsonb_build_object('kind',j.kind,'id',j.content_id,'content',source_text,'revision',j.revision,'lease',token);
END $$;

CREATE FUNCTION public.finish_public_content_translation(kind_in text,id_in uuid,revision_in bigint,lease_in uuid,source_in text,english_in text DEFAULT NULL,failure_in text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j translation_private.public_content_jobs; source_text text; visible boolean;
BEGIN
 -- Content -> job lock order matches the edit trigger. A late translation
 -- cannot overwrite an edited, removed or newly moderated public resource.
 IF kind_in='post' THEN
  SELECT content,status='active' AND moderation_private.profile_content_visible(user_id) INTO source_text,visible
  FROM public.posts WHERE id=id_in FOR UPDATE;
 ELSIF kind_in='comment' THEN
  SELECT c.content,c.status='active' AND p.status='active' AND moderation_private.profile_content_visible(c.user_id)
    AND moderation_private.profile_content_visible(p.user_id) INTO source_text,visible
  FROM public.post_comments c JOIN public.posts p ON p.id=c.post_id WHERE c.id=id_in FOR UPDATE OF c;
 ELSE RETURN false; END IF;
 SELECT * INTO j FROM translation_private.public_content_jobs WHERE kind=kind_in AND content_id=id_in FOR UPDATE;
 IF NOT FOUND OR j.revision<>revision_in OR j.lease IS DISTINCT FROM lease_in OR j.lease_until<now() THEN RETURN false; END IF;
 IF visible IS DISTINCT FROM true OR source_text IS DISTINCT FROM source_in THEN
  DELETE FROM translation_private.public_content_jobs WHERE kind=kind_in AND content_id=id_in; RETURN false;
 END IF;
 IF failure_in IS NOT NULL THEN
  IF failure_in NOT IN ('provider_unavailable','invalid_translation') THEN RAISE EXCEPTION 'invalid_translation_failure'; END IF;
  UPDATE translation_private.public_content_jobs SET lease=NULL,lease_until=NULL,last_failure=failure_in,
   available_at=now()+make_interval(secs=>least(21600,60*power(3,j.attempts)::integer)) WHERE kind=kind_in AND content_id=id_in;
  RETURN true;
 END IF;
 IF coalesce(btrim(english_in),'')='' OR length(english_in)>8000 OR octet_length(english_in)>32000 OR english_in~'[㐀-鿿ぁ-ヿ가-힣]'
 THEN RAISE EXCEPTION 'invalid_english_content'; END IF;
 IF kind_in='post' THEN UPDATE public.posts SET content_i18n=jsonb_set(coalesce(content_i18n,'{}'::jsonb),'{en}',to_jsonb(btrim(english_in))) WHERE id=id_in;
 ELSE UPDATE public.post_comments SET content_i18n=jsonb_build_object('en',btrim(english_in)) WHERE id=id_in; END IF;
 DELETE FROM translation_private.public_content_jobs WHERE kind=kind_in AND content_id=id_in;
 RETURN true;
END $$;
CREATE FUNCTION public.public_content_translation_status() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('pending',count(*) FILTER(WHERE attempts<6),'failed',count(*) FILTER(WHERE attempts>=6)) FROM translation_private.public_content_jobs
$$;
REVOKE ALL ON FUNCTION public.claim_public_content_translation(),public.finish_public_content_translation(text,uuid,bigint,uuid,text,text,text),public.public_content_translation_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_public_content_translation(),public.finish_public_content_translation(text,uuid,bigint,uuid,text,text,text),public.public_content_translation_status() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
