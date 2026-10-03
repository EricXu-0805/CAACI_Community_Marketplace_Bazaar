import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineSharedApiImports, deploymentBoundaryModuleUrl } from './_test-module-loader.mjs'

const { evaluateDeploymentBoundary } = await import(deploymentBoundaryModuleUrl)
const load = async file => import('data:text/javascript;base64,' + Buffer.from(
  inlineSharedApiImports(await readFile(new URL(file, import.meta.url), 'utf8')),
).toString('base64') + `#cron-release-${sequence++}`)
let sequence = 0
const { releasedCron, cronDeploymentIdentity } = await load('_cron-release.js')
const { default: identityHandler } = await load('deployment-identity.js')
const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'))
const APP = 'https://www.illinimarket.com'
const PROJECT = 'abcdefghijklmnopqrst'
const SHA = 'a'.repeat(40)
const ID = 'dpl_Candidate01'
const SECRET = 'synthetic-cron-secret'
const NONCE = '11111111-1111-4111-8111-111111111111'
const BASE = {
  VERCEL: '1', VERCEL_ENV: 'production', VERCEL_URL: 'candidate.vercel.app',
  VERCEL_DEPLOYMENT_ID: ID, VERCEL_GIT_COMMIT_SHA: SHA,
  DEPLOYMENT_EXPECTED_VERCEL_ENV: 'production', DEPLOYMENT_APP_ORIGIN: APP,
  SUPABASE_EXPECTED_PROJECT_REF: PROJECT, SUPABASE_URL: `https://${PROJECT}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key', SUPABASE_ANON_KEY: 'synthetic-anon-key',
  CRON_SECRET: SECRET, SENTRY_DSN: 'https://public123@o99.ingest.us.sentry.io/4507',
  SENTRY_CRON_MONITORS: 'background-jobs,notification-digest,data-retention,banner-upload-gc,delete-account',
}
const names = [...Object.keys(BASE), 'VITE_SUPABASE_URL', 'SUPABASE_SECRET_KEY',
  'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY',
  'VITE_SENTRY_DSN', 'CAACI_LOCAL_DEV', 'CAACI_ENFORCE_DEPLOYMENT_BOUNDARY', 'NODE_ENV',
  'DIGEST_LIVE', 'DIGEST_TEST_EMAIL', 'RESEND_API_KEY']
const originalEnv = new Map(names.map(name => [name, process.env[name]]))
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  for (const [name, value] of originalEnv) value === undefined ? delete process.env[name] : process.env[name] = value
})
function setup(overrides = {}) {
  for (const name of names) delete process.env[name]
  Object.assign(process.env, BASE, overrides)
  return evaluateDeploymentBoundary({ supabaseUrl: process.env.SUPABASE_URL })
}
function req(path = '/api/background-jobs', overrides = {}) {
  return new Request(`https://candidate.vercel.app${path}`, {
    headers: { authorization: `Bearer ${SECRET}`, cookie: 'private-cookie', 'x-forwarded-host': 'evil.test' },
    ...overrides,
  })
}
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}
function identity(boundary, url, overrides = {}) {
  return { ...cronDeploymentIdentity(boundary), nonce: new URL(url).searchParams.get('nonce'), ...overrides }
}
async function blocked(boundary, expected = 'cron_release_unverified') {
  let ran = false
  const response = await releasedCron(req(), 'background-jobs', () => { ran = true }, boundary)
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
  assert.deepEqual(await response.json(), { error: expected })
  assert.equal(ran, false)
}

for (const { path } of config.crons) {
  test(`${path}: staged and same-commit redeploys cannot reach business or monitoring`, async () => {
    const boundary = setup({ DIGEST_LIVE: 'true', RESEND_API_KEY: 'synthetic-provider-key' })
    const { default: handler } = await load(path.slice('/api/'.length) + '.js')
    for (const current of [{ deploymentId: 'dpl_Older', commit: 'b'.repeat(40) }, { deploymentId: 'dpl_SameCommit' }]) {
      const calls = []
      globalThis.fetch = async (url, init) => {
        calls.push(String(url))
        assert.equal(new URL(url).origin, APP, 'no database/provider/Sentry request before promotion')
        assert.equal(new URL(url).pathname, '/api/deployment-identity')
        assert.equal(init.method, 'GET')
        assert.equal(init.redirect, 'manual')
        assert.equal(init.cache, 'no-store')
        assert.deepEqual(Object.keys(init.headers).sort(), ['Accept', 'Cache-Control'])
        assert.doesNotMatch(JSON.stringify(init.headers), /synthetic|private-cookie|evil\.test/)
        return json(identity(boundary, url, current))
      }
      const response = await handler(req(path))
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { error: 'cron_deployment_not_current' })
      assert.equal(calls.length, 1)
    }
  })
  test(`${path}: wrong or missing cron credentials cannot probe the public identity`, async () => {
    setup()
    const { default: handler } = await load(path.slice('/api/'.length) + '.js')
    let calls = 0
    globalThis.fetch = async () => { calls++; throw new Error('unexpected network') }
    for (const headers of [{}, { authorization: 'Bearer incorrect' }, { authorization: SECRET }]) {
      assert.equal((await handler(req(path, { headers }))).status, 401)
    }
    assert.equal(calls, 0)
  })
}

test('promotion, rollback and re-promotion are evaluated every invocation before monitoring/work', async () => {
  const boundary = setup()
  let currentId = 'dpl_Older'
  const events = []
  const nonces = []
  globalThis.fetch = async (url, init) => {
    if (new URL(url).origin === APP) {
      events.push('probe')
      nonces.push(new URL(url).searchParams.get('nonce'))
      return json(identity(boundary, url, { deploymentId: currentId }))
    }
    assert.equal(new URL(url).hostname, 'o99.ingest.us.sentry.io')
    events.push(JSON.parse(init.body.split('\n')[2]).status)
    return json({})
  }
  const run = async () => { events.push('work'); return json({ done: true }) }
  for (const [id, expected] of [['dpl_Older', 503], [ID, 200], ['dpl_Rollback', 503], [ID, 200]]) {
    currentId = id
    assert.equal((await releasedCron(req(), 'background-jobs', run, boundary)).status, expected)
  }
  assert.deepEqual(events, ['probe', 'probe', 'in_progress', 'work', 'ok', 'probe', 'probe', 'in_progress', 'work', 'ok'])
  assert.equal(new Set(nonces).size, 4)
})

test('release authorization is enforced even when Sentry is disabled', async () => {
  const boundary = setup({ SENTRY_CRON_MONITORS: '', SENTRY_DSN: '' })
  globalThis.fetch = async url => json(identity(boundary, url, { deploymentId: 'dpl_Older' }))
  await blocked(boundary, 'cron_deployment_not_current')
  globalThis.fetch = async url => json(identity(boundary, url))
  const expected = json({ done: true })
  assert.equal(await releasedCron(req(), 'background-jobs', async () => expected, boundary), expected)
})

test('matching current identity lets the real deletion recovery handler read its queue', async () => {
  const boundary = setup({ SENTRY_CRON_MONITORS: '' })
  const { default: handler } = await load('auth/delete-account.js')
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push(new URL(url).pathname)
    if (new URL(url).origin === APP) return json(identity(boundary, url))
    assert.equal(new URL(url).origin, BASE.SUPABASE_URL)
    assert.equal(new URL(url).pathname, '/rest/v1/account_deletion_jobs')
    assert.equal(init.headers.apikey, BASE.SUPABASE_SERVICE_ROLE_KEY)
    return json([])
  }
  const response = await handler(req('/api/auth/delete-account'))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { success: true, processed: 0, completed: 0, pending: 0 })
  assert.deepEqual(calls, ['/api/deployment-identity', '/rest/v1/account_deletion_jobs'])
})

test('missing or malformed runtime identities cannot fall back to a commit or local/test flags', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('unexpected network') }
  for (const overrides of [{ VERCEL_DEPLOYMENT_ID: '' }, { VERCEL_DEPLOYMENT_ID: '../candidate' },
    { VERCEL_GIT_COMMIT_SHA: '' }, { VERCEL_GIT_COMMIT_SHA: SHA.slice(0, 7) }]) {
    const boundary = setup({ ...overrides, CAACI_LOCAL_DEV: 'true' })
    assert.equal(boundary.environment, 'production')
    await blocked(boundary, 'cron_release_identity_missing')
  }
  assert.equal(calls, 0)
})

test('a production candidate cannot authorize itself by configuring its own app origin', async () => {
  for (const origin of ['https://candidate.vercel.app', 'https://evil.test']) {
    const boundary = setup({ DEPLOYMENT_APP_ORIGIN: origin })
    assert.equal(boundary.ok, true, 'the general deployment boundary permits exact operator-owned HTTPS origins')
    let calls = 0
    globalThis.fetch = async url => { calls++; return json(identity(boundary, url)) }
    await blocked(boundary, 'cron_release_identity_missing')
    assert.equal(calls, 0)
  }
})

test('existing root-domain app configuration verifies through the fixed www authority without redirects', async () => {
  const boundary = setup({ DEPLOYMENT_APP_ORIGIN: 'https://illinimarket.com', SENTRY_CRON_MONITORS: '' })
  let calls = 0
  globalThis.fetch = async (url, init) => {
    calls++
    assert.equal(new URL(url).origin, APP, 'root app links do not redirect or choose the release authority')
    assert.equal(init.redirect, 'manual')
    const response = await identityHandler(new Request(url))
    assert.equal(response.status, 200)
    return response
  }
  const expected = json({ done: true })
  assert.equal(await releasedCron(req(), 'background-jobs', async () => expected, boundary), expected)
  assert.equal(calls, 1)
})

for (const changes of [{ schema: 2 }, { environment: 'preview' }, { commit: 'b'.repeat(40) },
  { projectRef: 'z'.repeat(20) }, { appOrigin: 'https://evil.test' }, { deploymentId: undefined }]) {
  test(`canonical identity mismatch fails closed: ${Object.keys(changes)[0]}`, async () => {
    const boundary = setup()
    globalThis.fetch = async url => json(identity(boundary, url, changes))
    await blocked(boundary, 'cron_deployment_not_current')
  })
}

for (const [label, makeResponse] of [
  ['legacy manifest', () => json({ schema: 1, commit: SHA })],
  ['replayed nonce', (boundary, url) => json(identity(boundary, url, { nonce: NONCE }))],
  ['HTML fallback', () => new Response('<html>app</html>', { headers: { 'Content-Type': 'text/html' } })],
  ['invalid JSON', () => new Response('{', { headers: { 'Content-Type': 'application/json' } })],
  ['HTTP failure', () => json({}, 503)],
  ['unexpected success status', (boundary, url) => json(identity(boundary, url), 201)],
  ['redirect', () => new Response(null, { status: 307, headers: { Location: 'https://evil.test' } })],
  ['oversized declared response', () => json({}, 200, { 'Content-Length': '5000' })],
  ['oversized streamed response', () => new Response('x'.repeat(4097), { headers: { 'Content-Type': 'application/json' } })],
  ['network failure', () => { throw new Error('private-upstream-detail') }],
]) {
  test(`unverifiable canonical response fails closed: ${label}`, async () => {
    const boundary = setup()
    let calls = 0
    globalThis.fetch = async url => { calls++; return makeResponse(boundary, url) }
    await blocked(boundary)
    assert.equal(calls, 1)
  })
}

test('probe timeout covers a body stalled after successful headers', async t => {
  const boundary = setup()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal
  globalThis.fetch = async (_url, init) => {
    signal = init.signal
    return new Response(new ReadableStream({
      start(controller) { signal.addEventListener('abort', () => controller.error(signal.reason), { once: true }) },
    }), { headers: { 'Content-Type': 'application/json' } })
  }
  const pending = blocked(boundary)
  while (!signal) await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(3001)
  await pending
  assert.equal(signal.aborted, true)
})

test('user deletion POST and OPTIONS do not require the cron identity probe', async () => {
  setup({ VERCEL_DEPLOYMENT_ID: '' })
  const { default: handler } = await load('auth/delete-account.js')
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('unexpected network') }
  assert.equal((await handler(req('/api/auth/delete-account', { method: 'OPTIONS' }))).status, 204)
  assert.equal((await handler(req('/api/auth/delete-account', { method: 'POST', headers: {} }))).status, 401)
  assert.equal(calls, 0)
})

test('authenticated user deletion reaches its existing preparation flow without cron deployment identity', async () => {
  setup({ VERCEL_DEPLOYMENT_ID: '' })
  const { default: handler } = await load('auth/delete-account.js')
  const uid = '11111111-1111-4111-8111-111111111111'
  const calls = []
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).origin, BASE.SUPABASE_URL, 'user POST does not probe or report a cron check-in')
    calls.push(new URL(url).pathname)
    if (new URL(url).pathname === '/auth/v1/user') {
      assert.equal(init.headers.Authorization, 'Bearer synthetic-user-token')
      return json({ id: uid })
    }
    assert.equal(new URL(url).pathname, '/rest/v1/rpc/admin_prepare_account_deletion')
    assert.deepEqual(JSON.parse(init.body), { p_user_id: uid })
    return json({ ready: false, reason: 'admin_recovery_transfer_required', job: null })
  }
  const response = await handler(req('/api/auth/delete-account', {
    method: 'POST', headers: { authorization: 'Bearer synthetic-user-token', 'Content-Type': 'application/json' },
    body: '{}',
  }))
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), { error: 'admin_recovery_transfer_required' })
  assert.deepEqual(calls, ['/auth/v1/user', '/rest/v1/rpc/admin_prepare_account_deletion'])
})

test('identity endpoint exposes only validated public metadata and echoes a fresh nonce without upstream work', async () => {
  const boundary = setup()
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('unexpected network') }
  const response = await identityHandler(new Request(`${APP}/api/deployment-identity?nonce=${NONCE}`))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
  assert.equal(response.headers.get('cdn-cache-control'), 'no-store')
  assert.equal(response.headers.get('vercel-cdn-cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { ...cronDeploymentIdentity(boundary), nonce: NONCE })
  assert.equal(calls, 0)
})

test('identity endpoint rejects missing/duplicate/non-random nonce, non-GET and missing runtime identity', async () => {
  setup()
  for (const query of ['', '?nonce=not-a-nonce', `?nonce=${NONCE}&nonce=${NONCE}`]) {
    assert.equal((await identityHandler(new Request(`${APP}/api/deployment-identity${query}`))).status, 400)
  }
  assert.equal((await identityHandler(new Request(`${APP}/api/deployment-identity?nonce=${NONCE}`, { method: 'POST' }))).status, 405)
  delete process.env.VERCEL_DEPLOYMENT_ID
  assert.equal((await identityHandler(new Request(`${APP}/api/deployment-identity?nonce=${NONCE}`))).status, 503)
})

test('preview cannot supply a production identity and its existing isolated worker behavior is preserved', async () => {
  const boundary = setup({ VERCEL_ENV: 'preview', DEPLOYMENT_EXPECTED_VERCEL_ENV: 'preview', DEPLOYMENT_APP_ORIGIN: 'https://candidate.vercel.app' })
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('unexpected network') }
  assert.equal(cronDeploymentIdentity(boundary), null)
  assert.equal((await identityHandler(new Request(`${APP}/api/deployment-identity?nonce=${NONCE}`))).status, 503)
  const expected = json({ isolated: true })
  assert.equal(await releasedCron(req(), 'background-jobs', async () => expected, boundary), expected)
  assert.equal(calls, 0)
})
