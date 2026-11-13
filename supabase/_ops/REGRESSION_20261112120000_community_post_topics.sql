-- L-SQL only, rollback-only regression for 20261112120000_community_post_topics.sql
-- (ENGINEERING §5.1; BACKLOG P2.11 ① seven rejections and ②). All identities and
-- rows are synthetic and the transaction rolls back. Each rejection must fail for
-- its expected reason and prints one "REJECTED | case | SQLSTATE | message" line.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.expect_reject(label text, statement text, expected text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM !~ expected THEN
      RAISE EXCEPTION 'topic regression %: rejected for another reason: % (%)', label, SQLERRM, SQLSTATE;
    END IF;
    RAISE NOTICE 'REJECTED | % | % | %', label, SQLSTATE, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'topic regression %: accepted', label;
END
$fn$;

CREATE FUNCTION pg_temp.expect_rows(label text, statement text, expected bigint)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  actual bigint;
BEGIN
  EXECUTE statement INTO actual;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'topic regression %: expected %, got %', label, expected, actual;
  END IF;
END
$fn$;

-- 901 author A, 902 member B, 903 suspended member, 904 member blocked by A.
INSERT INTO auth.users(id, email, aud, role, raw_user_meta_data)
SELECT ('caac1112-2026-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
       'topic-probe-' || n || '@example.invalid', 'authenticated', 'authenticated',
       pg_catalog.jsonb_build_object('nickname', 'Topic probe ' || n)
  FROM pg_catalog.generate_series(901, 904) AS n;
INSERT INTO public.suspensions(profile_id, level, reason, ends_at)
VALUES ('caac1112-2026-4000-8000-000000000903', 2, 'Synthetic topic regression suspension',
        pg_catalog.now() + interval '1 day');
INSERT INTO public.blocks(blocker_id, blocked_id)
VALUES ('caac1112-2026-4000-8000-000000000901', 'caac1112-2026-4000-8000-000000000904');
-- Items 1101-1104 active and 1105 sold belong to A; 1106 to B; 1107 to the blocked member.
INSERT INTO public.items(id, user_id, title, status)
SELECT ('caac1112-2026-4000-8000-0000000011' || pg_catalog.lpad(n::text, 2, '0'))::uuid,
       (CASE n WHEN 6 THEN 'caac1112-2026-4000-8000-000000000902'
               WHEN 7 THEN 'caac1112-2026-4000-8000-000000000904'
               ELSE 'caac1112-2026-4000-8000-000000000901' END)::uuid,
       'Topic probe desk lamp ' || n,
       (CASE WHEN n = 5 THEN 'sold' ELSE 'active' END)::public.item_status
  FROM pg_catalog.generate_series(1, 7) AS n;

SET LOCAL request.jwt.claim.sub = 'caac1112-2026-4000-8000-000000000901';
SET LOCAL ROLE authenticated;
INSERT INTO public.posts(id, user_id, content, title, category)
VALUES ('caac1112-2026-4000-8000-000000002001', auth.uid(),
        'Synthetic body for the community topic regression.', 'Topic probe kayak swap', 'local-deals');
INSERT INTO public.post_items(post_id, item_id, display_order)
VALUES ('caac1112-2026-4000-8000-000000002001', 'caac1112-2026-4000-8000-000000001101', 0),
       ('caac1112-2026-4000-8000-000000002001', 'caac1112-2026-4000-8000-000000001102', 1);
SELECT pg_temp.expect_reject('P2.11-1 A links B''s item',
  $sql$INSERT INTO public.post_items(post_id, item_id, display_order)
       VALUES ('caac1112-2026-4000-8000-000000002001', 'caac1112-2026-4000-8000-000000001106', 2)$sql$,
  'row-level security');
SELECT pg_temp.expect_reject('P2.11-2 A links a sold item',
  $sql$INSERT INTO public.post_items(post_id, item_id, display_order)
       VALUES ('caac1112-2026-4000-8000-000000002001', 'caac1112-2026-4000-8000-000000001105', 2)$sql$,
  'row-level security');
SELECT pg_temp.expect_reject('P2.11-4 category invalid',
  $sql$INSERT INTO public.posts(user_id, content, title, category)
       VALUES (auth.uid(), 'Synthetic body with an unknown board.', 'Topic probe board', 'invalid')$sql$,
  'posts_topic_metadata_check');
SELECT pg_temp.expect_reject('P2.11-5 title of 121 characters',
  $sql$INSERT INTO public.posts(user_id, content, title, category)
       VALUES (auth.uid(), 'Synthetic body with a long title.', pg_catalog.repeat('题', 121), 'campus-life')$sql$,
  'post_title_size');
SELECT pg_temp.expect_reject('P2.11-6 topic body empty',
  $sql$INSERT INTO public.posts(user_id, content, title, category)
       VALUES (auth.uid(), ' ', 'Topic probe without body', 'campus-life')$sql$,
  'post_topic_body_required');
SELECT pg_temp.expect_reject('P2.11-7 A updates own title',
  $sql$UPDATE public.posts SET title = 'Topic probe edited'
        WHERE id = 'caac1112-2026-4000-8000-000000002001'$sql$,
  'permission denied');
SELECT pg_temp.expect_reject('A writes region',
  $sql$INSERT INTO public.posts(user_id, content, region)
       VALUES (auth.uid(), 'Synthetic body choosing a region.', 'cu')$sql$,
  'permission denied');
SELECT pg_temp.expect_reject('A reuses a post id',
  $sql$INSERT INTO public.posts(id, user_id, content, title, category)
       VALUES ('caac1112-2026-4000-8000-000000002001', auth.uid(),
               'A different synthetic body for the retry.', 'Topic probe retry', 'local-deals')$sql$,
  'duplicate');
SELECT pg_temp.expect_rows('A reads own topic',
  $sql$SELECT pg_catalog.count(*) FROM public.posts
        WHERE id = 'caac1112-2026-4000-8000-000000002001' AND title = 'Topic probe kayak swap'
          AND category = 'local-deals' AND region = 'cu'$sql$, 1);
RESET ROLE;

SET LOCAL request.jwt.claim.sub = 'caac1112-2026-4000-8000-000000000902';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_reject('B links own item to A''s topic',
  $sql$INSERT INTO public.post_items(post_id, item_id, display_order)
       VALUES ('caac1112-2026-4000-8000-000000002001', 'caac1112-2026-4000-8000-000000001106', 2)$sql$,
  'row-level security');
SELECT pg_temp.expect_reject('B updates A''s title',
  $sql$UPDATE public.posts SET title = 'Topic probe taken over'
        WHERE id = 'caac1112-2026-4000-8000-000000002001'$sql$,
  'permission denied');
SELECT pg_temp.expect_rows('B cannot delete A''s topic',
  $sql$WITH removed AS (DELETE FROM public.posts
        WHERE id = 'caac1112-2026-4000-8000-000000002001' RETURNING 1)
       SELECT pg_catalog.count(*) FROM removed$sql$, 0);
SELECT pg_temp.expect_rows('B reads A''s topic through search',
  $sql$SELECT pg_catalog.count(*) FROM public.search_community_posts(ARRAY['kayak'])$sql$, 1);
RESET ROLE;

SET LOCAL request.jwt.claim.sub = 'caac1112-2026-4000-8000-000000000903';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_reject('suspended member posts a topic',
  $sql$INSERT INTO public.posts(user_id, content, title, category)
       VALUES (auth.uid(), 'Synthetic body from a suspended member.', 'Topic probe suspended', 'campus-life')$sql$,
  'suspension_active');
RESET ROLE;

SET LOCAL request.jwt.claim.sub = 'caac1112-2026-4000-8000-000000000904';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_reject('blocked member links own item to A''s topic',
  $sql$INSERT INTO public.post_items(post_id, item_id, display_order)
       VALUES ('caac1112-2026-4000-8000-000000002001', 'caac1112-2026-4000-8000-000000001107', 2)$sql$,
  'row-level security');
SELECT pg_temp.expect_reject('blocked member updates A''s title',
  $sql$UPDATE public.posts SET title = 'Topic probe blocked edit'
        WHERE id = 'caac1112-2026-4000-8000-000000002001'$sql$,
  'permission denied');
RESET ROLE;

SET LOCAL request.jwt.claim.sub = 'caac1112-2026-4000-8000-000000000901';
SET LOCAL ROLE authenticated;
INSERT INTO public.post_items(post_id, item_id, display_order)
VALUES ('caac1112-2026-4000-8000-000000002001', 'caac1112-2026-4000-8000-000000001103', 2);
SELECT pg_temp.expect_reject('P2.11-3 A links a 4th item',
  $sql$INSERT INTO public.post_items(post_id, item_id, display_order)
       VALUES ('caac1112-2026-4000-8000-000000002001', 'caac1112-2026-4000-8000-000000001104', 3)$sql$,
  'post_items_cap_exceeded');
RESET ROLE;

SET LOCAL request.jwt.claim.sub = '';
SET LOCAL ROLE anon;
SELECT pg_temp.expect_reject('anon posts a topic',
  $sql$INSERT INTO public.posts(user_id, content, title, category)
       VALUES ('caac1112-2026-4000-8000-000000000901', 'Synthetic anonymous body.', 'Topic probe anon', 'campus-life')$sql$,
  'permission denied');
SELECT pg_temp.expect_rows('anon finds the topic through search',
  $sql$SELECT pg_catalog.count(*) FROM public.search_community_posts(ARRAY['kayak'], 'recent', 20, 0, 'local-deals', 'cu')$sql$, 1);
SELECT pg_temp.expect_rows('anon reads topic columns through posts_visible',
  $sql$SELECT pg_catalog.count(*) FROM public.posts_visible
        WHERE title = 'Topic probe kayak swap' AND category = 'local-deals' AND region = 'cu'$sql$, 1);
SELECT pg_temp.expect_rows('anon reads the three linked items',
  $sql$SELECT pg_catalog.count(*) FROM public.post_items
        WHERE post_id = 'caac1112-2026-4000-8000-000000002001'$sql$, 3);
RESET ROLE;

SET LOCAL request.jwt.claim.sub = 'caac1112-2026-4000-8000-000000000901';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_rows('A deletes own topic (P2.11 ②)',
  $sql$WITH removed AS (DELETE FROM public.posts
        WHERE id = 'caac1112-2026-4000-8000-000000002001' RETURNING 1)
       SELECT pg_catalog.count(*) FROM removed$sql$, 1);
RESET ROLE;

SET LOCAL request.jwt.claim.sub = '';
SET LOCAL ROLE anon;
SELECT pg_temp.expect_rows('anon search after delete',
  $sql$SELECT pg_catalog.count(*) FROM public.search_community_posts(ARRAY['kayak'])$sql$, 0);
SELECT pg_temp.expect_rows('anon posts_visible after delete',
  $sql$SELECT pg_catalog.count(*) FROM public.posts_visible WHERE title = 'Topic probe kayak swap'$sql$, 0);
RESET ROLE;

SELECT 'PASS: community topics regression; rolling back synthetic transaction' AS result;
ROLLBACK;
