-- ============================================================
-- 015_content_i18n.sql
--
-- User-generated content bilingualism (and beyond).
--
-- Items and plaza posts now carry a jsonb translation map keyed by
-- BCP-47-ish language code (zh, en, future: ja, ko, zh-Hant). The
-- frontend reads `item.title_i18n?.[lang] ?? item.title`, so any row
-- without an i18n entry for the current UI lang falls back to the
-- original text the author typed — nothing breaks for pre-migration
-- rows, and users who post in a language outside our current pair
-- simply see the original until someone translates it.
--
-- Why jsonb, not dedicated _en / _zh columns: adding Japanese tomorrow
-- shouldn't require a migration. jsonb lets us .[lang] index into the
-- map from the client and be done.
--
-- source_lang records what the author actually typed in, so the
-- publish-time auto-translator knows which direction to go.
--
-- Rollback: drop the 5 columns; app keeps working via original title/
-- description/content fields.
-- ============================================================

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS title_i18n jsonb,
  ADD COLUMN IF NOT EXISTS description_i18n jsonb,
  ADD COLUMN IF NOT EXISTS source_lang text;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS content_i18n jsonb,
  ADD COLUMN IF NOT EXISTS source_lang text;

COMMENT ON COLUMN items.title_i18n IS
  'Localized titles, keyed by BCP-47 language code. e.g. {"zh":"小米手机","en":"Xiaomi phone"}. NULL until a translation is available. Frontend pattern: title_i18n?.[lang] ?? title.';
COMMENT ON COLUMN items.description_i18n IS
  'Localized descriptions, same shape as title_i18n.';
COMMENT ON COLUMN items.source_lang IS
  'Language the original title/description were authored in (zh, en, ...). Drives which target languages publish-time auto-translation fills in.';
COMMENT ON COLUMN posts.content_i18n IS
  'Localized post content, keyed by BCP-47 language code.';
COMMENT ON COLUMN posts.source_lang IS
  'Language the original post content was authored in.';

-- Shape guard: i18n columns must be a JSON object (or NULL), never an
-- array or scalar. Keeps the client-side lookup `obj?.[lang]` safe.
ALTER TABLE items
  DROP CONSTRAINT IF EXISTS items_title_i18n_is_object,
  DROP CONSTRAINT IF EXISTS items_description_i18n_is_object;
ALTER TABLE items
  ADD CONSTRAINT items_title_i18n_is_object
  CHECK (title_i18n IS NULL OR jsonb_typeof(title_i18n) = 'object'),
  ADD CONSTRAINT items_description_i18n_is_object
  CHECK (description_i18n IS NULL OR jsonb_typeof(description_i18n) = 'object');

ALTER TABLE posts
  DROP CONSTRAINT IF EXISTS posts_content_i18n_is_object;
ALTER TABLE posts
  ADD CONSTRAINT posts_content_i18n_is_object
  CHECK (content_i18n IS NULL OR jsonb_typeof(content_i18n) = 'object');

-- source_lang whitelist: if present must be a known locale. Leaving it
-- open-ended with a CHECK rather than an ENUM so adding ja/ko later
-- doesn't need another migration — just update the list.
ALTER TABLE items
  DROP CONSTRAINT IF EXISTS items_source_lang_valid;
ALTER TABLE items
  ADD CONSTRAINT items_source_lang_valid
  CHECK (source_lang IS NULL OR source_lang IN ('zh', 'en', 'ja', 'ko', 'zh-Hant'));

ALTER TABLE posts
  DROP CONSTRAINT IF EXISTS posts_source_lang_valid;
ALTER TABLE posts
  ADD CONSTRAINT posts_source_lang_valid
  CHECK (source_lang IS NULL OR source_lang IN ('zh', 'en', 'ja', 'ko', 'zh-Hant'));
