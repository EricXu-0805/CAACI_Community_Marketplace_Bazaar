ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tos_version    text,
  ADD COLUMN IF NOT EXISTS consented_at   timestamptz,
  ADD COLUMN IF NOT EXISTS onboarded_at   timestamptz,
  ADD COLUMN IF NOT EXISTS campus_area    text;

CREATE INDEX IF NOT EXISTS profiles_tos_version_idx
  ON public.profiles (tos_version);

CREATE OR REPLACE FUNCTION public.record_consent(version_in text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF version_in IS NULL OR length(version_in) = 0 OR length(version_in) > 40 THEN
    RAISE EXCEPTION 'invalid_version';
  END IF;
  UPDATE public.profiles
     SET tos_version  = version_in,
         consented_at = now()
   WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.record_consent(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_consent(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_onboarded(
  nickname_in  text,
  campus_in    text,
  avatar_in    text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cleaned_nick text;
  cleaned_campus text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  cleaned_nick := btrim(COALESCE(nickname_in, ''));
  IF length(cleaned_nick) < 1 OR length(cleaned_nick) > 40 THEN
    RAISE EXCEPTION 'invalid_nickname';
  END IF;

  cleaned_campus := btrim(COALESCE(campus_in, ''));
  IF length(cleaned_campus) > 80 THEN
    RAISE EXCEPTION 'invalid_campus';
  END IF;

  UPDATE public.profiles
     SET nickname     = cleaned_nick,
         campus_area  = NULLIF(cleaned_campus, ''),
         avatar_url   = COALESCE(NULLIF(avatar_in, ''), avatar_url),
         onboarded_at = now()
   WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.mark_onboarded(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_onboarded(text, text, text) TO authenticated;
