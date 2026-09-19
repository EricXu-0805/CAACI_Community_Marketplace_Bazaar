import assert from 'node:assert/strict'
import { test, afterEach } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineSharedApiImports } from './_test-module-loader.mjs'

const source = await readFile(new URL('_cron-monitor.js', import.meta.url), 'utf8')
const { monitoredCron } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
const names = ['SENTRY_DSN', 'VITE_SENTRY_DSN', 'SENTRY_CRON_MONITORS', 'VERCEL_ENV', 'CRON_SECRET', 'VERCEL_GIT_COMMIT_SHA', 'SENTRY_CRON_SLUG_BACKGROUND_JOBS']
const original = Object.fromEntries(names.map(name => [name, process.env[name]]))
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  for (const name of names) original[name] === undefined ? delete process.env[name] : process.env[name] = original[name]
})
function setup(overrides = {}) {
  for (const name of names) delete process.env[name]
  Object.assign(process.env, { SENTRY_DSN: 'https://public123@o99.ingest.us.sentry.io/4507',
    VERCEL_ENV: 'production', CRON_SECRET: 'private-test-cron', SENTRY_CRON_MONITORS: 'background-jobs',
    VERCEL_GIT_COMMIT_SHA: 'abcdef12345678', ...overrides })
  const events = []
  events.attempts = 0
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
