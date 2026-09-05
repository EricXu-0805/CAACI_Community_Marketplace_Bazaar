-- ============================================================
-- 20260904090000 — Somewhere private to put a taken-down photo
-- ============================================================
-- admin_takedown_content (073) is a soft hide: one UPDATE setting
-- items.status = 'deleted'. That correctly removes the listing from every read
-- path, and the migration header says a status flip was chosen precisely so
-- the read path and RLS would not have to change.
--
-- What it does not do is touch the photo. item-images is public = true, and
-- 068_storage_list_lockdown says it outright: public reads by URL bypass RLS
-- entirely. So a listing pulled because its photo showed a student's child,
-- their front door or their address keeps serving that photo at
--
--   https://<ref>.supabase.co/storage/v1/object/public/item-images/items/<uid>/<file>
--
-- and that URL is not an unguessable secret — api/share.js already emitted it
-- as the og:image of the crawlable /share/<id> page, so it is baked into every
-- link-preview card the listing was ever forwarded with.
--
-- Nothing collects it. The admin endpoint calls the RPC and touches no
-- storage; data-retention purges only rate limits, verifications and WeChat
-- media checks; no GC considers the object because the row still exists and
-- still references it. The seller's own delete button does better than the
-- moderator's takedown: useItems.ts hard-DELETEs the row and then calls
-- storage.remove() on the paths.
--
-- WHY MOVE RATHER THAN DELETE
-- ---------------------------
-- Eric's call, 2026-09-04. A takedown is a soft hide so that the evidence
-- survives — 20260717194334 preserves conversations and reports for exactly
-- that reason, and an appeal (20260720035037) is decided on what was actually
-- posted. Deleting the photo would answer the reporter and disarm the appeal
-- at the same time. Moving it out of the public bucket ends the exposure,
-- which is the whole of what the reporter asked for, and keeps the bytes.
--
-- This bucket has no policies at all, which is the point: RLS denies by
-- default, so anon and authenticated can neither read nor list it, and there
-- is no public URL because public = false. service_role bypasses RLS, so the
-- admin edge function can still write and read it.
--
-- Mirrors item-images' limits so a move can never be refused for a file the
-- source bucket already accepted.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'moderation-evidence',
  'moderation-evidence',
  false,
  5242880,
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Deliberately no policies and no grants beyond this INSERT. storage.objects
-- has RLS on, so with nothing granting access to this bucket, anon and
-- authenticated can neither read nor list it; service_role bypasses RLS and
-- can. Touching the grants on storage.buckets itself is avoided on purpose —
-- that table is shared with item-images and banners, and narrowing it here
-- would change how the two public buckets behave for reasons that have
-- nothing to do with them.
