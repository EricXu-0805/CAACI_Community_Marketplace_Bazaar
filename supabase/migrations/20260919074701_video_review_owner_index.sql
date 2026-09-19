-- Keep account deletion / owner cleanup bounded as the private queue grows.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
CREATE INDEX video_moderation_jobs_owner_idx
  ON private.video_moderation_jobs(owner_id);
