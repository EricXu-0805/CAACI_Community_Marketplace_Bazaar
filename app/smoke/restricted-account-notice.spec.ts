import { test, expect, type Page } from '@playwright/test'
import { supabaseRefForBuild } from './supabase-ref'
import { CURRENT_CONSENT_VERSION } from '../src/legal'

/*
 * D-49: active L2-L4 accounts browse with a non-blocking notice that leads to
 * pages/suspended; that page offers a way home. L5 stays gated. Rendered H5,
 * synthetic profile, no network beyond the routed stubs.
 */

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/\.supabase\.co(?:[:/]|$)/, socket => socket.close())
})

const REF = supabaseRefForBuild()
const UID = '11111111-1111-4111-8111-111111111111'
const GEN = 'restricted-notice-generation-0001'
const UNTIL = '2100-12-03T12:34:56Z'

async function signIn(page: Page, { lang, theme, level }: { lang: 'en' | 'zh'; theme: 'light' | 'dark'; level: number }) {
  await page.addInitScript(([ref, uid, gen, lang, theme]) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', lang)
    localStorage.setItem('theme_pref', theme)
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      tag: 'caaci-auth-value-v2', generation: gen,
      value: JSON.stringify({
        access_token: 'stub', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
        user: { id: uid, email: 'a@illinois.edu', aud: 'authenticated', role: 'authenticated' },
      }),
    }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({ v: 2, mode: 'allowed', generation: gen }))
  }, [REF, UID, GEN, lang, theme] as const)

  const writes: string[] = []
  await page.route('**/*.supabase.co/**', async route => {
    const request = route.request()
    const url = request.url()
    if (request.method() !== 'GET' && !url.includes('/rpc/')) writes.push(url)
    let body: unknown = []
    if (url.includes('/rpc/get_my_profile')) {
      body = {
        id: UID, nickname: 'Test User', avatar_url: null, tos_version: CURRENT_CONSENT_VERSION,
        suspension_level: level, suspended_until: level === 5 ? 'infinity' : UNTIL,
        is_illini_verified: true, bio: 'hi', location: 'UIUC',
      }
    } else if (url.includes('/rest/v1/suspensions')) {
      body = {
        id: '44444444-4444-4444-8444-444444444444', level, reason: 'Repeated spam listings',
        category: 'spam', started_at: '2100-11-30T12:34:56Z', ends_at: level === 5 ? null : UNTIL, appeal_note: null,
      }
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/1' }, body: JSON.stringify(body),
    })
  })
  return writes
}

async function noticeText(page: Page, lang: 'en' | 'zh') {
  const date = await page.evaluate(lang => new Date('2100-12-03T12:34:56Z').toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US'), lang)
  return lang === 'zh' ? `账号受限 · 解除时间 ${date}` : `Account restricted · Ends ${date}`
}

for (const width of [390, 1280]) {
  for (const [theme, lang] of [['light', 'en'], ['dark', 'zh']] as const) {
    test(`L3 browses with a non-blocking notice and a voluntary details visit (${width}px, ${theme}, ${lang})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      const writes = await signIn(page, { lang, theme, level: 3 })
      await page.goto('/#/pages/index/index', { waitUntil: 'networkidle' })
      await expect(page).toHaveURL(/pages\/index\/index/)

      const notice = page.getByRole('link', { name: await noticeText(page, lang) })
      await expect(notice).toBeVisible({ timeout: 15_000 })
      // Mounted without any toast, and not an overlay: the page centre still
      // receives touches, and the pill stays compact.
      await expect(page.locator('uni-toast')).toHaveCount(0)
      const box = await notice.boundingBox()
      expect(box!.height).toBeLessThan(60)
      const centreHit = await page.evaluate(() => {
        const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2)
        return !!hit?.closest('#app-toast-root')
      })
      expect(centreHit).toBe(false)
      await page.screenshot({ path: `test-results/visual/D49/notice-${width}-${theme}-${lang}.png` })

      await notice.click()
      await expect(page).toHaveURL(/pages\/suspended\/index/)
      await expect(notice).toHaveCount(0)
      const home = page.locator('.footer').getByRole('button', { name: lang === 'zh' ? '首页' : 'Home', exact: true })
      await expect(home).toBeVisible()
      await expect(page.getByText('Repeated spam listings')).toBeVisible()
      await page.screenshot({ path: `test-results/visual/D49/suspended-visit-${width}-${theme}-${lang}.png` })
      // The page scrolls internally; capture the appeal form and the way home too.
      await home.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `test-results/visual/D49/suspended-visit-footer-${width}-${theme}-${lang}.png` })

      // No auto-bounce while an active L3 reads the details.
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveURL(/pages\/suspended\/index/)

      await home.click()
      // uni H5 serves the first tab page (pages/index/index) as #/.
      await expect(page).toHaveURL(/#\/(?:pages\/index\/index)?$/)
      await expect(notice).toBeVisible()
      expect(writes).toEqual([])
    })
  }
}

for (const level of [0, 1, 5]) {
  test(`L${level} shows no restriction notice`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page, { lang: 'en', theme: 'light', level })
    await page.goto('/#/pages/index/index', { waitUntil: 'networkidle' })
    if (level === 5) {
      await expect(page).toHaveURL(/pages\/suspended\/index/)
      await expect(page.locator('.footer').getByRole('button', { name: 'Home', exact: true })).toHaveCount(0)
    } else {
      await expect(page).toHaveURL(/pages\/index\/index/)
    }
    await expect(page.locator('.at-notice')).toHaveCount(0)
  })
}

test('the notice leaves with the account on sign-out', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, { lang: 'en', theme: 'light', level: 2 })
  await page.goto('/#/pages/index/index', { waitUntil: 'networkidle' })
  const notice = page.getByRole('link', { name: await noticeText(page, 'en') })
  await expect(notice).toBeVisible({ timeout: 15_000 })
  await page.evaluate(ref => {
    const channel = new BroadcastChannel(`sb-${ref}-auth-token`)
    channel.postMessage({ event: 'SIGNED_OUT', session: null })
    channel.close()
  }, REF)
  await expect(notice).toHaveCount(0)
})
