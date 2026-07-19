-- =============================================================================
-- Authoritative public-write payload and resource boundaries.
--
-- Direct PostgREST/Storage callers can bypass every client-side length, media,
-- translation and upload check.  This migration makes PostgreSQL/Storage the
-- final boundary for all authenticated writable public payloads.
--
-- Portability: media origins are derived from the signed request JWT issuer
-- (`https://<project-ref>.supabase.co/auth/v1`).  No project ref is embedded in
-- schema code.  A trusted write with no verifiable issuer may leave media
-- unchanged or clear it, but cannot introduce a non-empty media reference.
--
-- Privacy note: item-images is a public bucket.  New chat image/video messages
-- are therefore rejected until a separate private chat-media bucket + signed
-- membership URL flow exists.  This migration does not claim that historical
-- public chat objects became private; they require a separately controlled
-- migration/cleanup after evidence retention is decided.
-- =============================================================================

-- Required Supabase platform/storage shape.  Fail before partially installing
-- triggers when a hosted schema or selected historical replay has drifted.
DO $precheck$
DECLARE
  required_relation text;
  required_function text;
  required_bucket_column text;
BEGIN
  FOREACH required_relation IN ARRAY ARRAY[
    'public.profiles',
    'public.items',
    'public.posts',
    'public.messages',
    'public.post_comments',
    'public.reports',
    'public.ratings',
    'storage.buckets',
    'storage.objects'
  ] LOOP
    IF pg_catalog.to_regclass(required_relation) IS NULL THEN
      RAISE EXCEPTION 'migration_precheck_failed: missing relation %',
        required_relation;
    END IF;
  END LOOP;

  FOREACH required_function IN ARRAY ARRAY[
    'auth.uid()',
    'auth.jwt()',
    'public.content_moderation_check(text)'
  ] LOOP
    IF pg_catalog.to_regprocedure(required_function) IS NULL THEN
      RAISE EXCEPTION 'migration_precheck_failed: missing function %',
        required_function;
    END IF;
  END LOOP;

  IF pg_catalog.to_regnamespace('private') IS NULL THEN
    RAISE EXCEPTION 'migration_precheck_failed: private schema missing';
  END IF;

  FOREACH required_bucket_column IN ARRAY ARRAY[
    'file_size_limit', 'allowed_mime_types'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = 'storage.buckets'::pg_catalog.regclass
        AND attribute.attname = required_bucket_column
        AND NOT attribute.attisdropped
    ) THEN
      RAISE EXCEPTION 'migration_precheck_failed: storage.buckets.% missing',
        required_bucket_column;
    END IF;
  END LOOP;

  IF (SELECT pg_catalog.count(*) FROM storage.buckets
      WHERE id IN ('item-images', 'banners')) <> 2 THEN
    RAISE EXCEPTION
      'migration_precheck_failed: item-images/banners buckets missing';
  END IF;
END
$precheck$;

-- Private functions remain individually closed below. Authenticated retains
-- schema USAGE because migration 20260717194646's narrowly granted
-- current_account_storage_writes_allowed() is invoked by restrictive Storage
-- RLS to reject still-valid JWTs after account deletion. Revoking schema USAGE
-- here silently disables that earlier tombstone boundary.
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.public_write_request_origin()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  claims jsonb;
  issuer text;
BEGIN
  BEGIN
    claims := auth.jwt();
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  issuer := claims ->> 'iss';
  IF issuer IS NULL
     OR issuer !~ '^https://[a-z0-9][a-z0-9-]{7,63}\.supabase\.co/auth/v1/?$' THEN
    RETURN NULL;
  END IF;

  RETURN pg_catalog.regexp_replace(issuer, '/auth/v1/?$', '');
END
$function$;

REVOKE ALL ON FUNCTION private.public_write_request_origin() FROM PUBLIC;

-- Return the local storage.objects name represented by a URL, or NULL.  With a
-- request origin, the origin must match byte-for-byte.  During one-time legacy
-- validation (`expected_origin IS NULL`) any syntactically valid Supabase
-- project host is accepted, but the object must still exist in this database
-- and the path must match the row owner.  New writes never use that legacy mode.
CREATE OR REPLACE FUNCTION private.local_item_media_object_name(
  raw_url text,
  row_owner uuid,
  expected_origin text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  candidate_origin text := expected_origin;
  object_prefix text;
  owner_prefix text;
  object_name text;
  suffix text;
BEGIN
  IF raw_url IS NULL
     OR row_owner IS NULL
     OR pg_catalog.length(raw_url) < 1
     OR pg_catalog.length(raw_url) > 500
     OR pg_catalog.octet_length(raw_url) > 500 THEN
    RETURN NULL;
  END IF;

  IF candidate_origin IS NULL THEN
    candidate_origin := pg_catalog.substring(
      raw_url,
      '^(https://[a-z0-9][a-z0-9-]{7,63}\.supabase\.co)'
    );
  END IF;
  IF candidate_origin IS NULL
     OR candidate_origin !~ '^https://[a-z0-9][a-z0-9-]{7,63}\.supabase\.co$' THEN
    RETURN NULL;
  END IF;

  object_prefix := candidate_origin
    || '/storage/v1/object/public/item-images/';
  owner_prefix := object_prefix || 'items/' || row_owner::text || '/';
  IF pg_catalog.left(raw_url, pg_catalog.length(owner_prefix))
       IS DISTINCT FROM owner_prefix THEN
    RETURN NULL;
  END IF;

  object_name := pg_catalog.substr(
    raw_url,
    pg_catalog.length(object_prefix) + 1
  );
  suffix := pg_catalog.substr(raw_url, pg_catalog.length(owner_prefix) + 1);

  -- Persist only canonical public object URLs.  Render URLs, query strings,
  -- fragments, percent-encoded separators and traversal-shaped segments are
  -- rejected.  Current clients create one ASCII filename under this prefix;
  -- nested safe folders remain portable for future organization.
  IF suffix IS NULL
     OR pg_catalog.length(suffix) > 300
     OR pg_catalog.octet_length(suffix) > 300
     OR suffix !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
     OR suffix LIKE '%//%'
     OR suffix LIKE '%/./%'
     OR suffix LIKE '%/../%'
     OR pg_catalog.right(suffix, 1) IN ('.', '/') THEN
    RETURN NULL;
  END IF;

  RETURN object_name;
END
$function$;

REVOKE ALL ON FUNCTION private.local_item_media_object_name(text, uuid, text)
  FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.assert_text_boundary(
  candidate text,
  field_name text,
  minimum_chars integer,
  maximum_chars integer,
  maximum_bytes integer,
  nullable boolean
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF candidate IS NULL THEN
    IF nullable THEN RETURN; END IF;
    RAISE EXCEPTION 'public_write_boundary:%_required', field_name
      USING ERRCODE = '22023';
  END IF;
  IF (minimum_chars > 0
      AND pg_catalog.char_length(pg_catalog.btrim(candidate)) < minimum_chars)
     OR pg_catalog.char_length(candidate) < minimum_chars
     OR pg_catalog.char_length(candidate) > maximum_chars
     OR pg_catalog.octet_length(candidate) > maximum_bytes THEN
    RAISE EXCEPTION 'public_write_boundary:%_size', field_name
      USING ERRCODE = '22023';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION private.assert_text_boundary(
  text, text, integer, integer, integer, boolean
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.assert_moderated_text(
  candidate text,
  field_name text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  moderation_result text;
BEGIN
  IF candidate IS NULL OR pg_catalog.length(candidate) = 0 THEN RETURN; END IF;
  moderation_result := public.content_moderation_check(candidate);
  IF moderation_result IS NOT NULL THEN
    RAISE EXCEPTION 'moderation_block:%:%', field_name, moderation_result
      USING ERRCODE = '22023';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION private.assert_moderated_text(text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.assert_i18n_payload(
  payload jsonb,
  field_name text,
  maximum_value_chars integer,
  maximum_value_bytes integer,
  maximum_total_bytes integer
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  entry record;
  entry_count integer;
BEGIN
  IF payload IS NULL THEN RETURN; END IF;
  IF pg_catalog.jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'public_write_boundary:%_shape', field_name
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.octet_length(payload::text) > maximum_total_bytes THEN
    RAISE EXCEPTION 'public_write_boundary:%_total_size', field_name
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO entry_count
  FROM pg_catalog.jsonb_each(payload);
  IF entry_count < 1 OR entry_count > 5 THEN
    RAISE EXCEPTION 'public_write_boundary:%_language_count', field_name
      USING ERRCODE = '22023';
  END IF;

  FOR entry IN SELECT key, value FROM pg_catalog.jsonb_each(payload) LOOP
    IF entry.key NOT IN ('zh', 'en', 'ja', 'ko', 'zh-Hant')
       OR pg_catalog.jsonb_typeof(entry.value) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'public_write_boundary:%_language_shape', field_name
        USING ERRCODE = '22023';
    END IF;
    PERFORM private.assert_text_boundary(
      entry.value #>> '{}',
      field_name || '_' || entry.key,
      1,
      maximum_value_chars,
      maximum_value_bytes,
      false
    );
    PERFORM private.assert_moderated_text(
      entry.value #>> '{}',
      field_name || '_' || entry.key
    );
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION private.assert_i18n_payload(
  jsonb, text, integer, integer, integer
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.assert_image_dimensions(
  dimensions jsonb,
  image_count integer,
  image_cap integer,
  field_name text
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  dimension jsonb;
  dimensions_count integer;
  key_count integer;
  width_value integer;
  height_value integer;
BEGIN
  IF dimensions IS NULL
     OR pg_catalog.jsonb_typeof(dimensions) IS DISTINCT FROM 'array'
     OR pg_catalog.octet_length(dimensions::text) > 4096 THEN
    RAISE EXCEPTION 'public_write_boundary:%_shape', field_name
      USING ERRCODE = '22023';
  END IF;
  dimensions_count := pg_catalog.jsonb_array_length(dimensions);
  IF dimensions_count > image_cap
     OR (dimensions_count <> 0 AND dimensions_count <> image_count) THEN
    RAISE EXCEPTION 'public_write_boundary:%_count', field_name
      USING ERRCODE = '22023';
  END IF;

  FOR dimension IN SELECT value FROM pg_catalog.jsonb_array_elements(dimensions)
  LOOP
    IF pg_catalog.jsonb_typeof(dimension) IS DISTINCT FROM 'object'
       OR pg_catalog.jsonb_typeof(dimension -> 'w') IS DISTINCT FROM 'number'
       OR pg_catalog.jsonb_typeof(dimension -> 'h') IS DISTINCT FROM 'number'
       OR (dimension ->> 'w') !~ '^[1-9][0-9]{0,3}$'
       OR (dimension ->> 'h') !~ '^[1-9][0-9]{0,3}$' THEN
      RAISE EXCEPTION 'public_write_boundary:%_entry_shape', field_name
        USING ERRCODE = '22023';
    END IF;

    SELECT pg_catalog.count(*)::integer INTO key_count
    FROM pg_catalog.jsonb_object_keys(dimension);
    width_value := (dimension ->> 'w')::integer;
    height_value := (dimension ->> 'h')::integer;
    IF key_count <> 2
       OR width_value > 8192
       OR height_value > 8192
       OR width_value::bigint * height_value::bigint > 24000000 THEN
      RAISE EXCEPTION 'public_write_boundary:%_entry_range', field_name
        USING ERRCODE = '22023';
    END IF;
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION private.assert_image_dimensions(
  jsonb, integer, integer, text
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.assert_local_media_array(
  media_urls text[],
  row_owner uuid,
  media_cap integer,
  request_origin text,
  allow_portable_legacy_origin boolean,
  field_name text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  media_url text;
  object_name text;
  media_count integer;
  distinct_count integer;
BEGIN
  IF media_urls IS NULL THEN
    RAISE EXCEPTION 'public_write_boundary:%_required', field_name
      USING ERRCODE = '22023';
  END IF;
  media_count := pg_catalog.cardinality(media_urls);
  IF media_count > media_cap THEN
    RAISE EXCEPTION 'public_write_boundary:%_count', field_name
      USING ERRCODE = '22023';
  END IF;
  IF media_count = 0 THEN RETURN; END IF;
  IF request_origin IS NULL AND NOT allow_portable_legacy_origin THEN
    RAISE EXCEPTION 'public_write_boundary:%_issuer_unverifiable', field_name
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.count(DISTINCT candidate)::integer INTO distinct_count
  FROM pg_catalog.unnest(media_urls) AS candidate;
  IF distinct_count <> media_count THEN
    RAISE EXCEPTION 'public_write_boundary:%_duplicate', field_name
      USING ERRCODE = '22023';
  END IF;

  FOREACH media_url IN ARRAY media_urls LOOP
    object_name := private.local_item_media_object_name(
      media_url,
      row_owner,
      CASE WHEN allow_portable_legacy_origin THEN NULL ELSE request_origin END
    );
    IF object_name IS NULL OR NOT EXISTS (
      SELECT 1
      FROM storage.objects AS object
      WHERE object.bucket_id = 'item-images'
        AND object.name = object_name
    ) THEN
      RAISE EXCEPTION 'public_write_boundary:%_local_object', field_name
        USING ERRCODE = '22023';
    END IF;
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION private.assert_local_media_array(
  text[], uuid, integer, text, boolean, text
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.assert_local_avatar(
  avatar_url text,
  row_owner uuid,
  request_origin text,
  allow_portable_legacy_origin boolean
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  object_name text;
BEGIN
  IF avatar_url IS NULL OR avatar_url = '' THEN RETURN; END IF;
  IF request_origin IS NULL AND NOT allow_portable_legacy_origin THEN
    RAISE EXCEPTION 'public_write_boundary:profile_avatar_issuer_unverifiable'
      USING ERRCODE = '22023';
  END IF;
  object_name := private.local_item_media_object_name(
    avatar_url,
    row_owner,
    CASE WHEN allow_portable_legacy_origin THEN NULL ELSE request_origin END
  );
  IF object_name IS NULL OR NOT EXISTS (
    SELECT 1 FROM storage.objects AS object
    WHERE object.bucket_id = 'item-images'
      AND object.name = object_name
  ) THEN
    RAISE EXCEPTION 'public_write_boundary:profile_avatar_local_object'
      USING ERRCODE = '22023';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION private.assert_local_avatar(
  text, uuid, text, boolean
) FROM PUBLIC;

-- Cheap CHECK constraints reject oversized payloads before trigger work.  The
-- richer cross-field, object-existence and moderation checks live in the
-- authoritative trigger below.  NOT VALID + VALIDATE gives operators a clear
-- validation phase while still ending with fully validated constraints.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_public_payload_boundary;
ALTER TABLE public.items
  DROP CONSTRAINT IF EXISTS items_public_payload_boundary;
ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_public_payload_boundary;
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_public_payload_boundary;
ALTER TABLE public.post_comments
  DROP CONSTRAINT IF EXISTS post_comments_public_payload_boundary;
ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_public_payload_boundary;
ALTER TABLE public.ratings
  DROP CONSTRAINT IF EXISTS ratings_public_payload_boundary;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_public_payload_boundary CHECK (
    pg_catalog.char_length(pg_catalog.btrim(nickname)) BETWEEN 1 AND 40
    AND pg_catalog.octet_length(nickname) <= 160
    AND (avatar_url IS NULL OR (
      pg_catalog.char_length(avatar_url) <= 500
      AND pg_catalog.octet_length(avatar_url) <= 500
    ))
    AND (bio IS NULL OR (
      pg_catalog.char_length(bio) <= 200
      AND pg_catalog.octet_length(bio) <= 800
    ))
    AND (location IS NULL OR (
      pg_catalog.char_length(location) <= 80
      AND pg_catalog.octet_length(location) <= 320
    ))
    AND (status_text IS NULL OR (
      pg_catalog.char_length(status_text) <= 60
      AND pg_catalog.octet_length(status_text) <= 240
    ))
    AND (status_emoji IS NULL OR (
      pg_catalog.char_length(status_emoji) <= 8
      AND pg_catalog.octet_length(status_emoji) <= 64
    ))
  ) NOT VALID;

ALTER TABLE public.items
  ADD CONSTRAINT items_public_payload_boundary CHECK (
    pg_catalog.char_length(pg_catalog.btrim(title)) BETWEEN 1 AND 200
    AND pg_catalog.octet_length(title) <= 800
    AND (description IS NULL OR (
      pg_catalog.char_length(description) <= 2000
      AND pg_catalog.octet_length(description) <= 8000
    ))
    AND (location IS NULL OR (
      pg_catalog.char_length(location) <= 80
      AND pg_catalog.octet_length(location) <= 320
    ))
    AND images IS NOT NULL
    AND pg_catalog.cardinality(images) <= 9
    AND pg_catalog.array_position(images, NULL::text) IS NULL
    AND pg_catalog.octet_length(image_dimensions::text) <= 4096
    AND (title_i18n IS NULL OR (
      pg_catalog.jsonb_typeof(title_i18n) = 'object'
      AND pg_catalog.octet_length(title_i18n::text) <= 16384
    ))
    AND (description_i18n IS NULL OR (
      pg_catalog.jsonb_typeof(description_i18n) = 'object'
      AND pg_catalog.octet_length(description_i18n::text) <= 65536
    ))
  ) NOT VALID;

ALTER TABLE public.posts
  ADD CONSTRAINT posts_public_payload_boundary CHECK (
    pg_catalog.char_length(content) BETWEEN 1 AND 2000
    AND pg_catalog.octet_length(content) <= 8000
    AND images IS NOT NULL
    AND pg_catalog.cardinality(images) <= 4
    AND pg_catalog.array_position(images, NULL::text) IS NULL
    AND pg_catalog.octet_length(image_dimensions::text) <= 4096
    AND (content_i18n IS NULL OR (
      pg_catalog.jsonb_typeof(content_i18n) = 'object'
      AND pg_catalog.octet_length(content_i18n::text) <= 65536
    ))
  ) NOT VALID;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_public_payload_boundary CHECK (
    pg_catalog.char_length(pg_catalog.btrim(content)) BETWEEN 1 AND 2000
    AND pg_catalog.octet_length(content) <= 8000
  ) NOT VALID;

ALTER TABLE public.post_comments
  ADD CONSTRAINT post_comments_public_payload_boundary CHECK (
    pg_catalog.char_length(pg_catalog.btrim(content)) BETWEEN 1 AND 1000
    AND pg_catalog.octet_length(content) <= 4000
  ) NOT VALID;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_public_payload_boundary CHECK (
    pg_catalog.char_length(pg_catalog.btrim(reason)) BETWEEN 1 AND 50
    AND pg_catalog.octet_length(reason) <= 200
    AND (note IS NULL OR (
      pg_catalog.char_length(note) <= 500
      AND pg_catalog.octet_length(note) <= 2000
    ))
  ) NOT VALID;

ALTER TABLE public.ratings
  ADD CONSTRAINT ratings_public_payload_boundary CHECK (
    comment IS NULL OR (
      pg_catalog.char_length(comment) <= 500
      AND pg_catalog.octet_length(comment) <= 2000
    )
  ) NOT VALID;

ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_public_payload_boundary;
ALTER TABLE public.items VALIDATE CONSTRAINT items_public_payload_boundary;
ALTER TABLE public.posts VALIDATE CONSTRAINT posts_public_payload_boundary;
ALTER TABLE public.messages VALIDATE CONSTRAINT messages_public_payload_boundary;
ALTER TABLE public.post_comments VALIDATE CONSTRAINT post_comments_public_payload_boundary;
ALTER TABLE public.reports VALIDATE CONSTRAINT reports_public_payload_boundary;
ALTER TABLE public.ratings VALIDATE CONSTRAINT ratings_public_payload_boundary;

-- Existing public media must already be canonical local objects before this
-- migration can become the new authority.  Legacy validation is portable
-- across Supabase project refs, but still proves owner path + object existence.
DO $legacy_media_validation$
DECLARE
  row_value record;
BEGIN
  FOR row_value IN SELECT id, avatar_url FROM public.profiles
  LOOP
    PERFORM private.assert_local_avatar(
      row_value.avatar_url, row_value.id, NULL, true
    );
  END LOOP;

  FOR row_value IN
    SELECT id, user_id, images, image_dimensions FROM public.items
  LOOP
    PERFORM private.assert_local_media_array(
      row_value.images, row_value.user_id, 9, NULL, true, 'item_images'
    );
    PERFORM private.assert_image_dimensions(
      row_value.image_dimensions,
      pg_catalog.cardinality(row_value.images),
      9,
      'item_image_dimensions'
    );
  END LOOP;

  FOR row_value IN
    SELECT id, user_id, images, image_dimensions FROM public.posts
  LOOP
    PERFORM private.assert_local_media_array(
      row_value.images, row_value.user_id, 4, NULL, true, 'post_images'
    );
    PERFORM private.assert_image_dimensions(
      row_value.image_dimensions,
      pg_catalog.cardinality(row_value.images),
      4,
      'post_image_dimensions'
    );
  END LOOP;

  -- Historical chat media remains visible only as retained evidence.  Prove
  -- that every retained URL was local and owner-bound; new media messages are
  -- rejected below until private chat storage exists.
  FOR row_value IN
    SELECT id, sender_id, content FROM public.messages
    WHERE message_type IN ('image', 'video')
  LOOP
    PERFORM private.assert_local_media_array(
      ARRAY[row_value.content], row_value.sender_id, 1, NULL, true,
      'historical_chat_media'
    );
  END LOOP;
END
$legacy_media_validation$;

CREATE OR REPLACE FUNCTION private.enforce_public_write_payload_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  request_origin text := private.public_write_request_origin();
  exact_stickers constant text[] := ARRAY[
    '[sticker:smile]',
    '[sticker:laugh]',
    '[sticker:love]',
    '[sticker:thumbs-up]',
    '[sticker:thumbs-down]',
    '[sticker:clap]',
    '[sticker:pray]',
    '[sticker:cry]',
    '[sticker:surprise]',
    '[sticker:sparkle]',
    '[sticker:fire]',
    '[sticker:question]',
    '[sticker:obo]',
    '[sticker:verified-pickup]',
    '[sticker:study-group]'
  ];
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    IF TG_OP = 'INSERT' OR NEW.nickname IS DISTINCT FROM OLD.nickname THEN
      PERFORM private.assert_text_boundary(
        NEW.nickname, 'profile_nickname', 1, 40, 160, false
      );
      PERFORM private.assert_moderated_text(NEW.nickname, 'profile_nickname');
    END IF;
    IF TG_OP = 'INSERT' OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url THEN
      PERFORM private.assert_text_boundary(
        NEW.avatar_url, 'profile_avatar', 0, 500, 500, true
      );
      PERFORM private.assert_local_avatar(
        NEW.avatar_url, NEW.id, request_origin, false
      );
    END IF;
    IF TG_OP = 'INSERT' OR NEW.bio IS DISTINCT FROM OLD.bio THEN
      PERFORM private.assert_text_boundary(NEW.bio, 'profile_bio', 0, 200, 800, true);
      PERFORM private.assert_moderated_text(NEW.bio, 'profile_bio');
    END IF;
    IF TG_OP = 'INSERT' OR NEW.location IS DISTINCT FROM OLD.location THEN
      PERFORM private.assert_text_boundary(
        NEW.location, 'profile_location', 0, 80, 320, true
      );
      PERFORM private.assert_moderated_text(NEW.location, 'profile_location');
    END IF;
    IF TG_OP = 'INSERT' OR NEW.status_text IS DISTINCT FROM OLD.status_text THEN
      PERFORM private.assert_text_boundary(
        NEW.status_text, 'profile_status', 0, 60, 240, true
      );
      PERFORM private.assert_moderated_text(NEW.status_text, 'profile_status');
    END IF;
    IF TG_OP = 'INSERT' OR NEW.status_emoji IS DISTINCT FROM OLD.status_emoji THEN
      PERFORM private.assert_text_boundary(
        NEW.status_emoji, 'profile_status_emoji', 0, 8, 64, true
      );
    END IF;

  ELSIF TG_TABLE_NAME = 'items' THEN
    IF TG_OP = 'INSERT' OR NEW.title IS DISTINCT FROM OLD.title THEN
      PERFORM private.assert_text_boundary(NEW.title, 'item_title', 1, 200, 800, false);
      PERFORM private.assert_moderated_text(NEW.title, 'item_title');
    END IF;
    IF TG_OP = 'INSERT' OR NEW.description IS DISTINCT FROM OLD.description THEN
      PERFORM private.assert_text_boundary(
        NEW.description, 'item_description', 0, 2000, 8000, true
      );
      PERFORM private.assert_moderated_text(NEW.description, 'item_description');
    END IF;
    IF TG_OP = 'INSERT' OR NEW.location IS DISTINCT FROM OLD.location THEN
      PERFORM private.assert_text_boundary(NEW.location, 'item_location', 0, 80, 320, true);
      PERFORM private.assert_moderated_text(NEW.location, 'item_location');
    END IF;
    IF TG_OP = 'INSERT' OR NEW.images IS DISTINCT FROM OLD.images THEN
      PERFORM private.assert_local_media_array(
        NEW.images, NEW.user_id, 9, request_origin, false, 'item_images'
      );
    END IF;
    IF TG_OP = 'INSERT'
       OR NEW.images IS DISTINCT FROM OLD.images
       OR NEW.image_dimensions IS DISTINCT FROM OLD.image_dimensions THEN
      PERFORM private.assert_image_dimensions(
        NEW.image_dimensions, pg_catalog.cardinality(NEW.images), 9,
        'item_image_dimensions'
      );
    END IF;
    IF TG_OP = 'INSERT' OR NEW.title_i18n IS DISTINCT FROM OLD.title_i18n THEN
      PERFORM private.assert_i18n_payload(
        NEW.title_i18n, 'item_title_i18n', 200, 800, 16384
      );
    END IF;
    IF TG_OP = 'INSERT'
       OR NEW.description_i18n IS DISTINCT FROM OLD.description_i18n THEN
      PERFORM private.assert_i18n_payload(
        NEW.description_i18n, 'item_description_i18n', 2000, 8000, 65536
      );
    END IF;

  ELSIF TG_TABLE_NAME = 'posts' THEN
    IF TG_OP = 'INSERT' OR NEW.content IS DISTINCT FROM OLD.content THEN
      -- The existing post-items flow uses exactly one ASCII space as its
      -- durable placeholder for image-only / attached-item-only posts.
      IF NEW.content IS DISTINCT FROM ' ' THEN
        PERFORM private.assert_text_boundary(NEW.content, 'post_content', 1, 2000, 8000, false);
        PERFORM private.assert_moderated_text(NEW.content, 'post_content');
      END IF;
    END IF;
    IF TG_OP = 'INSERT' OR NEW.images IS DISTINCT FROM OLD.images THEN
      PERFORM private.assert_local_media_array(
        NEW.images, NEW.user_id, 4, request_origin, false, 'post_images'
      );
    END IF;
    IF TG_OP = 'INSERT'
       OR NEW.images IS DISTINCT FROM OLD.images
       OR NEW.image_dimensions IS DISTINCT FROM OLD.image_dimensions THEN
      PERFORM private.assert_image_dimensions(
        NEW.image_dimensions, pg_catalog.cardinality(NEW.images), 4,
        'post_image_dimensions'
      );
    END IF;
    IF TG_OP = 'INSERT' OR NEW.content_i18n IS DISTINCT FROM OLD.content_i18n THEN
      PERFORM private.assert_i18n_payload(
        NEW.content_i18n, 'post_content_i18n', 2000, 8000, 65536
      );
    END IF;

  ELSIF TG_TABLE_NAME = 'messages' THEN
    IF TG_OP = 'INSERT'
       OR NEW.content IS DISTINCT FROM OLD.content
       OR NEW.message_type IS DISTINCT FROM OLD.message_type THEN
      PERFORM private.assert_text_boundary(
        NEW.content, 'message_content', 1, 2000, 8000, false
      );
      IF NEW.message_type <> 'text' THEN
        RAISE EXCEPTION 'chat_media_private_storage_required'
          USING ERRCODE = '22023';
      ELSIF NEW.content = ANY (exact_stickers) THEN
        NULL;
      ELSIF NEW.content ~ '^\[sticker:[a-z-]+\]$' THEN
        RAISE EXCEPTION 'public_write_boundary:invalid_sticker'
          USING ERRCODE = '22023';
      ELSE
        PERFORM private.assert_moderated_text(NEW.content, 'message_content');
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'post_comments' THEN
    IF TG_OP = 'INSERT' OR NEW.content IS DISTINCT FROM OLD.content THEN
      PERFORM private.assert_text_boundary(
        NEW.content, 'comment_content', 1, 1000, 4000, false
      );
      PERFORM private.assert_moderated_text(NEW.content, 'comment_content');
    END IF;

  ELSIF TG_TABLE_NAME = 'reports' THEN
    IF TG_OP = 'INSERT' OR NEW.reason IS DISTINCT FROM OLD.reason THEN
      PERFORM private.assert_text_boundary(NEW.reason, 'report_reason', 1, 50, 200, false);
    END IF;
    IF TG_OP = 'INSERT' OR NEW.note IS DISTINCT FROM OLD.note THEN
      -- Report notes may quote the abuse being reported; size is authoritative,
      -- but content moderation must not erase evidence or prevent reporting.
      PERFORM private.assert_text_boundary(NEW.note, 'report_note', 0, 500, 2000, true);
    END IF;

  ELSIF TG_TABLE_NAME = 'ratings' THEN
    IF TG_OP = 'INSERT' OR NEW.comment IS DISTINCT FROM OLD.comment THEN
      PERFORM private.assert_text_boundary(
        NEW.comment, 'rating_comment', 0, 500, 2000, true
      );
      PERFORM private.assert_moderated_text(NEW.comment, 'rating_comment');
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.enforce_public_write_payload_boundary()
  FROM PUBLIC;

DROP TRIGGER IF EXISTS authoritative_public_write_boundary ON public.profiles;
CREATE TRIGGER authoritative_public_write_boundary
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.enforce_public_write_payload_boundary();

DROP TRIGGER IF EXISTS authoritative_public_write_boundary ON public.items;
CREATE TRIGGER authoritative_public_write_boundary
  BEFORE INSERT OR UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION private.enforce_public_write_payload_boundary();

DROP TRIGGER IF EXISTS authoritative_public_write_boundary ON public.posts;
CREATE TRIGGER authoritative_public_write_boundary
  BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION private.enforce_public_write_payload_boundary();

DROP TRIGGER IF EXISTS authoritative_public_write_boundary ON public.messages;
CREATE TRIGGER authoritative_public_write_boundary
  BEFORE INSERT OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.enforce_public_write_payload_boundary();

DROP TRIGGER IF EXISTS authoritative_public_write_boundary ON public.post_comments;
CREATE TRIGGER authoritative_public_write_boundary
  BEFORE INSERT OR UPDATE ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION private.enforce_public_write_payload_boundary();

DROP TRIGGER IF EXISTS authoritative_public_write_boundary ON public.reports;
CREATE TRIGGER authoritative_public_write_boundary
  BEFORE INSERT OR UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION private.enforce_public_write_payload_boundary();

DROP TRIGGER IF EXISTS authoritative_public_write_boundary ON public.ratings;
CREATE TRIGGER authoritative_public_write_boundary
  BEFORE INSERT OR UPDATE ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION private.enforce_public_write_payload_boundary();

-- Bucket-level enforcement uses Storage's actual upload limit and declared MIME
-- allowlist.  The database trigger below additionally bounds path, object count,
-- declared metadata size and creation rate for authenticated public uploads.
UPDATE storage.buckets
SET file_size_limit = 5242880,
    allowed_mime_types = ARRAY[
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/heic',
      'image/heif',
      'image/heic-sequence',
      'image/heif-sequence'
    ]::text[]
WHERE id = 'item-images';

UPDATE storage.buckets
SET file_size_limit = 2097152,
    allowed_mime_types = ARRAY[
      'image/jpeg',
      'image/png',
      'image/webp'
    ]::text[]
WHERE id = 'banners';

DROP POLICY IF EXISTS "Authenticated users can upload to own folder"
  ON storage.objects;
CREATE POLICY "Authenticated users can upload to own folder"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'item-images'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = 'items'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP TRIGGER IF EXISTS enforce_item_image_mime ON storage.objects;
DROP FUNCTION IF EXISTS public.enforce_item_image_mime();

CREATE OR REPLACE FUNCTION private.enforce_item_storage_resource_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  declared_mime text;
  declared_size bigint;
  object_count bigint;
  recent_count bigint;
  aggregate_size bigint;
BEGIN
  IF NEW.bucket_id <> 'item-images' THEN RETURN NEW; END IF;

  -- Service-side maintenance may create metadata rows without end-user claims.
  -- Such rows cannot be attached by a public write without a verifiable issuer.
  IF actor_id IS NULL THEN RETURN NEW; END IF;

  IF pg_catalog.length(NEW.name) > 343
     OR pg_catalog.octet_length(NEW.name) > 343
     OR NEW.name !~ (
       '^items/' || actor_id::text || '/[A-Za-z0-9][A-Za-z0-9._/-]*$'
     )
     OR NEW.name LIKE '%//%'
     OR NEW.name LIKE '%/./%'
     OR NEW.name LIKE '%/../%'
     OR pg_catalog.right(NEW.name, 1) IN ('.', '/') THEN
    RAISE EXCEPTION 'storage_boundary:invalid_owner_path'
      USING ERRCODE = '22023';
  END IF;

  declared_mime := pg_catalog.lower(NEW.metadata ->> 'mimetype');
  IF declared_mime IS NULL OR declared_mime NOT IN (
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif',
    'image/heic-sequence',
    'image/heif-sequence'
  ) THEN
    RAISE EXCEPTION 'storage_boundary:invalid_image_type'
      USING ERRCODE = '22023';
  END IF;

  IF (NEW.metadata ->> 'size') !~ '^[1-9][0-9]{0,7}$' THEN
    RAISE EXCEPTION 'storage_boundary:invalid_size'
      USING ERRCODE = '22023';
  END IF;
  declared_size := (NEW.metadata ->> 'size')::bigint;
  IF declared_size > 5242880 THEN
    RAISE EXCEPTION 'storage_boundary:file_too_large'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text, 230000)
  );

  SELECT pg_catalog.count(*),
         pg_catalog.count(*) FILTER (
           WHERE object.created_at >= pg_catalog.now() - interval '1 hour'
         ),
         COALESCE(pg_catalog.sum(
           CASE
             WHEN (object.metadata ->> 'size') ~ '^[1-9][0-9]{0,18}$'
             THEN (object.metadata ->> 'size')::bigint
             ELSE 0
           END
         ), 0)
    INTO object_count, recent_count, aggregate_size
  FROM storage.objects AS object
  WHERE object.bucket_id = 'item-images'
    AND pg_catalog.split_part(object.name, '/', 1) = 'items'
    AND pg_catalog.split_part(object.name, '/', 2) = actor_id::text
    AND (TG_OP = 'INSERT' OR object.id <> OLD.id);

  IF object_count >= 250 THEN
    RAISE EXCEPTION 'storage_boundary:object_quota'
      USING ERRCODE = '54000';
  END IF;
  IF TG_OP = 'INSERT' AND recent_count >= 60 THEN
    RAISE EXCEPTION 'storage_boundary:hourly_rate'
      USING ERRCODE = '54000';
  END IF;
  IF aggregate_size + declared_size > 262144000 THEN
    RAISE EXCEPTION 'storage_boundary:byte_quota'
      USING ERRCODE = '54000';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.enforce_item_storage_resource_boundary()
  FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_item_storage_resource_boundary
  ON storage.objects;
CREATE TRIGGER enforce_item_storage_resource_boundary
  BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION private.enforce_item_storage_resource_boundary();

-- Keep the admin upload ledger aligned with the now-static banner MIME policy.
-- Legacy GIFs that were successfully made available/attached remain retained;
-- abandoned prepared GIFs are pushed into GC and can no longer be attached.
ALTER TABLE public.admin_banner_uploads
  ADD COLUMN IF NOT EXISTS legacy_gif_retained boolean NOT NULL DEFAULT false;

UPDATE public.admin_banner_uploads
SET legacy_gif_retained = true
WHERE mime_type = 'image/gif';

UPDATE public.admin_banner_uploads
SET status = 'gc_pending',
    gc_after = LEAST(gc_after, pg_catalog.now())
WHERE mime_type = 'image/gif'
  AND status = 'prepared';

DO $legacy_banner_gif_precheck$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.admin_banner_uploads
    WHERE mime_type = 'image/gif'
      AND status NOT IN ('available', 'attached', 'gc_pending', 'deleted')
  ) THEN
    RAISE EXCEPTION 'banner_boundary:unsupported_legacy_gif_state';
  END IF;
END
$legacy_banner_gif_precheck$;

ALTER TABLE public.admin_banner_uploads
  DROP CONSTRAINT admin_banner_uploads_mime_type_check;
ALTER TABLE public.admin_banner_uploads
  ADD CONSTRAINT admin_banner_uploads_mime_type_check CHECK (
    (
      mime_type IN ('image/png', 'image/jpeg', 'image/webp')
      AND NOT legacy_gif_retained
    )
    OR (
      mime_type = 'image/gif'
      AND legacy_gif_retained
      AND status IN ('available', 'attached', 'gc_pending', 'deleted')
    )
  );

ALTER TABLE public.admin_banner_uploads
  DROP CONSTRAINT admin_banner_uploads_object_name_check;
ALTER TABLE public.admin_banner_uploads
  ADD CONSTRAINT admin_banner_uploads_object_name_check CHECK (
    object_name ~ '^managed/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}\.(png|jpg|webp)$'
    OR (
      mime_type = 'image/gif'
      AND legacy_gif_retained
      AND status IN ('available', 'attached', 'gc_pending', 'deleted')
      AND object_name ~ '^managed/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}\.gif$'
    )
  );

COMMENT ON CONSTRAINT admin_banner_uploads_mime_type_check
  ON public.admin_banner_uploads IS
  'New banner uploads are PNG/JPEG/WebP only; migration-marked retained legacy GIF evidence cannot be recreated through the upload RPC.';

NOTIFY pgrst, 'reload schema';
