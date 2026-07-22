-- ============================================
-- 014 Expand item_condition enum — add 'defective'
-- ============================================
-- Standardizes the condition scale to the 5-tier taxonomy used by
-- Xianyu (成新) and Mercari:
--   new        — unopened / unused
--   like_new   — 95%+ new, no visible wear
--   good       — light wear from normal use (default)
--   fair       — clear signs of use, fully functional
--   defective  — has a known defect; seller must disclose
--
-- Only the `defective` value is new; the other four were defined in 001.
-- ============================================

DO $$
BEGIN
  BEGIN
    ALTER TYPE item_condition ADD VALUE IF NOT EXISTS 'defective';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

-- Verification
--   SELECT unnest(enum_range(NULL::item_condition));
-- ============================================
