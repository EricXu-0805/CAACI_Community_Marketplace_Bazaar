import { test, expect } from '@playwright/test'
import { text } from './community-topic-fixture'
import { fillMemberForm, installMemberEvents, openFresh } from './community-member-event-fixture'

for (const width of [390, 1280]) {
  test.describe(`member event late draft failure at ${width}px`, () => {
    test.use({
      viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390,
      timezoneId: 'Asia/Shanghai',
    })

    test('a rejected submission shows the warning when only its second draft save fails', async ({ page }, testInfo) => {
      const fixture = await installMemberEvents(page)
      fixture.createError = 'member_event_active_limit'
      await openFresh(page, 'pages/event/create/index')
      await fillMemberForm(page)
      await page.evaluate(() => localStorage.removeItem('events_create_draft_v1'))

      // Observe the successful submit save before enabling the storage failure.
      const firstSave: { saved: string | null; warningVisible: boolean | null } = {
        saved: null, warningVisible: null,
      }
      await page.route('**/rest/v1/rpc/create_member_event', async route => {
        Object.assign(firstSave, await page.evaluate(() => {
          const saved = localStorage.getItem('events_create_draft_v1')
          const warningVisible = document.querySelector('.me-form [role="status"]') !== null
          const write = Storage.prototype.setItem
          Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
            if (key === 'events_create_draft_v1') {
              throw new DOMException('Synthetic late draft write failure', 'QuotaExceededError')
            }
            write.call(this, key, value)
          }
          return { saved, warningVisible }
        }))
        await route.fallback()
      })

      const form = page.locator('.me-form')
      await form.getByRole('button', { name: 'Organize an event', exact: true }).click()
      await expect(form.getByText('You already have 2 upcoming events. End or cancel one first.', { exact: true })).toBeVisible()
      expect(firstSave.saved).toContain('Saturday badminton')
      expect(firstSave.warningVisible).toBe(false)
      await expect(form.getByText(text('publish.draftSaveFailed'), { exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`late-draft-failure-${width}-light-en.png`), animations: 'disabled' })
    })
  })
}
