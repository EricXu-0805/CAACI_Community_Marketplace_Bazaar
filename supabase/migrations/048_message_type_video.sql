-- ============================================
-- 048 Chat video — extend message_type enum
-- ============================================
-- 2026-06 meeting decision: 私信保留视频(20MB 上限), 发布侧维持仅图片。
-- message_type is a Postgres ENUM created in 001 ('text','image'); the
-- client refuses to send 'video' rows until this value exists, and the
-- insert would fail loudly (22P02 invalid input value) if attempted early.
--
-- Size enforcement is client-side (20MB pre-upload check in
-- useItems.uploadOneVideo) — Storage has no per-object size policy on
-- this plan; the global project upload cap is the backstop.
-- The 047 storage MIME trigger is a DENYLIST (svg/html/js only), so
-- video/mp4 / video/quicktime uploads to item-images pass untouched.
--
-- ALTER TYPE ... ADD VALUE cannot be rolled back and is idempotent via
-- IF NOT EXISTS. Existing rows, RLS policies, dedupe triggers (012/013)
-- and the conversations.last_message_* trigger are value-agnostic and
-- unaffected.
-- ============================================

ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'video';

-- --------------------------------------------
-- Verification (run after apply):
--   SELECT unnest(enum_range(NULL::message_type));  -- expect text,image,video
-- --------------------------------------------
