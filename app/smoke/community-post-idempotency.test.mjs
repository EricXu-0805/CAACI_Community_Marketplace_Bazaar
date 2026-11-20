import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const compile = input => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString('base64')}`
const POST = '33333333-3333-4333-8333-333333333333'
const topic = { postId: POST, title: 'Study group', category: 'campus-life' }
let sequence = 0

async function fixture({ writeError, readError, commitBeforeError = false, localDuplicate = false, switchOnRead = false } = {}) {
  const scopeUrl = compile(`${source('composables/accountScope.ts')}\n// ${++sequence}`)
  const scope = await import(scopeUrl)
  scope.transitionAccount('user-a')
  const rows = new Map(), reads = [], writes = []
  const state = {
    user: { value: { id: 'user-a' } }, rows, reads, writes, readError, localDuplicate,
    supabase: {
      from(table) {
        let payload
        const filters = []
        const chain = {
          insert(value) { payload = value; writes.push({ table, value }); return chain },
          select(fields) { chain.fields = fields; return chain },
          eq(key, value) { filters.push([key, value]); return chain },
          order() { return chain },
          async single() {
            assert.equal(table, 'posts')
            const row = { ...payload, images: payload.images || [], post_items: [] }
            if (commitBeforeError || !writeError) rows.set(row.id, row)
            if (writeError instanceof Error) throw writeError
            return { data: writeError ? null : row, error: writeError || null }
          },
          async maybeSingle() {
            reads.push({ table, filters, fields: chain.fields })
            if (switchOnRead) scope.transitionAccount('user-b')
            const error = state.readError
            if (error) return { data: null, error }
            return { data: [...rows.values()].find(row => filters.every(([key, value]) => row[key] === value)) || null, error: null }
          },
          then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject) },
        }
        return chain
      },
    },
  }
  globalThis.__postIdempotency = state
  const mocks = {
    vue: 'export const ref=value=>({value})',
    './useSupabase': 'export const useSupabase=()=>({supabase:globalThis.__postIdempotency.supabase})',
    './useAuth': 'export const useAuth=()=>({currentUser:globalThis.__postIdempotency.user})',
    './useModeration': 'export const useModeration=()=>({blockedIds:{value:new Set()},ensureLoaded:async()=>({ok:true})})',
    // D-49 write backstop; these tests exercise unrestricted accounts.
    './useRestriction': 'export const assertWritesAllowed=()=>{}',
    './useI18n': "export const useI18n=()=>({t:k=>k,lang:{value:'en'}})",
    '../utils': 'export const expandSearch=x=>[x],friendlyErrorMessage=e=>String(e)',
    '../utils/contentSafety': `export const checkContent=()=>({ok:true}),clearLocalDuplicate=()=>{},
      isLocalDuplicate=()=>globalThis.__postIdempotency.localDuplicate,remoteModerate=async()=>({flagged:false,categories:[]})`,
    './useWechatSecCheck': 'export const mpTextGate=async()=>{}',
    '../utils/sentry': 'export const addBreadcrumb=()=>{},captureException=()=>{}',
    '../utils/publicResource': 'export const assertI18nWrite=()=>{},assertPublicMediaWrite=()=>{},sanitizeItemResources=x=>x,sanitizePostResources=x=>x',
  }
  let input = source('composables/usePlaza.ts')
    .replace("'./accountScope'", `'${scopeUrl}'`)
    .replace("'../utils/communityPost'", `'${compile(source('utils/communityPost.ts'))}'`)
    .replace("'../utils/region'", `'${compile(source('utils/region.ts'))}'`)
    .replace("'../api/mutationCommit'", `'${compile(source('api/mutationCommit.ts'))}'`)
  for (const [specifier, mock] of Object.entries(mocks)) input = input.replace(`'${specifier}'`, `'${compile(mock)}'`)
  const module = await import(`${compile(input)}#${sequence}`)
  return { ...state, state, scope, ...module, plaza: module.usePlaza() }
}

test('response lost after INSERT retries the same post id and leaves exactly one row', async () => {
  const h = await fixture({ writeError: new Error('response lost'), readError: new Error('offline'), commitBeforeError: true })
  await assert.rejects(h.plaza.createPost('Body', [], [], topic), error => error.mutationCommitState === 'unknown')
  assert.equal(h.rows.size, 1)
  h.state.readError = null
  h.state.localDuplicate = true
  assert.deepEqual(await h.plaza.createPost('Body', [], [], { ...topic, retryCreate: true }), { id: POST, partial: false })
  assert.equal(h.rows.size, 1)
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].value.id, POST)
  assert.deepEqual(h.reads.at(-1).filters, [['id', POST], ['user_id', 'user-a']])
  assert.match(h.reads.at(-1).fields, /title, category/)
})

for (const error of [{ code: '23505', message: 'duplicate key' }, { code: 'P0001', message: 'duplicate_post' }]) {
  test(`${error.code} ${error.message} recovers the same owner and id`, async () => {
    const h = await fixture({ writeError: error, commitBeforeError: true })
    assert.deepEqual(await h.plaza.createPost('Body', [], [], topic), { id: POST, partial: false })
    assert.equal(h.rows.size, 1)
    assert.equal(h.reads.length, 1)
  })
}

test('retry reads before edited-field validation and duplicate checks and deduplicates the feed', async () => {
  const h = await fixture({ localDuplicate: true })
  h.rows.set(POST, { id: POST, user_id: 'user-a', title: 'Original', content: 'Body', images: [], post_items: [] })
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await h.plaza.createPost('', [], [], { postId: POST, retryCreate: true, title: 'Incomplete' }), { id: POST, partial: false })
  }
  assert.equal(h.writes.length, 0)
  assert.equal(h.plaza.posts.value.length, 1)
})

test('a check never inserts; absent rows stay absent and read errors remain unknown', async () => {
  const h = await fixture()
  assert.equal(await h.plaza.recoverCreatedPost(POST), null)
  h.state.readError = { code: '503', message: 'offline' }
  await assert.rejects(h.plaza.recoverCreatedPost(POST), error => error.mutationCommitState === 'unknown')
  assert.equal(h.writes.length, 0)
  assert.equal(h.rows.size, 0)
})

test('an unknown write with an absent recovery row stays unknown', async () => {
  const h = await fixture({ writeError: new Error('timeout') })
  await assert.rejects(h.plaza.createPost('Body', [], [], topic), error => error.mutationCommitState === 'unknown')
  assert.equal(h.reads.length, 1)
  assert.equal(h.rows.size, 0)
})

test('duplicate_post for a different post id remains a deterministic refusal', async () => {
  const h = await fixture({ writeError: { code: 'P0001', message: 'duplicate_post' } })
  const otherId = '44444444-4444-4444-8444-444444444444'
  h.rows.set(otherId, { id: otherId, user_id: 'user-a', content: 'Body', images: [], post_items: [] })
  await assert.rejects(h.plaza.createPost('Body', [], [], topic), error => error.mutationCommitState === 'not_committed')
  assert.equal(h.rows.size, 1)
  assert.equal(h.reads.length, 1)
  assert.equal(h.plaza.posts.value.length, 0)
})

test('recovery cannot return another owner or apply stale-account completion', async () => {
  let h = await fixture()
  h.rows.set(POST, { id: POST, user_id: 'user-b', images: [], post_items: [] })
  assert.equal(await h.plaza.recoverCreatedPost(POST), null)
  assert.equal(h.plaza.posts.value.length, 0)
  h = await fixture({ switchOnRead: true })
  h.rows.set(POST, { id: POST, user_id: 'user-a', images: [], post_items: [] })
  await assert.rejects(h.plaza.recoverCreatedPost(POST), error => error.mutationCommitState === 'unknown')
  assert.equal(h.plaza.posts.value.length, 0)
})

test('invalid client post ids are rejected before either a read or write', async () => {
  const h = await fixture()
  for (const postId of ['not-a-uuid', '33333333-3333-1333-8333-333333333333']) {
    await assert.rejects(h.plaza.createPost('Body', [], [], { ...topic, postId }), /Invalid post id/)
  }
  assert.equal(h.reads.length, 0)
  assert.equal(h.writes.length, 0)
})

test('recovered posts retain only missing item links for detail-page retry', async () => {
  const h = await fixture()
  h.rows.set(POST, { id: POST, user_id: 'user-a', images: [], post_items: [{ display_order: 0, item: { id: 'item-1' } }] })
  assert.deepEqual(await h.plaza.recoverCreatedPost(POST, ['item-1', 'item-2']), { id: POST, partial: 'items_failed', failedItemIds: ['item-2'] })
  assert.deepEqual(h.readPendingPostItems('user-a', POST), ['item-1', 'item-2'], 'keep original order for attachment retry')
  assert.equal(h.writes.length, 0)
})

test('account-owned composer drafts are erased on account switch and sign out', async () => {
  const privacy = await import(compile(`${source('api/accountLocalPrivacy.ts')}\n// idempotency draft`))
  const values = new Map()
  const storage = {
    getStorageSync: key => values.get(key),
    setStorageSync: (key, value) => values.set(key, value),
    removeStorageSync: key => values.delete(key),
  }
  const key = 'plaza_composer_draft_v1'
  privacy.reconcileAccountPrivateStorage('user-a', null, storage)
  assert.equal(privacy.writeAccountPrivateStorage(key, { postId: POST, outcomeUncertain: true }, storage), true)
  privacy.reconcileAccountPrivateStorage('user-b', 'user-a', storage)
  assert.equal(values.has(key), false)
  privacy.writeAccountPrivateStorage(key, { text: 'B draft' }, storage)
  privacy.reconcileAccountPrivateStorage(null, 'user-b', storage)
  assert.equal(values.has(key), false)
})
