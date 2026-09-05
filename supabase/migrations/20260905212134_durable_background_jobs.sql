-- Apply before deploying the background worker and the digest cursor caller.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE private.listing_notification_jobs (
  item_id uuid PRIMARY KEY REFERENCES public.items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  phase text NOT NULL DEFAULT 'followers' CHECK (phase IN ('followers','searches','complete')),
  follower_cursor uuid,
  search_cursor uuid,
  completed_at timestamptz
);
CREATE INDEX listing_notification_jobs_pending ON private.listing_notification_jobs(created_at, item_id)
  WHERE completed_at IS NULL;
CREATE INDEX idx_follows_fanout_cursor ON public.follows(followee_id, follower_id);

-- Both existing INSERT triggers enqueue the same durable event. Publishing no
-- longer waits for recipient scans. An aborted publish rolls back its event.
CREATE OR REPLACE FUNCTION public.notify_followers_on_new_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.status = 'active' AND NOT EXISTS (
    SELECT 1 FROM moderation_private.current_profile_state(NEW.user_id) s WHERE s.shadow_banned
  ) THEN
    INSERT INTO private.listing_notification_jobs(item_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.notify_saved_search_matches()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.status = 'active' AND NOT EXISTS (
    SELECT 1 FROM moderation_private.current_profile_state(NEW.user_id) s WHERE s.shadow_banned
  ) THEN
    INSERT INTO private.listing_notification_jobs(item_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.process_listing_notification_job(batch_size_in integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
SET statement_timeout = '5s' SET lock_timeout = '2s' AS $$
DECLARE
  job private.listing_notification_jobs%ROWTYPE;
  item public.items%ROWTYPE;
  recipient record;
  scanned integer := 0;
  inserted integer := 0;
  affected integer;
  haystack text;
BEGIN
  IF batch_size_in IS NULL OR batch_size_in < 1 OR batch_size_in > 200 THEN
    RAISE EXCEPTION 'invalid_batch_size';
  END IF;
  SELECT * INTO job FROM private.listing_notification_jobs
    WHERE completed_at IS NULL ORDER BY created_at, item_id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('worked',false,'scanned',0,'inserted',0); END IF;
  SELECT * INTO item FROM public.items WHERE id=job.item_id;
  IF NOT FOUND OR item.status <> 'active' OR EXISTS (
    SELECT 1 FROM moderation_private.current_profile_state(item.user_id) s WHERE s.shadow_banned
  ) THEN
    UPDATE private.listing_notification_jobs SET phase='complete',completed_at=clock_timestamp() WHERE item_id=job.item_id;
    RETURN jsonb_build_object('worked',true,'scanned',0,'inserted',0);
  END IF;
  IF job.phase='followers' THEN
    FOR recipient IN SELECT f.follower_id FROM public.follows f
      WHERE f.followee_id=item.user_id AND (job.follower_cursor IS NULL OR f.follower_id>job.follower_cursor)
      ORDER BY f.follower_id LIMIT batch_size_in
    LOOP
      scanned := scanned+1;
      job.follower_cursor := recipient.follower_id;
      INSERT INTO public.notifications(user_id,type,title,body,item_id)
        SELECT recipient.follower_id,'system',item.title,'new_listing_from_followee',item.id
        WHERE recipient.follower_id<>item.user_id AND EXISTS (
          SELECT 1 FROM public.follows f WHERE f.followee_id=item.user_id
            AND f.follower_id=recipient.follower_id AND f.created_at<=job.created_at
        ) AND NOT EXISTS (SELECT 1 FROM public.blocks b
          WHERE (b.blocker_id=recipient.follower_id AND b.blocked_id=item.user_id)
             OR (b.blocker_id=item.user_id AND b.blocked_id=recipient.follower_id));
      GET DIAGNOSTICS affected = ROW_COUNT;
      inserted := inserted+affected;
    END LOOP;
    UPDATE private.listing_notification_jobs SET follower_cursor=job.follower_cursor,
      phase=CASE WHEN scanned<batch_size_in THEN 'searches' ELSE 'followers' END WHERE item_id=job.item_id;
  ELSE
    haystack := lower(coalesce(item.title,'') || ' ' || coalesce(item.description,''));
    -- One job per transaction; search locks always ascend by ID. SKIP LOCKED
    -- here would silently discard matches behind another publisher's lock.
    FOR recipient IN SELECT ss.* FROM public.saved_searches ss
      WHERE job.search_cursor IS NULL OR ss.id>job.search_cursor
      ORDER BY ss.id LIMIT batch_size_in FOR UPDATE OF ss
    LOOP
      scanned := scanned+1;
      job.search_cursor := recipient.id;
      IF recipient.created_at<=job.created_at AND recipient.user_id<>item.user_id
        AND (recipient.last_notified_at IS NULL OR recipient.last_notified_at<statement_timestamp()-interval '24 hours')
        AND strpos(haystack,lower(recipient.keyword))>0
        AND (recipient.category IS NULL OR recipient.category=item.category)
        AND (recipient.price_min IS NULL OR item.price>=recipient.price_min)
        AND (recipient.price_max IS NULL OR item.price<=recipient.price_max)
        AND (recipient.listing_type='both' OR recipient.listing_type=item.listing_type)
        AND NOT EXISTS (SELECT 1 FROM public.blocks b
          WHERE (b.blocker_id=recipient.user_id AND b.blocked_id=item.user_id)
             OR (b.blocker_id=item.user_id AND b.blocked_id=recipient.user_id)) THEN
        UPDATE public.saved_searches SET last_notified_at=statement_timestamp() WHERE id=recipient.id;
        INSERT INTO public.notifications(user_id,type,title,body,item_id)
          VALUES(recipient.user_id,'system',item.title,'saved_search_match',item.id)
          ON CONFLICT (user_id,item_id) WHERE type='system' AND body='saved_search_match' AND item_id IS NOT NULL DO NOTHING;
        GET DIAGNOSTICS affected = ROW_COUNT;
        inserted := inserted+affected;
      END IF;
    END LOOP;
    UPDATE private.listing_notification_jobs SET search_cursor=job.search_cursor,
      phase=CASE WHEN scanned<batch_size_in THEN 'complete' ELSE 'searches' END,
      completed_at=CASE WHEN scanned<batch_size_in THEN clock_timestamp() ELSE NULL END WHERE item_id=job.item_id;
  END IF;
  RETURN jsonb_build_object('worked',true,'scanned',scanned,'inserted',inserted);
END $$;

CREATE TABLE private.notification_digest_cursor (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  after_user_id uuid,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO private.notification_digest_cursor(singleton) VALUES(true);
CREATE INDEX idx_notifications_pending_digest_cursor ON public.notifications(user_id,created_at DESC) WHERE emailed_at IS NULL;
CREATE FUNCTION public.get_notification_digest_cursor()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('after_user_id',after_user_id) FROM private.notification_digest_cursor WHERE singleton
$$;
CREATE FUNCTION public.advance_notification_digest_cursor(expected_in uuid, after_in uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  UPDATE private.notification_digest_cursor SET after_user_id=after_in,updated_at=clock_timestamp()
    WHERE singleton AND after_user_id IS NOT DISTINCT FROM expected_in;
  RETURN FOUND;
END $$;

-- One object per lease keeps slow/failed objects from monopolizing a batch.
-- No FK: moderation evidence must survive later removal of the content row.
CREATE TABLE private.moderation_media_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK(target_type IN ('item','post')),
  target_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  image_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  due_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','working','complete','cancelled','failed')),
  lease_token uuid,
  lease_until timestamptz,
  completed_at timestamptz,
  error_code text,
  UNIQUE(target_type,target_id,image_url)
);
CREATE INDEX moderation_media_jobs_due ON private.moderation_media_jobs(due_at,id) WHERE state IN ('pending','working');
CREATE FUNCTION private.enqueue_moderation_media_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF (TG_TABLE_NAME='items' AND NEW.status::text<>'deleted')
    OR (TG_TABLE_NAME='posts' AND NEW.status::text<>'hidden') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  INSERT INTO private.moderation_media_jobs(target_type,target_id,owner_id,image_url)
    SELECT CASE WHEN TG_TABLE_NAME='items' THEN 'item' ELSE 'post' END,NEW.id,NEW.user_id,image_url
    FROM (SELECT DISTINCT unnest(NEW.images) AS image_url) images WHERE image_url IS NOT NULL
    ON CONFLICT(target_type,target_id,image_url) DO UPDATE SET
      owner_id=excluded.owner_id,created_at=clock_timestamp(),due_at=clock_timestamp(),attempts=0,
      state='pending',lease_token=NULL,lease_until=NULL,completed_at=NULL,error_code=NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER enqueue_moderation_media_cleanup AFTER INSERT OR UPDATE OF status ON public.items
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_moderation_media_cleanup();
CREATE TRIGGER enqueue_moderation_media_cleanup AFTER INSERT OR UPDATE OF status ON public.posts
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_moderation_media_cleanup();

-- Recover previously hidden media too. PRECHECK reports this inventory so
-- operators can size the migration and recovery backlog before production.
INSERT INTO private.moderation_media_jobs(target_type,target_id,owner_id,image_url)
  SELECT 'item',i.id,i.user_id,image_url FROM public.items i CROSS JOIN LATERAL unnest(i.images) image_url
  WHERE i.status='deleted' AND image_url IS NOT NULL
  UNION
  SELECT 'post',p.id,p.user_id,image_url FROM public.posts p CROSS JOIN LATERAL unnest(p.images) image_url
  WHERE p.status='hidden' AND image_url IS NOT NULL
  ON CONFLICT(target_type,target_id,image_url) DO NOTHING;

CREATE FUNCTION public.claim_moderation_media_job()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job private.moderation_media_jobs%ROWTYPE; current_status text;
BEGIN
  SELECT * INTO job FROM private.moderation_media_jobs WHERE state IN ('pending','working')
    AND due_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
    ORDER BY due_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF job.target_type='item' THEN SELECT status::text INTO current_status FROM public.items WHERE id=job.target_id;
  ELSE SELECT status INTO current_status FROM public.posts WHERE id=job.target_id; END IF;
  IF current_status IS NOT NULL AND current_status<>(CASE WHEN job.target_type='item' THEN 'deleted' ELSE 'hidden' END) THEN
    UPDATE private.moderation_media_jobs SET state='cancelled',completed_at=clock_timestamp(),lease_token=NULL,lease_until=NULL WHERE id=job.id;
    RETURN jsonb_build_object('cancelled',true);
  END IF;
  UPDATE private.moderation_media_jobs SET state='working',attempts=attempts+1,
    lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes'
    WHERE id=job.id RETURNING * INTO job;
  RETURN jsonb_build_object('id',job.id,'lease_token',job.lease_token,'owner_id',job.owner_id,'image_url',job.image_url);
END $$;
CREATE FUNCTION public.finish_moderation_media_job(id_in uuid, lease_in uuid, outcome_in text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF outcome_in IS NULL OR outcome_in NOT IN ('complete','invalid_reference','storage_unavailable') THEN
    RAISE EXCEPTION 'invalid_outcome';
  END IF;
  UPDATE private.moderation_media_jobs SET
    state=CASE WHEN outcome_in='complete' THEN 'complete'
      WHEN outcome_in='invalid_reference' THEN 'cancelled'
      WHEN attempts>=10 THEN 'failed' ELSE 'pending' END,
    completed_at=CASE WHEN outcome_in IN ('complete','invalid_reference') THEN clock_timestamp() ELSE NULL END,
    error_code=CASE WHEN outcome_in='complete' THEN NULL ELSE outcome_in END,
    due_at=clock_timestamp()+make_interval(secs=>least(3600,30*(2^least(attempts,7))::integer)),
    lease_token=NULL,lease_until=NULL
    WHERE id=id_in AND lease_token=lease_in AND state='working' AND lease_until>clock_timestamp();
  RETURN FOUND;
END $$;
CREATE FUNCTION public.background_job_status()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object(
    'listing_pending',(SELECT count(*) FROM private.listing_notification_jobs WHERE completed_at IS NULL),
    'listing_oldest_seconds',(SELECT coalesce(extract(epoch FROM clock_timestamp()-min(created_at)),0)::bigint FROM private.listing_notification_jobs WHERE completed_at IS NULL),
    'media_pending',(SELECT count(*) FROM private.moderation_media_jobs WHERE state IN ('pending','working')),
    'media_failed',(SELECT count(*) FROM private.moderation_media_jobs WHERE state='failed'))
$$;

CREATE FUNCTION public.purge_completed_background_jobs(limit_in integer DEFAULT 500)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE deleted integer; media_deleted integer;
BEGIN
  IF limit_in IS NULL OR limit_in<1 OR limit_in>500 THEN RAISE EXCEPTION 'invalid_limit'; END IF;
  WITH expired AS (SELECT item_id FROM private.listing_notification_jobs
    WHERE completed_at<clock_timestamp()-interval '30 days' ORDER BY completed_at,item_id
    LIMIT limit_in FOR UPDATE SKIP LOCKED)
  DELETE FROM private.listing_notification_jobs j USING expired e WHERE j.item_id=e.item_id;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  WITH expired AS (SELECT id FROM private.moderation_media_jobs
    WHERE completed_at<clock_timestamp()-interval '30 days' AND state IN ('complete','cancelled')
    ORDER BY completed_at,id LIMIT limit_in FOR UPDATE SKIP LOCKED)
  DELETE FROM private.moderation_media_jobs j USING expired e WHERE j.id=e.id;
  GET DIAGNOSTICS media_deleted = ROW_COUNT;
  RETURN deleted+media_deleted;
END $$;
CREATE INDEX listing_notification_jobs_retention ON private.listing_notification_jobs(completed_at,item_id) WHERE completed_at IS NOT NULL;
CREATE INDEX moderation_media_jobs_retention ON private.moderation_media_jobs(completed_at,id) WHERE state IN ('complete','cancelled');

ALTER TABLE private.listing_notification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.notification_digest_cursor ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.moderation_media_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.listing_notification_jobs,private.notification_digest_cursor,private.moderation_media_jobs FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.notify_followers_on_new_item(),public.notify_saved_search_matches(),private.enqueue_moderation_media_cleanup() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.process_listing_notification_job(integer),public.get_notification_digest_cursor(),public.advance_notification_digest_cursor(uuid,uuid),public.claim_moderation_media_job(),public.finish_moderation_media_job(uuid,uuid,text),public.background_job_status() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.process_listing_notification_job(integer),public.get_notification_digest_cursor(),public.advance_notification_digest_cursor(uuid,uuid),public.claim_moderation_media_job(),public.finish_moderation_media_job(uuid,uuid,text),public.background_job_status() TO service_role;
REVOKE ALL ON FUNCTION public.purge_completed_background_jobs(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.purge_completed_background_jobs(integer) TO service_role;
COMMIT;
