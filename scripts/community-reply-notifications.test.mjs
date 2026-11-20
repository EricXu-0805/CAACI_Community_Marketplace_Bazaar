import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTHOR, FOLLOWER, OTHER, REPLIER, SKIP, TOPIC, UPDATE, id, startCommunityDatabase,
} from './fixtures/community-p3-database.mjs'

/*
 * P3.3: one reply reaches each person once. The topic author keeps the
 * existing post_comment notice; the author of the reply that was answered
 * gets comment_reply; everybody else who watches the topic gets
 * followed_post_reply, 500 at most. The person who replied gets nothing.
 */

const TITLE = '收到新评论 · New comment'
const PARENT_AUTHOR = id(8)

test('P3.3 reply notifications', { skip: SKIP }, async t => {
  const db = startCommunityDatabase()
  const { sql, as } = db
  try {
    sql(`INSERT INTO public.profiles(id, nickname) VALUES ('${PARENT_AUTHOR}', 'Parent author')`)
    const reset = () => sql(`TRUNCATE public.notifications, public.post_follows, public.blocks; DELETE FROM public.post_comments;
      UPDATE public.posts SET status = 'active', comment_count = 0`)
    const watch = (uid, post = TOPIC) => as(`INSERT INTO public.post_follows(user_id, post_id) VALUES ('${uid}', '${post}')`, 'authenticated', uid)
    const reply = (uid, content, { post = TOPIC, parent = null } = {}) =>
      as(`INSERT INTO public.post_comments(post_id, user_id, content, parent_comment_id)
        VALUES ('${post}', '${uid}', '${content}', ${parent ? `'${parent}'` : 'NULL'}) RETURNING id`, 'authenticated', uid)
    // Every notice as "<recipient>|<type>|<title>|<body>|<source_event_key>", in a stable order.
    const inbox = () => sql(`SELECT coalesce(string_agg(user_id || '|' || type || '|' || title || '|' || body || '|' || source_event_key, E'\\n'
      ORDER BY user_id, body, source_event_key), '') FROM public.notifications`).split('\n').filter(Boolean)
    const notice = (to, key, post, source) => `${to}|post_comment|${TITLE}|${key}:${post}|${source}`

    await t.test('the author and a watcher each get one notice, the replier none', () => {
      reset()
      watch(FOLLOWER)
      const comment = reply(REPLIER, 'First reply')
      assert.deepEqual(inbox(), [
        notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${comment}`),
        notice(FOLLOWER, 'followed_post_reply', TOPIC, `followed-reply:${comment}:${FOLLOWER}`),
      ])
      // The client finds the reply a notice is about by topic and instant.
      assert.equal(sql(`SELECT bool_and(n.created_at = c.created_at)::text || ':' || count(*) FROM public.notifications AS n
        JOIN public.post_comments AS c ON c.id = '${comment}'`), 'true:2')
      assert.equal(sql('SELECT count(*) FROM public.notifications WHERE is_read OR emailed_at IS NOT NULL OR item_id IS NOT NULL'), '0')
    })

    await t.test('a reply to a reply tells its author, who is then not told again as a watcher', () => {
      reset()
      watch(FOLLOWER)
      watch(PARENT_AUTHOR)
      const parent = reply(PARENT_AUTHOR, 'A first-level reply')
      sql('TRUNCATE public.notifications')
      const child = reply(REPLIER, 'An answer to that reply', { parent })
      assert.deepEqual(inbox(), [
        notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${child}`),
        notice(FOLLOWER, 'followed_post_reply', TOPIC, `followed-reply:${child}:${FOLLOWER}`),
        notice(PARENT_AUTHOR, 'comment_reply', TOPIC, `comment-reply:${child}`),
      ])
    })

    await t.test('the topic author is told once, whatever else they are', () => {
      reset()
      watch(AUTHOR)
      const parent = reply(AUTHOR, 'The author replies first')
      assert.deepEqual(inbox(), [], 'nobody is told about their own reply')
      const child = reply(REPLIER, 'An answer to the author', { parent })
      assert.deepEqual(inbox(), [notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${child}`)])
    })

    await t.test('people who reply to themselves or watch their own reply get nothing', () => {
      reset()
      watch(REPLIER)
      const parent = reply(REPLIER, 'My own reply')
      sql('TRUNCATE public.notifications')
      const child = reply(REPLIER, 'More from me', { parent })
      assert.deepEqual(inbox(), [notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${child}`)])
    })

    await t.test('a block in either direction keeps the notice from that watcher only', () => {
      for (const [blocker, blocked] of [[FOLLOWER, REPLIER], [REPLIER, FOLLOWER]]) {
        reset()
        watch(FOLLOWER)
        watch(OTHER)
        sql(`INSERT INTO public.blocks(blocker_id, blocked_id) VALUES ('${blocker}', '${blocked}')`)
        const comment = reply(REPLIER, 'A reply across a block')
        assert.deepEqual(inbox(), [
          notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${comment}`),
          notice(OTHER, 'followed_post_reply', TOPIC, `followed-reply:${comment}:${OTHER}`),
        ], `${blocker} blocked ${blocked}`)
      }
      reset()
      const parent = reply(PARENT_AUTHOR, 'A first-level reply')
      sql(`TRUNCATE public.notifications; INSERT INTO public.blocks(blocker_id, blocked_id) VALUES ('${PARENT_AUTHOR}', '${REPLIER}')`)
      const child = reply(REPLIER, 'An answer across a block', { parent })
      assert.deepEqual(inbox(), [notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${child}`)])
    })

    await t.test('a legacy update without a title notifies the same way', () => {
      reset()
      watch(FOLLOWER, UPDATE)
      const comment = reply(REPLIER, 'A reply to an update', { post: UPDATE })
      assert.deepEqual(inbox(), [
        notice(AUTHOR, 'post_comment', UPDATE, `post-comment:${comment}`),
        notice(FOLLOWER, 'followed_post_reply', UPDATE, `followed-reply:${comment}:${FOLLOWER}`),
      ])
    })

    await t.test('nothing new is sent for a hidden topic, a hidden reply or a hidden parent', () => {
      reset()
      watch(FOLLOWER)
      const parent = reply(PARENT_AUTHOR, 'A reply that is taken down')
      sql(`UPDATE public.post_comments SET status = 'hidden' WHERE id = '${parent}'; TRUNCATE public.notifications`)
      const child = reply(REPLIER, 'An answer to a hidden reply', { parent })
      assert.deepEqual(inbox(), [
        notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${child}`),
        notice(FOLLOWER, 'followed_post_reply', TOPIC, `followed-reply:${child}:${FOLLOWER}`),
      ], 'the author of a hidden reply is not told')

      sql('TRUNCATE public.notifications')
      sql(`INSERT INTO public.post_comments(post_id, user_id, content, status) VALUES ('${TOPIC}', '${REPLIER}', 'Inserted hidden', 'hidden')`)
      assert.deepEqual(inbox().filter(line => !line.includes('|post_comment:')), [], 'a reply that is not visible')

      sql(`TRUNCATE public.notifications; UPDATE public.posts SET status = 'hidden' WHERE id = '${TOPIC}'`)
      sql(`INSERT INTO public.post_comments(post_id, user_id, content) VALUES ('${TOPIC}', '${REPLIER}', 'On a hidden topic')`)
      assert.deepEqual(inbox().filter(line => !line.includes('|post_comment:')), [], 'a topic that is not visible')
    })

    await t.test('a watcher who stops watching gets no more notices and keeps the old ones', () => {
      reset()
      watch(FOLLOWER)
      const first = reply(REPLIER, 'Before')
      as(`DELETE FROM public.post_follows WHERE post_id = '${TOPIC}'`, 'authenticated', FOLLOWER)
      reply(REPLIER, 'After')
      assert.deepEqual(inbox().filter(line => line.startsWith(FOLLOWER)), [
        notice(FOLLOWER, 'followed_post_reply', TOPIC, `followed-reply:${first}:${FOLLOWER}`),
      ])
    })

    await t.test('501 watchers: the first 500 by watch time are told', () => {
      reset()
      sql(`INSERT INTO public.profiles(id, nickname)
          SELECT ('caac1120-2026-4000-8000-' || lpad((10000 + n)::text, 12, '0'))::uuid, 'Watcher ' || n FROM generate_series(1, 501) AS n;
        INSERT INTO public.post_follows(user_id, post_id, created_at)
          SELECT ('caac1120-2026-4000-8000-' || lpad((10000 + n)::text, 12, '0'))::uuid, '${TOPIC}', now() - interval '1 day' + n * interval '1 second'
          FROM generate_series(1, 501) AS n`)
      const comment = reply(REPLIER, 'A reply to a busy topic')
      assert.equal(sql(`SELECT count(*) || ':' || count(DISTINCT user_id) || ':' || count(DISTINCT source_event_key)
        FROM public.notifications WHERE body = 'followed_post_reply:${TOPIC}'`), '500:500:500')
      assert.equal(sql(`SELECT count(*) FROM public.notifications WHERE user_id = '${id(10501)}'`), '0', 'the latest watcher is the one left out')
      assert.equal(sql(`SELECT count(*) FROM public.notifications WHERE user_id = '${id(10500)}'
        AND source_event_key = 'followed-reply:${comment}:${id(10500)}'`), '1')
      assert.equal(sql('SELECT count(*) FROM public.notifications'), '501', '500 watchers and the topic author')
      sql(`DELETE FROM public.profiles WHERE nickname LIKE 'Watcher %'`)
    })

    await t.test('the trigger functions are closed to API roles and the existing trigger is untouched', () => {
      assert.deepEqual(db.grants(['private.notify_topic_reply()', 'private.reject_reply_to_locked_post()']), [
        'private.notify_topic_reply():',
        'private.reject_reply_to_locked_post():',
      ])
      assert.equal(sql(`SELECT string_agg(tgname::text || ':' || tgtype::text || ':' || tgenabled::text || ':' || tgfoid::regprocedure::text, ' ' ORDER BY tgname::text)
        FROM pg_trigger WHERE tgrelid = 'public.post_comments'::regclass AND NOT tgisinternal AND tgname IN ('trg_notify_post_comment', 'trg_notify_topic_reply')`),
      'trg_notify_post_comment:5:O:notify_post_comment() trg_notify_topic_reply:5:O:private.notify_topic_reply()')
      assert.equal(sql(`SELECT prosecdef::text || ':' || proconfig::text FROM pg_proc WHERE oid = 'private.notify_topic_reply()'::regprocedure`),
        'true:{search_path=pg_catalog}')
    })
  } finally {
    db.stop()
  }
})
