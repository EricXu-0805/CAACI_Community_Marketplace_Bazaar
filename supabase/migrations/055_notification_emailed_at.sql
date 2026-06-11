-- 055_notification_emailed_at.sql — exactly-once tracking for the email digest
--
-- The notifications table is written by triggers/RPCs (price_drop, sold, offer,
-- meetup, saved-search, system) but delivery has been in-app only — the single
-- biggest retention leak. The off-platform email digest (api/notification-digest.js,
-- Brevo) marks each notification's emailed_at after a successful send so a row is
-- never emailed twice across daily runs.

alter table public.notifications
  add column if not exists emailed_at timestamptz;

-- Partial index over the digest's working set (un-emailed rows only).
create index if not exists notifications_unemailed_idx
  on public.notifications(user_id, created_at)
  where emailed_at is null;
