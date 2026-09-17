-- A device-assisted street check, not identity/residence/presence attestation.
-- No coordinates or house numbers are stored. Only the edge geocoder can issue
-- a short-lived receipt; it is consumed atomically with the listing write.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.items ADD COLUMN location_checked_at timestamptz;
ALTER TABLE public.items ADD COLUMN location_check_token uuid;
-- Legacy booleans have no street receipt evidence and cannot inherit this claim.
UPDATE public.items SET location_verified=false WHERE location_verified;
GRANT SELECT (location_checked_at) ON public.items TO anon, authenticated;
GRANT INSERT (location_check_token), UPDATE (location_check_token) ON public.items TO authenticated;

CREATE TABLE private.street_location_checks (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  session_id uuid NOT NULL,
  street_label text NOT NULL CHECK (length(street_label) BETWEEN 1 AND 80),
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '10 minutes',
  UNIQUE (user_id, item_id)
);
CREATE INDEX street_location_checks_expiry ON private.street_location_checks(expires_at);
ALTER TABLE private.street_location_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.street_location_checks FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.street_check_account_eligible(user_id_in uuid, session_id_in uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
  SELECT 1 FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id
  JOIN public.profiles p ON p.id=u.id
  WHERE u.id=user_id_in AND s.id=session_id_in AND u.deleted_at IS NULL
   AND (u.banned_until IS NULL OR u.banned_until<=now())
   AND (s.not_after IS NULL OR s.not_after>now())
   AND NOT (coalesce(p.suspension_level,0)>=2 AND (p.suspended_until IS NULL OR p.suspended_until>now()))
   AND NOT EXISTS (SELECT 1 FROM public.account_deletion_jobs d WHERE d.user_id=u.id)
 )
$$;
REVOKE ALL ON FUNCTION private.street_check_account_eligible(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.issue_street_location_check(user_id_in uuid, session_id_in uuid, item_id_in uuid, street_label_in text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE receipt private.street_location_checks%ROWTYPE;
BEGIN
 IF item_id_in IS NULL OR street_label_in IS NULL OR length(street_label_in) NOT BETWEEN 1 AND 80
   OR street_label_in ~ '[[:cntrl:]]'
   OR NOT private.street_check_account_eligible(user_id_in,session_id_in) THEN RETURN NULL; END IF;
 IF EXISTS (SELECT 1 FROM public.items WHERE id=item_id_in AND (user_id<>user_id_in OR status<>'active')) THEN RETURN NULL; END IF;
 DELETE FROM private.street_location_checks WHERE token IN
   (SELECT token FROM private.street_location_checks WHERE expires_at<clock_timestamp() ORDER BY expires_at LIMIT 100);
 INSERT INTO private.street_location_checks(user_id,session_id,item_id,street_label)
 VALUES(user_id_in,session_id_in,item_id_in,street_label_in)
 ON CONFLICT(user_id,item_id) DO UPDATE SET token=gen_random_uuid(),session_id=excluded.session_id,
 street_label=excluded.street_label,checked_at=clock_timestamp(),expires_at=clock_timestamp()+interval '10 minutes'
 RETURNING * INTO receipt;
 RETURN jsonb_build_object('token',receipt.token,'location',receipt.street_label,'checked_at',receipt.checked_at,'expires_at',receipt.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.issue_street_location_check(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_street_location_check(uuid,uuid,uuid,text) TO service_role;

CREATE FUNCTION private.apply_street_location_check()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE receipt private.street_location_checks%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
   NEW.location_verified:=false; NEW.location_checked_at:=NULL;
 ELSIF NEW.location IS DISTINCT FROM OLD.location OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.status='deleted' THEN
   NEW.location_verified:=false; NEW.location_checked_at:=NULL;
 END IF;
 IF NEW.location_check_token IS NOT NULL THEN
   DELETE FROM private.street_location_checks WHERE token=NEW.location_check_token
     AND user_id=NEW.user_id AND item_id=NEW.id
     AND expires_at>clock_timestamp() AND street_label=NEW.location
     AND private.street_check_account_eligible(user_id,session_id)
     AND session_id::text=auth.jwt()->>'session_id'
     AND user_id=auth.uid()
     RETURNING * INTO receipt;
   -- Bad/expired receipts never block an otherwise valid manual listing.
   NEW.location_verified:=FOUND AND NEW.status='active';
   NEW.location_checked_at:=CASE WHEN NEW.location_verified THEN receipt.checked_at ELSE NULL END;
 END IF;
 NEW.location_check_token:=NULL; -- never retain/return a bearer receipt on a public row
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.apply_street_location_check() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER apply_street_location_check BEFORE INSERT OR UPDATE ON public.items
FOR EACH ROW EXECUTE FUNCTION private.apply_street_location_check();
COMMENT ON COLUMN public.items.location_checked_at IS 'Time of device-assisted approximate street check; not proof of identity, residence, or physical presence. Coordinates are not retained.';
NOTIFY pgrst, 'reload schema';
COMMIT;
