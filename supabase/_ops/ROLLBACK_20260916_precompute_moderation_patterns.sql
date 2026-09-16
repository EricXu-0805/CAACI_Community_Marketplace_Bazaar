-- Restore the prior oracle before dropping its unused optimization columns.
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.content_moderation_check(raw text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  norm   text;
  folded text;
  kw     record;
BEGIN
  IF raw IS NULL OR length(raw) = 0 THEN
    RETURN NULL;
  END IF;
  norm   := public.content_moderation_normalize(raw);
  folded := LOWER(normalize(COALESCE(raw, ''), NFKC));
  FOR kw IN
    SELECT LOWER(public.content_moderation_fold_han(keyword)) AS k
    FROM public.moderation_keywords
    WHERE active = true
  LOOP
    IF kw.k ~ '^[a-z0-9]{1,4}$' THEN
      IF folded ~ ('\y' || kw.k || '\y') THEN
        RETURN 'sensitive_word';
      END IF;
    ELSIF norm LIKE '%' || replace(replace(kw.k, '_', ''), ' ', '') || '%' THEN
      RETURN 'sensitive_word';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM public.moderation_intent_rules rule
    WHERE rule.active = true
      AND norm LIKE '%' || public.content_moderation_normalize(rule.noun) || '%'
      AND (
        SELECT pg_catalog.count(DISTINCT signal)
        FROM unnest(rule.signals) AS signal
        WHERE norm LIKE '%' || public.content_moderation_normalize(signal) || '%'
      ) >= 2
  ) THEN
    RETURN 'sensitive_word';
  END IF;
  RETURN NULL;
END;
$function$;

ALTER TABLE public.moderation_keywords DROP COLUMN IF EXISTS match_pattern, DROP COLUMN IF EXISTS match_word_boundary;
NOTIFY pgrst, 'reload schema';
