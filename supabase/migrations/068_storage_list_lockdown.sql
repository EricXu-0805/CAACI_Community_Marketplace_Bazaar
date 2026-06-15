-- ============================================
-- 068 Storage list lockdown (QA4 L10)
-- ============================================
-- The item-images bucket SELECT policy ("Anyone can view item images", role
-- PUBLIC, qual `bucket_id = 'item-images'`) lets ANY caller hit
-- POST /storage/v1/object/list/item-images and enumerate every object key —
-- leaking the set of uploader user_ids, per-user upload counts/timestamps,
-- and the keys of chat media + unlinked/draft images (whose only protection
-- is an unguessable filename, which listing defeats). The bucket is public,
-- so public READS by URL bypass RLS entirely and are UNAFFECTED by this change
-- — item photos keep loading. The app makes zero `.list()` calls, so nothing
-- in the product breaks.
--
-- DELIVERY: storage.objects is owned by `supabase_storage_admin`, NOT
-- `postgres`. A normal migration runs as postgres and will hit
-- `42501 must be owner of table objects`. This file attempts the change and,
-- if it lacks ownership, RAISEs a NOTICE telling you to apply it via the
-- Supabase Dashboard (Storage -> Policies -> item-images) — the same path
-- migration 032 used for its storage DELETE fix. The block is idempotent.

DO $$
BEGIN
  -- Replace the over-broad public SELECT (list) policy with an owner-only one.
  -- Authenticated callers may list only their own items/<uid>/ folder; anon
  -- can no longer list at all. Public READS by URL are unaffected (public bucket).
  DROP POLICY IF EXISTS "Anyone can view item images" ON storage.objects;
  CREATE POLICY "Owner can list own images"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'item-images'
      AND (storage.foldername(name))[1] = 'items'
      AND (storage.foldername(name))[2] = auth.uid()::text
    );
  RAISE NOTICE '068: storage SELECT policy tightened to owner-only.';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE '068: insufficient privilege on storage.objects (owned by supabase_storage_admin). APPLY VIA DASHBOARD: Storage -> Policies -> item-images -> drop "Anyone can view item images", add SELECT policy for role authenticated with USING ( bucket_id = ''item-images'' AND (storage.foldername(name))[1] = ''items'' AND (storage.foldername(name))[2] = auth.uid()::text ). Keep the bucket public so URL reads still work.';
END $$;
