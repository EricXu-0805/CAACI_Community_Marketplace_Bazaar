import { test, expect, type Page } from '@playwright/test'

/**
 * What a screen reader actually receives.
 *
 * Reading the source tells you an element has `role="button"`; it does not
 * tell you whether VoiceOver will announce a name for it. uni-app compiles
 * every `<view>` and `<image>` into a custom element, so `alt` carries no
 * accessible-name semantics and an icon-only control lands in the tree as a
 * bare "button" with nothing to say. This walks Chromium's ARIA tree — the
 * same tree assistive tech consumes — and fails on controls that arrive
 * nameless, logged out, where a real first-time user starts.
 *
 * This is not a substitute for a VoiceOver or TalkBack pass on hardware. It
 * catches the defects that are mechanical (no name, no heading, no landmark);
 * it cannot judge whether the name that IS announced makes sense in context.
 */

const PAGES = [
  'pages/index/index', 'pages/plaza/index', 'pages/post/index',
  'pages/publish/index', 'pages/publish/edit', 'pages/messages/index',
  'pages/profile/index', 'pages/detail/index', 'pages/chat/index',
  'pages/history/index', 'pages/legal/index', 'pages/welcome/index',
  'pages/settings/index', 'pages/seller/index', 'pages/profile/edit',
  'pages/notifications/index', 'pages/blocked/index', 'pages/reset-password/index',
  'pages/illini-verify/index', 'pages/login/index', 'pages/following/index',
  'pages/saved-searches/index', 'pages/search/index', 'pages/onboarding/index',
  'pages/reconsent/index', 'pages/profile-recovery/index',
  'pages/suspended/index', 'pages/admin/index', 'pages/my-items/index',
]

// Roles a user is expected to operate. A nameless one is announced as just
// its role — "button" — which tells the user nothing about what it does.
const MUST_BE_NAMED = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
  'switch', 'slider', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
])

// `- button "Save"` carries a name; `- button` and `- button:` do not.
const NODE = /^(\s*)- ([a-z]+[a-z-]*)(\s+"([^"]*)")?/

type Nameless = { role: string; indent: number; context: string }

function namelessControls(snapshot: string): Nameless[] {
  const lines = snapshot.split('\n')
  const found: Nameless[] = []
  lines.forEach((line, index) => {
    const match = NODE.exec(line)
    if (!match) return
    const [, indent, role, , name] = match
    if (!MUST_BE_NAMED.has(role)) return
    if (name && name.trim()) return
    // A control can also take its name from a descendant that the snapshot
    // renders on its own line. Keep the following deeper lines as context so
    // a real finding can be told apart from a nesting artefact.
    const context = lines
      .slice(index, index + 4)
      .filter(l => l.trim())
      .join(' ⏎ ')
      .slice(0, 160)
    found.push({ role, indent: indent.length, context })
  })
  return found
}

async function snapshotOf(page: Page, route: string): Promise<string> {
  await page.addInitScript(() => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
  })
  await page.goto(`/#/${route}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  return page.locator('body').ariaSnapshot()
}

// Both sides of the 768px breakpoint. Several pages hide `.page-header` on
// desktop and let AppSidebar carry navigation, so a heading that exists on a
// phone can be absent on a Mac — `display:none` removes a node from the
// accessibility tree entirely. A single-viewport sweep reports those pages as
// passing.
const VIEWPORTS = [
  { label: 'phone', width: 390, height: 844 },
  { label: 'desktop', width: 1280, height: 900 },
]

/*
 * Two framework surfaces the app cannot fix at the call site, so they are
 * enhanced centrally in App.vue. Both are asserted against the real DOM
 * because both were verified to be broken there while the source looked fine:
 * uni-app renders its toast and its action sheet itself.
 */
test.describe('framework surfaces enhanced in App.vue', () => {
  test('uni.showToast reaches a live region', async ({ page }) => {
    test.setTimeout(120_000)
    // 239 call sites; uni's <uni-toast> carries no role and no aria-live, so
    // every "Saved" / "Failed to send" was announced to nobody.
    await page.addInitScript(() => { localStorage.setItem('welcomed', '1'); localStorage.setItem('lang', 'en') })
    await page.goto('/#/pages/index/index', { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const region = page.locator('div[role="status"][aria-live="polite"]')
    await expect(region).toHaveCount(1)
    await page.evaluate(() => (window as any).uni.showToast({ title: 'Link copied!', icon: 'none' }))
    await expect(region).toHaveText('Link copied!')
  })

  test('uni.showActionSheet is operable from the keyboard', async ({ page }) => {
    test.setTimeout(120_000)
    // The destination of every Shift+F10 handler in the app. uni renders the
    // options as plain <div>: no role, no tabindex, focus left on <body>.
    await page.addInitScript(() => { localStorage.setItem('welcomed', '1'); localStorage.setItem('lang', 'en') })
    await page.goto('/#/pages/index/index', { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    // Deliberately not returned: showActionSheet's promise settles only when
    // the sheet is dismissed, so returning it makes evaluate() wait forever.
    await page.evaluate(() => { (window as any).uni.showActionSheet({ itemList: ['Alpha', 'Beta', 'Gamma'] }) })
    await page.waitForTimeout(700)

    const focusedText = () => page.evaluate(() => (document.activeElement?.textContent || '').trim())
    expect(await focusedText()).toBe('Alpha')
    expect(await page.locator('uni-actionsheet').getAttribute('aria-modal')).toBe('true')
    await page.keyboard.press('ArrowDown')
    expect(await focusedText()).toBe('Beta')
    // Tab must stay inside a modal rather than walking into the page behind it.
    await page.keyboard.press('Tab')
    expect(await focusedText()).toBe('Gamma')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
    await expect(page.locator('.uni-actionsheet_toggle')).toHaveCount(0)
  })
})

for (const vp of VIEWPORTS) {
  test.describe(`accessibility tree (${vp.label})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('every operable control arrives with a name', async ({ page }) => {
      test.setTimeout(300_000)
      const report: string[] = []
      for (const route of PAGES) {
        const nameless = namelessControls(await snapshotOf(page, route))
        for (const item of nameless) report.push(`${route}  ${item.role}  ${item.context}`)
      }
      expect(report, `nameless controls:\n${report.join('\n')}`).toEqual([])
    })

    test('routes do not all share one document title', async ({ page }) => {
      test.setTimeout(300_000)
      // document.title is the first thing announced on navigation and the
      // label of every tab and history entry (2.4.2). 28 of 29 routes used to
      // fall through to globalStyle's "Illini Market".
      const titles = new Map<string, string>()
      for (const route of PAGES) {
        await snapshotOf(page, route)
        titles.set(route, await page.title())
      }
      const generic = [...titles.entries()].filter(([, title]) => title === 'Illini Market')
      // detail, seller and legal title themselves from data the page owns, and
      // welcome legitimately is the app name. Everything else must be distinct.
      expect(generic.length, `routes still titled only "Illini Market":\n${generic.map(([r]) => r).join('\n')}`)
        .toBeLessThanOrEqual(4)
      // Logged out, many routes legitimately land on the sign-in page and
      // share its title, so the ceiling here is well below 29.
      expect(new Set(titles.values()).size).toBeGreaterThan(10)
    })

    test('every page exposes a heading to navigate by', async ({ page }) => {
      test.setTimeout(300_000)
      // Screen-reader users move by heading, not by scrolling. A page built
      // entirely from styled <view> has no headings at all, so the only way
      // through it is linear.
      const headless: string[] = []
      for (const route of PAGES) {
        const snapshot = await snapshotOf(page, route)
        if (!/^\s*- heading\b/m.test(snapshot)) headless.push(route)
      }
      expect(headless, `pages with no heading:\n${headless.join('\n')}`).toEqual([])
    })
  })
}
