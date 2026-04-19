-- ============================================
-- 021 profiles.status_text — user status line (WeChat-style)
-- ============================================
-- Lightweight short status field on a user profile. Shown under the
-- nickname on the profile page and the seller page. Users may also set
-- a single leading emoji via status_emoji to give it some character.
--
-- Hard-capped at 60 chars to keep it a glance-level signal, not a
-- secondary bio. bio already exists for longer-form self-description.
--
-- Nullable / no default — an empty status means nothing is shown.
-- ============================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status_text TEXT
    CHECK (status_text IS NULL OR char_length(status_text) <= 60),
  ADD COLUMN IF NOT EXISTS status_emoji TEXT
    CHECK (status_emoji IS NULL OR char_length(status_emoji) <= 8);

-- No index — status is not searchable, only displayed.
-- Existing profiles get NULL which the UI renders as nothing.
-- ============================================
