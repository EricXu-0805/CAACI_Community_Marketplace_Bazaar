-- 052_meetups.sql — structured meetup scheduling for chat (post-v6)
--
-- Mirrors 051_offers.sql. P2P campus pickup has no payment, so the load-
-- bearing coordination step is "where + when do we meet". This turns the
-- usual free-text "grainger 3pm?" back-and-forth into an atomic
-- propose → accept / decline / reschedule flow with a 24h response window
-- and a reschedule chain.
--
-- Security shape (identical discipline to 050 / 051):
--   · RLS SELECT limited to the two conversation participants.
--   · NO client INSERT/UPDATE/DELETE policies — all writes go through the
--     two SECURITY DEFINER RPCs, which enforce participant + recipient
--     rules AND own notification creation (clients can't write
--     notifications directly — migration 013).
--   · Both RPCs pin search_path and are revoked from PUBLIC (anon inherits
--     EXECUTE via PUBLIC, so REVOKE must target PUBLIC), granted to
--     authenticated only.
--
-- Accepting a meetup does NOT change item status — it just records the
-- agreed spot + time and notifies; the seller still marks sold manually.

create table if not exists public.meetups (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.conversations(id) on delete cascade,
  item_id           uuid references public.items(id) on delete set null,
  from_user         uuid not null references public.profiles(id) on delete cascade,
  to_user           uuid not null references public.profiles(id) on delete cascade,
  spot              text not null check (char_length(btrim(spot)) between 1 and 120),
  meet_at           timestamptz not null,
  status            text not null default 'pending'
                      check (status in ('pending','accepted','declined','rescheduled','expired')),
  parent_meetup_id  uuid references public.meetups(id) on delete set null,
  note              text check (note is null or char_length(note) <= 300),
  expires_at        timestamptz not null default (now() + interval '24 hours'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists meetups_conversation_idx on public.meetups(conversation_id, created_at);

alter table public.meetups enable row level security;

drop policy if exists meetups_select on public.meetups;
create policy meetups_select on public.meetups for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = meetups.conversation_id
        and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
    )
  );

-- Notifications gain a 'meetup' type (was price_drop / system / sold / offer).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('price_drop','system','sold','offer','meetup'));

-- ---------------------------------------------------------------------------
-- propose_meetup — buyer or seller proposes a spot + time. Resolves the
-- recipient from the conversation, inserts the meetup, bumps the
-- conversation, notifies.
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
-- respond_to_meetup — the RECIPIENT of a pending, unexpired meetup accepts,
-- declines, or reschedules it. Reschedule marks the parent 'rescheduled' and
-- inserts a fresh proposal in the other direction. Each path notifies the
-- original proposer.
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_meetup(
  p_meetup_id uuid,
  p_action text,                        -- 'accept' | 'decline' | 'reschedule'
  p_new_spot text default null,
  p_new_meet_at timestamptz default null,
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
begin
  select * into v_meetup from public.meetups where id = p_meetup_id for update;
  if v_meetup.id is null then raise exception 'meetup not found'; end if;
  if auth.uid() is null or auth.uid() <> v_meetup.to_user then
    raise exception 'only the recipient can respond';
  end if;
  if v_meetup.status <> 'pending' then raise exception 'meetup is no longer pending'; end if;
  if v_meetup.expires_at <= now() then
    update public.meetups set status = 'expired', updated_at = now() where id = p_meetup_id;
    raise exception 'meetup has expired';
  end if;

  if p_action = 'accept' then
    update public.meetups set status = 'accepted', updated_at = now()
      where id = p_meetup_id returning * into v_meetup;
    insert into public.notifications (user_id, type, title, body, item_id)
    values (v_meetup.from_user, 'meetup', '约定已确认 · Meetup confirmed', v_meetup.spot, v_meetup.item_id);
    update public.conversations set last_message_at = now() where id = v_meetup.conversation_id;
    return v_meetup;

  elsif p_action = 'decline' then
    update public.meetups set status = 'declined', updated_at = now()
      where id = p_meetup_id returning * into v_meetup;
    insert into public.notifications (user_id, type, title, body, item_id)
    values (v_meetup.from_user, 'meetup', '约定被婉拒 · Meetup declined', v_meetup.spot, v_meetup.item_id);
    return v_meetup;

  elsif p_action = 'reschedule' then
    v_spot := btrim(coalesce(p_new_spot, ''));
    if char_length(v_spot) = 0 or char_length(v_spot) > 120 then
      raise exception 'invalid spot';
    end if;
    if p_new_meet_at is null
       or p_new_meet_at < now() - interval '2 hours'
       or p_new_meet_at > now() + interval '90 days' then
      raise exception 'invalid meet time';
    end if;
    update public.meetups set status = 'rescheduled', updated_at = now() where id = p_meetup_id;
    insert into public.meetups (conversation_id, item_id, from_user, to_user, spot, meet_at, note, parent_meetup_id)
    values (v_meetup.conversation_id, v_meetup.item_id, auth.uid(), v_meetup.from_user,
            v_spot, p_new_meet_at, nullif(btrim(coalesce(p_new_note, '')), ''), v_meetup.id)
    returning * into v_new;
    update public.conversations set last_message_at = now() where id = v_meetup.conversation_id;
    insert into public.notifications (user_id, type, title, body, item_id)
    values (v_meetup.from_user, 'meetup', '新的见面提议 · Meetup updated', v_spot, v_meetup.item_id);
    return v_new;

  else
    raise exception 'unknown action';
  end if;
end;
$$;

-- Lock execution to authenticated only. Two REVOKEs are required: PUBLIC
-- (the implicit default grant) AND anon explicitly — Supabase's default
-- privileges grant anon an EXPLICIT execute on every new function, which a
-- REVOKE ... FROM PUBLIC does not remove (verified on the live DB: without
-- the anon revoke, has_function_privilege('anon', ...) stayed true). Both
-- RPCs already self-gate on auth.uid(), but anon must not hold EXECUTE on a
-- SECURITY DEFINER function regardless.
revoke all on function public.propose_meetup(uuid, text, timestamptz, text) from public;
revoke all on function public.respond_to_meetup(uuid, text, text, timestamptz, text) from public;
revoke all on function public.propose_meetup(uuid, text, timestamptz, text) from anon;
revoke all on function public.respond_to_meetup(uuid, text, text, timestamptz, text) from anon;
grant execute on function public.propose_meetup(uuid, text, timestamptz, text) to authenticated;
grant execute on function public.respond_to_meetup(uuid, text, text, timestamptz, text) to authenticated;

-- Live meetup cards for the other party in an open chat.
do $$
begin
  begin
    alter publication supabase_realtime add table public.meetups;
  exception when duplicate_object then null;
  end;
end $$;
