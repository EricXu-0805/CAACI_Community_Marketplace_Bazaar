import { test, expect, type Page } from '@playwright/test'
import { CURRENT_CONSENT_VERSION } from '../src/legal'
import { supabaseRefForBuild } from './supabase-ref'

test.use({ reducedMotion: 'no-preference' })

const ME = '11111111-1111-4111-8111-111111111111'
const SELLER = '22222222-2222-4222-8222-222222222222'

async function fixture(page: Page, theme: string) {
  let releaseFollowing!: () => void
  const followingResponse = new Promise<void>(resolve => { releaseFollowing = resolve })
  const writes: string[] = []
  await page.addInitScript(({ ref, me, theme }) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
    localStorage.setItem('theme_pref', theme)
    const generation = 'seller-follow-contrast'
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      tag: 'caaci-auth-value-v2', generation,
      value: JSON.stringify({ access_token: 'stub', refresh_token: 'stub', token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: me, email: 'fixture@example.invalid', aud: 'authenticated', role: 'authenticated' } }),
    }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`,
      JSON.stringify({ v: 2, mode: 'allowed', generation }))
  }, { ref: supabaseRefForBuild(), me: ME, theme })
  await page.routeWebSocket(/\.supabase\.co(?:[:/]|$)/, socket => socket.close())
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.hostname.endsWith('.supabase.co')) {
      if (['localhost', '127.0.0.1'].includes(url.hostname)) return route.continue()
      return route.abort()
    }
    const profile = { id: ME, nickname: 'Demo buyer', avatar_url: null,
      tos_version: CURRENT_CONSENT_VERSION, suspension_level: 0, suspended_until: null }
    let data: unknown = []
    if (url.pathname.endsWith('/rpc/get_my_profile')) data = profile
    if (url.pathname.endsWith('/profiles')) {
      data = [{ ...profile, id: SELLER, nickname: 'Demo seller' }]
    }
    if (url.pathname.endsWith('/follows')) {
      if (request.method() === 'GET') {
        await followingResponse
        data = [{ followee_id: SELLER }]
      } else {
        writes.push(request.method())
      }
    }
    const single = (request.headers().accept || '').includes('vnd.pgrst.object')
    await route.fulfill({ contentType: 'application/json',
      body: JSON.stringify(single && Array.isArray(data) ? data[0] ?? null : data) })
  })
  return { releaseFollowing, writes }
}

/**
 * Observe the real Vue state change before any browser frame can be missed.
 * Seek every transition created by that change to fixed timeline fractions;
 * read the actual browser-computed colors, including their easing. This
 * catches inaccessible intermediate colors even on fast/loaded runners,
 * without extending durations, reducing motion or waiting out the defect.
 */
async function observeNextState(page: Page, pressed: boolean) {
  await page.locator('.follow-btn').evaluate((element, pressed) => {
    const button = element as HTMLElement
    const luminance = (color: string) => {
      const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
        const channel = value / 255
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
    }
    const sample = (progress: number) => {
      const foreground = getComputedStyle(button.querySelector('span') || button).color
      const background = getComputedStyle(button).backgroundColor
      const a = luminance(foreground), b = luminance(background)
      return { progress, foreground, background, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
    }
    // Commit the starting style before the asynchronous application update.
    const before = sample(-1)
    const result = new Promise<ReturnType<typeof sample>[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        observer.disconnect()
        reject(new Error('Seller follow state did not change'))
      }, 10_000)
      const observer = new MutationObserver(() => {
        if (button.getAttribute('aria-pressed') !== String(pressed)) return
        observer.disconnect()
        clearTimeout(timeout)
        // Flush the changed class so getAnimations includes new transitions.
        getComputedStyle(button).color
        const animations = button.getAnimations({ subtree: true })
        for (const animation of animations) animation.pause()
        const samples = [before]
        for (let step = 0; step <= 20; step++) {
          const progress = step / 20
          for (const animation of animations) {
            const duration = animation.effect?.getComputedTiming().duration
            if (typeof duration === 'number') animation.currentTime = duration * progress
          }
          samples.push(sample(progress))
        }
        for (const animation of animations) animation.finish()
        resolve(samples)
      })
      observer.observe(button, { attributes: true, attributeFilter: ['aria-pressed'] })
    })
    ;(window as any).__followContrast = result
  }, pressed)
}

async function expectReadableChange(page: Page, label: string) {
  const samples = await page.evaluate(() => (window as any).__followContrast) as {
    progress: number; foreground: string; background: string; ratio: number
  }[]
  expect(samples.length).toBe(22)
  // These tokens are opaque RGB. Fail closed if future styling needs alpha
  // compositing rather than silently treating a transparent color as opaque.
  const failures = samples.filter(sample => !/^rgb\(/.test(sample.foreground)
    || !/^rgb\(/.test(sample.background) || !Number.isFinite(sample.ratio) || sample.ratio < 4.5)
  expect(failures, `${label}: ${JSON.stringify(failures)}`).toEqual([])
}

for (const theme of ['light', 'dark']) {
  test(`seller follow stays readable during loading and toggles (${theme})`, async ({ page }) => {
    const { releaseFollowing, writes } = await fixture(page, theme)
    await page.goto(`/#/pages/seller/index?id=${SELLER}`)
    const button = page.locator('.follow-btn')
    await expect(button).toHaveAttribute('aria-pressed', 'false')
    await expect(button).toHaveText('Follow')

    await observeNextState(page, true)
    releaseFollowing()
    await expectReadableChange(page, 'load saved following')
    await expect(button).toHaveText('Following')

    for (const pressed of [false, true]) {
      await observeNextState(page, pressed)
      await button.click()
      await expectReadableChange(page, pressed ? 'follow' : 'unfollow')
      await expect(button).toHaveAttribute('aria-pressed', String(pressed))
      await expect(button).toHaveText(pressed ? 'Following' : 'Follow')
    }
    expect(writes).toEqual(['DELETE', 'POST'])
  })
}
