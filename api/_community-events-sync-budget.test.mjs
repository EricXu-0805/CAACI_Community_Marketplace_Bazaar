import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
const originalFetch = globalThis.fetch
let realFetchCalls = 0
globalThis.fetch = () => { realFetchCalls++; throw new Error('Real network is forbidden') }
const { CAACI_SYNC_INTERVAL_MINUTES, syncCaaciEvents } = await import('./_community-events-sync.js')
after(() => { globalThis.fetch = originalFetch; assert.equal(realFetchCalls, 0) })

const originalFlag = process.env.COMMUNITY_SYNC_CAACI_EVENTS
const originalNow = Date.now
const originalError = console.error
const feed = readFileSync(new URL('./__fixtures__/community-events/caaci-v1-complete.json', import.meta.url), 'utf8')
afterEach(() => {
  if (originalFlag === undefined) delete process.env.COMMUNITY_SYNC_CAACI_EVENTS
  else process.env.COMMUNITY_SYNC_CAACI_EVENTS = originalFlag
  Date.now = originalNow
  console.error = originalError
})

test('each step recomputes its timeout while reserving five seconds for cleanup', async t => {
  process.env.COMMUNITY_SYNC_CAACI_EVENTS = '1'
  let now = 100_000
  Date.now = () => now
  const seen = []
  const timer = globalThis.setTimeout
  t.mock.method(globalThis, 'setTimeout', (callback, timeout, ...args) => {
    seen.push(['upstream', timeout])
    return timer(callback, timeout, ...args)
  })
  const call = async (name, args, timeout) => {
    seen.push([name, timeout])
    if (name === 'claim_community_event_sync') assert.equal(args.interval_in, CAACI_SYNC_INTERVAL_MINUTES + ' minutes')
    now += 2000
    return name === 'apply_caaci_event_snapshot' ? { complete: true, rejected: 0 } : true
  }
  const fetch = async () => { now += 2000; return new Response(feed) }
  const result = await syncCaaciEvents({ deadline: now + 12_500, call, fetch })
  assert.deepEqual(result, { outcome: 'ok', code: null, rejected: 0 })
  assert.deepEqual(seen, [
    ['claim_community_event_sync', 5000], ['upstream', 5000],
    ['apply_caaci_event_snapshot', 3500], ['finish_community_event_sync', 1500],
  ])
})

test('upstream timeout shrinks below the cap as earlier steps spend budget', async t => {
  process.env.COMMUNITY_SYNC_CAACI_EVENTS = '1'
  let now = 100_000
  Date.now = () => now
  const seen = []
  const timer = globalThis.setTimeout
  t.mock.method(globalThis, 'setTimeout', (callback, timeout, ...args) => {
    seen.push(['upstream', timeout])
    return timer(callback, timeout, ...args)
  })
  const call = async (name, args, timeout) => {
    seen.push([name, timeout])
    if (name === 'claim_community_event_sync') now += 4000
    else if (name === 'apply_caaci_event_snapshot') now += 1000
    return name === 'apply_caaci_event_snapshot' ? { complete: true, rejected: 0 } : true
  }
  const fetch = async () => { now += 1000; return new Response(feed) }
  const result = await syncCaaciEvents({ deadline: now + 12_500, call, fetch })
  assert.deepEqual(result, { outcome: 'ok', code: null, rejected: 0 })
  assert.deepEqual(seen, [
    ['claim_community_event_sync', 5000], ['upstream', 3500],
    ['apply_caaci_event_snapshot', 2500], ['finish_community_event_sync', 1500],
  ])
})

test('an insufficient pre-finish budget does not record success or call finish', async () => {
  process.env.COMMUNITY_SYNC_CAACI_EVENTS = '1'
  const start = 100_000
  let now = start
  Date.now = () => now
  const calls = [], logs = []
  console.error = (...args) => logs.push(args)
  const result = await syncCaaciEvents({
    deadline: start + 20_000,
    call: async name => {
      calls.push(name)
      if (name === 'apply_caaci_event_snapshot') { now = start + 14_500; return { complete: true, rejected: 0 } }
      return true
    },
    fetch: async () => new Response(feed),
  })
  assert.deepEqual(result, { outcome: 'failed', code: 'deadline', rejected: 0 })
  assert.deepEqual(calls, ['claim_community_event_sync', 'apply_caaci_event_snapshot'])
  assert.equal(logs.length, 1)
})

test('a missing initial budget makes no claim and no upstream request', async () => {
  process.env.COMMUNITY_SYNC_CAACI_EVENTS = '1'
  let calls = 0
  const result = await syncCaaciEvents({ deadline: Date.now() + 5000,
    call: async () => { calls++; return true }, fetch: async () => { calls++; return new Response(feed) },
  })
  assert.deepEqual(result, { outcome: 'failed', code: 'deadline', rejected: 0 })
  assert.equal(calls, 0)
})

// The source cache is always sixty seconds old. A removal at the cache sample's
// exact second happens just after that sample, preserving the worst-case edge.
function worstWithdrawalDelay(mode) {
  const interval = CAACI_SYNC_INTERVAL_MINUTES * 60
  const claims = []
  let previous = -Infinity
  for (let minute = 0; minute <= (CAACI_SYNC_INTERVAL_MINUTES + 2) * 5; minute++) {
    const nominal = minute * 60
    const jitter = mode === 'ten' || (mode === 'adversarial' && nominal + 10 - previous > interval) ? 10 : 0
    const at = nominal + jitter
    if (at - previous > interval) { claims.push(at); previous = at }
  }
  let worst = 0
  for (let removed = claims[0]; removed < claims[1]; removed++) {
    let missing = 0
    let withdrawn = false
    for (const claim of claims) {
      missing = claim - 60 <= removed ? 0 : missing + 1
      if (missing === 2) { worst = Math.max(worst, claim - removed); withdrawn = true; break }
    }
    assert.equal(withdrawn, true, mode + ': each removal phase reaches two complete absences')
  }
  return { worst, phases: claims[1] - claims[0] }
}

test('minute cron and worst source caching meet the thirty-minute withdrawal bound', t => {
  for (const mode of ['adversarial', 'zero', 'ten']) {
    const { worst, phases } = worstWithdrawalDelay(mode)
    t.diagnostic(mode + ': maxSeconds=' + worst + ' removalPhases=' + phases)
    assert.ok(worst <= 30 * 60, mode + ': ' + worst + ' seconds over ' + phases + ' removal phases')
  }
})
