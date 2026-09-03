-- ============================================
-- 20260903023000 — Stop blocking everyday marketplace words
-- ============================================
-- 025 imported a generic Chinese blocklist wholesale. 504 of its entries are
-- two characters long, and content_moderation_check matches every non-ASCII
-- keyword as a raw substring of the separator-stripped text (024/049/089), so
-- these fire inside ordinary secondhand sentences. Measured against
-- production's own function on 2026-09-02, all refused as sensitive_word:
--
--   全新不穿，便宜出          (不穿  — "never worn")
--   冬天羽绒服 不穿了          (不穿)
--   帮忙代购的包              (代购  — bought on someone's behalf)
--   iPhone 代理商保修一年      (代理  — authorised dealer)
--   丝袜三双全新              (丝袜  — stockings)
--
-- and by the same mechanism a listing cannot say 带发票 (with receipt), 限量
-- (limited edition), 淘宝买的 (bought on Taobao), 全套教材 (complete set),
-- 到货 (arrived), 自拍杆 (selfie stick), 狗粮 (dog food), 网络课程 (online
-- course), 客服, 招聘, 兼职, 本店, 网购, 内裤, 写真, 刺激, 和弦, 火辣, 铃声,
-- 起诉, 死刑, 崩盘, 咪咪 (a cat's name as often as anything else).
--
-- Eric's decision (2026-09-03): these 29 come off. Sexual, drug, political,
-- exam-fraud and massage-parlour entries stay exactly as they are.
--
-- Deactivated rather than deleted so the import history stays readable and a
-- word can be turned back on with one UPDATE. Idempotent.

UPDATE public.moderation_keywords
SET active = false
WHERE category = 'lexicon'
  AND active = true
  AND keyword IN (
    '不穿', '丝袜', '内裤', '代理', '代购', '到货', '全套', '全职', '兼职',
    '写真', '刺激', '和弦', '客服', '招聘', '本店', '淘宝', '网购', '网络',
    '火辣', '狗粮', '自拍', '限量', '铃声', '发票', '發票', '開票', '起诉',
    '死刑', '崩盘', '咪咪'
  );

NOTIFY pgrst, 'reload schema';
