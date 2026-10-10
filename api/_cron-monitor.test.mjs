import assert from 'node:assert/strict'
import { test, afterEach } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineSharedApiImports } from './_test-module-loader.mjs'

const source = await readFile(new URL('_cron-monitor.js', import.meta.url), 'utf8')
const { monitoredCron } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
const names = ['SENTRY_DSN', 'VITE_SENTRY_DSN', 'SENTRY_CRON_MONITORS', 'VERCEL_ENV', 'CRON_SECRET', 'VERCEL_GIT_COMMIT_SHA', 'SENTRY_CRON_SLUG_BACKGROUND_JOBS']
const original = Object.fromEntries(names.map(name => [name, process.env[name]]))
const originalFetch = globalThis.fetch
const originalInfo = console.info
afterEach(() => {
  globalThis.fetch = originalFetch
  console.info = originalInfo
  for (const name of names) original[name] === undefined ? delete process.env[name] : process.env[name] = original[name]
})
function setup(overrides = {}) {
  for (const name of names) delete process.env[name]
  Object.assign(process.env, { SENTRY_DSN: 'https://public123@o99.ingest.us.sentry.io/4507',
    VERCEL_ENV: 'production', CRON_SECRET: 'private-test-cron', SENTRY_CRON_MONITORS: 'background-jobs',
    VERCEL_GIT_COMMIT_SHA: 'abcdef12345678', ...overrides })
  const events = []
  events.attempts = 0
  events.logs = []
  console.info = line => events.logs.push(JSON.parse(line))
  globalThis.fetch = async (url, init) => {
    events.attempts++
    assert.equal(new URL(url).hostname, 'o99.ingest.us.sentry.io')
    assert.equal(init.redirect, 'manual')
    const [header, item, payload] = init.body.split('\n').map(JSON.parse)
    assert.equal(item.type, 'check_in')
    assert.ok(header.sent_at)
    assert.doesNotMatch(init.body, /private-test-cron|public123/)
    events.push(payload)
    return new Response('{}')
  }
  return events
}
const request = (secret = 'private-test-cron', method = 'GET') => new Request('https://app.test/api/background-jobs', {
  method, headers: { authorization: `Bearer ${secret}` },
})
test('one authenticated run has matching start and completion, without auto-creating a paid monitor', async () => {
  const events = setup()
  const expected = new Response('kept', { status: 200 })
  assert.equal(await monitoredCron(request(), 'background-jobs', async () => expected), expected)
  assert.deepEqual(events.map(x => x.status), ['in_progress', 'ok'])
  assert.equal(events[0].check_in_id, events[1].check_in_id)
  assert.equal(events[1].monitor_slug, 'illini-background-jobs')
  assert.equal(events[1].environment, 'production')
  assert.equal(events[1].release, 'abcdef1')
  assert.equal(events[0].monitor_config, undefined)
  assert.ok(Number.isFinite(events[1].duration))
})
test('errors and thrown failures finish as errors without exposing exception content', async () => {
  const events = setup()
  const response = await monitoredCron(request(), 'background-jobs', async () => new Response('upstream secret', { status: 503 }))
  assert.equal(response.status, 503)
  const error = new Error('private-address@example.test')
  await assert.rejects(monitoredCron(request(), 'background-jobs', async () => { throw error }), e => e === error)
  assert.deepEqual(events.map(x => x.status), ['in_progress', 'error', 'in_progress', 'error'])
  assert.doesNotMatch(JSON.stringify(events), /upstream secret|private-address/)
})
test('unauthorized, POST, previews and unconfigured jobs cannot create or spoof a check-in', async () => {
  const events = setup()
  for (const [req, job] of [[request('wrong'), 'background-jobs'], [request(), 'other'], [request('', 'POST'), 'background-jobs']]) {
    await monitoredCron(req, job, async () => new Response('kept'))
  }
  process.env.VERCEL_ENV = 'preview'
  await monitoredCron(request(), 'background-jobs', async () => new Response('kept'))
  assert.equal(events.length, 0)
  assert.equal(events.attempts, 0)
})
test('malformed or third-party DSNs never receive a request', async () => {
  const events = setup()
  for (const dsn of ['https://key@evil.test/1', 'https://key@o99.ingest.sentry.io.evil.test/1',
    'https://key:secret@o99.ingest.sentry.io/1', 'http://key@o99.ingest.sentry.io/1',
    'https://key@o99.ingest.sentry.io/1/../../2', 'https://key@o99.ingest.sentry.io/1?x=1']) {
    process.env.SENTRY_DSN = dsn
    await monitoredCron(request(), 'background-jobs', async () => new Response('kept'))
  }
  assert.equal(events.length, 0)
  assert.equal(events.attempts, 0)
})
test('monitor transport failure does not cancel the real operation', async () => {
  setup(); globalThis.fetch = async () => { throw new Error('unavailable') }
  const expected = new Response('business result')
  assert.equal(await monitoredCron(request(), 'background-jobs', async () => expected), expected)
})
test('in-progress is delivered before work starts and no false completion appears while work hangs', async () => {
  const events = setup(); let finish
  const pending = monitoredCron(request(), 'background-jobs', () => new Promise(resolve => { finish = resolve }))
  while (!finish) await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events.map(x => x.status), ['in_progress'])
  finish(new Response('done')); await pending
  assert.deepEqual(events.map(x => x.status), ['in_progress', 'ok'])
})
for (const file of ['background-jobs.js', 'notification-digest.js', 'data-retention.js', 'banner-upload-gc.js', 'auth/delete-account.js']) {
  test(`${file}: actual handler does not report unauthorized calls with monitoring enabled`, async () => {
    const events = setup({ SENTRY_CRON_MONITORS: 'background-jobs,notification-digest,data-retention,banner-upload-gc,delete-account' })
    const code = inlineSharedApiImports(await readFile(new URL(file, import.meta.url), 'utf8'))
    const handler = (await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64') + '#cron-auth')).default
    const response = await handler(request('wrong'))
    assert.ok(response.status >= 400)
    assert.equal(events.length, 0)
  assert.equal(events.attempts, 0)
  })
}

test('uses the configured existing monitor slug and rejects an invalid override', async () => {
  const events = setup({ SENTRY_CRON_SLUG_BACKGROUND_JOBS: 'new-monitor' })
  await monitoredCron(request(), 'background-jobs', async () => new Response('ok'))
  assert.ok(events.every(x => x.monitor_slug === 'new-monitor'))
  process.env.SENTRY_CRON_SLUG_BACKGROUND_JOBS = '../another/monitor'
  await monitoredCron(request(), 'background-jobs', async () => new Response('ok'))
  assert.equal(events.at(-1).monitor_slug, 'illini-background-jobs')
})

test('authenticated configuration decisions are logged only when they change', async () => {
  const events = setup({ SENTRY_CRON_MONITORS: '' })
  const { monitoredCron: monitor } = await import('data:text/javascript;base64,'
    + Buffer.from(source).toString('base64') + '#gate-decisions')
  const run = async () => new Response('kept')
  await monitor(request('wrong'), 'background-jobs', run)
  await monitor(request(), 'untrusted-job-private', run)
  await monitor(request(), 'background-jobs', run)
  await monitor(request(), 'background-jobs', run)
  process.env.SENTRY_CRON_MONITORS = 'background-jobs'
  delete process.env.SENTRY_DSN
  await monitor(request(), 'background-jobs', run)
  await monitor(request(), 'background-jobs', run)
  process.env.SENTRY_DSN = 'https://private-key@evil.test/1?private-content'
  await monitor(request(), 'background-jobs', run)
  await monitor(request(), 'background-jobs', run)
  assert.equal(events.attempts, 0)
  process.env.SENTRY_DSN = 'https://public123@o99.ingest.us.sentry.io/4507'
  await monitor(request(), 'background-jobs', run)
  await monitor(request(), 'background-jobs', run)
  assert.equal(events.attempts, 4)
  assert.deepEqual(events.logs.filter(x => x.event === 'cron_monitor_gate'),
    ['not_enabled', 'missing_dsn', 'invalid_dsn', 'enabled'].map(outcome => ({
      event: 'cron_monitor_gate', job: 'background-jobs', outcome,
    })))
  assert.doesNotMatch(JSON.stringify(events.logs), /private|public123|evil|https|4507/)
})

test('unauthenticated and inapplicable requests do not produce diagnostics', async () => {
  const events = setup()
  const run = async () => new Response('kept')
  await monitoredCron(request('wrong'), 'background-jobs', run)
  await monitoredCron(request(), 'private-job', run)
  await monitoredCron(request('private-test-cron', 'POST'), 'background-jobs', run)
  process.env.VERCEL_ENV = 'preview'
  await monitoredCron(request(), 'background-jobs', run)
  process.env.VERCEL_ENV = 'production'
  delete process.env.CRON_SECRET
  await monitoredCron(request(), 'background-jobs', run)
  assert.equal(events.attempts, 0)
  assert.deepEqual(events.logs, [])
})

for (const [httpStatus, outcome] of [[201, 'http_2xx'], [204, 'http_2xx'],
  [302, 'redirect'], [429, 'http_non_2xx'], [503, 'http_non_2xx']]) {
  test(`check-in records HTTP ${httpStatus} without altering the business response or retrying`, async () => {
    const events = setup()
    let attempts = 0
    globalThis.fetch = async (_url, init) => {
      attempts++
      assert.equal(init.redirect, 'manual')
      return new Response(httpStatus === 204 ? null : 'private-provider-body', {
        status: httpStatus, headers: { Location: 'https://private-redirect.test/?private-key' },
      })
    }
    const expected = new Response('private-business-content', { status: 503 })
    assert.equal(await monitoredCron(request(), 'background-jobs', async () => expected), expected)
    assert.equal(attempts, 2)
    const records = events.logs.filter(x => x.event === 'cron_monitor_check_in')
    assert.equal(records.length, 2)
    assert.deepEqual(records.map(x => x.check_in_status), ['in_progress', 'error'])
    assert.match(records[0].check_in_id, /^[a-f0-9]{32}$/)
    assert.equal(records[0].check_in_id, records[1].check_in_id)
    for (const record of records) {
      assert.deepEqual(Object.keys(record).sort(), ['event', 'job', 'check_in_status',
        'check_in_id', 'outcome', 'http_status', 'body_cancel'].sort())
      assert.equal(record.job, 'background-jobs')
      assert.equal(record.outcome, outcome)
      assert.equal(record.http_status, httpStatus)
      assert.equal(record.body_cancel, httpStatus === 204 ? 'not_needed' : 'complete')
    }
    assert.doesNotMatch(JSON.stringify(events.logs), /private|public123|https|4507/)
  })
}

test('redirected and opaque redirect responses cannot be reported as HTTP acceptance', async () => {
  const events = setup()
  const responses = [{ status: 200, redirected: true }, { status: 0, type: 'opaqueredirect' }]
  let attempts = 0
  globalThis.fetch = async () => responses[attempts++]
  await monitoredCron(request(), 'background-jobs', async () => new Response('kept'))
  assert.equal(attempts, 2)
  assert.deepEqual(events.logs.filter(x => x.event === 'cron_monitor_check_in')
    .map(x => [x.outcome, x.http_status]), [['redirect', 200], ['redirect', null]])
})

test('network errors preserve a thrown business error and never expose exception text', async () => {
  const events = setup()
  let attempts = 0
  globalThis.fetch = async () => { attempts++; throw new Error('private-network-key') }
  const expected = new Error('private-business-content')
  await assert.rejects(monitoredCron(request(), 'background-jobs', async () => { throw expected }), e => e === expected)
  assert.equal(attempts, 2)
  const records = events.logs.filter(x => x.event === 'cron_monitor_check_in')
  assert.deepEqual(records.map(x => [x.check_in_status, x.outcome, x.http_status]),
    [['in_progress', 'network_error', null], ['error', 'network_error', null]])
  assert.doesNotMatch(JSON.stringify(events.logs), /private|public123/)
})

test('a fetch ignoring abort cannot delay business work past two seconds', async t => {
  const events = setup()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let attempts = 0, signal, rejectLate, businessCalls = 0
  globalThis.fetch = (_url, init) => {
    if (++attempts > 1) return Promise.resolve(new Response(''))
    signal = init.signal
    return new Promise((_resolve, reject) => { rejectLate = reject })
  }
  const expected = new Response('kept')
  const pending = monitoredCron(request(), 'background-jobs', async () => { businessCalls++; return expected })
  while (!signal) await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(1999)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(businessCalls, 0)
  t.mock.timers.tick(1)
  assert.equal(await pending, expected)
  assert.equal(signal.aborted, true)
  assert.equal(businessCalls, 1)
  assert.equal(attempts, 2)
  assert.deepEqual(events.logs.filter(x => x.event === 'cron_monitor_check_in')
    .map(x => x.outcome), ['timeout', 'http_2xx'])
  rejectLate(new Error('private-late-rejection'))
  await new Promise(resolve => setImmediate(resolve))
})

test('the same two-second deadline bounds a body cancellation stalled after HTTP acceptance', async t => {
  const events = setup()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let attempts = 0, signal, cancelling = false, businessCalls = 0
  globalThis.fetch = async (_url, init) => {
    if (++attempts > 1) return new Response('')
    signal = init.signal
    await new Promise(resolve => setTimeout(resolve, 1500))
    return { status: 202, body: { cancel() { cancelling = true; return new Promise(() => {}) } } }
  }
  const expected = new Response('kept')
  const pending = monitoredCron(request(), 'background-jobs', async () => { businessCalls++; return expected })
  while (!signal) await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(1500)
  while (!cancelling) await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(499)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(businessCalls, 0)
  t.mock.timers.tick(1)
  assert.equal(await pending, expected)
  assert.equal(signal.aborted, true)
  assert.equal(attempts, 2)
  const first = events.logs.find(x => x.event === 'cron_monitor_check_in')
  assert.equal(first.outcome, 'http_2xx')
  assert.equal(first.http_status, 202)
  assert.equal(first.body_cancel, 'timeout')
})

test('body cancellation errors do not obscure the received HTTP status', async () => {
  const events = setup()
  let attempts = 0
  globalThis.fetch = async () => ({ status: ++attempts === 1 ? 429 : 200,
    body: { cancel() { throw new Error('private-cancel-key') } } })
  const expected = new Response('kept')
  assert.equal(await monitoredCron(request(), 'background-jobs', async () => expected), expected)
  assert.equal(attempts, 2)
  assert.deepEqual(events.logs.filter(x => x.event === 'cron_monitor_check_in')
    .map(x => [x.outcome, x.body_cancel]), [['http_non_2xx', 'failed'], ['http_2xx', 'failed']])
  assert.doesNotMatch(JSON.stringify(events.logs), /private|public123/)
})

test('throwing diagnostics cannot change check-ins, the returned response, or the thrown business error', async () => {
  const events = setup()
  const { monitoredCron: monitor } = await import('data:text/javascript;base64,'
    + Buffer.from(source).toString('base64') + '#throwing-diagnostics')
  console.info = () => { throw new Error('private-log-failure') }
  const expected = new Response('kept')
  assert.equal(await monitor(request(), 'background-jobs', async () => expected), expected)
  const error = new Error('original-business-error')
  await assert.rejects(monitor(request(), 'background-jobs', async () => { throw error }), e => e === error)
  assert.equal(events.attempts, 4)
  assert.deepEqual(events.map(x => x.status), ['in_progress', 'ok', 'in_progress', 'error'])
})
