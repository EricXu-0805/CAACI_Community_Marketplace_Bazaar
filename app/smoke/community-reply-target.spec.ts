import { test, expect, type Locator, type Page } from '@playwright/test'
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

// Serves the two replies and records what the page writes. A write is answered once `gate.hold` lets it go.
async function serveReplies(page: Page, postId: string, gate: { hold?: Promise<void> } = {}) {
  const { top, nested } = thread(postId)
  const writes: Record<string, unknown>[] = []
  await page.route('**/rest/v1/post_comments?**', async route => {
    const request = route.request()
    if (request.method() !== 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([nested, top]) })
    }
    const body = request.postDataJSON()
    writes.push(body)
    await gate.hold
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

// The reply sheet shows a reply as soon as it is sent, under an id of its own making, and swaps in
// the saved row when the server answers. Until then the server has no row by that id, so the reply
// offers nothing that needs one: no "Reply" and no like, in the thread or at its head, and no menu.
for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test.describe(`pending replies at ${viewport.width}px`, () => {
  test.use({ viewport, isMobile: viewport.width < 768, hasTouch: viewport.width < 768 })
  test(`a reply that is still being sent cannot be answered until it is saved (${viewport.width}px)`, async ({ page }, testInfo) => {
    await installTopicFixture(page)
    await page.route('**/rest/v1/posts?**', route => route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/1' }, body: JSON.stringify([UPDATE]),
    }))
    let release!: () => void
    const holdNext = () => new Promise<void>(resolve => { release = resolve })
    const gate = { hold: holdNext() }
    const { top, nested, writes } = await serveReplies(page, UPDATE.id, gate)
    await page.goto('/#/pages/plaza/index?view=all', { waitUntil: 'networkidle' })
    await page.locator('.post-card').getByRole('button', { name: text('a11y.comment'), exact: true }).click()
    const sheet = page.locator('.comment-sheet')
    await expect(sheet.locator('.cs-item-child')).toContainText(nested.content)

    // The end label follows the last reply in normal flow, so its y measures the
    // displacement a reader sees below that reply. Each layout starts a fresh page,
    // so resizing does not simulate a keyboard opening or closing during a reply.
    const measure = async (row: Locator, name: string) => {
      await expect(page.locator('.community-fab')).toHaveCount(viewport.width < 768 ? 1 : 0)
      await expect.poll(async () => {
        const box = (await sheet.boundingBox())!
        return Math.round(box.y + box.height)
      }).toBe(viewport.height)
      await expect(row).toBeVisible()
      await expect(sheet.locator('.cmt-end')).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`${name}-${viewport.width}.png`), animations: 'disabled' })
      const box = (await row.boundingBox())!
      const following = (await sheet.locator('.cmt-end').boundingBox())!
      const measurement = { width: viewport.width, height: box.height, followingY: following.y }
      console.log(`REPLY_LAYOUT ${name} ${JSON.stringify([measurement])}`)
      return measurement
    }

    // An answer inside the thread, held on its way to the server.
    await sheet.locator('.cs-item-child .cs-reply-btn').click()
    await sheet.locator('textarea').fill('Still on its way')
    await sheet.locator('.ci-send').click()
    await expect.poll(() => writes.length).toBe(1)
    const pending = sheet.locator('.cs-item-child', { hasText: 'Still on its way' })
    await expect(pending).toBeVisible()
    await expect(pending.locator('.cs-reply-btn')).toHaveCount(0)
    await expect(pending.locator('.cs-like-btn')).toHaveCount(0)
    // The saved reply next to it can still be answered.
    await expect(sheet.locator('.cs-item-child', { hasText: nested.content }).locator('.cs-reply-btn')).toHaveCount(1)
    // Its menu would be empty: the reply cannot be answered yet, and it cannot be removed either,
    // because removing names the saved row and there is none. An empty menu does not open. The page
    // shows nothing when a menu stays shut, so every menu it opens from here on is counted.
    await page.evaluate(() => {
      const host = window as unknown as { uni: { showActionSheet: (options: unknown) => unknown }; __menusOpened: number }
      const open = host.uni.showActionSheet
      host.__menusOpened = 0
      host.uni.showActionSheet = options => { host.__menusOpened += 1; return open.call(host.uni, options) }
    })
    await pending.press('ContextMenu')
    const menu = page.locator('uni-actionsheet')
    await expect(menu.getByText(text('plaza.reply'), { exact: true })).toHaveCount(0)
    // The saved reply next to it is asked for its menu in the same way, after the pending one. When
    // that menu is up, the earlier request has been handled too, so one menu opened means this one.
    await sheet.locator('.cs-item-child', { hasText: nested.content }).press('ContextMenu')
    await expect(menu.getByText(text('plaza.reportComment'), { exact: true })).toBeVisible()
    await menu.getByRole('menuitem', { name: text('plaza.reportComment'), exact: true }).press('Escape')
    await expect(page.locator('.uni-actionsheet_toggle')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __menusOpened: number }).__menusOpened)).toBe(1)

    // Saved: it is a reply like any other, and an answer to it names the id the server gave it.
    const nestedBefore = await measure(pending, 'nested-pending')
    release()
    await expect(pending.locator('.cs-reply-btn')).toHaveCount(1)
    await expect(pending.locator('.cs-like-btn')).toHaveCount(1)
    const nestedAfter = await measure(pending, 'nested-saved')
    expect.soft(Math.abs(nestedAfter.height - nestedBefore.height), `nested height at ${viewport.width}`).toBeLessThanOrEqual(1)
    expect.soft(Math.abs(nestedAfter.followingY - nestedBefore.followingY), `after nested at ${viewport.width}`).toBeLessThanOrEqual(1)
    // Its menu opens again, with both of its author's actions.
    await pending.press('ContextMenu')
    await expect(menu.getByText(text('plaza.delete'), { exact: true })).toBeVisible()
    await expect(menu.getByText(text('plaza.reply'), { exact: true })).toBeVisible()
    await menu.getByRole('menuitem', { name: text('plaza.delete'), exact: true }).press('Escape')
    await expect(page.locator('.uni-actionsheet_toggle')).toHaveCount(0)
    await pending.locator('.cs-reply-btn').click()
    await sheet.locator('textarea').fill('Now it can be answered')
    await sheet.locator('.ci-send').click()
    await expect.poll(() => writes.length).toBe(2)
    expect(writes[1]).toMatchObject({ parent_comment_id: top.id, reply_to_comment_id: '44444444-4444-4444-8444-000000000101' })

    // The same at the head of a thread: a new reply to the update, held.
    await expect(sheet.locator('.cs-item-child', { hasText: 'Now it can be answered' }).locator('.cs-reply-btn')).toHaveCount(1)
    gate.hold = holdNext()
    await sheet.locator('textarea').fill('A new thread on its way')
    await sheet.locator('.ci-send').click()
    await expect.poll(() => writes.length).toBe(3)
    const head = sheet.locator('.cs-item:not(.cs-item-child)', { hasText: 'A new thread on its way' })
    await expect(head).toBeVisible()
    await expect(head.locator('.cs-reply-btn')).toHaveCount(0)
    await expect(head.locator('.cs-like-btn')).toHaveCount(0)
    const headBefore = await measure(head, 'top-pending')
    release()
    await expect(head.locator('.cs-reply-btn')).toHaveCount(1)
    await expect(head.locator('.cs-like-btn')).toHaveCount(1)
    const headAfter = await measure(head, 'top-saved')
    expect.soft(Math.abs(headAfter.height - headBefore.height), `top height at ${viewport.width}`).toBeLessThanOrEqual(1)
    expect.soft(Math.abs(headAfter.followingY - headBefore.followingY), `after top at ${viewport.width}`).toBeLessThanOrEqual(1)

    // Nothing that was sent named a reply by an id the server never issued.
    for (const write of writes) {
      expect(String(write.reply_to_comment_id ?? '')).not.toMatch(/^temp-/)
      expect(String(write.parent_comment_id ?? '')).not.toMatch(/^temp-/)
    }
  })
  })
}

test.describe('touching a reply while it is being sent', () => {
  test.use({ hasTouch: true })

  for (const nestedReply of [false, true]) {
    test(`${nestedReply ? 'a nested reply' : 'a top-level reply'} starts no haptic or timer until saved`, async ({ page }) => {
      await installTopicFixture(page)
      await page.route('**/rest/v1/posts?**', route => route.fulfill({
        status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/1' }, body: JSON.stringify([UPDATE]),
      }))
      let release!: () => void
      const hold = new Promise<void>(resolve => { release = resolve })
      const { nested, writes } = await serveReplies(page, UPDATE.id, { hold })
      await page.goto('/#/pages/plaza/index?view=all', { waitUntil: 'networkidle' })
      await page.locator('.post-card').getByRole('button', { name: text('a11y.comment'), exact: true }).click()
      const sheet = page.locator('.comment-sheet')
      const saved = sheet.locator('.cs-item-child', { hasText: nested.content })
      await expect(saved).toBeVisible()
      if (nestedReply) await saved.locator('.cs-reply-btn').click()
      await sheet.locator('textarea').fill('A reply held for the touch check')
      await sheet.locator('.ci-send').click()
      await expect.poll(() => writes.length).toBe(1)
      const pending = sheet.locator('.cs-item', { hasText: 'A reply held for the touch check' })
      await expect(pending).toBeVisible()
      await page.clock.install({ time: new Date('2026-11-22T12:00:00Z') })
      await page.clock.pauseAt(new Date('2026-11-22T12:00:01Z'))
      await page.evaluate(() => {
        const host = window as unknown as {
          uni: { vibrateShort: (options: { type: 'light' | 'heavy' }) => unknown }
          __replyTouch: { light: number; heavy: number; timers: number }
        }
        host.__replyTouch = { light: 0, heavy: 0, timers: 0 }
        const vibrate = host.uni.vibrateShort
        host.uni.vibrateShort = options => {
          host.__replyTouch[options.type] += 1
          return vibrate.call(host.uni, options)
        }
        const schedule = window.setTimeout
        window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
          if (delay === 1500) host.__replyTouch.timers += 1
          return schedule(handler, delay, ...args)
        }) as typeof window.setTimeout
      })
      const counts = () => page.evaluate(() => ({ ...(window as unknown as {
        __replyTouch: { light: number; heavy: number; timers: number }
      }).__replyTouch }))
      await pending.dispatchEvent('touchstart')
      await page.clock.fastForward(1600)
      const pendingCounts = await counts()
      console.log(`REPLY_TOUCH ${nestedReply ? 'nested' : 'top'} pending ${JSON.stringify(pendingCounts)}`)
      expect.soft(pendingCounts).toEqual({ light: 0, heavy: 0, timers: 0 })
      await pending.dispatchEvent('touchend')

      await saved.dispatchEvent('touchstart')
      await page.clock.fastForward(1499)
      expect.soft((await counts()).heavy).toBe(pendingCounts.heavy)
      await expect(page.locator('.uni-actionsheet_toggle')).toHaveCount(0)
      await page.clock.fastForward(101)
      const menu = page.locator('uni-actionsheet')
      await expect(menu.getByText(text('plaza.reportComment'), { exact: true })).toBeVisible()
      await saved.dispatchEvent('touchend')
      await page.locator('.uni-actionsheet__action .uni-actionsheet__cell').click()
      await expect(page.locator('.uni-actionsheet_toggle')).toHaveCount(0)
      const savedCounts = await counts()
      console.log(`REPLY_TOUCH ${nestedReply ? 'nested' : 'top'} saved ${JSON.stringify(savedCounts)}`)
      expect.soft(savedCounts).toEqual({ light: 1, heavy: 1, timers: 1 })
      release()
      await expect(pending.locator('.cs-reply-btn')).toHaveCount(1)
    })
  }
})
