-- ============================================
-- 020 items.location_verified flag
-- ============================================
-- Distinguishes items whose location was auto-detected via the device's
-- geolocation API (and confirmed to match a known campus safe-zone)
-- from items whose location was manually typed or picked from a list.
--
-- Only geo-verified safe-zone pickups get the "✓ verified pickup spot"
-- trust badge on item cards. A user typing "Illini Union" without ever
-- being there will NOT trigger the badge.
--
-- Attack surface: IP/GPS spoofing via VPN or fake GPS apps can fool
-- the geo-detection — that is an accepted limitation noted to the user.
-- The flag is only set client-side at publish time; server never
-- re-verifies. Good enough for a trust hint, not a security control.
-- ============================================

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS location_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing items' locations were all typed/picked manually (pre-feature),
-- so DEFAULT FALSE is the correct backfill — no UPDATE needed.

-- Small partial index for filtering verified-safe items (future: a
-- "verified pickups only" toggle in search).
CREATE INDEX IF NOT EXISTS idx_items_location_verified
  ON public.items(location_verified)
  WHERE location_verified = TRUE AND status = 'active';

-- Verification
--   SELECT COUNT(*) FROM public.items WHERE location_verified = TRUE;
-- ============================================
