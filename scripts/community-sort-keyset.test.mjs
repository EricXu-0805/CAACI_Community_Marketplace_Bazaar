import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTHOR, OTHER, REPLIER, SEARCH, SKIP, id, startCommunityDatabase,
} from './fixtures/community-p3-database.mjs'

/*
 * P3.4: "latest activity" and "unanswered" orderings, and paging that neither
 * repeats nor skips a topic when the list changes between two pages.
 *
 * The lists are read through PostgREST, so the page queries here are the SQL
 * those requests become: equality filters, the same ORDER BY and LIMIT, and
 * the client's two keyset conditions (usePlaza.ts). After an unpinned row:
 *   is_pinned=eq.false & or=(<time>.lt.T,and(<time>.eq.T,id.lt.I))
 * After a pinned row, which is what a page that ends inside the pinned
 * topics has for a cursor:
 *   or=(and(is_pinned.eq.true,or(<the same>)),is_pinned.eq.false)
 * They run as anon against the fixture's stand-ins for the row policy and the
 * column grants (fixtures/community-p3-database.mjs builds them in the shape
 * of the replayed database). The real policy and grants are exercised by
 * REGRESSION_20261120100354 under L-SQL.
 */

const topic = n => id(500 + n)

test('P3.4 ordering and keyset pages', { skip: SKIP }, async t => {
  const db = startCommunityDatabase()
  const { sql, as, attempt } = db
  try {
    // Twelve topics, one per hour, oldest first; activity starts where each was posted.
    sql(`DELETE FROM public.posts;
      INSERT INTO public.posts(id, user_id, content, title, category, created_at, last_activity_at)
      SELECT ('caac1120-2026-4000-8000-' || lpad((500 + n)::text, 12, '0'))::uuid, '${AUTHOR}', 'Keyset body ' || n, 'Keyset topic ' || n,
        CASE WHEN n % 2 = 0 THEN 'campus-life' ELSE 'settling-market' END,
        now() - interval '2 days' + n * interval '1 hour', now() - interval '2 days' + n * interval '1 hour'
      FROM generate_series(1, 12) AS n`)
    const numbered = rows => rows.map(row => Number(row.id.slice(-12)) - 500)
    // One page as anon. cursor = the last row of the previous page, pinned or not.
    const page = ({ by = 'last_activity_at', limit = 5, cursor = null, where = '' } = {}) => {
      const order = `is_pinned DESC, ${by} DESC, id DESC`
      const after = cursor && `(${by} < '${cursor.at}' OR (${by} = '${cursor.at}' AND id < '${cursor.id}'))`
      const keyset = !cursor ? ''
        : cursor.pinned ? `AND ((is_pinned = true AND ${after}) OR is_pinned = false)`
          : `AND is_pinned = false AND ${after}`
      return JSON.parse(as(`SELECT coalesce(json_agg(json_build_object('id', t.id, 'at', t.at, 'pinned', t.is_pinned) ORDER BY t.n), '[]')
        FROM (SELECT id, is_pinned, ${by}::text AS at, row_number() OVER (ORDER BY ${order}) AS n FROM public.posts
          WHERE status = 'active' AND region = 'cu' ${where} ${keyset}
          ORDER BY ${order} LIMIT ${limit}) AS t`, 'anon', ''))
    }
    // The search function's rows, in the order it returns them.
    const found = call => JSON.parse(as(`SELECT coalesce(json_agg(to_jsonb(t) - 'ordinality' ORDER BY t.ordinality), '[]')
      FROM ${call} WITH ORDINALITY AS t`, 'anon', ''))
    const search = (sort, terms = "ARRAY['Keyset']", extra = '') => found(`public.search_community_posts(${terms}, '${sort}', 100, 0${extra})`)

    await t.test('a reply moves the oldest topic to the top of latest activity', () => {
      assert.deepEqual(numbered(page()), [12, 11, 10, 9, 8])
      assert.deepEqual(numbered(search('active')).slice(0, 3), [12, 11, 10])
      as(`INSERT INTO public.post_comments(post_id, user_id, content) VALUES ('${topic(1)}', '${REPLIER}', 'A late answer')`, 'authenticated', REPLIER)
      assert.deepEqual(numbered(page()), [1, 12, 11, 10, 9])
      assert.deepEqual(numbered(search('active')).slice(0, 3), [1, 12, 11])
      assert.deepEqual(numbered(page({ by: 'created_at' })), [12, 11, 10, 9, 8], 'newest first is unchanged')
      assert.deepEqual(numbered(search('recent')).slice(0, 3), [12, 11, 10])
    })

    for (const by of ['last_activity_at', 'created_at']) {
      await t.test(`${by}: a topic posted between two pages is neither repeated nor skipped`, () => {
        const whole = numbered(page({ by, limit: 100 }))
        const first = page({ by })
        const inserted = as(`INSERT INTO public.posts(user_id, content, title, category) VALUES ('${OTHER}', 'Posted in between', 'Posted in between', 'campus-life') RETURNING id`, 'authenticated', OTHER)
        const second = page({ by, cursor: first.at(-1) })
        const third = page({ by, cursor: second.at(-1) })
        assert.deepEqual([...numbered(first), ...numbered(second), ...numbered(third)], whole, 'three pages are the list as it was')
        assert.equal(new Set([...first, ...second, ...third].map(row => row.id)).size, whole.length, 'no topic twice')
        // The same three pages by offset repeat one topic and never show another.
        const offset = [0, 5, 10].flatMap((skip, index) => index === 0 ? numbered(first)
          : numbered(JSON.parse(as(`SELECT coalesce(json_agg(row_to_json(t)), '[]') FROM (SELECT id FROM public.posts
            WHERE status = 'active' AND region = 'cu' ORDER BY is_pinned DESC, ${by} DESC, id DESC LIMIT 5 OFFSET ${skip}) AS t`, 'anon', ''))))
        assert.equal(new Set(offset).size, offset.length - 1, 'offset paging repeats the topic at the page boundary')
        sql(`DELETE FROM public.posts WHERE id = '${inserted}'`)
      })
    }

    await t.test('topics active at the same instant are split by id, in both directions of the tie', () => {
      sql(`UPDATE public.posts SET last_activity_at = date_trunc('hour', now()) WHERE id IN ('${topic(3)}', '${topic(4)}', '${topic(5)}', '${topic(6)}')`)
      const whole = numbered(page({ limit: 100 }))
      for (const limit of [1, 2, 3, 5]) {
        const seen = []
        for (let cursor = null, rows; (rows = page({ limit, cursor })).length; cursor = rows.at(-1)) seen.push(...numbered(rows))
        assert.deepEqual(seen, whole, `pages of ${limit}`)
      }
      sql(`UPDATE public.posts SET last_activity_at = created_at`)
    })

    await t.test('pinned topics lead the first page and are not read again', () => {
      sql(`UPDATE public.posts SET is_pinned = true WHERE id IN ('${topic(2)}', '${topic(7)}')`)
      const first = page({ limit: 4 })
      assert.deepEqual(numbered(first), [7, 2, 12, 11])
      const rest = []
      for (let cursor = first.at(-1), rows; (rows = page({ limit: 4, cursor })).length; cursor = rows.at(-1)) rest.push(...numbered(rows))
      assert.deepEqual(rest, [10, 9, 8, 6, 5, 4, 3, 1])
      // A first page made only of pinned topics starts the unpinned list from its top.
      const pinnedOnly = page({ limit: 2 })
      assert.deepEqual(numbered(pinnedOnly), [7, 2])
      assert.equal(pinnedOnly.at(-1).pinned, true)
      assert.deepEqual(numbered(page({ limit: 3, cursor: pinnedOnly.at(-1) })), [12, 11, 10])
      sql('UPDATE public.posts SET is_pinned = false')
    })

    await t.test('a page that ends inside the pinned topics goes on with the pinned ones behind it, then every unpinned one', () => {
      sql(`UPDATE public.posts SET is_pinned = true WHERE id IN ('${topic(2)}', '${topic(7)}', '${topic(9)}')`)
      const whole = numbered(page({ limit: 100 }))
      assert.deepEqual(whole, [9, 7, 2, 12, 11, 10, 8, 6, 5, 4, 3, 1])
      for (const limit of [1, 2, 3, 4, 5]) {
        const seen = []
        for (let cursor = null, rows; (rows = page({ limit, cursor })).length; cursor = rows.at(-1)) seen.push(...numbered(rows))
        assert.deepEqual(seen, whole, `pages of ${limit}`)
      }
      // Between two pages a topic is posted. The pinned topics still to come are not skipped, and the
      // unpinned list then starts at its top, where the new topic now is.
      const first = page({ limit: 1 })
      assert.deepEqual(numbered(first), [9])
      const inserted = as(`INSERT INTO public.posts(user_id, content, title, category) VALUES ('${OTHER}', 'Posted in between', 'Posted in between', 'campus-life') RETURNING id`, 'authenticated', OTHER)
      const second = page({ limit: 2, cursor: first.at(-1) })
      assert.deepEqual(numbered(second), [7, 2])
      const third = page({ limit: 3, cursor: second.at(-1) })
      assert.equal(third[0].id, inserted, 'the unpinned list starts at its top, where the new topic now is')
      assert.deepEqual(numbered(third.slice(1)), [12, 11])
      sql(`DELETE FROM public.posts WHERE id = '${inserted}'; UPDATE public.posts SET is_pinned = false`)
    })

    await t.test('a board filter pages on its own index order', () => {
      const where = `AND category = 'campus-life'`
      const first = page({ limit: 3, where })
      assert.deepEqual(numbered(first), [12, 10, 8])
      assert.deepEqual(numbered(page({ limit: 3, where, cursor: first.at(-1) })), [6, 4, 2])
    })

    await t.test('unanswered: topics nobody else has answered, posted in the last 30 days', () => {
      sql(`UPDATE public.posts SET answered_at = NULL, comment_count = 0;
        DELETE FROM public.post_comments;
        INSERT INTO public.posts(id, user_id, content, created_at, last_activity_at) VALUES
          ('${topic(20)}', '${AUTHOR}', 'Keyset update without a title', now() - interval '1 hour', now() - interval '1 hour');
        INSERT INTO public.posts(id, user_id, content, title, category, created_at, last_activity_at) VALUES
          ('${topic(21)}', '${AUTHOR}', 'Keyset old body', 'Keyset old topic', 'campus-life', now() - interval '31 days', now() - interval '31 days')`)
      as(`INSERT INTO public.post_comments(post_id, user_id, content) VALUES ('${topic(12)}', '${REPLIER}', 'An answer')`, 'authenticated', REPLIER)
      as(`INSERT INTO public.post_comments(post_id, user_id, content) VALUES ('${topic(11)}', '${AUTHOR}', 'The author adds a note')`, 'authenticated', AUTHOR)
      const unanswered = `AND title IS NOT NULL AND answered_at IS NULL AND created_at >= now() - interval '30 days'`
      const expected = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
      assert.deepEqual(numbered(page({ by: 'created_at', limit: 100, where: unanswered })), expected)
      assert.deepEqual(numbered(search('unanswered')), expected)
      const first = page({ by: 'created_at', limit: 4, where: unanswered })
      assert.deepEqual(numbered(page({ by: 'created_at', limit: 4, where: unanswered, cursor: first.at(-1) })), [7, 6, 5, 4])
      // Every other ordering still returns the answered topic, the old one and the update.
      assert.deepEqual(numbered(search('recent')).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20, 21])
      sql(`DELETE FROM public.post_comments; UPDATE public.posts SET answered_at = NULL, comment_count = 0, last_activity_at = created_at`)
    })

    await t.test('hot: only posts from the last 14 days, most engaged first', () => {
      sql(`UPDATE public.posts SET like_count = 9 WHERE id = '${topic(21)}';
        UPDATE public.posts SET like_count = 3, comment_count = 2 WHERE id = '${topic(4)}';
        UPDATE public.posts SET like_count = 1 WHERE id = '${topic(9)}';
        INSERT INTO public.posts(id, user_id, content, title, category, like_count, created_at, last_activity_at) VALUES
          ('${topic(22)}', '${AUTHOR}', 'Keyset body', 'Keyset fortnight', 'campus-life', 50, now() - interval '15 days', now())`)
      const hot = numbered(search('hot'))
      assert.deepEqual(hot.slice(0, 2), [4, 9])
      assert.ok(!hot.includes(21) && !hot.includes(22), 'older than 14 days')
      assert.equal(hot.length, 13)
      assert.ok(numbered(search('recent')).includes(22))
      sql(`DELETE FROM public.posts WHERE id IN ('${topic(20)}', '${topic(21)}', '${topic(22)}'); UPDATE public.posts SET like_count = 0, comment_count = 0`)
    })

    await t.test('the search function returns the activity columns under the same contract as before', () => {
      const row = search('active')[0]
      assert.deepEqual(Object.keys(row).sort(), ['answered_at', 'category', 'comment_count', 'content', 'content_i18n', 'created_at', 'id',
        'image_dimensions', 'images', 'is_official', 'is_pinned', 'last_activity_at', 'like_count', 'profile', 'rank', 'source_lang', 'status',
        'title', 'updated_at', 'user_id'])
      assert.equal(typeof row.last_activity_at, 'string')
      assert.equal(row.answered_at, null)
      assert.equal(sql(`SELECT pg_get_function_arguments('${SEARCH}'::regprocedure)`),
        `terms_in text[], sort_in text DEFAULT 'recent'::text, limit_in integer DEFAULT 20, offset_in integer DEFAULT 0, category_in text DEFAULT NULL::text, region_in text DEFAULT 'cu'::text`)
      assert.equal(sql(`SELECT prosecdef::text || ':' || provolatile::text || ':' || array_to_string(proconfig, ';') || ':' || proowner::regrole::text
        FROM pg_proc WHERE oid = '${SEARCH}'::regprocedure`), 'false:s:search_path=pg_catalog, public, extensions;statement_timeout=3s:postgres')
      assert.deepEqual(db.grants([SEARCH]), [`${SEARCH}:anon,authenticated`])
      assert.equal(search('active', "ARRAY['Keyset']", ", 'campus-life'").length, 6)
      assert.equal(search('active', "ARRAY['Keyset']", ", NULL, 'chi'").length, 0)
      assert.equal(search('no such ordering').length, 12, 'an unknown ordering is the default one')
      assert.deepEqual(numbered(found(`public.search_community_posts(ARRAY['Keyset'], 'active', 5, 5)`)), [7, 6, 5, 4, 3])
      // Invoker rights: the caller's row policy still decides what is found.
      sql(`UPDATE public.posts SET status = 'hidden' WHERE id = '${topic(12)}'`)
      assert.ok(!numbered(search('active')).includes(12))
      sql(`UPDATE public.posts SET status = 'active' WHERE id = '${topic(12)}'`)
      assert.equal(attempt(`SELECT count(*) FROM public.search_community_posts(ARRAY['Keyset'], 'active')`, { ask: true }), 'value:12')
      assert.equal(attempt(`SELECT count(*) FROM public.search_community_posts(ARRAY['Keyset'], 'active')`, { role: 'service_role', uid: '', ask: true }).slice(0, 6), '42501:')
    })

    await t.test('the three list indexes exist with their predicates', () => {
      const index = name => sql(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = '${name}'`)
      assert.match(index('posts_board_activity_idx'), /\(region, category, last_activity_at DESC, id DESC\) WHERE \(status = 'active'::text\)$/)
      assert.match(index('posts_activity_idx'), /\(region, last_activity_at DESC, id DESC\) WHERE \(status = 'active'::text\)$/)
      assert.match(index('posts_unanswered_idx'), /\(region, created_at DESC, id DESC\) WHERE \(\(status = 'active'::text\) AND \(title IS NOT NULL\) AND \(answered_at IS NULL\)\)$/)
    })
  } finally {
    db.stop()
  }
})
