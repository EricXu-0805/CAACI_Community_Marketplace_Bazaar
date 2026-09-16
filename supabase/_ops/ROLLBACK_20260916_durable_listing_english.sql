-- Stops new translation work and preserves already completed translations and
-- pending jobs. Pause translation cron before applying; no listing deletion.
SET LOCAL lock_timeout='2s';
DROP TRIGGER IF EXISTS queue_listing_english_insert ON public.items;
DROP TRIGGER IF EXISTS queue_listing_english_update ON public.items;
REVOKE EXECUTE ON FUNCTION public.claim_listing_translation(),public.finish_listing_translation(uuid,bigint,uuid,text,text,text,text,text),public.listing_translation_status() FROM service_role;
