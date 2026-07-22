-- LOCAL/ISOLATED DATABASE ONLY.
--
-- Supplemental migration-027/031 surface for review databases whose base
-- bootstrap predates trust/fingerprint tables. Production obtains these
-- objects from the historical migrations; do not deploy this fixture.

\set ON_ERROR_STOP on

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_fp_hash text,
  ADD COLUMN IF NOT EXISTS last_fp_seen_at timestamptz;

CREATE TABLE IF NOT EXISTS public.device_fingerprints (
  id           bigserial PRIMARY KEY,
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fp_hash      text NOT NULL,
  first_seen   timestamptz NOT NULL DEFAULT pg_catalog.now(),
  last_seen    timestamptz NOT NULL DEFAULT pg_catalog.now(),
  seen_count   integer NOT NULL DEFAULT 1,
  ua_snippet   text,
  UNIQUE (profile_id, fp_hash)
);

CREATE INDEX IF NOT EXISTS device_fp_hash_idx
  ON public.device_fingerprints (fp_hash, last_seen DESC);
ALTER TABLE public.device_fingerprints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dfp_self_read ON public.device_fingerprints;
CREATE POLICY dfp_self_read
  ON public.device_fingerprints FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = profile_id);
GRANT SELECT ON public.device_fingerprints TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_fingerprints TO service_role;

ALTER TABLE public.admin_audit_log
  ADD COLUMN IF NOT EXISTS actor_id uuid,
  ADD COLUMN IF NOT EXISTS target_id uuid,
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.recompute_trust_score(profile_id_in uuid)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  current_score smallint;
BEGIN
  SELECT profile.trust_score INTO current_score
  FROM public.profiles AS profile
  WHERE profile.id = profile_id_in;
  RETURN COALESCE(current_score, 50::smallint);
END
$function$;
REVOKE ALL ON FUNCTION public.recompute_trust_score(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_audit(
  event_kind_in text,
  actor_id_in uuid,
  target_id_in uuid,
  details_in jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.admin_audit_log (
    event_kind, actor_id, target_id, details
  ) VALUES (
    event_kind_in,
    actor_id_in,
    target_id_in,
    COALESCE(details_in, '{}'::jsonb)
  );
END
$function$;
REVOKE ALL ON FUNCTION public.record_audit(text, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_audit(text, uuid, uuid, jsonb)
  TO service_role;

-- One legacy 32-character row proves the candidate's NOT VALID constraint can
-- deploy without blessing new weak signals. It is scoped to an explicit local
-- fixture account and is omitted when the strict constraint already exists.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (
  'f9000000-0000-4000-8000-000000000001',
  'legacy-fingerprint@example.test',
  '{}'::jsonb
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname) VALUES (
  'f9000000-0000-4000-8000-000000000001',
  'Legacy Fingerprint Fixture'
) ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname;

DO $legacy_fixture$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.device_fingerprints'::pg_catalog.regclass
      AND constraint_row.conname = 'device_fingerprints_fp_hash_sha256_chk'
  ) THEN
    INSERT INTO public.device_fingerprints (profile_id, fp_hash, ua_snippet)
    VALUES (
      'f9000000-0000-4000-8000-000000000001',
      pg_catalog.repeat('d', 32),
      'legacy-local-fixture'
    )
    ON CONFLICT (profile_id, fp_hash) DO NOTHING;
  END IF;
END
$legacy_fixture$;
