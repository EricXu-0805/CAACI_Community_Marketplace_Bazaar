import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const compile = input => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString('base64')}`
const topicModule = compile(source('utils/communityPost.ts'))
const { normalizePostTopic } = await import(topicModule)

test('topic input keeps legacy updates nullable and rejects incomplete/invalid metadata', () => {
  assert.deepEqual(normalizePostTopic(), { title: null, category: null })
  assert.deepEqual(normalizePostTopic('  A question  ', 'campus-life'), { title: 'A question', category: 'campus-life' })
  for (const [title, category] of [['Title', null], [null, 'campus-life'], ['Title', 'furniture'], ['  ', 'campus-life']]) {
    assert.throws(() => normalizePostTopic(title, category), /post_topic_required/)
  }
  for (const title of ['x'.repeat(121), 'First\nsecond', 'First\rsecond']) assert.throws(() => normalizePostTopic(title, 'campus-life'), /post_title_invalid/)
  assert.equal(normalizePostTopic('界'.repeat(120), 'campus-life').title.length, 120)
  for (const body of ['', '   ', '\n\t', null]) {
    assert.throws(() => normalizePostTopic('A question', 'campus-life', body), /post_topic_body_required/)
  }
  assert.deepEqual(normalizePostTopic('A question', 'campus-life', ' Body '), { title: 'A question', category: 'campus-life' })
  assert.deepEqual(normalizePostTopic(null, null, ''), { title: null, category: null })
})

let sequence = 0
async function loadPlaza({ postError = null, attachmentError = null, switchAccountAfterInsert = false, switchAccountAfterModeration = false } = {}) {
  const writes = [], cleared = [], moderated = [], query = [], rpc = []
  const scopeUrl = compile(`${source('composables/accountScope.ts')}\n// fixture ${++sequence}`)
  const scope = await import(scopeUrl)
  scope.transitionAccount('user-a')
  const stub = {
    writes, cleared, moderated,
    async moderationGate() { if (switchAccountAfterModeration) scope.transitionAccount('user-b') },
    supabase: {
      from(table) {
        let payload
        const chain = {
          insert(value) { payload = value; writes.push({ table, value }); return chain },
          select() { return chain }, order() { return chain }, range() { return chain }, in() { return chain },
          eq(key, value) { query.push([key, value]); return chain },
          async single() {
            if (switchAccountAfterInsert) scope.transitionAccount('user-b')
            if (postError instanceof Error) throw postError
            return { data: postError ? null : { id: 'post-1', ...payload, images: [], post_items: [] }, error: postError }
          },
          then(resolve, reject) { return Promise.resolve({ data: [], error: table === 'post_items' ? attachmentError : null }).then(resolve, reject) },
        }
        return chain
      },
      async rpc(name, args) { rpc.push([name, args]); return { data: [], error: null } },
    },
  }
  globalThis.__communityTopicTest = stub
  globalThis.uni = { showToast() {} }
  const mocks = {
    vue: 'export const ref = value => ({value})',
    './useSupabase': 'export const useSupabase = () => ({ supabase: globalThis.__communityTopicTest.supabase })',
    './useAuth': "export const useAuth = () => ({currentUser: {value: {id: 'user-a'}}})",
    './useModeration': 'export const useModeration = () => ({ensureLoaded: async()=>({ok:true}), blockedIds: {value: new Set()}})',
    // D-49 write backstop; these tests exercise unrestricted accounts.
    './useRestriction': 'export const assertWritesAllowed = () => {}',
    './useI18n': "export const useI18n=()=>({t:k=>k,lang:{value:'en'}})",
    '../utils': 'export const expandSearch=x=>[x], friendlyErrorMessage=e=>String(e)',
    '../utils/contentSafety': `export const checkContent=text=>({ok:!text.includes('forbidden'),category:'sensitive_word'}),
      clearLocalDuplicate=(token,kind,text)=>globalThis.__communityTopicTest.cleared.push(text),
      isLocalDuplicate=()=>false,
      remoteModerate=async(text)=>{globalThis.__communityTopicTest.moderated.push(text);return {flagged:false,categories:[]}}`,
    './useWechatSecCheck': 'export const mpTextGate=async()=>globalThis.__communityTopicTest.moderationGate()',
    '../utils/sentry': 'export const addBreadcrumb=()=>{}, captureException=()=>{}',
    '../utils/publicResource': 'export const assertI18nWrite=()=>{}, assertPublicMediaWrite=()=>{}, sanitizeItemResources=x=>x, sanitizePostResources=x=>x',
  }
  let input = source('composables/usePlaza.ts')
    .replace("'./accountScope'", `'${scopeUrl}'`)
    .replace("'../utils/communityPost'", `'${topicModule}'`)
    .replace("'../utils/region'", `'${compile(source('utils/region.ts'))}'`)
    .replace("'../api/mutationCommit'", `'${compile(source('api/mutationCommit.ts'))}'`)
  for (const [specifier, code] of Object.entries(mocks)) input = input.replace(`'${specifier}'`, `'${compile(code)}'`)
  const { usePlaza } = await import(`${compile(input)}#${sequence}`)
  return { plaza: usePlaza(), writes, cleared, moderated, query, rpc }
}
const topic = { title: 'Study group', category: 'campus-life' }

test('publishing includes topic metadata and moderates title plus body', async () => {
  const h = await loadPlaza()
  await h.plaza.createPost('Meet at the library', [], [], topic)
  assert.equal(h.writes[0].value.title, topic.title)
  assert.equal(h.writes[0].value.category, topic.category)
  assert.deepEqual(h.moderated, ['Study group\nMeet at the library'])
})

test('legacy publish still stores null metadata; validation fails before writing', async () => {
  let h = await loadPlaza()
  await h.plaza.createPost('Legacy update')
  assert.equal(h.writes[0].value.title, null)
  assert.equal(h.writes[0].value.category, null)
  for (const [body, items, metadata, error] of [
    ['Body', [], { title: 'Title' }, /post_topic_required/],
    ['Body', [], { ...topic, title: 'forbidden title' }, /moderation_block/],
    ['Body', ['1','2','3','4'], topic, /attach_item_cap/],
    ['', [], topic, /post_topic_body_required/],
    ['', [], {}, /content_required/],
  ]) {
    h = await loadPlaza()
    await assert.rejects(h.plaza.createPost(body, [], items, metadata), error)
    assert.equal(h.writes.length, 0)
  }
})

test('attachment failure retains the committed topic and returns partial success', async () => {
  const h = await loadPlaza({ attachmentError: { code: '42501', message: 'Denied' } })
  const result = await h.plaza.createPost('Body', [], ['item-1'], topic)
  assert.equal(result.partial, 'items_failed')
  assert.deepEqual(result.failedItemIds, ['item-1'])
  assert.equal(result.id, 'post-1')
  assert.equal(h.plaza.posts.value[0].title, topic.title)
  assert.deepEqual(h.cleared, [], 'committed post must retain duplicate guard')
  assert.deepEqual(h.writes.map(w => w.table), ['posts', 'post_items'])
})

test('unknown write and stale-account success retain duplicate guard; definite rejection releases it', async () => {
  for (const [options, expected, shouldClear] of [
    [{ postError: new Error('connection lost') }, 'unknown', false],
    [{ postError: { code: '23514', message: 'Invalid title' } }, 'not_committed', true],
    [{ switchAccountAfterInsert: true }, 'committed', false],
  ]) {
    const h = await loadPlaza(options)
    await assert.rejects(h.plaza.createPost('Body', [], [], topic), error => error.mutationCommitState === expected)
    assert.equal(h.cleared.length, shouldClear ? 1 : 0)
    assert.equal(h.plaza.posts.value.length, 0)
  }
})

test('category is applied on the server for ordinary and search pagination', async () => {
  const h = await loadPlaza()
  await h.plaza.fetchPosts({ category: 'campus-life', page: 1 })
  assert.ok(h.query.some(([key, value]) => key === 'category' && value === 'campus-life'))
  assert.ok(h.query.some(([key, value]) => key === 'region' && value === 'cu'))
  await h.plaza.fetchPosts({ category: 'alumni-career', search: 'Quantum', page: 2 })
  assert.equal(h.rpc[0][0], 'search_community_posts')
  assert.equal(h.rpc[0][1].category_in, 'alumni-career')
  assert.equal(h.rpc[0][1].offset_in, 40)
  assert.equal(h.rpc[0][1].region_in, 'cu')
})


test('account change while topic WeChat moderation is pending prevents any post write', async () => {
  const h = await loadPlaza({ switchAccountAfterModeration: true })
  await assert.rejects(h.plaza.createPost('Body', [], [], topic), error => error.mutationCommitState === 'not_committed')
  assert.equal(h.writes.length, 0)
  assert.equal(h.plaza.posts.value.length, 0)
  assert.deepEqual(h.cleared, ['Study group\nBody'])
})
