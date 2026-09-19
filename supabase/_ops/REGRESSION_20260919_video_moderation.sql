\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)
VALUES('11111111-1919-4111-8111-111111111111','video-fixture-1@example.test',now(),'{}'),
('22222222-1919-4222-8222-222222222222','video-fixture-2@example.test',now(),'{}');
INSERT INTO public.conversations(id,buyer_id,seller_id,is_direct) VALUES
('33333333-1919-4333-8333-333333333333','11111111-1919-4111-8111-111111111111','22222222-1919-4222-8222-222222222222',true);
INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('chat-media',
'items/11111111-1919-4111-8111-111111111111/33333333-1919-4333-8333-333333333333/44444444-1919-4444-8444-444444444444.mp4',
'11111111-aaaa-4111-8111-111111111111','{"size":100,"mimetype":"video/mp4"}');
DO $$ DECLARE job jsonb; p text; succeeded boolean; BEGIN
 SELECT path INTO p FROM private.video_moderation_jobs WHERE owner_id='11111111-1919-4111-8111-111111111111';
 IF p IS NULL THEN RAISE EXCEPTION 'missing queue'; END IF;
 IF public.claim_chat_video_review() IS NOT NULL THEN RAISE EXCEPTION 'off switch ignored'; END IF;
 IF has_function_privilege('authenticated','public.claim_chat_video_review()','EXECUTE') THEN RAISE EXCEPTION 'client can claim'; END IF;
 IF has_function_privilege('anon','public.chat_video_review_status(text)','EXECUTE') THEN RAISE EXCEPTION 'anonymous status leak'; END IF;
 UPDATE private.video_moderation_config SET enabled=true;
 job:=public.claim_chat_video_review();
 IF job->>'state'<>'submitting' THEN RAISE EXCEPTION 'unexpected claim'; END IF;
 IF public.finish_chat_video_review(p,gen_random_uuid(),'passed','wrong') THEN RAISE EXCEPTION 'stale lease accepted'; END IF;
 IF public.finish_chat_video_review(p,(job->>'lease')::uuid,'passed','task') THEN RAISE EXCEPTION 'submission granted pass'; END IF;
 PERFORM set_config('request.jwt.claim.sub','11111111-1919-4111-8111-111111111111',true);
 BEGIN
  INSERT INTO public.messages(id,conversation_id,sender_id,content,message_type) VALUES('44444444-1919-4444-8444-444444444444','33333333-1919-4333-8333-333333333333','11111111-1919-4111-8111-111111111111',p,'video');
  RAISE EXCEPTION 'unreviewed video inserted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','',true);
 succeeded:=public.finish_chat_video_review(p,(job->>'lease')::uuid,'processing','task');
 IF NOT succeeded THEN RAISE EXCEPTION 'task not recorded'; END IF;
 UPDATE private.video_moderation_jobs SET due_at=now() WHERE path=p;
 job:=public.claim_chat_video_review();
 IF NOT public.finish_chat_video_review(p,(job->>'lease')::uuid,'passed','task') THEN RAISE EXCEPTION 'valid final rejected'; END IF;
 PERFORM set_config('request.jwt.claim.sub','22222222-1919-4222-8222-222222222222',true);
 IF public.chat_video_review_status(p)<>'unavailable' THEN RAISE EXCEPTION 'other account status leak'; END IF;
 PERFORM set_config('request.jwt.claim.sub','11111111-1919-4111-8111-111111111111',true);
 IF public.chat_video_review_status(p)<>'passed' THEN RAISE EXCEPTION 'owner cannot read pass'; END IF;
 INSERT INTO public.messages(id,conversation_id,sender_id,content,message_type) VALUES('44444444-1919-4444-8444-444444444444','33333333-1919-4333-8333-333333333333','11111111-1919-4111-8111-111111111111',p,'video');
 PERFORM set_config('request.jwt.claim.sub','',true);
 -- Simulate a candidate being deleted/reuploaded with the same path before send.
 DELETE FROM public.messages WHERE id='44444444-1919-4444-8444-444444444444';
 PERFORM set_config('storage.allow_delete_query','true',true);
 DELETE FROM storage.objects WHERE bucket_id='chat-media' AND name=p;
 INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('chat-media',p,gen_random_uuid()::text,'{"size":101,"mimetype":"video/mp4"}');
 IF (SELECT state FROM private.video_moderation_jobs WHERE path=p)<>'pending' THEN RAISE EXCEPTION 'approval reused for different bytes'; END IF;
 job:=public.claim_chat_video_review();
 UPDATE private.video_moderation_jobs SET lease_until=now()-interval '1 second' WHERE path=p;
 IF public.claim_chat_video_review() IS NOT NULL THEN RAISE EXCEPTION 'lost create response resubmitted'; END IF;
 IF (SELECT state FROM private.video_moderation_jobs WHERE path=p)<>'review' THEN RAISE EXCEPTION 'unknown creation not quarantined'; END IF;
END $$;
ROLLBACK;
