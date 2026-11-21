import { test, expect } from '@playwright/test'

/**
 * The document has to say which language it is actually in.
 *
 * app/index.html declares lang="en" and explains why: the CSP allows no inline
 * script, so the shell cannot follow the reader's saved choice before any
 * script has run. That is a fine starting value. What was missing is anything
 * correcting it afterwards — so a reader who picked English got the whole app,
 * on every route, still declared as Chinese.
 *
 * That is not cosmetic. A screen reader chooses its voice and its
 * pronunciation rules from this attribute, so every English string on every
 * page was announced by a Chinese voice; and the crawler that renders a shared
 * link reads the same wrong declaration.
 *
 * syncUniLocale is the one choke point: ensureLangInit calls it for the saved
 * or detected language, and setLang calls it on every switch.
 */

const docLang = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.lang)

test('a saved English preference is declared on the document', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
  })
  await page.goto('/#/pages/index/index', { waitUntil: 'domcontentloaded' })

  await expect.poll(() => docLang(page), {
    message: 'an English reader is still served a document declared as Chinese',
    timeout: 20_000,
  }).toBe('en')
})

test('a saved Chinese preference is declared too, so this is not a constant', async ({ page }) => {
  // Control. Without it the assertion above is satisfied by hardcoding 'en',
  // which would be exactly the same bug pointing the other way.
  await page.addInitScript(() => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'zh')
  })
  await page.goto('/#/pages/index/index', { waitUntil: 'domcontentloaded' })

  await expect.poll(() => docLang(page), {
    message: 'a Chinese reader must keep the Chinese declaration',
    timeout: 20_000,
  }).toBe('zh')
})

test('language selection updates labels and title and survives a reload', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('welcomed', '1')
    if (!localStorage.getItem('lang')) localStorage.setItem('lang', 'zh')
  })
  await page.goto('/#/pages/index/index', { waitUntil: 'domcontentloaded' })
  await expect.poll(() => docLang(page), { timeout: 20_000 }).toBe('zh')

  // .mh-lang is the header toggle on Home, wired straight to toggleLang.
  await expect(page).toHaveTitle('首页 · 玉米地')
  const toggle = page.locator('.mh-lang').first()
  await expect(toggle).toBeVisible({ timeout: 15_000 })
  await toggle.click()

  await expect.poll(() => docLang(page), {
    message: 'the declaration did not follow the switch the reader just made',
    timeout: 20_000,
  }).toBe('en')
  await expect(page).toHaveTitle('Home · Cornfield')
  await page.reload()
  await expect.poll(() => docLang(page)).toBe('en')
  await expect(page).toHaveTitle('Home · Cornfield')
  await toggle.click()
  await expect(page).toHaveTitle('首页 · 玉米地')
})

for (const [device, viewport] of [
  ['phone', { width: 390, height: 844 }],
  ['tablet', { width: 1024, height: 768 }],
  ['desktop', { width: 1440, height: 900 }],
] as const) {
  test(`${device}: a new visitor can change language on welcome and sign-in`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.addInitScript(() => {
      if (!localStorage.getItem('lang')) localStorage.setItem('lang', 'en')
    })
    await page.goto('/#/pages/welcome/index', { waitUntil: 'domcontentloaded' })
    const language = page.locator('.language-choice')
    await language.getByRole('button', { name: 'Switch to Chinese' }).click()
    await expect.poll(() => docLang(page)).toBe('zh')
    await expect(page).toHaveTitle('玉米地')
    await page.goto('/#/pages/login/index', { waitUntil: 'domcontentloaded' })
    await language.getByRole('button', { name: '切换到英文' }).click()
    await expect(page).toHaveTitle('Sign In · Cornfield')
    await expect(page.locator('.tab-bar')).toContainText('Sign In')
    await page.reload()
    await expect.poll(() => docLang(page)).toBe('en')
    await expect(language.getByRole('button', { name: 'Switch to Chinese' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
