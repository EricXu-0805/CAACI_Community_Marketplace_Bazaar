import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { postgrestDouble, moduleUrl } from './postgrest-double.mjs'

/*
 * P3.2: watching and saving a topic, and the member's own lists. The
 * composable runs here against a recorded PostgREST double, so what is
 * asserted is the exact tables, columns and filters it sends.
 */
const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const compile = input => moduleUrl(ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText)

const USER = '11111111-1111-4111-8111-111111111111'
const POST = '22222222-2222-4222-8222-222222222222'
const state = Object.assign(postgrestDouble(), { current: true })
globalThis.__topicListsTest = state
const { useTopicLists, topicRowTitle, markedTopicRows, ownTopicRows } = await import(compile(source('composables/useTopicLists.ts')
  .replace("'./useSupabase'", `'${moduleUrl('export const useSupabase = () => ({ supabase: globalThis.__topicListsTest.supabase })')}'`)
  .replace("'./accountScope'", `'${moduleUrl('export const captureAccountRequest = userId => ({ userId }); export const isAccountRequestCurrent = () => globalThis.__topicListsTest.current')}'`)))
const lists = useTopicLists()
const reset = answers => { state.reset(answers); state.current = true }
const row = (id, created_at, extra = {}) => ({ id, title: `Topic ${id}`, category: 'campus-life', content: 'Body', comment_count: 0, created_at, ...extra })

test('a watch and a save write one private row each, in their own tables', async () => {
  reset()
  await lists.setTopicMark(USER, POST, 'watch', true)
  await lists.setTopicMark(USER, POST, 'save', true)
  assert.deepEqual(state.calls, [
    { table: 'post_follows', steps: [['insert', { user_id: USER, post_id: POST }]] },
    { table: 'post_bookmarks', steps: [['insert', { user_id: USER, post_id: POST }]] },
  ])
  reset()
  await lists.setTopicMark(USER, POST, 'watch', false)
  await lists.setTopicMark(USER, POST, 'save', false)
  assert.deepEqual(state.calls, [
    { table: 'post_follows', steps: [['delete'], ['eq', 'user_id', USER], ['eq', 'post_id', POST]] },
    { table: 'post_bookmarks', steps: [['delete'], ['eq', 'user_id', USER], ['eq', 'post_id', POST]] },
  ])
})

test('a repeated tap is already the state asked for; any other refusal is reported', async () => {
  reset({ post_bookmarks: [{ data: null, error: { code: '23505', message: 'duplicate key' } }] })
  await lists.setTopicMark(USER, POST, 'save', true)
  reset({ post_follows: [{ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }] })
  await assert.rejects(lists.setTopicMark(USER, POST, 'watch', true), { code: '42501' })
  // Removing a mark never treats a duplicate-key answer as success.
  reset({ post_follows: [{ data: null, error: { code: '23505', message: 'unexpected' } }] })
  await assert.rejects(lists.setTopicMark(USER, POST, 'watch', false), { code: '23505' })
})

test('the marks on one topic are read for the signed-in member only', async () => {
  reset({ post_follows: [{ data: { post_id: POST }, error: null }] })
  assert.deepEqual(await lists.loadTopicMarks(USER, POST), { watch: true, save: false })
  assert.deepEqual(state.calls.map(call => [call.table, ...call.steps.filter(step => step[0] === 'eq').map(step => step.slice(1))]), [
    ['post_follows', ['user_id', USER], ['post_id', POST]],
    ['post_bookmarks', ['user_id', USER], ['post_id', POST]],
  ])
  // An answer that arrives after the account changed says nothing about the new account.
  reset({ post_follows: [{ data: { post_id: POST }, error: null }], post_bookmarks: [{ data: { post_id: POST }, error: null }] })
  state.current = false
  assert.deepEqual(await lists.loadTopicMarks(USER, POST), { watch: false, save: false })
  reset({ post_bookmarks: [{ data: null, error: { code: '500', message: 'down' } }] })
  await assert.rejects(lists.loadTopicMarks(USER, POST), { message: 'down' })
})

test('saved and watched lists are newest first and leave out topics that are no longer visible', async () => {
  reset({ post_bookmarks: [{ data: [{ created_at: '2026-11-03T00:00:00Z', post: row('b', '2026-11-01T00:00:00Z') },
    { created_at: '2026-11-02T00:00:00Z', post: null },
    { created_at: '2026-11-01T00:00:00Z', post: row('a', '2026-10-01T00:00:00Z') }], error: null }] })
  assert.deepEqual((await lists.fetchMarkedTopics(USER, 'save')).map(topic => topic.id), ['b', 'a'])
  assert.equal(state.calls[0].table, 'post_bookmarks')
  assert.deepEqual(state.calls[0].steps.slice(1), [['eq', 'user_id', USER], ['order', 'created_at', { ascending: false }], ['limit', 100]])
  assert.match(state.calls[0].steps[0][1], /^created_at, post:posts\(id, title, category, content, comment_count, created_at\)$/)
  reset({ post_follows: [{ data: [], error: null }] })
  await lists.fetchMarkedTopics(USER, 'watch')
  assert.equal(state.calls[0].table, 'post_follows')
  assert.deepEqual(markedTopicRows(null), [])
})

test('my topics lists visible and hidden ones together, hidden ones tagged', async () => {
  reset({
    posts: [{ data: [row('new', '2026-11-05T00:00:00Z'), row('old', '2026-11-01T00:00:00Z')], error: null }],
    list_own_hidden_posts: [{ data: [{ id: 'gone', title: 'Hidden one', category: 'campus-life', content: 'Body', created_at: '2026-11-03T00:00:00Z', hidden_reason: 'Spam' }], error: null }],
  })
  const mine = await lists.fetchOwnTopics(USER)
  assert.deepEqual(mine.map(topic => [topic.id, topic.hidden === true, topic.hidden_reason ?? null]),
    [['new', false, null], ['gone', true, 'Spam'], ['old', false, null]])
  assert.deepEqual(state.calls[1], { rpc: 'list_own_hidden_posts', args: {} })
  assert.deepEqual(state.calls[0].steps.filter(step => step[0] === 'eq'), [['eq', 'user_id', USER], ['eq', 'status', 'active']])
  assert.deepEqual(ownTopicRows(null, null), [])
})

test('a topic that cannot be loaded is hidden or missing; only its author gets the text back', async () => {
  for (const [data, expected] of [['hidden', 'hidden'], ['active', 'active'], ['missing', 'missing'], [null, 'missing'], [[], 'missing']]) {
    reset({ community_post_state: [{ data, error: null }] })
    assert.equal(await lists.fetchPostState(POST), expected)
    assert.deepEqual(state.calls, [{ rpc: 'community_post_state', args: { post_id_in: POST } }])
  }
  reset({ list_own_hidden_posts: [{ data: [{ id: POST, title: 'Mine', category: 'campus-life', content: 'Body', created_at: '2026-11-03T00:00:00Z', hidden_reason: null }], error: null }] })
  assert.deepEqual(await lists.fetchOwnHiddenPost(POST), { id: POST, title: 'Mine', category: 'campus-life', content: 'Body',
    created_at: '2026-11-03T00:00:00Z', hidden_reason: null, comment_count: 0, hidden: true })
  assert.deepEqual(state.calls, [{ rpc: 'list_own_hidden_posts', args: { post_id_in: POST } }])
  reset({ list_own_hidden_posts: [{ data: [], error: null }] })
  assert.equal(await lists.fetchOwnHiddenPost(POST), null)
})

test('a list line is the title, or the first 40 characters of an update', () => {
  assert.equal(topicRowTitle({ title: '  Desk wanted  ', content: 'x' }), 'Desk wanted')
  assert.equal(topicRowTitle({ title: null, content: `${'字'.repeat(45)}\nsecond line` }), '字'.repeat(40))
  assert.equal(topicRowTitle({ title: '', content: '' }), '')
})

test('the new page is an H5 route and its own Mini Program subpackage', () => {
  const pages = source('pages.json')
  const route = pages.indexOf('"path": "pages/my-topics/index"')
  const subpackages = pages.indexOf('"subPackages"')
  assert.ok(route > 0 && route < subpackages, 'the H5 route is declared in "pages"')
  // The nearest conditional above the route keeps it out of the Mini Program main package.
  const guard = pages.slice(0, route).match(/\/\/ #(ifndef MP-WEIXIN|ifdef [A-Z0-9-]+|endif)/g).at(-1)
  assert.equal(guard, '// #ifndef MP-WEIXIN')
  assert.ok(pages.indexOf('"root": "pages/my-topics"') > subpackages, 'it has its own subpackage root')
})
