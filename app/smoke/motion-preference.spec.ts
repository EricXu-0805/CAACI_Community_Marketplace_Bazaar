import { test, expect, type Page } from '@playwright/test'

/*
 * prefers-reduced-motion, checked against what the browser actually runs.
 *
 * App.vue named its own primitives (.u-rise, .u-sk, .u-stagger) in the guard,
 * at class specificity. Anything declared inside a page compiles to
 * `.spinner[data-v-1a2b3c]` and outranks that, so the loading spinners, the
 * home shimmer and the typing blink all kept going for a user who had asked
 * the OS to stop. The probe below reproduces exactly that shape rather than
 * trusting a page to be mid-load when the test looks at it.
 */
const PAGES = ['pages/index/index', 'pages/plaza/index', 'pages/messages/index']

async function installScopedProbes(page: Page) {
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = `
      @keyframes motion-probe-spin { to { transform: rotate(360deg); } }
      .motion-probe[data-v-probe] { animation: motion-probe-spin 1s linear infinite; }
      .motion-probe-fade[data-v-probe] { transition: opacity 5s linear; }
    `
    document.head.append(style)
    for (const className of ['motion-probe', 'motion-probe-fade']) {
      const el = document.createElement('div')
      el.className = className
      el.setAttribute('data-v-probe', '')
      el.id = className
      document.body.append(el)
    }
  })
}

const runningForever = () => document.getAnimations()
  .filter(animation => animation.effect?.getComputedTiming().iterations === Infinity)
  .map((animation) => {
    const target = (animation.effect as KeyframeEffect | null)?.target
    return target ? `${target.tagName.toLowerCase()}.${target.className}` : 'unknown'
  })

const probeTransitionSeconds = () => parseFloat(
  getComputedStyle(document.getElementById('motion-probe-fade')!).transitionDuration,
)

/*
 * page.emulateMedia, not test.use({ reducedMotion }) — the fixture form is
 * accepted and then does nothing here (matchMedia still reports false), so a
 * suite written that way would assert "nothing loops" against a browser that
 * was never asked to reduce anything.
 */
test.describe('reduced motion', () => {
  for (const route of PAGES) {
    test(`${route} — nothing loops forever`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(`/#/${route}`, { waitUntil: 'networkidle' })
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
      await installScopedProbes(page)
      expect(await page.evaluate(runningForever)).toEqual([])
      expect(await page.evaluate(probeTransitionSeconds)).toBeLessThan(0.01)
    })
  }
})

// Without this the suite above would pass on a page that simply has no
// animation to stop, and the probe would be proving nothing.
test('the probe really does loop when nothing is suppressing it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/#/pages/index/index', { waitUntil: 'networkidle' })
  await installScopedProbes(page)
  expect(await page.evaluate(runningForever)).toContain('div.motion-probe')
  expect(await page.evaluate(probeTransitionSeconds)).toBe(5)
})

test('the banner carousel can be stopped by touch', async ({ page }) => {
  await page.goto('/#/pages/plaza/index', { waitUntil: 'networkidle' })
  const toggle = page.locator('.banner-toggle')
  // Banners are DB-driven; a project with fewer than two live rows has no
  // carousel to pause, and the source-level contract covers that case.
  if (await toggle.count() === 0) test.skip()

  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('role', 'button')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')

  const box = await toggle.boundingBox()
  expect(box!.width, 'the control sits inside a slide with a different action').toBeGreaterThanOrEqual(24)
  expect(box!.height).toBeGreaterThanOrEqual(24)

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  // Sticky: a pointer leaving must not restart what the reader stopped.
  await page.mouse.move(0, 0)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
})
