import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const OWNER = '11111111-1111-4111-8111-111111111111'
const CONV = '22222222-2222-4222-8222-222222222222'
const MSG = '33333333-3333-4333-8333-333333333333'
const flush = async () => { for (let i = 0; i < 35; i++) await Promise.resolve() }
let nonce = 0
async function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const state = { current: true, uploads: [], checks: [], cleanup: [], aborts: 0, mime: 'jpeg', size: 100 }
  const key = `__miniPhoto${nonce++}`
  const bindings = {
    isAccountRequestCurrent: () => state.current,
    useSupabase: () => ({ supabase: { auth: { getSession: () => state.sessionWait || Promise.resolve({ data: { session: { user: { id: OWNER }, access_token: 'account-a-token' } } }) } } }),
    compressImage: async () => 'temp-compressed.jpg',
    preferredSupabasePublicKey: () => 'sb_publishable_fixture',
    waitForChatVideoReview: async (...args) => { state.videoChecks = (state.videoChecks || []).concat([args]); if (state.videoWait) await state.videoWait; if (state.checkFails) throw new Error('chat_video_review_unavailable') },
    mpImageCheck: async (...args) => { state.checks.push(args); if (state.checkWait) await state.checkWait; if (state.checkFails) throw new Error('wechat_media_check_unavailable') },
    platformFetch: async (url, options) => { state.cleanup.push({ url, options }); return {} },
    uni: {
      getVideoInfo: options => options.success({ type: state.mime, duration: state.duration ?? 20 }),
      getImageInfo: options => options.success({ type: state.mime }),
      getFileInfo: options => options.success({ size: state.size }),
      uploadFile: options => { state.uploads.push(options); return { abort: () => { state.aborts++ } } },
    },
  }
  const compile = async path => {
    let source = readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^import[\s\S]*?from ['"][^'"]+['"];?\s*$/gm, '')
    source = source.replaceAll('import.meta.env.VITE_SUPABASE_URL', "'https://project.supabase.test'")
      .replaceAll('import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY', "'sb_publishable_fixture'")
      .replaceAll('import.meta.env.VITE_SUPABASE_ANON_KEY', 'undefined')
    const js = ts.transpileModule(`const {${Object.keys(bindings).join(',')}} = globalThis.${key};\n${source}`, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
    return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
  }
  globalThis[key] = bindings; t.after(() => { delete globalThis[key] })
  Object.assign(bindings, await compile('../src/utils/chatMedia.ts'))
  const module = await compile('../src/api/miniChatPhoto.ts')
  state.start = (type = 'image') => module.uploadMiniChatPhoto('temp.jpg', CONV, MSG, { userId: OWNER }, type)
  return state
}

test('mini photo returns a private path only after upload and durable moderation', async t => {
  const state = await fixture(t); const pending = state.start()
  await flush(); assert.equal(state.uploads.length, 1); assert.equal(state.checks.length, 0)
  assert.ok(state.uploads[0].url.includes('/object/chat-media/'))
  assert.equal(state.uploads[0].header.Authorization, 'Bearer account-a-token')
  assert.equal(state.uploads[0].header.apikey, 'sb_publishable_fixture')
  state.uploads[0].success({ statusCode: 200 })
  const path = await pending
  assert.equal(path, `items/${OWNER}/${CONV}/${MSG}.jpg`)
  assert.deepEqual(state.checks[0].slice(0, 2), [path, 'chat-media'])
  assert.equal(state.cleanup.length, 0)
})

test('a missing upload callback aborts once and cleans a late completed upload without moderating', async t => {
  const state = await fixture(t); const pending = state.start(); const rejected = assert.rejects(pending, /timeout/)
  await flush(); t.mock.timers.tick(45_000); await rejected; await flush()
  assert.equal(state.aborts, 1); assert.equal(state.cleanup.length, 1)
  state.uploads[0].success({ statusCode: 200 }); await flush()
  assert.equal(state.cleanup.length, 2); assert.equal(state.checks.length, 0)
})

test('moderation failure leaves no sendable attachment and cleans only its own candidate', async t => {
  const state = await fixture(t); state.checkFails = true
  const pending = state.start(); const rejected = assert.rejects(pending, /wechat_media/)
  await flush(); state.uploads[0].success({ statusCode: 200 }); await rejected; await flush()
  assert.equal(state.cleanup.length, 1)
  assert.deepEqual(JSON.parse(state.cleanup[0].options.body), { prefixes: [`items/${OWNER}/${CONV}/${MSG}.jpg`] })
})

test('switching accounts during upload does not moderate and cleanup uses the original bearer', async t => {
  const state = await fixture(t); const pending = state.start(); const rejected = assert.rejects(pending, /account_changed/)
  await flush(); state.current = false; state.uploads[0].success({ statusCode: 200 }); await rejected; await flush()
  assert.equal(state.checks.length, 0)
  assert.equal(state.cleanup[0].options.headers.Authorization, 'Bearer account-a-token')
})

test('session lookup is bounded and its late result cannot upload', async t => {
  const state = await fixture(t); let resolve
  state.sessionWait = new Promise(r => { resolve = r })
  const pending = state.start(); const rejected = assert.rejects(pending, /timeout/)
  await flush(); t.mock.timers.tick(15_000); await rejected
  resolve({ data: { session: { user: { id: OWNER }, access_token: 'late' } } }); await flush()
  assert.equal(state.uploads.length, 0)
})

for (const [name, change, reason] of [
  ['oversized photo', { size: 6 * 1024 * 1024 }, /too_large/],
  ['unsupported format', { mime: 'webp' }, /invalid_file/],
  ['missing format', { mime: undefined }, /invalid_file/],
]) test(`${name} is refused before upload`, async t => {
  const state = await fixture(t); Object.assign(state, change)
  await assert.rejects(state.start(), reason); assert.equal(state.uploads.length, 0)
})


test('mini video waits for the final server review before becoming sendable', async t => {
  const state = await fixture(t); state.mime = 'mp4'; let resolve;
  state.videoWait = new Promise(r => { resolve = r }); let settled = false;
  const pending = state.start('video').then(path => { settled = true; return path });
  await flush(); state.uploads[0].success({statusCode:200}); await flush();
  assert.equal(settled,false); assert.equal(state.checks.length,0); assert.equal(state.videoChecks.length,1);
  resolve(); assert.match(await pending,/\.mp4$/);
});
test('mini video review failure cleans its private upload without a message', async t => {
  const state = await fixture(t); state.mime = 'mp4'; state.checkFails = true;
  const pending = state.start('video'); const rejected = assert.rejects(pending,/chat_video_review/);
  await flush(); state.uploads[0].success({statusCode:200}); await rejected; await flush();
  assert.equal(state.cleanup.length,1);
});
test('mini video rejects clips longer than one minute before upload', async t => {
  const state=await fixture(t); state.mime='mp4'; state.duration=61;
  await assert.rejects(state.start('video'),/invalid_file/); assert.equal(state.uploads.length,0);
});
