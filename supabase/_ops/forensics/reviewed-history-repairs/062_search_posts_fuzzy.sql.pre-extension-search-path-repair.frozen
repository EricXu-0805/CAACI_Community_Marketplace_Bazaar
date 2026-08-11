-- 062_search_posts_fuzzy.sql — fuzzy/trigram search for plaza posts.
--
-- Real-device QA round 3:
--   #12 plaza search was a literal `content ILIKE %term%` OR-chain — no
--       trigram index, missed typos/script variants, and couldn't rank.
--   #11 searching a person's NAME returned nothing: the author is an embedded
--       relation, and PostgREST can't filter a parent row by an embedded
--       child column (profile.nickname).
--
-- Mirror search_items_fuzzy (038/060): a SECURITY INVOKER (RLS-respecting)
-- SQL function matching post content OR author nickname via gin_trgm `%`
-- similarity + ILIKE, ranked. Posts are publicly readable (anon browses the
-- plaza), so EXECUTE is granted to anon + authenticated — intentional public
-- access, not a hole. Attached-item chips (post_items) are intentionally
-- omitted from search results (a SQL RPC can't cheaply return the nested
-- relation; the client renders search hits without item chips — same as
-- item search returning no nested children).

create extension if not exists pg_trgm;

create index if not exists idx_posts_content_trgm
  on public.posts using gin (content gin_trgm_ops);
create index if not exists idx_profiles_nickname_trgm
  on public.profiles using gin (nickname gin_trgm_ops);

create or replace function public.search_posts_fuzzy(
  terms_in   text[],
  sort_in    text  default 'recent',
  limit_in   int   default 20,
  offset_in  int   default 0
)
returns table (
  id                uuid,
  user_id           uuid,
  content           text,
  images            text[],
  image_dimensions  jsonb,
  content_i18n      jsonb,
  source_lang       text,
  is_official       boolean,
  is_pinned         boolean,
  like_count        int,
  comment_count     int,
  status            text,
  created_at        timestamptz,
  updated_at        timestamptz,
  profile           jsonb,
  rank              real
)
language sql
stable
set search_path = public
as $$
  select
    p.id, p.user_id, p.content, p.images, p.image_dimensions,
    p.content_i18n, p.source_lang, p.is_official, p.is_pinned,
    p.like_count, p.comment_count, p.status, p.created_at, p.updated_at,
    jsonb_build_object(
      'id',                 pr.id,
      'nickname',           pr.nickname,
      'avatar_url',         pr.avatar_url,
      'location',           pr.location,
      'is_illini_verified', pr.is_illini_verified,
      'status_text',        pr.status_text,
      'status_emoji',       pr.status_emoji
    ) as profile,
    (
      select coalesce(max(greatest(
        similarity(p.content, t),
        case when p.content ilike '%' || t || '%' then 0.4 else 0 end,
        similarity(coalesce(pr.nickname, ''), t) * 0.8,
        case when coalesce(pr.nickname, '') ilike '%' || t || '%' then 0.5 else 0 end
      )), 0)::real
        from unnest(terms_in) t
    ) as rank
  from public.posts p
  left join public.profiles pr on pr.id = p.user_id
  where p.status = 'active'
    and exists (
      select 1
        from unnest(terms_in) t
       where p.content % t
          or p.content ilike '%' || t || '%'
          or coalesce(pr.nickname, '') % t
          or coalesce(pr.nickname, '') ilike '%' || t || '%'
    )
  order by
    p.is_pinned desc,
    rank desc,
    case when sort_in = 'hot' then (p.like_count + p.comment_count) else 0 end desc,
    p.created_at desc
  limit greatest(1, least(limit_in, 100))
  offset greatest(0, offset_in)
$$;

revoke all on function public.search_posts_fuzzy(text[], text, int, int) from public;
grant execute on function public.search_posts_fuzzy(text[], text, int, int) to anon, authenticated;

notify pgrst, 'reload schema';

-- Verify:
--   select id, left(content,20), profile->>'nickname', rank
--     from public.search_posts_fuzzy(array['eric'], 'recent', 5, 0);
--   -- Expect posts whose content OR author nickname matches 'eric'.
