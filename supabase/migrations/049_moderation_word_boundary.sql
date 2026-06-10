-- ============================================
-- 049 Moderation false-positive fix — word boundaries for short keywords
-- ============================================
-- Found via sticker E2E 2026-06-10: moderation_keywords contains short
-- entries ('SM', 'LY', 'BT', 'JS', …) matched as raw substrings against
-- the space-stripped normalization. Result: "I really like it",
-- "btw is this available", "analysis", "method", and [sticker:smile]
-- were ALL blocked as sensitive_word in production.
--
-- Fix, two-tier matching:
--   · pure-ASCII alnum keywords of ≤4 chars (the false-positive bombs)
--     → POSIX word-boundary regex (\y) against LOWER(raw). Boundaries
--     are real there because raw keeps its spacing. Trade-off: loses
--     the spaced-out-evasion catch ("w e e d") for these few words —
--     acceptable vs. blocking everyday English.
--   · everything else (CJK + longer latin) → existing substring match
--     on the space-stripped normalization, unchanged.
--
-- Also in trg_moderate_messages:
--   · skip 'video' like 'image' — content is a storage URL whose uuid
--     can embed 'sm'/'bt'/… substrings (random blocks on video sends)
--   · skip whole-body [sticker:*] tokens — app-generated, not user text
-- ============================================

CREATE OR REPLACE FUNCTION public.content_moderation_check(raw text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  norm text;
  kw   record;
BEGIN
  IF raw IS NULL OR length(raw) = 0 THEN
    RETURN NULL;
  END IF;

  norm := public.content_moderation_normalize(raw);

  IF norm ~ '(?<![0-9])1[3-9][0-9]{9}(?![0-9])' THEN
    RETURN 'contact_info';
  END IF;
  IF raw ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' THEN
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
      IF LOWER(raw) ~ ('\y' || kw.k || '\y') THEN
        RETURN 'sensitive_word';
      END IF;
    ELSIF norm LIKE '%' || replace(replace(kw.k, '_', ''), ' ', '') || '%' THEN
      RETURN 'sensitive_word';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_moderate_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result text;
BEGIN
  -- media messages carry storage URLs, not user prose
  IF NEW.message_type IN ('image', 'video') THEN
    RETURN NEW;
  END IF;
  -- whole-body sticker tokens are app-generated (chat sticker panel)
  IF NEW.content ~ '^\[sticker:[a-z-]+\]$' THEN
    RETURN NEW;
  END IF;
  result := public.content_moderation_check(NEW.content);
  IF result IS NOT NULL THEN
    RAISE EXCEPTION 'moderation_block:%', result;
  END IF;
  RETURN NEW;
END;
$function$;

-- --------------------------------------------
-- Verification (run after apply):
--   SELECT public.content_moderation_check('I really like it');      -- NULL
--   SELECT public.content_moderation_check('btw is this available'); -- NULL
--   SELECT public.content_moderation_check('analysis method');       -- NULL
--   SELECT public.content_moderation_check('[sticker:smile]');       -- NULL
--   SELECT public.content_moderation_check('pure SM content');       -- sensitive_word
--   SELECT public.content_moderation_check('加微信聊');               -- contact_info
--   SELECT public.content_moderation_check('代写论文');               -- sensitive_word
-- --------------------------------------------
