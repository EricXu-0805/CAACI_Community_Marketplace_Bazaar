-- LOCAL/ISOLATED DATABASE ONLY.
--
-- Supplemental historical suspension surface for migration-review databases
-- whose base bootstrap predates migration 027. Production obtains this schema
-- from 027_trust_and_suspensions.sql; do not deploy this fixture.

\set ON_ERROR_STOP on

CREATE TABLE IF NOT EXISTS public.suspensions (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  level        smallint NOT NULL CHECK (level BETWEEN 0 AND 5),
  reason       text NOT NULL,
  category     text NOT NULL DEFAULT 'generic',
  issued_by    uuid,
  started_at   timestamptz NOT NULL DEFAULT pg_catalog.now(),
  ends_at      timestamptz,
  lifted_at    timestamptz,
  lifted_by    uuid,
  lift_reason  text,
  appeal_note  text,
  created_at   timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS suspensions_profile_active_idx
  ON public.suspensions (profile_id, ends_at DESC)
  WHERE lifted_at IS NULL;
CREATE INDEX IF NOT EXISTS suspensions_created_idx
  ON public.suspensions (created_at DESC);

ALTER TABLE public.suspensions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS suspensions_self_read ON public.suspensions;
CREATE POLICY suspensions_self_read
  ON public.suspensions FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = profile_id);

GRANT SELECT ON public.suspensions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suspensions TO service_role;

-- Historical one-argument surface, recreated exactly enough to prove the new
-- migration retires it before granting the guarded overload.
CREATE OR REPLACE FUNCTION public.submit_appeal(note_in text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  sid uuid;
  cleaned text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  cleaned := btrim(COALESCE(note_in, ''));
  IF length(cleaned) < 10 OR length(cleaned) > 2000 THEN
    RAISE EXCEPTION 'invalid_appeal_length';
  END IF;

  sid := (
    SELECT suspension.id
    FROM public.suspensions AS suspension
    WHERE suspension.profile_id = auth.uid()
      AND suspension.lifted_at IS NULL
      AND suspension.appeal_note IS NULL
    ORDER BY suspension.created_at DESC
    LIMIT 1
  );
  IF sid IS NULL THEN RAISE EXCEPTION 'no_active_suspension'; END IF;
  UPDATE public.suspensions SET appeal_note = cleaned WHERE id = sid;
END
$function$;

REVOKE ALL ON FUNCTION public.submit_appeal(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.submit_appeal(text) TO authenticated;
