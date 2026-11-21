import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTHOR, CREATED, DISPATCHER, FOLLOWER, HELPERS, OTHER, PREDECESSOR, REISSUED, REPLIER, SEARCH, SKIP, STATES,
  TOPIC, TOPIC_OTHER, UPDATE, id, pinned, readOps, setState, startCommunityDatabase,
} from './fixtures/community-p3-database.mjs'

/*
 * P3.1: watching and saving topics, the activity columns that order the
 * lists, and the D-49 classification of the two new write paths (a watch and
 * a save are seen by nobody else and notify nobody, so a restricted account
 * keeps both; a reply stays refused).
 */

const HIDDEN = id(31), REMOVED = id(32), LOCKED = id(33), INVISIBLE_AUTHOR = id(34)
// Rows that exist before the migration; the backfill has to place each one.
const LEGACY_REPLIED = id(41), LEGACY_QUIET = id(42), LEGACY_SELF = id(43), LEGACY_HIDDEN_REPLY = id(44)
const ago = days => `now() - interval '${days} days'`
const LEGACY = `
  INSERT INTO public.posts(id, user_id, content, title, category, created_at) VALUES
    ('${LEGACY_REPLIED}','${AUTHOR}','Legacy one','Legacy one','campus-life', ${ago(10)}),
    ('${LEGACY_QUIET}','${AUTHOR}','Legacy two','Legacy two','campus-life', ${ago(10)}),
    ('${LEGACY_SELF}','${AUTHOR}','Legacy three','Legacy three','campus-life', ${ago(10)}),
    ('${LEGACY_HIDDEN_REPLY}','${AUTHOR}','Legacy four','Legacy four','campus-life', ${ago(10)});
  ALTER TABLE public.post_comments DISABLE TRIGGER USER;
  INSERT INTO public.post_comments(post_id, user_id, content, created_at, status) VALUES
    ('${LEGACY_REPLIED}','${AUTHOR}','author first', ${ago(9)}, 'active'),
    ('${LEGACY_REPLIED}','${REPLIER}','first answer', ${ago(8)}, 'active'),
    ('${LEGACY_REPLIED}','${OTHER}','taken down later', ${ago(5)}, 'hidden'),
    ('${LEGACY_REPLIED}','${REPLIER}','latest', ${ago(6)}, 'active'),
    ('${LEGACY_SELF}','${AUTHOR}','only the author', ${ago(7)}, 'active'),
    ('${LEGACY_QUIET}','${AUTHOR}','the author, taken down', ${ago(3)}, 'hidden'),
    ('${LEGACY_HIDDEN_REPLY}','${OTHER}','taken down', ${ago(4)}, 'hidden');
  ALTER TABLE public.post_comments ENABLE TRIGGER USER;`

test('P3.1 watch, save and activity columns', { skip: SKIP }, async t => {
  const db = startCommunityDatabase({ legacy: LEGACY })
  const { sql, as, attempt } = db
  try {
    sql(`INSERT INTO public.profiles(id, nickname) VALUES ('${id(7)}','Restricted author');
      INSERT INTO public.suspensions(profile_id, level, started_at) VALUES ('${id(7)}', 3, now() - interval '1 day');
      INSERT INTO public.posts(id, user_id, content, title, category, status) VALUES
        ('${HIDDEN}','${OTHER}','Hidden body','Hidden topic','campus-life','hidden'),
        ('${REMOVED}','${OTHER}','Removed body','Removed topic','campus-life','deleted'),
        ('${LOCKED}','${OTHER}','Locked body','Locked topic','campus-life','active'),
        ('${INVISIBLE_AUTHOR}','${id(7)}','Body','Topic of a restricted author','campus-life','active');
      UPDATE public.posts SET locked_at = now() WHERE id = '${LOCKED}';`)

    await t.test('the ops files pin the bodies this migration starts from and ends with', () => {
      const precheck = pinned(readOps('PRECHECK_20261120100354_community_watch_save_activity.sql'))
      assert.equal(db.before.md5.size, REISSUED.length + 2 + HELPERS.length)
      for (const [signature, md5] of db.before.md5) assert.equal(precheck.get(signature), md5, `PRECHECK does not pin the stored ${signature}`)
      const verify = pinned(readOps('VERIFY_20261120100354_community_watch_save_activity.sql'))
      const after = db.bodyMd5([...REISSUED, SEARCH, DISPATCHER, PREDECESSOR, ...CREATED])
      assert.equal(after.size, REISSUED.length + 3 + CREATED.length)
      for (const [signature, md5] of after) {
        assert.equal(verify.get(signature), md5, `VERIFY does not pin the migrated ${signature}`)
        if (db.before.md5.has(signature)) assert.notEqual(md5, db.before.md5.get(signature), `${signature} was not reissued`)
      }
      // The previous dispatcher is kept verbatim under its new name.
      assert.equal(after.get(PREDECESSOR), db.before.md5.get(DISPATCHER))
      // Helpers the new code calls are left exactly as they were.
      assert.deepEqual(db.bodyMd5(HELPERS), new Map([...db.before.md5].filter(([signature]) => HELPERS.includes(signature))))
    })

    await t.test('reissued functions keep their signature, settings, owner and grants', () => {
      assert.equal(db.contract(REISSUED), db.before.contract)
    })

    await t.test('both tables have the same shape, keys, indexes and exact grants', () => {
      for (const table of ['post_follows', 'post_bookmarks']) {
        assert.equal(sql(`SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod) || ':' || attnotnull, ',' ORDER BY attnum)
          FROM pg_attribute WHERE attrelid = 'public.${table}'::regclass AND attnum > 0 AND NOT attisdropped`),
        'user_id:uuid:true,post_id:uuid:true,created_at:timestamp with time zone:true', table)
        assert.equal(sql(`SELECT string_agg(contype::text || ':' || pg_get_constraintdef(oid), ' | ' ORDER BY conname)
          FROM pg_constraint WHERE conrelid = 'public.${table}'::regclass`),
        `p:PRIMARY KEY (user_id, post_id) | f:FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE | f:FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`, table)
        assert.equal(sql(`SELECT relrowsecurity::text || ':' || relforcerowsecurity::text FROM pg_class WHERE oid = 'public.${table}'::regclass`), 'true:false')
        assert.equal(sql(`SELECT string_agg(polcmd::text || ':' || (SELECT string_agg(r::regrole::text, ',') FROM unnest(polroles) AS r), ' ' ORDER BY polcmd::text)
          FROM pg_policy WHERE polrelid = 'public.${table}'::regclass`), 'a:authenticated d:authenticated r:authenticated', table)
        assert.equal(sql(`SELECT string_agg(grantee || ':' || privilege_type || ':' || column_name, ' ' ORDER BY grantee, privilege_type, column_name)
          FROM information_schema.column_privileges WHERE table_schema = 'public' AND table_name = '${table}' AND grantee IN ('anon', 'authenticated')`),
        'authenticated:INSERT:post_id authenticated:INSERT:user_id authenticated:SELECT:created_at authenticated:SELECT:post_id authenticated:SELECT:user_id', table)
        assert.equal(sql(`SELECT string_agg(r || ':' || p || ':' || has_table_privilege(r, 'public.${table}', p)::text, ' ' ORDER BY r, p)
          FROM unnest(ARRAY['anon','authenticated']) AS r, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) AS p`),
        'anon:DELETE:false anon:INSERT:false anon:SELECT:false anon:TRUNCATE:false anon:UPDATE:false '
          + 'authenticated:DELETE:true authenticated:INSERT:false authenticated:SELECT:false authenticated:TRUNCATE:false authenticated:UPDATE:false', table)
        assert.equal(sql(`SELECT has_any_column_privilege('authenticated', 'public.${table}', 'UPDATE')`), 'f')
      }
      assert.equal(sql(`SELECT string_agg(indexname, ',' ORDER BY indexname) FROM pg_indexes
        WHERE schemaname = 'public' AND tablename IN ('post_follows', 'post_bookmarks')`),
      'post_bookmarks_pkey,post_bookmarks_post_idx,post_bookmarks_user_idx,post_follows_pkey,post_follows_post_idx')
      assert.match(sql(`SELECT indexdef FROM pg_indexes WHERE indexname = 'post_follows_post_idx'`), /\(post_id, created_at\)$/)
      assert.match(sql(`SELECT indexdef FROM pg_indexes WHERE indexname = 'post_bookmarks_user_idx'`), /\(user_id, created_at DESC, post_id\)$/)
    })

    for (const table of ['post_follows', 'post_bookmarks']) {
      await t.test(`${table}: a member writes only their own rows, on topics they can see`, () => {
        const add = (post, user = `'${AUTHOR}'`) => `INSERT INTO public.${table}(user_id, post_id) VALUES (${user}, '${post}')`
        const denied = `42501:new row violates row-level security policy for table "${table}"`
        assert.equal(attempt(add(TOPIC_OTHER)), 'ok:1')
        assert.equal(attempt(add(TOPIC)), 'ok:1', 'a member may keep their own topic')
        assert.equal(attempt(add(UPDATE)), 'ok:1', 'legacy updates can be kept too')
        assert.equal(attempt(add(TOPIC_OTHER, `'${OTHER}'`)), denied, 'not for somebody else')
        assert.equal(attempt(add(HIDDEN)), denied, 'a hidden topic is refused')
        assert.equal(attempt(add(REMOVED)), denied)
        assert.equal(attempt(add(id(99))), denied, 'a topic that does not exist')
        assert.equal(attempt(add(INVISIBLE_AUTHOR)), denied, 'the author is hidden from everyone else')
        assert.equal(attempt(add(TOPIC_OTHER), { role: 'anon', uid: '' }), `42501:permission denied for table ${table}`)
        assert.equal(attempt(`INSERT INTO public.${table}(user_id, post_id, created_at) VALUES ('${AUTHOR}', '${TOPIC_OTHER}', now())`),
          `42501:permission denied for table ${table}`)
        assert.equal(attempt(`UPDATE public.${table} SET created_at = now()`), `42501:permission denied for table ${table}`)
        assert.equal(attempt(`${add(TOPIC_OTHER)}; ${add(TOPIC_OTHER)}`).slice(0, 6), '23505:', 'one row per member and topic')

        // A block in either direction refuses both members.
        for (const [blocker, blocked] of [[AUTHOR, OTHER], [OTHER, AUTHOR]]) {
          sql(`INSERT INTO public.blocks(blocker_id, blocked_id) VALUES ('${blocker}', '${blocked}')`)
          assert.equal(attempt(add(TOPIC_OTHER)), denied, `${blocker} blocked ${blocked}: the first member is refused`)
          assert.equal(attempt(add(TOPIC, `'${OTHER}'`), { uid: OTHER }), denied, `${blocker} blocked ${blocked}: so is the second`)
          assert.equal(attempt(add(TOPIC_OTHER, `'${FOLLOWER}'`), { uid: FOLLOWER }), 'ok:1', 'a third member is unaffected')
          sql('DELETE FROM public.blocks')
        }

        // Only the owner reads or removes a row.
        as(add(TOPIC_OTHER))
        as(add(TOPIC, `'${FOLLOWER}'`), 'authenticated', FOLLOWER)
        assert.equal(as(`SELECT string_agg(post_id::text, ',') FROM public.${table}`), TOPIC_OTHER)
        assert.equal(as(`SELECT string_agg(post_id::text, ',') FROM public.${table}`, 'authenticated', FOLLOWER), TOPIC)
        assert.equal(as(`SELECT count(*) FROM public.${table}`, 'authenticated', OTHER), '0')
        assert.equal(attempt(`SELECT count(*) FROM public.${table}`, { role: 'anon', uid: '', ask: true }), `42501:permission denied for table ${table}`)
        assert.equal(attempt(`DELETE FROM public.${table} WHERE post_id = '${TOPIC_OTHER}'`, { uid: FOLLOWER }), 'ok:0')
        assert.equal(attempt(`DELETE FROM public.${table} WHERE post_id = '${TOPIC_OTHER}'`), 'ok:1')

        // Rows go with the topic and with the member.
        assert.equal(sql(`BEGIN; DELETE FROM public.posts WHERE id = '${TOPIC_OTHER}'; SELECT count(*) FROM public.${table}; ROLLBACK;`), '1')
        assert.equal(sql(`BEGIN; DELETE FROM public.profiles WHERE id = '${FOLLOWER}'; SELECT count(*) FROM public.${table}; ROLLBACK;`), '1')
        sql(`DELETE FROM public.${table}`)
      })
    }

    await t.test('existing topics are placed by their latest and first visible replies', () => {
      const placed = post => sql(`SELECT (last_activity_at = (${post.latest}))::text || ':'
          || coalesce((${post.answer ? `answered_at = (${post.answer})` : 'answered_at IS NULL'})::text, 'null')
        FROM public.posts WHERE id = '${post.id}'`)
      const comment = (post, content) => `SELECT created_at FROM public.post_comments WHERE post_id = '${post}' AND content = '${content}'`
      const created = post => `SELECT created_at FROM public.posts WHERE id = '${post}'`
      assert.equal(placed({ id: LEGACY_REPLIED, latest: comment(LEGACY_REPLIED, 'latest'), answer: comment(LEGACY_REPLIED, 'first answer') }), 'true:true')
      assert.equal(placed({ id: LEGACY_QUIET, latest: created(LEGACY_QUIET), answer: null }), 'true:true')
      assert.equal(placed({ id: LEGACY_SELF, latest: comment(LEGACY_SELF, 'only the author'), answer: null }), 'true:true', 'the author does not answer their own topic')
      assert.equal(placed({ id: LEGACY_HIDDEN_REPLY, latest: created(LEGACY_HIDDEN_REPLY), answer: null }), 'true:true', 'a hidden reply places nothing')
      assert.equal(sql(`SELECT count(*) FROM public.posts WHERE last_activity_at IS NULL OR last_activity_at < created_at OR is_featured OR locked_at IS NOT NULL AND id <> '${LOCKED}'`), '0')
      assert.equal(sql(`SELECT string_agg(column_name || ':' || is_nullable || ':' || coalesce(column_default, ''), ' ' ORDER BY column_name)
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posts'
        AND column_name IN ('last_activity_at', 'answered_at', 'is_featured', 'locked_at')`),
      'answered_at:YES: is_featured:NO:false last_activity_at:NO:now() locked_at:YES:')
    })

    // A reply that was hidden when the migration ran placed nothing. Bringing it back has to place
    // it then: otherwise its topic carries an answer and stays under "unanswered", and VERIFY, which
    // may be run again at any time, stops on its backfill check.
    await t.test('restoring a reply that was hidden before the migration answers its topic and moves it forward', () => {
      const backfill = /SELECT (pg_catalog\.count\(\*\) FILTER \(WHERE post\.last_activity_at < post\.created_at\) AS backwards,[\s\S]*?AS featured)\s+INTO tally\s+(FROM public\.posts AS post);/
        .exec(readOps('VERIFY_20261120100354_community_watch_save_activity.sql'))
      assert.ok(backfill, 'section 8 of VERIFY is not where this test reads it')
      // The three counts VERIFY raises community_watch_save_backfill on, as VERIFY takes them.
      const tally = () => sql(`SELECT backwards || ':' || unanswered || ':' || featured FROM (SELECT ${backfill[1]} ${backfill[2]}) AS tally`)
      const unanswered = () => as(`SELECT string_agg(right(id::text, 2), ',' ORDER BY id) FROM public.search_community_posts(ARRAY['Legacy'], 'unanswered', 100, 0)`, 'anon', '')
      const hidden = (post, content) => sql(`SELECT id || '|' || created_at FROM public.post_comments
        WHERE post_id = '${post}' AND content = '${content}' AND status = 'hidden'`).split('|')
      const topic = post => sql(`SELECT comment_count || '|' || last_activity_at || '|' || coalesce(answered_at::text, 'null')
        FROM public.posts WHERE id = '${post}'`).split('|')
      const restore = reply => db.mutate('operator', 'restore_content', { target_type: 'comment', target_id: reply, reason: 'Restored after review' })
      assert.equal(tally(), '0:0:0')
      assert.equal(unanswered(), '42,43,44')

      // The topic's only answer, from somebody else: it is answered when that reply was written.
      const [answer, answeredAt] = hidden(LEGACY_HIDDEN_REPLY, 'taken down')
      assert.deepEqual(restore(answer), { data: { ok: true, affected: 1 } })
      assert.equal(tally(), '0:0:0', 'VERIFY still passes when it is run again')
      assert.equal(unanswered(), '42,43')
      assert.deepEqual(topic(LEGACY_HIDDEN_REPLY), ['1', answeredAt, answeredAt])

      // A later reply to a topic that has its answer: the topic moves forward, the first answer stays.
      const [late, lateAt] = hidden(LEGACY_REPLIED, 'taken down later')
      const firstAnswer = topic(LEGACY_REPLIED)[2]
      assert.deepEqual(restore(late), { data: { ok: true, affected: 1 } })
      assert.deepEqual(topic(LEGACY_REPLIED).slice(1), [lateAt, firstAnswer])

      // The author's own reply moves the topic and does not answer it.
      const [own, ownAt] = hidden(LEGACY_QUIET, 'the author, taken down')
      assert.deepEqual(restore(own), { data: { ok: true, affected: 1 } })
      assert.deepEqual(topic(LEGACY_QUIET), ['1', ownAt, 'null'])
      assert.equal(tally(), '0:0:0')
      assert.equal(unanswered(), '42,43')
      sql('DELETE FROM public.admin_audit_log; DELETE FROM public.admin_mutation_requests')
    })

    await t.test('a reply moves the topic forward once and answers it once', () => {
      const state = () => sql(`SELECT comment_count || '|' || (last_activity_at = created_at)::text || '|' || coalesce(answered_at::text, 'null') || '|' || last_activity_at::text
        FROM public.posts WHERE id = '${TOPIC}'`).split('|')
      const reply = (uid, content) => as(`INSERT INTO public.post_comments(post_id, user_id, content) VALUES ('${TOPIC}', '${uid}', '${content}') RETURNING created_at::text`, 'authenticated', uid)
      assert.deepEqual(state().slice(0, 3), ['0', 'true', 'null'], 'a topic nobody replied to was last active when it was posted')
      const own = reply(AUTHOR, 'A note from the author')
      assert.deepEqual(state(), ['1', 'false', 'null', own], 'the author moves the topic but does not answer it')
      const first = reply(REPLIER, 'The first answer')
      assert.deepEqual(state(), ['2', 'false', first, first])
      const second = reply(OTHER, 'A second answer')
      assert.deepEqual(state(), ['3', 'false', first, second], 'the first answer stays')
      as(`DELETE FROM public.post_comments WHERE post_id = '${TOPIC}' AND content = 'The first answer'`, 'authenticated', REPLIER)
      assert.deepEqual(state(), ['2', 'false', first, second], 'removing the answer does not reopen the topic')
      sql(`INSERT INTO public.post_comments(post_id, user_id, content, created_at) VALUES ('${TOPIC}', '${OTHER}', 'Backdated', now() - interval '30 days')`)
      assert.deepEqual(state(), ['3', 'false', first, second], 'activity never moves backwards')
      // 085: a hidden reply was already subtracted when it was taken down.
      sql(`UPDATE public.post_comments SET status = 'hidden' WHERE post_id = '${TOPIC}' AND content = 'Backdated';
        DELETE FROM public.post_comments WHERE post_id = '${TOPIC}' AND content = 'Backdated'`)
      assert.equal(state()[0], '3')
      sql(`DELETE FROM public.post_comments WHERE post_id = '${TOPIC}'; UPDATE public.posts SET comment_count = 0 WHERE id = '${TOPIC}'`)
    })

    await t.test('the new topic columns are readable by everyone and written by nobody', () => {
      const read = `SELECT (last_activity_at IS NOT NULL AND answered_at IS NULL AND NOT is_featured AND locked_at IS NULL)::text FROM public.posts WHERE id = '${TOPIC_OTHER}'`
      assert.equal(attempt(read, { ask: true }), 'value:true')
      assert.equal(attempt(read, { role: 'anon', uid: '', ask: true }), 'value:true')
      for (const column of ['last_activity_at = now()', 'answered_at = now()', 'is_featured = true', 'locked_at = now()']) {
        assert.equal(attempt(`UPDATE public.posts SET ${column} WHERE id = '${TOPIC}'`), '42501:permission denied for table posts', column)
      }
      for (const column of ['last_activity_at', 'answered_at', 'locked_at']) {
        assert.equal(attempt(`INSERT INTO public.posts(user_id, content, ${column}) VALUES ('${AUTHOR}', 'Body', now())`), '42501:permission denied for table posts', column)
      }
      assert.equal(attempt(`INSERT INTO public.posts(user_id, content, is_featured) VALUES ('${AUTHOR}', 'Body', true)`), '42501:permission denied for table posts')
      assert.equal(sql(`SELECT string_agg(a.attname::text, ',' ORDER BY a.attname::text) FROM pg_attribute AS a
        WHERE a.attrelid = 'public.posts'::regclass AND a.attnum > 0 AND NOT a.attisdropped
          AND (has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE') OR has_column_privilege('anon', a.attrelid, a.attnum, 'UPDATE'))`),
      'content_i18n', 'D-49: no client-writable topic column was added')
      // Only an official post can be put in "Start here", whoever asks.
      assert.throws(() => sql(`UPDATE public.posts SET is_featured = true WHERE id = '${TOPIC}'`), /posts_featured_official_only/)
      assert.equal(sql(`BEGIN; UPDATE public.posts SET is_official = true, is_featured = true WHERE id = '${TOPIC}' RETURNING is_featured; ROLLBACK;`), 't')
    })

    // D-49: a watch and a save are private and notify nobody, so they stay
    // open; a reply is seen by others and stays refused, before any other rule.
    sql(`INSERT INTO public.post_follows(user_id, post_id) VALUES ('${FOLLOWER}', '${TOPIC_OTHER}');
      INSERT INTO public.post_bookmarks(user_id, post_id) VALUES ('${FOLLOWER}', '${TOPIC_OTHER}')`)
    for (const state of STATES) {
      await t.test(`D-49 ${state.name}: watch and save stay open, a reply is ${state.refusal ? 'refused' : 'accepted'}`, () => {
        setState(db, FOLLOWER, state)
        // The cached columns always claim the opposite of the action log.
        sql(`UPDATE public.profiles SET suspension_level = ${state.refusal ? 0 : 5} WHERE id = '${FOLLOWER}'`)
        const act = action => attempt(action, { uid: FOLLOWER })
        assert.deepEqual({
          watch: act(`INSERT INTO public.post_follows(user_id, post_id) VALUES ('${FOLLOWER}', '${TOPIC}')`),
          unwatch: act(`DELETE FROM public.post_follows WHERE post_id = '${TOPIC_OTHER}'`),
          save: act(`INSERT INTO public.post_bookmarks(user_id, post_id) VALUES ('${FOLLOWER}', '${TOPIC}')`),
          unsave: act(`DELETE FROM public.post_bookmarks WHERE post_id = '${TOPIC_OTHER}'`),
          listWatched: attempt('SELECT count(*) FROM public.post_follows', { uid: FOLLOWER, ask: true }),
          reply: act(`INSERT INTO public.post_comments(post_id, user_id, content) VALUES ('${TOPIC}', '${FOLLOWER}', 'A reply')`),
          replyToLocked: act(`INSERT INTO public.post_comments(post_id, user_id, content) VALUES ('${LOCKED}', '${FOLLOWER}', 'A reply')`),
        }, {
          watch: 'ok:1',
          unwatch: 'ok:1',
          save: 'ok:1',
          unsave: 'ok:1',
          listWatched: 'value:1',
          reply: state.refusal ?? 'ok:1',
          replyToLocked: state.refusal ?? 'P0001:post_locked',
        })
      })
    }

    await t.test('the restricted-account guard is attached to neither new table', () => {
      assert.equal(sql(`SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.post_follows'::regclass, 'public.post_bookmarks'::regclass)`), '0')
    })
  } finally {
    db.stop()
  }
})
