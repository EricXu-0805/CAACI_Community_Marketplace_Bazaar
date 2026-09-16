-- Disable new private attachments; preserve delivered media and RLS reads.
-- Disable the client picker first. Keep the storage metadata trigger, message
-- path guard and orphan worker: none of these should be weakened on rollback.
-- Re-enabling uses the identical chat_media_sender_insert policy from the
-- forward migration, not a full migration replay or a public bucket.
SET LOCAL lock_timeout='2s';
DROP POLICY IF EXISTS chat_media_sender_insert ON storage.objects;
NOTIFY pgrst, 'reload schema';
