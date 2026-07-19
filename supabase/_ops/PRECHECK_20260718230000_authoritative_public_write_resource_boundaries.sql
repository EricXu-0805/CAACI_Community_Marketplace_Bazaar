-- Read-only production precheck for migration 20260718230000.
-- Run before deploy and retain the output. Any non-zero *_invalid count needs
-- investigation; historical chat media is an expected privacy inventory, not
-- proof that a public bucket became private.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id IN ('item-images', 'banners')
ORDER BY id;

WITH media AS (
  SELECT 'profile'::text AS source, id AS row_id, id AS owner_id, avatar_url AS url
  FROM public.profiles WHERE avatar_url IS NOT NULL AND avatar_url <> ''
  UNION ALL
  SELECT 'item', item.id, item.user_id, image.url
  FROM public.items AS item
  CROSS JOIN LATERAL pg_catalog.unnest(item.images) AS image(url)
  UNION ALL
  SELECT 'post', post.id, post.user_id, image.url
  FROM public.posts AS post
  CROSS JOIN LATERAL pg_catalog.unnest(post.images) AS image(url)
), parsed AS (
  SELECT media.*,
         pg_catalog.substring(
           media.url,
           '^https://[a-z0-9][a-z0-9-]{7,63}\.supabase\.co/storage/v1/object/public/item-images/(items/[^?#]+)$'
         ) AS object_name
  FROM media
)
SELECT
  source,
  pg_catalog.count(*) AS nonempty_urls,
  pg_catalog.count(*) FILTER (
    WHERE object_name IS NULL
  ) AS noncanonical_urls,
  pg_catalog.count(*) FILTER (
    WHERE object_name IS NOT NULL
      AND pg_catalog.split_part(object_name, '/', 2) <> owner_id::text
  ) AS wrong_owner_urls,
  pg_catalog.count(*) FILTER (
    WHERE object_name IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM storage.objects AS object
        WHERE object.bucket_id = 'item-images'
          AND object.name = parsed.object_name
      )
  ) AS missing_objects
FROM parsed
GROUP BY source
ORDER BY source;

SELECT
  pg_catalog.count(*) FILTER (
    WHERE images IS NULL OR pg_catalog.cardinality(images) > 9
  ) AS item_image_cap_invalid,
  pg_catalog.count(*) FILTER (
    WHERE pg_catalog.jsonb_typeof(image_dimensions) <> 'array'
      OR pg_catalog.jsonb_array_length(image_dimensions) > 9
      OR (
        pg_catalog.jsonb_array_length(image_dimensions) <> 0
        AND pg_catalog.jsonb_array_length(image_dimensions)
          <> pg_catalog.cardinality(images)
      )
  ) AS item_dimension_count_invalid
FROM public.items;

SELECT
  pg_catalog.count(*) FILTER (
    WHERE images IS NULL OR pg_catalog.cardinality(images) > 4
  ) AS post_image_cap_invalid,
  pg_catalog.count(*) FILTER (
    WHERE pg_catalog.jsonb_typeof(image_dimensions) <> 'array'
      OR pg_catalog.jsonb_array_length(image_dimensions) > 4
      OR (
        pg_catalog.jsonb_array_length(image_dimensions) <> 0
        AND pg_catalog.jsonb_array_length(image_dimensions)
          <> pg_catalog.cardinality(images)
      )
  ) AS post_dimension_count_invalid
FROM public.posts;

WITH localized AS (
  SELECT 'item_title'::text AS field_name, item.id AS row_id, entry.key, entry.value
  FROM public.items AS item
  CROSS JOIN LATERAL pg_catalog.jsonb_each(
    CASE WHEN pg_catalog.jsonb_typeof(item.title_i18n) = 'object'
      THEN item.title_i18n ELSE '{}'::jsonb END
  ) AS entry
  UNION ALL
  SELECT 'item_description', item.id, entry.key, entry.value
  FROM public.items AS item
  CROSS JOIN LATERAL pg_catalog.jsonb_each(
    CASE WHEN pg_catalog.jsonb_typeof(item.description_i18n) = 'object'
      THEN item.description_i18n ELSE '{}'::jsonb END
  ) AS entry
  UNION ALL
  SELECT 'post_content', post.id, entry.key, entry.value
  FROM public.posts AS post
  CROSS JOIN LATERAL pg_catalog.jsonb_each(
    CASE WHEN pg_catalog.jsonb_typeof(post.content_i18n) = 'object'
      THEN post.content_i18n ELSE '{}'::jsonb END
  ) AS entry
)
SELECT
  field_name,
  pg_catalog.count(*) AS localized_values,
  pg_catalog.count(*) FILTER (
    WHERE key NOT IN ('zh', 'en', 'ja', 'ko', 'zh-Hant')
      OR pg_catalog.jsonb_typeof(value) <> 'string'
  ) AS invalid_shape,
  pg_catalog.count(*) FILTER (
    WHERE pg_catalog.jsonb_typeof(value) = 'string'
      AND public.content_moderation_check(value #>> '{}') IS NOT NULL
  ) AS moderation_hits
FROM localized
GROUP BY field_name
ORDER BY field_name;

SELECT message_type, pg_catalog.count(*) AS retained_rows
FROM public.messages
WHERE message_type IN ('image', 'video')
GROUP BY message_type
ORDER BY message_type;

SELECT
  mime_type,
  status,
  pg_catalog.count(*) AS rows
FROM public.admin_banner_uploads
WHERE mime_type = 'image/gif' OR object_name ~ '\.gif$'
GROUP BY mime_type, status
ORDER BY status;

WITH per_owner AS (
  SELECT pg_catalog.split_part(name, '/', 2) AS owner_id,
         pg_catalog.count(*) AS object_count,
         pg_catalog.count(*) FILTER (
           WHERE created_at >= pg_catalog.now() - interval '1 hour'
         ) AS recent_count,
         pg_catalog.sum(
           CASE WHEN (metadata ->> 'size') ~ '^[1-9][0-9]{0,18}$'
             THEN (metadata ->> 'size')::bigint ELSE 0 END
         ) AS declared_bytes
  FROM storage.objects
  WHERE bucket_id = 'item-images'
    AND pg_catalog.split_part(name, '/', 1) = 'items'
  GROUP BY pg_catalog.split_part(name, '/', 2)
)
SELECT * FROM per_owner
WHERE object_count > 250
   OR recent_count > 60
   OR declared_bytes > 262144000
ORDER BY object_count DESC, declared_bytes DESC;

ROLLBACK;
