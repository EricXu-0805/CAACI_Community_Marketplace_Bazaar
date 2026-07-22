// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'
import {
  TEST_WECHAT_APP_ID,
  TEST_WECHAT_ENCODING_AES_KEY,
  secureCallbackEnv,
  secureCallbackRequest,
} from './_wechat-callback-test-crypto.mjs'

const API_ROOT = new URL('./', import.meta.url)
const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const SUPABASE_URL = 'https://supabase.test'
const ENV_KEYS = [
  'WECHAT_APPID', 'WECHAT_APPSECRET', 'WECHAT_PUSH_TOKEN',
  'WECHAT_ENCODING_AES_KEY', 'WECHAT_MEDIA_ASYNC_ENABLED',
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY',
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

async function loadApi(file, env) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, env)
  const source = await readFile(new URL(file, API_ROOT), 'utf8')
  return import(`data:text/javascript;base64,${Buffer.from(inlineDeploymentBoundaryImport(source)).toString('base64')}#wechat-media-${importNonce++}`)
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function secRequest(mediaUrl) {
  return new Request('https://app.test/api/wechat-seccheck', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer caller-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ kind: 'image', media_url: mediaUrl, openid: 'wx-a' }),
  })
}

function secEnv() {
  return {
    WECHAT_APPID: TEST_WECHAT_APP_ID,
    WECHAT_APPSECRET: 'wx-secret',
    WECHAT_PUSH_TOKEN: 'push-token',
    WECHAT_ENCODING_AES_KEY: TEST_WECHAT_ENCODING_AES_KEY,
    WECHAT_MEDIA_ASYNC_ENABLED: 'true',
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    SUPABASE_ANON_KEY: 'anon-key',
  }
}

test('wechat media gate rejects another user storage path before enqueueing deletion metadata', async () => {
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push({ url, method: String(init.method || 'GET').toUpperCase(), body: init.body })
    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
    if (url.pathname === '/rest/v1/profiles') return json([{ wechat_openid: 'wx-a' }])
    if (url.pathname === '/cgi-bin/stable_token') {
      return json({ access_token: 'wechat-token-long', expires_in: 7200 })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('wechat-seccheck.js', secEnv())

  const victimUrl = `${SUPABASE_URL}/storage/v1/object/public/item-images/items/${USER_B}/photo.jpg`
  const response = await handler(secRequest(victimUrl))
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'bad_media_url' })
  assert.equal(calls.some(call => call.url.pathname === '/rest/v1/wechat_media_checks'), false)
  assert.equal(calls.some(call => call.url.pathname === '/wxa/media_check_async'), false)
})

test('wechat media gate derives the mapping from the authenticated owner URL', async () => {
  let mappingBody = null
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
    if (url.pathname === '/rest/v1/profiles') return json([{ wechat_openid: 'wx-a' }])
    if (url.pathname === '/cgi-bin/stable_token') {
      return json({ access_token: 'wechat-token-long', expires_in: 7200 })
    }
    if (url.pathname === '/wxa/media_check_async') return json({ errcode: 0, trace_id: 'trace-own' })
    if (url.pathname === '/rest/v1/wechat_media_checks') {
      mappingBody = JSON.parse(String(init.body))
      return json({}, 201)
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('wechat-seccheck.js', secEnv())

  const ownUrl = `${SUPABASE_URL}/storage/v1/object/public/item-images/items/${USER_A}/photo.jpg`
  const response = await handler(secRequest(ownUrl))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).trace_id, 'trace-own')
  assert.deepEqual(mappingBody, {
    trace_id: 'trace-own',
    bucket: 'item-images',
    storage_path: `items/${USER_A}/photo.jpg`,
    user_id: USER_A,
  })
})

test('wechat media gate fails closed when the accepted trace mapping cannot be persisted', async () => {
  console.error = () => {}
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
    if (url.pathname === '/rest/v1/profiles') return json([{ wechat_openid: 'wx-a' }])
    if (url.pathname === '/cgi-bin/stable_token') {
      return json({ access_token: 'wechat-token-long', expires_in: 7200 })
    }
    if (url.pathname === '/wxa/media_check_async') return json({ errcode: 0, trace_id: 'trace-unmapped' })
    if (url.pathname === '/rest/v1/wechat_media_checks') return json({ error: 'unavailable' }, 503)
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('wechat-seccheck.js', secEnv())

  const ownUrl = `${SUPABASE_URL}/storage/v1/object/public/item-images/items/${USER_A}/photo.jpg`
  const response = await handler(secRequest(ownUrl))
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'media_mapping_unavailable' })
})

test('wechat media gate does not degrade open when mapping persistence throws', async () => {
  console.error = () => {}
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
    if (url.pathname === '/rest/v1/profiles') return json([{ wechat_openid: 'wx-a' }])
    if (url.pathname === '/cgi-bin/stable_token') {
      return json({ access_token: 'wechat-token-long', expires_in: 7200 })
    }
    if (url.pathname === '/wxa/media_check_async') return json({ errcode: 0, trace_id: 'trace-network-error' })
    if (url.pathname === '/rest/v1/wechat_media_checks') throw new Error('network down')
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('wechat-seccheck.js', secEnv())

  const ownUrl = `${SUPABASE_URL}/storage/v1/object/public/item-images/items/${USER_A}/photo.jpg`
  const response = await handler(secRequest(ownUrl))
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'media_mapping_unavailable' })
})

async function callbackRequest(token, event, options = {}) {
  return secureCallbackRequest(token, event, options)
}

function callbackRuntimeEnv(token = 'push-token') {
  return {
    ...secureCallbackEnv(token),
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  }
}

test('wechat callback preserves a tampered mapping and fails closed before privileged Storage deletion', async () => {
  const token = 'push-token'
  const calls = []
  console.error = () => {}
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = String(init.method || 'GET').toUpperCase()
    calls.push({ url, method })
    if (url.pathname.endsWith('/rpc/claim_wechat_callback_receipt')) return json('claimed')
    if (url.pathname.endsWith('/rpc/release_wechat_callback_receipt')) return json(true)
    if (url.pathname === '/rest/v1/wechat_media_checks' && method === 'GET') {
      return json([{ bucket: 'item-images', storage_path: `items/${USER_B}/victim.jpg`, user_id: USER_A }])
    }
    if (url.pathname === '/rest/v1/wechat_media_checks' && method === 'DELETE') return json({})
    throw new Error(`unexpected fetch ${method} ${url}`)
  }
  const { default: handler } = await loadApi('wechat-callback.js', callbackRuntimeEnv(token))

  const request = await callbackRequest(token, {
    Event: 'wxa_media_check',
    trace_id: 'trace-tampered',
    result: { suggest: 'risky' },
  })
  const response = await handler(request)
  assert.equal(response.status, 503)
  assert.equal(await response.text(), 'retry')
  assert.equal(calls.some(call => call.url.pathname.startsWith('/storage/v1/object/')), false)
  assert.equal(calls.some(call => call.url.pathname === '/rest/v1/wechat_media_checks' && call.method === 'DELETE'), false)
})

test('wechat callback does not consume a risky mapping when lookup fails', async () => {
  const token = 'push-token'
  const calls = []
  console.error = () => {}
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = String(init.method || 'GET').toUpperCase()
    calls.push({ url, method })
    if (url.pathname.endsWith('/rpc/claim_wechat_callback_receipt')) return json('claimed')
    if (url.pathname.endsWith('/rpc/release_wechat_callback_receipt')) return json(true)
    if (url.pathname === '/rest/v1/wechat_media_checks' && method === 'GET') {
      return json({ error: 'unavailable' }, 503)
    }
    throw new Error(`unexpected fetch ${method} ${url}`)
  }
  const { default: handler } = await loadApi('wechat-callback.js', callbackRuntimeEnv(token))

  const response = await handler(await callbackRequest(token, {
    Event: 'wxa_media_check',
    trace_id: 'trace-lookup-failed',
    result: { suggest: 'risky' },
  }))
  assert.equal(response.status, 503)
  assert.equal(calls.some(call => call.method === 'DELETE'), false)
})

test('wechat callback does not consume a risky mapping when Storage deletion fails', async () => {
  const token = 'push-token'
  const calls = []
  console.error = () => {}
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = String(init.method || 'GET').toUpperCase()
    calls.push({ url, method })
    if (url.pathname.endsWith('/rpc/claim_wechat_callback_receipt')) return json('claimed')
    if (url.pathname.endsWith('/rpc/release_wechat_callback_receipt')) return json(true)
    if (url.pathname === '/rest/v1/wechat_media_checks' && method === 'GET') {
      return json([{ bucket: 'item-images', storage_path: `items/${USER_A}/own.jpg`, user_id: USER_A }])
    }
    if (url.pathname.startsWith('/storage/v1/object/item-images/') && method === 'DELETE') {
      return json({ error: 'unavailable' }, 503)
    }
    throw new Error(`unexpected fetch ${method} ${url}`)
  }
  const { default: handler } = await loadApi('wechat-callback.js', callbackRuntimeEnv(token))

  const response = await handler(await callbackRequest(token, {
    Event: 'wxa_media_check',
    trace_id: 'trace-storage-failed',
    result: { suggest: 'risky' },
  }))
  assert.equal(response.status, 503)
  assert.equal(calls.some(call =>
    call.url.pathname === '/rest/v1/wechat_media_checks' && call.method === 'DELETE'), false)
})

test('wechat callback retries atomic receipt completion after Storage is confirmed deleted', async () => {
  const token = 'push-token'
  const calls = []
  console.error = () => {}
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = String(init.method || 'GET').toUpperCase()
    calls.push({ url, method })
    if (url.pathname.endsWith('/rpc/claim_wechat_callback_receipt')) return json('claimed')
    if (url.pathname.endsWith('/rpc/release_wechat_callback_receipt')) return json(true)
    if (url.pathname === '/rest/v1/wechat_media_checks' && method === 'GET') {
      return json([{ bucket: 'item-images', storage_path: `items/${USER_A}/own.jpg`, user_id: USER_A }])
    }
    if (url.pathname.startsWith('/storage/v1/object/item-images/') && method === 'DELETE') {
      return json({ error: 'not found' }, 404)
    }
    if (url.pathname.endsWith('/rpc/complete_wechat_callback_receipt')) {
      return json({ error: 'unavailable' }, 503)
    }
    throw new Error(`unexpected fetch ${method} ${url}`)
  }
  const { default: handler } = await loadApi('wechat-callback.js', callbackRuntimeEnv(token))

  const response = await handler(await callbackRequest(token, {
    Event: 'wxa_media_check',
    trace_id: 'trace-cleanup-failed',
    result: { suggest: 'risky' },
  }))
  assert.equal(response.status, 503)
  const storageIndex = calls.findIndex(call => call.url.pathname.startsWith('/storage/v1/object/'))
  const completionIndex = calls.findIndex(call =>
    call.url.pathname.endsWith('/rpc/complete_wechat_callback_receipt'))
  assert.ok(storageIndex >= 0)
  assert.ok(completionIndex > storageIndex)
})

test('wechat callback deletes only a valid mapping owned by its recorded user', async () => {
  const token = 'push-token'
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = String(init.method || 'GET').toUpperCase()
    calls.push({ url, method })
    if (url.pathname.endsWith('/rpc/claim_wechat_callback_receipt')) return json('claimed')
    if (url.pathname === '/rest/v1/wechat_media_checks' && method === 'GET') {
      return json([{ bucket: 'item-images', storage_path: `items/${USER_A}/own.jpg`, user_id: USER_A }])
    }
    if (url.pathname.startsWith('/storage/v1/object/item-images/') && method === 'DELETE') return json({})
    if (url.pathname.endsWith('/rpc/complete_wechat_callback_receipt')) return json(true)
    throw new Error(`unexpected fetch ${method} ${url}`)
  }
  const { default: handler } = await loadApi('wechat-callback.js', callbackRuntimeEnv(token))

  const request = await callbackRequest(token, {
    Event: 'wxa_media_check',
    trace_id: 'trace-own',
    result: { suggest: 'risky' },
  })
  const response = await handler(request)
  assert.equal(response.status, 200)
  const storageIndex = calls.findIndex(call =>
    call.url.pathname === `/storage/v1/object/item-images/items/${USER_A}/own.jpg`
      && call.method === 'DELETE')
  const completionIndex = calls.findIndex(call =>
    call.url.pathname.endsWith('/rpc/complete_wechat_callback_receipt'))
  assert.ok(storageIndex >= 0)
  assert.ok(completionIndex > storageIndex)
})

test('completed identical callback retry returns success without repeating privileged side effects', async () => {
  const token = 'push-token'
  const calls = []
  let claimCount = 0
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = String(init.method || 'GET').toUpperCase()
    calls.push({ url, method })
    if (url.pathname.endsWith('/rpc/claim_wechat_callback_receipt')) {
      claimCount += 1
      return json(claimCount === 1 ? 'claimed' : 'completed')
    }
    if (url.pathname === '/rest/v1/wechat_media_checks' && method === 'GET') {
      return json([{ bucket: 'item-images', storage_path: `items/${USER_A}/once.jpg`, user_id: USER_A }])
    }
    if (url.pathname.startsWith('/storage/v1/object/item-images/') && method === 'DELETE') return json({})
    if (url.pathname.endsWith('/rpc/complete_wechat_callback_receipt')) return json(true)
    throw new Error(`unexpected fetch ${method} ${url}`)
  }
  const { default: handler } = await loadApi('wechat-callback.js', callbackRuntimeEnv(token))
  const timestamp = String(Math.floor(Date.now() / 1000))
  const event = {
    Event: 'wxa_media_check',
    trace_id: 'trace-once',
    result: { suggest: 'risky' },
  }

  const first = await handler(await callbackRequest(token, event, { timestamp }))
  const retry = await handler(await callbackRequest(token, event, { timestamp }))

  assert.equal(first.status, 200)
  assert.equal(retry.status, 200)
  assert.equal(calls.filter(call => call.url.pathname === '/rest/v1/wechat_media_checks').length, 1)
  assert.equal(calls.filter(call => call.url.pathname.startsWith('/storage/v1/object/')).length, 1)
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/rpc/complete_wechat_callback_receipt')).length, 1)
})
