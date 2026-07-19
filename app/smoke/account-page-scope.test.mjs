import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = relativePath => readFileSync(resolve(appRoot, relativePath), 'utf8')

function moduleDataUrl(input) {
  return `data:text/javascript;base64,${Buffer.from(input).toString('base64')}`
}

function compiledDataUrl(input) {
  const output = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  return moduleDataUrl(output)
}

function deferred() {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

test('page scope clears synchronously and rejects late prior-account success and failure', async () => {
  const accountScopeUrl = compiledDataUrl(source('src/composables/accountScope.ts'))
  const accountScope = await import(accountScopeUrl)
  const pageScopeUrl = compiledDataUrl(
    source('src/composables/accountPageScope.ts')
      .replace("'./accountScope'", `'${accountScopeUrl}'`),
  )
  const { createAccountPageScope } = await import(pageScopeUrl)

  const state = { rows: [], error: '', loading: false }
  const page = createAccountPageScope(() => {
    state.rows = []
    state.error = ''
    state.loading = false
  })

  async function apply(request, response) {
    state.loading = true
    try {
      const rows = await response
      if (!page.isCurrent(request)) return
      state.rows = rows
      state.error = ''
    } catch {
      if (!page.isCurrent(request)) return
      state.rows = []
      state.error = 'load_failed'
    } finally {
      if (page.isCurrent(request)) state.loading = false
    }
  }

  accountScope.transitionAccount('account-a')
  state.rows = ['A private row']
  const slowA = deferred()
  const requestA = page.begin('account-a')
  const taskA = apply(requestA, slowA.promise)

  accountScope.transitionAccount('account-b')
  assert.deepEqual(state, { rows: [], error: '', loading: false }, 'transition clears A synchronously')
  const fastB = deferred()
  const requestB = page.begin('account-b')
  const taskB = apply(requestB, fastB.promise)
  fastB.resolve(['B row'])
  await taskB
  assert.deepEqual(state, { rows: ['B row'], error: '', loading: false })

  slowA.resolve(['late A row'])
  await taskA
  assert.deepEqual(state, { rows: ['B row'], error: '', loading: false }, 'late A success cannot replace B')

  accountScope.transitionAccount('account-c')
  const failingC = deferred()
  const requestC = page.begin('account-c')
  const taskC = apply(requestC, failingC.promise)
  accountScope.transitionAccount('account-d')
  const requestD = page.begin('account-d')
  const taskD = apply(requestD, Promise.resolve(['D row']))
  await taskD
  failingC.reject(new Error('late C failure'))
  await taskC
  assert.deepEqual(state, { rows: ['D row'], error: '', loading: false }, 'late prior-account failure cannot poison D')

  accountScope.transitionAccount('account-d', true)
  assert.deepEqual(
    state,
    { rows: [], error: '', loading: false },
    'a forced generation change clears page-local state even when the user id is unchanged',
  )

  page.dispose()
})

test('fetchMyItems never caches or returns A after B becomes current', async () => {
  const accountScopeUrl = compiledDataUrl(source('src/composables/accountScope.ts'))
  const accountScope = await import(accountScopeUrl)
  const pendingQueries = []

  globalThis.__accountPageTestSupabase = {
    from(table) {
      assert.equal(table, 'items')
      let queriedUserId = ''
      const query = {
        select() { return query },
        eq(column, value) {
          if (column === 'user_id') queriedUserId = value
          return query
        },
        neq() { return query },
        order() {
          const response = deferred()
          pendingQueries.push({ userId: queriedUserId, ...response })
          return response.promise
        },
      }
      return query
    },
  }

  const mocks = {
    vue: 'export const ref = value => ({ value })',
    './useSupabase': 'export function useSupabase(){ return { supabase: globalThis.__accountPageTestSupabase } }',
    './useModeration': 'export function useModeration(){ return { blockedIds: { value: new Set() }, ensureLoaded: async () => ({ ok: true }) } }',
    './useI18n': "export function useI18n(){ return { t: key => key, lang: { value: 'en' } } }",
    '../utils': 'export const compressImage=async x=>x, detectImageMimeType=()=>\"image/jpeg\", expandSearch=x=>[x], friendlyErrorMessage=e=>String(e), getImageDimensions=async()=>({w:1,h:1})',
    '../utils/contentSafety': 'export const checkContent=()=>({ok:true}), clearLocalDuplicate=()=>{}, isLocalDuplicate=()=>false, remoteModerate=async()=>({flagged:false,categories:[]})',
    './useWechatSecCheck': 'export const mpTextGate=async()=>{}, mpImageCheck=async()=>{}',
    '../api/searchItems': 'export const searchItemsWithCompatibility=async()=>({data:[],error:null,hasMore:false})',
    '../api/mutationCommit': 'export const isDefinitiveMutationRejection=()=>false, mutationCommitState=()=>\"not_committed\", mutationOutcomeError=e=>e, shouldCompensateMutationFailure=()=>false',
    '../utils/itemStorage': 'export const ownedItemImagePaths=()=>[]',
    '../utils/publicResource': 'export const assertI18nWrite=()=>{}, assertPublicMediaWrite=()=>{}, sanitizeItemResources=x=>x',
    '../utils/sentry': 'export const captureException=()=>{}',
  }

  let itemsInput = source('src/composables/useItems.ts')
    .replace("'./accountScope'", `'${accountScopeUrl}'`)
  for (const [specifier, moduleSource] of Object.entries(mocks)) {
    itemsInput = itemsInput.replace(`'${specifier}'`, `'${moduleDataUrl(moduleSource)}'`)
  }
  const { useItems } = await import(compiledDataUrl(itemsInput))
  const { fetchMyItems } = useItems()

  try {
    accountScope.transitionAccount('account-a')
    const staleA = fetchMyItems('account-a', { force: true })
    assert.equal(pendingQueries[0]?.userId, 'account-a')

    accountScope.transitionAccount('account-b')
    const freshB = fetchMyItems('account-b', { force: true })
    assert.equal(pendingQueries[1]?.userId, 'account-b')
    const bRows = [{ id: 'b-item', user_id: 'account-b' }]
    pendingQueries[1].resolve({ data: bRows, error: null })
    assert.deepEqual(await freshB, bRows)

    pendingQueries[0].resolve({ data: [{ id: 'a-item', user_id: 'account-a' }], error: null })
    assert.deepEqual(await staleA, [])

    assert.deepEqual(await fetchMyItems('account-b'), bRows, 'B cache remains authoritative')
    assert.equal(pendingQueries.length, 2, 'stale A did not replace B cache and force a refetch')
  } finally {
    delete globalThis.__accountPageTestSupabase
  }
})

test('all affected pages route private async commits through the page scope', () => {
  const profile = source('src/pages/profile/index.vue')
  const blocked = source('src/pages/blocked/index.vue')
  const following = source('src/pages/following/index.vue')

  assert.match(profile, /createAccountPageScope\([^]*?clearProfilePrivateState\(\)/)
  assert.match(profile, /fetchMyItems\(uid, \{[^]*?accountToken: request\.accountToken[^]*?if \(!profilePageScope\.isCurrent\(request\)\) return false[^]*?myItems\.value = items/)

  assert.match(blocked, /createAccountPageScope\([^]*?clearBlockedPageState\(\)/)
  assert.match(blocked, /await loadBlockedIds\(\)[^]*?blockedPageScope\.isCurrent\(request\)[^]*?await supabase[^]*?blockedPageScope\.isCurrent\(request\)[^]*?blockedProfiles\.value/)

  assert.match(following, /createAccountPageScope\([^]*?clearFollowingPageState\(\)/)
  assert.match(following, /await fetchFollowingProfiles\(0, PAGE_SIZE\)[^]*?followingPageScope\.isCurrent\(request\)[^]*?people\.value = rows/)
  assert.match(following, /await fetchFollowingProfiles\(nextPage, PAGE_SIZE\)[^]*?followingPageScope\.isCurrent\(request\)[^]*?people\.value\.push/)
})
