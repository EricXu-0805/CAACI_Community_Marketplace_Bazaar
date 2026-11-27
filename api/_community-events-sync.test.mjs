// Offline protocol coverage; every upstream call uses the injected fixture fetch.
import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'

const originalFetch = globalThis.fetch
const originalFlag = process.env.COMMUNITY_SYNC_CAACI_EVENTS
const originalError = console.error
let realFetchCalls = 0
globalThis.fetch = () => { realFetchCalls++; throw new Error('Real network is forbidden') }
const { syncCaaciEvents } = await import('./_community-events-sync.js')
const fixtureRoot = new URL('./__fixtures__/community-events/', import.meta.url)
const text = name => readFileSync(new URL(name, fixtureRoot), 'utf8')
const complete = JSON.parse(text('caaci-v1-complete.json'))
afterEach(() => {
  if (originalFlag === undefined) delete process.env.COMMUNITY_SYNC_CAACI_EVENTS
  else process.env.COMMUNITY_SYNC_CAACI_EVENTS = originalFlag
  console.error = originalError
})
after(() => { globalThis.fetch = originalFetch; assert.equal(realFetchCalls, 0) })

async function run(options = {}) {
  const flag = Object.hasOwn(options, 'flag') ? options.flag : '1'
  if (flag === undefined) delete process.env.COMMUNITY_SYNC_CAACI_EVENTS
  else process.env.COMMUNITY_SYNC_CAACI_EVENTS = flag
  const calls = [], requests = [], logs = []
  console.error = (...args) => logs.push(args)
  const call = async (name, args, timeoutMs) => {
    calls.push({ name, args, timeoutMs })
    if (options.throwOn === name) throw options.error
    switch (name) {
      case 'claim_community_event_sync': return Object.hasOwn(options, 'claim') ? options.claim : true
      case 'apply_caaci_event_snapshot': return Object.hasOwn(options, 'applied') ? options.applied : { complete: args.complete_in, rejected: 0 }
      case 'finish_community_event_sync': return Object.hasOwn(options, 'finish') ? options.finish : true
      default: throw new Error('Unexpected fixture RPC')
    }
  }
  const fetch = async (url, init) => {
    requests.push({ url, init })
    if (Object.hasOwn(options, 'fetchError')) throw options.fetchError
    return new Response(options.body ?? JSON.stringify(options.feed ?? complete), {
      status: options.status ?? 200,
      headers: { 'content-type': 'application/json', ...options.headers },
    })
  }
  const result = await syncCaaciEvents({ deadline: options.deadline ?? Date.now() + 20_000, call, fetch })
  return { result, calls, requests, logs }
}

test('disabled sync never calls its injected dependencies, even with no budget', async () => {
  for (const flag of [undefined, '', '0', 'true', '1 ']) {
    const actual = await run({ flag, deadline: 0 })
    assert.equal(actual.result, null)
    assert.deepEqual(actual.calls, [])
    assert.deepEqual(actual.requests, [])
  }
})

test('only boolean true claims work and a failed claim never attempts finish', async () => {
  const due = await run({ claim: false })
  assert.deepEqual(due.result, { outcome: 'not_due', code: null, rejected: 0 })
  assert.equal(due.calls.length, 1)
  assert.equal(due.requests.length, 0)
  for (const claim of [null, 'true', {}]) {
    const actual = await run({ claim })
    assert.equal(actual.result.code, 'claim_failed')
    assert.equal(actual.calls.length, 1)
    assert.equal(actual.requests.length, 0)
  }
  const actual = await run({ throwOn: 'claim_community_event_sync', error: new Error('Synthetic private detail') })
  assert.equal(actual.result.code, 'claim_failed')
  assert.equal(actual.calls.length, 1)
  assert.equal(actual.requests.length, 0)
})

test('the upstream request is fixed, unauthenticated, bounded and projects only source columns', async () => {
  const feed = structuredClone(complete)
  feed.events[0].id = feed.events[0].id.toUpperCase()
  feed.events[0].starts_at = 'Fri, 20 Nov 2026 17:30:00 GMT'
  feed.events[0].ends_at = 'Fri, 20 Nov 2026 19:30:00 GMT'
  const actual = await run({ feed })
  assert.deepEqual(actual.result, { outcome: 'ok', code: null, rejected: 0 })
  assert.equal(actual.requests.length, 1)
  const request = actual.requests[0]
  assert.equal(request.url, 'https://caaciorg.com/api/public-events?window=recent')
  assert.equal(request.init.method, 'GET')
  assert.equal(request.init.redirect, 'manual')
  assert.deepEqual(request.init.headers, {
    accept: 'application/json', 'user-agent': 'CornfieldSync/1 (+https://www.illinimarket.com)',
  })
  const applied = actual.calls.find(call => call.name === 'apply_caaci_event_snapshot')
  assert.equal(applied.args.complete_in, true)
  const row = applied.args.rows_in[0]
  assert.equal(row.source_key, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  assert.equal(row.starts_at, '2026-11-20T17:30:00.000Z')
  assert.equal(row.ends_at, '2026-11-20T19:30:00.000Z')
  assert.equal(row.organizer_name, 'CAACI')
  assert.equal(row.registration_mode, 'caaci_site')
  for (const key of ['id', 'partner_id', 'partner_name_zh', 'allowed_link_hosts', 'comment_count', 'availability', 'discussion_post_id']) {
    assert.equal(Object.hasOwn(row, key), false, key)
  }
  const expectedKeys = [
    'all_day', 'content_hash', 'ends_at', 'location', 'occurrence_count', 'organizer_name', 'page_url', 'region',
    'register_url', 'registration_mode', 'registration_open', 'source_key', 'source_type', 'source_updated_at',
    'starts_at', 'summary', 'summary_en', 'takes_registrations', 'time_zone', 'title', 'title_en',
  ]
  for (const projected of applied.args.rows_in) assert.deepEqual(Object.keys(projected).sort(), expectedKeys)
  const migrations = new URL('../supabase/migrations/', import.meta.url)
  const definitions = readdirSync(migrations).filter(name => /^\d{14}_.+\.sql$/.test(name)).sort()
    .map(name => readFileSync(new URL(name, migrations), 'utf8'))
    .filter(sql => /^CREATE (?:OR REPLACE )?FUNCTION public\.apply_caaci_event_snapshot\(/m.test(sql))
  assert.ok(definitions.length >= 2, 'A creates the snapshot function and B replaces it')
  const databaseKeys = [...new Set([...definitions.at(-1).matchAll(/source_row ->> '([^']+)'/g)].map(match => match[1]))].sort()
  assert.deepEqual(databaseKeys, expectedKeys)
})

test('null ends remain null and effective database completeness controls finish', async () => {
  const feed = structuredClone(complete)
  feed.events[0].ends_at = null
  const actual = await run({ feed, applied: { complete: false, rejected: 1 } })
  assert.equal(actual.calls.find(call => call.name === 'apply_caaci_event_snapshot').args.rows_in[0].ends_at, null)
  assert.deepEqual(actual.result, { outcome: 'partial', code: 'rows_rejected', rejected: 1 })
  assert.deepEqual(actual.calls.at(-1).args, { source_in: 'caaci', outcome_in: 'partial', error_code_in: 'rows_rejected' })
})

test('partial snapshots and successful valid-key row rejection are distinct outcomes', async () => {
  const partial = await run({ feed: JSON.parse(text('caaci-v1-incomplete.json')) })
  assert.deepEqual(partial.result, { outcome: 'partial', code: null, rejected: 0 })
  const rejected = await run({ applied: { complete: true, rejected: 1 } })
  assert.deepEqual(rejected.result, { outcome: 'ok', code: 'rows_rejected', rejected: 1 })
})

test('a complete empty snapshot records its own successful finish code', async () => {
  const actual = await run({ feed: { ...complete, events: [] } })
  assert.deepEqual(actual.result, { outcome: 'ok', code: 'empty_snapshot', rejected: 0 })
  assert.deepEqual(actual.calls.at(-1).args, {
    source_in: 'caaci', outcome_in: 'ok', error_code_in: 'empty_snapshot',
  })
})

test('the offline producer handler response retains its shape through normalization', async () => {
  const actual = await run({ feed: JSON.parse(text('caaci-handler-28d59b1.json')) })
  assert.deepEqual(actual.result, { outcome: 'ok', code: null, rejected: 0 })
  const rows = actual.calls.find(call => call.name === 'apply_caaci_event_snapshot').args.rows_in
  assert.equal(rows.length, 2)
  assert.equal(rows[0].register_url, 'https://caaciorg.com/events/synthetic-gathering/register/')
  assert.equal(rows[1].title, null)
  assert.equal(rows[1].ends_at, null)
  assert.equal(rows[1].register_url, null)
  assert.equal(rows[1].registration_mode, 'info_only')
})

test('upstream and RPC failure classes are stable codes without source content', async t => {
  const cases = [
    ['edge403', { status: 403, body: text('caaci-edge-403.html'), headers: { 'content-type': 'text/html' } }, 'http_403_edge'],
    ['mitigated403', { status: 403, headers: { 'cf-mitigated': 'challenge' } }, 'http_403_edge'],
    ['plain403', { status: 403 }, 'http_403'], ['404', { status: 404 }, 'http_404'],
    ['other4xx', { status: 409 }, 'http_4xx'], ['429', { status: 429 }, 'http_429'],
    ['503', { status: 503 }, 'http_503'], ['500', { status: 500, body: text('caaci-500-upstream.txt') }, 'http_5xx'],
    ['abort', { fetchError: new DOMException('Synthetic detail', 'AbortError') }, 'timeout'],
    ['timeout reason', { fetchError: new Error('request_timeout') }, 'timeout'],
    ['declared size', { headers: { 'content-length': String(256 * 1024 + 1) } }, 'too_large'],
    ['body size', { body: 'x'.repeat(256 * 1024 + 1) }, 'too_large'],
    ['redirect', { status: 302 }, 'upstream_redirect'],
    ['html200', { body: text('caaci-edge-403.html') }, 'bad_json'],
    ['schema', { feed: { schema: 'v2' } }, 'schema_mismatch'],
    ['private fields', { feed: JSON.parse(text('caaci-event-register-signed-in.json')) }, 'unexpected_private_fields'],
    ['unexpected fetch', { fetchError: new Error('Synthetic private detail') }, 'unexpected_failure'],
    ['apply timeout', { throwOn: 'apply_caaci_event_snapshot', error: new Error('provider_timeout') }, 'apply_timeout'],
    ['apply malformed', { throwOn: 'apply_caaci_event_snapshot', error: new Error('provider_malformed') }, 'apply_failed'],
    ['apply status', { throwOn: 'apply_caaci_event_snapshot', error: new Error('provider_status_503') }, 'apply_http_503'],
    ['hostile error', { throwOn: 'apply_caaci_event_snapshot', error: { get message() { throw new Error('Synthetic private detail') } } }, 'apply_failed'],
    ['apply 400', { throwOn: 'apply_caaci_event_snapshot', error: new Error('provider_status_400') }, 'apply_http_400'],
    ['apply 404', { throwOn: 'apply_caaci_event_snapshot', error: new Error('provider_status_404') }, 'apply_http_404'],
    ['apply redirect', { throwOn: 'apply_caaci_event_snapshot', error: new Error('provider_redirect') }, 'apply_failed'],
    ['apply size', { throwOn: 'apply_caaci_event_snapshot', error: new Error('response_too_large') }, 'apply_failed'],
    ['non-Error status', { throwOn: 'apply_caaci_event_snapshot', error: { message: 'provider_status_503' } }, 'apply_failed'],
    ['non-Error timeout', { throwOn: 'apply_caaci_event_snapshot', error: { message: 'provider_timeout' } }, 'apply_failed'],
    ['hostile Error', { throwOn: 'apply_caaci_event_snapshot', error: Object.defineProperty(new Error('provider_timeout'), 'message', { get() { throw new Error('Synthetic private detail') } }) }, 'apply_failed'],
    ['apply 302', { throwOn: 'apply_caaci_event_snapshot', error: new Error('provider_status_302') }, 'apply_failed'],
    ['apply 5030', { throwOn: 'apply_caaci_event_snapshot', error: new Error('provider_status_5030') }, 'apply_failed'],
    ['apply prefixed status', { throwOn: 'apply_caaci_event_snapshot', error: new Error('xprovider_status_503') }, 'apply_failed'],
  ]
  for (const [name, options, code] of cases) await t.test(name, async () => {
    const actual = await run(options)
    assert.deepEqual(actual.result, { outcome: 'failed', code, rejected: 0 })
    assert.equal(actual.calls.at(-1).name, 'finish_community_event_sync')
    assert.equal(actual.calls.at(-1).args.error_code_in, code)
    assert.equal(actual.calls.filter(call => call.name === 'finish_community_event_sync').length, 1)
    assert.deepEqual(actual.logs, [])
    assert.equal(code.startsWith('apply_'), options.throwOn === 'apply_caaci_event_snapshot')
    assert.deepEqual(actual.calls.map(call => call.name), options.throwOn === 'apply_caaci_event_snapshot'
      ? ['claim_community_event_sync', 'apply_caaci_event_snapshot', 'finish_community_event_sync']
      : ['claim_community_event_sync', 'finish_community_event_sync'])
  })
})

test('malformed apply results fail closed instead of pretending the snapshot completed', async () => {
  for (const applied of [null, true, {}, { complete: true, rejected: -1 }, { complete: true, rejected: 2 }]) {
    const actual = await run({ applied })
    assert.equal(actual.result.code, 'apply_result_invalid')
    assert.equal(actual.calls.at(-1).args.outcome_in, 'failed')
  }
})

for (const [name, options, code] of [
  ['false', { finish: false }, 'unexpected_failure'],
  ['malformed', { throwOn: 'finish_community_event_sync', error: new Error('provider_malformed') }, 'finish_failed'],
  ['503', { throwOn: 'finish_community_event_sync', error: new Error('provider_status_503') }, 'finish_http_503'],
]) {
  test(`finish ${name} logs once without retrying or replacing the completed snapshot`, async () => {
    const actual = await run(options)
    assert.deepEqual(actual.result, { outcome: 'ok', code: null, rejected: 0 })
    assert.equal(actual.calls.filter(call => call.name === 'finish_community_event_sync').length, 1)
    assert.equal(actual.logs.length, 1)
    assert.deepEqual(actual.logs[0][1], { code })
  })
}
