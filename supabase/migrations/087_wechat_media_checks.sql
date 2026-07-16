-- 087: WeChat mediaCheckAsync trace bookkeeping.
--
-- mp store-review requires machine moderation of user-uploaded images
-- (reviewers upload violating images and expect interception). Images are
-- checked via WeChat's async media_check_async API: we submit the public
-- storage URL at upload time and WeChat pushes the verdict to
-- /api/wechat-callback minutes later, keyed only by trace_id. This table is
-- the trace_id → storage-object mapping the callback needs to take a
-- violating image down.
--
-- Service-role only (written by /api/wechat-seccheck, read+deleted by
-- /api/wechat-callback): RLS on with no policies, grants revoked — same
-- posture as wechat_password_map (m035).

create table public.wechat_media_checks (
  trace_id     text primary key,
  bucket       text not null,
  storage_path text not null,
  user_id      uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

alter table public.wechat_media_checks enable row level security;

revoke all on table public.wechat_media_checks from anon, authenticated;

-- Callback results normally arrive within minutes; rows older than a week
-- are dead weight from lost callbacks. Cheap index so a future cleanup can
-- range-scan by age.
create index wechat_media_checks_created_at_idx
  on public.wechat_media_checks (created_at);
