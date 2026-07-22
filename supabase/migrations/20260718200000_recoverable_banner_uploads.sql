-- Recoverable, idempotent banner-image uploads with storage garbage collection.
--
-- PostgreSQL and Supabase Storage cannot share one transaction. This migration
-- therefore makes the boundary an explicit saga:
--   prepare (durable intent) -> deterministic object PUT -> complete
--   (required audit) -> attach to a banner -> GC after detachment/abandonment.
-- Every retry uses the same token/idempotency key and object name.

BEGIN;

CREATE TABLE public.admin_banner_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_token_id uuid NOT NULL
    REFERENCES public.admin_tokens(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  actor_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  admin_role text NOT NULL CHECK (admin_role = 'owner'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  mime_type text NOT NULL CHECK (
    mime_type IN ('image/png', 'image/jpeg', 'image/webp')
  ),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 2097152),
  object_name text NOT NULL UNIQUE CHECK (
    object_name ~ '^managed/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}\.(png|jpg|webp)$'
  ),
  public_path text GENERATED ALWAYS AS (
    '/storage/v1/object/public/banners/' || object_name
  ) STORED,
  status text NOT NULL DEFAULT 'prepared' CHECK (
    status IN ('prepared', 'available', 'attached', 'gc_pending', 'deleted')
  ),
  banner_id uuid REFERENCES public.banners(id) ON DELETE SET NULL,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  attached_at timestamptz,
  detached_at timestamptz,
  gc_after timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  gc_claim_id uuid,
  gc_claim_expires_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (admin_token_id, idempotency_key),
  UNIQUE (public_path),
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
  CHECK (
    (gc_claim_id IS NULL AND gc_claim_expires_at IS NULL)
    OR (gc_claim_id IS NOT NULL AND gc_claim_expires_at IS NOT NULL)
  )
);

ALTER TABLE public.admin_banner_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_banner_uploads
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX admin_banner_uploads_gc_idx
  ON public.admin_banner_uploads (gc_after, prepared_at)
  WHERE status IN ('prepared', 'available', 'gc_pending');

CREATE INDEX admin_banner_uploads_banner_idx
  ON public.admin_banner_uploads (banner_id)
  WHERE banner_id IS NOT NULL;

COMMENT ON TABLE public.admin_banner_uploads IS
  'Service-only saga ledger for deterministic banner storage uploads and pending GC.';

CREATE FUNCTION public.admin_prepare_banner_upload(
  p_token_hash text,
  p_idempotency_key uuid,
  p_content_hash text,
  p_mime_type text,
  p_size_bytes integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  token_id uuid;
  actor_id uuid;
  token_role text;
  extension text;
  existing public.admin_banner_uploads%ROWTYPE;
  next_status text;
  referenced boolean;
BEGIN
  IF p_idempotency_key IS NULL
     OR p_content_hash IS NULL
     OR p_content_hash !~ '^[0-9a-f]{64}$'
     OR p_size_bytes IS NULL
     OR p_size_bytes NOT BETWEEN 1 AND 2097152 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_upload_invalid';
  END IF;

  extension := CASE p_mime_type
    WHEN 'image/png' THEN 'png'
    WHEN 'image/jpeg' THEN 'jpg'
    WHEN 'image/webp' THEN 'webp'
    ELSE NULL
  END;
  IF extension IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_upload_invalid';
  END IF;

  SELECT token.id, token.admin_id, token.role
    INTO token_id, actor_id, token_role
    FROM public.admin_tokens AS token
   WHERE token.token_hash = p_token_hash
     AND token.revoked_at IS NULL
     AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
   FOR UPDATE;
  IF token_id IS NULL OR actor_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '28000',
      MESSAGE = 'admin_token_inactive';
  END IF;

  PERFORM public.admin_assert_mutation_capability(token_id, 'upload_banner');

  SELECT upload.*
    INTO existing
    FROM public.admin_banner_uploads AS upload
   WHERE upload.admin_token_id = token_id
     AND upload.idempotency_key = p_idempotency_key
   FOR UPDATE;

  IF FOUND THEN
    IF existing.content_hash <> p_content_hash
       OR existing.mime_type <> p_mime_type
       OR existing.size_bytes <> p_size_bytes THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'idempotency_conflict';
    END IF;
    IF existing.status = 'deleted' THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'admin_upload_expired';
    END IF;
    IF existing.gc_claim_id IS NOT NULL
       AND existing.gc_claim_expires_at > pg_catalog.now() THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'admin_upload_gc_in_progress';
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM public.banners AS banner
       WHERE pg_catalog.right(
         banner.image_url,
         pg_catalog.length(existing.public_path)
       ) = existing.public_path
    ) INTO referenced;

    next_status := CASE
      WHEN existing.completed_at IS NULL THEN 'prepared'
      WHEN referenced THEN 'attached'
      ELSE 'available'
    END;

    UPDATE public.admin_banner_uploads AS upload
       SET status = next_status,
           banner_id = CASE WHEN referenced THEN upload.banner_id ELSE NULL END,
           gc_after = CASE
             WHEN referenced THEN pg_catalog.now() + interval '100 years'
             WHEN existing.completed_at IS NULL THEN pg_catalog.now() + interval '1 hour'
             ELSE pg_catalog.now() + interval '24 hours'
           END,
           gc_claim_id = NULL,
           gc_claim_expires_at = NULL,
           deleted_at = NULL
     WHERE upload.id = existing.id
    RETURNING upload.* INTO existing;

    RETURN pg_catalog.jsonb_build_object(
      'object_name', existing.object_name,
      'status', existing.status
    );
  END IF;

  INSERT INTO public.admin_banner_uploads (
    admin_token_id,
    idempotency_key,
    actor_id,
    admin_role,
    content_hash,
    mime_type,
    size_bytes,
    object_name,
    gc_after
  ) VALUES (
    token_id,
    p_idempotency_key,
    actor_id,
    token_role,
    p_content_hash,
    p_mime_type,
    p_size_bytes,
    'managed/' || token_id::text || '/' || p_idempotency_key::text || '/'
      || p_content_hash || '.' || extension,
    pg_catalog.now() + interval '1 hour'
  )
  RETURNING * INTO existing;

  RETURN pg_catalog.jsonb_build_object(
    'object_name', existing.object_name,
    'status', existing.status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_prepare_banner_upload(
  text, uuid, text, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_prepare_banner_upload(
  text, uuid, text, text, integer
) TO service_role;

CREATE FUNCTION public.admin_complete_banner_upload(
  p_token_hash text,
  p_idempotency_key uuid,
  p_content_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  token_id uuid;
  actor_id uuid;
  token_role text;
  upload public.admin_banner_uploads%ROWTYPE;
  referenced boolean;
BEGIN
  SELECT token.id, token.admin_id, token.role
    INTO token_id, actor_id, token_role
    FROM public.admin_tokens AS token
   WHERE token.token_hash = p_token_hash
     AND token.revoked_at IS NULL
     AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
   FOR UPDATE;
  IF token_id IS NULL OR actor_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '28000',
      MESSAGE = 'admin_token_inactive';
  END IF;

  PERFORM public.admin_assert_mutation_capability(token_id, 'upload_banner');

  SELECT candidate.*
    INTO upload
    FROM public.admin_banner_uploads AS candidate
   WHERE candidate.admin_token_id = token_id
     AND candidate.idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'admin_upload_not_found';
  END IF;
  IF upload.content_hash <> p_content_hash THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'idempotency_conflict';
  END IF;
  IF upload.status = 'deleted' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'admin_upload_expired';
  END IF;
  IF upload.gc_claim_id IS NOT NULL
     AND upload.gc_claim_expires_at > pg_catalog.now() THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'admin_upload_gc_in_progress';
  END IF;

  IF upload.completed_at IS NULL THEN
    PERFORM pg_catalog.set_config('admin.actor_id', actor_id::text, true);
    PERFORM pg_catalog.set_config('admin.token_id', token_id::text, true);
    PERFORM pg_catalog.set_config(
      'admin.idempotency_key',
      p_idempotency_key::text,
      true
    );
    PERFORM pg_catalog.set_config('admin.role', token_role, true);
    PERFORM pg_catalog.set_config('admin.audit_required', 'on', true);

    PERFORM public.record_audit(
      'banner_changed',
      actor_id,
      NULL,
      pg_catalog.jsonb_build_object(
        'via', 'admin_banner_upload_saga',
        'op', 'image_uploaded',
        'object_name', upload.object_name,
        'content_hash', upload.content_hash,
        'mime_type', upload.mime_type,
        'size_bytes', upload.size_bytes,
        'admin_role', token_role
      )
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.banners AS banner
     WHERE pg_catalog.right(
       banner.image_url,
       pg_catalog.length(upload.public_path)
     ) = upload.public_path
  ) INTO referenced;

  UPDATE public.admin_banner_uploads AS candidate
     SET status = CASE WHEN referenced THEN 'attached' ELSE 'available' END,
         completed_at = COALESCE(candidate.completed_at, pg_catalog.now()),
         attached_at = CASE
           WHEN referenced THEN COALESCE(candidate.attached_at, pg_catalog.now())
           ELSE candidate.attached_at
         END,
         gc_after = CASE
           WHEN referenced THEN pg_catalog.now() + interval '100 years'
           ELSE pg_catalog.now() + interval '24 hours'
         END,
         gc_claim_id = NULL,
         gc_claim_expires_at = NULL
   WHERE candidate.id = upload.id
  RETURNING candidate.* INTO upload;

  RETURN pg_catalog.jsonb_build_object(
    'object_name', upload.object_name,
    'status', upload.status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_complete_banner_upload(text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_complete_banner_upload(text, uuid, text)
  TO service_role;

-- A banner row is the public rendering boundary. New rows and actual image
-- changes must point at a completed deterministic upload; otherwise an owner
-- token could bypass the saga with a third-party tracking pixel or an orphaned
-- object. Existing legacy URLs may remain while operators edit unrelated
-- fields, but changing one requires replacing it with a managed upload.
CREATE FUNCTION public.admin_validate_banner_managed_upload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  matched public.admin_banner_uploads%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.image_url IS NOT DISTINCT FROM OLD.image_url THEN
    RETURN NEW;
  END IF;

  SELECT upload.*
    INTO matched
    FROM public.admin_banner_uploads AS upload
   WHERE NEW.image_url ~
     '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/storage/v1/object/public/banners/managed/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}\.(png|jpg|webp)$'
     AND pg_catalog.right(
       NEW.image_url,
       pg_catalog.length(upload.public_path)
     ) = upload.public_path
     AND upload.completed_at IS NOT NULL
     AND upload.status <> 'deleted'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_upload_required';
  END IF;

  IF matched.gc_claim_id IS NOT NULL
     AND matched.gc_claim_expires_at > pg_catalog.now() THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'admin_upload_gc_in_progress';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_validate_banner_managed_upload()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER banners_require_managed_upload
BEFORE INSERT OR UPDATE OF image_url
ON public.banners
FOR EACH ROW
EXECUTE FUNCTION public.admin_validate_banner_managed_upload();

CREATE FUNCTION public.admin_reconcile_banner_upload_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  matched public.admin_banner_uploads%ROWTYPE;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND (TG_OP = 'DELETE' OR OLD.image_url IS DISTINCT FROM NEW.image_url) THEN
    UPDATE public.admin_banner_uploads AS upload
       SET status = 'gc_pending',
           banner_id = NULL,
           detached_at = pg_catalog.now(),
           gc_after = pg_catalog.now() + interval '24 hours',
           gc_claim_id = NULL,
           gc_claim_expires_at = NULL
     WHERE upload.status <> 'deleted'
       AND upload.completed_at IS NOT NULL
       AND pg_catalog.right(
         OLD.image_url,
         pg_catalog.length(upload.public_path)
       ) = upload.public_path
       AND NOT EXISTS (
         SELECT 1
           FROM public.banners AS remaining_banner
          WHERE pg_catalog.right(
            remaining_banner.image_url,
            pg_catalog.length(upload.public_path)
          ) = upload.public_path
       );
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT upload.*
      INTO matched
      FROM public.admin_banner_uploads AS upload
     WHERE pg_catalog.right(
       NEW.image_url,
       pg_catalog.length(upload.public_path)
     ) = upload.public_path
     LIMIT 1;

    IF FOUND THEN
      IF matched.status = 'deleted' THEN
        RAISE EXCEPTION USING
          ERRCODE = '55000',
          MESSAGE = 'admin_upload_expired';
      END IF;
      IF matched.gc_claim_id IS NOT NULL
         AND matched.gc_claim_expires_at > pg_catalog.now() THEN
        RAISE EXCEPTION USING
          ERRCODE = '55000',
          MESSAGE = 'admin_upload_gc_in_progress';
      END IF;
      IF matched.completed_at IS NOT NULL THEN
        UPDATE public.admin_banner_uploads AS upload
           SET status = 'attached',
               banner_id = NEW.id,
               attached_at = COALESCE(upload.attached_at, pg_catalog.now()),
               gc_after = pg_catalog.now() + interval '100 years',
               gc_claim_id = NULL,
               gc_claim_expires_at = NULL
         WHERE upload.id = matched.id;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reconcile_banner_upload_reference()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER banners_reconcile_managed_upload
AFTER INSERT OR UPDATE OF image_url OR DELETE
ON public.banners
FOR EACH ROW
EXECUTE FUNCTION public.admin_reconcile_banner_upload_reference();

CREATE FUNCTION public.admin_claim_banner_upload_gc(
  p_claim_id uuid,
  p_limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  object_names text[];
  backlog boolean;
BEGIN
  IF p_claim_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_upload_gc_invalid';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(20260718200000::bigint);

  UPDATE public.admin_banner_uploads AS upload
     SET status = 'gc_pending',
         banner_id = NULL,
         detached_at = COALESCE(upload.detached_at, pg_catalog.now()),
         gc_after = pg_catalog.now() + interval '24 hours',
         gc_claim_id = NULL,
         gc_claim_expires_at = NULL
   WHERE upload.status = 'attached'
     AND NOT EXISTS (
       SELECT 1
         FROM public.banners AS banner
        WHERE pg_catalog.right(
          banner.image_url,
          pg_catalog.length(upload.public_path)
        ) = upload.public_path
     );

  UPDATE public.admin_banner_uploads AS upload
     SET status = 'gc_pending',
         gc_claim_id = NULL,
         gc_claim_expires_at = NULL
   WHERE upload.status IN ('prepared', 'available')
     AND upload.gc_after <= pg_catalog.now()
     AND NOT EXISTS (
       SELECT 1
         FROM public.banners AS banner
        WHERE pg_catalog.right(
          banner.image_url,
          pg_catalog.length(upload.public_path)
        ) = upload.public_path
     );

  WITH candidates AS (
    SELECT upload.id
      FROM public.admin_banner_uploads AS upload
     WHERE upload.status = 'gc_pending'
       AND upload.gc_after <= pg_catalog.now()
       AND (
         upload.gc_claim_id IS NULL
         OR upload.gc_claim_expires_at <= pg_catalog.now()
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.banners AS banner
          WHERE pg_catalog.right(
            banner.image_url,
            pg_catalog.length(upload.public_path)
          ) = upload.public_path
       )
     ORDER BY upload.gc_after, upload.prepared_at
     FOR UPDATE OF upload SKIP LOCKED
     LIMIT p_limit
  ), claimed AS (
    UPDATE public.admin_banner_uploads AS upload
       SET gc_claim_id = p_claim_id,
           gc_claim_expires_at = pg_catalog.now() + interval '15 minutes'
      FROM candidates
     WHERE upload.id = candidates.id
    RETURNING upload.object_name
  )
  SELECT COALESCE(
    pg_catalog.array_agg(claimed.object_name ORDER BY claimed.object_name),
    ARRAY[]::text[]
  ) INTO object_names
  FROM claimed;

  SELECT EXISTS (
    SELECT 1
      FROM public.admin_banner_uploads AS upload
     WHERE upload.status = 'gc_pending'
       AND upload.gc_after <= pg_catalog.now()
       AND (
         upload.gc_claim_id IS NULL
         OR upload.gc_claim_expires_at <= pg_catalog.now()
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.banners AS banner
          WHERE pg_catalog.right(
            banner.image_url,
            pg_catalog.length(upload.public_path)
          ) = upload.public_path
       )
  ) INTO backlog;

  RETURN pg_catalog.jsonb_build_object(
    'object_names', pg_catalog.to_jsonb(object_names),
    'has_more', backlog
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_claim_banner_upload_gc(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_claim_banner_upload_gc(uuid, integer)
  TO service_role;

CREATE FUNCTION public.admin_complete_banner_upload_gc(
  p_claim_id uuid,
  p_object_names text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  expected_count integer;
  deleted_count integer;
BEGIN
  expected_count := pg_catalog.cardinality(p_object_names);
  IF p_claim_id IS NULL
     OR expected_count IS NULL
     OR expected_count NOT BETWEEN 1 AND 50
     OR (
       SELECT pg_catalog.count(DISTINCT input_name.object_name)
         FROM pg_catalog.unnest(p_object_names) AS input_name(object_name)
     ) <> expected_count THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_upload_gc_invalid';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(20260718200000::bigint);

  UPDATE public.admin_banner_uploads AS upload
     SET status = 'deleted',
         banner_id = NULL,
         gc_after = pg_catalog.now() + interval '100 years',
         gc_claim_id = NULL,
         gc_claim_expires_at = NULL,
         deleted_at = pg_catalog.now()
   WHERE upload.gc_claim_id = p_claim_id
     AND upload.status = 'gc_pending'
     AND upload.object_name = ANY(p_object_names)
     AND NOT EXISTS (
       SELECT 1
         FROM public.banners AS banner
        WHERE pg_catalog.right(
          banner.image_url,
          pg_catalog.length(upload.public_path)
        ) = upload.public_path
     );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count <> expected_count THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'admin_upload_gc_state_conflict';
  END IF;
  RETURN deleted_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_complete_banner_upload_gc(uuid, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_complete_banner_upload_gc(uuid, text[])
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
