import { test, expect, type Page } from '@playwright/test'
import { announced, installTopicFixture, text, topicUrl, AUTHOR, TOPIC } from './community-topic-fixture'

/*
 * P3.6 (SPEC 6.10): what the reporter, the author and everybody else see
 * before and after a topic is hidden; and P3.5's closed topic.
 */
const hiddenRow = { id: TOPIC.id, title: TOPIC.title, category: TOPIC.category, content: TOPIC.content, created_at: TOPIC.created_at }
const AUTHOR_PROFILE = { id: AUTHOR, nickname: 'Topic Author', avatar_url: null, is_illini_verified: true, uid: 'author' }
// An update has no title; the community list shows it as a card with its own menu and reply sheet.
const UPDATE = { ...TOPIC, id: '66666666-6666-4666-8666-666666666666', title: null, category: null, content: 'A campus update without a title', comment_count: 1 }
const UPDATE_REPLY = {
  id: '44444444-4444-4444-8444-000000000001', post_id: UPDATE.id, user_id: AUTHOR, content: 'A reply under the update',
  content_i18n: null, parent_comment_id: null, like_count: 0, created_at: '2026-11-02T00:00:00Z', profile: AUTHOR_PROFILE,
}
const answer = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: { 'content-range': '0-0/1' }, body: JSON.stringify(body) })

// The community list with one update in it, and every report the page sends.
async function openListWithUpdate(page: Page, update: Record<string, unknown> = UPDATE) {
  await installTopicFixture(page)
  const reports: Record<string, unknown>[] = []
  await page.route('**/rest/v1/posts?**', route => route.fulfill(answer([update])))
  await page.route('**/rest/v1/post_comments?**', route => route.fulfill(answer([UPDATE_REPLY])))
  await page.route(/\/rest\/v1\/reports(?:\?|$)/, route => {
    if (route.request().method() === 'POST') reports.push(route.request().postDataJSON())
    return route.fulfill(answer([], 201))
  })
  await page.goto('/#/pages/plaza/index?view=all', { waitUntil: 'networkidle' })
  await expect(page.locator('.post-card')).toContainText(UPDATE.content)
  return reports
}
// WCAG contrast of an element's text against the first opaque background behind it.
const contrast = (page: Page, selector: string) => page.locator(selector).first().evaluate(node => {
  const channels = (color: string) => (color.match(/[\d.]+/g) || []).map(Number)
  const luminance = ([r, g, b]: number[]) => [r, g, b].map(value => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
  let behind: Element | null = node
  let background = [255, 255, 255]
  for (; behind; behind = behind.parentElement) {
    const [r, g, b, alpha = 1] = channels(getComputedStyle(behind).backgroundColor)
    if (alpha === 1) { background = [r, g, b]; break }
  }
  const style = getComputedStyle(node)
  const [light, dark] = [luminance(channels(style.color)), luminance(background)].sort((a, b) => b - a)
  return { ratio: (light + 0.05) / (dark + 0.05), opacity: Number(style.opacity), color: style.color }
})

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

  // D-54 2e, 2j: one general sentence and whom to write to. No reason a moderator typed, no appeal
  // button, no mail link: a takedown has no appeal record to open yet.
  test(`the author sees their own text greyed out, one general sentence and whom to contact, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const fixture = await installTopicFixture(page, { user: AUTHOR })
    fixture.topic.visible = false
    fixture.state = 'hidden'
    // A server from before D-54 2e would still send the moderator's note; the page must not show it.
    fixture.ownHidden = [{ ...hiddenRow, hidden_reason: 'Personal information in the photo' }]
    await page.goto(topicUrl(), { waitUntil: 'networkidle' })
    const own = page.locator('[data-test=hidden-own]')
    await expect(own.locator('.hidden-banner-t')).toHaveText([text('plaza.hiddenOwner'), text('plaza.hiddenContact')])
    await expect(page.getByText('Personal information in the photo')).toHaveCount(0)
    await expect(own.locator('.hidden-appeal, a[href^="mailto:"], .hidden-banner [role=button]')).toHaveCount(0)
    expect(await own.innerText(), 'no address to copy either').not.toContain('@')
    await expect(own.locator('.hidden-text')).toHaveText([TOPIC.title, TOPIC.content])
    // Greyed out, and still readable: at least 4.5:1 without leaning on opacity.
    const greyed = await contrast(page, '[data-test=hidden-own] .hidden-text')
    expect(greyed.opacity).toBe(1)
    expect(greyed.ratio).toBeGreaterThanOrEqual(4.5)
    expect(greyed.color).not.toBe((await contrast(page, '[data-test=hidden-own] .hidden-banner-t')).color)
    await expect(page.locator('.input-wrapper, [data-test=hidden-notice]')).toHaveCount(0)
  })
}

// D-54 2i: a state that could not be read is a failed load, never "this topic was deleted".
for (const failing of ['community_post_state', 'list_own_hidden_posts']) {
  test(`when ${failing} cannot be read the author gets a retry, not a deleted topic`, async ({ page }) => {
    const fixture = await installTopicFixture(page, { user: AUTHOR })
    fixture.topic.visible = false
    fixture.state = 'hidden'
    fixture.ownHidden = [hiddenRow]
    let down = true
    await page.route(`**/rest/v1/rpc/${failing}`, route => down
      ? route.fulfill(answer({ code: '57014', message: 'canceling statement due to statement timeout' }, 500))
      : route.fallback())
    await page.goto(topicUrl(), { waitUntil: 'networkidle' })
    const failed = page.locator('.not-found[role=alert]')
    await expect(failed).toContainText(text('error.loadFailed'))
    await expect(page.getByText(text('plaza.notFound'))).toHaveCount(0)
    await expect(page.locator('[data-test=hidden-notice], [data-test=hidden-own]')).toHaveCount(0)
    // The same button loads the page again once the read works.
    down = false
    await failed.getByRole('button', { name: text('home.retry') }).click()
    await expect(page.locator('[data-test=hidden-own] .hidden-text')).toHaveText([TOPIC.title, TOPIC.content])
    await expect(page.locator('.not-found[role=alert]')).toHaveCount(0)
  })
}

// D-54 2g (SPEC 6.10): the same answer wherever a topic, an update or a reply is reported from.
test.describe('a report sent from the community list', () => {
  test.use({ hasTouch: true })
  test('says when it will be looked at', async ({ page }) => {
    const reports = await openListWithUpdate(page)
    // The card's menu opens on a long press: the finger goes down and stays until the menu is there.
    const card = page.locator('.post-card .post-tappable')
    await card.dispatchEvent('touchstart')
    await page.getByText(text('report.reportPost'), { exact: true }).click()
    await card.dispatchEvent('touchend')
    await page.getByText(text('report.reasonSpam'), { exact: true }).click()
    await expect.poll(() => announced(page)).toEqual([text('report.thanksCommunity')])
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ target_type: 'post', target_id: UPDATE.id })
  })
})

test('a reply reported from the list\'s reply sheet gets the same answer; a reported member the old one', async ({ page }) => {
  const reports = await openListWithUpdate(page)
  await page.locator('.post-card').getByRole('button', { name: text('a11y.comment'), exact: true }).click()
  const reply = page.locator('.comment-sheet .cs-item')
  await expect(reply).toContainText(UPDATE_REPLY.content)
  await reply.press('ContextMenu')
  await page.getByText(text('plaza.reportComment'), { exact: true }).click()
  await page.getByText(text('report.reasonSpam'), { exact: true }).click()
  await expect.poll(() => announced(page)).toEqual([text('report.thanksCommunity')])
  expect(reports[0]).toMatchObject({ target_type: 'comment', target_id: UPDATE_REPLY.id })

  // Reporting a member is not a report on a topic or a reply: its wording is unchanged.
  await reply.press('ContextMenu')
  await page.getByText(text('plaza.reportUser'), { exact: true }).click()
  await page.getByText(text('report.reasonSpam'), { exact: true }).click()
  await expect.poll(() => announced(page)).toEqual([text('report.thanksCommunity'), text('report.thanks')])
  expect(reports[1]).toMatchObject({ target_type: 'user', target_id: AUTHOR })
})

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

test('a closed topic offers no reply action that would lead nowhere', async ({ page }) => {
  const fixture = await installTopicFixture(page)
  const replies = [{ ...UPDATE_REPLY, post_id: TOPIC.id }]
  await page.route('**/rest/v1/post_comments?**', route => route.fulfill(answer(replies)))
  await page.goto(topicUrl(), { waitUntil: 'networkidle' })
  await expect(page.locator('.cs-item .cs-reply-btn')).toHaveCount(1)
  fixture.topic.locked_at = '2026-11-10T00:00:00Z'
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('.cs-item')).toContainText(UPDATE_REPLY.content)
  await expect(page.locator('.cs-item .cs-reply-btn')).toHaveCount(0)
  // The menu of a reply still reports it, and no longer offers to answer it.
  await page.locator('.cs-item').press('ContextMenu')
  await expect(page.getByText(text('plaza.reportComment'), { exact: true })).toBeVisible()
  await expect(page.locator('uni-actionsheet').getByText(text('plaza.reply'), { exact: true })).toHaveCount(0)
})

test('the list\'s reply sheet shows that a closed update takes no replies, before anything is typed', async ({ page }) => {
  await openListWithUpdate(page, { ...UPDATE, locked_at: '2026-11-10T00:00:00Z' })
  await page.locator('.post-card').getByRole('button', { name: text('a11y.comment'), exact: true }).click()
  const sheet = page.locator('.comment-sheet')
  await expect(sheet.locator('[data-test=reply-locked]')).toHaveText(text('plaza.locked'))
  await expect(sheet.locator('textarea, .ci-send, .cs-reply-btn')).toHaveCount(0)
  await expect(sheet.locator('.cs-item')).toContainText(UPDATE_REPLY.content)
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

test('a notification link whose reply is not among the loaded ones says so', async ({ page }) => {
  await installTopicFixture(page)
  await page.route('**/rest/v1/post_comments?**', route => route.fulfill(answer([{ ...UPDATE_REPLY, post_id: TOPIC.id }])))
  await page.goto(topicUrl(`&reply_at=${encodeURIComponent('2026-11-09T09:09:09.000000+00:00')}`), { waitUntil: 'networkidle' })
  await expect.poll(() => announced(page)).toEqual([text('plaza.replyNotFound')])
  await expect(page.locator('.cs-item')).toContainText(UPDATE_REPLY.content)
  await expect(page.locator('.cs-item--anchor')).toHaveCount(0)
})
