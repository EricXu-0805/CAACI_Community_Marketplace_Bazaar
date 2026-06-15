-- 061_meetup_reschedule_dupeguard_reminder.sql — real-device QA round 3.
--
-- Three meetup fixes on top of 052:
--   #6c  propose_meetup must not stack a second pending proposal in a
--        conversation (the client could send two "Set a meetup" cards, both
--        live — ambiguous which one is "the" agreed meetup).
--   #6a  an ACCEPTED meetup's time/place must be changeable. respond_to_meetup
--        ('reschedule') is recipient-only + pending-only; this adds
--        reschedule_accepted_meetup so EITHER participant can change a
--        confirmed meetup. It re-enters pending so the change still needs the
--        other party's re-confirmation (no silent edit under someone).
--   #6e  pre-meetup email reminder. Adds meetups.reminded_at (null = not yet
--        reminded); the daily notification-digest cron fills synthetic
--        'meetup' notifications for accepted meetups happening in the next ~24h
--        and stamps reminded_at so it fires once.
--
-- Same security discipline as 052: SECURITY DEFINER, search_path pinned,
-- REVOKE from PUBLIC *and* anon (Supabase grants anon an explicit EXECUTE that
-- a REVOKE FROM PUBLIC does not remove), GRANT to authenticated only.

-- #6e — one-shot reminder dedupe column.
alter table public.meetups add column if not exists reminded_at timestamptz;

-- ---------------------------------------------------------------------------
-- #6c — propose_meetup gains a "no second pending" guard. Body otherwise
-- identical to 052. CREATE OR REPLACE keeps the existing grants.
-- ---------------------------------------------------------------------------
create or replace function public.propose_meetup(
  p_conversation_id uuid,
  p_spot text,
  p_meet_at timestamptz,
  p_note text default null
) returns public.meetups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv   public.conversations;
  v_to     uuid;
  v_spot   text;
  v_meetup public.meetups;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null then raise exception 'conversation not found'; end if;
  if auth.uid() is null or auth.uid() not in (v_conv.buyer_id, v_conv.seller_id) then
    raise exception 'not a participant';
  end if;

  -- #6c: at most one live pending proposal per conversation. Reschedule paths
  -- mark the parent 'rescheduled' before inserting, so they never trip this.
  if exists (
    select 1 from public.meetups
    where conversation_id = p_conversation_id
      and status = 'pending'
      and expires_at > now()
  ) then
    raise exception 'a meetup proposal is already pending';
  end if;

  v_spot := btrim(coalesce(p_spot, ''));
  if char_length(v_spot) = 0 or char_length(v_spot) > 120 then
    raise exception 'invalid spot';
  end if;
  if p_meet_at is null
     or p_meet_at < now() - interval '2 hours'
     or p_meet_at > now() + interval '90 days' then
    raise exception 'invalid meet time';
  end if;

  v_to := case when auth.uid() = v_conv.buyer_id then v_conv.seller_id else v_conv.buyer_id end;

  insert into public.meetups (conversation_id, item_id, from_user, to_user, spot, meet_at, note)
  values (p_conversation_id, v_conv.item_id, auth.uid(), v_to, v_spot, p_meet_at,
          nullif(btrim(coalesce(p_note, '')), ''))
  returning * into v_meetup;

  update public.conversations set last_message_at = now() where id = p_conversation_id;

  insert into public.notifications (user_id, type, title, body, item_id)
  values (v_to, 'meetup', '见面提议 · Meetup proposed', v_spot, v_conv.item_id);

  return v_meetup;
end;
$$;

-- ---------------------------------------------------------------------------
-- #6a — reschedule an already-accepted meetup. EITHER participant may change
-- the confirmed spot/time. Marks the accepted record 'rescheduled' and inserts
-- a fresh pending proposal to the OTHER party (parent chain, 24h window), so
-- the change re-enters the confirm flow rather than mutating silently.
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_accepted_meetup(
  p_meetup_id uuid,
  p_new_spot text,
  p_new_meet_at timestamptz,
  p_new_note text default null
) returns public.meetups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meetup public.meetups;
  v_new    public.meetups;
  v_spot   text;
  v_other  uuid;
begin
  select * into v_meetup from public.meetups where id = p_meetup_id for update;
  if v_meetup.id is null then raise exception 'meetup not found'; end if;
  if auth.uid() is null or auth.uid() not in (v_meetup.from_user, v_meetup.to_user) then
    raise exception 'not a participant';
  end if;
  if v_meetup.status <> 'accepted' then
    raise exception 'only an accepted meetup can be rescheduled';
  end if;

  v_spot := btrim(coalesce(p_new_spot, ''));
  if char_length(v_spot) = 0 or char_length(v_spot) > 120 then
    raise exception 'invalid spot';
  end if;
  if p_new_meet_at is null
     or p_new_meet_at < now() - interval '2 hours'
     or p_new_meet_at > now() + interval '90 days' then
    raise exception 'invalid meet time';
  end if;

  v_other := case when auth.uid() = v_meetup.from_user then v_meetup.to_user else v_meetup.from_user end;

  update public.meetups set status = 'rescheduled', updated_at = now() where id = p_meetup_id;
  insert into public.meetups (conversation_id, item_id, from_user, to_user, spot, meet_at, note, parent_meetup_id)
  values (v_meetup.conversation_id, v_meetup.item_id, auth.uid(), v_other,
          v_spot, p_new_meet_at, nullif(btrim(coalesce(p_new_note, '')), ''), v_meetup.id)
  returning * into v_new;
  update public.conversations set last_message_at = now() where id = v_meetup.conversation_id;
  insert into public.notifications (user_id, type, title, body, item_id)
  values (v_other, 'meetup', '改约请求 · Meetup change requested', v_spot, v_meetup.item_id);
  return v_new;
end;
$$;

revoke all on function public.reschedule_accepted_meetup(uuid, text, timestamptz, text) from public;
revoke all on function public.reschedule_accepted_meetup(uuid, text, timestamptz, text) from anon;
grant execute on function public.reschedule_accepted_meetup(uuid, text, timestamptz, text) to authenticated;

-- Verify:
--   -- dup guard: a 2nd propose in a conv with a live pending raises
--   --   'a meetup proposal is already pending'.
--   -- reschedule_accepted: anon=false / authenticated=true:
--   select has_function_privilege('anon', 'public.reschedule_accepted_meetup(uuid,text,timestamptz,text)', 'EXECUTE');
--   select has_function_privilege('authenticated', 'public.reschedule_accepted_meetup(uuid,text,timestamptz,text)', 'EXECUTE');
