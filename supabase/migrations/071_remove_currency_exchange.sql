-- ============================================
-- 071 — Remove currency exchange as a tradeable category + seed
--       currency-exchange moderation keywords
-- ============================================
-- Compliance (Eric, 2026-06-29, after family/legal review): peer-to-peer
-- currency exchange on the platform risks unlicensed money transmission and
-- money-laundering exposure. Currency exchange is removed as a category
-- entirely. This migration is the DB half (the UI half drops it from
-- BROWSE_CATEGORIES / types / scam UI in the same PR):
--   1. Drop the old daily-cap guard (046) — superseded by an outright block.
--   2. Delete any existing currency_exchange listings. Every FK that
--      references public.items is ON DELETE CASCADE or SET NULL (migrations
--      001/005/015/018/041/051/052) — none RESTRICT — so this is
--      referential-safe: offers/meetups/plaza attachments null out;
--      ratings/post_items/notifications/images/conversations cascade.
--   3. Hard-block any future currency_exchange item at the DB boundary, so
--      the removal holds even against a direct PostgREST/API insert that
--      bypasses the (already currency-free) publish UI.
--   4. Seed conservative currency-exchange phrases into moderation_keywords
--      so exchange solicitation is blocked across items / posts / comments /
--      messages (the 024 + 049 triggers already cover all four surfaces).
--      Phrases are multi-char and verb-specific (换汇 / 外汇 / 汇率 / 换美元 /
--      买美元 / 兑美金 / "currency exchange" / "forex" / "buy usd" …) so they
--      flag exchange INTENT, not a bare currency mention. Deliberately NOT
--      seeded — each false-positives on legit posts (per the adversarial FP
--      audit that tuned this list):
--        · bare 美元 / dollar / rmb              -> blocks every price ("$25")
--        · 收/卖/买 + 美金 (收美金 ⊂ 回收美金色) -> champagne-gold collision
--        · 美元现金 / 美金现金                    -> "接受美元现金支付" is legit
--        · "exchange usd/rmb/yuan/dollars",
--          "rmb to usd", "exchange rate"          -> "can exchange usd", price talk
--      Mirrors app/src/utils/contentSafety.ts (client-side advisory copy).
--
-- The item_category enum value 'currency_exchange' is intentionally NOT
-- dropped: Postgres cannot remove an enum value that historically existed
-- without a full type rewrite, and the block trigger + UI removal already
-- make it unreachable. Leaving the label inert is the low-risk choice.
--
-- Idempotent: DROP IF EXISTS + CREATE OR REPLACE + ON CONFLICT DO NOTHING.
-- ============================================

-- 1. Retire the daily-cap trigger/function from 046.
DROP TRIGGER IF EXISTS trg_rl_currency_exchange ON public.items;
DROP FUNCTION IF EXISTS public.rl_currency_exchange_before_insert();

-- 2. Remove existing currency-exchange listings (FK-safe, see header).
DELETE FROM public.items WHERE category = 'currency_exchange';

-- 3. Hard-block currency_exchange at the DB boundary (insert or category change).
CREATE OR REPLACE FUNCTION public.block_currency_exchange_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.category = 'currency_exchange' THEN
    RAISE EXCEPTION 'category_not_allowed'
      USING HINT = 'Currency exchange listings are not permitted.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_currency_exchange ON public.items;
CREATE TRIGGER trg_block_currency_exchange
  BEFORE INSERT OR UPDATE OF category ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.block_currency_exchange_items();

-- 4. Seed conservative currency-exchange moderation keywords
--    (category 'currency', severity 3). ON CONFLICT keeps re-runs idempotent.
INSERT INTO public.moderation_keywords (keyword, category, severity) VALUES
  ('换汇','currency',3),
  ('外汇','currency',3),
  ('汇率','currency',3),
  ('套汇','currency',3),
  ('炒汇','currency',3),
  ('换美元','currency',3),
  ('换美金','currency',3),
  ('换美刀','currency',3),
  ('换人民币','currency',3),
  ('换rmb','currency',3),
  ('换软妹币','currency',3),
  ('兑换美元','currency',3),
  ('兑换美金','currency',3),
  ('兑换人民币','currency',3),
  ('兑换外汇','currency',3),
  ('美元换人民币','currency',3),
  ('人民币换美元','currency',3),
  ('美金换人民币','currency',3),
  ('人民币换美金','currency',3),
  ('买美元','currency',3),
  ('卖美元','currency',3),
  ('买人民币','currency',3),
  ('卖人民币','currency',3),
  ('兑美元','currency',3),
  ('兑美金','currency',3),
  ('兑人民币','currency',3),
  ('currency exchange','currency',3),
  ('exchange currency','currency',3),
  ('money exchange','currency',3),
  ('foreign exchange','currency',3),
  ('forex','currency',3),
  ('buy usd','currency',3),
  ('sell usd','currency',3),
  ('buy rmb','currency',3),
  ('sell rmb','currency',3)
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- --------------------------------------------
-- Verification (run after apply):
--   -- block trigger present:
--   SELECT tgname FROM pg_trigger
--     WHERE tgrelid='public.items'::regclass AND tgname='trg_block_currency_exchange';      -- 1 row
--   -- no currency listings remain:
--   SELECT count(*) FROM public.items WHERE category='currency_exchange';                    -- 0
--   -- direct insert is rejected:
--   --   INSERT ... (category='currency_exchange') -> ERROR category_not_allowed
--   -- keyword block fires ('moderation_block:sensitive_word'):
--   SELECT public.content_moderation_check('低价换汇');                     -- 'sensitive_word'
--   SELECT public.content_moderation_check('有人卖美元吗');                 -- 'sensitive_word'
--   SELECT public.content_moderation_check('currency exchange here');        -- 'sensitive_word'
--   SELECT public.content_moderation_check('今天汇率多少');                 -- 'sensitive_word'
--   -- conservative: legit posts are NOT blocked (per the FP audit):
--   SELECT public.content_moderation_check('卖书 25 美元');                 -- NULL
--   SELECT public.content_moderation_check('接受美元现金支付');             -- NULL
--   SELECT public.content_moderation_check('can exchange usd if you prefer');-- NULL
--   SELECT public.content_moderation_check('回收美金色的包');               -- NULL
-- --------------------------------------------
