// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'

const API_ROOT = new URL('./', import.meta.url)
const USER_A = '11111111-1111-4111-8111-111111111111'
const TRUSTED_A = 'openid_trusted_A'
const CURRENT_B = 'openid_current_B'
const LEGACY_A = 'openid_legacy_A'
const ENV_KEYS = [
  'WECHAT_APPID', 'WECHAT_APPSECRET',
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
let importNonce = 0

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
})

async function loadHandler() {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, {
    WECHAT_APPID: 'wx-app',
    WECHAT_APPSECRET: 'wx-secret',
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    SUPABASE_ANON_KEY: 'anon-key',
  })
  const source = await readFile(new URL('wechat-seccheck.js', API_ROOT), 'utf8')
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(inlineDeploymentBoundaryImport(source)).toString('base64')}#wechat-openid-${importNonce++}`
  )
  return module.default
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function request(body) {
  return new Request('https://app.test/api/wechat-seccheck', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer caller-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ kind: 'text', content: 'hello', scene: 4, ...body }),
  })
}

function commonFetch(url) {
  if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
  if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
  if (url.pathname === '/cgi-bin/stable_token') {
    return json({ access_token: 'wechat-access-token', expires_in: 7200 })
  }
  return null
}

test('trusted JWT profile binding overrides a forged or stale client openid', async () => {
  let classifierBody = null
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push(url)
    const common = commonFetch(url)
    if (common) return common
    if (url.pathname === '/rest/v1/profiles') {
      assert.equal(url.searchParams.get('id'), `eq.${USER_A}`)
      assert.equal(url.searchParams.get('select'), 'wechat_openid')
      return json([{ wechat_openid: TRUSTED_A }])
    }
    if (url.pathname === '/wxa/msg_sec_check') {
      classifierBody = JSON.parse(String(init.body))
      return json({ errcode: 0, result: { suggest: 'pass' } })
    }
    throw new Error(`unexpected fetch ${url}`)
  }

  const handler = await loadHandler()
  const response = await handler(request({ openid: LEGACY_A, js_code: 'fresh_code_B' }))
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(classifierBody.openid, TRUSTED_A)
  assert.equal(calls.some(url => url.pathname === '/sns/jscode2session'), false)
  assert.deepEqual(payload, { ok: true, suggest: 'pass' })
  assert.equal(Object.hasOwn(payload, 'openid'), false)
})

test('unbound email account ignores cached openid and exchanges only the fresh js_code', async () => {
  let classifierBody = null
  let exchangedCode = null
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const common = commonFetch(url)
    if (common) return common
    if (url.pathname === '/rest/v1/profiles') return json([{ wechat_openid: null }])
    if (url.pathname === '/sns/jscode2session') {
      exchangedCode = url.searchParams.get('js_code')
      return json({ openid: CURRENT_B })
    }
    if (url.pathname === '/wxa/msg_sec_check') {
      classifierBody = JSON.parse(String(init.body))
      return json({ errcode: 0, result: { suggest: 'pass' } })
    }
    throw new Error(`unexpected fetch ${url}`)
  }

  const handler = await loadHandler()
  const response = await handler(request({ openid: LEGACY_A, js_code: 'fresh_code_B' }))
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(exchangedCode, 'fresh_code_B')
  assert.equal(classifierBody.openid, CURRENT_B)
  assert.equal(Object.hasOwn(payload, 'openid'), false)
})

test('profile lookup outage fails the identity boundary before any WeChat request', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push(url)
    const common = commonFetch(url)
    if (common) return common
    if (url.pathname === '/rest/v1/profiles') return json({ error: 'down' }, 503)
    throw new Error(`unexpected fetch ${url}`)
  }

  const handler = await loadHandler()
  const response = await handler(request({ openid: LEGACY_A, js_code: 'fresh_code_B' }))

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'wechat_identity_unavailable' })
  assert.equal(calls.some(url => url.hostname === 'api.weixin.qq.com'), false)
})

test('unbound account cannot fall back to a legacy client openid without a fresh code', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push(url)
    const common = commonFetch(url)
    if (common) return common
    if (url.pathname === '/rest/v1/profiles') return json([{ wechat_openid: null }])
    throw new Error(`unexpected fetch ${url}`)
  }

  const handler = await loadHandler()
  const response = await handler(request({ openid: LEGACY_A }))

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'wechat_identity_unavailable' })
  assert.equal(calls.some(url => url.hostname === 'api.weixin.qq.com'), false)
})

test('rejected one-time code never reaches the classifier or falls back to cached identity', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push(url)
    const common = commonFetch(url)
    if (common) return common
    if (url.pathname === '/rest/v1/profiles') return json([{ wechat_openid: null }])
    if (url.pathname === '/sns/jscode2session') {
      return json({ errcode: 40163, errmsg: 'code been used' })
    }
    throw new Error(`unexpected fetch ${url}`)
  }

  const handler = await loadHandler()
  const response = await handler(request({ openid: LEGACY_A, js_code: 'fresh_code_B' }))

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'wechat_identity_unavailable' })
  assert.equal(calls.some(url => url.pathname === '/wxa/msg_sec_check'), false)
  assert.equal(calls.some(url => url.pathname === '/cgi-bin/stable_token'), false)
})
