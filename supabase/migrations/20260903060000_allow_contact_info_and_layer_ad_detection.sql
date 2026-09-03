-- ============================================
-- 20260903060000 — Contact info is allowed; 小广告 detection gets four layers
-- ============================================
-- Eric's decision, 2026-09-03, in two halves.
--
-- (1) SHARING CONTACT INFO IS ALLOWED, everywhere: listings, plaza posts,
--     comments, chat messages, profile bios. WeChat, phone, email, QQ,
--     Telegram, 小红书 — all of it. The 'contact_info' verdict is removed
--     from content_moderation_check entirely. Four rules go with it: the
--     mainland-mobile regex, the email regex, the (微信|weixin|加v|加微|
--     v信|v我) pattern and the latin-boundary (wechat|vx) pattern from
--     20260818162716. A text that is only a handle — 'V: lisa2024',
--     'wx：lisa', 'WhatsApp 217 555 0199', '加我vx: lisa_2024',
--     '小红书同名 私我' — now returns NULL.
--
-- (2) What the platform actually wants to stop is the 小广告: 代购 / 代写 /
--     办证 / 刷单 / 贷款 / 换汇 solicitation. That was riding on the contact
--     rules — measured against production's own function on 2026-09-03 with a
--     45-variant evasion corpus, 25 were refused, and 6 of those only because
--     the ad happened to carry a handle. Take the contact rules away and those
--     6 walk through, alongside the 20 that already did. So the ad half is
--     rebuilt in four layers, all inside the database, no external service:
--
--       LAYER 1  normalisation — traditional characters fold to simplified,
--                and a symbol wedged between two CJK characters (or between
--                CJK and a latin letter) is removed, so 代・购 / 代#购 /
--                代🔥购 / 加@微 close up. 亻弋 rejoins to 代.
--       LAYER 2  the existing moderation_keywords loop, unchanged in shape.
--       LAYER 3  aliases — pinyin and homophone spellings of the ad verbs,
--                seeded as ordinary keywords (section 6).
--       LAYER 4  intent pairs — public.moderation_intent_rules, consulted
--                after the keyword loop. A dual-meaning noun (代购, 兼职,
--                代理 …) blocks only when a solicitation signal (专业,
--                日结, 包过, 长期 …) appears in the same text (section 5).
--
--     Layer 4 exists because 20260903023000 had to switch 代购 / 代理 /
--     兼职 / 全职 / 招聘 off as bare keywords — they are ordinary secondhand
--     vocabulary ('帮忙代购的包，闲置转让'). This migration DEPENDS on that
--     one having been applied: it does not repeat the deactivation, and the
--     benign numbers below only hold with it in place.
--
-- MEASURED, on the two corpora in scripts/moderation-contact-and-ad-policy.test.mjs:
--                            production 2026-09-03    after this migration
--   45 evasion variants          25 refused            40 ads refused,
--                                                      5 contact-only NULL
--   21 benign secondhand          9 refused            0 refused
--
-- The verdict string stays 'sensitive_word' for every block, so the triggers
-- (024/049), private.assert_moderated_text (20260718230000) and the client's
-- moderation_block:<field>:<reason> copy keep working untouched.
--
-- Idempotent: CREATE OR REPLACE, CREATE TABLE IF NOT EXISTS, guarded UPDATE,
-- NOT EXISTS on both seeds.

-- --------------------------------------------
-- 1. Keywords that only ever named a contact channel
-- --------------------------------------------
-- 'QQ' is two ASCII characters, so it is matched on word boundaries: the row
-- refuses 'QQ 12345678' and nothing else. '扣扣' and '聯繫電' are the same
-- thing in Chinese — and '聯繫電' folds to '联系电' under section 3, which
-- would newly refuse '联系电话见简介', the exact text the policy now allows.
--
-- '證件' comes off for a different reason: folding gives it '证件', so a
-- traditional-only import artefact would start refusing '租房需要哪些证件'.
-- The solicitation it was standing in for is still covered by 办证 (fraud),
-- 假证 (fraud) and the 代办/代开 rows.
--
-- 微店 stays: that is a shop, not a channel.
UPDATE public.moderation_keywords
SET active = false
WHERE category = 'lexicon'
  AND active = true
  AND keyword IN ('QQ', '扣扣', '聯繫電', '證件');

-- --------------------------------------------
-- 2. Traditional -> simplified fold table
-- --------------------------------------------
-- One home for the mapping, because both sides of the comparison need it:
-- the text is folded inside content_moderation_normalize, and every keyword
-- is folded in content_moderation_check before it is compared. Folding only
-- the text would make all 36 traditional entries the 025 import left in the
-- lexicon (安眠藥, 手槍, 迷藥, 辦證 …) unmatchable: the text would arrive folded
-- and they never would. 25 of the 36 have no simplified twin in the table to
-- take over. Folding both sides keeps them alive AND makes them reach the
-- simplified spelling they were always meant to cover.
--
-- Rows are aligned 30 per line: the nth character of the second literal is
-- the simplification of the nth character of the first. Only unambiguous
-- pairs are listed; 幹/乾/干, 後/后 and 髮/发 are deliberately absent because
-- one traditional character maps to different simplified ones by sense.
CREATE OR REPLACE FUNCTION public.content_moderation_fold_han(raw text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT translate(
    COALESCE(raw, ''),
    '寫購職單結過證辦開發貸網絡賣買錢幣匯換學業專論試題課師導輔賬' ||
    '號聯繫話電機價優團幫們這說對時間為從與個麼沒還會見現兒邊進遠' ||
    '選車門問長頭點級經線給資產貨賺費錄詳諮詢認執駕護簽註冊賠償額' ||
    '銀帳戶兌藥槍賭詐騙廣傳銷補習畢圖書腦碼郵顧譜誠質當無轉歡談讓' ||
    '條應該東華國漢語稱標準節樂醫',
    '写购职单结过证办开发贷网络卖买钱币汇换学业专论试题课师导辅账' ||
    '号联系话电机价优团帮们这说对时间为从与个么没还会见现儿边进远' ||
    '选车门问长头点级经线给资产货赚费录详咨询认执驾护签注册赔偿额' ||
    '银帐户兑药枪赌诈骗广传销补习毕图书脑码邮顾谱诚质当无转欢谈让' ||
    '条应该东华国汉语称标准节乐医'
  );
$$;

-- Left callable like content_moderation_normalize: it is a pure text
-- transform that reveals nothing. content_moderation_check stays revoked (057).

-- --------------------------------------------
-- 3. content_moderation_normalize — full reissue
-- --------------------------------------------
-- Pipeline, in order:
--   NFKC (089)  ->  separators  ->  invisibles (089)  ->  symbols wedged
--   between CJK/CJK or CJK/latin  ->  亻弋 rejoined  ->  traditional fold
--   ->  lower.
--
-- The wedge strip is what 089 could not do: 089 widened the invisible class,
-- but a visible ・ / # / 🔥 between 代 and 购 still reads as 代购 to a human
-- and did not match. The class is spelled out as [^0-9a-zA-Z<CJK>] rather
-- than [^[:alnum:]<CJK>] on purpose — [:alnum:] answers differently under a
-- C ctype than under a UTF-8 one, and this function has to give the same
-- answer in a test cluster as in production.
--
-- 亻弋 is the only radical split encoded: 代 heads four of the ad nouns
-- (代购 代写 代考 代办) and 亻 is a radical nobody types on its own.
CREATE OR REPLACE FUNCTION public.content_moderation_normalize(raw text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT LOWER(
    public.content_moderation_fold_han(
      replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                normalize(COALESCE(raw, ''), NFKC),
                E'[\\s\\-\\._,。，、]+', '', 'g'),
              E'[\\u00AD\\u034F\\u061C\\u180E\\u200B-\\u200F\\u2060-\\u2064\\u206A-\\u206F\\uFEFF\\uFE00-\\uFE0F]', '', 'g'),
            E'(?<=[\\u3400-\\u4dbf\\u4e00-\\u9fff])[^0-9a-zA-Z\\u3400-\\u4dbf\\u4e00-\\u9fff]+(?=[\\u3400-\\u4dbf\\u4e00-\\u9fffa-zA-Z])', '', 'g'),
          E'(?<=[a-zA-Z])[^0-9a-zA-Z\\u3400-\\u4dbf\\u4e00-\\u9fff]+(?=[\\u3400-\\u4dbf\\u4e00-\\u9fff])', '', 'g'),
        '亻弋', '代')
    )
  );
$$;

-- --------------------------------------------
-- 4. content_moderation_check — full reissue
-- --------------------------------------------
-- Two copies of the text survive, and only two:
--   norm    the fully normalised copy — every keyword longer than four ASCII
--           characters, and every intent rule, is a plain substring of it.
--   folded  NFKC-folded and lowercased but NOT stripped, so \y still sees
--           word boundaries. 089 introduced it for the email regex AND the
--           short-ASCII keyword branch; with the email rule gone the branch
--           is its only remaining reader, and that branch cannot use norm —
--           norm closes 'TV, Xbox' into 'tvxbox' (20260818162716).
-- The third copy, `spaced`, is dropped: 20260818162716 added it for the
-- latin-boundary (wechat|vx) rule and nothing else ever read it.
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
      AND EXISTS (
        SELECT 1
        FROM unnest(rule.signals) AS signal
        WHERE norm LIKE '%' || public.content_moderation_normalize(signal) || '%'
      )
  ) THEN
    RETURN 'sensitive_word';
  END IF;

  RETURN NULL;
END;
$function$;

-- --------------------------------------------
-- 5. Intent pairs (layer 4)
-- --------------------------------------------
-- A table, not a literal in the function body, so Eric can retune a single
-- noun with one UPDATE and no migration. Noun and signals both run through
-- content_moderation_normalize at match time, so a row typed in traditional
-- characters or with a space in it still matches.
--
-- Every noun ships with the same signal list today; the per-row array exists
-- so one noun can be tightened later without touching the others.
CREATE TABLE IF NOT EXISTS public.moderation_intent_rules (
  noun       text PRIMARY KEY,
  signals    text[] NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Same posture as moderation_keywords (024): RLS on with no policy, so no
-- client role can read the ruleset and shop for words that get past it. The
-- REVOKE is belt-and-braces against Supabase's default table grants.
ALTER TABLE public.moderation_intent_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.moderation_intent_rules FROM anon, authenticated;

INSERT INTO public.moderation_intent_rules (noun, signals)
SELECT seed.noun, ARRAY[
  '专业', '需要的', '接单', '包过', '保过', '日结', '低息', '无抵押',
  '价格优惠', '优惠价', '长期', '靠谱', '诚信', '秒到', '当天', '放款',
  '一手', '渠道', '招人', '招代理', '有意者', '可私', '欢迎咨询',
  '咨询', '详谈'
]
FROM (VALUES
  -- switched off as bare keywords by 20260903023000, given back conditionally
  ('代购'), ('代理'), ('兼职'), ('全职'), ('招聘'),
  -- still bare keywords, listed so a fold or alias miss is caught anyway
  ('代写'), ('代考'), ('助考'), ('办证'), ('刷单'), ('贷款'),
  -- never were keywords: 换汇 is, 换钱 is not
  ('换汇'), ('换钱'),
  -- 带写 is the 代写 homophone. It is NOT seeded as a bare keyword: 带写
  -- is a substring of 带写字台 (a desk with a writing top), which somebody
  -- could really list. Behind a solicitation signal it is safe.
  ('带写')
) AS seed(noun)
WHERE NOT EXISTS (
  SELECT 1 FROM public.moderation_intent_rules existing
  WHERE existing.noun = seed.noun
);

-- --------------------------------------------
-- 6. Alias keywords (layer 3)
-- --------------------------------------------
-- Pinyin and homophone spellings of the ad verbs. Every one of these is five
-- or more ASCII characters, or two CJK characters, so it is substring-matched
-- against text whose spaces have already been removed — the same trap
-- 20260901071645 documented. Each was checked against the 21-sentence benign
-- corpus in the test and against ordinary English:
--   · daigou daixie daikao daikuan huanhui banzheng shuadan — no English word
--     and no plausible listing closes up around any of them.
--   · jianzhi — the one with a residual collision: it is also the pinyin of
--     剪纸 (papercutting) and a plausible given name. Kept because a latin
--     'jianzhi' in a marketplace listing is the solicitation in every case we
--     could construct, and one UPDATE turns it off if a real user is caught.
--   · 戴考 / 黛购 — homophones with no other reading.
-- NOT seeded: 带购 (⊂ 带购物袋) and 带写 (⊂ 带写字台); 带写 is in the intent
-- table above instead.
--
-- Idempotent by NOT EXISTS, matching 20260901071645.
INSERT INTO public.moderation_keywords (keyword, category, severity)
SELECT seed.candidate, 'spam', 3
FROM (VALUES
  ('daigou'), ('daixie'), ('daikao'), ('banzheng'),
  ('shuadan'), ('jianzhi'), ('daikuan'), ('huanhui'),
  ('戴考'), ('黛购')
) AS seed(candidate)
WHERE NOT EXISTS (
  SELECT 1 FROM public.moderation_keywords existing
  WHERE LOWER(existing.keyword) = LOWER(seed.candidate)
);

NOTIFY pgrst, 'reload schema';

-- --------------------------------------------
-- Verification (run after apply):
--   -- contact info is allowed everywhere:
--   SELECT public.content_moderation_check('V: lisa2024');                  -- NULL
--   SELECT public.content_moderation_check('加我vx: lisa_2024');            -- NULL
--   SELECT public.content_moderation_check('WhatsApp 217 555 0199');        -- NULL
--   SELECT public.content_moderation_check('reach me at lisa@illinois.edu');-- NULL
--   SELECT public.content_moderation_check('13812345678');                  -- NULL
--   SELECT public.content_moderation_check('联系电话见简介');               -- NULL
--   -- the ad still cannot get through:
--   SELECT public.content_moderation_check('专业代购 需要的私信');          -- sensitive_word
--   SELECT public.content_moderation_check('代・购 专业 长期');             -- sensitive_word
--   SELECT public.content_moderation_check('亻弋购 专业，需要的私信');      -- sensitive_word
--   SELECT public.content_moderation_check('刷單兼職，日結靠譜');           -- sensitive_word
--   SELECT public.content_moderation_check('daigou 长期靠谱');              -- sensitive_word
--   SELECT public.content_moderation_check('兼职刷单 日结');                -- sensitive_word
--   -- everyday secondhand text is not an ad:
--   SELECT public.content_moderation_check('帮忙代购的包，闲置转让');       -- NULL
--   SELECT public.content_moderation_check('兼职时间不够所以出');           -- NULL
--   SELECT public.content_moderation_check('书桌带写字台，一起出');         -- NULL
--   SELECT public.content_moderation_check('租房需要哪些证件');             -- NULL
--   -- unrelated blocks are untouched:
--   SELECT public.content_moderation_check('傻逼');                         -- sensitive_word
--   SELECT public.content_moderation_check('Selling my TV, Xbox and a desk');-- NULL
-- --------------------------------------------
