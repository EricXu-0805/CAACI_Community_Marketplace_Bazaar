// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { sentryReportModuleUrl, inlineSharedApiImports } from './_test-module-loader.mjs'

// Loaded the same way the handlers load it — as a data: URL — so Node never has
// to guess the module type of a bare .js file under a typeless package.json.
const { reportToSentry } = await import(sentryReportModuleUrl)

/*
 * Vercel crons do not retry: the next tick fires on schedule no matter what the
 * last one returned. Three sweeps guard obligations users can't see failing —
 * retention deletion, storage GC, and the account-deletion saga — and until
 * this module they announced failure only to Vercel logs.
 *
 * These tests hold two properties: a failing sweep emits exactly one alert, and
 * an unauthenticated caller emits none. The second matters because every one of
 * these endpoints has a guessable public URL.
 */

const API_ROOT = new URL('./', import.meta.url)
const DSN = 'https://publickey123@o99.ingest.sentry.io/4507'
const CRON_SECRET = 'cron-test-secret'
const ENV_KEYS = [
  'SENTRY_DSN', 'VITE_SENTRY_DSN', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_SHA',
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'CRON_SECRET',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const originalConsoleError = console.error
let importNonce = 0

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
  console.error = originalConsoleError
})

function setEnv(overrides = {}) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, overrides)
}

// Records Sentry traffic and hands everything else to `upstream`, so a handler
// test can assert on alerts without the alert masking an unexpected call.
function sentryRecorder(upstream = null) {
  const events = []
  const fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.hostname === 'o99.ingest.sentry.io') {
      events.push({ url, init, body: JSON.parse(String(init.body || '{}')) })
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (!upstream) throw new Error(`unexpected fetch ${url}`)
    return upstream(input, init)
  }
  return { events, fetch }
}

async function loadHandler(filename, env = {}) {
  setEnv({
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
    SUPABASE_ANON_KEY: 'anon-test-key',
    CRON_SECRET,
    ...env,
  })
  const source = await readFile(new URL(filename, API_ROOT), 'utf8')
  const encoded = Buffer.from(inlineSharedApiImports(source)).toString('base64')
  return (await import(`data:text/javascript;base64,${encoded}#sentry-report-${importNonce++}`)).default
}

function cronRequest(path, { secret = CRON_SECRET } = {}) {
  return new Request(`https://app.test/api/${path}`, {
    method: 'GET',
    headers: secret == null ? {} : { Authorization: `Bearer ${secret}` },
  })
}

const CRON_HANDLERS = [
  { name: 'data-retention', file: 'data-retention.js', path: 'data-retention', logger: 'api/data-retention' },
  { name: 'banner-upload-gc', file: 'banner-upload-gc.js', path: 'banner-upload-gc', logger: 'api/banner-upload-gc' },
  { name: 'delete-account', file: 'auth/delete-account.js', path: 'auth/delete-account', logger: 'api/auth/delete-account' },
]

test('no DSN configured means no outbound request at all', async () => {
  setEnv()
  let called = false
  globalThis.fetch = async () => { called = true; return new Response('{}') }
  await reportToSentry('api/test', 'boom')
  assert.equal(called, false)
})

test('a malformed DSN is dropped instead of guessed at', async () => {
  for (const bad of ['not-a-dsn', 'https://o99.ingest.sentry.io/4507', 'http://key@host/1']) {
    setEnv({ SENTRY_DSN: bad })
    let called = false
    globalThis.fetch = async () => { called = true; return new Response('{}') }
    await reportToSentry('api/test', 'boom')
    assert.equal(called, false, `${bad} must not produce a request`)
  }
})

test('a configured DSN posts one grouped event to the Sentry store endpoint', async () => {
  setEnv({ SENTRY_DSN: DSN, VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890' })
  const recorder = sentryRecorder()
  globalThis.fetch = recorder.fetch
  await reportToSentry('api/data-retention', 'data-retention: sweep failed', { code: 'rpc_status_500', batches: 2 })

  assert.equal(recorder.events.length, 1)
  const [event] = recorder.events
  assert.equal(event.url.origin, 'https://o99.ingest.sentry.io')
  assert.equal(event.url.pathname, '/api/4507/store/')
  assert.equal(event.url.searchParams.get('sentry_key'), 'publickey123')
  assert.equal(event.url.searchParams.get('sentry_version'), '7')
  assert.equal(event.init.method, 'POST')
  assert.equal(event.init.redirect, 'manual')
  assert.equal(event.body.logger, 'api/data-retention')
  assert.equal(event.body.level, 'error')
  assert.equal(event.body.environment, 'production')
  assert.equal(event.body.release, 'abcdef1')
  assert.deepEqual(event.body.extra, { code: 'rpc_status_500', batches: 2 })
})

test('the message carries the grouping, so repeats become one issue with a count', async () => {
  setEnv({ SENTRY_DSN: DSN })
  const recorder = sentryRecorder()
  globalThis.fetch = recorder.fetch
  await reportToSentry('api/data-retention', 'data-retention: sweep failed', { batches: 1 })
  await reportToSentry('api/data-retention', 'data-retention: sweep failed', { batches: 4 })

  // Sentry fingerprints on `message`; only `extra` may vary between ticks. If a
  // caller ever interpolates a count into the message, an hourly failure turns
  // into a new issue every hour and the repeat count stops meaning anything.
  const messages = new Set(recorder.events.map(event => event.body.message))
  assert.equal(messages.size, 1)
})

test('the DSN secret never reaches the request body', async () => {
  setEnv({ SENTRY_DSN: DSN })
  const recorder = sentryRecorder()
  globalThis.fetch = recorder.fetch
  await reportToSentry('api/test', 'boom', { code: 'rpc_status_500' })
  assert.doesNotMatch(String(recorder.events[0].init.body), /publickey123/)
})

test('an explicit level survives; anything unspecified stays an error', async () => {
  setEnv({ SENTRY_DSN: DSN })
  const recorder = sentryRecorder()
  globalThis.fetch = recorder.fetch
  await reportToSentry('api/test', 'backlog', {}, 'warning')
  await reportToSentry('api/test', 'broken')
  assert.deepEqual(recorder.events.map(event => event.body.level), ['warning', 'error'])
})

test('a Sentry outage cannot change the outcome of the run reporting it', async () => {
  setEnv({ SENTRY_DSN: DSN })
  globalThis.fetch = async () => { throw new Error('sentry unreachable') }
  await reportToSentry('api/test', 'boom')

  globalThis.fetch = async () => new Response('rate limited', { status: 429 })
  await reportToSentry('api/test', 'boom')
})

test('data-retention alerts once when the retention sweep fails', async () => {
  console.error = () => {}
  const recorder = sentryRecorder(async () => new Response('{"message":"boom"}', { status: 500 }))
  globalThis.fetch = recorder.fetch
  const handler = await loadHandler('data-retention.js', { SENTRY_DSN: DSN })

  const response = await handler(cronRequest('data-retention'))
  assert.equal(response.status, 503)
  assert.equal(recorder.events.length, 1)
  assert.equal(recorder.events[0].body.logger, 'api/data-retention')
  assert.equal(recorder.events[0].body.level, 'error')
  assert.equal(recorder.events[0].body.extra.code, 'rpc_status_500')
})

test('banner-upload-gc alerts once when the storage sweep fails', async () => {
  console.error = () => {}
  const recorder = sentryRecorder(async () => new Response('{"message":"boom"}', { status: 500 }))
  globalThis.fetch = recorder.fetch
  const handler = await loadHandler('banner-upload-gc.js', {
    SENTRY_DSN: DSN,
    SUPABASE_SECRET_KEY: 'service-test-key',
  })

  const response = await handler(cronRequest('banner-upload-gc'))
  assert.equal(response.status, 503)
  assert.equal(recorder.events.length, 1)
  assert.equal(recorder.events[0].body.logger, 'api/banner-upload-gc')
  assert.equal(recorder.events[0].body.level, 'error')
})

for (const cron of CRON_HANDLERS) {
  test(`${cron.name} stays silent for a caller without the cron secret`, async () => {
    console.error = () => {}
    // Every alert these handlers emit must sit behind the shared secret.
    // Otherwise the endpoint's public URL is an alert-flooding primitive and
    // the first response to a noisy alert is to mute it.
    for (const secret of [null, 'wrong-secret', '']) {
      const recorder = sentryRecorder(async () => new Response('{"message":"boom"}', { status: 500 }))
      globalThis.fetch = recorder.fetch
      const handler = await loadHandler(cron.file, {
        SENTRY_DSN: DSN,
        SUPABASE_SECRET_KEY: 'service-test-key',
      })
      const response = await handler(cronRequest(cron.path, { secret }))
      assert.equal(response.status, 401, `${cron.name} must reject secret=${JSON.stringify(secret)}`)
      assert.equal(recorder.events.length, 0)
    }
  })
}

test('every unattended cron in vercel.json reports its own failures', async () => {
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', API_ROOT), 'utf8'))
  for (const { path } of vercel.crons) {
    const file = path === '/api/auth/delete-account' ? 'auth/delete-account.js' : `${path.slice('/api/'.length)}.js`
    const source = await readFile(new URL(file, API_ROOT), 'utf8')
    assert.match(
      source,
      /import \{ reportToSentry \} from '\.{1,2}\/_sentry-report\.js'/,
      `${path} runs unattended and must be able to report a failed sweep`,
    )
  }
})
