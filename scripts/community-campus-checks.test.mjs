import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { readFileSync } from 'node:fs'
import { readMigration, readOps } from './fixtures/community-p3-database.mjs'
import { BLOCKED_WORD, EVENT_CAACI } from './fixtures/community-events-database.mjs'
import {
  id, SKIP, startCampusChecksDatabase, startEventSyncCapDatabase, startEventSyncDatabase,
} from './fixtures/community-member-events-database.mjs'
const originalFetch = globalThis.fetch
let realFetchCalls = 0
globalThis.fetch = () => { realFetchCalls++; throw new Error('Real network is forbidden') }
const { syncCampusEvents } = await import('../api/_community-events-sync.js')
after(() => { globalThis.fetch = originalFetch; assert.equal(realFetchCalls, 0) })


const C = '20261127175345_community_campus_checks.sql'
const SYNC = [
  'public.claim_community_event_sync(text,interval)',
  'public.apply_caaci_event_snapshot(boolean,jsonb)',
  'public.finish_community_event_sync(text,text,text)',
]
const NEW = [
  'public.apply_campus_event_check(uuid,text,jsonb)',
  'public.claim_campus_event_checks(integer)',
  'public.community_campus_event_checked_at(uuid)',
]
const event = n => id(9700 + n)
const key = n => `3715/${90000000 + n}`

// Signature, arguments, result, security, strictness, volatility, settings, owner, grants, body,
// parallel safety, cost, kind and language.
function contract(db, names) {
  return db.sql(`SELECT string_agg(p.oid::regprocedure::text||'|'||pg_get_function_arguments(p.oid)||'|'||
    pg_get_function_result(p.oid)||'|'||p.prosecdef::text||'|'||p.proisstrict::text||'|'||p.provolatile::text||'|'||
    coalesce(p.proconfig::text,'')||'|'||p.proowner::regrole::text||'|'||coalesce(p.proacl::text,'')||'|'||md5(p.prosrc)||'|'||
    p.proparallel::text||'|'||p.procost::text||'|'||p.prokind::text||'|'||l.lanname,
    E'\\n' ORDER BY p.oid::regprocedure::text)
    FROM pg_proc AS p JOIN pg_language AS l ON l.oid = p.prolang
   WHERE p.oid = ANY (ARRAY[${names.map(name => `'${name}'::regprocedure`).join(',')}])`)
}

// Times are whole seconds, as ICS times are. Pass times here, not through `set`:
// changing starts_at later fires the schedule-change trigger.
function seed(db, n, set = '', times = {}) {
  const starts = times.starts ?? "date_trunc('second', now()) + interval '3 days'"
  const ends = times.ends ?? "date_trunc('second', now()) + interval '3 days 2 hours'"
  db.sql(`INSERT INTO public.community_events (id, source_type, source_key, organizer_name, title_en, starts_at, ends_at,
      occurrence_count, page_url, registration_mode, location)
    VALUES ('${event(n)}', 'campus', '${key(n)}', 'Synthetic calendar', 'Synthetic campus gathering ${n}',
      ${starts}, ${ends}, ${times.count ?? 1},
      'https://calendars.illinois.edu/detail/${key(n)}', 'calendar_page', 'Synthetic public hall')`)
  if (set) db.sql(`UPDATE public.community_events SET ${set} WHERE id = '${event(n)}'`)
}
const reset = db => db.sql(`DELETE FROM public.community_events WHERE source_type = 'campus';
  DELETE FROM public.community_event_sync_state WHERE source = 'campus'`)
const state = (db, n, columns = "availability||':'||missing_checks") =>
  db.sql(`SELECT ${columns} FROM public.community_events WHERE id = '${event(n)}'`)
const check = (n, outcome, row = null) =>
  `public.apply_campus_event_check('${event(n)}', '${outcome}', ${row === null ? 'NULL' : `'${JSON.stringify(row)}'::jsonb`})`
const row = (overrides = {}) => ({
  title_en: 'Synthetic campus gathering', starts_at: '2030-01-10T17:30:00.000Z', ends_at: '2030-01-10T19:30:00.000Z',
  all_day: false, occurrence_count: 1, location: 'Synthetic public hall', source_updated_at: '2030-01-01T18:00:00.000Z',
  content_hash: 'a'.repeat(64), review_flag: null, ...overrides,
})
// One service call in one transaction; setup runs as postgres first, so now() is shared.
const service = (db, statement, setup = '') =>
  db.sql(`BEGIN; ${setup} SET LOCAL ROLE service_role; SELECT ${statement}; COMMIT;`)
// The client directive is psql's; the server sees the rest, as through the hosted endpoint.
const ops = name => readOps(name).split('\n').filter(line => line !== '\\set ON_ERROR_STOP on').join('\n')
const refusal = (db, sql) => {
  try { db.sql(sql); return 'passed' } catch (error) { return /ERROR:\s+(.*)/.exec(String(error.stderr))?.[1] ?? String(error) }
}

const result = answer => {
  const parsed = JSON.parse(answer)
  return `${parsed.availability}/${parsed.missing_checks}/${parsed.rejected}`
}
const epoch = (db, n, column) => Number(db.sql(`SELECT extract(epoch FROM ${column})::bigint FROM public.community_events WHERE id = '${event(n)}'`))
const iso = seconds => new Date(seconds * 1000).toISOString()

test('campus checks leave the sync functions alone and grant exactly the intended roles', { skip: SKIP }, () => {
  const before = startEventSyncCapDatabase()
  try {
    const after = startCampusChecksDatabase()
    try {
      assert.equal(contract(after, SYNC), contract(before, SYNC))
      assert.deepEqual(after.grants(NEW), [
        'public.apply_campus_event_check(uuid,text,jsonb):service_role',
        'public.claim_campus_event_checks(integer):service_role',
        'public.community_campus_event_checked_at(uuid):anon,authenticated',
      ])
      for (const role of ['anon', 'authenticated']) {
        assert.equal(after.attempt('SELECT public.claim_campus_event_checks(1)', { role }),
          '42501:permission denied for function claim_campus_event_checks')
        assert.equal(after.attempt(`SELECT ${check(1, 'error')}`, { role }),
          '42501:permission denied for function apply_campus_event_check')
      }
      const routines = contract(after, NEW)
      assert.match(routines, /claim_campus_event_checks\(integer\)\|limit_in integer\|jsonb\|true\|false\|v\|\{search_path=pg_catalog\}\|postgres\|/)
      assert.match(routines, /community_campus_event_checked_at\(uuid\)\|event_id_in uuid\|timestamp with time zone\|true\|false\|s\|\{search_path=pg_catalog,statement_timeout=3s\}\|postgres\|/)
      assert.deepEqual(routines.split('\n').map(line => line.split('|').slice(-4).join('|')),
        ['u|100|f|plpgsql', 'u|100|f|plpgsql', 'u|100|f|sql'])
    } finally {
      after.stop()
    }
  } finally {
    before.stop()
  }
})

test('campus check migration refuses a second run and a database without B', { skip: SKIP }, () => {
  const migrated = startCampusChecksDatabase()
  try {
    assert.throws(() => migrated.sql(readMigration(C)), error => error instanceof Error &&
      error.message.includes('community_campus_checks_precondition:already_applied'))
  } finally {
    migrated.stop()
  }
  const predecessor = startEventSyncDatabase()
  try {
    assert.throws(() => predecessor.sql(readMigration(C)), error => error instanceof Error &&
      error.message.includes('community_campus_checks_precondition:function:public.apply_caaci_event_snapshot(boolean,jsonb):a7cb04d8c754da448cd570ca6768964f'))
  } finally {
    predecessor.stop()
  }
})

test('the campus preflight and verification hold on stock PostgreSQL', { skip: SKIP }, () => {
  const precheck = ops(`PRECHECK_${C}`)
  const verify = ops(`VERIFY_${C}`)
  const withoutB = startEventSyncDatabase()
  try {
    assert.equal(refusal(withoutB, precheck),
      'community_campus_checks_precheck_function:public.apply_caaci_event_snapshot(boolean,jsonb):a7cb04d8c754da448cd570ca6768964f')
  } finally {
    withoutB.stop()
  }
  const db = startEventSyncCapDatabase()
  try {
    assert.equal(refusal(db, precheck), 'passed')
    db.sql(readMigration(C))
    assert.equal(refusal(db, precheck), 'community_campus_checks_precheck_already_applied')
    assert.equal(refusal(db, verify), 'passed')
    assert.equal(refusal(db, verify.replace("'fcbfeb9588d7afb7bb322e69d9d70077'", "'fcbfeb9588d7afb7bb322e69d9d70078'")),
      'community_campus_checks_function_body:public.claim_campus_event_checks(integer):fcbfeb9588d7afb7bb322e69d9d70077')
    for (const [change, expected, restore] of [
      ['GRANT EXECUTE ON FUNCTION public.claim_campus_event_checks(integer) TO anon',
        'community_campus_checks_function_grants:public.claim_campus_event_checks(integer):anon,service_role',
        'REVOKE EXECUTE ON FUNCTION public.claim_campus_event_checks(integer) FROM anon'],
      ['ALTER FUNCTION public.community_campus_event_checked_at(uuid) VOLATILE',
        'community_campus_checks_function_attributes:public.community_campus_event_checked_at(uuid)',
        'ALTER FUNCTION public.community_campus_event_checked_at(uuid) STABLE'],
      ['ALTER FUNCTION public.claim_campus_event_checks(integer) PARALLEL SAFE',
        'community_campus_checks_function_attributes:public.claim_campus_event_checks(integer)',
        'ALTER FUNCTION public.claim_campus_event_checks(integer) PARALLEL UNSAFE'],
      ['ALTER FUNCTION public.apply_campus_event_check(uuid,text,jsonb) RENAME TO apply_campus_event_check_moved',
        'community_campus_checks_function_missing:public.apply_campus_event_check(uuid,text,jsonb)',
        'ALTER FUNCTION public.apply_campus_event_check_moved(uuid,text,jsonb) RENAME TO apply_campus_event_check'],
    ]) {
      db.sql(change)
      assert.equal(refusal(db, verify), expected)
      db.sql(restore)
      assert.equal(refusal(db, verify), 'passed')
    }
  } finally {
    db.stop()
  }
})

test('campus checks on stock PostgreSQL', { skip: SKIP }, async t => {
  const db = startCampusChecksDatabase()
  try {
    await t.test('claim leases due rows in order and skips hidden, ended and recently checked rows', () => {
      reset(db)
      seed(db, 1)
      seed(db, 2, "availability = 'unavailable', missing_checks = 2, missing_since = now() - interval '1 day'")
      seed(db, 3, "availability = 'hidden', hidden_reason = 'admin'")
      seed(db, 4, '', { starts: "now() - interval '2 hours'", ends: "now() - interval '1 minute'" })
      seed(db, 5)
      seed(db, 6)
      const answers = service(db,
        'public.claim_campus_event_checks(2); SELECT public.claim_campus_event_checks(2); SELECT public.claim_campus_event_checks(2)',
        `UPDATE public.community_events SET last_checked_at = now() - interval '6 hours 1 second' WHERE id = '${event(5)}';
         UPDATE public.community_events SET last_checked_at = now() - interval '6 hours' WHERE id = '${event(6)}';`)
        .split('\n').map(line => JSON.parse(line))
      assert.deepEqual(answers, [
        [{ id: event(1), source_key: key(1) }, { id: event(2), source_key: key(2) }],
        [{ id: event(5), source_key: key(5) }],
        [],
      ])
      assert.equal(state(db, 1, '(last_checked_at IS NOT NULL)::text'), 'true')
      assert.equal(state(db, 3, '(last_checked_at IS NULL)::text'), 'true')
      for (const limit of ['0', '3', 'NULL']) {
        assert.equal(db.attempt(`SELECT public.claim_campus_event_checks(${limit})`, { role: 'service_role' }),
          '22023:campus_check_limit_invalid')
      }
    })

    await t.test('a second connection skips the row the first one holds', async () => {
      reset(db)
      seed(db, 1)
      seed(db, 2)
      const answers = await db.together([
        'CREATE TEMP TABLE got AS SELECT public.claim_campus_event_checks(1) AS x; SELECT pg_sleep(2); SELECT x FROM got',
        "SELECT pg_sleep(0.5); SET LOCAL lock_timeout = '200ms'; SELECT public.claim_campus_event_checks(1)",
      ], { role: 'service_role' })
      const claimed = answers.map(answer => JSON.parse(answer.answer))
      assert.deepEqual(claimed.map(rows => rows.length), [1, 1])
      assert.deepEqual(claimed.flat().map(row => row.source_key).sort(), [key(1), key(2)])
    })

    await t.test('not_found withdraws only after twelve hours, caps the count and keeps hidden rows hidden', () => {
      reset(db)
      seed(db, 1)
      const walk = [
        '',
        `UPDATE public.community_events SET missing_since = now() - interval '12 hours' + interval '1 second' WHERE id = '${event(1)}';`,
        `UPDATE public.community_events SET missing_since = now() - interval '12 hours' WHERE id = '${event(1)}';`,
        '',
      ].map(setup => result(service(db, check(1, 'not_found'), setup)))
      assert.deepEqual(walk, ['visible/1/false', 'visible/1/false', 'unavailable/2/false', 'unavailable/2/false'])
      seed(db, 2, "availability = 'hidden', hidden_reason = 'admin', missing_checks = 1, missing_since = now() - interval '13 hours'")
      assert.equal(result(service(db, check(2, 'not_found'))), 'hidden/2/false')
      db.mutate('operator', 'unhide_event', { event_id: event(2), reason: 'Source details rechecked for this synthetic regression.' })
      assert.equal(state(db, 2), 'unavailable:2')
    })

    await t.test('error writes only the check time', () => {
      reset(db)
      seed(db, 1, "missing_checks = 1, missing_since = now() - interval '1 hour'")
      const snapshot = () => db.sql(`SELECT (to_jsonb(e) - 'last_checked_at' - 'updated_at')::text
        FROM public.community_events AS e WHERE e.id = '${event(1)}'`)
      const before = snapshot()
      assert.equal(result(service(db, check(1, 'error'))), 'visible/1/false')
      assert.equal(snapshot(), before)
      assert.equal(state(db, 1, '(last_checked_at IS NOT NULL)::text'), 'true')
    })

    await t.test('ok refreshes nine source columns, revives an unavailable row and keeps a hidden one', () => {
      reset(db)
      seed(db, 1, "availability = 'unavailable', missing_checks = 2, missing_since = now() - interval '1 day'")
      seed(db, 2, "availability = 'hidden', hidden_reason = 'admin'")
      const fresh = row({ title_en: 'Synthetic refreshed gathering', location: 'Synthetic second hall' })
      assert.equal(result(service(db, check(1, 'ok', fresh))), 'visible/0/false')
      assert.equal(result(service(db, check(2, 'ok', fresh))), 'hidden/0/false')
      assert.equal(state(db, 1, `title_en||'|'||location||'|'||organizer_name||'|'||page_url||'|'||
        (missing_since IS NULL)::text||'|'||(last_seen_at IS NOT NULL)::text`),
        'Synthetic refreshed gathering|Synthetic second hall|Synthetic calendar|https://calendars.illinois.edu/detail/3715/90000001|true|true')
      const withoutHash = row()
      delete withoutHash.content_hash
      for (const statement of [
        check(1, 'ok', row({ organizer_name: 'Synthetic organizer' })),
        check(1, 'ok', row({ page_url: 'https://calendars.illinois.edu/detail/3715/90000009' })),
        check(1, 'ok', withoutHash),
        check(1, 'ok', row({ review_flag: 'source_time_changed_near_start' })),
        check(1, 'error', row()),
        check(1, 'ok'),
        check(1, 'gone'),
      ]) {
        assert.equal(db.attempt(`SELECT ${statement}`, { role: 'service_role' }), '22023:campus_check_invalid')
      }
      assert.equal(db.attempt(`SELECT ${check(99, 'error')}`, { role: 'service_role' }), '22023:campus_check_event_invalid')
    })

    await t.test('a series moving to its next session is not a schedule change; a real move near the start is', () => {
      reset(db)
      const flags = n => state(db, n, `(previous_starts_at IS NULL)::text||':'||(schedule_changed_at IS NULL)::text||':'||
        coalesce(review_flag, 'none')||':'||revision`)
      seed(db, 1, '', { count: 3, starts: "date_trunc('second', now()) - interval '1 day'", ends: "date_trunc('second', now()) + interval '2 days'" })
      const starts1 = epoch(db, 1, 'starts_at')
      const ends1 = epoch(db, 1, 'ends_at')
      service(db, check(1, 'ok', row({ starts_at: iso(starts1 + 86400), ends_at: iso(ends1), occurrence_count: 3 })))
      assert.equal(flags(1), 'true:true:none:2')
      seed(db, 2, '', { starts: "date_trunc('second', now()) + interval '5 days'", ends: "date_trunc('second', now()) + interval '5 days 2 hours'" })
      const starts2 = epoch(db, 2, 'starts_at')
      service(db, check(2, 'ok', row({ starts_at: iso(starts2 - 4 * 86400), ends_at: iso(starts2 - 4 * 86400 + 7200) })))
      assert.equal(state(db, 2, `(previous_starts_at IS NOT NULL)::text||':'||(schedule_changed_at IS NOT NULL)::text||':'||review_flag`),
        'true:true:source_time_changed_near_start')
      seed(db, 3, '', { count: 3, starts: "date_trunc('second', now()) + interval '3 days'", ends: "date_trunc('second', now()) + interval '10 days'" })
      const starts3 = epoch(db, 3, 'starts_at')
      const ends3 = epoch(db, 3, 'ends_at')
      service(db, check(3, 'ok', row({ starts_at: iso(starts3 + 86400), ends_at: iso(ends3), occurrence_count: 3 })))
      assert.equal(state(db, 3, `(extract(epoch FROM previous_starts_at)::bigint = ${starts3})::text||':'||(review_flag IS NULL)::text`), 'true:true')
    })

    await t.test('a refused place returns rejected without failing and leaves an unavailable row as it was', () => {
      reset(db)
      seed(db, 1, "availability = 'unavailable', missing_checks = 2, missing_since = now() - interval '1 day'")
      seed(db, 2, "missing_checks = 1, missing_since = now() - interval '1 hour'")
      const refused = row({ location: `A ${BLOCKED_WORD} hall` })
      assert.equal(result(service(db, check(1, 'ok', refused))), 'unavailable/2/true')
      assert.equal(state(db, 1, `location||'|'||(missing_since IS NOT NULL)::text`), 'Synthetic public hall|true')
      assert.equal(result(service(db, check(2, 'ok', refused))), 'visible/0/true')
    })

    await t.test('the detail line reads a visible campus row only', () => {
      reset(db)
      seed(db, 1)
      seed(db, 2, "availability = 'hidden', hidden_reason = 'admin'")
      seed(db, 3, "availability = 'unavailable', missing_checks = 2, missing_since = now() - interval '1 day'")
      seed(db, 4, '', { starts: "date_trunc('second', now()) - interval '181 days 2 hours'", ends: "date_trunc('second', now()) - interval '181 days'" })
      db.sql(`UPDATE public.community_events SET last_seen_at = now() WHERE source_type = 'campus';
        UPDATE public.community_events SET last_seen_at = now() WHERE id = '${EVENT_CAACI}'`)
      const read = (target, role) => db.as(`SELECT coalesce(public.community_campus_event_checked_at('${target}')::text, 'null')`, role)
      for (const role of ['anon', 'authenticated']) {
        assert.notEqual(read(event(1), role), 'null')
        for (const target of [event(2), event(3), event(4), event(99), EVENT_CAACI]) assert.equal(read(target, role), 'null')
      }
    })
  } finally {
    db.stop()
  }
})

test('the real campus projection is accepted by the real service RPCs', { skip: SKIP }, async () => {
  const previous = process.env.COMMUNITY_SYNC_CAMPUS_EVENTS
  process.env.COMMUNITY_SYNC_CAMPUS_EVENTS = '1'
  const db = startCampusChecksDatabase()
  try {
    reset(db)
    seed(db, 1)
    // The fixture's only event, moved three days ahead; nothing else in it changes.
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '')
    const ics = readFileSync(new URL('../api/__fixtures__/community-events/campus-sample.ics', import.meta.url), 'utf8')
      .replaceAll('20261120T', day + 'T')
    const literal = value => value === null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'"
    let requests = 0
    const result = await syncCampusEvents({
      deadline: Date.now() + 20_000,
      calendars: [{ id: '3715', name_en: 'Synthetic calendar' }],
      fetch: async () => { requests++; return new Response(ics, { headers: { 'content-type': 'text/calendar' } }) },
      call: async (name, args) => {
        let expression
        switch (name) {
          case 'claim_community_event_sync':
            expression = `public.claim_community_event_sync(${literal(args.source_in)}, ${literal(args.interval_in)}::interval)`
            break
          case 'claim_campus_event_checks':
            expression = `public.claim_campus_event_checks(${Number(args.limit_in)})`
            break
          case 'apply_campus_event_check':
            expression = `public.apply_campus_event_check(${literal(args.event_id_in)}::uuid, ${literal(args.outcome_in)}, `
              + (args.row_in === null ? 'NULL' : literal(JSON.stringify(args.row_in)) + '::jsonb') + ')'
            break
          case 'finish_community_event_sync':
            expression = `public.finish_community_event_sync(${literal(args.source_in)}, ${literal(args.outcome_in)}, ${literal(args.error_code_in)})`
            break
          default: throw new Error('Unexpected local RPC')
        }
        try {
          return JSON.parse(db.as('SELECT to_jsonb(' + expression + ')', 'service_role'))
        } catch {
          throw new Error('provider_status_400')
        }
      },
    })
    assert.deepEqual(result, { outcome: 'ok', code: null, rejected: 0 })
    assert.equal(requests, 1)
    assert.equal(state(db, 1, "title_en||'|'||location||'|'||missing_checks||'|'||(last_seen_at IS NOT NULL)::text||'|'||length(content_hash)"),
      'Synthetic campus gathering|Synthetic public hall|0|true|64')
    assert.equal(db.sql("SELECT last_outcome || ':' || (last_success_at IS NOT NULL)::text FROM public.community_event_sync_state WHERE source = 'campus'"), 'ok:true')
  } finally {
    db.stop()
    if (previous === undefined) delete process.env.COMMUNITY_SYNC_CAMPUS_EVENTS
    else process.env.COMMUNITY_SYNC_CAMPUS_EVENTS = previous
  }
})
