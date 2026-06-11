-- 054_listing_type_wanted.sql — wanted / ISO (求购) posts on the items table
--
-- The PRD lists 求购 as a core category, but there was no sell-vs-wanted
-- distinction — only sell-side listings. Rather than a parallel table (which
-- would duplicate RLS, moderation, favorites, search, feed, detail), a wanted
-- post is just an item with listing_type = 'wanted': same infrastructure,
-- one discriminator column. Default 'sell' keeps every existing row + every
-- existing insert path unchanged.
--
-- condition (NOT NULL default 'good') and price (NOT NULL default 0) already
-- have sensible defaults, so a wanted post needs no schema relaxation —
-- price 0 reads as "budget open / 面议" and condition is just ignored in the
-- wanted UI.

alter table public.items
  add column if not exists listing_type text not null default 'sell'
    check (listing_type in ('sell', 'wanted'));

-- Feed query is (status = 'active' AND listing_type = X ORDER BY created_at DESC).
create index if not exists items_listing_type_idx
  on public.items(listing_type, status, created_at desc);
