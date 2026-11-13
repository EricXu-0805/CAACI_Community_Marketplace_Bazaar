import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { now, categories, makePosts, items } from './fixtures/community-home/helpers.mjs'

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const compile = input => ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText
const ref = value => ({ value })
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

function harness() {
  const posts = makePosts(60).map(post => ({ ...post, comment_count: 3 }))
  const weekly = posts.map(({ id, category, comment_count }) => ({ id, category, comment_count }))
  const replies = posts.flatMap(post => ['one', 'two', 'one'].map(user_id => ({ post_id: post.id, user_id })))
  let active = 0, peak = 0
  const pending = []
  const supabase = {
    from(table) {
      const args = { table }
      const chain = new Proxy({}, {
        get(_, method) {
          if (method === 'then') return (resolve, reject) => {
            active += 1
            peak = Math.max(peak, active)
            return new Promise(done => pending.push(() => {
              active -= 1
              let data
              if (table === 'items') data = items
              else if (table === 'post_comments') data = replies
              else if (args.head) data = null
              else if (args.select === 'id, category, comment_count') data = weekly
              else data = posts.filter(post => !args.category || post.category === args.category).slice(0, args.limit)
              done({ data, count: args.head ? 99 : null, error: null })
            })).then(resolve, reject)
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
  }
  const mocks = {
    ref, useSupabase: () => ({ supabase }),
    useAuth: () => ({ currentUser: ref({ id: 'reader' }) }),
    useModeration: () => ({ ensureLoaded: async () => ({ ok: true }), blockedIds: ref(new Set()) }),
    POST_CATEGORIES: categories, ACTIVE_REGION: 'champaign', sanitizeItemResources: item => item,
    Date: class extends Date { static now() { return now } },
  }
  const input = source('composables/useCommunityHome.ts').replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  const home = new Function(...Object.keys(mocks),
    `${compile(input).replace(/\bexport /g, '')}; return useCommunityHome()`)(...Object.values(mocks))
  return {
    ...home, peak: () => peak,
    async finish() {
      await tick()
      while (pending.length) {
        pending.splice(0).forEach(done => done())
        await tick()
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

test('signed-in home keeps at most six request-layer reads in flight, including replies', async () => {
  const h = harness()
  const load = h.loadHome()
  await h.finish()
  await load
  assert.equal(h.homeFailed.value, false)
  assert.ok(h.peak() <= 6, `maximum in flight: ${h.peak()}`)
})

test('control: bounded loading assembles identical feeds, counts, listings and reply membership', async () => {
  const h = harness()
  const load = h.loadHome()
  await h.finish()
  await load
  assert.deepEqual(h.homeData.value, h.expected)
})

test('overlapping home reloads share the six-request budget and retain the latest snapshot', async () => {
  const h = harness()
  const old = h.loadHome()
  await tick()
  h.clearHome()
  const fresh = h.loadHome()
  await h.finish()
  await Promise.all([old, fresh])
  assert.deepEqual(h.homeData.value, h.expected)
  assert.ok(h.peak() <= 6, `maximum overlapping in flight: ${h.peak()}`)
})
