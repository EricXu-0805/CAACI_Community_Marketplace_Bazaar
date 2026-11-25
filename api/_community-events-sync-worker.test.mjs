// The underscore keeps this offline worker regression out of Vercel's function list.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineSharedApiImports } from './_test-module-loader.mjs'

const keys = ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'CRON_SECRET', 'OPENAI_API_KEY', 'LISTING_ENGLISH_AUTOTRANSLATE', 'CHAT_VIDEO_MODERATION_ENABLED',
  'SENTRY_DSN', 'VITE_SENTRY_DSN', 'COMMUNITY_SYNC_CAACI_EVENTS']
const originalEnv = new Map(keys.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const originalNow = Date.now
const originalError = console.error
const backlog = { listing_pending: 0, listing_oldest_seconds: 0, media_pending: 0, media_failed: 0 }
const baselineKeys = ['backlog', 'listing_batches', 'media_cancelled', 'media_completed', 'media_retried', 'notifications', 'success']
const sourceUrl = new URL('./background-jobs.js', import.meta.url)
const fixtureUrl = new URL('./__fixtures__/community-events/', import.meta.url)
let nonce = 0

afterEach(() => {
  for (const key of keys) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
  Date.now = originalNow
  console.error = originalError
})

async function worker(flag, options = {}) {
  for (const key of keys) delete process.env[key]
  Object.assign(process.env, {
    SUPABASE_URL: 'https://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'background-jobs-service-key',
    CRON_SECRET: 'background-jobs-cron-secret', SENTRY_DSN: 'https://public@sentry.test/1',
  })
  if (flag !== undefined) process.env.COMMUNITY_SYNC_CAACI_EVENTS = flag
  const feed = JSON.parse(await readFile(new URL('caaci-v1-complete.json', fixtureUrl), 'utf8'))
  const calls = [], events = [], logs = []
  console.error = (...args) => logs.push(args)
  const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url, body, init })
    if (url.hostname === 'sentry.test') { events.push(body); return json({}) }
    if (url.hostname === 'caaciorg.com') {
      options.onSource?.()
      return new Response(options.sourceBody ?? JSON.stringify(feed), {
        status: options.sourceStatus ?? 200,
        headers: { 'content-type': options.sourceType ?? 'application/json' },
      })
    }
    if (url.hostname !== 'supabase.test') throw new Error('Unexpected synthetic destination')
    const name = url.pathname.split('/').at(-1)
    switch (name) {
      case 'claim_moderation_media_job': return json(null)
      case 'process_listing_notification_job': return json({ worked: false, scanned: 0, inserted: 0 })
      case 'claim_chat_media_orphan': options.onOrphan?.(); return json(null)
      case 'claim_community_event_sync': options.onClaim?.(); return json(options.claim ?? true)
      case 'apply_caaci_event_snapshot':
        if (options.applyThrows) throw new Error('Synthetic internal sync failure')
        if (options.applyStatus !== undefined) return new Response('{"code":"22003","message":"Synthetic database detail"}', {
          status: options.applyStatus, headers: { 'content-type': 'application/json' },
        })
        return json(options.applied ?? { complete: true, rejected: 0 })
      case 'finish_community_event_sync':
        return options.emptyFinish ? new Response('', { status: 200 }) : json(true)
      case 'purge_completed_background_jobs': return json(0)
      case 'background_job_status': return json(backlog)
      default: throw new Error('Unexpected synthetic RPC: ' + name)
    }
  }
  const encoded = Buffer.from(inlineSharedApiImports(await readFile(sourceUrl, 'utf8'))).toString('base64')
  const handler = (await import('data:text/javascript;base64,' + encoded + '#sync-worker-' + nonce++)).default
  const response = await handler(new Request('https://app.test/api/background-jobs', {
    headers: { authorization: 'Bearer background-jobs-cron-secret' },
  }))
  return { status: response.status, body: await response.json(), calls, events, logs }
}

const rpcNames = result => result.calls.filter(call => call.url.hostname === 'supabase.test')
  .map(call => call.url.pathname.split('/').at(-1))
const syncCalls = result => rpcNames(result).filter(name => name.includes('community_event'))
const diagnosticStrings = value => {
  if (typeof value === 'string') return [value]
  if (value instanceof Error) return [value.message]
  if (Array.isArray(value)) return value.flatMap(diagnosticStrings)
  if (value && typeof value === 'object') return Object.values(value).flatMap(diagnosticStrings)
  return []
}

test('an apply HTTP 400 reports the database step without exposing its response detail', async () => {
  const result = await worker('1', { applyStatus: 400 })
  assert.equal(result.status, 200)
  assert.equal(result.body.community_events_sync, 'failed')
  const finish = result.calls.find(call => call.url.pathname.endsWith('/finish_community_event_sync'))
  assert.equal(finish.body.error_code_in, 'apply_http_400')
  assert.equal(result.events.length, 1)
  assert.deepEqual(result.events[0].extra, { outcome: 'failed', code: 'apply_http_400', rejected: 0 })
  assert.equal(diagnosticStrings([result.logs, result.events, finish.body])
    .some(value => value.includes('Synthetic database detail')), false)
})

test('a complete empty worker snapshot records empty_snapshot without a Sentry event', async () => {
  const feed = JSON.parse(await readFile(new URL('caaci-v1-complete.json', fixtureUrl), 'utf8'))
  feed.events = []
  const result = await worker('1', { sourceBody: JSON.stringify(feed) })
  assert.equal(result.status, 200)
  assert.equal(result.body.community_events_sync, 'ok')
  const finish = result.calls.find(call => call.url.pathname.endsWith('/finish_community_event_sync'))
  assert.equal(finish.body.error_code_in, 'empty_snapshot')
  assert.deepEqual(result.events, [])
})

test('only the exact sync flag opens a new worker response field or any sync request', async () => {
  for (const flag of [undefined, '', '0', 'true', '1 ']) {
    const result = await worker(flag)
    assert.equal(result.status, 200)
    assert.deepEqual(Object.keys(result.body).sort(), baselineKeys)
    assert.deepEqual(syncCalls(result), [])
    assert.equal(result.calls.filter(call => call.url.hostname === 'caaciorg.com').length, 0)
    assert.deepEqual(result.events, [])
  }
  const result = await worker('1', { claim: false })
  assert.equal(result.status, 200)
  assert.equal(result.body.community_events_sync, 'not_due')
  assert.deepEqual(syncCalls(result), ['claim_community_event_sync'])
  assert.equal(result.calls.filter(call => call.url.hostname === 'caaciorg.com').length, 0)
})

test('twelve seconds or less leaves sync untouched while purge and status still complete', async () => {
  for (const remaining of [12_000, 11_999]) {
    const start = 100_000
    let now = start
    Date.now = () => now
    const result = await worker('1', { onOrphan: () => { now = start + 25_000 - remaining } })
    assert.equal(result.status, 200)
    assert.equal(result.body.community_events_sync, 'skipped_budget')
    assert.deepEqual(syncCalls(result), [])
    assert.deepEqual(rpcNames(result).slice(-2), ['purge_completed_background_jobs', 'background_job_status'])
    assert.deepEqual(result.events, [])
  }
})

test('late sync budget stops before apply and finish and reports after cleanup', async () => {
  const start = 100_000
  let now = start
  Date.now = () => now
  const result = await worker('1', {
    onOrphan: () => { now = start + 12_500 },
    onClaim: () => { now += 4_900 }, onSource: () => { now += 2_500 },
  })
  assert.equal(result.status, 200)
  assert.deepEqual(syncCalls(result), ['claim_community_event_sync'])
  assert.equal(result.body.community_events_sync, 'failed')
  assert.deepEqual(rpcNames(result).slice(-2), ['purge_completed_background_jobs', 'background_job_status'])
  assert.equal(result.events.length, 1)
  assert.deepEqual(result.events[0].extra, { outcome: 'failed', code: 'deadline', rejected: 0 })
  const statusIndex = result.calls.findIndex(call => call.url.pathname.endsWith('/background_job_status'))
  assert.ok(result.calls.findIndex(call => call.url.hostname === 'sentry.test') > statusIndex)
})

test('sync failures do not escape the worker and empty finish bodies are not retried', async () => {
  const failed = await worker('1', { applyThrows: true })
  assert.equal(failed.status, 200)
  assert.equal(failed.body.community_events_sync, 'failed')
  assert.deepEqual(rpcNames(failed).slice(-2), ['purge_completed_background_jobs', 'background_job_status'])
  assert.equal(failed.events.length, 1)
  const empty = await worker('1', { emptyFinish: true })
  assert.equal(empty.status, 200)
  assert.equal(empty.body.community_events_sync, 'ok')
  assert.equal(syncCalls(empty).filter(name => name === 'finish_community_event_sync').length, 1)
  assert.equal(empty.logs.length, 1)
})

test('failed, partial and rejected snapshots report once after status without leaking source bodies', async () => {
  const probes = [
    { sourceBody: await readFile(new URL('caaci-500-upstream.txt', fixtureUrl), 'utf8'), sourceStatus: 500, outcome: 'failed', code: 'http_5xx', rejected: 0 },
    { sourceBody: await readFile(new URL('caaci-edge-403.html', fixtureUrl), 'utf8'), sourceStatus: 403, sourceType: 'text/html', outcome: 'failed', code: 'http_403_edge', rejected: 0 },
    { applied: { complete: false, rejected: 0 }, outcome: 'partial', code: null, rejected: 0 },
    { applied: { complete: true, rejected: 1 }, outcome: 'ok', code: 'rows_rejected', rejected: 1 },
    { applied: { complete: false, rejected: 1 }, outcome: 'partial', code: 'rows_rejected', rejected: 1 },
  ]
  for (const scenario of probes) {
    const result = await worker('1', scenario)
    assert.equal(result.status, 200)
    assert.equal(result.body.community_events_sync, scenario.outcome)
    assert.equal(result.events.length, 1)
    assert.equal(result.events[0].message, 'community events sync needs attention')
    assert.deepEqual(result.events[0].extra, { outcome: scenario.outcome, code: scenario.code, rejected: scenario.rejected })
    const finish = result.calls.find(call => call.url.pathname.endsWith('/finish_community_event_sync'))
    assert.equal(finish.body.error_code_in, scenario.code)
    const statusIndex = result.calls.findIndex(call => call.url.pathname.endsWith('/background_job_status'))
    assert.ok(result.calls.findIndex(call => call.url.hostname === 'sentry.test') > statusIndex)
    for (const marker of ['Synthetic upstream failure.', 'Synthetic edge response', 'Synthetic description.']) {
      assert.equal(diagnosticStrings([result.logs, result.events, finish.body]).some(value => value.includes(marker)), false)
    }
  }
  const clean = await worker('1')
  assert.equal(clean.body.community_events_sync, 'ok')
  assert.deepEqual(clean.events, [])
})
