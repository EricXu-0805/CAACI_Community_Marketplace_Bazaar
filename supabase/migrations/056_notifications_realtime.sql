-- 056_notifications_realtime.sql — in-app live notification delivery
--
-- The notifications table (price_drop / sold / offer / meetup / system) was
-- written by triggers/RPCs but had no realtime delivery, so a user already in
-- the app never saw a new offer or meetup land until they opened the
-- notifications page and pulled. Adding the table to the supabase_realtime
-- publication lets the H5 client subscribe to INSERTs and surface an in-app
-- toast + red-dot badge the moment a row is created.
--
-- RLS is already owner-scoped ("Users read own notifications": auth.uid() =
-- user_id, migration 005), so realtime postgres_changes only delivers a row
-- to the user it belongs to — the client-side user_id filter is belt-and-
-- suspenders, not the security boundary.

do $$
begin
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then null;
  end;
end $$;
