-- Disabled until provider, privacy disclosure and real-device acceptance pass.
SET LOCAL lock_timeout='2s';
CREATE TABLE private.video_moderation_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false
);
INSERT INTO private.video_moderation_config DEFAULT VALUES;
CREATE TABLE private.video_moderation_jobs (
 path text PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 object_id uuid NOT NULL,
 object_version text NOT NULL,
 data_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','submitting','processing','passed','review','blocked','failed')),
 task_id text,
 lease uuid,
 lease_until timestamptz,
 due_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(length(path)<200), CHECK(task_id IS NULL OR length(task_id) BETWEEN 1 AND 256)
);
CREATE INDEX video_moderation_due ON private.video_moderation_jobs(due_at) WHERE state IN('pending','processing','submitting');
ALTER TABLE private.video_moderation_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.video_moderation_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.video_moderation_config,private.video_moderation_jobs FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.queue_chat_video_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.bucket_id='chat-media' AND NEW.name ~ '\.(mp4|mov|webm)$'
   AND NEW.version<>'1' AND NEW.metadata->>'size' ~ '^[1-9][0-9]{0,7}$'
   AND NEW.name ~ '^items/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|mov|webm)$' THEN
   INSERT INTO private.video_moderation_jobs(path,owner_id,object_id,object_version)
    VALUES(NEW.name,split_part(NEW.name,'/',2)::uuid,NEW.id,NEW.version)
    ON CONFLICT(path) DO UPDATE SET object_id=NEW.id,object_version=NEW.version,
      data_id=gen_random_uuid(),state='pending',task_id=NULL,lease=NULL,lease_until=NULL,
      created_at=now(),updated_at=now(),due_at=now();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER queue_chat_video_review AFTER INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION private.queue_chat_video_review();

CREATE FUNCTION private.require_chat_video_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.content IS NOT DISTINCT FROM OLD.content AND NEW.message_type IS NOT DISTINCT FROM OLD.message_type THEN RETURN NEW; END IF;
 IF NEW.message_type='video' AND EXISTS(SELECT 1 FROM private.video_moderation_config WHERE enabled)
 AND NOT EXISTS(SELECT 1 FROM private.video_moderation_jobs j JOIN storage.objects o
   ON o.id=j.object_id AND o.version=j.object_version AND o.bucket_id='chat-media' AND o.name=j.path
   WHERE j.path=NEW.content AND j.owner_id=NEW.sender_id AND j.state='passed') THEN
   RAISE EXCEPTION 'chat_video_review_required' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER require_chat_video_review BEFORE INSERT OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION private.require_chat_video_review();

CREATE FUNCTION public.chat_video_review_status(path_in text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result text;
BEGIN
 IF auth.uid() IS NULL OR NOT private.chat_media_access(path_in,true) THEN RETURN 'unavailable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.video_moderation_config WHERE enabled) THEN RETURN 'unavailable'; END IF;
 SELECT j.state INTO result FROM private.video_moderation_jobs j JOIN storage.objects o
   ON o.id=j.object_id AND o.version=j.object_version AND o.bucket_id='chat-media' AND o.name=j.path
   WHERE j.path=path_in AND j.owner_id=auth.uid();
 RETURN coalesce(result,'unavailable');
END $$;

CREATE FUNCTION public.claim_chat_video_review() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job private.video_moderation_jobs;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.video_moderation_config WHERE enabled) THEN RETURN NULL; END IF;
 -- A lost create response must not cause a second billable submission.
 UPDATE private.video_moderation_jobs SET state='review',updated_at=now()
  WHERE state='submitting' AND lease_until<now();
 SELECT * INTO job FROM private.video_moderation_jobs
  WHERE state IN('pending','processing') AND due_at<=now() AND (lease_until IS NULL OR lease_until<now())
  ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF job.created_at<now()-interval '30 minutes' OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE id=job.object_id AND version=job.object_version AND bucket_id='chat-media' AND name=job.path) THEN
   UPDATE private.video_moderation_jobs SET state='failed',updated_at=now() WHERE path=job.path;
   RETURN jsonb_build_object('cancelled',true);
 END IF;
 UPDATE private.video_moderation_jobs SET state=CASE WHEN job.state='pending' THEN 'submitting' ELSE state END,
   lease=gen_random_uuid(),lease_until=now()+interval '60 seconds',updated_at=now()
   WHERE path=job.path RETURNING * INTO job;
 RETURN jsonb_build_object('path',job.path,'data_id',job.data_id,'task_id',job.task_id,'lease',job.lease,'state',job.state);
END $$;

CREATE FUNCTION public.finish_chat_video_review(path_in text,lease_in uuid,state_in text,task_in text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job private.video_moderation_jobs;
BEGIN
 IF state_in NOT IN('processing','passed','review','blocked','failed') THEN RETURN false; END IF;
 SELECT * INTO job FROM private.video_moderation_jobs WHERE path=path_in AND lease=lease_in AND lease_until>now() FOR UPDATE;
 IF NOT FOUND OR job.state NOT IN('submitting','processing') THEN RETURN false; END IF;
 IF state_in IN('processing','passed','blocked') AND (task_in IS NULL OR length(task_in) NOT BETWEEN 1 AND 256) THEN RETURN false; END IF;
 IF job.task_id IS NOT NULL AND job.task_id IS DISTINCT FROM task_in THEN RETURN false; END IF;
 IF job.state='submitting' AND state_in IN('passed','blocked') THEN RETURN false; END IF;
 UPDATE private.video_moderation_jobs SET state=state_in,task_id=coalesce(task_in,task_id),lease=NULL,lease_until=NULL,
   due_at=now()+interval '30 seconds',updated_at=now() WHERE path=path_in;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.queue_chat_video_review(),private.require_chat_video_review(),public.chat_video_review_status(text),public.claim_chat_video_review(),public.finish_chat_video_review(text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chat_video_review_status(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_chat_video_review(),public.finish_chat_video_review(text,uuid,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
