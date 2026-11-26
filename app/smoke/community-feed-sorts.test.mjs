import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { postgrestDouble } from './postgrest-double.mjs'

/*
 * P3.4: what the community list asks the server for under each sort, and how
 * it asks for the next page. The loader runs here as shipped against a
 * recording double. scripts/community-sort-keyset.test.mjs proves on a real
 * database that these same conditions neither repeat nor skip a topic.
 */
const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const compile = input => ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText
const NOW = Date.parse('2026-11-20T12:00:00Z')
const DAY = 86_400_000
const iso = ms => new Date(ms).toISOString()

function harness() {
  const ref = value => ({ value })
  const double = postgrestDouble()
  const mocks = {
    ref, useSupabase: () => ({ supabase: double.supabase }), useAuth: () => ({ currentUser: ref(null) }),
    useModeration: () => ({ blockedIds: ref(new Set()), ensureLoaded: async () => ({ ok: true }) }),
    useI18n: () => ({ t: key => key, lang: ref('en') }),
    onAccountTransition: () => {}, ACTIVE_REGION: 'champaign',
    sanitizePostResources: post => post, friendlyErrorMessage: () => 'failed', expandSearch: query => [query],
  }
  const input = source('composables/usePlaza.ts').replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  const plaza = new Function(...Object.keys(mocks),
    `${compile(input).replace(/\bexport /g, '')}; return usePlaza()`)(...Object.values(mocks))
  return { ...plaza, double }
}

// Topic n was posted n minutes before NOW and last active a minute after that.
const topic = (n, extra = {}) => ({
  id: `topic-${String(n).padStart(3, '0')}`, user_id: 'author', post_items: [], is_pinned: false,
  created_at: iso(NOW - n * 60_000), last_activity_at: iso(NOW - n * 60_000 + 60_000), ...extra,
})
const page = (from, count, extra) => ({ data: Array.from({ length: count }, (_, i) => topic(from + i, extra)), error: null })
const only = (call, ...methods) => call.steps.filter(step => methods.includes(step[0]))
const filters = call => only(call, 'eq', 'in', 'not', 'is', 'gte', 'or')
const orders = call => only(call, 'order').map(step => [step[1], step[2].ascending, step[2].foreignTable].filter(part => part !== undefined))
const paging = call => only(call, 'limit', 'range')
const SCOPE = [['eq', 'status', 'active'], ['eq', 'region', 'champaign']]
const TAIL = [['id', false], ['display_order', true, 'post_items']]

test('each sort asks for its own rows in its own order', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  const first = async options => {
    const h = harness()
    await h.fetchPosts({ reset: true, ...options })
    assert.equal(h.double.calls.length, 1)
    return h.double.calls[0]
  }
  const active = await first({ sort: 'active' })
  assert.deepEqual(filters(active), SCOPE)
  assert.deepEqual(orders(active), [['is_pinned', false], ['last_activity_at', false], ...TAIL])
  assert.deepEqual(paging(active), [['limit', 20]])

  const recent = await first({ sort: 'recent', category: 'campus-life', authors: ['a', 'b'] })
  assert.deepEqual(filters(recent), [...SCOPE, ['eq', 'category', 'campus-life'], ['in', 'user_id', ['a', 'b']]])
  assert.deepEqual(orders(recent), [['is_pinned', false], ['created_at', false], ...TAIL])
  assert.deepEqual(paging(recent), [['limit', 20]])
  // Callers that name no sort keep the order they always had.
  assert.deepEqual(orders(await first({})), orders(recent))

  // SPEC 5.5: a topic nobody but its author has replied to, posted within 30 days.
  const unanswered = await first({ sort: 'unanswered' })
  assert.deepEqual(filters(unanswered), [...SCOPE,
    ['not', 'title', 'is', null], ['is', 'answered_at', null], ['gte', 'created_at', iso(NOW - 30 * DAY)]])
  assert.deepEqual(orders(unanswered), [['is_pinned', false], ['created_at', false], ...TAIL])
  assert.deepEqual(paging(unanswered), [['limit', 20]])

  // 热门 counts only what was posted in the last 14 days, and keeps its offset.
  const hot = await first({ sort: 'hot' })
  assert.deepEqual(filters(hot), [...SCOPE, ['gte', 'created_at', iso(NOW - 14 * DAY)]])
  assert.deepEqual(orders(hot), [['is_pinned', false], ['like_count', false], ['comment_count', false], ['created_at', false], ...TAIL])
  assert.deepEqual(paging(hot), [['range', 0, 19]])
})

for (const [sort, column] of [['active', 'last_activity_at'], ['recent', 'created_at'], ['unanswered', 'created_at']]) {
  test(`the next page of ${sort} starts after the last row instead of counting rows`, async () => {
    const h = harness()
    h.double.reset({ posts: [page(0, 20), page(20, 3)] })
    await h.fetchPosts({ sort, reset: true })
    assert.equal(h.hasMore.value, true)
    await h.fetchPosts({ sort, page: 1 })
    const last = topic(19)
    const next = h.double.calls[1]
    // Pinned rows lead the list, so after an unpinned row only unpinned rows remain.
    assert.deepEqual(filters(next).filter(step => step[0] === 'or' || step[1] === 'is_pinned'), [
      ['eq', 'is_pinned', false],
      ['or', `${column}.lt.${last[column]},and(${column}.eq.${last[column]},id.lt.${last.id})`],
    ])
    assert.deepEqual(orders(next), orders(h.double.calls[0]))
    assert.deepEqual(paging(next), [['limit', 20]])
    assert.deepEqual(h.posts.value.map(post => post.id), Array.from({ length: 23 }, (_, n) => topic(n).id))
    assert.equal(h.hasMore.value, false)
  })
}

test('after a pinned row come the pinned rows behind it, then every unpinned one', async () => {
  const h = harness()
  h.double.reset({ posts: [page(0, 20, { is_pinned: true }), page(20, 1)] })
  await h.fetchPosts({ sort: 'active', reset: true })
  await h.fetchPosts({ sort: 'active', page: 1 })
  const last = topic(19)
  const after = `last_activity_at.lt.${last.last_activity_at},and(last_activity_at.eq.${last.last_activity_at},id.lt.${last.id})`
  assert.deepEqual(filters(h.double.calls[1]).filter(step => step[0] === 'or' || step[1] === 'is_pinned'),
    [['or', `and(is_pinned.eq.true,or(${after})),is_pinned.eq.false`]])
})

test('hot pages by offset; a first page forgets where the last list ended', async () => {
  const h = harness()
  h.double.reset({ posts: [page(0, 20), page(20, 20), page(40, 20), page(0, 20)] })
  await h.fetchPosts({ sort: 'hot', reset: true })
  await h.fetchPosts({ sort: 'hot', page: 1 })
  assert.deepEqual(paging(h.double.calls[1]), [['range', 20, 39]])
  assert.deepEqual(only(h.double.calls[1], 'or'), [])

  await h.fetchPosts({ sort: 'active', reset: true })
  await h.fetchPosts({ sort: 'recent', reset: true })
  const fresh = h.double.calls[3]
  assert.deepEqual(only(fresh, 'or'), [])
  assert.deepEqual(filters(fresh), SCOPE)
})

test('a later page with no first page to continue from asks for nothing', async () => {
  const h = harness()
  await h.fetchPosts({ sort: 'active', page: 1 })
  assert.deepEqual(h.double.calls, [])
  assert.equal(h.hasMore.value, false)
  assert.equal(h.loading.value, false)
})

test('a search passes the sort to the search function and keeps its offset', async () => {
  const h = harness()
  await h.fetchPosts({ search: 'desk', sort: 'unanswered', page: 2, category: 'campus-life' })
  assert.deepEqual(h.double.calls, [{ rpc: 'search_community_posts', args: {
    category_in: 'campus-life', region_in: 'champaign', terms_in: ['desk'], sort_in: 'unanswered', limit_in: 20, offset_in: 40,
  } }])
})
