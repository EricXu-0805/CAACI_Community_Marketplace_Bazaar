-- 089_moderation_nfkc_normalize.sql
--
-- Deep-audit P2 (moderation bypass): content_moderation_normalize (the DB
-- trust boundary, defined in 024) stripped whitespace/punct + U+200B-200F/FEFF
-- and lowercased, but did NOT Unicode-canonicalize. Two gaps followed:
--   (1) full-width digits/letters/＠/． were never folded, so full-width phone
--       / email / WeChat IDs and every keyword LIKE evaded the phone regex,
--       the email regex, and the lexicon while rendering as legible contact
--       info;
--   (2) invisible formatting codepoints outside the stripped range
--       (U+00AD soft hyphen, U+2060-2064, U+206A-206F, U+034F, U+180E,
--       U+FE00-FE0F variation selectors) survived and broke substring/regex
--       matches when inserted between CJK keyword characters (代<U+00AD>写,
--       加<U+2060>微信) with no visible change.
-- The client normalize (contentSafety.ts) already folded full-width, so the
-- advisory client caught these — but the real server gate did not, and a direct
-- anon-key PostgREST insert bypasses the client entirely.
--
-- Fix: NFKC-fold at the top of normalize (folds full-width -> ASCII) and widen
-- the invisible-codepoint strip class. Additionally, the email + short-ASCII
-- keyword checks in content_moderation_check run against `raw` (to preserve the
-- dots/@ and word spacing that the stripped `norm` loses), so those now run
-- against an NFKC-folded, lowercased copy of raw — full-width email/short words
-- fold to ASCII while structure is preserved. The client normalize is updated
-- in lockstep in the same PR.

-- --- normalize: NFKC + wider invisible strip -------------------------------
CREATE OR REPLACE FUNCTION public.content_moderation_normalize(raw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT LOWER(
    regexp_replace(
      regexp_replace(
        normalize(COALESCE(raw, ''), NFKC),
        E'[\\s\\-\\._,。，、]+', '', 'g'),
      E'[\\u00AD\\u034F\\u061C\\u180E\\u200B-\\u200F\\u2060-\\u2064\\u206A-\\u206F\\uFEFF\\uFE00-\\uFE0F]', '', 'g'
    )
  );
$$;

-- --- check: fold raw for the raw-based regexes (email + short ASCII word) ---
-- Body reproduced verbatim from 049 with `folded` substituted for `raw` in the
-- two regex checks that must keep dots/@ + word spacing.
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
  -- NFKC-folded, lowercased, but NOT stripped — keeps @ / . / spacing so the
  -- email regex and the \y word-boundary check still work while catching
  -- full-width evasion.
  folded := LOWER(normalize(COALESCE(raw, ''), NFKC));

  IF norm ~ '(?<![0-9])1[3-9][0-9]{9}(?![0-9])' THEN
    RETURN 'contact_info';
  END IF;
  IF folded ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' THEN
    RETURN 'contact_info';
  END IF;
  IF norm ~ '(微信|wechat|weixin|加v|加微|v信|vx|v我)' THEN
    RETURN 'contact_info';
  END IF;

  FOR kw IN
    SELECT LOWER(keyword) AS k
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

  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Verification (run after apply):
--   -- full-width phone folds and is caught:
--   SELECT public.content_moderation_check('打电话 １３８１２３４５６７８');  -- contact_info
--   -- soft-hyphen split of a CJK keyword no longer evades (代<U+00AD>写):
--   SELECT public.content_moderation_check(E'代­写论文'); -- sensitive_word
--   -- word-joiner split of 微信 (加<U+2060>微信):
--   SELECT public.content_moderation_check(E'加⁠微信');       -- contact_info
--   -- regression: everyday English still passes (049 word boundaries intact):
--   SELECT public.content_moderation_check('analysis method');                 -- NULL
--   SELECT public.content_moderation_check('btw is this available');           -- NULL
-- ---------------------------------------------------------------------------
