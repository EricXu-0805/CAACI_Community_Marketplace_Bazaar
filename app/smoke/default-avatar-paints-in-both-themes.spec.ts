import { test, expect, type Page } from '@playwright/test'
import { supabaseRefForBuild, supabaseUrlForBuild } from './supabase-ref'

/**
 * The default avatar has to decode, not merely be requested.
 *
 * default-avatar-dark.svg carried a comment naming the CSS tokens it matched
 * (`--surface-alt`, `--ink-faint`). `--` inside an XML comment is a fatal XML
 * error, and an SVG served as an image is parsed by the XML parser, so every
 * browser fetched the file with a 200 and then threw the whole picture away.
 * Dark mode showed an empty disc for every account with no uploaded avatar.
 *
 * The asset was well-formed enough for `curl` and for the network panel, which
 * is why reading the response proved nothing. uni's H5 <image> only writes the
 * background-image and appends its inner <img> once the decode succeeds, so
 * that <img>'s naturalWidth is the one signal that separates a painted avatar
 * from a blank one. Light mode is the control: it shares the code path and the
 * same page, and was never broken.
 */

const SUPABASE_HOST = new URL(supabaseUrlForBuild()).hostname
const REF = supabaseRefForBuild()
const UID = '11111111-1111-4111-8111-111111111111'
const GEN = 'default-avatar-generation-0001'

// avatar_url null is the whole point: this is the account that falls back.
const PROFILE = {
  id: UID, nickname: 'Test User', avatar_url: null, tos_version: '2026-08-01',
  suspension_level: 0, suspended_until: null, is_illini_verified: true, bio: 'hi', location: 'UIUC',
}

async function seed(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript(([ref, uid, gen, pref]) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
    localStorage.setItem('theme_pref', pref)
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      tag: 'caaci-auth-value-v2',
      generation: gen,
      value: JSON.stringify({
        access_token: 'stub', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub',
        user: { id: uid, email: 'a@illinois.edu', aud: 'authenticated', role: 'authenticated' },
      }),
    }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({
      v: 2, mode: 'allowed', generation: gen,
    }))
  }, [REF, UID, GEN, theme] as const)

  await page.route(`**/${SUPABASE_HOST}/**`, async (route) => {
    const path = route.request().url().replace(/^https:\/\/[^/]+/, '')
    const body = path.includes('/rpc/get_my_profile') ? PROFILE : []
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/1' }, body: JSON.stringify(body),
    })
  })
}

async function openOwnProfile(page: Page, theme: 'light' | 'dark') {
  await seed(page, theme)
  await page.goto('/#/pages/profile/index', { waitUntil: 'domcontentloaded' })
  const avatar = page.locator('.avatar-big')
  await avatar.waitFor({ state: 'visible', timeout: 20_000 })
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme)
  return avatar
}

for (const [theme, asset] of [
  ['dark', 'default-avatar-dark.svg'],
  ['light', 'default-avatar.svg'],
] as const) {
  test(`the ${theme} default avatar decodes and paints`, async ({ page }) => {
    const avatar = await openOwnProfile(page, theme)

    const painted = avatar.locator('img')
    await expect(
      painted,
      `${asset} never decoded: uni appends this <img> only after the load succeeds`,
    ).toBeAttached({ timeout: 20_000 })
    expect(await painted.getAttribute('src')).toContain(asset)

    const size = await painted.evaluate(el => ({
      width: (el as HTMLImageElement).naturalWidth,
      height: (el as HTMLImageElement).naturalHeight,
    }))
    expect(size.width, `${asset} did not decode`).toBeGreaterThan(0)
    expect(size.height, `${asset} did not decode`).toBeGreaterThan(0)

    const background = await avatar.evaluate(el => (
      getComputedStyle(el.firstElementChild as Element).backgroundImage
    ))
    expect(background, `${asset} was fetched but never painted`).toContain(asset)
  })
}
