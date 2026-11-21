import { test, expect } from '@playwright/test'
import { announced, installTopicFixture, text, topicUrl, READER, TOPIC } from './community-topic-fixture'
import { supabaseRefForBuild } from './supabase-ref'
import { CURRENT_CONSENT_VERSION } from '../src/legal'

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
  fixture.ownHidden = [{ id: TOPIC.id, title: TOPIC.title, category: TOPIC.category, content: TOPIC.content, created_at: TOPIC.created_at }]
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('[data-test=topic-rows] .row-tag')).toHaveText([text('profile.hiddenTag')])

  await page.goto('/#/pages/profile/index', { waitUntil: 'networkidle' })
  await page.locator('[data-test=watched-topics]').click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(text('profile.watchedTopics'))
  await page.goto('/#/pages/profile/index', { waitUntil: 'networkidle' })
  await page.locator('[data-test=saved-topics]').click()
  await expect(page).toHaveURL(/pages\/my-topics\/index\?view=saved/)
})

// A read that failed is not "not watching". The page says the marks could not be read, and the
// first tap reads them again instead of writing over a state it never saw.
test('marks that could not be read are not shown as unset, and a tap reads them again before anything is written', async ({ page }) => {
  const fixture = await installTopicFixture(page)
  fixture.marks.post_follows.add(TOPIC.id) // the member already watches this topic
  let down = true
  await page.route(/\/rest\/v1\/post_follows(?:\?|$)/, route => down && route.request().method() === 'GET'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: '57014', message: 'canceling statement due to statement timeout' }) })
    : route.fallback())
  await page.goto(topicUrl(), { waitUntil: 'networkidle' })
  await expect.poll(() => announced(page)).toEqual([text('plaza.marksFailed')])
  await expect(page.locator(watch)).toHaveAttribute('aria-pressed', 'mixed')
  await expect(page.locator(save)).toHaveAttribute('aria-pressed', 'mixed')

  down = false
  await page.locator(watch).click()
  await expect(page.locator(watch)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator(watch)).toContainText(text('plaza.watching'))
  await expect(page.locator(save)).toHaveAttribute('aria-pressed', 'false')
  expect(fixture.writes).toEqual([])
  // From here a tap means what the button says.
  await page.locator(watch).click()
  await expect(page.locator(watch)).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => fixture.writes).toEqual([{ method: 'DELETE', table: 'post_follows', body: null }])
})

// The lists belong to one account. When that account is gone the page loads again for whoever
// is signed in now, here nobody, so it asks for a sign-in.
test('my topics loads again when its account has left', async ({ page }) => {
  const fixture = await installTopicFixture(page)
  fixture.topic.user_id = READER
  await page.goto('/#/pages/my-topics/index?view=mine', { waitUntil: 'networkidle' })
  await expect(page.locator('[data-test=topic-rows] .row-title')).toHaveText([TOPIC.title])
  await page.evaluate(ref => {
    const channel = new BroadcastChannel(`sb-${ref}-auth-token`)
    channel.postMessage({ event: 'SIGNED_OUT', session: null })
    channel.close()
  }, supabaseRefForBuild())
  await expect(page).toHaveURL(/pages\/login\/index/)
})

// Another account signs in while the page is on screen. Until that account's list has been read
// the page is loading: it shows neither the first account's topics nor "you have no topics".
test('my topics shows loading, never an empty list, while the next account\'s topics are read', async ({ page }) => {
  const OTHER = '22222222-2222-4222-8222-222222222222'
  const theirs = { ...TOPIC, id: '33333333-3333-4333-8333-444444444444', user_id: OTHER, title: 'Bike rack near Grainger' }
  const fixture = await installTopicFixture(page)
  fixture.topic.user_id = READER
  // This test seeds a second session of its own below; like the first, it must never reach Realtime.
  await page.routeWebSocket(/\.supabase\.co(?:[:/]|$)/, socket => socket.close())
  let switched = false
  await page.route('**/rest/v1/rpc/get_my_profile', route => switched
    ? route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        id: OTHER, nickname: 'Second Reader', avatar_url: null, tos_version: CURRENT_CONSENT_VERSION, bio: '', location: 'UIUC',
        is_illini_verified: true, suspension_level: 0, suspended_until: null,
      }),
    })
    : route.fallback())
  // The second account's list is held until the test lets it go.
  let asked = 0
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/rest/v1/posts?**', async route => {
    if (new URL(route.request().url()).searchParams.get('user_id') !== `eq.${OTHER}`) return route.fallback()
    asked += 1
    await held
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/1' }, body: JSON.stringify([theirs]) })
  })

  await page.goto('/#/pages/my-topics/index?view=mine', { waitUntil: 'networkidle' })
  const titles = page.locator('[data-test=topic-rows] .row-title')
  await expect(titles).toHaveText([TOPIC.title])
  // From here on, note whether the empty state is ever on screen, however briefly.
  await page.evaluate(() => {
    const seen = { empty: false }
    ;(window as unknown as { __emptyState: typeof seen }).__emptyState = seen
    const look = () => { if (document.querySelector('[data-test=topic-rows-empty]')) seen.empty = true }
    new MutationObserver(look).observe(document.body, { childList: true, subtree: true })
    look()
  })

  // What another tab does when it signs in: store the session, then tell every tab.
  switched = true
  await page.evaluate(([ref, uid]) => {
    const key = `sb-${ref}-auth-token`
    const session = {
      access_token: 'stub-second', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r2',
      user: { id: uid, email: 'second@example.test', aud: 'authenticated', role: 'authenticated' },
    }
    localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) || '{}'), value: JSON.stringify(session) }))
    const channel = new BroadcastChannel(key)
    channel.postMessage({ event: 'SIGNED_IN', session })
    channel.close()
  }, [supabaseRefForBuild(), OTHER] as const)

  // The second account's read has started and is waiting: the page is loading, with no rows.
  await expect.poll(() => asked).toBeGreaterThan(0)
  await expect(page.locator('.empty[aria-busy=true]')).toHaveText(text('home.loading'))
  await expect(titles).toHaveCount(0)
  release()
  await expect(titles).toHaveText([theirs.title])
  expect(await page.evaluate(() => (window as unknown as { __emptyState: { empty: boolean } }).__emptyState.empty)).toBe(false)
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
