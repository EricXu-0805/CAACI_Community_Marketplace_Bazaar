import { test, expect } from '@playwright/test'
import { installTopicFixture, text, topicUrl, AUTHOR, TOPIC } from './community-topic-fixture'

/*
 * P3.6 (SPEC 6.10): what the reporter, the author and everybody else see
 * before and after a topic is hidden; and P3.5's closed topic.
 */
const hiddenRow = { id: TOPIC.id, title: TOPIC.title, category: TOPIC.category, content: TOPIC.content, created_at: TOPIC.created_at }

for (const width of [390, 1280]) {
  test(`the reporter is told when the report will be looked at, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await installTopicFixture(page)
    const reports: unknown[] = []
    await page.route(/\/rest\/v1\/reports(?:\?|$)/, route => {
      if (route.request().method() === 'POST') reports.push(route.request().postDataJSON())
      return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' })
    })
    await page.goto(topicUrl(), { waitUntil: 'networkidle' })
    // The topic's menu: a long press on a phone, the menu key on a keyboard.
    await page.locator('.post-card').press('ContextMenu')
    await page.getByText(text('report.reportPost'), { exact: true }).click()
    await page.getByText(text('report.reasonSpam'), { exact: true }).click()
    await expect(page.getByText(text('report.thanksCommunity'), { exact: true })).toBeVisible()
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ target_type: 'post', target_id: TOPIC.id })
  })

  test(`a third person sees only that a hidden topic was hidden, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const fixture = await installTopicFixture(page)
    fixture.topic.visible = false
    fixture.state = 'hidden'
    await page.goto(topicUrl(), { waitUntil: 'networkidle' })
    await expect(page.locator('[data-test=hidden-notice]')).toContainText(text('plaza.hidden'))
    // No title, no author, no image, no reply box.
    await expect(page.getByText(TOPIC.title)).toHaveCount(0)
    await expect(page.getByText('Topic Author')).toHaveCount(0)
    await expect(page.getByText(TOPIC.content)).toHaveCount(0)
    await expect(page.locator('.post-img, .post-card, .input-wrapper, [data-test=hidden-own]')).toHaveCount(0)
  })

  test(`the author sees their own text greyed out, the reason and how to appeal, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const fixture = await installTopicFixture(page, { user: AUTHOR })
    fixture.topic.visible = false
    fixture.state = 'hidden'
    fixture.ownHidden = [{ ...hiddenRow, hidden_reason: 'Personal information in the photo' }]
    await page.goto(topicUrl(), { waitUntil: 'networkidle' })
    const own = page.locator('[data-test=hidden-own]')
    await expect(own.locator('.hidden-banner-t')).toHaveText(text('plaza.hiddenOwner').replace('{reason}', 'Personal information in the photo'))
    await expect(own.locator('.hidden-appeal')).toHaveText(text('plaza.appeal'))
    await expect(own.locator('.hidden-text')).toHaveText([TOPIC.title, TOPIC.content])
    expect(Number(await own.locator('.hidden-text').first().evaluate(node => getComputedStyle(node).opacity))).toBeLessThan(1)
    await expect(page.locator('.input-wrapper, [data-test=hidden-notice]')).toHaveCount(0)

    // Without a recorded reason the sentence has no dangling "Reason:".
    fixture.ownHidden = [{ ...hiddenRow, hidden_reason: null }]
    await page.reload({ waitUntil: 'networkidle' })
    await expect(own.locator('.hidden-banner-t')).toHaveText(text('plaza.hiddenOwnerNoReason'))
  })
}

test('a deleted topic says it was deleted, for the author as well', async ({ page }) => {
  const fixture = await installTopicFixture(page, { user: AUTHOR })
  fixture.topic.visible = false
  fixture.state = 'missing'
  await page.goto(topicUrl(), { waitUntil: 'networkidle' })
  await expect(page.locator('.not-found')).toContainText(text('plaza.notFound'))
  await expect(page.locator('[data-test=hidden-notice], [data-test=hidden-own]')).toHaveCount(0)
})

test('a topic closed to replies shows the notice in place of the reply box', async ({ page }) => {
  const fixture = await installTopicFixture(page)
  fixture.topic.locked_at = '2026-11-10T00:00:00Z'
  await page.goto(topicUrl(), { waitUntil: 'networkidle' })
  await expect(page.locator('[data-test=reply-locked]')).toHaveText(text('plaza.locked'))
  await expect(page.locator('.input-wrapper input')).toHaveCount(0)
  // Watching and saving do not depend on replies being open.
  await expect(page.locator('[data-test=topic-watch]')).toBeVisible()
})

test('a reply refused because the topic was just closed switches to the closed notice', async ({ page }) => {
  await installTopicFixture(page)
  await page.route('**/rest/v1/post_comments?**', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'post_locked', details: null, hint: null }) })
    : route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.goto(topicUrl(), { waitUntil: 'networkidle' })
  await page.locator('.input-wrapper input').fill('A reply that arrives too late')
  await page.locator('.send-btn').click()
  await expect(page.locator('[data-test=reply-locked]')).toHaveText(text('plaza.locked'))
  await expect(page.locator('.input-wrapper input')).toHaveCount(0)
})

test('a notification link scrolls to its reply and marks it for a moment', async ({ page }) => {
  await installTopicFixture(page)
  const replies = Array.from({ length: 12 }, (_, n) => ({
    id: `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`, post_id: TOPIC.id, user_id: AUTHOR, content: `Reply number ${n}`,
    content_i18n: null, parent_comment_id: null, like_count: 0, created_at: `2026-11-02T00:00:${String(n).padStart(2, '0')}.123456+00:00`,
    profile: { id: AUTHOR, nickname: 'Topic Author', avatar_url: null, is_illini_verified: true, uid: 'author' },
  }))
  await page.route('**/rest/v1/post_comments?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replies) }))
  await page.goto(topicUrl(`&reply_at=${encodeURIComponent(replies[9].created_at)}`), { waitUntil: 'networkidle' })
  const target = page.locator(`[id="reply-${replies[9].id}"]`)
  await expect(target).toHaveClass(/cs-item--anchor/)
  await expect(target).toBeInViewport()
  await expect(page.locator('.cs-item--anchor')).toHaveCount(1)
  // The mark is temporary: the page returns to its ordinary look on its own.
  await expect(target).not.toHaveClass(/cs-item--anchor/, { timeout: 5000 })
})
