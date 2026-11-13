import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const compile = input => ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText
const ref = value => ({ value })
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function harness({ blocked = [], followed = ['friend'], loaded = false } = {}) {
  const pending = []
  const queries = []
  const currentUser = ref({ id: 'reader' })
  const blockedIds = ref(new Set(blocked))
  const supabase = {
    from(table) {
      const query = { table }
      const chain = new Proxy({}, {
        get(_, method) {
          if (method === 'then') return (resolve, reject) => {
            if (table === 'post_likes') return Promise.resolve({ data: [] }).then(resolve, reject)
            const request = deferred()
            queries.push(query)
            pending.push(request)
            return request.promise.then(resolve, reject)
          }
          return (...args) => {
            if (method === 'in') query[args[0]] = args[1]
            return chain
          }
        },
      })
      return chain
    },
  }
  const mocks = {
    ref, useSupabase: () => ({ supabase }), useAuth: () => ({ currentUser }),
    useModeration: () => ({ blockedIds, ensureLoaded: async () => ({ ok: true }) }),
    useI18n: () => ({ t: key => key, lang: ref('en') }),
    onAccountTransition: () => {}, ACTIVE_REGION: 'champaign',
    sanitizePostResources: post => post,
    friendlyErrorMessage: () => 'failed',
  }
  const input = source('composables/usePlaza.ts').replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  const plaza = new Function(...Object.keys(mocks),
    `${compile(input).replace(/\bexport /g, '')}; return usePlaza()`)(...Object.values(mocks))
  const follows = deferred()
  const state = {
    ...plaza, currentUser, following: ref(new Set(followed)), followingLoaded: ref(loaded),
    activeTab: ref('recent'), searchText: ref(''), pageIdx: ref(0),
    selectedCategory: ref(null), feedSort: ref('recent'), plazaAccountEpoch: 0,
    t: key => key,
    loadMyFollowing: () => follows.promise,
  }
  const page = source('pages/plaza/index.vue')
  const load = page.slice(page.indexOf('async function loadFeed('), page.indexOf('\nfunction selectCategory('))
  const watchStart = page.indexOf('watch(activeTab, tab => {')
  const watchEnd = page.indexOf('\n})', watchStart) + 3
  let switchCallback
  const context = { ...state, watch: (_, callback) => { switchCallback = callback } }
  new Function(...Object.keys(context), compile(`${load}\n${page.slice(watchStart, watchEnd)}`))(...Object.values(context))
  return {
    ...state, pending, queries, follows,
    switchTo(tab) { state.activeTab.value = tab; switchCallback(tab) },
  }
}

const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const post = id => ({ id, user_id: 'friend', post_items: [] })

test('opening following clears previous rows before the follow-list read completes', async () => {
  const h = harness()
  h.posts.value = [post('previous')]
  h.switchTo('following')
  assert.deepEqual(h.posts.value, [])
  assert.equal(h.loading.value, true)
  h.follows.resolve()
  await tick()
})

test('an in-flight site-wide request cannot populate following while its people are loading', async () => {
  const h = harness()
  const old = h.fetchPosts({ reset: true })
  await tick()
  h.switchTo('following')
  h.pending[0].resolve({ data: [post('site-wide')] })
  await old
  assert.deepEqual(h.posts.value, [])
  h.follows.resolve()
  await tick()
})

test('failed follow-list reads invalidate older feed requests and keep the load error', async () => {
  const h = harness()
  const old = h.fetchPosts({ reset: true })
  await tick()
  h.switchTo('following')
  h.follows.resolve()
  await tick()
  assert.equal(h.fetchError.value, 'plaza.loadFailed')
  h.pending[0].resolve({ data: [post('site-wide')] })
  await old
  assert.deepEqual(h.posts.value, [])
  assert.equal(h.loading.value, false)
  assert.equal(h.fetchError.value, 'plaza.loadFailed')
})

test('following excludes blocked people before the paginated posts query', async () => {
  const h = harness({ loaded: true, followed: ['blocked', 'friend'], blocked: ['blocked'] })
  h.switchTo('following')
  await tick()
  assert.deepEqual(h.queries[0].user_id, ['friend'])
  h.pending[0].resolve({ data: [post('visible')] })
  await tick()
  assert.deepEqual(h.posts.value.map(p => p.id), ['visible'])
})

test('control: recent requests still populate and a newer request fences an older request', async () => {
  const h = harness()
  const old = h.fetchPosts({ reset: true })
  await tick()
  const fresh = h.fetchPosts({ reset: true })
  await tick()
  h.pending[1].resolve({ data: [post('fresh')] })
  await fresh
  h.pending[0].resolve({ data: [post('old')] })
  await old
  assert.deepEqual(h.posts.value.map(p => p.id), ['fresh'])
})

test('control: following nobody ends without querying site-wide posts', async () => {
  const h = harness({ loaded: true, followed: [] })
  h.switchTo('following')
  await tick()
  assert.deepEqual(h.queries, [])
  assert.deepEqual(h.posts.value, [])
  assert.equal(h.hasMore.value, false)
})
