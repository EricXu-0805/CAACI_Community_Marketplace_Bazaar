import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { readMigration } from './fixtures/community-p3-database.mjs'
import {
  MEMBER_A, MEMBER_B, MIGRATION, PRECHECK, VERIFY, SKIP, id, pinned, readOps, startMemberEventsDatabase,
} from './fixtures/community-member-events-database.mjs'

const SPACE = String.raw`[\u0009-\u000D \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]`
const INVISIBLE = String.raw`[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069]`
const CODES = [9, 10, 11, 12, 13, 32, 133, 160, 5760, ...Array.from({ length: 11 }, (_, n) => 8192 + n), 8232, 8233, 8239, 8287, 12288, 65279]
const CREATE = 'public.create_member_event(uuid,text,text,jsonb)'
const GUARD = 'private.community_events_member_guard()'
const OPEN = 'public.community_member_events_open()'
const post = n => id(7000 + n)
const appSource = () => readFileSync(new URL('../app/src/utils/communityEvents.ts', import.meta.url), 'utf8')

test('member VERIFY changes only the declared rows and switch sections', () => {
  const old = readOps('VERIFY_20261120122054_community_events.sql')
  const current = readOps(VERIFY)
  const changed = line => line.startsWith(`    ('${GUARD}',`)
    || line.startsWith(`    ('${CREATE}',`)
    || line.startsWith("    ('public.community_events', 'community_events_member_shape',")
    || line.startsWith("    ('public.community_events', 'authenticated', 'INSERT',")
    || line.startsWith("    ('public.community_events', 'authenticated', 'UPDATE',")
  const rows = source => source.split('\n').filter(line => line.startsWith("    ('")).map(line => line.replace(/,$/, ''))
  const before = rows(old), after = rows(current)
  assert.equal(before.filter(changed).length, 5)
  assert.equal(after.filter(changed).length, 5)
  assert.equal(after.filter(line => line.startsWith(`    ('${OPEN}',`)).length, 1)
  assert.deepEqual(after.filter(line => !changed(line) && !line.startsWith(`    ('${OPEN}',`)), before.filter(line => !changed(line)))
  for (const line of before.filter(changed)) assert.ok(!after.includes(line), `unchanged required row: ${line}`)
  // Compare the surrounding logic too: outside 2a/2c, only the listed VALUES
  // rows, comments and exception names may change.
  const logic = source => source
    .replace(/  -- 2a\.[\s\S]*?(?=  -- 2b\.)/, '')
    .replace(/  -- 2c\.[\s\S]*?(?=  -- 3\.)/, '')
    .split('\n').filter(line => !changed(line) && !line.startsWith(`    ('${OPEN}',`))
    .join('\n').replace(/--[^\n]*/g, '')
    .replace(/RAISE EXCEPTION '[^']*'/g, "RAISE EXCEPTION '<exception>'")
    .split('\n').filter(line => line.trim()).join('\n')
  assert.equal(logic(current), logic(old))
})

test('member normalization uses fixed printable ASCII N and Z expressions', () => {
  const migration = readMigration(MIGRATION)
  assert.equal(Buffer.byteLength(SPACE), 83)
  assert.match(SPACE, /^[\x20-\x7E]+$/)
  const expressions = [...migration.matchAll(/pg_catalog\.btrim\(pg_catalog\.regexp_replace\(([^\n]*?), '(\[[^']+\])\+', ' ', 'g'\), ' '\)/g)]
  const invisible = [...migration.matchAll(/pg_catalog\.regexp_replace\((?!pg_catalog\.regexp_replace\()([^\n]*?), '(\[[^']+\])', '', 'g'\)/g)]
  assert.equal(expressions.length, 10)
  assert.equal(invisible.length, 7)
  assert.deepEqual(expressions.map(match => match[1]), [
    "pg_catalog.regexp_replace(location, '[\\u00AD\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069]', '', 'g')",
    "status_note",
    "title_in",
    "pg_catalog.regexp_replace(title_in, '[\\u00AD\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069]', '', 'g')",
    "pg_catalog.regexp_replace(event_in ->> 'location', '[\\u00AD\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069]', '', 'g')",
    "pg_catalog.regexp_replace(NEW.location, '[\\u00AD\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069]', '', 'g')",
    "pg_catalog.regexp_replace(NEW.status_note, '[\\u00AD\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069]', '', 'g')",
    "NEW.status_note",
    "pg_catalog.regexp_replace(topic_title, '[\\u00AD\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069]', '', 'g')",
    "pg_catalog.regexp_replace(topic_content, '[\\u00AD\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069]', '', 'g')"
  ])
  assert.deepEqual(invisible.map(match => match[1]), ["location","title_in","event_in ->> 'location'","NEW.location","NEW.status_note","topic_title","topic_content"])
  for (const match of expressions) assert.equal(match[2], SPACE)
  for (const match of invisible) assert.equal(match[2], INVISIBLE)
  assert.equal([...migration.matchAll(/pg_catalog\.regexp_replace\(/g)].length, expressions.length + invisible.length)
  for (const source of [migration, readOps(VERIFY), appSource()]) {
    for (const code of CODES.filter(code => code !== 10 && code !== 32)) {
      assert.ok(!source.includes(String.fromCodePoint(code)), `raw whitespace U+${code.toString(16).toUpperCase()}`)
    }
  }
})


test('member migration does not reissue unrelated community objects', () => {
  const migration = readMigration(MIGRATION)
  for (const name of ['post_comments', 'notify_topic_reply', 'community_reply_notice_config',
    'enqueue_activity_notification', 'update_post_comment_count', 'validate_comment_reply_target',
    'reject_reply_to_locked_post', 'current_profile_state', 'list_community_events', 'admin_']) {
    assert.ok(!migration.includes(name), name)
  }
})

// The app and SQL must keep the same explicit whitespace policy.
test('client EVENT_SPACE contract matches the migration code points', () => {
  const parse = value => {
    const codes = new Set(value.includes(' ') ? [32] : [])
    for (const match of value.matchAll(/\\u([0-9A-F]{4})(?:-\\u([0-9A-F]{4}))?/g)) {
      const first = parseInt(match[1], 16), last = match[2] ? parseInt(match[2], 16) : first
      for (let code = first; code <= last; code++) codes.add(code)
    }
    return [...codes].sort((a, b) => a - b)
  }
  const sql = /regexp_replace\([^\n]*?, '(\[[^']+\])\+'/.exec(readMigration(MIGRATION))
  const client = /EVENT_SPACE\s*=\s*\/(\[[^\n]+?\])\+\/g/.exec(appSource())
  assert.ok(sql, 'migration whitespace class')
  assert.ok(client, 'item7 must export EVENT_SPACE as the specified global regex')
  assert.deepEqual(parse(sql[1]), CODES)
  assert.deepEqual(parse(client[1]), parse(sql[1]))
})

test('P4.6 member event server', { skip: SKIP }, async t => {
  const db = startMemberEventsDatabase()
  const { sql, as, attempt, createEvent } = db
  const made = (n, options, uid = MEMBER_A) => JSON.parse(as(createEvent(uid, post(n), options), 'authenticated', uid))
  const own = { role: 'authenticated', uid: MEMBER_A }
  const open = async run => {
    sql('UPDATE private.community_member_event_config SET enabled = true WHERE singleton')
    try { await run() } finally {
      sql(`UPDATE private.community_member_event_config SET enabled = false WHERE singleton;
        DELETE FROM public.community_events WHERE organizer_user_id IN ('${MEMBER_A}', '${MEMBER_B}');
        DELETE FROM public.posts WHERE user_id IN ('${MEMBER_A}', '${MEMBER_B}');`)
    }
  }
  const pairCount = () => sql(`SELECT
    (SELECT count(*) FROM public.posts WHERE user_id = '${MEMBER_A}') || ':' ||
    (SELECT count(*) FROM public.community_events WHERE organizer_user_id = '${MEMBER_A}')`)
  try {
    await t.test('the switch defaults off for anon and members and rolls back a refused pair', () => {
      assert.equal(sql('SELECT enabled FROM private.community_member_event_config'), 'f')
      for (const role of ['anon', 'authenticated']) {
        assert.equal(as('SELECT public.community_member_events_open()', role, role === 'anon' ? '' : MEMBER_A), 'f')
      }
      assert.equal(attempt(createEvent(MEMBER_A, post(1)), own), 'P0001:member_events_closed')
      assert.equal(pairCount(), '0:0')
    })
    await t.test('opening creates one pair and closing still permits cancellation', () => open(() => {
      assert.equal(as('SELECT public.community_member_events_open()'), 't')
      const result = made(2)
      assert.equal(pairCount(), '1:1')
      sql('UPDATE private.community_member_event_config SET enabled = false WHERE singleton')
      assert.equal(as(`UPDATE public.community_events SET cancelled_at = now() WHERE id = '${result.event_id}' RETURNING cancelled_at IS NOT NULL`), 't')
    }))
    for (const [name, location, expected] of [
      ['leading tab', '\u0009ARC', 'ARC'], ['trailing ideographic space', 'ARC\u3000', 'ARC'],
      ['no-break spaces', '\u00A0ARC\u00A0', 'ARC'], ['line feed', 'Grainger\nLibrary', 'Grainger Library'],
      ['line separator', 'A\u2028B', 'A B'], ['eighty characters', `\u3000${'x'.repeat(80)}\u3000`, 'x'.repeat(80)],
    ]) {
      await t.test(`location normalization: ${name}`, () => open(() => {
        const result = made(3, { location })
        assert.equal(sql(`SELECT location FROM public.community_events WHERE id = '${result.event_id}'`), expected)
      }))
    }
    for (const [name, location] of [['only whitespace', '\t\n\u3000\u00A0\uFEFF'], ['eighty-one characters', 'x'.repeat(81)]]) {
      await t.test(`invalid location: ${name}`, () => open(() => {
        assert.equal(attempt(createEvent(MEMBER_A, post(4), { location }), own), '22023:member_event_location_invalid')
        assert.equal(pairCount(), '0:0')
      }))
    }
    for (const [name, title, expected] of [
      ['outer spaces', '\u3000周六羽毛球\u3000', '周六羽毛球'],
      ['line break', 'Saturday\nbadminton', 'Saturday badminton'],
    ]) {
      await t.test(`title normalization: ${name}`, () => open(() => {
        made(5, { title })
        assert.equal(sql(`SELECT title FROM public.posts WHERE id = '${post(5)}'`), expected)
      }))
    }
    for (const [name, location, note] of [['place', "chr(12288)||'ARC'", 'NULL'], ['note', "'ARC'", "chr(160)||'x'"]]) {
      await t.test(`member_shape independently rejects a non-normalized ${name}`, () => open(() => {
        const result = sql(`BEGIN; ALTER TABLE public.community_events DISABLE TRIGGER community_events_member_guard;
          SELECT harness.attempt('postgres', '', $attempt$INSERT INTO public.community_events
            (source_type,source_key,organizer_user_id,starts_at,location,status_note,registration_mode)
            VALUES ('member','${post(6)}','${MEMBER_A}',now()+interval '1 day',${location},${note},'discussion')$attempt$, false);
          ROLLBACK;`)
        assert.equal(result, '23514:new row for relation "community_events" violates check constraint "community_events_member_shape"')
      }))
    }
    await t.test('notes normalize before checking changes and whitespace cancellation notes become NULL', () => open(() => {
      const result = made(7)
      assert.equal(as(`UPDATE public.community_events SET status_note = chr(12288)||'改期'||chr(9)
        WHERE id = '${result.event_id}' RETURNING status_note`), '改期')
      assert.equal(as(`UPDATE public.community_events SET cancelled_at = now(), status_note = chr(160)||chr(65279)
        WHERE id = '${result.event_id}' RETURNING status_note IS NULL`), 't')
    }))
    await t.test('direct inserts obey the switch and starts_at updates and deletes remain denied', () => open(() => {
      const direct = `INSERT INTO public.community_events(source_type,source_key,organizer_user_id,starts_at,location,registration_mode)
        VALUES ('member','${post(8)}','${MEMBER_A}',now()+interval '1 day','ARC','discussion')`
      assert.equal(attempt(direct, own), '42501:member_event_rpc_required')
      sql('UPDATE private.community_member_event_config SET enabled = false WHERE singleton')
      assert.equal(attempt(direct, own), 'P0001:member_events_closed')
      sql('UPDATE private.community_member_event_config SET enabled = true WHERE singleton')
      made(8)
      assert.match(attempt('UPDATE public.community_events SET starts_at = now()', own), /^42501:/)
      assert.match(attempt('DELETE FROM public.community_events', own), /^42501:/)
    }))
    await t.test('hidden events and hidden topics keep quota; deleting a topic or cancelling releases it', () => open(() => {
      const first = made(9), second = made(10)
      const third = createEvent(MEMBER_A, post(11))
      assert.equal(attempt(third, own), '23514:member_event_active_limit')
      assert.deepEqual(db.mutate('operator', 'hide_event', { event_id: first.event_id, reason: 'Reviewed event' }), { success: true })
      assert.equal(attempt(third, own), '23514:member_event_active_limit')
      sql(`UPDATE public.posts SET status = 'hidden' WHERE id = '${post(10)}'`)
      assert.equal(attempt(third, own), '23514:member_event_active_limit')
      as(`DELETE FROM public.posts WHERE id = '${post(9)}'`)
      made(11)
      as(`UPDATE public.community_events SET cancelled_at = now() WHERE id = '${second.event_id}'`)
      made(12)
      assert.equal(sql(`SELECT count(*) FROM public.community_events WHERE organizer_user_id = '${MEMBER_A}'
        AND cancelled_at IS NULL AND discussion_post_id IS NOT NULL`), '2')
    }))
    await t.test('the real hourly posting limit refuses an event without partial writes', () => open(() => {
      for (let n = 0; n < 10; n++) as(`INSERT INTO public.posts(id,user_id,content)
        VALUES ('${post(100 + n)}','${MEMBER_A}','Ten distinct topics ${n}')`)
      assert.equal(attempt(createEvent(MEMBER_A, post(120)), own), 'P0001:rate_limit_posts_hour')
      assert.equal(pairCount(), '10:0')
    }))
    await t.test('two real connections compete for the one remaining place', () => open(async () => {
      made(20)
      const results = await db.together([createEvent(MEMBER_A, post(21)), createEvent(MEMBER_A, post(22))])
      assert.equal(new Set(results.map(result => result.pid)).size, 2)
      assert.ok(results.every(result => result.pid > 0))
      assert.equal(results.filter(result => result.answer === 'refused:member_event_active_limit').length, 1)
      assert.equal(results.filter(result => result.answer.startsWith('{')).length, 1)
      assert.equal(pairCount(), '2:2')
      db.assertGrants()
      t.diagnostic('quota concurrency: connections=2 successful=1 refused=1 pairs=2')
    }))
    await t.test('two real connections retry one post id and obtain one pair', () => open(async () => {
      const statement = createEvent(MEMBER_A, post(23))
      const results = await db.together([statement, statement])
      assert.equal(new Set(results.map(result => result.pid)).size, 2)
      assert.ok(results.every(result => result.pid > 0))
      assert.deepEqual(JSON.parse(results[0].answer), JSON.parse(results[1].answer))
      assert.equal(pairCount(), '1:1')
      db.assertGrants()
      t.diagnostic('retry concurrency: connections=2 successful=2 pairs=1')
    }))
    await t.test('profile deletion cascades events and both reader roles see none', () => open(() => {
      made(24, undefined, MEMBER_B)
      // The full Auth preparation/deletion order is exercised by the L-SQL
      // regression. This narrow fixture owns only the profile cascade.
      sql(`DELETE FROM public.profiles WHERE id = '${MEMBER_B}'`)
      assert.equal(sql(`SELECT count(*) FROM public.community_events WHERE organizer_user_id = '${MEMBER_B}'`), '0')
      for (const role of ['anon', 'authenticated']) {
        assert.equal(as(`SELECT count(*) FROM public.list_community_events() WHERE organizer_user_id = '${MEMBER_B}'`,
          role, role === 'anon' ? '' : MEMBER_A), '0')
      }
    }))
    await t.test('stored bodies match PRECHECK and VERIFY and all migration grants survive', () => {
      const before = pinned(readOps(PRECHECK))
      assert.equal(before.get(GUARD), 'ec91e9bd0c1be76895d1adba1227af8c')
      assert.equal(before.get(CREATE), '9a22a3c4dc3326b90a29160466416887')
      const after = pinned(readOps(VERIFY))
      for (const [signature, md5] of db.bodyMd5([GUARD, CREATE, OPEN])) assert.equal(after.get(signature), md5, signature)
      assert.equal(db.bodyMd5([GUARD, CREATE, OPEN]).size, 3)
      assert.equal(sql(`SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.community_events'::regclass`), '37')
      db.assertGrants()
    })
  } finally {
    db.stop()
  }
})
