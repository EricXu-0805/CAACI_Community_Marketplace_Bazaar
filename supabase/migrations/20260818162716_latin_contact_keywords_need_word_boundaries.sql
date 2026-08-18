-- 20260818162716_latin_contact_keywords_need_word_boundaries.sql
--
-- content_moderation_check reads its WeChat keywords against `norm`, the copy
-- with every separator removed. That is right for the CJK keywords — removing
-- the spaces in 加 微 信 is the whole point — but two of the keywords are
-- latin, and on the stripped copy they are ordinary English:
--
--   'TV, Xbox'                        -> 'tvxbox'   contains 'vx'
--   'Selling my TV, Xbox and a desk'  -> ...'tvxbox'
--   'Nov X meetup'                    -> 'novxmeetup'
--   'text me and we chat about pickup'-> ...'wechat'...
--   'we chatted yesterday'            -> ...'wechatted'...
--
-- All of those were refused as contact info. The trigger is the authoritative
-- gate, so a student selling a console or proposing a time could not post at
-- all, whatever the client did.
--
-- Fix: 'wechat' and 'vx' move to a third copy — NFKC-folded and stripped of the
-- separators an evader wedges into a word, but with whitespace kept — and read
-- with latin word boundaries. Every other keyword is anchored on a CJK
-- character, cannot collide with English, and stays on `norm` unchanged.
--
-- \y is not usable here: PostgreSQL counts a CJK character as a word
-- character, so '\yvx\y' does not match 'vx号私聊'. Explicit [a-z] lookarounds
-- match what the client does and keep that case refused.
--
-- Nothing else in the body changes; content_moderation_normalize is untouched.
-- The client half ships in the same PR (src/utils/contentSafety.ts).

CREATE OR REPLACE FUNCTION public.content_moderation_check(raw text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  norm   text;
  folded text;
  spaced text;
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
  -- content_moderation_normalize with the whitespace kept and collapsed: the
  -- separator class is identical, so 'w-e-c-h-a-t' still closes up while
  -- 'we chat' stays two words.
  spaced := regexp_replace(
    regexp_replace(
      regexp_replace(
        LOWER(normalize(COALESCE(raw, ''), NFKC)),
        E'[\\-\\._,。，、]+', '', 'g'),
      E'[\\u00AD\\u034F\\u061C\\u180E\\u200B-\\u200F\\u2060-\\u2064\\u206A-\\u206F\\uFEFF\\uFE00-\\uFE0F]', '', 'g'),
    E'\\s+', ' ', 'g');

  IF norm ~ '(?<![0-9])1[3-9][0-9]{9}(?![0-9])' THEN
    RETURN 'contact_info';
  END IF;
  IF folded ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' THEN
    RETURN 'contact_info';
  END IF;
  IF norm ~ '(微信|weixin|加v|加微|v信|v我)' THEN
    RETURN 'contact_info';
  END IF;
  IF spaced ~ '(?<![a-z])(wechat|vx)(?![a-z])' THEN
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
--   -- the listings that were refused:
--   SELECT public.content_moderation_check('Selling my TV, Xbox and a desk'); -- NULL
--   SELECT public.content_moderation_check('text me and we chat about pickup');-- NULL
--   SELECT public.content_moderation_check('Nov X meetup at the Union');       -- NULL
--   -- still refused:
--   SELECT public.content_moderation_check('add me on wechat');   -- contact_info
--   SELECT public.content_moderation_check('vx号私聊');            -- contact_info
--   SELECT public.content_moderation_check('w.e.c.h.a.t me');     -- contact_info
--   SELECT public.content_moderation_check('加 微 信 详 聊');      -- contact_info
--   SELECT public.content_moderation_check(E'加⁠微信');            -- contact_info
--   -- unchanged behaviour elsewhere:
--   SELECT public.content_moderation_check('打电话 １３８１２３４５６７８'); -- contact_info
--   SELECT public.content_moderation_check('reach me at a@b.edu');  -- contact_info
--   SELECT public.content_moderation_check('analysis method');      -- NULL
-- ---------------------------------------------------------------------------
