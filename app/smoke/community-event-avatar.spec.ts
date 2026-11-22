import { test, expect } from '@playwright/test'
import { AUTHOR } from './community-topic-fixture'
import { installMemberEvents } from './community-member-event-fixture'
import { supabaseRefForBuild } from './supabase-ref'

const FALLBACK_EVENT = '70000000-0000-4000-8000-000000000058'
const OFFICIAL_EVENT = '70000000-0000-4000-8000-000000000059'
const AVATAR = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#668c61"/></svg>'

// The existing events suite owns the ban on event artwork and webviews.
// These cases own the explicitly requested member profile avatar.
for (const width of [390, 1280] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`event avatar ${width}px ${theme}`, () => {
      test.use({
        viewport: { width, height: 844 }, screen: { width, height: 844 },
        deviceScaleFactor: width === 390 ? 2 : 1,
        isMobile: width === 390, hasTouch: width === 390,
      })

      test('member avatars show the owned photo and a 20px themed fallback', async ({ page }, info) => {
        const api = await installMemberEvents(page, { theme })
        const origin = `https://${supabaseRefForBuild()}.supabase.co`
        const objectPath = `item-images/items/${AUTHOR}/avatar.png`
        const photoUrl = `${origin}/storage/v1/object/public/${objectPath}`
        const renderedUrl = `${origin}/storage/v1/render/image/public/${objectPath}?width=96&height=96&quality=75&resize=cover`
        api.rows = [
          { ...api.member, organizer_user_id: AUTHOR, organizer_avatar_url: photoUrl },
          {
            ...api.member, id: FALLBACK_EVENT, title: 'Another member event',
            organizer_nickname: 'Organizer without a photo', organizer_avatar_url: null,
            discussion_post_id: null,
          },
          {
            ...api.member, id: OFFICIAL_EVENT, source_type: 'caaci', title: 'Official event',
            organizer_name: 'CAACI', organizer_user_id: null, organizer_nickname: null,
            organizer_avatar_url: null, organizer_is_illini_verified: null,
            registration_mode: 'info_only', discussion_post_id: null,
          },
        ]
        await page.route(renderedUrl, route => route.fulfill({
          contentType: 'image/svg+xml', body: AVATAR,
        }))
        await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
        await expect(page.locator('.ev-main .evc')).toHaveCount(3)
        await expect(page.locator('.ev-main .evc-avatar')).toHaveCount(2)

        const photo = page.locator(`[data-event-id="${api.member.id}"] .evc-avatar`)
        const fallback = page.locator(`[data-event-id="${FALLBACK_EVENT}"] .evc-avatar`)
        for (const avatar of [photo, fallback]) {
          await expect(avatar).toBeVisible()
          await expect(avatar).toHaveCSS('width', '20px')
          await expect(avatar).toHaveCSS('height', '20px')
          await expect(avatar).toHaveAttribute('aria-hidden', 'true')
        }
        await expect(photo.locator('img')).toHaveAttribute('src', renderedUrl)
        await expect.poll(() => photo.locator('img').evaluate(node =>
          node instanceof HTMLImageElement && node.complete && node.naturalWidth === 40,
        )).toBe(true)
        await expect(fallback.locator('img')).toHaveAttribute('src',
          new RegExp(`/static/default-avatar${theme === 'dark' ? '-dark' : ''}\\.svg$`))
        await expect(page.locator(`[data-event-id="${OFFICIAL_EVENT}"] .evc-avatar`)).toHaveCount(0)
        await page.screenshot({
          path: info.outputPath(`avatar-${width}-${theme}.png`), animations: 'disabled',
        })
      })
    })
  }
}
