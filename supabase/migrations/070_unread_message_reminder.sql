-- 070 — unread-message email reminder (>12h unseen).
--
-- Eric's rule: if a user has a chat message they haven't read and it's been
-- unread for >12h, email them a reminder. The unread model is a single
-- per-message boolean public.messages.is_read (no read_at / last_read_at /
-- message_reads table), and chat messages never write a notifications row — so
-- the digest has never emailed about unread chat at all.
--
-- This adds the minimum to support an at-most-once reminder that auto-cancels
-- if the user reads the message first, mirroring meetups.reminded_at (061):
--   * messages.reminded_at — null = not yet reminded. The digest's new
--     generateUnreadMessageReminders() claim-then-acts (stamp reminded_at
--     BEFORE inserting the notification), so a split write misses a reminder
--     rather than duplicating one.
--   * partial index on the exact predicate the reminder query scans
--     (is_read=false AND reminded_at IS NULL), kept tiny so it costs almost
--     nothing on the hot write path.
--   * notifications.type gains 'unread_message' so the reminder rides the
--     existing emailed_at digest pipeline (per-user grouping, opt-out filter,
--     exactly-once send — all already solved).
--
-- No new GRANT: migration 064 revoked table-wide UPDATE on messages and
-- granted clients only UPDATE(is_read), so reminded_at is writable only by the
-- service-role digest — clients physically cannot touch it. Reading a message
-- (is_read -> true) before 12h elapses simply drops it from the query, so a
-- since-read message is never reminded.

alter table public.messages add column if not exists reminded_at timestamptz;

create index if not exists messages_unread_unreminded_idx
  on public.messages (created_at)
  where is_read = false and reminded_at is null;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('price_drop','system','sold','offer','meetup','unread_message'));

notify pgrst, 'reload schema';
