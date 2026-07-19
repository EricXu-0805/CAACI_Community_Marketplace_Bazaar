-- =========================================================
-- DEPRECATED OPERATOR BUNDLE — retained only as historical recovery evidence.
-- Do not execute this file. Its contracts predate the timestamped 2026-07
-- hardening chain and can overwrite current least-privilege functions.
-- Follow RUNBOOK.md and the matching PRECHECK/migration/VERIFY/REGRESSION files.
\set ON_ERROR_STOP on
DO $deprecated_operator_bundle$
BEGIN
  RAISE EXCEPTION
    'deprecated_operator_bundle: use the reviewed timestamped migration chain';
END
$deprecated_operator_bundle$;

-- =========================================================
-- RUN PENDING MIGRATIONS (bundle)
-- =========================================================
-- Historical instructions below are retained for incident archaeology only.
--
-- This bundles migrations 020 + 021 (both previously needed manual
-- application). Every statement is idempotent (IF NOT EXISTS / IF NOT EXISTS
-- for columns), so re-running is safe — it is a no-op after the first success.
--
-- What this does:
--   020 → adds items.location_verified (boolean) so we can distinguish
--         geo-verified safe-zone pickups from manually-typed locations.
--   021 → adds profiles.status_text + profiles.status_emoji so users can
--         set a WeChat-style status line under their nickname.
--
-- Impact of NOT running:
--   • Home feed, following feed, seller page, favorites → all 400 (HTTP)
--     because useItems() SELECTs `location_verified`.
--   • Profile edit save → 400 because updateProfile() sets `status_text` +
--     `status_emoji`.
--   In other words: the live site is currently broken until this is run.
-- =========================================================

BEGIN;

-- ---------- 020: items.location_verified ----------
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS location_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_items_location_verified
  ON public.items(location_verified)
  WHERE location_verified = TRUE AND status = 'active';

-- ---------- 021: profiles.status_text + status_emoji ----------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status_text TEXT,
  ADD COLUMN IF NOT EXISTS status_emoji TEXT;

-- Length guards — added as DO blocks so re-runs don't fail on duplicate
-- constraint names.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_status_text_len'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_status_text_len
      CHECK (status_text IS NULL OR char_length(status_text) <= 60);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_status_emoji_len'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_status_emoji_len
      CHECK (status_emoji IS NULL OR char_length(status_emoji) <= 8);
  END IF;
END $$;

-- Column-level SELECT grants — prior migrations (004, 010, 018) used
-- column-list grants on profiles, which hide any new column from anon +
-- authenticated until it is explicitly granted.
DO $$
BEGIN
  BEGIN
    EXECUTE 'GRANT SELECT (id, nickname, avatar_url, bio, location, is_illini_verified, created_at, updated_at, uid, avg_rating, rating_count, status_text, status_emoji) ON public.profiles TO anon, authenticated';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'grant on profiles.status_* failed: %', SQLERRM;
  END;
END $$;

-- ---------- 022: allow post / comment targets in reports ----------
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('item', 'user', 'message', 'post', 'comment'));

COMMIT;

-- =========================================================
-- Verification — both SELECTs should succeed (return 0 or more rows):
--   SELECT COUNT(*) AS verified_items FROM public.items WHERE location_verified = TRUE;
--   SELECT id, status_text, status_emoji FROM public.profiles WHERE status_text IS NOT NULL LIMIT 1;
-- =========================================================
-- =========================================================
