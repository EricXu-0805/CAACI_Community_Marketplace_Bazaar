-- ============================================================
-- 20260904060000 — One signal is not evidence of an advertisement
-- ============================================================
-- 20260903060000 shipped layer 4 as a flat test: any dual-meaning noun
-- anywhere in the text AND any one solicitation signal anywhere in the same
-- text returns sensitive_word. There is no proximity and no count, so a noun
-- and a signal twenty characters apart, meaning entirely different things,
-- fire together. Measured against production on 2026-09-04, all of these
-- ordinary listings are refused today:
--
--   兼职时间不够所以出，当天可自取   兼职 = my part-time job; 当天 = same-day pickup
--   代购的包，价格可详谈             代购 = bought for a friend; 详谈 = negotiable
--   全职上班没时间用了，长期闲置     全职 = my full-time job; 长期 = sitting unused
--   日本代购的化妆品，一手未拆       一手 = original owner, never opened
--   换钱包了，长期闲置的旧钱包出     换钱 is only a substring of 换钱包
--
-- Three of those are the very sentences 20260903023000 shipped to un-break.
-- Layer 4 put them straight back, and worse: the client mirror carries none of
-- these rules, so the composer accepts the text and every photo uploads before
-- the trigger refuses — with copy that names no word, so the seller has
-- nothing to act on.
--
-- WHY A COUNT AND NOT A SHORTER SIGNAL LIST
-- -----------------------------------------
-- Dropping the eight signals that read as ordinary listing copy was the first
-- attempt. The 40-ad corpus in scripts/moderation-contact-and-ad-policy.test.mjs
-- refused it: six real advertisements escaped, because 长期 / 靠谱 / 需要的 are
-- exactly what the ads say too. The words are not the discriminator. How many
-- of them appear at once is:
--
--   ordinary listings, measured    0 or 1 signal   (max 1 across 11 sentences)
--   real advertisements, measured  2 or 3 signals
--
-- So layer 4 now needs TWO DISTINCT signals beside the noun. Nothing is
-- removed from the signal list; one sentence saying 当天可自取 stops being
-- enough on its own.
--
-- 私信 and 私聊 join the list. They are ordinary on their own — contact
-- sharing has been allowed since 2026-09-03 — but under a two-signal rule an
-- ordinary listing that says 私信我看图 still totals one, while 代购 需要的私信
-- reaches two. That recovers the single ad the count would otherwise have lost.
--
-- THREE KEYWORDS MOVE DOWN A LAYER
-- --------------------------------
-- jianzhi / 戴考 / 黛购 were seeded as bare substring keywords, so they matched
-- with no context at all:
--
--   Meet Jianzhi at Green St at 5pm   a romanization of 建志 / 健之 / 剑芝
--   Contact Jian Zhi for pickup       the normalizer strips the space too
--   戴考虑一下再说                     "Dai, think it over"
--   黛购物袋一个                       "Dai's shopping bag"
--
-- The trigger covers messages, so two students could not name a third in chat.
-- Moving them into moderation_intent_rules keeps every advertisement they were
-- catching — each of those carries two signals — while ordinary text carries
-- none. Measured: the four sentences above hit 0 signals; ＪＩＡＮＺＨＩ 日結 招人,
-- 戴考 保过 当天出分 and 黛购 专业长期 hit 2 apiece.
--
-- The other pinyin aliases stay as keywords: none is a substring of ordinary
-- text or a plausible romanized name.
--
-- Idempotent. Deactivating rather than deleting keeps the import history
-- readable and lets one UPDATE put anything back.
-- ============================================================

-- 1. Two signals, not one.
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

-- 2. 私信 / 私聊 join the signals, on every rule.
UPDATE public.moderation_intent_rules
SET signals = ARRAY[
  '专业', '需要的', '接单', '包过', '保过', '日结', '低息', '无抵押',
  '价格优惠', '优惠价', '长期', '靠谱', '诚信', '秒到', '当天', '放款',
  '一手', '渠道', '招人', '招代理', '有意者', '可私', '欢迎咨询',
  '咨询', '详谈', '私信', '私聊'
]
WHERE active = true;

-- 3. The three colliding keywords become nouns, which need a signal beside them.
INSERT INTO public.moderation_intent_rules (noun, signals)
SELECT seed.noun, rules.signals
FROM (VALUES ('jianzhi'), ('戴考'), ('黛购')) AS seed(noun)
CROSS JOIN LATERAL (
  SELECT signals FROM public.moderation_intent_rules WHERE active = true LIMIT 1
) AS rules
WHERE NOT EXISTS (
  SELECT 1 FROM public.moderation_intent_rules existing WHERE existing.noun = seed.noun
);

UPDATE public.moderation_keywords
SET active = false
WHERE category = 'spam'
  AND active = true
  AND LOWER(keyword) IN ('jianzhi', '戴考', '黛购');

NOTIFY pgrst, 'reload schema';
