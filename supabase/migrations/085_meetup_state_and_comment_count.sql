-- 085_meetup_state_and_comment_count.sql — QA8 full-audit findings #4/#20/#21.
--
-- Three data-integrity fixes:
--
--   #20  propose_meetup / reschedule_accepted_meetup guard "one live pending
--        per conversation" with a check-then-insert and NO lock, so two
--        concurrent calls both see zero pending and both insert two pendings.
--        Fix: take a per-conversation transaction advisory lock at the top of
--        every pending-inserting path, making the check-then-insert atomic.
--
--   #4   An ACCEPTED meetup does not block a fresh proposal, and accept has no
--        "already confirmed" check — so a conversation can end up with two
--        live CONFIRMED meetups (propose M2 while M1 accepted, then accept M2).
--        Fix: propose_meetup rejects when an upcoming accepted meetup exists
--        (reschedule it instead), and respond_to_meetup('accept') rejects when
--        another upcoming accepted meetup already exists.
--
--   #21  admin_takedown_content('comment') sets status='hidden' AND manually
--        decrements posts.comment_count. The m010 AFTER DELETE count trigger
--        then fires AGAIN when the hidden row is later hard-deleted (FK
--        cascade), double-subtracting. Fix: the DELETE branch only decrements
--        when the removed comment was still 'active' (user hard-deletes are of
--        active comments; a hidden/deleted comment was already accounted for
--        when it left 'active').
--
-- All three RPCs are re-created verbatim from their latest definitions (061 /
-- 052 / 063) plus the additions above; CREATE OR REPLACE keeps grants, and the
-- REVOKE/GRANT blocks are re-run for safety (same discipline as 052/061/063).

-- ---------------------------------------------------------------------------
-- propose_meetup — advisory lock (#20) + upcoming-accepted guard (#4).
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

  -- #20: serialize concurrent proposals on this conversation so the guards
  -- below are atomic. Auto-released at transaction end.
  perform pg_advisory_xact_lock(hashtext(p_conversation_id::text)::bigint);

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

  -- #4: a confirmed, still-upcoming meetup must be changed via reschedule, not
  -- re-proposed — otherwise both can end up accepted.
  if exists (
    select 1 from public.meetups
    where conversation_id = p_conversation_id
      and status = 'accepted'
      and meet_at > now()
  ) then
    raise exception 'a meetup is already confirmed; reschedule it instead';
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

revoke all on function public.propose_meetup(uuid, text, timestamptz, text) from public;
revoke all on function public.propose_meetup(uuid, text, timestamptz, text) from anon;
grant execute on function public.propose_meetup(uuid, text, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- respond_to_meetup — advisory lock (#20) + already-confirmed accept guard (#4).
-- Verbatim from 052 plus those two additions.
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

  -- #20: serialize state changes on this conversation so the accept guard is
  -- atomic against a concurrent accept of a sibling pending.
  perform pg_advisory_xact_lock(hashtext(v_meetup.conversation_id::text)::bigint);

  if p_action = 'accept' then
    -- #4: don't create a second confirmed meetup — if another is already
    -- accepted and upcoming, this one must be declined or rescheduled.
    if exists (
      select 1 from public.meetups
      where conversation_id = v_meetup.conversation_id
        and status = 'accepted'
        and meet_at > now()
        and id <> p_meetup_id
    ) then
      raise exception 'another meetup is already confirmed';
    end if;
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

revoke all on function public.respond_to_meetup(uuid, text, text, timestamptz, text) from public;
revoke all on function public.respond_to_meetup(uuid, text, text, timestamptz, text) from anon;
grant execute on function public.respond_to_meetup(uuid, text, text, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- reschedule_accepted_meetup — advisory lock (#20). Verbatim from 063 plus the
-- lock. The upcoming-accepted guard is unnecessary here: this path consumes the
-- accepted meetup (marks it 'rescheduled') before inserting its child pending.
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

  -- #20: serialize on the conversation so the pending guard below is atomic.
  perform pg_advisory_xact_lock(hashtext(v_meetup.conversation_id::text)::bigint);

  -- C6: at most one live pending proposal per conversation.
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

-- ---------------------------------------------------------------------------
-- #21 — comment_count double-decrement. The DELETE branch only decrements when
-- the removed comment was still 'active'. A comment taken down by an admin was
-- already decremented when it moved active→hidden (075), so its eventual
-- cascade hard-delete must not subtract again. User self-deletes are hard
-- deletes of active comments, so they still decrement correctly.
-- ---------------------------------------------------------------------------
create or replace function public.update_post_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set comment_count = comment_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' and old.status = 'active' then
    update public.posts set comment_count = greatest(0, comment_count - 1) where id = old.post_id;
  end if;
  return null;
end;
$$;
