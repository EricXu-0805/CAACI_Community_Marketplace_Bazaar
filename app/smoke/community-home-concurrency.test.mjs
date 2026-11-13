import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter, once } from 'node:events'
import ts from 'typescript'
import { now, categories, makePosts, items } from './fixtures/community-home/helpers.mjs'

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const compile = input => ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText
const ref = value => ({ value })
const options = { timeout: 4000 }

function forPlatform(input, platform) {
  const enabled = [true]
  return input.split('\n').filter(line => {
    const start = line.match(/^\s*\/\/\s*#(ifdef|ifndef)\s+(.+)$/)
    if (start) {
      const matches = start[2].split(/\s*\|\|\s*/).includes(platform)
      enabled.push(enabled.at(-1) && (start[1] === 'ifdef' ? matches : !matches))
      return false
    }
    if (/^\s*\/\/\s*#endif/.test(line)) { enabled.pop(); return false }
    return enabled.at(-1)
  }).join('\n')
}

function harness(platform = 'MP-WEIXIN', fault = null) {
  const posts = makePosts(60).map(post => ({ ...post, comment_count: 3 }))
  const weekly = posts.map(({ id, category, comment_count }) => ({ id, category, comment_count }))
  const replies = posts.flatMap(post => ['one', 'two', 'one'].map(user_id => ({ post_id: post.id, user_id })))
  const events = new EventEmitter()
  const requests = [], loads = new Set()
  let active = 0, peak = 0, ownerId = 0, injected = false
  const client = owner => ({
    from(table) {
      if (fault === 'throw' && !injected) {
        injected = true
        throw new Error('query construction failed')
      }
      const args = { owner, table }
      const chain = new Proxy({}, {
        get(_, method) {
          if (method === 'then') return (resolve, reject) => {
            active += 1
            peak = Math.max(peak, active)
            const fail = fault === 'read' && !injected
            if (fail) injected = true
            let finish
            const response = new Promise(done => { finish = done })
            const request = {
              ...args, settled: false,
              finish() {
                assert.equal(request.settled, false)
                request.settled = true
                active -= 1
                let data
                if (table === 'items') data = items
                else if (table === 'post_comments') data = replies
                else if (args.head) data = null
                else if (args.select === 'id, category, comment_count') data = weekly
                else data = posts.filter(post => !args.category || post.category === args.category).slice(0, args.limit)
                finish({ data, count: args.head ? 99 : null, error: fail ? { message: 'read failed' } : null })
                events.emit('change')
              },
            }
            requests.push(request)
            events.emit('change')
            return response.then(resolve, reject)
          }
          return (...values) => {
            if (method === 'select') { args.select = values[0]; args.head = values[1]?.head }
            if (method === 'eq' && values[0] === 'category') args.category = values[1]
            if (method === 'limit') args.limit = values[0]
            return chain
          }
        },
      })
      return chain
    },
  })
  const mocks = {
    ref, useSupabase: () => ({ supabase: client(++ownerId) }),
    useAuth: () => ({ currentUser: ref({ id: 'reader' }) }),
    useModeration: () => ({ ensureLoaded: async () => ({ ok: true }), blockedIds: ref(new Set()) }),
    POST_CATEGORIES: categories, ACTIVE_REGION: 'champaign', sanitizeItemResources: item => item,
    Date: class extends Date { static now() { return now } },
  }
  const input = forPlatform(source('composables/useCommunityHome.ts'), platform)
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  const createHome = new Function(...Object.keys(mocks),
    `${compile(input).replace(/\bexport /g, '')}; return useCommunityHome`)(...Object.values(mocks))
  return {
    createHome, requests, peak: () => peak, resetPeak: () => { peak = active },
    run(home) {
      const promise = home.loadHome()
      loads.add(promise)
      void promise.finally(() => { loads.delete(promise); events.emit('change') })
      return promise
    },
    async started(count) {
      while (requests.length < count) await once(events, 'change')
    },
    async finish() {
      while (loads.size || requests.some(request => !request.settled)) {
        const changed = once(events, 'change')
        requests.filter(request => !request.settled).forEach(request => request.finish())
        await changed
      }
    },
    expected: {
      posts: {
        candidates: [posts.slice(0, 40), ...categories.map(category => posts.filter(post => post.category === category).slice(0, 8))]
          .flat().map(post => ({ ...post, reply_user_ids: ['one', 'two', 'one'] })),
        weeklyCategories: weekly, totalDiscussionCount: 99,
      },
      items, now,
    },
  }
}

for (const [platform, peak] of [['MP-WEIXIN', 6], ['H5', 9]]) {
  test(`${platform} loads the same snapshot with ${peak} initial reads in flight`, options, async () => {
    const h = harness(platform), home = h.createHome()
    h.run(home)
    await h.finish()
    assert.equal(h.peak(), peak)
    assert.deepEqual(home.homeData.value, h.expected)
  })
}

for (const restart of [false, true]) {
  test(`invalidated MP reads do not start after acquiring a slot (${restart ? 'reload' : 'clear'})`, options, async () => {
    const h = harness(), home = h.createHome()
    h.run(home)
    await h.started(6)
    if (restart) h.run(home)
    else home.clearHome()
    await h.finish()
    // Six old reads were sent before invalidation. Only a fresh round, if any,
    // sends the nine initial reads and the one replies read after that.
    assert.equal(h.requests.length, restart ? 16 : 6)
    assert.equal(h.peak(), 6)
    assert.deepEqual(home.homeData.value, restart ? h.expected : null)
  })
}

for (const failure of ['read', 'throw']) {
  test(`a ${failure} failure returns all MP slots for the next load`, options, async () => {
    const h = harness('MP-WEIXIN', failure), home = h.createHome()
    h.run(home)
    await h.finish()
    assert.equal(home.homeFailed.value, true)
    h.resetPeak()
    h.run(home)
    await h.finish()
    assert.equal(h.peak(), 6)
    assert.equal(home.homeFailed.value, false)
    assert.deepEqual(home.homeData.value, h.expected)
  })
}

test('two MP home instances share one six-request budget', options, async () => {
  const h = harness(), first = h.createHome(), second = h.createHome()
  h.run(first)
  h.run(second)
  await h.finish()
  assert.equal(h.peak(), 6)
  assert.deepEqual(first.homeData.value, h.expected)
  assert.deepEqual(second.homeData.value, h.expected)
})

test('the reply query waits for a slot while another MP instance fills the budget', options, async () => {
  const h = harness(), first = h.createHome(), second = h.createHome()
  h.run(first)
  await h.started(6)
  h.requests.filter(request => !request.settled).forEach(request => request.finish())
  await h.started(9)
  h.run(second)
  await h.started(12)
  // First has only its last three initial reads left. Releasing them makes its
  // reply query eligible while handing all slots to the second instance.
  h.requests.filter(request => request.owner === 1 && !request.settled).forEach(request => request.finish())
  await h.started(15)
  await h.finish()
  assert.equal(h.peak(), 6)
  assert.equal(h.requests.filter(request => request.table === 'post_comments').length, 2)
  assert.deepEqual(first.homeData.value, h.expected)
  assert.deepEqual(second.homeData.value, h.expected)
})
