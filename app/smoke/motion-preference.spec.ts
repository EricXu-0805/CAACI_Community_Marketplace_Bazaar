import { test, expect, type Page } from '@playwright/test'
import { supabaseRefForBuild } from './supabase-ref'

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

async function openBannerFixture(page: Page) {
  const owner = '11111111-1111-4111-8111-111111111111'
  const upload = '22222222-2222-4222-8222-222222222222'
  const banners = ['a', 'b', 'c'].map((hash, i) => ({
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i + 1).padStart(12, '0')}`,
    image_url: `https://${supabaseRefForBuild()}.supabase.co/storage/v1/object/public/banners/managed/${owner}/${upload}/${hash.repeat(64)}.png`,
    target_url: '/pages/search/index', title: `Campus banner ${i + 1}`, priority: i,
  }))
  await page.addInitScript(() => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
  })
  await page.routeWebSocket(/supabase\.co/, socket => socket.close())
  await page.route('**/*.supabase.co/**', route => {
    if (route.request().url().includes('/storage/')) return route.fulfill({ contentType: 'image/png',
      body: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c636000000200010005fe02fea70000000049454e44ae426082', 'hex') })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(
      route.request().url().includes('/rest/v1/banners_live?') ? banners : [],
    ) })
  })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/#/pages/plaza/index', { waitUntil: 'networkidle' })
  await expect(page.locator('.banner-slide')).toHaveCount(3)
}

test('the banner carousel can be stopped by touch', async ({ page }) => {
  await openBannerFixture(page)
  const toggle = page.locator('.banner-toggle')

  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('role', 'button')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')

  const box = await toggle.boundingBox()
  expect(box!.width, 'the control sits inside a slide with a different action').toBeGreaterThanOrEqual(24)
  expect(box!.height).toBeGreaterThanOrEqual(24)

  const active = page.locator('.banner-swiper [aria-hidden="false"]')
  const initial = await active.getAttribute('aria-label')
  await expect(active).not.toHaveAttribute('aria-label', initial!, { timeout: 8000 })
  await toggle.tap()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  const paused = await active.getAttribute('aria-label')
  // Sticky: a pointer leaving must not restart what the reader stopped.
  await page.mouse.move(0, 0)
  await page.waitForTimeout(5500)
  await expect(active).toHaveAttribute('aria-label', paused!)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await toggle.tap()
  await expect(active).not.toHaveAttribute('aria-label', paused!, { timeout: 8000 })
})

test('keyboard traversal only visits the visible banner link', async ({ page }) => {
  await openBannerFixture(page)
  const carousel = page.locator('.banner-swiper')
  await carousel.focus()
  await carousel.press('End')
  await expect(page.locator('.banner-swiper [aria-hidden="false"]')).toHaveAttribute('aria-label', 'Slide 3 of 3')
  await carousel.press('Tab')
  await expect(page.getByRole('button', { name: 'Campus banner 3', exact: true })).toBeFocused()
  await expect.poll(() => carousel.evaluate(el => Math.abs(
    el.querySelector('[aria-hidden="false"]')!.getBoundingClientRect().left - el.getBoundingClientRect().left,
  ))).toBeLessThan(1)
  await page.keyboard.press('Tab')
  await expect(page.locator('.banner-toggle')).toBeFocused()
  await carousel.focus()
  await carousel.press('Home')
  await carousel.press('Tab')
  await expect(page.getByRole('button', { name: 'Campus banner 1', exact: true })).toBeFocused()
  await expect.poll(() => carousel.evaluate(el => Math.abs(
    el.querySelector('[aria-hidden="false"]')!.getBoundingClientRect().left - el.getBoundingClientRect().left,
  ))).toBeLessThan(1)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/pages\/search\/index/)
})
