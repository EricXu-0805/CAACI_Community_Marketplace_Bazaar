import { test, expect, type Page } from '@playwright/test'
import { installTopicFixture, text, topicUrl, AUTHOR, READER, TOPIC } from './community-topic-fixture'

/*
 * D-54 2f (SPEC 6.8): a reply names the reply it answers. A thread is one
 * level deep, so parent_comment_id is the reply the thread hangs under; the
 * reply that was actually answered goes in reply_to_comment_id, and the server
 * tells its author. Both places a member can reply from send it: the topic
 * page and the reply sheet of an update in the community list.
 */
const THIRD = '99999999-9999-4999-8999-999999999999'
const profile = (id: string, nickname: string) => ({ id, nickname, avatar_url: null, is_illini_verified: true, uid: nickname.toLowerCase() })
const UPDATE = { ...TOPIC, id: '66666666-6666-4666-8666-666666666666', title: null, category: null, content: 'A campus update without a title', comment_count: 2 }
const thread = (postId: string) => {
  const top = {
    id: '44444444-4444-4444-8444-000000000001', post_id: postId, user_id: AUTHOR, content: 'The first reply',
    content_i18n: null, parent_comment_id: null, like_count: 0, created_at: '2026-11-02T00:00:00Z', profile: profile(AUTHOR, 'Thread Starter'),
  }
  const nested = {
    ...top, id: '44444444-4444-4444-8444-000000000002', user_id: THIRD, content: 'A reply inside the thread',
    parent_comment_id: top.id, created_at: '2026-11-02T00:01:00Z', profile: profile(THIRD, 'Nested Author'),
  }
  return { top, nested }
}

// Serves the two replies and records what the page writes.
async function serveReplies(page: Page, postId: string) {
  const { top, nested } = thread(postId)
  const writes: Record<string, unknown>[] = []
  await page.route('**/rest/v1/post_comments?**', route => {
    const request = route.request()
    if (request.method() !== 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([nested, top]) })
    }
    const body = request.postDataJSON()
    writes.push(body)
    return route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({
        id: `44444444-4444-4444-8444-0000000001${String(writes.length).padStart(2, '0')}`, post_id: body.post_id, user_id: body.user_id,
        content: body.content, content_i18n: null, parent_comment_id: body.parent_comment_id, like_count: 0,
        created_at: new Date().toISOString(), profile: profile(READER, 'Reader'),
      }),
    })
  })
  return { top, nested, writes }
}

test('the topic page sends the reply that was answered, inside a thread and at its head', async ({ page }) => {
  await installTopicFixture(page)
  const { top, nested, writes } = await serveReplies(page, TOPIC.id)
  await page.goto(topicUrl(), { waitUntil: 'networkidle' })
  const input = page.locator('.input-wrapper input')

  // An answer to the reply inside the thread: the thread stays the parent, the answered reply is named.
  await page.locator('.cs-item-child .cs-reply-btn').click()
  await expect(page.locator('.reply-bar')).toContainText('Nested Author')
  await input.fill('Thanks, that settles it')
  await page.locator('.send-btn').click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toMatchObject({ post_id: TOPIC.id, user_id: READER, parent_comment_id: top.id, reply_to_comment_id: nested.id })

  // An answer to the reply the thread hangs under names that reply.
  await expect(input).toHaveValue('')
  await page.locator('.cs-item:not(.cs-item-child) .cs-reply-btn').first().click()
  await expect(page.locator('.reply-bar')).toContainText('Thread Starter')
  await input.fill('And a question for you')
  await page.locator('.send-btn').click()
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1]).toMatchObject({ parent_comment_id: top.id, reply_to_comment_id: top.id })

  // A reply to the topic itself answers no reply.
  await expect(input).toHaveValue('')
  await input.fill('A new thought on the topic')
  await page.locator('.send-btn').click()
  await expect.poll(() => writes.length).toBe(3)
  expect(writes[2]).toMatchObject({ parent_comment_id: null, reply_to_comment_id: null })
})

test('the reply sheet in the community list sends the reply that was answered', async ({ page }) => {
  await installTopicFixture(page)
  await page.route('**/rest/v1/posts?**', route => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/1' }, body: JSON.stringify([UPDATE]),
  }))
  const { top, nested, writes } = await serveReplies(page, UPDATE.id)
  await page.goto('/#/pages/plaza/index?view=all', { waitUntil: 'networkidle' })
  await page.locator('.post-card').getByRole('button', { name: text('a11y.comment'), exact: true }).click()
  const sheet = page.locator('.comment-sheet')
  await expect(sheet.locator('.cs-item-child')).toContainText(nested.content)

  await sheet.locator('.cs-item-child .cs-reply-btn').click()
  await expect(sheet.locator('.ci-reply-bar')).toContainText('Nested Author')
  await sheet.locator('textarea').fill('Thanks, that settles it')
  await sheet.locator('.ci-send').click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toMatchObject({ post_id: UPDATE.id, user_id: READER, parent_comment_id: top.id, reply_to_comment_id: nested.id })

  await sheet.locator('.cs-item:not(.cs-item-child) .cs-reply-btn').first().click()
  await expect(sheet.locator('.ci-reply-bar')).toContainText('Thread Starter')
  await sheet.locator('textarea').fill('And a question for you')
  await sheet.locator('.ci-send').click()
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1]).toMatchObject({ parent_comment_id: top.id, reply_to_comment_id: top.id })
})
