-- ============================================================
-- Relabel Chinese listings and posts that were filed as English
-- ============================================================
-- `source_lang` used to come from whatever the UI toggle happened to say, and
-- then from a detector that only flipped when CJK text carried no Latin run of
-- three letters or more. Almost every real listing on this site fails that
-- second test — a brand name is enough:
--
--   title        AirPods Pro 2 全新未拆封
--   source_lang  en
--   title_i18n   {"en": "AirPods Pro 2 全新未拆封"}
--
-- The label decides what gets translated. Publish-time fill translates into
-- every language EXCEPT the source, so calling these rows English asked for a
-- Chinese rendering of Chinese. Two things came back. Usually the same string,
-- which was dropped, leaving the map one key wide and every English reader
-- looking at Chinese forever. Sometimes an English rendering, stored under the
-- 'zh' key — description_i18n {"en": "用了一年…", "zh": "Used for a year…"} is on
-- production right now — which serves each reader the language they did not ask
-- for and can never be repaired by a later fill, because both keys are full.
--
-- Measured 2026-09-02: 6 of 6 CJK listings created after the previous fix
-- shipped were still filed 'en'.
--
-- WHAT THIS DOES
-- --------------
-- For a row whose source_lang is 'en', whose raw text contains CJK, and whose
-- 'en' entry is byte-identical to that raw text — i.e. the seeded key, not a
-- translation — move the author's text to the 'zh' key and relabel the row.
-- The 'en' key is dropped rather than filled: the reader-side localize() falls
-- through to auto-translation when a key is missing, so an English reader gets
-- a real translation on next view instead of a permanent wall of Chinese.
-- Dropping it also clears the inverted 'zh' value on the two rows that have one.
--
-- Rows already labelled correctly are untouched: an English listing has no CJK
-- in its title, and a Chinese listing that was labelled 'zh' never matches
-- source_lang = 'en'. A row whose 'en' entry is a genuine translation (so it
-- differs from the raw text) is also left alone — that is a real English
-- rendering and deleting it would cost a reader something.
--
-- Idempotent: matched rows leave with source_lang = 'zh', which the WHERE
-- clause excludes on any replay.
--
-- COLLATE "C" is load-bearing. A regex range in a bracket expression is
-- ordered by the collation, and this database is en_US.UTF-8; forcing C makes
-- [一-鿿] mean the codepoint range U+4E00..U+9FFF, matching the JavaScript
-- regex in app/src/composables/i18n/format.ts that decides the label going
-- forward.
--
-- Rollback: none needed. The worst case is a row that was already showing its
-- author's Chinese to everyone now shows the same Chinese under a truthful
-- label, with a translation on the way.
-- ============================================================

UPDATE public.items
SET
  source_lang = 'zh',
  title_i18n = CASE
    WHEN title_i18n ->> 'en' = title AND (title COLLATE "C") ~ '[一-鿿㐀-䶿]'
      THEN (title_i18n - 'en') || jsonb_build_object('zh', title)
    ELSE title_i18n
  END,
  description_i18n = CASE
    WHEN description_i18n ->> 'en' = description
         AND (description COLLATE "C") ~ '[一-鿿㐀-䶿]'
      THEN (description_i18n - 'en') || jsonb_build_object('zh', description)
    ELSE description_i18n
  END
WHERE source_lang = 'en'
  AND (
    (title_i18n ->> 'en' = title AND (title COLLATE "C") ~ '[一-鿿㐀-䶿]')
    OR (
      description_i18n ->> 'en' = description
      AND (description COLLATE "C") ~ '[一-鿿㐀-䶿]'
    )
  );

UPDATE public.posts
SET
  source_lang = 'zh',
  content_i18n = (content_i18n - 'en') || jsonb_build_object('zh', content)
WHERE source_lang = 'en'
  AND content_i18n ->> 'en' = content
  AND (content COLLATE "C") ~ '[一-鿿㐀-䶿]';
