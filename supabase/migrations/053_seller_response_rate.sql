-- 053_seller_response_rate.sql — denormalized seller reply-rate (the kit's "95% 回复")
--
-- The detail page wants a seller responsiveness signal, but it needs another
-- user's conversation/message rows, which RLS blocks client-side. So we
-- denormalize it onto profiles via a trigger — the SAME shape as the ratings
-- aggregate (migration 018) — and expose the column through the public
-- profiles SELECT grant.
--
-- Metric: over conversations where the profile is the SELLER and the buyer
-- actually reached out (sent >= 1 message), response_rate = % where the seller
-- replied (sent >= 1 message). response_sample = denominator (so the client can
-- hide a noisy "100% off 1 conversation").
--
-- Trigger cost: the rate only moves on the FIRST message from each party in a
-- conversation (buyer's outreach grows the denominator; seller's first reply
-- grows the numerator). So every message insert does one cheap indexed
-- existence check, and the O(conversations) recompute runs only on those rare
-- first-message events — not on every chat message.

alter table public.profiles
  add column if not exists response_rate   int not null default 0,
  add column if not exists response_sample int not null default 0;

create index if not exists messages_conv_sender_idx on public.messages(conversation_id, sender_id);

create or replace function public.recompute_seller_response(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total     int;
  v_responded int;
begin
  select count(*), count(*) filter (where seller_replied)
    into v_total, v_responded
  from (
    select c.id,
           bool_or(m.sender_id = p_user)     as seller_replied,
           bool_or(m.sender_id = c.buyer_id) as buyer_reached_out
    from public.conversations c
    join public.messages m on m.conversation_id = c.id
    where c.seller_id = p_user
    group by c.id, c.buyer_id
    having bool_or(m.sender_id = c.buyer_id)
  ) t;

  update public.profiles
    set response_sample = coalesce(v_total, 0),
        response_rate = case
          when coalesce(v_total, 0) > 0
            then round(coalesce(v_responded, 0)::numeric / v_total * 100)
          else 0
        end
    where id = p_user;
end;
$$;

create or replace function public.messages_after_change_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv     uuid;
  v_sender   uuid;
  v_seller   uuid;
  v_buyer    uuid;
  v_is_first boolean;
begin
  if tg_op = 'DELETE' then
    v_conv := OLD.conversation_id; v_sender := OLD.sender_id;
  else
    v_conv := NEW.conversation_id; v_sender := NEW.sender_id;
  end if;

  select seller_id, buyer_id into v_seller, v_buyer
    from public.conversations where id = v_conv;
  if v_seller is null then return null; end if;            -- conversation gone (cascade)
  -- only the seller's reply or the buyer's outreach can move the metric
  if v_sender not in (v_seller, v_buyer) then return null; end if;

  if tg_op = 'INSERT' then
    -- on insert, only the FIRST message per (conversation, sender) can change
    -- the rate — skip the recompute for every subsequent chat message.
    select not exists (
      select 1 from public.messages
      where conversation_id = v_conv and sender_id = v_sender and id <> NEW.id
    ) into v_is_first;
    if not v_is_first then return null; end if;
  end if;
  -- INSERT of a first message, or any participant DELETE (rare — un-counts a
  -- removed reply/outreach so a deleted seller reply can't keep inflating the
  -- rate), triggers a recompute. recompute reads live state → self-correcting.
  perform public.recompute_seller_response(v_seller);
  return null;
end;
$$;

drop trigger if exists trg_messages_response on public.messages;
create trigger trg_messages_response
  after insert or delete on public.messages
  for each row execute function public.messages_after_change_response();

-- recompute is internal (only the trigger calls it, as definer). No client
-- should call it directly, so revoke EXECUTE from PUBLIC + anon (Supabase
-- default privileges grant anon explicitly — REVOKE FROM PUBLIC alone won't
-- remove it; see migration 052). The trigger's PERFORM still works because it
-- runs as the SECURITY DEFINER owner, which always retains EXECUTE.
revoke all on function public.recompute_seller_response(uuid) from public;
revoke all on function public.recompute_seller_response(uuid) from anon;

-- Backfill existing sellers.
do $$
declare r record;
begin
  for r in select distinct seller_id from public.conversations loop
    perform public.recompute_seller_response(r.seller_id);
  end loop;
end $$;

-- Expose the new aggregate columns through the public profiles SELECT grant
-- (column-level grant adds to the existing one — same approach as 018).
do $$
begin
  begin
    execute 'grant select (response_rate, response_sample) on public.profiles to anon, authenticated';
  exception when others then
    raise warning 'grant on profiles failed: %', sqlerrm;
  end;
end $$;
