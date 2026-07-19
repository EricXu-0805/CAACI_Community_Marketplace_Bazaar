// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'

const MODULE_URL = new URL('./auth/wechat-login.js', import.meta.url)
const ENV_KEYS = [
  'WECHAT_APPID',
  'WECHAT_APPSECRET',
  'SUPABASE_URL',
  'VITE_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'WECHAT_USER_PASSWORD_SALT',
]
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
const BASE_ENV = {
  WECHAT_APPID: 'wx-test-appid',
  WECHAT_APPSECRET: 'wx-test-appsecret',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  SUPABASE_ANON_KEY: 'anon-test-key',
}
const USER_ID = '11111111-1111-4111-8111-111111111111'
const OPENID = 'openid_A-1234567890'
const UNIONID = 'unionid_B-1234567890'
const EMAIL = `wx_${OPENID}@wechat.placeholder`

let importSequence = 0

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] == null) delete process.env[key]
    else process.env[key] = ORIGINAL_ENV[key]
  }
}

async function loadHandler(overrides = {}, transformSource = source => source) {
  for (const key of ENV_KEYS) delete process.env[key]
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...overrides })) {
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  importSequence += 1
  const source = transformSource(await readFile(MODULE_URL, 'utf8'))
  const encoded = Buffer.from(inlineDeploymentBoundaryImport(source)).toString('base64')
  return (await import(`data:text/javascript;base64,${encoded}#wechat-login-${importSequence}`)).default
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function request(body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return new Request('https://app.test/api/auth/wechat-login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '203.0.113.9',
      ...headers,
    },
    body: text,
  })
}

function session(tokenSuffix = 'a') {
  return {
    access_token: `access-token-${tokenSuffix}-1234567890`,
    refresh_token: `refresh-token-${tokenSuffix}-1234567890`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 1_900_000_000,
    user: { id: USER_ID, email: EMAIL, aud: 'authenticated' },
    provider_token: 'must-not-be-forwarded',
  }
}

function profileRow(overrides = {}) {
  return {
    id: USER_ID,
    wechat_openid: OPENID,
    wechat_unionid: null,
    nickname: 'Member',
    avatar_url: 'https://images.example/avatar.png',
    ...overrides,
  }
}

function successfulFetch(calls, options = {}) {
  let profile = profileRow({
    wechat_openid: null,
    wechat_unionid: null,
    nickname: '用户',
    avatar_url: '',
  })
  return async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method || 'GET'
    const parsedBody = init.body ? JSON.parse(init.body) : null
    calls.push({ url, method, body: parsedBody, headers: init.headers, redirect: init.redirect, cache: init.cache })

    if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(true)
    if (url.hostname === 'api.weixin.qq.com') {
      return response({ openid: OPENID, unionid: UNIONID })
    }
    if (url.pathname === '/auth/v1/admin/generate_link') {
      return response({
        id: USER_ID,
        email: EMAIL,
        hashed_token: options.token || 'hashed-token-1234567890',
        verification_type: 'magiclink',
      })
    }
    if (url.pathname === '/rest/v1/profiles' && method === 'GET') {
      return response([{ ...profile }])
    }
    if (url.pathname === '/rest/v1/profiles' && method === 'PATCH') {
      profile = { ...profile, ...parsedBody }
      return response([{
        id: USER_ID,
        wechat_openid: profile.wechat_openid,
        wechat_unionid: profile.wechat_unionid,
      }])
    }
    if (url.pathname === '/auth/v1/verify') return response(session())
    throw new Error(`unexpected fetch: ${method} ${url}`)
  }
}

test('wechat-login passwordless and abuse boundaries', async (t) => {
  const originalFetch = globalThis.fetch
  const originalConsoleError = console.error
  t.after(() => {
    globalThis.fetch = originalFetch
    console.error = originalConsoleError
    restoreEnv()
  })

  await t.test('fails closed on missing or unsafe configuration without any upstream call', async () => {
    let fetches = 0
    globalThis.fetch = async () => { fetches += 1; throw new Error('must not fetch') }

    const missing = await loadHandler({ WECHAT_APPSECRET: null })
    const missingResult = await missing(request({ js_code: 'valid-code' }))
    assert.equal(missingResult.status, 503)
    assert.deepEqual(await missingResult.json(), { error: 'wechat_not_configured' })

    const unsafe = await loadHandler({ SUPABASE_URL: 'http://attacker.example' })
    const unsafeResult = await unsafe(request({ js_code: 'valid-code' }))
    assert.equal(unsafeResult.status, 503)
    assert.deepEqual(await unsafeResult.json(), { error: 'supabase_not_configured' })
    assert.equal(fetches, 0)
  })

  await t.test('exposes no environment readiness oracle and rejects oversized or malformed input locally', async () => {
    const handler = await loadHandler()
    let fetches = 0
    globalThis.fetch = async () => { fetches += 1; throw new Error('must not fetch') }

    const getResult = await handler(new Request('https://app.test/api/auth/wechat-login'))
    assert.equal(getResult.status, 405)
    assert.deepEqual(await getResult.json(), { error: 'method_not_allowed' })

    const optionsResult = await handler(new Request('https://app.test/api/auth/wechat-login', { method: 'OPTIONS' }))
    assert.equal(optionsResult.status, 204)
    assert.equal(optionsResult.headers.get('allow'), 'POST, OPTIONS')

    const badJson = await handler(request('{'))
    assert.equal(badJson.status, 400)
    assert.deepEqual(await badJson.json(), { error: 'bad_json' })

    const oversized = await handler(request({ js_code: 'x'.repeat(2200) }))
    assert.equal(oversized.status, 413)
    assert.deepEqual(await oversized.json(), { error: 'body_too_large' })

    let oversizedCancelled = false
    const chunkedOversized = await handler(new Request('https://app.test/api/auth/wechat-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(2 * 1024 + 1))
        },
        cancel() { oversizedCancelled = true },
      }),
      duplex: 'half',
    }))
    assert.equal(chunkedOversized.status, 413)
    assert.deepEqual(await chunkedOversized.json(), { error: 'body_too_large' })
    assert.equal(oversizedCancelled, true)

    const timedHandler = await loadHandler({}, source => source.replace(
      'const REQUEST_BODY_TIMEOUT_MS = 5_000',
      'const REQUEST_BODY_TIMEOUT_MS = 25',
    ))
    let stalledCancelled = false
    const stalled = await timedHandler(new Request('https://app.test/api/auth/wechat-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{'))
        },
        cancel() { stalledCancelled = true },
      }),
      duplex: 'half',
    }))
    assert.equal(stalled.status, 408)
    assert.deepEqual(await stalled.json(), { error: 'request_timeout' })
    assert.equal(stalledCancelled, true)
    assert.equal(fetches, 0)
  })

  await t.test('upstream deadline includes response bodies and oversized bodies fail closed', async () => {
    const handler = await loadHandler({}, source => source.replace(
      'const UPSTREAM_TIMEOUT_MS = 8_000',
      'const UPSTREAM_TIMEOUT_MS = 25',
    ))
    const logs = []
    let stalledCancelled = false
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(true)
      if (url.hostname === 'api.weixin.qq.com') {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"openid":"partial'))
          },
          cancel() { stalledCancelled = true },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`unexpected ${url}`)
    }
    console.error = (...args) => logs.push(args)

    const stalled = await handler(request({ js_code: 'response-stall-code' }))
    assert.equal(stalled.status, 502)
    assert.deepEqual(await stalled.json(), { error: 'wechat_exchange_unavailable' })
    assert.equal(stalledCancelled, true)
    assert.equal(JSON.stringify(logs).includes('response-stall-code'), false)

    const oversizedHandler = await loadHandler()
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(true)
      if (url.hostname === 'api.weixin.qq.com') {
        return new Response('{}', {
          status: 200,
          headers: { 'Content-Length': String(256 * 1024 + 1) },
        })
      }
      throw new Error(`unexpected ${url}`)
    }
    const oversized = await oversizedHandler(request({ js_code: 'oversized-response-code' }))
    assert.equal(oversized.status, 502)
    assert.deepEqual(await oversized.json(), { error: 'wechat_exchange_unavailable' })
  })

  await t.test('rate limits fail closed before WeChat and never persist raw IP or js_code', async () => {
    const handler = await loadHandler()
    const calls = []
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input))
      calls.push({ url, body: init.body ? JSON.parse(init.body) : null })
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(null)
      throw new Error('WeChat must not run when limiter is unavailable')
    }
    console.error = () => {}

    const unavailable = await handler(request({ js_code: 'sensitive-js-code' }))
    assert.equal(unavailable.status, 503)
    assert.deepEqual(await unavailable.json(), { error: 'rate_limit_unavailable' })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url.pathname, '/rest/v1/rpc/edge_rate_hit')
    const serialized = JSON.stringify(calls[0].body)
    assert.equal(serialized.includes('203.0.113.9'), false)
    assert.equal(serialized.includes('sensitive-js-code'), false)
    assert.match(calls[0].body.bucket_in, /^wechat-login:network:[0-9a-f]{64}$/)

    calls.length = 0
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input))
      calls.push({ url, body: init.body ? JSON.parse(init.body) : null })
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(false)
      throw new Error('WeChat must not run when rate limited')
    }
    const limited = await handler(request({ js_code: 'sensitive-js-code' }))
    assert.equal(limited.status, 429)
    assert.deepEqual(await limited.json(), { error: 'rate_limited' })
    assert.equal(calls.some((call) => call.url.hostname === 'api.weixin.qq.com'), false)
  })

  await t.test('successful login uses generate_link plus token_hash verify and never touches a password path', async () => {
    const handler = await loadHandler({ WECHAT_USER_PASSWORD_SALT: 'legacy-secret-must-be-ignored' })
    const calls = []
    const logs = []
    globalThis.fetch = successfulFetch(calls)
    console.error = (...args) => logs.push(args)

    const result = await handler(request({
      js_code: 'single-use-code',
      nickname: '<b>Alice</b>\u0000',
      avatar_url: 'https://images.example/untrusted-avatar.png',
    }))
    assert.equal(result.status, 200)
    const payload = await result.json()
    assert.equal(payload.access_token, session().access_token)
    assert.equal(payload.refresh_token, session().refresh_token)
    assert.equal(payload.provider_token, undefined)
    assert.equal(payload.user.id, USER_ID)

    const rateCalls = calls.filter((call) => call.url.pathname === '/rest/v1/rpc/edge_rate_hit')
    assert.equal(rateCalls.length, 2)
    assert.match(rateCalls[0].body.bucket_in, /^wechat-login:network:[0-9a-f]{64}$/)
    assert.match(rateCalls[1].body.bucket_in, /^wechat-login:identity:[0-9a-f]{64}$/)
    assert.equal(JSON.stringify(rateCalls).includes(OPENID), false)
    assert.ok(calls.findIndex((call) => call.url.pathname === '/rest/v1/rpc/edge_rate_hit')
      < calls.findIndex((call) => call.url.hostname === 'api.weixin.qq.com'))

    const generated = calls.find((call) => call.url.pathname === '/auth/v1/admin/generate_link')
    assert.equal(generated.body.type, 'magiclink')
    assert.equal(generated.body.email, EMAIL)
    assert.equal(Object.hasOwn(generated.body, 'password'), false)
    assert.deepEqual(generated.body.data, { provider: 'wechat', nickname: 'Alice' })
    assert.equal(generated.headers['X-Supabase-Api-Version'], '2024-01-01')

    const profile = calls.find((call) => call.url.pathname === '/rest/v1/profiles' && call.method === 'PATCH')
    assert.deepEqual(profile.body, {
      wechat_openid: OPENID,
      wechat_unionid: UNIONID,
      nickname: 'Alice',
    })
    assert.equal(Object.hasOwn(profile.body, 'avatar_url'), false)
    assert.equal(calls.some((call) => String(call.url).includes('untrusted-avatar')), false)
    assert.equal(profile.url.searchParams.get('wechat_openid'), 'is.null')
    assert.equal(profile.url.searchParams.get('wechat_unionid'), 'is.null')
    const verified = calls.find((call) => call.url.pathname === '/auth/v1/verify')
    assert.deepEqual(verified.body, {
      token_hash: 'hashed-token-1234567890',
      type: 'magiclink',
    })
    assert.equal(verified.headers['X-Supabase-Api-Version'], '2024-01-01')
    assert.equal(calls.some((call) => call.url.pathname.includes('wechat_password_map')), false)
    assert.equal(calls.some((call) => call.url.searchParams.get('grant_type') === 'password'), false)
    assert.equal(calls.some((call) => JSON.stringify(call.body || {}).includes('legacy-secret-must-be-ignored')), false)
    assert.equal(calls.every((call) => call.redirect === 'error'), true)
    assert.equal(calls.every((call) => call.cache === 'no-store'), true)
    assert.equal(logs.length, 0)
  })

  await t.test('classifies WeChat credential rejection without leaking upstream errmsg or contacting Auth', async () => {
    const handler = await loadHandler()
    const calls = []
    const logs = []
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input))
      calls.push(url)
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(true)
      if (url.hostname === 'api.weixin.qq.com') {
        return response({ errcode: 40029, errmsg: 'invalid code with sensitive detail' })
      }
      throw new Error('Auth must not run for rejected WeChat code')
    }
    console.error = (...args) => logs.push(args)

    const result = await handler(request({ js_code: 'rejected-code' }))
    assert.equal(result.status, 401)
    assert.deepEqual(await result.json(), { error: 'wechat_code_rejected' })
    assert.equal(calls.some((url) => url.pathname.startsWith('/auth/v1/')), false)
    assert.equal(JSON.stringify(logs).includes('sensitive detail'), false)
    assert.equal(JSON.stringify(logs).includes('rejected-code'), false)
  })

  await t.test('maps an unknown WeChat errcode to a stable 502 without argument drift', async () => {
    const handler = await loadHandler()
    const logs = []
    let authCalls = 0
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(true)
      if (url.hostname === 'api.weixin.qq.com') {
        return response({ errcode: 49999, errmsg: 'upstream detail must stay private' })
      }
      if (url.pathname.startsWith('/auth/v1/')) authCalls += 1
      throw new Error(`unexpected ${url}`)
    }
    console.error = (...args) => logs.push(args)

    const result = await handler(request({ js_code: 'unknown-errcode' }))
    assert.equal(result.status, 502)
    assert.deepEqual(await result.json(), { error: 'wechat_exchange_failed' })
    assert.equal(authCalls, 0)
    assert.equal(JSON.stringify(logs).includes('upstream detail must stay private'), false)
    assert.equal(JSON.stringify(logs).includes('unknown-errcode'), false)
    assert.equal(JSON.stringify(logs).includes('49999'), true)
  })

  await t.test('drops thrown upstream details and rejects malformed WeChat identities before Auth', async () => {
    const handler = await loadHandler()
    const logs = []
    let wechatAttempts = 0
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(true)
      if (url.hostname === 'api.weixin.qq.com') {
        wechatAttempts += 1
        throw new Error(`network failed at ${url.toString()}`)
      }
      throw new Error('Auth must not run after WeChat failure')
    }
    console.error = (...args) => logs.push(args)

    const unavailable = await handler(request({ js_code: 'throwing-secret-code' }))
    assert.equal(unavailable.status, 502)
    assert.deepEqual(await unavailable.json(), { error: 'wechat_exchange_unavailable' })
    assert.equal(wechatAttempts, 1)
    const thrownLog = JSON.stringify(logs)
    assert.equal(thrownLog.includes('wx-test-appsecret'), false)
    assert.equal(thrownLog.includes('throwing-secret-code'), false)

    logs.length = 0
    let authCalls = 0
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(true)
      if (url.hostname === 'api.weixin.qq.com') return response({ openid: '../../bad?identity' })
      if (url.pathname.startsWith('/auth/v1/')) authCalls += 1
      throw new Error(`unexpected ${url}`)
    }
    const malformedIdentity = await handler(request({ js_code: 'bad-identity-code' }))
    assert.equal(malformedIdentity.status, 502)
    assert.deepEqual(await malformedIdentity.json(), { error: 'wechat_identity_invalid' })
    assert.equal(authCalls, 0)
  })

  await t.test('malformed Auth response and profile failures remain opaque and logs contain no identity or token', async () => {
    const handler = await loadHandler()
    const calls = []
    const logs = []
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input))
      calls.push(url)
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(true)
      if (url.hostname === 'api.weixin.qq.com') return response({ openid: OPENID })
      if (url.pathname === '/auth/v1/admin/generate_link') {
        return response({
          id: USER_ID,
          email: EMAIL,
          hashed_token: 'secret-token-that-must-not-be-logged',
          verification_type: 'unexpected-type',
        })
      }
      throw new Error('malformed link must stop the flow')
    }
    console.error = (...args) => logs.push(args)

    const malformed = await handler(request({ js_code: 'code-with-secret' }))
    assert.equal(malformed.status, 500)
    assert.deepEqual(await malformed.json(), { error: 'login_failed' })
    const logText = JSON.stringify(logs)
    assert.equal(logText.includes(OPENID), false)
    assert.equal(logText.includes(EMAIL), false)
    assert.equal(logText.includes('secret-token'), false)
    assert.equal(logText.includes('code-with-secret'), false)
    assert.equal(calls.some((url) => url.pathname === '/auth/v1/verify'), false)

    calls.length = 0
    logs.length = 0
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input))
      calls.push(url)
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(true)
      if (url.hostname === 'api.weixin.qq.com') return response({ openid: OPENID })
      if (url.pathname === '/auth/v1/admin/generate_link') {
        return response({ id: USER_ID, email: EMAIL, hashed_token: 'valid-token-123456789', verification_type: 'magiclink' })
      }
      if (url.pathname === '/rest/v1/profiles') {
        return response({ code: '23505', message: `${EMAIL}: secret-token` }, 409)
      }
      throw new Error('verify must not issue a session after bind failure')
    }
    const bindFailure = await handler(request({ js_code: 'another-secret-code' }))
    assert.equal(bindFailure.status, 500)
    assert.deepEqual(await bindFailure.json(), { error: 'login_failed' })
    assert.equal(calls.some((url) => url.pathname === '/auth/v1/verify'), false)
    const bindLogText = JSON.stringify(logs)
    assert.equal(bindLogText.includes(EMAIL), false)
    assert.equal(bindLogText.includes('secret-token'), false)
  })

  await t.test('never returns a session bound to a different Auth user', async () => {
    const handler = await loadHandler()
    const logs = []
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(true)
      if (url.hostname === 'api.weixin.qq.com') return response({ openid: OPENID })
      if (url.pathname === '/auth/v1/admin/generate_link') {
        return response({ id: USER_ID, email: EMAIL, hashed_token: 'identity-check-token-123', verification_type: 'magiclink' })
      }
      if (url.pathname === '/rest/v1/profiles') return response([profileRow()])
      if (url.pathname === '/auth/v1/verify') {
        const wrong = session('wrong-user')
        wrong.user = {
          id: '22222222-2222-4222-8222-222222222222',
          email: 'someone-else@example.com',
        }
        return response(wrong)
      }
      throw new Error(`unexpected ${url}`)
    }
    console.error = (...args) => logs.push(args)

    const result = await handler(request({ js_code: 'identity-check-code' }))
    assert.equal(result.status, 500)
    assert.deepEqual(await result.json(), { error: 'login_failed' })
    assert.equal(JSON.stringify(logs).includes('someone-else@example.com'), false)
  })

  await t.test('never overwrites a profile already bound to another WeChat identity', async () => {
    const handler = await loadHandler()
    const calls = []
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input))
      calls.push({ url, method: init.method || 'GET' })
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(true)
      if (url.hostname === 'api.weixin.qq.com') return response({ openid: OPENID, unionid: UNIONID })
      if (url.pathname === '/auth/v1/admin/generate_link') {
        return response({ id: USER_ID, email: EMAIL, hashed_token: 'profile-conflict-token-123', verification_type: 'magiclink' })
      }
      if (url.pathname === '/rest/v1/profiles' && (init.method || 'GET') === 'GET') {
        return response([profileRow({
          wechat_openid: 'different_openid_12345',
          wechat_unionid: 'different_unionid_12345',
        })])
      }
      throw new Error(`identity conflict must stop before ${init.method || 'GET'} ${url}`)
    }
    console.error = () => {}

    const result = await handler(request({ js_code: 'profile-conflict-code' }))
    assert.equal(result.status, 500)
    assert.deepEqual(await result.json(), { error: 'login_failed' })
    assert.equal(calls.some((call) => call.url.pathname === '/rest/v1/profiles' && call.method === 'PATCH'), false)
    assert.equal(calls.some((call) => call.url.pathname === '/auth/v1/verify'), false)
  })

  await t.test('retries only the exact otp_expired concurrency conflict', async () => {
    const handler = await loadHandler()
    const calls = []
    let generateCalls = 0
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input))
      const body = init.body ? JSON.parse(init.body) : null
      calls.push({ url, body })
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(true)
      if (url.hostname === 'api.weixin.qq.com') return response({ openid: OPENID })
      if (url.pathname === '/auth/v1/admin/generate_link') {
        generateCalls += 1
        return response({ id: USER_ID, email: EMAIL, hashed_token: `valid-token-${generateCalls}-123456789`, verification_type: 'magiclink' })
      }
      if (url.pathname === '/rest/v1/profiles') return response([profileRow()])
      if (url.pathname === '/auth/v1/verify') {
        if (body.token_hash.includes('-1-')) return response({ code: 'otp_expired' }, 403)
        return response(session('retry'))
      }
      throw new Error(`unexpected ${url}`)
    }
    console.error = () => {}

    const retried = await handler(request({ js_code: 'retry-code' }))
    assert.equal(retried.status, 200)
    assert.equal(generateCalls, 2)
    assert.equal(calls.filter((call) => call.url.pathname === '/auth/v1/verify').length, 2)

    calls.length = 0
    generateCalls = 0
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input))
      calls.push({ url, body: init.body ? JSON.parse(init.body) : null })
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(true)
      if (url.hostname === 'api.weixin.qq.com') return response({ openid: OPENID })
      if (url.pathname === '/auth/v1/admin/generate_link') {
        generateCalls += 1
        return response({ id: USER_ID, email: EMAIL, hashed_token: 'valid-token-nonretry-123', verification_type: 'magiclink' })
      }
      if (url.pathname === '/rest/v1/profiles') return response([profileRow()])
      if (url.pathname === '/auth/v1/verify') return response({ code: 'otp_disabled' }, 403)
      throw new Error(`unexpected ${url}`)
    }
    const notRetried = await handler(request({ js_code: 'nonretry-code' }))
    assert.equal(notRetried.status, 500)
    assert.equal(generateCalls, 1)
    assert.equal(calls.filter((call) => call.url.pathname === '/auth/v1/verify').length, 1)
  })

  await t.test('retries only exact first-user creation conflicts from generate_link', async () => {
    const handler = await loadHandler()
    let generated = 0
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input))
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(true)
      if (url.hostname === 'api.weixin.qq.com') return response({ openid: OPENID })
      if (url.pathname === '/auth/v1/admin/generate_link') {
        generated += 1
        if (generated === 1) return response({ code: 'user_already_exists' }, 422)
        return response({ id: USER_ID, email: EMAIL, hashed_token: 'conflict-retry-token-12345', verification_type: 'magiclink' })
      }
      if (url.pathname === '/rest/v1/profiles') return response([profileRow()])
      if (url.pathname === '/auth/v1/verify') return response(session('create-conflict'))
      throw new Error(`unexpected ${url}`)
    }
    console.error = () => {}

    const retried = await handler(request({ js_code: 'create-conflict-code' }))
    assert.equal(retried.status, 200)
    assert.equal(generated, 2)

    generated = 0
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(true)
      if (url.hostname === 'api.weixin.qq.com') return response({ openid: OPENID })
      if (url.pathname === '/auth/v1/admin/generate_link') {
        generated += 1
        return response({ code: 'email_provider_disabled' }, 422)
      }
      throw new Error(`unexpected ${url}`)
    }
    const notRetried = await handler(request({ js_code: 'provider-disabled-code' }))
    assert.equal(notRetried.status, 500)
    assert.equal(generated, 1)
  })

  await t.test('two simultaneous first logins converge without password-map or credential races', async () => {
    const handler = await loadHandler()
    const calls = []
    let generated = 0
    let releaseInitialLinks
    const initialLinksReady = new Promise((resolve) => { releaseInitialLinks = resolve })
    let releaseSecondVerify
    const secondVerified = new Promise((resolve) => { releaseSecondVerify = resolve })
    let profileState = profileRow({
      wechat_openid: null,
      wechat_unionid: null,
      nickname: '用户',
      avatar_url: '',
    })
    let initialProfileReads = 0
    let releaseInitialProfileReads
    const initialProfileReadsReady = new Promise((resolve) => { releaseInitialProfileReads = resolve })

    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input))
      const method = init.method || 'GET'
      const body = init.body ? JSON.parse(init.body) : null
      calls.push({ url, method, body })
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(true)
      if (url.hostname === 'api.weixin.qq.com') return response({ openid: OPENID, unionid: UNIONID })
      if (url.pathname === '/auth/v1/admin/generate_link') {
        generated += 1
        const number = generated
        if (generated === 2) releaseInitialLinks()
        if (number <= 2) await initialLinksReady
        return response({
          id: USER_ID,
          email: EMAIL,
          hashed_token: `concurrent-token-${number}-123456789`,
          verification_type: 'magiclink',
        })
      }
      if (url.pathname === '/rest/v1/profiles' && method === 'GET') {
        const snapshot = { ...profileState }
        if (profileState.wechat_openid == null) {
          initialProfileReads += 1
          if (initialProfileReads === 2) releaseInitialProfileReads()
          await initialProfileReadsReady
        }
        return response([snapshot])
      }
      if (url.pathname === '/rest/v1/profiles' && method === 'PATCH') {
        if (profileState.wechat_openid != null) return response([])
        profileState = { ...profileState, ...body }
        return response([{
          id: USER_ID,
          wechat_openid: profileState.wechat_openid,
          wechat_unionid: profileState.wechat_unionid,
        }])
      }
      if (url.pathname === '/auth/v1/verify') {
        if (body.token_hash.includes('-1-')) {
          await secondVerified
          return response({ code: 'otp_expired' }, 403)
        }
        if (body.token_hash.includes('-2-')) releaseSecondVerify()
        return response(session(body.token_hash.includes('-2-') ? 'second' : 'retry'))
      }
      throw new Error(`unexpected ${url}`)
    }
    console.error = () => {}

    const [first, second] = await Promise.all([
      handler(request({ js_code: 'concurrent-code-a' })),
      handler(request({ js_code: 'concurrent-code-b' })),
    ])
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(generated, 3)
    assert.equal(calls.filter((call) => call.url.pathname === '/auth/v1/verify').length, 3)
    assert.equal(calls.filter((call) => call.url.pathname === '/rest/v1/profiles' && call.method === 'PATCH').length, 2)
    assert.equal(profileState.wechat_openid, OPENID)
    assert.equal(profileState.wechat_unionid, UNIONID)
    assert.equal(calls.some((call) => call.url.pathname.includes('wechat_password_map')), false)
    assert.equal(calls.some((call) => call.url.searchParams.get('grant_type') === 'password'), false)
  })
})
