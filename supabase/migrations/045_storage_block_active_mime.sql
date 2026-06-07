-- ============================================
-- 045 Storage — block active/script MIME types in item-images
-- ============================================
-- Audit finding (SECURITY_AUDIT.md:304-335): upload MIME type is validated
-- client-side only (detectImageMimeType, utils/index.ts), and the storage RLS
-- policy (mig 011) checks the path but not the content type. A direct REST/SDK
-- call can upload a non-image to the user's own items/<uid>/ folder.
--
-- Threat re-scoped for THIS app: every image surface renders via <image>/<img>
-- `src` (Supabase render path for thumbs; raw URL only inside <img>), so SVG/
-- HTML bytes are NOT executed as a document — they don't run script. The one
-- realistic stored-XSS vector is an object SERVED with an active content-type
-- (image/svg+xml, text/html, *xml, javascript). This trigger blocks exactly
-- those declared types in the item-images bucket.
--
-- DESIGN — fail open: this is a DENYLIST, not an allowlist. It rejects only the
-- handful of script/markup content-types; anything else (incl. NULL metadata or
-- the rare 'application/octet-stream' fallback from detectImageMimeType) passes
-- untouched, so a legitimate image upload can never be blocked by this. The
-- full byte-level allowlist (magic-byte check in an upload-proxy Edge Function)
-- remains an optional future hardening — see
-- docs/audit/SECURITY_SPECS_currency_and_mime.md.
--
-- The function lives in `public` (always writable); the trigger attaches to
-- storage.objects. If CREATE TRIGGER ON storage.objects raises a permission
-- error on this project/plan, the metadata block isn't available here — fall
-- back to the Edge Function approach in the spec. No other migration depends
-- on this.
--
-- Idempotent (CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER).
-- ============================================

CREATE OR REPLACE FUNCTION public.enforce_item_image_mime()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mt text := lower(NEW.metadata->>'mimetype');
BEGIN
  IF NEW.bucket_id <> 'item-images' THEN
    RETURN NEW;
  END IF;

  -- Only reject when a DECLARED, script/markup content-type is present.
  -- NULL metadata or any non-listed type passes (fail open → never blocks a
  -- real image upload).
  IF mt IS NOT NULL AND mt IN (
    'image/svg+xml',
    'text/html',
    'text/xml',
    'application/xml',
    'application/xhtml+xml',
    'application/javascript',
    'text/javascript'
  ) THEN
    RAISE EXCEPTION 'invalid_image_type'
      USING HINT = 'Only image files are allowed (SVG/HTML/script types are blocked).';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_item_image_mime ON storage.objects;
CREATE TRIGGER enforce_item_image_mime
  BEFORE INSERT ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_item_image_mime();

-- --------------------------------------------
-- Verification (run after apply):
--   -- (1) trigger present:
--   SELECT tgname FROM pg_trigger
--     WHERE tgrelid = 'storage.objects'::regclass AND tgname = 'enforce_item_image_mime';
--   -- (2) a normal image upload from the app should still succeed.
--   -- (3) function logic spot-check (does not touch storage):
--   SELECT public.enforce_item_image_mime IS NOT NULL;  -- exists
-- --------------------------------------------
