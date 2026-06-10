-- 051_offers.sql — structured negotiation offers for chat (UI v5, Phase 6)
--
-- Adds a first-class `offers` table so OBO haggling in chat becomes an
-- atomic offer → accept / decline / counter flow (with a 24h expiry and a
-- counter chain) instead of free-text "$20 ok?" messages.
--
-- Security shape (mirrors the 050 discipline):
--   · RLS SELECT is limited to the two conversation participants.
--   · There are NO client INSERT/UPDATE/DELETE policies. All writes go
--     through the two SECURITY DEFINER RPCs below, which enforce the
--     participant + recipient rules AND own notification creation
--     (clients cannot write notifications directly — migration 013).
--   · Both RPCs pin search_path and are revoked from anon.
--
-- Accepting an offer does NOT change item status (product decision) — it
-- just records the deal + notifies; the seller marks sold manually.

create table if not exists public.offers (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  item_id          uuid references public.items(id) on delete set null,
  from_user        uuid not null references public.profiles(id) on delete cascade,
  to_user          uuid not null references public.profiles(id) on delete cascade,
  price            numeric(10,2) not null check (price >= 0 and price <= 1000000),
  status           text not null default 'pending'
                     check (status in ('pending','accepted','declined','countered','expired')),
  parent_offer_id  uuid references public.offers(id) on delete set null,
  note             text check (note is null or char_length(note) <= 300),
  expires_at       timestamptz not null default (now() + interval '24 hours'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists offers_conversation_idx on public.offers(conversation_id, created_at);

alter table public.offers enable row level security;

drop policy if exists offers_select on public.offers;
create policy offers_select on public.offers for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = offers.conversation_id
        and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
    )
  );

-- Notifications gain an 'offer' type (was price_drop / system / sold).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('price_drop','system','sold','offer'));

-- ---------------------------------------------------------------------------
-- make_offer — buyer or seller proposes a price. Resolves the recipient from
-- the conversation, inserts the offer, bumps the conversation, notifies.
-- ---------------------------------------------------------------------------
create or replace function public.make_offer(
  p_conversation_id uuid,
  p_price numeric,
  p_note text default null
) returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv  public.conversations;
  v_to    uuid;
  v_offer public.offers;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null then raise exception 'conversation not found'; end if;
  if auth.uid() is null or auth.uid() not in (v_conv.buyer_id, v_conv.seller_id) then
    raise exception 'not a participant';
  end if;
  if p_price is null or p_price < 0 or p_price > 1000000 then
    raise exception 'invalid price';
  end if;

  v_to := case when auth.uid() = v_conv.buyer_id then v_conv.seller_id else v_conv.buyer_id end;

  insert into public.offers (conversation_id, item_id, from_user, to_user, price, note)
  values (p_conversation_id, v_conv.item_id, auth.uid(), v_to, round(p_price, 2), nullif(btrim(coalesce(p_note, '')), ''))
  returning * into v_offer;

  update public.conversations set last_message_at = now() where id = p_conversation_id;

  insert into public.notifications (user_id, type, title, body, item_id)
  values (v_to, 'offer', '新报价 · New offer',
          '$' || trim_scale(round(p_price, 2))::text, v_conv.item_id);

  return v_offer;
end;
$$;

-- ---------------------------------------------------------------------------
-- respond_to_offer — the RECIPIENT of a pending, unexpired offer accepts,
-- declines, or counters it. Counter marks the parent 'countered' and inserts
-- a fresh offer in the other direction. Each path notifies the original sender.
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_offer(
  p_offer_id uuid,
  p_action text,                      -- 'accept' | 'decline' | 'counter'
  p_counter_price numeric default null,
  p_counter_note text default null
) returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer   public.offers;
  v_new     public.offers;
begin
  select * into v_offer from public.offers where id = p_offer_id for update;
  if v_offer.id is null then raise exception 'offer not found'; end if;
  if auth.uid() is null or auth.uid() <> v_offer.to_user then
    raise exception 'only the recipient can respond';
  end if;
  if v_offer.status <> 'pending' then raise exception 'offer is no longer pending'; end if;
  if v_offer.expires_at <= now() then
    update public.offers set status = 'expired', updated_at = now() where id = p_offer_id;
    raise exception 'offer has expired';
  end if;

  if p_action = 'accept' then
    update public.offers set status = 'accepted', updated_at = now()
      where id = p_offer_id returning * into v_offer;
    insert into public.notifications (user_id, type, title, body, item_id)
    values (v_offer.from_user, 'offer', '报价被接受 · Offer accepted',
            '$' || trim_scale(v_offer.price)::text, v_offer.item_id);
    update public.conversations set last_message_at = now() where id = v_offer.conversation_id;
    return v_offer;

  elsif p_action = 'decline' then
    update public.offers set status = 'declined', updated_at = now()
      where id = p_offer_id returning * into v_offer;
    insert into public.notifications (user_id, type, title, body, item_id)
    values (v_offer.from_user, 'offer', '报价被拒绝 · Offer declined',
            '$' || trim_scale(v_offer.price)::text, v_offer.item_id);
    return v_offer;

  elsif p_action = 'counter' then
    if p_counter_price is null or p_counter_price < 0 or p_counter_price > 1000000 then
      raise exception 'invalid counter price';
    end if;
    update public.offers set status = 'countered', updated_at = now() where id = p_offer_id;
    insert into public.offers (conversation_id, item_id, from_user, to_user, price, note, parent_offer_id)
    values (v_offer.conversation_id, v_offer.item_id, auth.uid(), v_offer.from_user,
            round(p_counter_price, 2), nullif(btrim(coalesce(p_counter_note, '')), ''), v_offer.id)
    returning * into v_new;
    update public.conversations set last_message_at = now() where id = v_offer.conversation_id;
    insert into public.notifications (user_id, type, title, body, item_id)
    values (v_offer.from_user, 'offer', '收到还价 · Counter-offer',
            '$' || trim_scale(round(p_counter_price, 2))::text, v_offer.item_id);
    return v_new;

  else
    raise exception 'unknown action';
  end if;
end;
$$;

-- 050 discipline: functions default-grant EXECUTE to PUBLIC, and anon inherits
-- via PUBLIC — so REVOKE must target PUBLIC, not just anon. authenticated only.
revoke all on function public.make_offer(uuid, numeric, text) from public;
revoke all on function public.respond_to_offer(uuid, text, numeric, text) from public;
grant execute on function public.make_offer(uuid, numeric, text) to authenticated;
grant execute on function public.respond_to_offer(uuid, text, numeric, text) to authenticated;

-- Live offer cards for the other party in an open chat.
do $$
begin
  begin
    alter publication supabase_realtime add table public.offers;
  exception when duplicate_object then null;
  end;
end $$;
