import { test, expect, type Page } from '@playwright/test'
import { supabaseRefForBuild } from './supabase-ref'
import { CURRENT_CONSENT_VERSION } from '../src/legal'

/**
 * The attach-item picker says it is modal. It has to actually be modal.
 *
 * Its backdrop carried two classes: `sheet-mask`, declared only inside
 * detail/index.vue and saved-searches/index.vue — both `<style scoped>`, so it
 * resolved to nothing here — and `sheet-mask-over-composer`, which set a
 * z-index and nothing else. A z-index on a `position: static` element does
 * nothing, so the backdrop was a transparent 390x0 strip in normal flow.
 *
 * Measured on the unfixed page, with the picker open:
 *
 *   position: static · background: rgba(0,0,0,0) · rect: 390x0
 *   elementFromPoint(195, 80) -> textarea.uni-textarea-textarea
 *   tapping outside the sheet left it open
 *
 * So nothing was dimmed, the composer underneath stayed typeable, and the tap
 * that every sheet in this app closes on went to the composer instead. The
 * sheet is aria-modal="true", so assistive tech was told the page behind it was
 * inert while it was fully reachable.
 *
 * Computed style is what catches this one; the earlier occlusion work needed
 * elementFromPoint because the styles were all correct. Both are asserted here
 * because either alone can be satisfied without the other being true.
 */

const REF = supabaseRefForBuild()
const UID = '11111111-1111-4111-8111-111111111111'
const GEN = 'attach-picker-generation-0001'
const PROFILE = {
  id: UID, nickname: 'Test User', avatar_url: null, tos_version: CURRENT_CONSENT_VERSION,
  suspension_level: 0, suspended_until: null, is_illini_verified: true, bio: 'hi', location: 'UIUC',
}
// Well above the sheet, which is bottom-anchored at max-height 70vh.
const ABOVE_THE_SHEET_Y = 80

async function openPlazaComposer(page: Page) {
  await page.addInitScript(([ref, uid, gen]) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
    localStorage.setItem('theme_pref', 'light')
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      tag: 'caaci-auth-value-v2', generation: gen,
      value: JSON.stringify({
        access_token: 'stub', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
        user: { id: uid, email: 'a@illinois.edu', aud: 'authenticated', role: 'authenticated' },
      }),
    }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({
      v: 2, mode: 'allowed', generation: gen,
    }))
  }, [REF, UID, GEN] as const)

  await page.route('**/*.supabase.co/**', async route => {
    const body = route.request().url().includes('/rpc/get_my_profile') ? PROFILE : []
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/1' }, body: JSON.stringify(body),
    })
  })

  await page.goto('/#/pages/plaza/index', { waitUntil: 'networkidle' })
  await page.locator('.compose-btn').first().click({ timeout: 15_000 })
  await expect(page.locator('.comp-attach-btn').first()).toBeVisible({ timeout: 10_000 })
}

function whatIsAt(page: Page, y: number) {
  return page.evaluate(probeY => {
    const hit = document.elementFromPoint(window.innerWidth / 2, probeY) as HTMLElement | null
    return hit ? `${hit.tagName.toLowerCase()}.${String(hit.className)}` : 'nothing'
  }, y)
}

test('the attach picker covers the composer it opens over', async ({ page }) => {
  await openPlazaComposer(page)

  // The control comes first: before the picker opens, this point belongs to
  // the composer. Without it, every assertion below is satisfied by a page
  // that renders a permanent full-screen mask.
  expect(await whatIsAt(page, ABOVE_THE_SHEET_Y), 'the composer was not under the probe point')
    .toContain('textarea')

  await page.locator('.comp-attach-btn').first().click()
  await expect(page.locator('.attach-sheet')).toBeVisible({ timeout: 10_000 })

  const mask = await page.evaluate(() => {
    const el = document.querySelector('.sheet-mask-over-composer') as HTMLElement | null
    if (!el) return null
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return {
      position: style.position,
      transparent: style.backgroundColor === 'rgba(0, 0, 0, 0)',
      coversViewport: rect.width >= window.innerWidth && rect.height >= window.innerHeight,
    }
  })

  expect(mask, 'the backdrop element is gone entirely').not.toBeNull()
  // A z-index on a static element is inert, which is what made this invisible.
  expect(mask!.position, 'the backdrop is not positioned, so its z-index does nothing').not.toBe('static')
  expect(mask!.transparent, 'the backdrop dims nothing').toBe(false)
  expect(mask!.coversViewport, 'the backdrop does not cover the screen').toBe(true)
  expect(await whatIsAt(page, ABOVE_THE_SHEET_Y), 'the composer is still reachable behind an aria-modal dialog')
    .toContain('sheet-mask-over-composer')
})

test('tapping beside the attach picker closes it', async ({ page }) => {
  await openPlazaComposer(page)
  await page.locator('.comp-attach-btn').first().click()
  await expect(page.locator('.attach-sheet')).toBeVisible({ timeout: 10_000 })

  await page.mouse.click(page.viewportSize()!.width / 2, ABOVE_THE_SHEET_Y)

  await expect(page.locator('.attach-sheet'), 'the tap went to the composer instead of the backdrop')
    .toBeHidden({ timeout: 5_000 })
})
