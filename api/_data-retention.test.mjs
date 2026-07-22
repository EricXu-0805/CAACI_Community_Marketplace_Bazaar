// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'

const API_ROOT = new URL('./', import.meta.url)
const CRON_SECRET = 'cron-test-secret'
const SERVICE_KEY = 'service-test-key'
const ENV_KEYS = [
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET',
  'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const originalConsoleError = console.error
const originalSetTimeout = globalThis.setTimeout
const originalClearTimeout = globalThis.clearTimeout
const originalDateNow = Date.now
let importNonce = 0

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
  globalThis.clearTimeout = originalClearTimeout
  Date.now = originalDateNow
  console.error = originalConsoleError
})

async function loadApi(overrides = {}) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    CRON_SECRET,
    ...overrides,
  })
  const source = await readFile(new URL('data-retention.js', API_ROOT), 'utf8')
  const encoded = Buffer.from(inlineDeploymentBoundaryImport(source)).toString('base64')
  return import(`data:text/javascript;base64,${encoded}#data-retention-test-${importNonce++}`)
}

function request({ method = 'GET', authorization = `Bearer ${CRON_SECRET}` } = {}) {
  return new Request('https://app.test/api/data-retention', {
    method,
    headers: authorization == null ? {} : { Authorization: authorization },
  })
}

function rpcPayload(overrides = {}) {
  return [{
    edge_rate_limits_deleted: 3,
    illini_verifications_deleted: 2,
    wechat_media_checks_deleted: 1,
    has_more: false,
    ...overrides,
  }]
}

function response(data, status = 200) {
  return new Response(typeof data === 'string' ? data : JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function textResponse(data, status = 200) {
  return new Response(data, {
    status,
    headers: { 'Content-Type': 'text/plain' },
  })
}

test('Vercel schedules exactly one hourly retention run at a staggered minute', async () => {
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', API_ROOT), 'utf8'))
  const retentionCrons = vercel.crons.filter(cron => cron.path === '/api/data-retention')
  assert.deepEqual(retentionCrons, [{
    path: '/api/data-retention',
    schedule: '17 * * * *',
  }])
})

test('migration cleanup scope stays fixed to the three ephemeral relations', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20260718150000_ephemeral_data_retention.sql', API_ROOT),
    'utf8',
  )
  assert.match(migration, /FUNCTION public\.run_ephemeral_data_retention\(\)/)
  assert.match(migration, /pg_try_advisory_xact_lock\(1128358729, 1\)/)
  assert.match(migration, /v_batch_limit constant integer := 1000/)
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated, service_role/)
  for (const relation of [
    'edge_rate_limits',
    'illini_verifications',
    'wechat_media_checks',
  ]) {
    assert.match(migration, new RegExp(`DELETE FROM public\\.${relation}`))
  }
  assert.doesNotMatch(
    migration,
    /DELETE FROM public\.(reports|suspensions|admin_audit_log|account_deletion_jobs)/i,
  )
})

test('rejects non-GET methods without touching Supabase', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls += 1; return response(rpcPayload()) }
  const { default: handler } = await loadApi()
  const result = await handler(request({ method: 'POST' }))
  assert.equal(result.status, 405)
  assert.equal(result.headers.get('allow'), 'GET')
  assert.equal(calls, 0)
})

test('fails closed with Retry-After when required configuration is absent or malformed', async () => {
  for (const overrides of [
    { SUPABASE_URL: '' },
    { SUPABASE_SERVICE_ROLE_KEY: '' },
    { CRON_SECRET: '' },
    { SUPABASE_URL: 'ftp://supabase.test' },
    { SUPABASE_URL: 'not a url' },
  ]) {
    let calls = 0
    globalThis.fetch = async () => { calls += 1; return response(rpcPayload()) }
    const { default: handler } = await loadApi(overrides)
    const result = await handler(request())
    assert.equal(result.status, 503)
    assert.equal(result.headers.get('retry-after'), '600')
    assert.deepEqual(await result.json(), { error: 'not_configured' })
    assert.equal(calls, 0)
  }
})

test('requires an exact Bearer scheme and compares the cron secret before RPC', async () => {
  for (const authorization of [
    null,
    CRON_SECRET,
    `Basic ${CRON_SECRET}`,
    'Bearer wrong-secret',
    `Bearer  ${CRON_SECRET}`,
    `Bearer ${CRON_SECRET} extra`,
  ]) {
    let calls = 0
    globalThis.fetch = async () => { calls += 1; return response(rpcPayload()) }
    const { default: handler } = await loadApi()
    const result = await handler(request({ authorization }))
    assert.equal(result.status, 401)
    assert.equal(calls, 0)
  }
})

test('calls only the no-argument retention RPC with service credentials', async () => {
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: new URL(String(input)), init, headers: new Headers(init.headers) })
    return response(rpcPayload())
  }
  const { default: handler } = await loadApi()
  const result = await handler(request())

  assert.equal(result.status, 200)
  assert.equal(result.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await result.json(), {
    success: true,
    deleted: {
      edgeRateLimits: 3,
      illiniVerifications: 2,
      wechatMediaChecks: 1,
    },
    batches: 1,
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url.pathname, '/rest/v1/rpc/run_ephemeral_data_retention')
  assert.equal(calls[0].url.search, '')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.body, '{}')
  assert.equal(calls[0].init.redirect, 'manual')
  assert.equal(calls[0].headers.get('apikey'), SERVICE_KEY)
  assert.equal(calls[0].headers.get('authorization'), `Bearer ${SERVICE_KEY}`)
  assert.equal(calls[0].headers.get('content-type'), 'application/json')
  assert.ok(calls[0].init.signal instanceof AbortSignal)
})

test('caps a persistent backlog at five batches and fails retryably', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return response(rpcPayload({ has_more: true }))
  }
  const errors = []
  console.error = (...values) => errors.push(values)
  const { default: handler } = await loadApi()
  const result = await handler(request())

  assert.equal(result.status, 503)
  assert.equal(result.headers.get('retry-after'), '600')
  assert.deepEqual(await result.json(), {
    success: false,
    error: 'retention_backlog_pending',
    deleted: {
      edgeRateLimits: 15,
      illiniVerifications: 10,
      wechatMediaChecks: 5,
    },
    batches: 5,
  })
  assert.equal(calls, 5)
  assert.deepEqual(errors, [[
    '[data-retention] eligible backlog remains after capped batches',
  ]])
})

test('drains a bounded multi-batch backlog and aggregates minimal counts', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return response(rpcPayload({ has_more: calls < 3 }))
  }
  const { default: handler } = await loadApi()
  const result = await handler(request())

  assert.equal(result.status, 200)
  assert.deepEqual(await result.json(), {
    success: true,
    deleted: {
      edgeRateLimits: 9,
      illiniVerifications: 6,
      wechatMediaChecks: 3,
    },
    batches: 3,
  })
  assert.equal(calls, 3)
})

test('enforces the whole-run deadline between batches', async () => {
  let calls = 0
  let clockReads = 0
  Date.now = () => {
    clockReads += 1
    return clockReads <= 2 ? 0 : 20_001
  }
  globalThis.fetch = async () => {
    calls += 1
    return response(rpcPayload({ has_more: true }))
  }
  console.error = () => {}
  const { default: handler } = await loadApi()
  const result = await handler(request())

  assert.equal(result.status, 503)
  assert.equal(calls, 1)
  assert.deepEqual(await result.json(), {
    success: false,
    error: 'retention_unavailable',
    deleted: {
      edgeRateLimits: 3,
      illiniVerifications: 2,
      wechatMediaChecks: 1,
    },
    batches: 1,
  })
})

test('fails closed on RPC status/network errors without logging upstream PII', async () => {
  const failures = [
    async () => response('{"email":"victim@example.test"}', 500),
    async () => { throw new Error('victim@example.test network detail') },
  ]

  for (const fetchImpl of failures) {
    const errors = []
    console.error = (...values) => errors.push(values)
    globalThis.fetch = fetchImpl
    const { default: handler } = await loadApi()
    const result = await handler(request())
    assert.equal(result.status, 503)
    assert.equal(result.headers.get('retry-after'), '600')
    assert.deepEqual(await result.json(), {
      success: false,
      error: 'retention_unavailable',
      deleted: {
        edgeRateLimits: 0,
        illiniVerifications: 0,
        wechatMediaChecks: 0,
      },
      batches: 0,
    })
    const logged = JSON.stringify(errors)
    assert.doesNotMatch(logged, /victim@example\.test|service-test-key|cron-test-secret/)
  }
})

test('a later RPC failure reports prior bounded progress but never returns success', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    if (calls === 1) return response(rpcPayload({ has_more: true }))
    return response('{"trace_id":"private-trace"}', 502)
  }
  const errors = []
  console.error = (...values) => errors.push(values)
  const { default: handler } = await loadApi()
  const result = await handler(request())

  assert.equal(result.status, 503)
  assert.equal(calls, 2)
  assert.deepEqual(await result.json(), {
    success: false,
    error: 'retention_unavailable',
    deleted: {
      edgeRateLimits: 3,
      illiniVerifications: 2,
      wechatMediaChecks: 1,
    },
    batches: 1,
  })
  assert.doesNotMatch(JSON.stringify(errors), /private-trace/)
})

test('fails closed when the RPC response is malformed, oversized, or outside its contract', async () => {
  const invalidResponses = [
    response('not-json'),
    response([]),
    response([rpcPayload()[0], rpcPayload()[0]]),
    response([{ ...rpcPayload()[0], edge_rate_limits_deleted: -1 }]),
    response([{ ...rpcPayload()[0], illini_verifications_deleted: 1001 }]),
    response([{ ...rpcPayload()[0], wechat_media_checks_deleted: 1.5 }]),
    response([{ ...rpcPayload()[0], has_more: 'false' }]),
    textResponse(JSON.stringify(rpcPayload())),
    response(' '.repeat(16 * 1024 + 1)),
  ]

  for (const rpcResponse of invalidResponses) {
    console.error = () => {}
    globalThis.fetch = async () => rpcResponse
    const { default: handler } = await loadApi()
    const result = await handler(request())
    assert.equal(result.status, 503)
    assert.deepEqual(await result.json(), {
      success: false,
      error: 'retention_unavailable',
      deleted: {
        edgeRateLimits: 0,
        illiniVerifications: 0,
        wechatMediaChecks: 0,
      },
      batches: 0,
    })
  }
})

test('aborts a hanging RPC and returns a retryable failure', async () => {
  globalThis.setTimeout = callback => {
    queueMicrotask(callback)
    return 1
  }
  globalThis.clearTimeout = () => {}
  globalThis.fetch = async (_input, init = {}) => new Promise((resolve, reject) => {
    const rejectAbort = () => reject(new DOMException('aborted', 'AbortError'))
    if (init.signal?.aborted) rejectAbort()
    else init.signal?.addEventListener('abort', rejectAbort, { once: true })
  })
  console.error = () => {}
  const { default: handler } = await loadApi()
  const result = await handler(request())
  assert.equal(result.status, 503)
  assert.equal(result.headers.get('retry-after'), '600')
  assert.deepEqual(await result.json(), {
    success: false,
    error: 'retention_unavailable',
    deleted: {
      edgeRateLimits: 0,
      illiniVerifications: 0,
      wechatMediaChecks: 0,
    },
    batches: 0,
  })
})

test('the same timeout also bounds a stalled successful response body', async () => {
  globalThis.setTimeout = callback => {
    queueMicrotask(callback)
    return 1
  }
  globalThis.clearTimeout = () => {}
  globalThis.fetch = async (_input, init = {}) => new Response(
    new ReadableStream({
      start(controller) {
        const abort = () => controller.error(new DOMException('aborted', 'AbortError'))
        if (init.signal?.aborted) abort()
        else init.signal?.addEventListener('abort', abort, { once: true })
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
  console.error = () => {}
  const { default: handler } = await loadApi()
  const result = await handler(request())
  assert.equal(result.status, 503)
  assert.deepEqual(await result.json(), {
    success: false,
    error: 'retention_unavailable',
    deleted: {
      edgeRateLimits: 0,
      illiniVerifications: 0,
      wechatMediaChecks: 0,
    },
    batches: 0,
  })
})
