import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTHOR, FOLLOWER, OTHER, REPLIER, SKIP, STATES, TOPIC, TOPIC_OTHER, UPDATE, id, setState, startCommunityDatabase,
} from './fixtures/community-p3-database.mjs'

/*
 * P3.3: one reply reaches each person once. The topic author keeps the
 * existing post_comment notice; the author of the reply that was answered
 * gets comment_reply; everybody else who watches the topic gets
 * followed_post_reply, 500 at most. The person who replied gets nothing.
 *
 * D-54 2c: the two new notices ship switched off. Every reply below that
 * expects one is written with the switch on for its own transaction only, so
 * the committed state of the database stays as the migration leaves it.
 */

const TITLE = '收到新评论 · New comment'
const PARENT_AUTHOR = id(8)
const SWITCH = 'private.community_reply_notice_config'
const state = name => STATES.find(candidate => candidate.name === name)

test('P3.3 reply notifications', { skip: SKIP }, async t => {
  const db = startCommunityDatabase()
  const { sql, as, attempt } = db
  try {
    sql(`INSERT INTO public.profiles(id, nickname) VALUES ('${PARENT_AUTHOR}', 'Parent author')`)
    const reset = () => sql(`TRUNCATE public.notifications, public.post_follows, public.blocks; DELETE FROM public.post_comments;
      DELETE FROM public.suspensions; UPDATE public.posts SET status = 'active', comment_count = 0`)
    const watch = (uid, post = TOPIC) => as(`INSERT INTO public.post_follows(user_id, post_id) VALUES ('${uid}', '${post}')`, 'authenticated', uid)
    // One statement with the switch on around it; what is committed keeps the switch off.
    const noticesOn = statement => sql(`BEGIN; UPDATE ${SWITCH} SET enabled = true; ${statement}; RESET ROLE;
      UPDATE ${SWITCH} SET enabled = false; COMMIT;`)
    const insertReply = (uid, content, { post = TOPIC, parent = null, replyTo = null } = {}) =>
      `INSERT INTO public.post_comments(post_id, user_id, content, parent_comment_id, reply_to_comment_id)
        VALUES ('${post}', '${uid}', '${content}', ${parent ? `'${parent}'` : 'NULL'}, ${replyTo ? `'${replyTo}'` : 'NULL'})`
    const asMember = (uid, statement) => `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${uid}'; ${statement}`
    const reply = (uid, content, target) => noticesOn(asMember(uid, `${insertReply(uid, content, target)} RETURNING id`))
    const refused = (uid, content, target) => attempt(insertReply(uid, content, target), { uid })
    const storedTarget = comment => sql(`SELECT coalesce(reply_to_comment_id::text, 'null') FROM public.post_comments WHERE id = '${comment}'`)
    // Every notice as "<recipient>|<type>|<title>|<body>|<source_event_key>", in a stable order.
    const inbox = () => sql(`SELECT coalesce(string_agg(user_id || '|' || type || '|' || title || '|' || body || '|' || source_event_key, E'\\n'
      ORDER BY user_id, body, source_event_key), '') FROM public.notifications`).split('\n').filter(Boolean)
    const notice = (to, key, post, source) => `${to}|post_comment|${TITLE}|${key}:${post}|${source}`

    await t.test('the two new notices ship switched off: a reply writes neither until the switch is on', () => {
      reset()
      assert.equal(sql(`SELECT count(*) || ':' || bool_and(singleton)::text || ':' || bool_or(enabled)::text FROM ${SWITCH}`), '1:true:false')
      watch(FOLLOWER)
      const parent = as(`${insertReply(PARENT_AUTHOR, 'A first-level reply')} RETURNING id`, 'authenticated', PARENT_AUTHOR)
      const child = as(`${insertReply(REPLIER, 'An answer to that reply', { parent, replyTo: parent })} RETURNING id`, 'authenticated', REPLIER)
      // The notice the topic author has always had is not behind the switch.
      assert.deepEqual(inbox(), [
        notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${child}`),
        notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${parent}`),
      ].sort())
      assert.equal(sql(`SELECT count(*) FROM public.notifications WHERE body LIKE 'comment_reply:%' OR body LIKE 'followed_post_reply:%'`), '0')
      // The same two replies with the switch on are announced.
      reset()
      watch(FOLLOWER)
      const announced = reply(REPLIER, 'A reply while the switch is on')
      assert.equal(sql(`SELECT count(*) FROM public.notifications WHERE body = 'followed_post_reply:${TOPIC}'
        AND source_event_key = 'followed-reply:${announced}:${FOLLOWER}'`), '1')
      assert.equal(sql(`SELECT enabled::text FROM ${SWITCH}`), 'false', 'what is committed stays switched off')
      // Only the owner turns it on: one row, no policy, no grant to an API role.
      assert.equal(sql(`SELECT c.relrowsecurity::text || ':' || (SELECT count(*) FROM pg_policy WHERE polrelid = c.oid) || ':'
        || (SELECT count(*) FROM aclexplode(c.relacl) AS entry WHERE entry.grantee <> c.relowner)
        FROM pg_class AS c WHERE c.oid = '${SWITCH}'::regclass`), 'true:0:0')
      for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal(attempt(`SELECT enabled FROM ${SWITCH}`, { role, uid: '', ask: true }).slice(0, 6), '42501:', role)
        assert.equal(attempt(`UPDATE ${SWITCH} SET enabled = true`, { role, uid: '' }).slice(0, 6), '42501:', role)
      }
      assert.throws(() => sql(`INSERT INTO ${SWITCH}(singleton, enabled) VALUES (false, true)`), /violates check constraint/)
      assert.throws(() => sql(`INSERT INTO ${SWITCH} DEFAULT VALUES`), /duplicate key/)
    })

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
      // A client from before the reply target column names only the thread.
      const child = reply(REPLIER, 'An answer to that reply', { parent })
      assert.deepEqual(inbox(), [
        notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${child}`),
        notice(FOLLOWER, 'followed_post_reply', TOPIC, `followed-reply:${child}:${FOLLOWER}`),
        notice(PARENT_AUTHOR, 'comment_reply', TOPIC, `comment-reply:${child}`),
      ])
    })

    // D-54 2f (SPEC 6.8): the notice goes to the author of the reply that was answered.
    await t.test('an answer to a reply inside a thread tells that reply\'s author, not the thread\'s first author', () => {
      reset()
      watch(FOLLOWER)
      watch(PARENT_AUTHOR)
      const top = reply(PARENT_AUTHOR, 'A first-level reply')
      const nested = reply(OTHER, 'A reply inside the thread', { parent: top, replyTo: top })
      sql('TRUNCATE public.notifications')
      const child = reply(REPLIER, 'An answer to the reply inside the thread', { parent: top, replyTo: nested })
      assert.equal(storedTarget(child), nested)
      assert.deepEqual(inbox(), [
        notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${child}`),
        notice(FOLLOWER, 'followed_post_reply', TOPIC, `followed-reply:${child}:${FOLLOWER}`),
        notice(OTHER, 'comment_reply', TOPIC, `comment-reply:${child}`),
        // The thread's first author was not answered; they watch the topic, so they are told as a watcher.
        notice(PARENT_AUTHOR, 'followed_post_reply', TOPIC, `followed-reply:${child}:${PARENT_AUTHOR}`),
      ])
      // Without the watch the thread's first author hears nothing about it.
      as(`DELETE FROM public.post_follows WHERE post_id = '${TOPIC}'`, 'authenticated', PARENT_AUTHOR)
      sql('TRUNCATE public.notifications')
      reply(REPLIER, 'A second answer to the reply inside the thread', { parent: top, replyTo: nested })
      assert.equal(sql(`SELECT count(*) FROM public.notifications WHERE user_id = '${PARENT_AUTHOR}'`), '0')
    })

    await t.test('the topic author is told once, whatever else they are', () => {
      reset()
      watch(AUTHOR)
      const parent = reply(AUTHOR, 'The author replies first')
      assert.deepEqual(inbox(), [], 'nobody is told about their own reply')
      const child = reply(REPLIER, 'An answer to the author', { parent })
      assert.deepEqual(inbox(), [notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${child}`)])

      // The topic author is the person answered, inside somebody else's thread: post_comment and nothing else.
      reset()
      const top = reply(PARENT_AUTHOR, 'Somebody else starts a thread')
      const fromAuthor = reply(AUTHOR, 'The topic author joins it', { parent: top, replyTo: top })
      sql('TRUNCATE public.notifications')
      const answer = reply(REPLIER, 'An answer to the topic author', { parent: top, replyTo: fromAuthor })
      assert.deepEqual(inbox(), [notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${answer}`)])
    })

    await t.test('people who reply to themselves or watch their own reply get nothing', () => {
      reset()
      watch(REPLIER)
      const parent = reply(REPLIER, 'My own reply')
      sql('TRUNCATE public.notifications')
      const child = reply(REPLIER, 'More from me', { parent, replyTo: parent })
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
      // The person answered is not told across a block either, whichever of the two placed it
      // and whether the reply names the thread or the reply itself.
      for (const [blocker, blocked] of [[PARENT_AUTHOR, REPLIER], [REPLIER, PARENT_AUTHOR]]) {
        for (const target of ['thread', 'reply']) {
          reset()
          const parent = reply(PARENT_AUTHOR, 'A first-level reply')
          sql(`TRUNCATE public.notifications; INSERT INTO public.blocks(blocker_id, blocked_id) VALUES ('${blocker}', '${blocked}')`)
          const child = reply(REPLIER, 'An answer across a block', { parent, replyTo: target === 'reply' ? parent : null })
          assert.deepEqual(inbox(), [notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${child}`)], `${blocker} blocked ${blocked}: ${target}`)
        }
      }
      // The watch rule refuses a pair with a block between watcher and topic author. A block placed after
      // the watch was made silences it the same way, and only for that watcher.
      for (const [blocker, blocked] of [[AUTHOR, FOLLOWER], [FOLLOWER, AUTHOR]]) {
        reset()
        watch(FOLLOWER)
        watch(OTHER)
        sql(`INSERT INTO public.blocks(blocker_id, blocked_id) VALUES ('${blocker}', '${blocked}')`)
        const comment = reply(REPLIER, 'A reply to a topic whose author and watcher are blocked')
        assert.deepEqual(inbox(), [
          notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${comment}`),
          notice(OTHER, 'followed_post_reply', TOPIC, `followed-reply:${comment}:${OTHER}`),
        ], `${blocker} blocked ${blocked}`)
        assert.equal(attempt(`INSERT INTO public.post_bookmarks(user_id, post_id) VALUES ('${FOLLOWER}', '${TOPIC}')`, { uid: FOLLOWER }).slice(0, 6),
          '42501:', 'the same pair cannot start a new mark on the topic')
      }
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
      noticesOn(`INSERT INTO public.post_comments(post_id, user_id, content, status) VALUES ('${TOPIC}', '${REPLIER}', 'Inserted hidden', 'hidden')`)
      assert.deepEqual(inbox().filter(line => !line.includes('|post_comment:')), [], 'a reply that is not visible')

      sql(`TRUNCATE public.notifications; UPDATE public.posts SET status = 'hidden' WHERE id = '${TOPIC}'`)
      noticesOn(`INSERT INTO public.post_comments(post_id, user_id, content) VALUES ('${TOPIC}', '${REPLIER}', 'On a hidden topic')`)
      assert.deepEqual(inbox().filter(line => !line.includes('|post_comment:')), [], 'a topic that is not visible')
    })

    // D-54 2f: the reply target is checked when the reply is written.
    await t.test('a reply target must be a visible reply in the same thread of the same topic', () => {
      reset()
      const top = reply(PARENT_AUTHOR, 'A first-level reply')
      const nested = reply(OTHER, 'A reply inside the thread', { parent: top, replyTo: top })
      const otherThread = reply(FOLLOWER, 'Another thread in the same topic')
      const elsewhere = reply(OTHER, 'A reply in another topic', { post: TOPIC_OTHER })
      const invalid = '23514:comment_reply_target_invalid'
      assert.equal(refused(REPLIER, 'Across topics', { parent: top, replyTo: elsewhere }), invalid, 'a reply in another topic')
      assert.equal(refused(REPLIER, 'Across threads', { parent: top, replyTo: otherThread }), invalid, 'another thread of this topic')
      assert.equal(refused(REPLIER, 'Wrong thread named', { parent: otherThread, replyTo: nested }), invalid)
      assert.equal(refused(REPLIER, 'No thread named', { replyTo: nested }), invalid, 'a first-level reply answers no reply')
      assert.equal(refused(REPLIER, 'Itself in another topic', { post: TOPIC_OTHER, parent: elsewhere, replyTo: nested }), invalid)
      assert.equal(refused(REPLIER, 'In the thread', { parent: top, replyTo: nested }), 'ok:1')
      assert.equal(refused(REPLIER, 'To the thread itself', { parent: top, replyTo: top }), 'ok:1')
      // D-49: an account under a restriction is told about the restriction first, whatever target it names.
      setState(db, REPLIER, state('L2 active'))
      assert.equal(refused(REPLIER, 'Across topics', { parent: top, replyTo: elsewhere }), state('L2 active').refusal)
      setState(db, REPLIER, state('L0'))

      // A target that was taken down or removed since the page was loaded does not cost the reply:
      // it is stored without one and the thread's first author is the person answered.
      sql(`UPDATE public.post_comments SET status = 'hidden' WHERE id = '${nested}'; TRUNCATE public.notifications`)
      const afterTakedown = reply(REPLIER, 'An answer to a reply that was taken down', { parent: top, replyTo: nested })
      assert.equal(storedTarget(afterTakedown), 'null')
      assert.deepEqual(inbox(), [
        notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${afterTakedown}`),
        notice(PARENT_AUTHOR, 'comment_reply', TOPIC, `comment-reply:${afterTakedown}`),
      ])
      sql('TRUNCATE public.notifications')
      const afterRemoval = reply(REPLIER, 'An answer to a reply that is gone', { parent: top, replyTo: id(77) })
      assert.equal(storedTarget(afterRemoval), 'null')
      assert.deepEqual(inbox(), [
        notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${afterRemoval}`),
        notice(PARENT_AUTHOR, 'comment_reply', TOPIC, `comment-reply:${afterRemoval}`),
      ])
      // A reply nobody can read is treated as gone wherever it is, so the answer does not say where it was.
      sql(`UPDATE public.post_comments SET status = 'hidden' WHERE id = '${elsewhere}'`)
      assert.equal(refused(REPLIER, 'To a hidden reply in another topic', { parent: top, replyTo: elsewhere }), 'ok:1')

      // Removing a reply keeps the answers to it; they just no longer name it.
      sql(`UPDATE public.post_comments SET status = 'active' WHERE id = '${nested}'`)
      const kept = reply(REPLIER, 'An answer that outlives its target', { parent: top, replyTo: nested })
      assert.equal(storedTarget(kept), nested)
      as(`DELETE FROM public.post_comments WHERE id = '${nested}'`, 'authenticated', OTHER)
      assert.equal(storedTarget(kept), 'null')
    })

    // D-54 2d: a notice follows the right to read. The author of a topic under an active level 3+
    // restriction is hidden from everyone else, so nobody else is told what happens in that topic.
    await t.test('nobody is told about a topic they cannot open', () => {
      for (const name of ['L3 active', 'L3 open-ended', 'L4 active', 'L5 active', 'L2 active', 'L3 expired', 'L1', 'L0']) {
        reset()
        watch(FOLLOWER)
        const top = reply(PARENT_AUTHOR, 'A reply made while the topic was visible')
        sql('TRUNCATE public.notifications')
        setState(db, AUTHOR, state(name))
        const hidden = /^L[345] (active|open-ended)$/.test(name)
        const readable = attempt(`SELECT count(*) FROM public.posts WHERE id = '${TOPIC}'`, { uid: FOLLOWER, ask: true })
        assert.equal(readable, hidden ? 'value:0' : 'value:1', `${name}: what the watcher can read`)
        // Row security on replies only names the replier, so the reply itself is accepted either way.
        const child = reply(REPLIER, 'An answer in that topic', { parent: top, replyTo: top })
        assert.deepEqual(inbox(), hidden
          ? [notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${child}`)]
          : [
            notice(AUTHOR, 'post_comment', TOPIC, `post-comment:${child}`),
            notice(FOLLOWER, 'followed_post_reply', TOPIC, `followed-reply:${child}:${FOLLOWER}`),
            notice(PARENT_AUTHOR, 'comment_reply', TOPIC, `comment-reply:${child}`),
          ], name)
      }
      setState(db, AUTHOR, state('L0'))
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
      assert.deepEqual(db.grants(['private.notify_topic_reply()', 'private.reject_reply_to_locked_post()', 'private.validate_comment_reply_target()']), [
        'private.notify_topic_reply():',
        'private.reject_reply_to_locked_post():',
        'private.validate_comment_reply_target():',
      ])
      assert.equal(sql(`SELECT string_agg(tgname::text || ':' || tgtype::text || ':' || tgenabled::text || ':' || tgfoid::regprocedure::text, ' ' ORDER BY tgname::text)
        FROM pg_trigger WHERE tgrelid = 'public.post_comments'::regclass AND NOT tgisinternal AND tgname IN ('trg_notify_post_comment', 'trg_notify_topic_reply')`),
      'trg_notify_post_comment:5:O:notify_post_comment() trg_notify_topic_reply:5:O:private.notify_topic_reply()')
      for (const routine of ['private.notify_topic_reply()', 'private.validate_comment_reply_target()']) {
        assert.equal(sql(`SELECT prosecdef::text || ':' || proconfig::text FROM pg_proc WHERE oid = '${routine}'::regprocedure`),
          'true:{search_path=pg_catalog}', routine)
      }
      // The restriction refusal first, the lock refusal next, then the target check, and all three before the rate limit.
      assert.equal(sql(`SELECT string_agg(tgname::text, ',' ORDER BY tgname::text COLLATE "C") FROM pg_trigger
        WHERE tgrelid = 'public.post_comments'::regclass AND NOT tgisinternal AND (tgtype::integer & 2) <> 0 AND (tgtype::integer & 4) <> 0`),
      'enforce_actor_post_comments,enforce_locked_post_reply,enforce_reply_target,trg_rl_post_comments_before_insert')
      // A member names the reply they answer when they write theirs, and can neither change it later nor read it back.
      assert.equal(sql(`SELECT string_agg(r || ':' || p || ':' || has_column_privilege(r, 'public.post_comments', 'reply_to_comment_id', p)::text, ' ' ORDER BY r, p)
        FROM unnest(ARRAY['anon', 'authenticated']) AS r, unnest(ARRAY['INSERT', 'SELECT', 'UPDATE']) AS p`),
      'anon:INSERT:false anon:SELECT:false anon:UPDATE:false authenticated:INSERT:true authenticated:SELECT:false authenticated:UPDATE:false')
      assert.equal(sql(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.post_comments'::regclass
        AND conname = 'post_comments_reply_to_comment_id_fkey'`), 'FOREIGN KEY (reply_to_comment_id) REFERENCES post_comments(id) ON DELETE SET NULL')
    })
  } finally {
    db.stop()
  }
})
