import { test, expect, type Page } from '@playwright/test'
import { supabaseRefForBuild } from './supabase-ref'
import { CURRENT_CONSENT_VERSION } from '../src/legal'

// P2.3 (D-02): the second primary destination is called 社区 at phone and desktop widths.
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/\.supabase\.co(?:[:/]|$)/, socket => socket.close())
})

const REF = supabaseRefForBuild()
const UID = '11111111-1111-4111-8111-111111111111'
const GEN = 'community-tab-label-generation-0001'
const PROFILE = {
  id: UID, nickname: 'Test User', avatar_url: null, tos_version: CURRENT_CONSENT_VERSION,
  suspension_level: 0, suspended_until: null, is_illini_verified: true, bio: 'hi', location: 'UIUC',
}

async function openHome(page: Page) {
  await page.addInitScript(([ref, uid, gen]) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'zh')
    localStorage.setItem('theme_pref', 'light')
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      tag: 'caaci-auth-value-v2', generation: gen,
      value: JSON.stringify({
        access_token: 'stub', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
        user: { id: uid, email: 'a@illinois.edu', aud: 'authenticated', role: 'authenticated' },
      }),
    }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({ v: 2, mode: 'allowed', generation: gen }))
  }, [REF, UID, GEN] as const)
  await page.route('**/*.supabase.co/**', route => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/1' },
    body: JSON.stringify(route.request().url().includes('/rpc/get_my_profile') ? PROFILE : []),
  }))
  await page.goto('/#/pages/index/index', { waitUntil: 'networkidle' })
}

for (const { width, height, labels } of [
  { width: 390, height: 844, labels: '.tabbar .tab .lbl' },
  { width: 1280, height: 800, labels: '.asb-label' },
]) {
  test(`the second primary destination reads 社区 at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await openHome(page)
    const visible = page.locator(labels).filter({ visible: true })
    await expect(visible.nth(1)).toHaveText('社区', { timeout: 15_000 })
    await expect(visible.nth(0)).toHaveText('首页')
    await page.screenshot({ path: `test-results/visual/P2.3/tabbar-${width}-light-zh.png` })
  })
}
