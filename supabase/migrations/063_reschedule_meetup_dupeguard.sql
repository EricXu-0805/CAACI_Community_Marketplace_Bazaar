-- 063_reschedule_meetup_dupeguard.sql — real-device QA round 3, finding C6.
--
-- 061 added reschedule_accepted_meetup (#6a) and a "no second live pending
-- proposal" guard to propose_meetup (#6c) — but the reschedule path skipped
-- that guard. An accepted meetup does NOT block a fresh propose_meetup, so a
-- conversation can hold M1=accepted + M2=pending; rescheduling M1 then inserts
-- M3=pending alongside M2. If each recipient accepts a different one, the
-- conversation ends up with two conflicting CONFIRMED meetups — the exact
-- ambiguity #6c exists to prevent.
--
-- Fix: add the same live-pending guard to reschedule_accepted_meetup, placed
-- after the participant/status checks and before the INSERT. Body otherwise
-- identical to 061. CREATE OR REPLACE keeps grants; the REVOKE/GRANT block is
-- re-run for safety (same discipline as 052/061).

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

  -- C6: at most one live pending proposal per conversation. The reschedule
  -- re-enters pending, so it must trip the same guard propose_meetup uses or
  -- it could stack a second pending alongside an existing one and produce two
  -- conflicting confirmed meetups.
  if exists (
    select 1 from public.meetups
    where conversation_id = v_meetup.conversation_id
      and status = 'pending'
      and expires_at > now()
  ) then
    raise exception 'a meetup proposal is already pending';
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
--   -- reschedule while a pending proposal exists raises
--   --   'a meetup proposal is already pending'.
--   select has_function_privilege('anon', 'public.reschedule_accepted_meetup(uuid,text,timestamptz,text)', 'EXECUTE');
--   select has_function_privilege('authenticated', 'public.reschedule_accepted_meetup(uuid,text,timestamptz,text)', 'EXECUTE');
