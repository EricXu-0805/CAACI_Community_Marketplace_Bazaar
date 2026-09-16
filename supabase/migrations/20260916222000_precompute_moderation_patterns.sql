-- Prepare keyword patterns once when the service-owned rules change, rather
-- than folding ~2,500 keywords for every item title, description or message.
-- Generated columns cannot be forged and update atomically on keyword edits.
-- Preserve the previous short-word boundary and long-word LIKE semantics,
-- including wildcard handling. No keyword, intent rule or ACL is relaxed.
-- If fold_han changes later, rewrite keyword=keyword to refresh stored patterns.
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.moderation_keywords
  ADD COLUMN IF NOT EXISTS match_word_boundary boolean GENERATED ALWAYS AS
    (lower(public.content_moderation_fold_han(keyword)) ~ '^[a-z0-9]{1,4}$') STORED,
  ADD COLUMN IF NOT EXISTS match_pattern text GENERATED ALWAYS AS
    (CASE WHEN lower(public.content_moderation_fold_han(keyword)) ~ '^[a-z0-9]{1,4}$'
      THEN '\y' || lower(public.content_moderation_fold_han(keyword)) || '\y'
      ELSE '%' || replace(replace(lower(public.content_moderation_fold_han(keyword)), '_', ''), ' ', '') || '%'
    END) STORED;

CREATE OR REPLACE FUNCTION public.content_moderation_check(raw text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  norm   text;
  folded text;
BEGIN
  IF raw IS NULL OR length(raw) = 0 THEN
    RETURN NULL;
  END IF;
  norm   := public.content_moderation_normalize(raw);
  folded := LOWER(normalize(COALESCE(raw, ''), NFKC));
  IF EXISTS (
    SELECT 1 FROM public.moderation_keywords kw
    WHERE kw.active = true
      AND CASE WHEN kw.match_word_boundary
        THEN folded ~ kw.match_pattern
        ELSE norm LIKE kw.match_pattern END
  ) THEN
    RETURN 'sensitive_word';
  END IF;
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

NOTIFY pgrst, 'reload schema';
