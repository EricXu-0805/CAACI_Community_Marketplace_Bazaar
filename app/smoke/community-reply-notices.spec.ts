import { test, expect } from '@playwright/test'
import { installTopicFixture, text, AUTHOR, READER, TOPIC } from './community-topic-fixture'

/*
 * P3.3 (SPEC 6.8): reply notices in "我的 → 通知". Replies in a watched topic
 * are one line per topic with a count, a reply to a reply names who wrote it,
 * a line opens its topic at the reply, and a topic that can no longer be read
 * says so instead of opening.
 */
const GONE = '66666666-6666-4666-8666-666666666666'
const at = (second: number) => `2026-11-02T00:00:${String(second).padStart(2, '0')}.123456+00:00`
const id = (n: number) => `77777777-7777-4777-8777-${String(n).padStart(12, '0')}`
const notice = (n: number, body: string, is_read = false) => ({
  id: id(n), user_id: READER, type: 'post_comment', title: '收到新评论 · New comment', body,
  item_id: null, conversation_id: null, is_read, created_at: at(n),
})
// A reply on the topic page, written at the instant its notice carries.
const reply = (n: number) => ({
  id: `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`, post_id: TOPIC.id, user_id: AUTHOR, content: `Reply ${n}`,
  content_i18n: null, parent_comment_id: null, like_count: 0, created_at: at(n),
  profile: { id: AUTHOR, nickname: 'Bob', avatar_url: null, is_illini_verified: true, uid: 'bob' },
})
const fill = (key: string, values: Record<string, string | number>, form = 0) => text(key).split('|')[form]
  .replace(/\{(\w+)\}/g, (_, name) => String(values[name]))

// SPEC 6.8 says a line whose topic is gone says so and stays. That has to hold when the list could not
// look its topics up: the line is plain then, and a tap asks about its own topic before it opens anything.
test('when the list could not look its topics up, a tapped line still finds out whether its topic is gone', async ({ page }) => {
  await installTopicFixture(page)
  const rows = [notice(9, `followed_post_reply:${TOPIC.id}`), notice(4, `followed_post_reply:${GONE}`)]
  await page.route(/\/rest\/v1\/notifications(?:\?|$)/, route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 204 })
    : route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'content-range': `0-${rows.length - 1}/${rows.length}` }, body: JSON.stringify(rows),
    }))
  await page.route('**/rest/v1/post_comments?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([reply(9)]) }))
  // The list's own lookup of titles fails; one made for a single line later works.
  let down = true
  await page.route('**/rest/v1/posts?**', route => {
    const title = new URL(route.request().url()).searchParams.get('select') === 'id,title,content'
    return down && title
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: '57014', message: 'canceling statement due to statement timeout' }) })
      : route.fallback()
  })
  await page.goto('/#/pages/notifications/index', { waitUntil: 'networkidle' })
  const lines = page.locator('.notif-item')
  await expect(lines.locator('.notif-body')).toHaveText([text('notif.followedReplyPlain'), text('notif.followedReplyPlain')])

  down = false
  await lines.nth(1).click()
  await expect(page.getByText(text('notif.targetGone'), { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/pages\/notifications\/index/)
  await lines.nth(0).click()
  await expect(page).toHaveURL(new RegExp(`pages/post/index\\?id=${TOPIC.id}&reply_at=`))
})

test('reply notices are merged per watched topic, name the replier, and open the topic at the reply', async ({ page }) => {
  const fixture = await installTopicFixture(page)
  fixture.topic.title = 'Where to buy a cheap desk near campus'
  const title = 'Where to buy a cheap'
  const rows = [
    notice(9, `followed_post_reply:${TOPIC.id}`),
    notice(8, `comment_reply:${TOPIC.id}`),
    notice(7, `followed_post_reply:${TOPIC.id}`),
    notice(5, `followed_post_reply:${TOPIC.id}`),
    notice(4, `followed_post_reply:${GONE}`),
    notice(3, `followed_post_reply:${TOPIC.id}`, true),
  ]
  const read: string[] = []
  await page.route(/\/rest\/v1\/notifications(?:\?|$)/, route => {
    const request = route.request()
    if (request.method() === 'PATCH') {
      const target = new URL(request.url()).searchParams.get('id')?.replace('eq.', '')
      const row = rows.find(candidate => candidate.id === target)
      if (row) { row.is_read = true; read.push(row.id) }
      return route.fulfill({ status: 204 })
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': `0-${rows.length - 1}/${rows.filter(row => !row.is_read).length}` },
      body: JSON.stringify(rows),
    })
  })
  // The list asks only who wrote the reply at one instant; the topic page asks for the replies themselves.
  await page.route('**/rest/v1/post_comments?**', route => {
    const select = new URL(route.request().url()).searchParams.get('select') || ''
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(select.includes('content')
        ? [5, 7, 8, 9].map(reply)
        : [{ post_id: TOPIC.id, created_at: at(8), profile: { nickname: 'Bob' } }]),
    })
  })

  await page.goto('/#/pages/notifications/index', { waitUntil: 'networkidle' })
  const lines = page.locator('.notif-item')
  await expect(lines.locator('.notif-body')).toHaveText([
    fill('notif.followedReply', { n: 3, title }, 1),
    fill('notif.commentReply', { name: 'Bob', title }),
    text('notif.followedReplyPlain'),
    fill('notif.followedReply', { n: 1, title }, 0),
  ])
  await expect(lines.nth(0)).toHaveClass(/unread/)
  await expect(lines.nth(3)).not.toHaveClass(/unread/)
  await expect(lines.nth(0)).toHaveAttribute('aria-label', new RegExp(fill('notif.followedReply', { n: 3, title }, 1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  // The hidden or deleted topic keeps its line; a tap says it is gone and stays here.
  await lines.nth(2).click()
  await expect(page.getByText(text('notif.targetGone'), { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/pages\/notifications\/index/)
  await expect.poll(() => read).toEqual([id(4)])

  // The merged line opens the topic at the earliest reply not yet read, and reads all three.
  await lines.nth(0).click()
  await expect(page).toHaveURL(new RegExp(`pages/post/index\\?id=${TOPIC.id}&reply_at=`))
  await expect(page.locator(`[id="reply-${reply(5).id}"]`)).toHaveClass(/cs-item--anchor/)
  await expect.poll(() => [...read].sort()).toEqual([id(4), id(5), id(7), id(9)])

  // Back in the list the line is still one line: read, with the earlier read reply counted in.
  await page.goBack()
  await expect(lines.locator('.notif-body')).toHaveText([
    fill('notif.followedReply', { n: 4, title }, 1),
    fill('notif.commentReply', { name: 'Bob', title }),
    text('notif.followedReplyPlain'),
  ])
  await expect(lines.nth(0)).not.toHaveClass(/unread/)
  await expect(lines.nth(1)).toHaveClass(/unread/)
})
