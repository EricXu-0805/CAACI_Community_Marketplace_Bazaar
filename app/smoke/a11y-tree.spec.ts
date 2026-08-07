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
