import { test, expect, devices, type Page, type CDPSession } from '@playwright/test'

/**
 * The keyboard journey, not the static tree.
 *
 * `a11y-tree.spec.ts` asks whether every control *has* a name. That is a
 * property of the document. It says nothing about the sequence a person
 * actually experiences, and the sequence is where the remaining defects live:
 * a stop that announces nothing, a stop on something painted at `opacity: 0`,
 * a Tab that never advances. `pointer-events: none` hides a control from a
 * mouse and leaves it in the tab order, so a control can be invisible, unusable
 * and still consume a keystroke.
 *
 * Each stop's name is read through CDP rather than from the DOM, so what is
 * asserted is Chromium's *computed* accessible name — the string assistive tech
 * receives after `aria-labelledby`, `aria-label`, content and title have been
 * resolved in order — not the attribute we hoped would supply it.
 *
 * This still cannot hear anything. It catches stops that are silent, invisible,
 * or out of order; it cannot judge whether a name that IS announced reads well.
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

const MAX_STOPS = 60

// Pages that carry the bottom bar for a signed-out visitor. `pages.json`
// declares a native tabBar for routing, but the H5 build hides it and
// CustomTabBar.vue draws the real one. `pages/publish/index` is deliberately
// absent: its bar is `v-if="publishReady"`, and publishing is gated on auth,
// so a signed-out visitor is sent to login before the bar can exist.
const TAB_PAGES = [
  'pages/index/index', 'pages/plaza/index',
  'pages/messages/index', 'pages/profile/index',
]

type Stop = {
  index: number
  tag: string
  cls: string
  role: string
  name: string
  x: number
  y: number
  w: number
  h: number
  opacity: number
  ariaHidden: boolean
}

/**
 * Chromium exposes the computed name only through the accessibility domain.
 * `getPartialAXTree` needs a backend node id, which in turn needs the focused
 * element resolved as a remote object first.
 */
async function axOfFocused(client: CDPSession): Promise<{ role: string; name: string }> {
  const evaluated = await client.send('Runtime.evaluate', {
    expression: 'document.activeElement',
    returnByValue: false,
  })
  const objectId = evaluated.result?.objectId
  if (!objectId) return { role: '', name: '' }
  try {
    const described = await client.send('DOM.describeNode', { objectId })
    const backendNodeId = described.node?.backendNodeId
    if (!backendNodeId) return { role: '', name: '' }
    const tree = await client.send('Accessibility.getPartialAXTree', {
      backendNodeId,
      fetchRelatives: false,
    })
    const node = tree.nodes?.[tree.nodes.length - 1]
    return {
      role: String(node?.role?.value ?? ''),
      name: String(node?.name?.value ?? ''),
    }
  } finally {
    await client.send('Runtime.releaseObject', { objectId }).catch(() => {})
  }
}

async function describeFocused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return null
    const rect = el.getBoundingClientRect()
    // Opacity is multiplicative up the tree: a parent at 0 makes the child
    // invisible however opaque the child's own rule is.
    let opacity = 1
    let hidden = false
    for (let node: HTMLElement | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      opacity *= Number(style.opacity || '1')
      if (node.getAttribute('aria-hidden') === 'true') hidden = true
    }
    return {
      tag: el.tagName.toLowerCase(),
      cls: (el.getAttribute('class') || '').slice(0, 70),
      x: Math.round(rect.x), y: Math.round(rect.y),
      w: Math.round(rect.width), h: Math.round(rect.height),
      opacity: Number(opacity.toFixed(3)),
      ariaHidden: hidden,
      signature: `${el.tagName}.${el.getAttribute('class') || ''}#${el.id || ''}`
        + `@${Math.round(rect.x)},${Math.round(rect.y)}`,
    }
  })
}

async function walk(page: Page, route: string): Promise<Stop[]> {
  await page.addInitScript(() => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
  })
  await page.goto(`/#/${route}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)

  const client = await page.context().newCDPSession(page)
  const stops: Stop[] = []
  const seen = new Set<string>()
  try {
    for (let i = 0; i < MAX_STOPS; i++) {
      await page.keyboard.press('Tab')
      const described = await describeFocused(page)
      if (!described) break
      // A repeat means the cycle closed (back to the first control) or Tab
      // stopped advancing. Either way there is nothing further to record.
      if (seen.has(described.signature)) break
      seen.add(described.signature)
      const ax = await axOfFocused(client)
      stops.push({ index: i, ...described, role: ax.role, name: ax.name })
    }
  } finally {
    await client.detach().catch(() => {})
  }
  return stops
}

// Stops the browser itself puts in the tab order for scrollable regions. They
// are correct — a keyboard user must be able to scroll a transcript — and they
// have no name because they are containers, not controls.
function isScrollContainer(stop: Stop): boolean {
  return stop.role === 'generic' || stop.role === 'ScrollArea' || stop.tag === 'uni-scroll-view'
}

// The rest of the smoke suite runs the WebKit iPhone profile. The computed
// accessible name is only reachable through CDP, so this one sweep runs a
// Chromium phone instead; the tab order under test is the document's, not the
// engine's.
test.use({ browserName: 'chromium', ...devices['Pixel 7'] })

test.describe('keyboard journey', () => {
  for (const route of PAGES) {
    test(`${route} — every tab stop is announced and visible`, async ({ page }) => {
      const stops = await walk(page, route)

      const silent = stops.filter(s => !s.name.trim() && !isScrollContainer(s))
      const invisible = stops.filter(s => s.opacity === 0 || s.w < 2 || s.h < 2)
      const hiddenFromReader = stops.filter(s => s.ariaHidden)

      const show = (list: Stop[]) => list
        .map(s => `#${s.index} <${s.tag} class="${s.cls}"> role=${s.role || '-'} `
          + `name="${s.name}" box=${s.w}x${s.h} opacity=${s.opacity}`)
        .join('\n')

      expect(silent, `tab stops with no accessible name on ${route}:\n${show(silent)}`)
        .toEqual([])
      expect(invisible, `focusable but not visible on ${route}:\n${show(invisible)}`)
        .toEqual([])
      expect(hiddenFromReader, `aria-hidden but focusable on ${route}:\n${show(hiddenFromReader)}`)
        .toEqual([])
    })
  }
})

/*
 * A component whose `setup()` throws is not a broken component — it is an
 * absent one. Vue swallows the error into the app's errorHandler, both builds
 * succeed, the type-check succeeds, and every assertion about what IS on the
 * page still passes, because the missing markup cannot fail a check it never
 * reaches. The bottom tab bar left the H5 app this way and stayed gone until
 * someone looked for it by name.
 */
test.describe('primary navigation', () => {
  for (const route of TAB_PAGES) {
    test(`${route} — the bottom bar renders and can be operated`, async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('welcomed', '1')
        localStorage.setItem('lang', 'en')
      })
      await page.goto(`/#/${route}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)

      const bar = await page.evaluate(() => {
        const el = document.querySelector('.tabbar')
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          display: getComputedStyle(el).display,
          items: [...el.querySelectorAll('[role="button"]')].map(item => ({
            label: item.getAttribute('aria-label') || '',
            tabIndex: (item as HTMLElement).tabIndex,
          })),
        }
      })

      expect(bar, `no .tabbar in the DOM on ${route} — CustomTabBar did not render`).not.toBeNull()
      expect(bar!.display).not.toBe('none')
      expect(bar!.height).toBeGreaterThan(20)
      expect(bar!.items.length, 'five destinations').toBe(5)
      expect(bar!.items.filter(i => !i.label.trim()), 'every destination is named').toEqual([])
      expect(bar!.items.filter(i => i.tabIndex < 0), 'every destination is reachable').toEqual([])
    })
  }
})
