import { test, expect } from '@playwright/test'
import { installTopicFixture, text, topicUrl, READER, TOPIC } from './community-topic-fixture'

/*
 * P3.2: a member watches and saves a topic on its page, and both lists under
 * "我的" change at once. Watching and saving stay open to restricted accounts
 * (D-49); a signed-out visitor is sent to sign in.
 */
const watch = '[data-test=topic-watch]'
const save = '[data-test=topic-save]'

for (const width of [390, 1280]) {
  test(`watching and saving a topic changes the matching list at once at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const fixture = await installTopicFixture(page)

    await page.goto(topicUrl(), { waitUntil: 'networkidle' })
    await expect(page.locator('.post-topic-title')).toHaveText(TOPIC.title)
    await expect(page.locator(watch)).toContainText(text('plaza.watch'))
    await expect(page.locator(watch)).toContainText(text('plaza.watchHint'))
    await expect(page.locator(watch)).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator(save)).toHaveText(text('plaza.save'))

    // Watch: one private row, and the watched list shows the topic.
    await page.locator(watch).click()
    await expect(page.locator(watch)).toContainText(text('plaza.watching'))
    await expect(page.locator(watch)).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => fixture.writes).toEqual([
      { method: 'POST', table: 'post_follows', body: { user_id: READER, post_id: TOPIC.id } },
    ])
    await page.goto('/#/pages/my-topics/index?view=watched', { waitUntil: 'networkidle' })
    await expect(page.locator('[data-test=topic-rows] .row-title')).toHaveText([TOPIC.title])

    // The topic page remembers it; stopping removes the row and empties the list.
    await page.goto(topicUrl(), { waitUntil: 'networkidle' })
    await expect(page.locator(watch)).toHaveAttribute('aria-pressed', 'true')
    await page.locator(watch).click()
    await expect(page.locator(watch)).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => fixture.writes.at(-1)).toEqual({ method: 'DELETE', table: 'post_follows', body: null })
    await page.goto('/#/pages/my-topics/index?view=watched', { waitUntil: 'networkidle' })
    await expect(page.locator('[data-test=topic-rows-empty]')).toHaveText(text('profile.noWatchedTopics'))

    // Save, then find it under 我的收藏 → 话题, next to saved listings.
    await page.goto(topicUrl(), { waitUntil: 'networkidle' })
    await page.locator(save).click()
    await expect(page.locator(save)).toHaveText(text('plaza.saved'))
    await expect.poll(() => fixture.writes.at(-1)).toEqual(
      { method: 'POST', table: 'post_bookmarks', body: { user_id: READER, post_id: TOPIC.id } })
    await page.goto('/#/pages/my-items/index?tab=saved', { waitUntil: 'networkidle' })
    await expect(page.locator('.saved-kinds .tab')).toHaveText([text('profile.savedItems'), text('profile.savedTopics')])
    await page.locator('[data-test=saved-topics]').click()
    await expect(page).toHaveURL(/pages\/my-topics\/index\?view=saved/)
    await expect(page.locator('[data-test=topic-rows] .row-title')).toHaveText([TOPIC.title])
    await page.locator('[data-test=topic-rows] .row').click()
    await expect(page).toHaveURL(new RegExp(`pages/post/index\\?id=${TOPIC.id}`))

    await expect(page.locator(save)).toHaveAttribute('aria-pressed', 'true')
    await page.locator(save).click()
    await expect(page.locator(save)).toHaveText(text('plaza.save'))
    // Back on the list the topic came from, it is gone without a manual refresh.
    await page.goBack()
    await expect(page).toHaveURL(/pages\/my-topics\/index\?view=saved/)
    await expect(page.locator('[data-test=topic-rows-empty]')).toHaveText(text('profile.noSavedTopics'))
    expect(fixture.marks.post_follows.size + fixture.marks.post_bookmarks.size).toBe(0)
  })
}

test('"我的" lists its entries in the SPEC 6.9 order and opens the three topic lists', async ({ page }) => {
  const fixture = await installTopicFixture(page)
  fixture.topic.user_id = READER // the reader's own topic, so "My topics" has a row
  await page.goto('/#/pages/profile/index', { waitUntil: 'networkidle' })
  // The my-items block is a tab list without a heading, so it is read by its accessible name.
  const order = await page.locator('.menu-row-text, .my-tabs, .block-title').evaluateAll(nodes => nodes.map(
    node => (node.classList.contains('my-tabs') ? node.getAttribute('aria-label') : node.textContent || '').trim()))
  expect(order).toEqual([
    text('notif.title'), text('profile.listed'), text('profile.myTopics'), text('profile.savedSection'),
    text('profile.watchedTopics'), text('nav.following'), text('profile.history'), text('savedSearch.title'),
    text('profile.moreSection'), text('settings.title'),
  ])
  await expect(page.locator('.saved-kinds .saved-kind')).toHaveText([text('profile.savedItems'), text('profile.savedTopics')])

  await page.locator('[data-test=my-topics]').click()
  await expect(page).toHaveURL(/pages\/my-topics\/index\?view=mine/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(text('profile.myTopics'))
  await expect(page.locator('[data-test=topic-rows] .row-title')).toHaveText([TOPIC.title])

  // A hidden topic of the member's own is listed too, and says so.
  fixture.topic.visible = false
  fixture.ownHidden = [{ id: TOPIC.id, title: TOPIC.title, category: TOPIC.category, content: TOPIC.content, created_at: TOPIC.created_at, hidden_reason: 'Spam' }]
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('[data-test=topic-rows] .row-tag')).toHaveText([text('profile.hiddenTag')])

  await page.goto('/#/pages/profile/index', { waitUntil: 'networkidle' })
  await page.locator('[data-test=watched-topics]').click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(text('profile.watchedTopics'))
  await page.goto('/#/pages/profile/index', { waitUntil: 'networkidle' })
  await page.locator('[data-test=saved-topics]').click()
  await expect(page).toHaveURL(/pages\/my-topics\/index\?view=saved/)
})

test('a restricted account can still watch and save', async ({ page }) => {
  const fixture = await installTopicFixture(page, { level: 3 })
  await page.goto(topicUrl(), { waitUntil: 'networkidle' })
  await page.locator(watch).click()
  await expect(page.locator(watch)).toHaveAttribute('aria-pressed', 'true')
  await page.locator(save).click()
  await expect(page.locator(save)).toHaveAttribute('aria-pressed', 'true')
  expect(fixture.writes.map(write => `${write.method} ${write.table}`)).toEqual(['POST post_follows', 'POST post_bookmarks'])
  // Replying stays closed for this account.
  await expect(page.locator('.reply-restricted')).toHaveText(text('plaza.restrictedReply'))
})

test('a signed-out visitor is sent to sign in and nothing is written', async ({ page }) => {
  const fixture = await installTopicFixture(page, { user: null })
  await page.goto(topicUrl(), { waitUntil: 'networkidle' })
  await expect(page.locator(watch)).toHaveAttribute('aria-pressed', 'false')
  await page.locator(save).click()
  await expect(page).toHaveURL(/pages\/login\/index/)
  expect(fixture.writes).toEqual([])
})
