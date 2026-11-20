-- LOCAL L-SQL REPLAY ONLY (RUNBOOK §5.1). Never apply to a hosted project:
-- there Supabase Storage already added these columns.
--
-- Hosted surface: storage.objects columns the local stub lacks. version is
-- first read by 20260916211900 (private.enforce_chat_media_upload(),
-- NEW.version), then by 20260919064706 (private.queue_chat_video_review()).
-- owner_id is added only so the local table matches the hosted one; no
-- migration reads it.
--
-- Sources (supabase/storage v1.98.2 (645343a4be3d5517134f689327a9a1df34d80a91), migrations/tenant/):
--   storage.objects version text NULL: 0016-add-version.sql
--   storage.objects owner_id text NULL: 0018-add_owner_id_column_deprecate_owner.sql

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF pg_catalog.current_setting('caaci.local_bootstrap', true)
       IS DISTINCT FROM 'lsql-replay' THEN
    RAISE EXCEPTION 'local L-SQL replay bootstrap only (set caaci.local_bootstrap = lsql-replay)'
      USING ERRCODE = '55000';
  END IF;
END;
$guard$;

ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS version text NULL;
ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS owner_id text NULL;
