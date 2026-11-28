// Offline coverage of the campus refresh module; every request goes to the injected fixture fetch.
import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { readFileSync } from 'node:fs'

const originalFetch = globalThis.fetch
const originalFlag = process.env.COMMUNITY_SYNC_CAMPUS_EVENTS
const originalNow = Date.now
const originalError = console.error
let realFetchCalls = 0
globalThis.fetch = () => { realFetchCalls++; throw new Error('Real network is forbidden') }
const { CAMPUS_CHECK_CLAIM_INTERVAL_SECONDS, CAMPUS_CHECKS_PER_RUN, syncCampusEvents } = await import('./_community-events-sync.js')
const fixtureRoot = new URL('./__fixtures__/community-events/', import.meta.url)
const text = name => readFileSync(new URL(name, fixtureRoot), 'utf8')
const sample = text('campus-sample.ics')
afterEach(() => {
  if (originalFlag === undefined) delete process.env.COMMUNITY_SYNC_CAMPUS_EVENTS
  else process.env.COMMUNITY_SYNC_CAMPUS_EVENTS = originalFlag
  Date.now = originalNow
  console.error = originalError
})
after(() => { globalThis.fetch = originalFetch; assert.equal(realFetchCalls, 0) })

const ROWS = [
  { id: 'caac1127-2026-4000-8000-000000000001', source_key: '3715/90000001' },
  { id: 'caac1127-2026-4000-8000-000000000002', source_key: '3715/90000003' },
]
const NINE = ['all_day', 'content_hash', 'ends_at', 'location', 'occurrence_count',
  'review_flag', 'source_updated_at', 'starts_at', 'title_en']
const CAACI_USER_AGENT = 'CornfieldSync/1 (+https://www.illinimarket.com)'
const finishArgs = (outcome, code) => ({ source_in: 'campus', outcome_in: outcome, error_code_in: code })

async function run(options = {}) {
  const flag = Object.hasOwn(options, 'flag') ? options.flag : '1'
  if (flag === undefined) delete process.env.COMMUNITY_SYNC_CAMPUS_EVENTS
  else process.env.COMMUNITY_SYNC_CAMPUS_EVENTS = flag
  if (!options.clock) Date.now = () => Date.parse('2026-11-13T18:00:00Z')
  const calls = [], requests = [], logs = []
  console.error = (...args) => logs.push(args)
  const call = async (name, args, timeoutMs) => {
    calls.push({ name, args, timeoutMs })
    options.onCall?.(name)
    if (options.throwOn === name) throw options.error
    switch (name) {
      case 'claim_community_event_sync': return options.claim ?? true
      case 'claim_campus_event_checks': return Object.hasOwn(options, 'rows') ? options.rows : [ROWS[0]]
      case 'apply_campus_event_check': return Object.hasOwn(options, 'applied')
        ? options.applied : { availability: 'visible', missing_checks: 0, rejected: false }
      case 'finish_community_event_sync': return options.finish ?? true
      default: throw new Error('Unexpected fixture RPC')
    }
  }
  const fetch = async (url, init) => {
    requests.push({ url: String(url), init })
    return options.respond?.(url, requests.length)
      ?? new Response(sample, { status: 200, headers: { 'content-type': 'text/calendar' } })
  }
  const calendars = Object.hasOwn(options, 'calendars') ? options.calendars : [{ id: '3715', name_en: 'Synthetic calendar' }]
  const deadline = options.deadline ?? Date.now() + 25_000
  const result = await syncCampusEvents({ deadline, call, fetch, calendars })
  return { result, calls, requests, logs, named: name => calls.filter(entry => entry.name === name) }
}

test('only the exact campus flag starts a campus check', async () => {
  for (const flag of [undefined, '', '0', 'true', '1 ']) {
    const { result, calls, requests } = await run({ flag })
    assert.equal(result, null, String(flag))
    assert.equal(calls.length, 0)
    assert.equal(requests.length, 0)
  }
})

test('the campus gate reuses the source claim and its interval constant', async () => {
  assert.equal(CAMPUS_CHECKS_PER_RUN, 2)
  assert.equal(CAMPUS_CHECK_CLAIM_INTERVAL_SECONDS, 30)
  const notDue = await run({ claim: false })
  assert.deepEqual(notDue.result, { outcome: 'not_due', code: null, rejected: 0 })
  assert.deepEqual(notDue.calls.map(({ name, args }) => [name, args]),
    [['claim_community_event_sync', { source_in: 'campus', interval_in: '30 seconds' }]])
  assert.equal(notDue.requests.length, 0)
  const refused = await run({ throwOn: 'claim_community_event_sync', error: new Error('provider_status_404') })
  assert.deepEqual(refused.result, { outcome: 'failed', code: 'claim_failed', rejected: 0 })
  assert.deepEqual(refused.calls.map(entry => entry.name), ['claim_community_event_sync'])
  const empty = await run({ rows: [] })
  assert.deepEqual(empty.result, { outcome: 'ok', code: null, rejected: 0 })
  assert.deepEqual(empty.named('claim_campus_event_checks').map(entry => entry.args), [{ limit_in: 2 }])
  assert.deepEqual(empty.named('finish_community_event_sync').map(entry => entry.args), [finishArgs('ok', null)])
  const unrecorded = await run({ rows: [], finish: false })
  assert.deepEqual(unrecorded.result, { outcome: 'ok', code: null, rejected: 0 })
  assert.deepEqual(unrecorded.logs, [['[community-events-sync] campus finish not recorded', { code: 'unexpected_failure' }]])
})

test('the production allowlist requests nothing and records every claimed row as an error', async () => {
  const empty = await run({ calendars: [], rows: ROWS })
  assert.equal(empty.requests.length, 0)
  assert.deepEqual(empty.named('apply_campus_event_check').map(entry => entry.args), ROWS.map(row =>
    ({ event_id_in: row.id, outcome_in: 'error', row_in: null })))
  assert.deepEqual(empty.result, { outcome: 'partial', code: 'campus_calendar_not_allowed', rejected: 0 })
  assert.deepEqual(empty.named('finish_community_event_sync').map(entry => entry.args),
    [finishArgs('partial', 'campus_calendar_not_allowed')])
  const other = await run({ calendars: [{ id: '7', name_en: 'Synthetic other calendar' }] })
  assert.equal(other.requests.length, 0)
  assert.deepEqual(other.named('apply_campus_event_check').map(entry => entry.args.outcome_in), ['error'])
})

test('one fixed, unauthenticated, bounded request per row and only nine columns cross', async () => {
  const { result, requests, named } = await run()
  assert.equal(requests.length, 1)
  const [{ url, init }] = requests
  assert.equal(url, 'https://calendars.illinois.edu/icalGmail/3715/90000001.ics?hourOffset=0&timeZone=America%2FChicago')
  assert.equal(init.method, 'GET')
  assert.equal(init.redirect, 'manual')
  assert.deepEqual(Object.keys(init.headers).sort(), ['accept', 'user-agent'])
  assert.equal(init.headers.accept, 'text/calendar')
  assert.equal(init.headers['user-agent'], CAACI_USER_AGENT)
  const [apply] = named('apply_campus_event_check')
  assert.equal(apply.args.outcome_in, 'ok')
  assert.deepEqual(Object.keys(apply.args.row_in).sort(), NINE)
  assert.equal(apply.args.row_in.title_en, 'Synthetic campus gathering')
  assert.equal(apply.args.row_in.starts_at, '2026-11-20T17:30:00.000Z')
  assert.match(apply.args.row_in.content_hash, /^[0-9a-f]{64}$/)
  const sent = JSON.stringify(apply.args)
  for (const leak of ['organizer@example.test', 'Synthetic description.', 'key=synthetic', 'allowed_link_hosts',
    'comment_count', 'organizer_name']) assert.equal(sent.includes(leak), false, leak)
  assert.deepEqual(result, { outcome: 'ok', code: null, rejected: 0 })
})

test('a 404 is not_found, a 503 stops the run and a mismatched UID is an error', async () => {
  const missing = await run({
    respond: () => new Response(text('campus-404.html'), { status: 404, headers: { 'content-type': 'text/html' } }),
  })
  assert.deepEqual(missing.named('apply_campus_event_check').map(entry => [entry.args.outcome_in, entry.args.row_in]),
    [['not_found', null]])
  assert.deepEqual(missing.result, { outcome: 'ok', code: null, rejected: 0 })
  const busy = await run({ rows: ROWS, respond: () => new Response('', { status: 503 }) })
  assert.equal(busy.requests.length, 1)
  assert.deepEqual(busy.named('apply_campus_event_check').map(entry => entry.args.outcome_in), ['error'])
  assert.deepEqual(busy.result, { outcome: 'partial', code: 'http_503', rejected: 0 })
  const mismatched = await run({ rows: [ROWS[1]] })
  assert.deepEqual(mismatched.named('apply_campus_event_check').map(entry => entry.args.outcome_in), ['error'])
  assert.deepEqual(mismatched.result, { outcome: 'partial', code: 'campus_uid_mismatch', rejected: 0 })
})

test('rejected rows, bad results and failed calls finish with stable codes', async () => {
  const rejected = await run({ applied: { availability: 'visible', missing_checks: 0, rejected: true } })
  assert.deepEqual(rejected.result, { outcome: 'partial', code: 'rows_rejected', rejected: 1 })
  const third = { id: 'caac1127-2026-4000-8000-000000000003', source_key: '3715/90000004' }
  for (const rows of [null, {}, [{ ...ROWS[0], id: 'not-a-uuid' }], [{ ...ROWS[0], source_key: '3715/x' }], [...ROWS, third]]) {
    const bad = await run({ rows })
    assert.deepEqual(bad.result, { outcome: 'failed', code: 'checks_result_invalid', rejected: 0 }, JSON.stringify(rows))
    assert.equal(bad.requests.length, 0)
  }
  for (const applied of [null, {}, { availability: 'gone', missing_checks: 0, rejected: false },
    { availability: 'visible', missing_checks: 3, rejected: false },
    { availability: 'visible', missing_checks: 0, rejected: false, extra: true }]) {
    const bad = await run({ applied })
    assert.deepEqual(bad.result, { outcome: 'failed', code: 'apply_result_invalid', rejected: 0 }, JSON.stringify(applied))
  }
  for (const [throwOn, error, code] of [
    ['claim_campus_event_checks', new Error('provider_status_404'), 'checks_http_404'],
    ['claim_campus_event_checks', new Error('provider_timeout'), 'checks_timeout'],
    ['claim_campus_event_checks', { message: 'provider_status_503' }, 'checks_failed'],
    ['apply_campus_event_check', new Error('provider_status_400'), 'apply_http_400'],
    ['apply_campus_event_check', new Error('provider_malformed'), 'apply_failed'],
  ]) {
    const failed = await run({ throwOn, error })
    assert.deepEqual(failed.result, { outcome: 'failed', code, rejected: 0 }, code)
    assert.deepEqual(failed.named('finish_community_event_sync').map(entry => entry.args), [finishArgs('failed', code)])
    assert.deepEqual(failed.logs, [])
  }
})

test('every campus step gets its own budget and a late run skips finish', async t => {
  const realSetTimeout = globalThis.setTimeout
  const timers = []
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => { timers.push(ms); return realSetTimeout(callback, ms, ...args) })
  const start = Date.parse('2026-11-13T18:00:00Z')
  let now = start
  const timed = deadline => {
    now = start
    timers.length = 0
    Date.now = () => now
    return run({
      clock: true, deadline, rows: ROWS,
      onCall: () => { now += 2000 },
      respond: () => { now += 1000; return new Response(sample, { status: 200, headers: { 'content-type': 'text/calendar' } }) },
    })
  }
  const late = await timed(start + 14_000)
  assert.deepEqual(late.calls.map(({ name, timeoutMs }) => [name, timeoutMs]), [
    ['claim_community_event_sync', 5000], ['claim_campus_event_checks', 5000],
    ['apply_campus_event_check', 4000], ['apply_campus_event_check', 1000],
  ])
  assert.deepEqual(timers, [5000, 2000])
  assert.deepEqual(late.result, { outcome: 'failed', code: 'deadline', rejected: 0 })
  assert.deepEqual(late.logs, [['[community-events-sync] campus finish not recorded', { code: 'deadline' }]])
  const later = await timed(start + 11_000)
  assert.deepEqual(later.calls.map(entry => entry.name),
    ['claim_community_event_sync', 'claim_campus_event_checks', 'apply_campus_event_check'])
  assert.deepEqual(later.result, { outcome: 'failed', code: 'deadline', rejected: 0 })
  assert.deepEqual(later.logs, [['[community-events-sync] campus finish skipped', { code: 'deadline' }]])
})
