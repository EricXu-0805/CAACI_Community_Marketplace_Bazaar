import { test, expect } from '@playwright/test'

/**
 * The resend countdown has to follow the clock, not the number of ticks.
 *
 * This screen exists to send someone away to their mail app, and a
 * backgrounded page has its intervals throttled or suspended. A counter that
 * decremented once per tick therefore came back reading whatever it had
 * reached before the app went away, and "Resend" stayed disabled long after
 * the minute was up — on the one screen where being stuck means never
 * finishing sign-up.
 *
 * The absolute deadline was already stored for exactly this reason; it was
 * only ever consulted on a fresh page load.
 *
 * Playwright's clock is the right instrument: fastForward advances time
 * without running the timers that would have fired in between, which is the
 * suspended-interval case rather than a slow one.
 */

const KEY = 'signup-pending-confirm'

async function openConfirmScreen(page: import('@playwright/test').Page, cooldownSeconds: number) {
  // uni's storage is localStorage on H5, one key per entry.
  await page.addInitScript(([key, seconds]) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
    localStorage.setItem(key as string, JSON.stringify({
      email: 'someone@illinois.edu',
      expiresAt: Date.now() + 30 * 60_000,
      cooldownUntil: Date.now() + (seconds as number) * 1000,
    }))
  }, [KEY, cooldownSeconds] as const)
}

const resend = (page: import('@playwright/test').Page) => page.locator('.resend')

test('the resend countdown reflects real elapsed time, not tick count', async ({ page }) => {
  await page.clock.install()
  await openConfirmScreen(page, 60)
  await page.goto('/#/pages/login/index', { waitUntil: 'networkidle' })

  await expect(resend(page), 'the confirm screen must restore with a live cooldown').toContainText(/\d+/)
  await expect(resend(page)).toHaveClass(/disabled/)

  // Away in the mail app for two minutes, with no timers running.
  await page.clock.fastForward('02:00')

  await expect
    .poll(async () => (await resend(page).getAttribute('class')) || '', {
      message: 'a minute of cooldown cannot outlast two minutes away from the app',
      timeout: 10_000,
    })
    .not.toMatch(/disabled/)
})

test('a partly elapsed cooldown resumes at the right number', async ({ page }) => {
  await page.clock.install()
  await openConfirmScreen(page, 60)
  await page.goto('/#/pages/login/index', { waitUntil: 'networkidle' })
  await expect(resend(page)).toHaveClass(/disabled/)

  await page.clock.fastForward('00:45')

  // 60 - 45 = 15 left. A tick-counting implementation would still read ~60.
  await expect
    .poll(async () => {
      const text = (await resend(page).innerText()) || ''
      return Number(/(\d+)/.exec(text)?.[1] ?? -1)
    }, {
      message: 'the countdown must resume from the deadline it stored',
      timeout: 10_000,
    })
    .toBeLessThanOrEqual(16)
})

/*
 * Control. Both assertions above are satisfied by a screen that never
 * disables Resend at all, which would hand the sending domain an unlimited
 * retry button.
 */
test('a fresh cooldown does disable resend', async ({ page }) => {
  await page.clock.install()
  await openConfirmScreen(page, 60)
  await page.goto('/#/pages/login/index', { waitUntil: 'networkidle' })

  await expect(resend(page), 'a cooldown that has just started must hold').toHaveClass(/disabled/)
  await page.clock.fastForward('00:05')
  await expect(resend(page)).toHaveClass(/disabled/)
})
