-- Operational rollback: stop new street receipts and public translation claims.
-- Preserve listing data, accepted consent versions, existing translations and
-- queued work. Existing short-lived receipts expire normally. No table/column
-- drops or profile-consent rewrites are necessary to run the previous app.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.issue_street_location_check(user_id_in uuid, session_id_in uuid, item_id_in uuid, street_label_in text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION public.claim_public_content_translation()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN RETURN NULL; END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
