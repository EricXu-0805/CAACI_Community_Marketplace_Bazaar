-- Local/isolated behavioral regression for migration 20260718230000.
-- NEVER run against production. Every mutation is rolled back.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect_boundary_error(
  test_name text,
  statement text,
  expected_fragment text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  observed text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    observed := SQLERRM;
    IF pg_catalog.strpos(observed, expected_fragment) = 0 THEN
      RAISE EXCEPTION 'regression_failed:% expected %, observed %',
        test_name, expected_fragment, observed;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'regression_failed:% unexpectedly succeeded', test_name;
END
$function$;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'boundary-owner@example.test', '{}'::jsonb),
  ('a1000000-0000-4000-8000-000000000002', 'boundary-peer@example.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'Boundary Owner'),
  ('a1000000-0000-4000-8000-000000000002', 'Boundary Peer')
ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000001',
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","iss":"https://aaaaaaaaaaaaaaaaaaaa.supabase.co/auth/v1"}',
  true
);

INSERT INTO storage.objects (id, bucket_id, name, owner, metadata) VALUES
  (
    'a1100000-0000-4000-8000-000000000001',
    'item-images',
    'items/a1000000-0000-4000-8000-000000000001/avatar.jpg',
    'a1000000-0000-4000-8000-000000000001',
    '{"mimetype":"image/jpeg","size":1024}'::jsonb
  ),
  (
    'a1100000-0000-4000-8000-000000000002',
    'item-images',
    'items/a1000000-0000-4000-8000-000000000001/item.jpg',
    'a1000000-0000-4000-8000-000000000001',
    '{"mimetype":"image/jpeg","size":2048}'::jsonb
  );

UPDATE public.profiles
SET avatar_url = 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/storage/v1/object/public/item-images/items/a1000000-0000-4000-8000-000000000001/avatar.jpg'
WHERE id = 'a1000000-0000-4000-8000-000000000001';

INSERT INTO public.items (
  id, user_id, title, description, price, category, condition, location,
  images, image_dimensions, title_i18n, description_i18n
) VALUES (
  'a1200000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'Boundary item',
  'Clean description',
  10,
  'other',
  'good',
  'UIUC',
  ARRAY['https://aaaaaaaaaaaaaaaaaaaa.supabase.co/storage/v1/object/public/item-images/items/a1000000-0000-4000-8000-000000000001/item.jpg'],
  '[{"w":1200,"h":800}]'::jsonb,
  '{"en":"Boundary item","zh":"边界商品"}'::jsonb,
  '{"en":"Clean description"}'::jsonb
);

INSERT INTO public.posts (
  id, user_id, content, images, image_dimensions, content_i18n
) VALUES (
  'a1300000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'Clean post',
  ARRAY['https://aaaaaaaaaaaaaaaaaaaa.supabase.co/storage/v1/object/public/item-images/items/a1000000-0000-4000-8000-000000000001/item.jpg'],
  '[{"w":1200,"h":800}]'::jsonb,
  '{"en":"Clean post"}'::jsonb
);

INSERT INTO public.conversations (
  id, item_id, buyer_id, seller_id
) VALUES (
  'a1400000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000001'
);

INSERT INTO public.messages (
  id, conversation_id, sender_id, content, message_type
) VALUES
  (
    'a1500000-0000-4000-8000-000000000001',
    'a1400000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'Clean text',
    'text'
  ),
  (
    'a1500000-0000-4000-8000-000000000002',
    'a1400000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    '[sticker:verified-pickup]',
    'text'
  );

-- Exercise the same role/claim path used by direct PostgREST callers.  This
-- also proves the private-schema API revoke does not break policies that call
-- private helpers internally.
SET LOCAL ROLE authenticated;
INSERT INTO public.items (
  user_id, title, description, price, category, condition, location,
  images, image_dimensions
) VALUES (
  'a1000000-0000-4000-8000-000000000001',
  'Direct REST boundary item',
  'Authenticated RLS path',
  11,
  'other',
  'good',
  'UIUC',
  ARRAY['https://aaaaaaaaaaaaaaaaaaaa.supabase.co/storage/v1/object/public/item-images/items/a1000000-0000-4000-8000-000000000001/item.jpg'],
  '[{"w":1200,"h":800}]'::jsonb
);
INSERT INTO public.messages (
  conversation_id, sender_id, content, message_type
) VALUES (
  'a1400000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'Authenticated RLS text',
  'text'
);
RESET ROLE;

SELECT pg_temp.expect_boundary_error(
  'external_item_url',
  $sql$UPDATE public.items SET images = ARRAY['https://example.com/x.jpg'], image_dimensions = '[]'::jsonb WHERE id = 'a1200000-0000-4000-8000-000000000001'$sql$,
  'item_images_local_object'
);

SELECT pg_temp.expect_boundary_error(
  'wrong_owner_url',
  $sql$UPDATE public.items SET images = ARRAY['https://aaaaaaaaaaaaaaaaaaaa.supabase.co/storage/v1/object/public/item-images/items/a1000000-0000-4000-8000-000000000002/item.jpg'], image_dimensions = '[]'::jsonb WHERE id = 'a1200000-0000-4000-8000-000000000001'$sql$,
  'item_images_local_object'
);

SELECT pg_temp.expect_boundary_error(
  'missing_object',
  $sql$UPDATE public.items SET images = ARRAY['https://aaaaaaaaaaaaaaaaaaaa.supabase.co/storage/v1/object/public/item-images/items/a1000000-0000-4000-8000-000000000001/missing.jpg'], image_dimensions = '[]'::jsonb WHERE id = 'a1200000-0000-4000-8000-000000000001'$sql$,
  'item_images_local_object'
);

SELECT pg_temp.expect_boundary_error(
  'item_image_cap',
  $sql$UPDATE public.items SET images = ARRAY['x','x','x','x','x','x','x','x','x','x'] WHERE id = 'a1200000-0000-4000-8000-000000000001'$sql$,
  'item_images_count'
);

SELECT pg_temp.expect_boundary_error(
  'dimension_count',
  $sql$UPDATE public.items SET image_dimensions = '[{"w":10,"h":10},{"w":20,"h":20}]'::jsonb WHERE id = 'a1200000-0000-4000-8000-000000000001'$sql$,
  'item_image_dimensions_count'
);

SELECT pg_temp.expect_boundary_error(
  'dimension_extra_key',
  $sql$UPDATE public.items SET image_dimensions = '[{"w":10,"h":10,"x":1}]'::jsonb WHERE id = 'a1200000-0000-4000-8000-000000000001'$sql$,
  'item_image_dimensions_entry_range'
);

SELECT pg_temp.expect_boundary_error(
  'dimension_range',
  $sql$UPDATE public.items SET image_dimensions = '[{"w":8192,"h":8192}]'::jsonb WHERE id = 'a1200000-0000-4000-8000-000000000001'$sql$,
  'item_image_dimensions_entry_range'
);

SELECT pg_temp.expect_boundary_error(
  'unknown_i18n_key',
  $sql$UPDATE public.items SET title_i18n = '{"xx":"Clean"}'::jsonb WHERE id = 'a1200000-0000-4000-8000-000000000001'$sql$,
  'item_title_i18n_language_shape'
);

SELECT pg_temp.expect_boundary_error(
  'non_string_i18n',
  $sql$UPDATE public.items SET title_i18n = '{"en":7}'::jsonb WHERE id = 'a1200000-0000-4000-8000-000000000001'$sql$,
  'item_title_i18n_language_shape'
);

-- Clean original text must not hide a malicious localized value.
SELECT pg_temp.expect_boundary_error(
  'malicious_localized_value',
  $sql$UPDATE public.items SET title = 'Clean original', title_i18n = '{"en":"Clean original","zh":"代写论文"}'::jsonb WHERE id = 'a1200000-0000-4000-8000-000000000001'$sql$,
  'moderation_block:item_title_i18n_zh'
);

SELECT pg_temp.expect_boundary_error(
  'fake_sticker',
  $sql$INSERT INTO public.messages (conversation_id, sender_id, content, message_type) VALUES ('a1400000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','[sticker:admin]','text')$sql$,
  'invalid_sticker'
);

SELECT pg_temp.expect_boundary_error(
  'public_chat_image',
  $sql$INSERT INTO public.messages (conversation_id, sender_id, content, message_type) VALUES ('a1400000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','https://aaaaaaaaaaaaaaaaaaaa.supabase.co/storage/v1/object/public/item-images/items/a1000000-0000-4000-8000-000000000001/item.jpg','image')$sql$,
  'chat_media_private_storage_required'
);

SELECT pg_temp.expect_boundary_error(
  'public_chat_video',
  $sql$INSERT INTO public.messages (conversation_id, sender_id, content, message_type) VALUES ('a1400000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','https://aaaaaaaaaaaaaaaaaaaa.supabase.co/storage/v1/object/public/item-images/items/a1000000-0000-4000-8000-000000000001/item.jpg','video')$sql$,
  'chat_media_private_storage_required'
);

SELECT pg_temp.expect_boundary_error(
  'rating_moderation',
  $sql$INSERT INTO public.ratings (rater_id, ratee_id, item_id, stars, comment) VALUES ('a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','a1200000-0000-4000-8000-000000000001',5,'代写论文')$sql$,
  'moderation_block:rating_comment'
);

SELECT pg_temp.expect_boundary_error(
  'report_reason_size',
  $sql$INSERT INTO public.reports (reporter_id, target_type, target_id, reason) VALUES ('a1000000-0000-4000-8000-000000000001','item','a1200000-0000-4000-8000-000000000001',repeat('x',51))$sql$,
  'report_reason_size'
);

SELECT pg_temp.expect_boundary_error(
  'storage_wrong_path',
  $sql$INSERT INTO storage.objects (bucket_id,name,owner,metadata) VALUES ('item-images','items/a1000000-0000-4000-8000-000000000002/forged.jpg','a1000000-0000-4000-8000-000000000001','{"mimetype":"image/jpeg","size":10}'::jsonb)$sql$,
  'storage_boundary:invalid_owner_path'
);

SELECT pg_temp.expect_boundary_error(
  'storage_bad_mime',
  $sql$INSERT INTO storage.objects (bucket_id,name,owner,metadata) VALUES ('item-images','items/a1000000-0000-4000-8000-000000000001/payload.svg','a1000000-0000-4000-8000-000000000001','{"mimetype":"image/svg+xml","size":10}'::jsonb)$sql$,
  'storage_boundary:invalid_image_type'
);

SELECT pg_temp.expect_boundary_error(
  'storage_too_large',
  $sql$INSERT INTO storage.objects (bucket_id,name,owner,metadata) VALUES ('item-images','items/a1000000-0000-4000-8000-000000000001/large.jpg','a1000000-0000-4000-8000-000000000001','{"mimetype":"image/jpeg","size":5242881}'::jsonb)$sql$,
  'storage_boundary:file_too_large'
);

-- A trusted maintenance request without a verifiable issuer may update text and
-- clear media, but cannot introduce any non-empty media reference.
SELECT pg_catalog.set_config('request.jwt.claims', '{}'::text, true);
UPDATE public.items
SET title = 'Trusted text-only maintenance'
WHERE id = 'a1200000-0000-4000-8000-000000000001';
UPDATE public.items
SET images = ARRAY[]::text[], image_dimensions = '[]'::jsonb
WHERE id = 'a1200000-0000-4000-8000-000000000001';

SELECT pg_temp.expect_boundary_error(
  'trusted_media_introduction_without_issuer',
  $sql$UPDATE public.items SET images = ARRAY['https://aaaaaaaaaaaaaaaaaaaa.supabase.co/storage/v1/object/public/item-images/items/a1000000-0000-4000-8000-000000000001/item.jpg'], image_dimensions = '[{"w":1200,"h":800}]'::jsonb WHERE id = 'a1200000-0000-4000-8000-000000000001'$sql$,
  'item_images_issuer_unverifiable'
);

ROLLBACK;
