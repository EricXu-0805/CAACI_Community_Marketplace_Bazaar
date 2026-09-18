import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineSharedApiImports } from './_test-module-loader.mjs'
import { isOwnWechatChatPhoto, trustedWechatPhotoUrl } from './_wechat-media-path.js'
import { secureCallbackEnv, secureCallbackRequest } from './_wechat-callback-test-crypto.mjs'

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const PATH = `items/${OWNER}/${OTHER}/33333333-3333-4333-8333-333333333333.jpg`
const BASE = 'https://project.supabase.test'
const originalFetch = globalThis.fetch
const originalEnv = { ...process.env }
const originalError = console.error
let nonce = 0
afterEach(() => {
  globalThis.fetch = originalFetch; console.error = originalError
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]
  Object.assign(process.env, originalEnv)
})
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
async function handler(file) {
  Object.assign(process.env, secureCallbackEnv('push-token'), {
    WECHAT_APPSECRET: 'fixture-secret', WECHAT_MEDIA_ASYNC_ENABLED: 'true', WECHAT_CHAT_PHOTOS_ENABLED: 'true',
    SUPABASE_URL: BASE, SUPABASE_SECRET_KEY: 'sb_secret_fixture', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  })
  const source = await readFile(new URL(file, import.meta.url), 'utf8')
  return (await import(`data:text/javascript;base64,${Buffer.from(inlineSharedApiImports(source)).toString('base64')}#${nonce++}`)).default
}
function request(body = {}) {
  return new Request('https://app.test/api/wechat-seccheck', { method: 'POST', headers: {
    Authorization: 'Bearer caller-only', 'Content-Type': 'application/json',
  }, body: JSON.stringify({ kind: 'image', bucket: 'chat-media', storage_path: PATH, ...body }) })
}
function fixture(options = {}) {
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input); const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url, init, body })
    if (url.pathname === '/auth/v1/user') return json({ id: OWNER })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
    if (url.pathname === '/rest/v1/profiles') return json([{ wechat_openid: 'fixture-openid' }])
    if (url.pathname === '/cgi-bin/stable_token') return json({ access_token: 'fixture-provider-token', expires_in: 7200 })
    if (url.pathname.startsWith('/storage/v1/object/sign/')) {
      if (options.signThrows) throw new Error('network')
      return json({ signedURL: options.signedURL ?? `/object/sign/chat-media/${PATH}?token=private-capability` }, options.signStatus ?? 200)
    }
    if (url.pathname === '/wxa/media_check_async') return json({ errcode: 0, trace_id: 'private-photo-trace' })
    if (url.pathname === '/rest/v1/wechat_media_checks') return json({}, options.mappingStatus ?? 201)
    throw new Error(`unexpected request ${url.pathname}`)
  }
  return calls
}

test('only the sender canonical JPEG/PNG/GIF photo path is eligible', () => {
  assert.equal(isOwnWechatChatPhoto(PATH, OWNER), true)
  for (const invalid of [PATH.replace(OWNER, OTHER), `${PATH}?token=leak`, PATH.replace('.jpg', '.mp4'), PATH.replace('.jpg', '.webp'), PATH.replace('/3333', '/../3333'), `https://x.test/${PATH}`]) {
    assert.equal(isOwnWechatChatPhoto(invalid, OWNER), false, invalid)
  }
  assert.equal(trustedWechatPhotoUrl(`/object/sign/chat-media/${PATH}?token=x`, BASE, PATH), `${BASE}/storage/v1/object/sign/chat-media/${PATH}?token=x`)
  for (const invalid of [`https://evil.test/storage/v1/object/sign/chat-media/${PATH}?token=x`, `/object/sign/chat-media/${PATH}`, `/object/sign/chat-media/${PATH}?token=x#leak`, `/object/sign/chat-media/${PATH.replace(OWNER, OTHER)}?token=x`]) {
    assert.equal(trustedWechatPhotoUrl(invalid, BASE, PATH), null)
  }
})

test('private moderation signs with caller JWT and persists only the private path', async () => {
  const calls = fixture(); const run = await handler('wechat-seccheck.js')
  const response = await run(request())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, trace_id: 'private-photo-trace' })
  const signature = calls.find(c => c.url.pathname.startsWith('/storage/'))
  assert.equal(signature.init.headers.Authorization, 'Bearer caller-only')
  assert.equal(signature.init.headers.apikey, 'sb_publishable_fixture')
  assert.deepEqual(signature.body, { expiresIn: 600 })
  const moderation = calls.find(c => c.url.pathname === '/wxa/media_check_async')
  assert.equal(moderation.body.scene, 4)
  assert.equal(moderation.body.media_type, 2)
  assert.equal(moderation.body.media_url, `${BASE}/storage/v1/object/sign/chat-media/${PATH}?token=private-capability`)
  const mapping = calls.find(c => c.url.pathname === '/rest/v1/wechat_media_checks')
  assert.deepEqual(mapping.body, { trace_id: 'private-photo-trace', bucket: 'chat-media', storage_path: PATH, user_id: OWNER })
  assert.ok(calls.indexOf(mapping) > calls.indexOf(moderation))
})

for (const [name, body] of [
  ['another owner', { storage_path: PATH.replace(OWNER, OTHER) }],
  ['client signed capability', { media_url: `${BASE}/storage/v1/object/sign/chat-media/${PATH}?token=bad` }],
  ['video disguised as a photo', { storage_path: PATH.replace('.jpg', '.mp4') }],
]) test(`private gate refuses ${name} before signing or sending`, async () => {
  const calls = fixture(); const run = await handler('wechat-seccheck.js')
  assert.equal((await run(request(body))).status, 400)
  assert.equal(calls.some(c => c.url.pathname.startsWith('/storage/') || c.url.pathname === '/wxa/media_check_async'), false)
})

for (const [name, options] of [
  ['RLS denial', { signStatus: 403 }], ['missing object', { signStatus: 404 }],
  ['network outage', { signThrows: true }], ['unexpected origin', { signedURL: 'https://evil.test/file?token=x' }],
]) test(`private gate does not send a photo after ${name}`, async () => {
  const calls = fixture(options); const run = await handler('wechat-seccheck.js')
  assert.equal((await run(request())).status, 503)
  assert.equal(calls.some(c => c.url.pathname === '/wxa/media_check_async'), false)
})

test('private mapping failure prevents handoff acknowledgment', async () => {
  console.error = () => {}
  fixture({ mappingStatus: 503 }); const run = await handler('wechat-seccheck.js')
  const response = await run(request())
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error, 'media_mapping_unavailable')
})

test('private photos have an independent default-off server gate', async () => {
  const calls = fixture(); const run = await handler('wechat-seccheck.js')
  delete process.env.WECHAT_CHAT_PHOTOS_ENABLED
  const response = await run(request())
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error, 'wechat_chat_photos_disabled')
  assert.equal(calls.some(c => c.url.pathname.startsWith('/storage/')), false)
})

for (const [name, mapping, status, expected, verdict = 'risky'] of [
  ['owned photo', PATH, 200, 200],
  ['already removed photo', PATH, 400, 200],
  ['different owner', PATH.replace(OWNER, OTHER), 200, 503],
  ['video', PATH.replace('.jpg', '.mp4'), 200, 503],
  ['review photo is withheld rather than silently approved', PATH, 200, 200, 'review'],
  ['review still validates the owner', PATH.replace(OWNER, OTHER), 200, 503, 'review'],
]) test(`encrypted callback safely handles ${name}`, async () => {
  console.error = () => {}; const removed = []; let completed = false
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input)
    if (url.pathname.endsWith('/rpc/claim_wechat_callback_receipt')) return json('claimed')
    if (url.pathname.endsWith('/rpc/release_wechat_callback_receipt')) return json(true)
    if (url.pathname === '/rest/v1/wechat_media_checks') return json([{ bucket: 'chat-media', storage_path: mapping, user_id: OWNER }])
    if (url.pathname.startsWith('/storage/v1/object/chat-media/')) {
      removed.push(url.pathname)
      return json(status === 400 ? { statusCode: '404', error: 'not_found', message: 'Object not found' } : {}, status)
    }
    if (url.pathname.endsWith('/rpc/complete_wechat_callback_receipt')) { completed = true; return json(true) }
    throw new Error(`unexpected request ${url.pathname}`)
  }
  const run = await handler('wechat-callback.js')
  const response = await run(await secureCallbackRequest('push-token', { Event: 'wxa_media_check', trace_id: 'private-photo-trace', result: { suggest: verdict } }))
  assert.equal(response.status, expected)
  assert.equal(completed, expected === 200)
  assert.equal(removed.length, expected === 200 ? 1 : 0)
})
