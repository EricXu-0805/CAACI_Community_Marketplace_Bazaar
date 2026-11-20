import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter, once } from 'node:events'
import ts from 'typescript'

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const compile = input => ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const options = { timeout: 4000 }

function harness({ blocked = [], followed = ['friend'], loaded = false } = {}) {
  const changes = new EventEmitter()
  const ref = initial => {
    let value = initial
    return {
      get value() { return value },
      set value(next) { value = next; changes.emit('change') },
    }
  }
  const pending = [], queries = []
  const currentUser = ref({ id: 'reader' }), blockedIds = ref(new Set(blocked))
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
            changes.emit('change')
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
    sanitizePostResources: post => post, friendlyErrorMessage: () => 'failed',
  }
  const input = source('composables/usePlaza.ts').replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  const plaza = new Function(...Object.keys(mocks),
    `${compile(input).replace(/\bexport /g, '')}; return usePlaza()`)(...Object.values(mocks))
  const follows = deferred()
  const following = ref(new Set(followed)), followingLoaded = ref(loaded)
  const state = {
    ...plaza, currentUser, following, followingLoaded,
    activeTab: ref('recent'), searchText: ref(''), pageIdx: ref(0),
    selectedCategory: ref(null), feedSort: ref('recent'), plazaAccountEpoch: 0,
    t: key => key,
    async loadMyFollowing() {
      const ids = await follows.promise
      if (ids) {
        following.value = new Set(ids)
        followingLoaded.value = true
      }
    },
  }
  const page = source('pages/plaza/index.vue')
  const load = page.slice(page.indexOf('async function loadFeed('), page.indexOf('\nfunction selectCategory('))
  const watchStart = page.indexOf('watch(activeTab, tab => {')
  const watchEnd = page.indexOf('\n})', watchStart) + 3
  const emptyStart = page.indexOf('const emptyText = computed(')
  const emptyEnd = page.indexOf('\n})', emptyStart) + 3
  let switchCallback
  const context = {
    ...state, computed: get => ({ get value() { return get() } }),
    watch: (_, callback) => { switchCallback = callback },
  }
  const api = new Function(...Object.keys(context),
    compile(`${load}\n${page.slice(watchStart, watchEnd)}\n${page.slice(emptyStart, emptyEnd)}\nreturn { loadFeed, emptyText }`))(...Object.values(context))
  return {
    ...state, ...api, pending, queries, follows,
    switchTo(tab) { state.activeTab.value = tab; switchCallback(tab) },
    async until(predicate) {
      while (!predicate()) await once(changes, 'change')
    },
  }
}

const post = id => ({ id, user_id: 'friend', post_items: [] })

test('opening following clears previous rows before the follow-list read completes', options, async () => {
  const h = harness()
  h.posts.value = [post('previous')]
  h.switchTo('following')
  assert.deepEqual(h.posts.value, [])
  assert.equal(h.loading.value, true)
  h.follows.resolve()
  await h.until(() => !h.loading.value)
})

test('an in-flight site-wide request cannot populate following while its people are loading', options, async () => {
  const h = harness()
  const old = h.fetchPosts({ reset: true })
  await h.until(() => h.pending.length === 1)
  h.switchTo('following')
  h.pending[0].resolve({ data: [post('site-wide')] })
  await old
  assert.deepEqual(h.posts.value, [])
  h.follows.resolve()
  await h.until(() => !h.loading.value)
})

test('failed follow-list reads invalidate older feed requests and keep the load error', options, async () => {
  const h = harness()
  const old = h.fetchPosts({ reset: true })
  await h.until(() => h.pending.length === 1)
  h.switchTo('following')
  h.follows.resolve()
  await h.until(() => h.fetchError.value === 'plaza.loadFailed')
  h.pending[0].resolve({ data: [post('site-wide')] })
  await old
  assert.deepEqual(h.posts.value, [])
  assert.equal(h.loading.value, false)
  assert.equal(h.fetchError.value, 'plaza.loadFailed')
})

test('following excludes blocked people before the paginated posts query', options, async () => {
  const h = harness({ loaded: true, followed: ['blocked', 'friend'], blocked: ['blocked'] })
  h.switchTo('following')
  await h.until(() => h.pending.length === 1)
  assert.deepEqual(h.queries[0].user_id, ['friend'])
  h.pending[0].resolve({ data: [post('visible')] })
  await h.until(() => !h.loading.value)
  assert.deepEqual(h.posts.value.map(p => p.id), ['visible'])
})

test('control: recent requests still populate and a newer request fences an older request', options, async () => {
  const h = harness()
  const old = h.fetchPosts({ reset: true })
  await h.until(() => h.pending.length === 1)
  const fresh = h.fetchPosts({ reset: true })
  await h.until(() => h.pending.length === 2)
  h.pending[1].resolve({ data: [post('fresh')] })
  await fresh
  h.pending[0].resolve({ data: [post('old')] })
  await old
  assert.deepEqual(h.posts.value.map(p => p.id), ['fresh'])
})

test('control: following nobody ends without querying site-wide posts', options, async () => {
  const h = harness({ loaded: true, followed: [] })
  h.switchTo('following')
  await h.until(() => !h.loading.value)
  assert.deepEqual(h.queries, [])
  assert.deepEqual(h.posts.value, [])
  assert.equal(h.hasMore.value, false)
})

test('an entirely blocked following list sends no post query and shows the following empty state', options, async () => {
  const h = harness({ followed: ['blocked'], blocked: ['blocked'] })
  h.activeTab.value = 'following'
  const load = h.loadFeed()
  h.follows.resolve(['blocked'])
  // Wait for the controller to finish, or catch an unwanted query without
  // depending on the tab watcher's loading flag.
  await Promise.race([load, h.until(() => h.queries.length !== 0)])
  assert.deepEqual(h.queries, [])
  await load
  assert.equal(h.followingLoaded.value, true)
  assert.equal(h.fetchError.value, '')
  assert.deepEqual(h.posts.value, [])
  assert.equal(h.hasMore.value, false)
  assert.equal(h.emptyText.value, 'plaza.emptyFollowing')
})

test('a successful follow-list read clears old rows and queries the returned authors', options, async () => {
  const h = harness()
  h.posts.value = [post('previous')]
  h.switchTo('following')
  assert.deepEqual(h.posts.value, [])
  h.follows.resolve(['new-friend'])
  await h.until(() => h.queries.length === 1)
  assert.equal(h.followingLoaded.value, true)
  assert.deepEqual(h.queries[0].user_id, ['new-friend'])
  h.pending[0].resolve({ data: [{ ...post('new'), user_id: 'new-friend' }] })
  await h.until(() => !h.loading.value)
  assert.deepEqual(h.posts.value.map(p => p.id), ['new'])
  assert.equal(h.fetchError.value, '')
})

test('a failed follow-list retry fences a feed started after the tab switch', options, async () => {
  const h = harness()
  h.activeTab.value = 'following'
  const old = h.fetchPosts({ reset: true })
  await h.until(() => h.pending.length === 1)
  // Call the real retry path directly: the tab watcher cannot fence this request.
  const retry = h.loadFeed()
  h.follows.resolve()
  await retry
  h.pending[0].resolve({ data: [post('late')] })
  await old
  assert.deepEqual(h.posts.value, [])
  assert.equal(h.fetchError.value, 'plaza.loadFailed')
})
