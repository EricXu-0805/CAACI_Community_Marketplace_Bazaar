-- ============================================
-- 046 Currency-exchange listing daily cap
-- ============================================
-- Audit finding (SECURITY_AUDIT.md:769-788): currency_exchange listings have
-- no DB-level enforcement — the anti-scam warnings are UX-only, so a scammer
-- can post unlimited exchange listings. This adds a per-user daily cap as the
-- lightweight immediate guard (escrow/transactions remain a separate roadmap
-- item — see docs/audit/SECURITY_SPECS_currency_and_mime.md).
--
-- Cap = 3 / day per user (Eric's policy choice, 2026-06). Normal users post
-- 1-2 exchange listings a day; 3 leaves headroom while blocking bulk spam.
-- This is a SEPARATE trigger from rl_items_before_insert so the general item
-- limits (10/hr, 30/day) still apply on top.
--
-- Idempotent (CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER).
-- ============================================

CREATE OR REPLACE FUNCTION public.rl_currency_exchange_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_day INT;
BEGIN
  IF NEW.category <> 'currency_exchange' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO last_day
    FROM public.items
    WHERE user_id = NEW.user_id
      AND category = 'currency_exchange'
      AND created_at > NOW() - INTERVAL '24 hours 1 second';
  IF last_day >= 3 THEN
    RAISE EXCEPTION 'rate_limit_currency_day'
      USING HINT = 'Daily currency-exchange listing limit reached.';
  END IF;

  RETURN NEW;
END;
$$;

-- Separate trigger name from trg_rl_items_before_insert so both fire.
DROP TRIGGER IF EXISTS trg_rl_currency_exchange ON public.items;
CREATE TRIGGER trg_rl_currency_exchange
  BEFORE INSERT ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.rl_currency_exchange_before_insert();

-- --------------------------------------------
-- Verification (run after apply):
--   -- (1) trigger present:
--   SELECT tgname FROM pg_trigger
--     WHERE tgrelid = 'public.items'::regclass AND tgname = 'trg_rl_currency_exchange';
--   -- (2) non-currency insert is unaffected (category guard returns early):
--   --     test by posting a normal item — should succeed.
--   -- (3) 4th currency_exchange listing in 24h should raise
--   --     'rate_limit_currency_day'.
-- --------------------------------------------
