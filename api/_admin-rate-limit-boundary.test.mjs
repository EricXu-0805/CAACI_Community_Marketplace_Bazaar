// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'

const API_URL = new URL('./admin/index.js', import.meta.url)
const ENV_KEYS = [
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
  'SENTRY_DSN', 'VITE_SENTRY_DSN',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
let importNonce = 0
const ADMIN_TOKEN = `iam_admin_${'a'.repeat(43)}`
const AUTH_SERVER_NOW = '2026-07-20T00:00:00Z'
const BANNER_UPLOAD_KEY = '22222222-2222-4222-8222-222222222222'
const MANAGED_BANNER_URL = `https://supabase.test/storage/v1/object/public/banners/managed/11111111-1111-4111-8111-111111111111/${BANNER_UPLOAD_KEY}/${'a'.repeat(64)}.png`

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
})

async function loadHandler(extraEnv = {}, transformSource = source => source) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    ...extraEnv,
  })
  const source = transformSource(await readFile(API_URL, 'utf8'))
  const encoded = Buffer.from(inlineDeploymentBoundaryImport(source)).toString('base64')
  return (await import(`data:text/javascript;base64,${encoded}#admin-rate-${importNonce++}`)).default
}

async function multipartAdminRequest(form, extraHeaders = {}) {
  const prepared = new Request('https://app.test/api/admin', {
    method: 'POST',
    body: form,
  })
  const bytes = await prepared.arrayBuffer()
  return new Request('https://app.test/api/admin', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'Content-Type': prepared.headers.get('content-type'),
      'Content-Length': String(bytes.byteLength),
      'Idempotency-Key': BANNER_UPLOAD_KEY,
      ...extraHeaders,
    },
    body: bytes,
  })
}

test('admin audit monitoring sends only a stable error code, never a PostgREST message', async () => {
  const sentryBodies = []
  const privateMessage = 'row for victim@example.com contains secret appeal text'
  const originalWarn = console.warn
  console.warn = () => {}
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') {
        return new Response('true', { status: 200 })
      }
      if (url.pathname === '/rest/v1/rpc/admin_token_authorization_v2') {
        return new Response(JSON.stringify([{
          token_id: '11111111-1111-4111-8111-111111111111',
          admin_id: '11111111-1111-4111-8111-111111111111',
          admin_name: 'Admin',
          admin_email: 'admin@example.com',
          role: 'owner',
          expires_at: null,
          server_now: AUTH_SERVER_NOW,
          capabilities: ['apply_ban', 'lift_suspension', 'decide_appeal', 'update_report_status', 'resolve_target_reports', 'takedown_content', 'set_post_pinned', 'upsert_banner', 'delete_banner', 'upload_banner', 'revoke_token', 'issue_token', 'revoke_admin_tokens'],
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.pathname === '/rest/v1/rpc/record_audit') {
        return new Response(JSON.stringify({ message: privateMessage }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.hostname === 'sentry.test') {
        sentryBodies.push(String(init.body || ''))
        return new Response('', { status: 200 })
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const handler = await loadHandler({ SENTRY_DSN: 'https://public@sentry.test/123' })
    const response = await handler(new Request('https://app.test/api/admin?resource=whoami', {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    }))

    assert.equal(response.status, 200)
    assert.equal(sentryBodies.length, 1)
    assert.equal(sentryBodies[0].includes(privateMessage), false)
    assert.match(sentryBodies[0], /"error_code":"postgrest_500"/)
  } finally {
    console.warn = originalWarn
  }
})

test('admin limiter stores a trusted-header, service-secret HMAC rather than an IP digest', async () => {
  const limiterBodies = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/rest/v1/rpc/edge_rate_hit') {
      limiterBodies.push(JSON.parse(init.body))
      return new Response('true', { status: 200 })
    }
    if (url.pathname === '/rest/v1/rpc/admin_token_authorization_v2') {
      return new Response('[]', { status: 200 })
    }
    if (url.pathname === '/rest/v1/rpc/record_audit') {
      return new Response('null', { status: 200 })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const handler = await loadHandler()

  const response = await handler(new Request('https://app.test/api/admin', {
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'x-vercel-forwarded-for': '203.0.113.20',
      'x-forwarded-for': '198.51.100.77',
    },
  }))

  assert.equal(response.status, 401)
  assert.equal(limiterBodies.length, 2)
  const expected = createHmac('sha256', 'service-key')
    .update('admin-rate-network:v1\u0000203.0.113.20')
    .digest('hex')
  assert.equal(limiterBodies[0].bucket_in, `admin:network:${expected}`)
  assert.doesNotMatch(limiterBodies[0].bucket_in, /203\.0\.113\.20|198\.51\.100\.77/)
  assert.notEqual(
    limiterBodies[0].bucket_in,
    `admin:network:${createHash('sha256').update('203.0.113.20').digest('hex')}`,
  )
  assert.deepEqual(limiterBodies[1], {
    bucket_in: `admin:unauthorized-audit:${expected}`,
    max_in: 1,
    window_secs_in: 3600,
  })
  assert.doesNotMatch(limiterBodies[1].bucket_in, /203\.0\.113\.20|198\.51\.100\.77/)
})

test('unauthorized audit sampling fails closed without changing the 401 decision', async () => {
  for (const auditLimiter of [
    () => new Response('false', { status: 200 }),
    () => new Response('null', { status: 200 }),
    () => new Response('{"error":"down"}', { status: 503 }),
    () => { throw new Error('audit limiter down') },
  ]) {
    const paths = []
    let limiterCalls = 0
    globalThis.fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      paths.push(url.pathname)
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') {
        limiterCalls++
        if (limiterCalls === 1) return new Response('true', { status: 200 })
        return auditLimiter()
      }
      if (url.pathname === '/rest/v1/rpc/admin_token_authorization_v2') {
        return new Response('[]', { status: 200 })
      }
      if (url.pathname === '/rest/v1/rpc/record_audit') {
        throw new Error('suppressed unauthorized audit must not append')
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const handler = await loadHandler()
    const response = await handler(new Request('https://app.test/api/admin', {
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        'x-vercel-forwarded-for': '203.0.113.20',
      },
    }))

    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { error: 'unauthorized' })
    assert.deepEqual(paths, [
      '/rest/v1/rpc/edge_rate_hit',
      '/rest/v1/rpc/admin_token_authorization_v2',
      '/rest/v1/rpc/edge_rate_hit',
    ])
  }
})

test('admin trims deployment environment values before using secrets in headers and HMACs', async () => {
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push({ url, init })
    if (url.pathname === '/rest/v1/rpc/edge_rate_hit') {
      return new Response('true', { status: 200 })
    }
    if (url.pathname === '/rest/v1/rpc/admin_token_authorization_v2') {
      return new Response('[]', { status: 200 })
    }
    if (url.pathname === '/rest/v1/rpc/record_audit') {
      return new Response('null', { status: 200 })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const handler = await loadHandler({
    SUPABASE_URL: '  https://supabase.test\n',
    SUPABASE_SECRET_KEY: '  sb_secret_fake\n',
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-must-not-win',
  })

  const response = await handler(new Request('https://app.test/api/admin', {
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'x-vercel-forwarded-for': '203.0.113.20',
    },
  }))

  assert.equal(response.status, 401)
  const limiter = calls.find(call => call.url.pathname === '/rest/v1/rpc/edge_rate_hit')
  assert.ok(limiter)
  assert.equal(limiter.url.origin, 'https://supabase.test')
  assert.equal(limiter.init.headers.apikey, 'sb_secret_fake')
  assert.equal(limiter.init.headers.Authorization, undefined)
  const expected = createHmac('sha256', 'sb_secret_fake')
    .update('admin-rate-network:v1\u0000203.0.113.20')
    .digest('hex')
  assert.equal(JSON.parse(limiter.init.body).bucket_in, `admin:network:${expected}`)
})

test('admin falls back after trimming whitespace-only primary environment values', async () => {
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push({ url, init })
    if (url.pathname === '/rest/v1/rpc/edge_rate_hit') {
      return new Response('true', { status: 200 })
    }
    if (url.pathname === '/rest/v1/rpc/admin_token_authorization_v2') {
      return new Response('[]', { status: 200 })
    }
    if (url.pathname === '/rest/v1/rpc/record_audit') {
      return new Response('null', { status: 200 })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const handler = await loadHandler({
    SUPABASE_URL: ' \n',
    VITE_SUPABASE_URL: '  https://supabase.test\n',
    SUPABASE_SECRET_KEY: ' \n',
    SUPABASE_SERVICE_ROLE_KEY: '  legacy-fallback\n',
  })

  const response = await handler(new Request('https://app.test/api/admin', {
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'x-vercel-forwarded-for': '203.0.113.20',
    },
  }))

  assert.equal(response.status, 401)
  const limiter = calls.find(call => call.url.pathname === '/rest/v1/rpc/edge_rate_hit')
  assert.ok(limiter)
  assert.equal(limiter.url.origin, 'https://supabase.test')
  assert.equal(limiter.init.headers.apikey, 'legacy-fallback')
  assert.equal(limiter.init.headers.Authorization, 'Bearer legacy-fallback')
  const expected = createHmac('sha256', 'legacy-fallback')
    .update('admin-rate-network:v1\u0000203.0.113.20')
    .digest('hex')
  assert.equal(JSON.parse(limiter.init.body).bucket_in, `admin:network:${expected}`)
})

test('malformed admin credentials are rejected before rate, auth, or audit providers', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    throw new Error('no provider should be reached')
  }
  const handler = await loadHandler()

  for (const headers of [
    {},
    { Authorization: 'Bearer random' },
    { Authorization: `Bearer ${ADMIN_TOKEN}x` },
    { Authorization: `Basic ${ADMIN_TOKEN}` },
    { Authorization: `Bearer ${ADMIN_TOKEN}`, 'x-admin-key': `iam_admin_${'b'.repeat(43)}` },
  ]) {
    const response = await handler(new Request('https://app.test/api/admin?resource=whoami', { headers }))
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { error: 'unauthorized' })
  }
  assert.deepEqual(calls, [])
})

test('admin rate-store failures fail closed before token authorization or audit', async () => {
  const cases = [
    () => { throw new Error('limiter down') },
    () => new Response('{"error":"down"}', { status: 503 }),
    () => new Response('null', { status: 200 }),
    () => new Response('{}', { status: 200 }),
    () => new Response('not-json', { status: 200 }),
    () => new Response('[]', { status: 200 }),
  ]
  const originalWarn = console.warn
  console.warn = () => {}
  try {
    for (const limiterResponse of cases) {
      const paths = []
      globalThis.fetch = async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        paths.push(url.pathname)
        if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return limiterResponse()
        throw new Error(`unexpected provider call ${url.pathname}`)
      }
      const handler = await loadHandler()
      const response = await handler(new Request('https://app.test/api/admin?resource=whoami', {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      }))
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable' })
      assert.deepEqual(paths, ['/rest/v1/rpc/edge_rate_hit'])
    }
  } finally {
    console.warn = originalWarn
  }
})

test('admin rate-store denial returns 429 without token authorization or audit', async () => {
  const paths = []
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    paths.push(url.pathname)
    if (url.pathname === '/rest/v1/rpc/edge_rate_hit') {
      return new Response('false', { status: 200 })
    }
    throw new Error(`unexpected provider call ${url.pathname}`)
  }
  const handler = await loadHandler()
  const response = await handler(new Request('https://app.test/api/admin?resource=whoami', {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  }))

  assert.equal(response.status, 429)
  assert.deepEqual(await response.json(), { error: 'rate_limited' })
  assert.deepEqual(paths, ['/rest/v1/rpc/edge_rate_hit'])
})

test('admin rejects limiter redirects without following them', async () => {
  const calls = []
  let redirectBodyCancelled = false
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push({ url, init })
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('redirect body must not be consumed'))
      },
      cancel() {
        redirectBodyCancelled = true
      },
    }), {
      status: 307,
      headers: { Location: 'https://redirect.test/limiter' },
    })
  }
  const handler = await loadHandler()
  const response = await handler(new Request('https://app.test/api/admin?resource=whoami', {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  }))

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable' })
  assert.deepEqual(calls.map(call => call.url.pathname), ['/rest/v1/rpc/edge_rate_hit'])
  assert.equal(calls[0].init.redirect, 'manual')
  assert.equal(redirectBodyCancelled, true)
})

async function authenticatedAdminFetch(calls) {
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push({ url, init })
    if (url.pathname === '/rest/v1/rpc/edge_rate_hit') {
      return new Response('true', { status: 200 })
    }
    if (url.pathname === '/rest/v1/rpc/admin_token_authorization_v2') {
      return new Response(JSON.stringify([{
        token_id: '11111111-1111-4111-8111-111111111111',
        admin_id: '11111111-1111-4111-8111-111111111111',
        admin_name: 'Admin',
        admin_email: 'admin@example.com',
        role: 'owner',
        expires_at: null,
        server_now: AUTH_SERVER_NOW,
        capabilities: ['apply_ban', 'lift_suspension', 'decide_appeal', 'update_report_status', 'resolve_target_reports', 'takedown_content', 'set_post_pinned', 'upsert_banner', 'delete_banner', 'upload_banner', 'revoke_token', 'issue_token', 'revoke_admin_tokens'],
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.pathname === '/rest/v1/rpc/record_audit') {
      return new Response('null', { status: 200 })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
}

for (const [name, type, bytes, error] of [
  ['active SVG', 'image/svg+xml', '<svg><script>alert(1)</script></svg>', 'unsupported_type'],
  ['animated GIF', 'image/gif', 'GIF89a', 'unsupported_type'],
  ['MIME-spoofed PNG', 'image/png', '<html>not a png</html>', 'invalid_image'],
]) {
  test(`admin banner upload rejects ${name} before public storage`, async () => {
    const calls = []
    globalThis.fetch = await authenticatedAdminFetch(calls)
    const handler = await loadHandler()
    const form = new FormData()
    form.append('file', new Blob([bytes], { type }), 'banner')

    const response = await handler(await multipartAdminRequest(form))

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error })
    assert.equal(calls.some(call => call.url.pathname.startsWith('/storage/v1/object/banners/')), false)
  })
}

function validPng(seed = 0, width = 1, height = 1) {
  // The edge only needs the fixed PNG signature + IHDR dimensions for this
  // transport-boundary test; the seed keeps otherwise valid fixtures distinct.
  const bytes = new Uint8Array(25)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  bytes[24] = seed
  return bytes
}

function bannerForm(bytes = validPng()) {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'image/png' }), 'banner.png')
  return form
}

test('banner upload requires a UUID idempotency key before preparing or writing storage', async () => {
  const calls = []
  globalThis.fetch = await authenticatedAdminFetch(calls)
  const handler = await loadHandler()
  const response = await handler(await multipartAdminRequest(bannerForm(), {
    'Idempotency-Key': 'not-a-uuid',
  }))

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'invalid_idempotency_key' })
  assert.equal(calls.some(call => call.url.pathname.includes('admin_prepare_banner_upload')), false)
  assert.equal(calls.some(call => call.url.pathname.startsWith('/storage/v1/object/banners/')), false)
})

test('banner prepare rejects a malformed or GC-owned 2xx before public storage', async () => {
  for (const mutate of [
    result => ({ ...result, status: 'gc_pending' }),
    result => ({ ...result, unexpected: true }),
  ]) {
    const calls = []
    const baseFetch = await authenticatedAdminFetch(calls)
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === '/rest/v1/rpc/admin_prepare_banner_upload') {
        calls.push({ url, init })
        const body = JSON.parse(init.body)
        const objectName = `managed/11111111-1111-4111-8111-111111111111/${BANNER_UPLOAD_KEY}/${body.p_content_hash}.png`
        return new Response(JSON.stringify(mutate({
          object_name: objectName,
          status: 'prepared',
        })), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return baseFetch(input, init)
    }
    const handler = await loadHandler()
    const response = await handler(await multipartAdminRequest(bannerForm()))
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'admin_outcome_unknown' })
    assert.equal(calls.some(call => call.url.pathname.startsWith('/storage/v1/object/banners/')), false)
  }
})

test('banner completion requires its exact prepared object and terminal status', async () => {
  for (const variant of ['wrong-object', 'wrong-status']) {
    const calls = []
    const baseFetch = await authenticatedAdminFetch(calls)
    let preparedObjectName = ''
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === '/rest/v1/rpc/admin_prepare_banner_upload') {
        calls.push({ url, init })
        const body = JSON.parse(init.body)
        preparedObjectName = `managed/11111111-1111-4111-8111-111111111111/${BANNER_UPLOAD_KEY}/${body.p_content_hash}.png`
        return new Response(JSON.stringify({
          object_name: preparedObjectName,
          status: 'prepared',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.pathname.startsWith('/storage/v1/object/banners/')) {
        calls.push({ url, init })
        return new Response('{}', { status: 200 })
      }
      if (url.pathname === '/rest/v1/rpc/admin_complete_banner_upload') {
        calls.push({ url, init })
        const objectName = variant === 'wrong-object'
          ? preparedObjectName.replace('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333')
          : preparedObjectName
        return new Response(JSON.stringify({
          object_name: objectName,
          status: variant === 'wrong-status' ? 'prepared' : 'available',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return baseFetch(input, init)
    }
    const handler = await loadHandler()
    const response = await handler(await multipartAdminRequest(bannerForm()))
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'admin_outcome_unknown' })
    assert.equal(calls.filter(call => call.url.pathname.startsWith('/storage/v1/object/banners/')).length, 1)
  }
})

test('lost completion response replays one fixed object path and required-audit completion', async () => {
  const calls = []
  const baseFetch = await authenticatedAdminFetch(calls)
  let objectName = ''
  const prepareBodies = []
  const completeBodies = []
  const storageHeaders = []
  const storagePaths = []
  let completeAttempt = 0
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/rest/v1/rpc/admin_prepare_banner_upload') {
      calls.push({ url, init })
      const body = JSON.parse(init.body)
      prepareBodies.push(body)
      objectName = `managed/11111111-1111-4111-8111-111111111111/${BANNER_UPLOAD_KEY}/${body.p_content_hash}.png`
      return new Response(JSON.stringify({ object_name: objectName, status: 'prepared' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.pathname.startsWith('/storage/v1/object/banners/')) {
      calls.push({ url, init })
      storagePaths.push(url.pathname)
      storageHeaders.push(new Headers(init.headers))
      return new Response('{}', { status: 200 })
    }
    if (url.pathname === '/rest/v1/rpc/admin_complete_banner_upload') {
      calls.push({ url, init })
      completeAttempt += 1
      completeBodies.push(JSON.parse(init.body))
      if (completeAttempt === 1) throw new Error('response_lost_after_required_audit_commit')
      return new Response(JSON.stringify({ object_name: objectName, status: 'available' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return baseFetch(input, init)
  }
  const handler = await loadHandler()

  const first = await handler(await multipartAdminRequest(bannerForm()))
  assert.equal(first.status, 503)
  assert.deepEqual(await first.json(), { error: 'admin_outcome_unknown' })

  const retry = await handler(await multipartAdminRequest(bannerForm()))
  assert.equal(retry.status, 200)
  assert.deepEqual(await retry.json(), {
    data: { url: `https://supabase.test/storage/v1/object/public/banners/${objectName}` },
  })
  assert.equal(prepareBodies.length, 2)
  assert.equal(completeBodies.length, 2)
  assert.deepEqual(storagePaths, [storagePaths[0], storagePaths[0]])
  assert.equal(storageHeaders.every(headers => headers.get('x-upsert') === 'true'), true)
  assert.equal(prepareBodies[0].p_idempotency_key, BANNER_UPLOAD_KEY)
  assert.equal(prepareBodies[1].p_idempotency_key, BANNER_UPLOAD_KEY)
  assert.equal(prepareBodies[0].p_content_hash, prepareBodies[1].p_content_hash)
  assert.equal(prepareBodies[0].p_size_bytes, validPng().byteLength)
  assert.equal(prepareBodies[0].p_mime_type, 'image/png')
  assert.equal(completeBodies[0].p_content_hash, prepareBodies[0].p_content_hash)
})

test('same upload key with different file bytes maps DB conflict without a second storage write', async () => {
  const calls = []
  const baseFetch = await authenticatedAdminFetch(calls)
  let objectName = ''
  let prepareAttempt = 0
  let storageWrites = 0
  let firstHash = ''
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/rest/v1/rpc/admin_prepare_banner_upload') {
      prepareAttempt += 1
      const body = JSON.parse(init.body)
      if (prepareAttempt === 1) {
        firstHash = body.p_content_hash
        objectName = `managed/11111111-1111-4111-8111-111111111111/${BANNER_UPLOAD_KEY}/${firstHash}.png`
        return new Response(JSON.stringify({ object_name: objectName, status: 'prepared' }), { status: 200 })
      }
      assert.notEqual(body.p_content_hash, firstHash)
      return new Response(JSON.stringify({ code: '22023', message: 'idempotency_conflict' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.pathname.startsWith('/storage/v1/object/banners/')) {
      storageWrites += 1
      return new Response('{}', { status: 200 })
    }
    if (url.pathname === '/rest/v1/rpc/admin_complete_banner_upload') {
      return new Response(JSON.stringify({ object_name: objectName, status: 'available' }), { status: 200 })
    }
    return baseFetch(input, init)
  }
  const handler = await loadHandler()

  const first = await handler(await multipartAdminRequest(bannerForm(validPng(1))))
  assert.equal(first.status, 200)
  const conflict = await handler(await multipartAdminRequest(bannerForm(validPng(2))))
  assert.equal(conflict.status, 409)
  assert.deepEqual(await conflict.json(), { error: 'idempotency_conflict' })
  assert.equal(storageWrites, 1)
})

function webpDimensions(width, height) {
  const bytes = new Uint8Array(30)
  bytes.set(new TextEncoder().encode('RIFF'), 0)
  bytes.set(new TextEncoder().encode('WEBP'), 8)
  bytes.set(new TextEncoder().encode('VP8X'), 12)
  const encodedWidth = width - 1
  const encodedHeight = height - 1
  bytes.set([encodedWidth & 0xff, (encodedWidth >> 8) & 0xff, (encodedWidth >> 16) & 0xff], 24)
  bytes.set([encodedHeight & 0xff, (encodedHeight >> 8) & 0xff, (encodedHeight >> 16) & 0xff], 27)
  return bytes
}

function jpegDimensions(width, height) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x08, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x00,
  ])
}

for (const [name, type, bytes] of [
  ['PNG edge', 'image/png', validPng(0, 8193, 1)],
  ['WebP edge', 'image/webp', webpDimensions(8193, 1)],
  ['JPEG edge', 'image/jpeg', jpegDimensions(8193, 1)],
]) {
  test(`banner upload rejects extreme ${name} dimensions before prepare or storage`, async () => {
    const calls = []
    globalThis.fetch = await authenticatedAdminFetch(calls)
    const handler = await loadHandler()
    const form = new FormData()
    form.append('file', new Blob([bytes], { type }), `banner.${type.split('/')[1]}`)

    const response = await handler(await multipartAdminRequest(form))

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {
      error: 'invalid_image_dimensions',
      max_dimension: 8192,
      max_pixels: 24_000_000,
    })
    assert.equal(calls.some(call => call.url.pathname.includes('admin_prepare_banner_upload')), false)
    assert.equal(calls.some(call => call.url.pathname.startsWith('/storage/v1/object/banners/')), false)
  })
}

test('banner upload returns 413 when the decoded file exceeds 2 MiB', async () => {
  const calls = []
  globalThis.fetch = await authenticatedAdminFetch(calls)
  const handler = await loadHandler()
  const oversized = new Uint8Array(2 * 1024 * 1024 + 1)
  oversized.set(validPng(), 0)
  const form = new FormData()
  form.append('file', new Blob([oversized], { type: 'image/png' }), 'banner.png')

  const response = await handler(await multipartAdminRequest(form))

  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), { error: 'too_large', max: 2 * 1024 * 1024 })
  assert.equal(calls.some(call => call.url.pathname.includes('admin_prepare_banner_upload')), false)
  assert.equal(calls.some(call => call.url.pathname.startsWith('/storage/v1/object/banners/')), false)
})

test('admin banner targets reject HTTP and non-route schemes before database writes', async () => {
  for (const target of ['http://example.com/promo', 'javascript:alert(1)', '//example.com/promo', '../login']) {
    const calls = []
    globalThis.fetch = await authenticatedAdminFetch(calls)
    const handler = await loadHandler()

    const response = await handler(new Request('https://app.test/api/admin', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'upsert_banner',
        image_url: MANAGED_BANNER_URL,
        target_url: target,
      }),
    }))

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'invalid_target_url' })
    assert.equal(calls.some(call => call.url.pathname === '/rest/v1/banners'), false)
  }
})

test('malformed admin pagination falls back to bounded numeric RPC arguments', async () => {
  const rpcBodies = []
  const calls = []
  const baseFetch = await authenticatedAdminFetch(calls)
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/rest/v1/rpc/admin_list_suspensions') {
      rpcBodies.push(JSON.parse(init.body))
      return new Response('[]', { status: 200 })
    }
    return baseFetch(input, init)
  }
  const handler = await loadHandler()

  const response = await handler(new Request(
    'https://app.test/api/admin?resource=suspensions&limit=not-a-number&offset=-5',
    { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } },
  ))

  assert.equal(response.status, 200)
  assert.deepEqual(rpcBodies, [{ limit_in: 50, offset_in: 0, active_only_in: false }])
  assert.equal(calls.every(call => call.init.redirect === 'manual'), true)
  assert.equal(calls.every(call => call.init.signal instanceof AbortSignal), true)
})

test('admin JSON and multipart bodies are admitted only through bounded request streams', async () => {
  const calls = []
  globalThis.fetch = await authenticatedAdminFetch(calls)
  const handler = await loadHandler()

  const oversizedJson = await handler(new Request('https://app.test/api/admin', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': String(64 * 1024 + 1),
    },
    body: '{}',
  }))
  assert.equal(oversizedJson.status, 413)
  assert.deepEqual(await oversizedJson.json(), { error: 'body_too_large', max: 64 * 1024 })

  const form = new FormData()
  form.append('file', new Blob(['GIF89a'], { type: 'image/gif' }), 'banner.gif')
  const missingLength = await handler(new Request('https://app.test/api/admin', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'Idempotency-Key': BANNER_UPLOAD_KEY,
    },
    body: form,
  }))
  assert.equal(missingLength.status, 411)
  assert.deepEqual(await missingLength.json(), { error: 'content_length_required' })
  assert.equal(calls.some(call => call.url.pathname.startsWith('/storage/v1/object/banners/')), false)
})

test('admin aborts a hanging provider and returns a stable timeout truth', async () => {
  let aborted = false
  const calls = []
  const baseFetch = await authenticatedAdminFetch(calls)
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/rest/v1/rpc/admin_dashboard_stats') {
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          aborted = true
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    }
    return baseFetch(input, init)
  }
  const handler = await loadHandler({}, source => source.replace(
    'const UPSTREAM_TIMEOUT_MS = 5000',
    'const UPSTREAM_TIMEOUT_MS = 25',
  ))

  const response = await handler(new Request('https://app.test/api/admin?resource=stats', {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  }))

  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'admin_upstream_timeout' })
  assert.equal(aborted, true)
})

test('admin authentication outages are 503, never false invalid-token 401s', async () => {
  const calls = []
  const originalWarn = console.warn
  console.warn = () => {}
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      calls.push({ url, init })
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') {
        return new Response('true', { status: 200 })
      }
      if (url.pathname === '/rest/v1/rpc/admin_token_authorization_v2') {
        return new Response('{"message":"provider private detail"}', { status: 503 })
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const handler = await loadHandler()

    const response = await handler(new Request('https://app.test/api/admin?resource=whoami', {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    }))

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'auth_unavailable' })
    assert.equal(calls.some(call => call.url.pathname === '/rest/v1/rpc/record_audit'), false)
  } finally {
    console.warn = originalWarn
  }
})

test('admin rejects authorization redirects without following or auditing them', async () => {
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push({ url, init })
    if (url.pathname === '/rest/v1/rpc/edge_rate_hit') {
      return new Response('true', { status: 200 })
    }
    if (url.pathname === '/rest/v1/rpc/admin_token_authorization_v2') {
      return new Response('', {
        status: 307,
        headers: { Location: 'https://redirect.test/auth' },
      })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const handler = await loadHandler()
  const response = await handler(new Request('https://app.test/api/admin?resource=whoami', {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  }))

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'auth_unavailable' })
  assert.deepEqual(calls.map(call => call.url.pathname), [
    '/rest/v1/rpc/edge_rate_hit',
    '/rest/v1/rpc/admin_token_authorization_v2',
  ])
  assert.equal(calls.every(call => call.init.redirect === 'manual'), true)
})

test('admin reports destructive mutation redirects as outcome unknown without following them', async () => {
  const calls = []
  const baseFetch = await authenticatedAdminFetch(calls)
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/rest/v1/rpc/admin_execute_mutation') {
      calls.push({ url, init })
      return new Response('', {
        status: 307,
        headers: { Location: 'https://redirect.test/mutation' },
      })
    }
    return baseFetch(input, init)
  }
  const handler = await loadHandler()
  const response = await handler(new Request('https://app.test/api/admin', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': BANNER_UPLOAD_KEY,
    },
    body: JSON.stringify({
      action: 'set_post_pinned',
      post_id: '11111111-1111-4111-8111-111111111111',
      pinned: true,
    }),
  }))

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'admin_outcome_unknown' })
  assert.equal(calls.filter(call => call.url.pathname === '/rest/v1/rpc/admin_execute_mutation').length, 1)
  assert.equal(calls.some(call => call.url.hostname === 'redirect.test'), false)
  assert.equal(calls.every(call => call.init.redirect === 'manual'), true)
})

test('admin deadline includes a stalled response body and cancels its stream', async () => {
  let cancelled = false
  const calls = []
  const baseFetch = await authenticatedAdminFetch(calls)
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/rest/v1/rpc/admin_dashboard_stats') {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('['))
        },
        cancel() {
          cancelled = true
        },
      }), { status: 200 })
    }
    return baseFetch(input, init)
  }
  const handler = await loadHandler({}, source => source.replace(
    'const UPSTREAM_TIMEOUT_MS = 5000',
    'const UPSTREAM_TIMEOUT_MS = 25',
  ))

  const response = await handler(new Request('https://app.test/api/admin?resource=stats', {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  }))

  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'admin_upstream_timeout' })
  assert.equal(cancelled, true)
})

test('admin rejects oversized provider responses before materializing them', async () => {
  const calls = []
  const baseFetch = await authenticatedAdminFetch(calls)
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/rest/v1/rpc/admin_dashboard_stats') {
      return new Response('[]', {
        status: 200,
        headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) },
      })
    }
    return baseFetch(input, init)
  }
  const handler = await loadHandler()

  const response = await handler(new Request('https://app.test/api/admin?resource=stats', {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  }))

  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'admin_upstream_response_too_large' })
})
