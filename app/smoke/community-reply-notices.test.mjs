import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { postgrestDouble, moduleUrl } from './postgrest-double.mjs'

/*
 * P3.3 (SPEC 6.8): reply notices in the notifications list. The rules run
 * here as shipped, and the one lookup runs against a recorded PostgREST
 * double, so what is asserted is the tables, columns and filters it sends.
 */
const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const compile = input => moduleUrl(ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText)

const double = Object.assign(postgrestDouble(), { reported: [] })
globalThis.__replyNoticesTest = double
const apiUrl = compile(source('api/notifications.ts'))
const { notificationDestination, notificationPostTarget } = await import(apiUrl)
const {
  notificationLines, notificationLineDestination, notificationTopicTitle, replyNoticeKey, fetchReplyNoticeContext,
  loadReplyNoticeContext, noticeTargetGone,
} = await import(compile(source('composables/replyNotices.ts')
  .replace("'./useSupabase'", `'${moduleUrl('export const useSupabase = () => ({ supabase: globalThis.__replyNoticesTest.supabase })')}'`)
  .replace("'../utils/sentry'", `'${moduleUrl('export const captureException = (error, context) => { globalThis.__replyNoticesTest.reported.push({ error, context }) }')}'`)
  .replace("'../api/notifications'", `'${apiUrl}'`)))

const POST = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
const PERSON = '44444444-4444-4444-8444-444444444444'
// The instant a reply was written, as PostgREST prints it.
const at = second => `2026-11-02T00:00:${String(second).padStart(2, '0')}.123456+00:00`
const notice = (n, body, extra = {}) => ({
  id: `n${n}`, user_id: 'me', type: 'post_comment', title: '收到新评论 · New comment', body,
  item_id: null, conversation_id: null, is_read: false, created_at: at(n), ...extra,
})
const link = (post, instant) => `/pages/post/index?id=${post}${instant ? `&reply_at=${encodeURIComponent(instant)}` : ''}`

test('a reply notice opens its topic at the reply it is about', () => {
  for (const key of ['post_comment', 'comment_reply', 'followed_post_reply']) {
    assert.deepEqual(notificationDestination(notice(7, `${key}:${POST}`)), { url: link(POST, at(7)) })
    assert.equal(notificationPostTarget(notice(7, `${key}:${POST}`)), POST)
  }
  // A like is about the topic or the reply as it stands, not about a new reply.
  for (const key of ['post_like', 'post_comment_like']) {
    assert.deepEqual(notificationDestination(notice(7, `${key}:${POST}`)), { url: link(POST) })
    assert.equal(notificationPostTarget(notice(7, `${key}:${POST}`)), POST)
  }
  assert.deepEqual(notificationDestination(notice(7, `new_follower:${PERSON}`)), { url: `/pages/seller/index?id=${PERSON}` })
  // A key that is not on the list opens nothing, however well-formed its target.
  assert.deepEqual(notificationDestination(notice(7, `some_other_reply:${POST}`)), { url: '/pages/notifications/index' })
  for (const body of [`some_other_reply:${POST}`, `new_follower:${PERSON}`, 'Illini Union · 3/5 14:30 CT', '']) {
    assert.equal(notificationPostTarget(notice(7, body)), null)
  }
})

test('replies in a watched topic are one line per topic while unread, and one line once read', () => {
  const rows = [
    notice(9, `followed_post_reply:${POST}`),
    notice(8, `comment_reply:${POST}`),
    notice(7, `followed_post_reply:${OTHER}`),
    notice(6, `followed_post_reply:${POST}`),
    notice(5, `comment_reply:${POST}`),
    notice(4, `followed_post_reply:${POST}`, { is_read: true }),
    notice(3, `post_comment:${POST}`),
    notice(2, `followed_post_reply:${POST}`, { is_read: true }),
    notice(1, `followed_post_reply:${POST}`),
  ]
  assert.deepEqual(notificationLines(rows).map(line => [line.head.id, line.rows.map(row => row.id)]), [
    ['n9', ['n9', 'n6', 'n1']], // every unread reply in the watched topic
    ['n8', ['n8']], // a reply to a reply is never merged
    ['n7', ['n7']], // another topic is another line
    ['n5', ['n5']],
    ['n4', ['n4', 'n2']], // read ones stay together, so reading a line does not scatter it
    ['n3', ['n3']],
  ])
  assert.deepEqual(notificationLines([]), [])
})

test('an unread line opens at its earliest reply, a read line at its latest', () => {
  const pair = extra => [notice(9, `followed_post_reply:${POST}`, extra), notice(6, `followed_post_reply:${POST}`, extra)]
  assert.deepEqual(notificationLineDestination(notificationLines(pair())[0]), { url: link(POST, at(6)) })
  assert.deepEqual(notificationLineDestination(notificationLines(pair({ is_read: true }))[0]), { url: link(POST, at(9)) })
  assert.deepEqual(notificationLineDestination(notificationLines([notice(5, `comment_reply:${POST}`)])[0]), { url: link(POST, at(5)) })
})

test('a title is cut to 20 characters; an update without one uses its first line', () => {
  assert.equal(notificationTopicTitle({ title: '  Desk wanted  ', content: 'x' }), 'Desk wanted')
  assert.equal(notificationTopicTitle({ title: '字'.repeat(25), content: 'x' }), '字'.repeat(20))
  assert.equal(notificationTopicTitle({ title: null, content: `${'😀'.repeat(22)}\nsecond line` }), '😀'.repeat(20))
  assert.equal(notificationTopicTitle({ title: '', content: '' }), '')
})

test('one request for titles and one for names serve the whole list', async () => {
  double.reset({
    posts: [{ data: [{ id: POST, title: 'Where to buy a cheap desk near campus', content: 'Body' }], error: null }],
    post_comments: [{ data: [
      { post_id: POST, created_at: at(8), profile: { nickname: 'Bob' } },
      { post_id: POST, created_at: at(5), profile: null },
    ], error: null }],
  })
  const context = await fetchReplyNoticeContext([
    notice(9, `followed_post_reply:${POST}`), notice(8, `comment_reply:${POST}`), notice(7, `post_like:${OTHER}`),
    notice(5, `comment_reply:${POST}`), notice(4, `new_follower:${PERSON}`), notice(3, '$25.00'),
  ])
  assert.deepEqual(double.calls, [
    { table: 'posts', steps: [['select', 'id, title, content'], ['in', 'id', [POST, OTHER]]] },
    { table: 'post_comments', steps: [
      ['select', 'post_id, created_at, profile:profiles!post_comments_user_id_fkey(nickname)'],
      ['in', 'post_id', [POST]],
      ['in', 'created_at', [at(8), at(5)]],
    ] },
  ])
  assert.deepEqual([...context.titles], [[POST, 'Where to buy a cheap']])
  // OTHER was asked for and did not come back: hidden, deleted or behind a block.
  assert.deepEqual([...context.checked], [POST, OTHER])
  assert.deepEqual([...context.names], [[replyNoticeKey(POST, at(8)), 'Bob']])
  // The same instant written another way is the same reply.
  assert.equal(replyNoticeKey(POST, '2026-11-02T00:00:08.123Z'), replyNoticeKey(POST, at(8)))
  assert.notEqual(replyNoticeKey(OTHER, at(8)), replyNoticeKey(POST, at(8)))
})

test('a list without topic notices asks for nothing; one without replies to replies asks only for titles', async () => {
  double.reset()
  const none = await fetchReplyNoticeContext([notice(4, `new_follower:${PERSON}`), notice(3, '$25.00')])
  assert.deepEqual(double.calls, [])
  assert.deepEqual([none.titles.size, none.names.size, none.checked.size], [0, 0, 0])
  double.reset({ posts: [{ data: [], error: null }] })
  await fetchReplyNoticeContext([notice(9, `followed_post_reply:${POST}`)])
  assert.deepEqual(double.calls.map(call => call.table), ['posts'])
})

test('a failed title lookup is reported; a failed name lookup only costs the names', async () => {
  double.reset({ posts: [{ data: null, error: { message: 'down' } }] })
  await assert.rejects(fetchReplyNoticeContext([notice(9, `followed_post_reply:${POST}`)]), { message: 'down' })
  double.reset({
    posts: [{ data: [{ id: POST, title: 'T', content: '' }], error: null }],
    post_comments: [{ data: null, error: { message: 'down' } }],
  })
  const context = await fetchReplyNoticeContext([notice(8, `comment_reply:${POST}`)])
  assert.deepEqual([...context.titles], [[POST, 'T']])
  assert.equal(context.names.size, 0)
})

// A lookup that failed must not pass for "nothing to say": it is reported, and the question the
// list could not answer is asked again when a line is tapped.
test('a lookup the list could not make is reported and leaves the list without context', async () => {
  const down = { message: 'down' }
  double.reset({ posts: [{ data: null, error: down }] })
  double.reported = []
  assert.equal(await loadReplyNoticeContext([notice(9, `followed_post_reply:${POST}`)]), null)
  assert.deepEqual(double.reported, [{ error: down, context: { tags: { source: 'notifications.reply_context' } } }])
  double.reset({ posts: [{ data: [{ id: POST, title: 'T', content: '' }], error: null }] })
  double.reported = []
  assert.deepEqual([...(await loadReplyNoticeContext([notice(9, `followed_post_reply:${POST}`)])).titles], [[POST, 'T']])
  assert.deepEqual(double.reported, [])
})

test('a tapped line knows whether its topic is gone, asking again when the list could not', async () => {
  const line = (n, body) => ({ head: notice(n, body), rows: [notice(n, body)] })
  const known = { titles: new Map([[POST, 'T']]), names: new Map(), checked: new Set([POST, OTHER]) }
  // What the list already looked up is not asked for again.
  double.reset()
  assert.equal(await noticeTargetGone(line(9, `followed_post_reply:${POST}`), known), false)
  assert.equal(await noticeTargetGone(line(8, `comment_reply:${OTHER}`), known), true)
  assert.equal(await noticeTargetGone(line(7, `new_follower:${PERSON}`), known), false, 'not about a topic')
  assert.deepEqual(double.calls, [])
  // The list has no context, or none for this topic: one lookup for this line.
  for (const context of [null, { titles: new Map(), names: new Map(), checked: new Set() }]) {
    double.reset({ posts: [{ data: [], error: null }] })
    assert.equal(await noticeTargetGone(line(9, `followed_post_reply:${POST}`), context), true)
    assert.deepEqual(double.calls, [{ table: 'posts', steps: [['select', 'id, title, content'], ['in', 'id', [POST]]] }])
    double.reset({ posts: [{ data: [{ id: POST, title: 'T', content: '' }], error: null }] })
    assert.equal(await noticeTargetGone(line(9, `followed_post_reply:${POST}`), context), false)
  }
  // Still unreadable: unknown, which is neither "gone" nor "there". The topic page will say which.
  double.reset({ posts: [{ data: null, error: { message: 'down' } }] })
  double.reported = []
  assert.equal(await noticeTargetGone(line(9, `followed_post_reply:${POST}`), null), null)
  assert.equal(double.reported.length, 1)
})

test('a toast, or a line whose topic cannot be read, has plain wording for both keys', () => {
  const sentinels = /const BODY_SENTINEL_KEYS[^{]*\{([\s\S]*?)\n\}/.exec(source('composables/useNotifications.ts'))[1]
  const en = source('composables/i18n/messages/en.ts')
  for (const key of ['comment_reply', 'followed_post_reply']) {
    const message = new RegExp(`\\b${key}: '([^']+)'`).exec(sentinels)
    assert.ok(message, `${key} would be shown as its raw key`)
    // The plain sentence is used where there is no name, title or count to put in.
    assert.match(en, new RegExp(`'${message[1].replace('.', '\\.')}': '[^{}']+'`), `${message[1]} must need no parameters`)
  }
})
