-- Read-only post-deploy verification for migration 20260718230000.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  relation_name text;
  constraint_name text;
  expected_triggers integer;
  bucket_record record;
  policy_record record;
BEGIN
  IF pg_catalog.to_regprocedure(
       'private.current_account_storage_writes_allowed()'
     ) IS NOT NULL AND (
       NOT pg_catalog.has_schema_privilege('authenticated', 'private', 'USAGE')
       OR NOT pg_catalog.has_function_privilege(
         'authenticated',
         'private.current_account_storage_writes_allowed()',
         'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'anon',
         'private.current_account_storage_writes_allowed()',
         'EXECUTE'
       )
     ) THEN
    RAISE EXCEPTION
      'verify_failed: account-deletion Storage tombstone helper was broken';
  END IF;

  FOR relation_name, constraint_name IN
    SELECT * FROM (VALUES
      ('profiles', 'profiles_public_payload_boundary'),
      ('items', 'items_public_payload_boundary'),
      ('posts', 'posts_public_payload_boundary'),
      ('messages', 'messages_public_payload_boundary'),
      ('post_comments', 'post_comments_public_payload_boundary'),
      ('reports', 'reports_public_payload_boundary'),
      ('ratings', 'ratings_public_payload_boundary')
    ) AS expected(relation_name, constraint_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_value
      WHERE constraint_value.conrelid = (
        pg_catalog.quote_ident('public') || '.'
        || pg_catalog.quote_ident(relation_name)
      )::pg_catalog.regclass
        AND constraint_value.conname = constraint_name
        AND constraint_value.convalidated
    ) THEN
      RAISE EXCEPTION 'verification_failed: %.% missing/unvalidated',
        relation_name, constraint_name;
    END IF;
  END LOOP;

  SELECT pg_catalog.count(*)::integer INTO expected_triggers
  FROM pg_catalog.pg_trigger AS trigger_value
  WHERE NOT trigger_value.tgisinternal
    AND trigger_value.tgname = 'authoritative_public_write_boundary'
    AND trigger_value.tgrelid IN (
      'public.profiles'::pg_catalog.regclass,
      'public.items'::pg_catalog.regclass,
      'public.posts'::pg_catalog.regclass,
      'public.messages'::pg_catalog.regclass,
      'public.post_comments'::pg_catalog.regclass,
      'public.reports'::pg_catalog.regclass,
      'public.ratings'::pg_catalog.regclass
    );
  IF expected_triggers <> 7 THEN
    RAISE EXCEPTION 'verification_failed: expected 7 public triggers, got %',
      expected_triggers;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE NOT tgisinternal
      AND tgname = 'enforce_item_storage_resource_boundary'
      AND tgrelid = 'storage.objects'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION 'verification_failed: storage resource trigger missing';
  END IF;

  IF pg_catalog.has_function_privilege(
       'authenticated',
       'private.enforce_public_write_payload_boundary()',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon',
       'private.assert_local_media_array(text[],uuid,integer,text,boolean,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verification_failed: private helpers executable by API roles';
  END IF;

  SELECT * INTO bucket_record FROM storage.buckets WHERE id = 'item-images';
  IF bucket_record.file_size_limit <> 5242880
     OR bucket_record.allowed_mime_types IS DISTINCT FROM ARRAY[
       'image/jpeg', 'image/png', 'image/gif', 'image/webp',
       'image/heic', 'image/heif', 'image/heic-sequence',
       'image/heif-sequence'
     ]::text[] THEN
    RAISE EXCEPTION 'verification_failed: item-images bucket boundary drift';
  END IF;

  SELECT * INTO bucket_record FROM storage.buckets WHERE id = 'banners';
  IF bucket_record.file_size_limit <> 2097152
     OR bucket_record.allowed_mime_types IS DISTINCT FROM ARRAY[
       'image/jpeg', 'image/png', 'image/webp'
     ]::text[] THEN
    RAISE EXCEPTION 'verification_failed: banners bucket boundary drift';
  END IF;

  SELECT * INTO policy_record
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'Authenticated users can upload to own folder';
  IF policy_record.roles IS DISTINCT FROM ARRAY['authenticated']::name[]
     OR policy_record.cmd <> 'INSERT'
     OR pg_catalog.strpos(policy_record.with_check, 'auth.role') > 0 THEN
    RAISE EXCEPTION 'verification_failed: storage insert policy drift';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.admin_banner_uploads
    WHERE mime_type = 'image/gif' AND status = 'prepared'
  ) THEN
    RAISE EXCEPTION 'verification_failed: prepared GIF was not quarantined';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.admin_banner_uploads
    WHERE mime_type = 'image/gif' AND NOT legacy_gif_retained
  ) THEN
    RAISE EXCEPTION 'verification_failed: unmarked legacy GIF exists';
  END IF;
END
$verify$;

-- Re-run the canonical legacy validator as a read-only proof over deployed rows.
DO $media_verify$
DECLARE
  row_value record;
BEGIN
  FOR row_value IN SELECT id, avatar_url FROM public.profiles LOOP
    PERFORM private.assert_local_avatar(row_value.avatar_url, row_value.id, NULL, true);
  END LOOP;
  FOR row_value IN SELECT user_id, images, image_dimensions FROM public.items LOOP
    PERFORM private.assert_local_media_array(
      row_value.images, row_value.user_id, 9, NULL, true, 'item_images'
    );
    PERFORM private.assert_image_dimensions(
      row_value.image_dimensions, pg_catalog.cardinality(row_value.images), 9,
      'item_image_dimensions'
    );
  END LOOP;
  FOR row_value IN SELECT user_id, images, image_dimensions FROM public.posts LOOP
    PERFORM private.assert_local_media_array(
      row_value.images, row_value.user_id, 4, NULL, true, 'post_images'
    );
    PERFORM private.assert_image_dimensions(
      row_value.image_dimensions, pg_catalog.cardinality(row_value.images), 4,
      'post_image_dimensions'
    );
  END LOOP;
END
$media_verify$;

SELECT message_type, pg_catalog.count(*) AS retained_historical_media_rows
FROM public.messages
WHERE message_type IN ('image', 'video')
GROUP BY message_type
ORDER BY message_type;

ROLLBACK;
