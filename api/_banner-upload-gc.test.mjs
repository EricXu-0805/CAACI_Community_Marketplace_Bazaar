// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'

const API_URL = new URL('./banner-upload-gc.js', import.meta.url)
const CRON_SECRET = 'banner-gc-cron-secret'
const SERVICE_KEY = 'banner-gc-service-key'
const ENV_KEYS = [
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const originalConsoleError = console.error
let importNonce = 0

const OBJECT_NAME = `managed/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/${'a'.repeat(64)}.png`

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
  console.error = originalConsoleError
})

async function loadHandler(overrides = {}) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    CRON_SECRET,
    ...overrides,
  })
  const source = await readFile(API_URL, 'utf8')
  const encoded = Buffer.from(inlineDeploymentBoundaryImport(source)).toString('base64')
  return (await import(`data:text/javascript;base64,${encoded}#banner-gc-${importNonce++}`)).default
}

function request({ method = 'GET', secret = CRON_SECRET } = {}) {
  return new Request('https://app.test/api/banner-upload-gc', {
    method,
    headers: secret == null ? {} : { Authorization: `Bearer ${secret}` },
  })
}

function response(payload, status = 200) {
  return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('Vercel schedules one staggered hourly banner upload GC run', async () => {
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'))
  assert.deepEqual(vercel.crons.filter(cron => cron.path === '/api/banner-upload-gc'), [{
    path: '/api/banner-upload-gc',
    schedule: '37 * * * *',
  }])
})

test('rejects non-GET, missing configuration, and bad cron credentials before provider calls', async () => {
  for (const [overrides, req, status] of [
    [{}, request({ method: 'POST' }), 405],
    [{ SUPABASE_URL: '' }, request(), 503],
    [{ CRON_SECRET: '' }, request(), 503],
    [{}, request({ secret: 'wrong' }), 401],
    [{}, request({ secret: null }), 401],
  ]) {
    let calls = 0
    globalThis.fetch = async () => { calls += 1; return response({}) }
    const handler = await loadHandler(overrides)
    const result = await handler(req)
    assert.equal(result.status, status)
    assert.equal(calls, 0)
  }
})

test('no eligible objects returns a bounded successful no-op', async () => {
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: new URL(String(input)), init, headers: new Headers(init.headers) })
    return response({ object_names: [], has_more: false })
  }
  const handler = await loadHandler()
  const result = await handler(request())

  assert.equal(result.status, 200)
  assert.deepEqual(await result.json(), { success: true, deleted: 0, batches: 0 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url.pathname, '/rest/v1/rpc/admin_claim_banner_upload_gc')
  assert.equal(calls[0].headers.get('apikey'), SERVICE_KEY)
  assert.equal(calls[0].headers.get('authorization'), `Bearer ${SERVICE_KEY}`)
  const body = JSON.parse(calls[0].init.body)
  assert.match(body.p_claim_id, /^[0-9a-f-]{36}$/)
  assert.equal(body.p_limit, 25)
})

test('one lease deletes exact deterministic paths then commits the same claim', async () => {
  const calls = []
  let claimId = ''
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    const body = JSON.parse(init.body)
    calls.push({ url, init, body, headers: new Headers(init.headers) })
    if (url.pathname === '/rest/v1/rpc/admin_claim_banner_upload_gc') {
      claimId = body.p_claim_id
      return response({ object_names: [OBJECT_NAME], has_more: false })
    }
    if (url.pathname === '/storage/v1/object/banners') return response([])
    if (url.pathname === '/rest/v1/rpc/admin_complete_banner_upload_gc') return response(1)
    throw new Error(`unexpected ${url.pathname}`)
  }
  const handler = await loadHandler()
  const result = await handler(request())

  assert.equal(result.status, 200)
  assert.deepEqual(await result.json(), { success: true, deleted: 1, batches: 1 })
  assert.deepEqual(calls.map(call => call.url.pathname), [
    '/rest/v1/rpc/admin_claim_banner_upload_gc',
    '/storage/v1/object/banners',
    '/rest/v1/rpc/admin_complete_banner_upload_gc',
  ])
  assert.equal(calls[1].init.method, 'DELETE')
  assert.deepEqual(calls[1].body, { prefixes: [OBJECT_NAME] })
  assert.equal(calls[2].body.p_claim_id, claimId)
  assert.deepEqual(calls[2].body.p_object_names, [OBJECT_NAME])
})

test('lost DB completion response never reports success and storage deletion is replay-safe', async () => {
  let invocation = 0
  const deletedBodies = []
  console.error = () => {}
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    if (url.pathname === '/rest/v1/rpc/admin_claim_banner_upload_gc') {
      invocation += 1
      return response({ object_names: [OBJECT_NAME], has_more: false })
    }
    if (url.pathname === '/storage/v1/object/banners') {
      deletedBodies.push(JSON.parse(init.body))
      return response([])
    }
    if (url.pathname === '/rest/v1/rpc/admin_complete_banner_upload_gc') {
      if (invocation === 1) throw new Error('completion_response_lost')
      return response(1)
    }
    throw new Error(`unexpected ${url.pathname}`)
  }
  const handler = await loadHandler()

  const first = await handler(request())
  assert.equal(first.status, 503)
  assert.deepEqual(await first.json(), {
    success: false,
    error: 'banner_gc_unavailable',
    deleted: 0,
    batches: 0,
  })
  const retry = await handler(request())
  assert.equal(retry.status, 200)
  assert.deepEqual(deletedBodies, [
    { prefixes: [OBJECT_NAME] },
    { prefixes: [OBJECT_NAME] },
  ])
})

test('storage failure leaves the lease pending and never calls DB completion', async () => {
  let completionCalls = 0
  console.error = () => {}
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/rest/v1/rpc/admin_claim_banner_upload_gc') {
      return response({ object_names: [OBJECT_NAME], has_more: false })
    }
    if (url.pathname === '/storage/v1/object/banners') {
      return response({ private: 'provider detail' }, 500)
    }
    if (url.pathname === '/rest/v1/rpc/admin_complete_banner_upload_gc') {
      completionCalls += 1
      return response(1)
    }
    throw new Error(`unexpected ${url.pathname}`)
  }
  const handler = await loadHandler()
  const result = await handler(request())

  assert.equal(result.status, 503)
  assert.equal(result.headers.get('retry-after'), '600')
  assert.equal(completionCalls, 0)
  assert.deepEqual(await result.json(), {
    success: false,
    error: 'banner_gc_unavailable',
    deleted: 0,
    batches: 0,
  })
})

test('persistent eligible backlog is capped at three batches and remains retryable', async () => {
  let claims = 0
  console.error = () => {}
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/rest/v1/rpc/admin_claim_banner_upload_gc') {
      claims += 1
      return response({ object_names: [OBJECT_NAME], has_more: true })
    }
    if (url.pathname === '/storage/v1/object/banners') return response([])
    if (url.pathname === '/rest/v1/rpc/admin_complete_banner_upload_gc') return response(1)
    throw new Error(`unexpected ${url.pathname}`)
  }
  const handler = await loadHandler()
  const result = await handler(request())

  assert.equal(result.status, 503)
  assert.equal(claims, 3)
  assert.deepEqual(await result.json(), {
    success: false,
    error: 'banner_gc_backlog_pending',
    deleted: 3,
    batches: 3,
  })
})

test('malformed claim data and provider details stay opaque', async () => {
  const errors = []
  console.error = (...values) => errors.push(values)
  globalThis.fetch = async () => response({
    object_names: ['../../private'],
    has_more: false,
    email: 'victim@example.test',
  })
  const handler = await loadHandler()
  const result = await handler(request())

  assert.equal(result.status, 503)
  assert.doesNotMatch(JSON.stringify(await result.json()), /victim|private/)
  assert.doesNotMatch(JSON.stringify(errors), /victim@example|\.\.\/\.\.\/private/)
})
