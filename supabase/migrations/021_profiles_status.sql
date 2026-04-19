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

-- Column-level SELECT grants must be re-extended whenever we add a
-- profile column, because migrations 004 / 010 / 018 use column-list
-- grants (not table-wide) — any new column is otherwise hidden from
-- anon + authenticated even if RLS would allow it.
DO $$
BEGIN
  BEGIN
    EXECUTE 'GRANT SELECT (id, nickname, avatar_url, bio, location, is_illini_verified, created_at, updated_at, uid, avg_rating, rating_count, status_text, status_emoji) ON public.profiles TO anon, authenticated';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'grant on profiles.status_* failed: %', SQLERRM;
  END;
END $$;
-- ============================================
