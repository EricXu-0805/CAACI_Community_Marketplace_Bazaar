import { expect, type Page } from '@playwright/test'
import { recordSessionLogout } from './probe-data.mjs'

export class AppDefect extends Error {
  constructor(public phase: string, public rule: number) {
    super(`closed_app_defect_${rule}_${phase}`)
  }
}

export function errorKind(error: any) {
  if (error?.name === 'TimeoutError' || /timeout/i.test(String(error?.message))) return 'timeout'
  if (String(error?.message).includes('strict mode violation')) return 'strict'
  if (error?.matcherResult || String(error?.message).includes('expect(')) return 'assertion'
  return 'other'
}

export async function routeGates(page: Page) {
  return page.evaluate(() => ({
    home: /^#\/(?:pages\/index\/index)?$/.test(location.hash),
    welcome: location.hash.includes('/pages/welcome/index'),
    reconsent: location.hash.includes('/pages/reconsent/index'),
    recovery: location.hash.includes('/pages/profile-recovery/index'),
    login: location.hash.includes('/pages/login/index'),
    suspended: location.hash.includes('/pages/suspended/index'),
  }))
}

export async function moderateOnly(page: Page) {
  await page.route('**/api/moderate', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ flagged: false, categories: [], skipped: true, reason: 'no_key' }),
  }))
}

export async function navigate(page: Page, url: string, tab = false) {
  await page.evaluate(({ url, tab }) => new Promise<void>((resolve, reject) => {
    const uni = (window as any).uni
    uni[tab ? 'switchTab' : 'navigateTo']({ url, success: () => resolve(), fail: () => reject(new Error('navigation_failed')) })
  }), { url, tab })
}

export async function login(page: Page, account: string) {
  await expect(page.locator('.form-group input').first()).toBeVisible()
  await page.evaluate(({ email, password }) => {
    const fields = [
      [document.querySelector('.form-group input'), email],
      [document.querySelector('.pw-input input, input.pw-input'), password],
    ] as const
    for (const [field, value] of fields) {
      if (!(field instanceof HTMLInputElement) || !value) throw new Error('login_field_unavailable')
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }, { email: process.env[`SYN_${account}_EMAIL`], password: process.env[`SYN_${account}_PASSWORD`] })
  const authResponse = page.waitForResponse(r => r.url().includes('/auth/v1/token?grant_type=password'), { timeout: 15_000 })
  await page.locator('.submit-btn').click()
  const response = await authResponse
  console.log(JSON.stringify({ action: 'login', identity: account, status: response.status() }))
  expect(response.status()).toBe(200)
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('sb-hygkwxugskijadgfisji-auth-token')
    try {
      const envelope = JSON.parse(raw || 'null')
      const session = typeof envelope?.value === 'string' ? JSON.parse(envelope.value) : envelope
      return Boolean(session?.user?.id)
    } catch { return false }
  })).toBe(true)
  await expect(page.locator('.form-group input').first()).not.toBeVisible()
}

export async function acceptConsent(page: Page, account: string) {
  await expect.poll(async () => new URL(page.url()).hash.includes('/pages/reconsent/index')).toBe(true)
  const recorded = page.waitForResponse(r => r.url().endsWith('/rest/v1/rpc/record_consent'))
  await page.locator('.btn-primary').click()
  const response = await recorded
  console.log(JSON.stringify({ action: 'consent', identity: account, status: response.status() }))
  expect(response.ok()).toBe(true)
}

export async function homeStable(page: Page) {
  await expect(page).toHaveURL(/#\/(?:pages\/index\/index)?$/)
  await expect(page.getByRole('heading', { name: /^(Home|首页)$/ })).toBeVisible()
  let leftForGate = false
  const watch = () => {
    const hash = new URL(page.url()).hash
    if (hash.includes('/pages/reconsent/index') || hash.includes('/pages/profile-recovery/index')) leftForGate = true
  }
  page.on('framenavigated', watch)
  await page.waitForTimeout(3000)
  page.off('framenavigated', watch)
  if (leftForGate) throw new AppDefect('home_gate_redirect', 3)
  await expect(page).toHaveURL(/#\/(?:pages\/index\/index)?$/)
  await expect(page.getByRole('heading', { name: /^(Home|首页)$/ })).toBeVisible()
}

export async function uiLogout(page: Page, account: string) {
  const statuses: number[] = []
  const observe = (response: any) => {
    if (response.url().includes('/auth/v1/logout')) statuses.push(response.status())
  }
  page.on('response', observe)
  try {
    await navigate(page, '/pages/settings/index')
    await page.getByRole('button', { name: /^(Sign Out|退出登录)$/ }).click()
    await page.locator('.uni-modal__btn_primary').click()
    await expect.poll(() => page.evaluate(() => localStorage.getItem('sb-hygkwxugskijadgfisji-auth-token'))).toBeNull()
    await expect(page).toHaveURL(/#\/(?:pages\/index\/index)?$/)
    await expect.poll(() => statuses.length).toBeGreaterThan(0)
  } catch {
    // Session cleanup is reported separately and cannot invalidate the DoD.
  } finally {
    page.off('response', observe)
    await recordSessionLogout(account, 'ui', statuses)
  }
}

export async function ensureScreenshotSafe(page: Page) {
  const safe = await page.evaluate(values => {
    const text = document.body.innerText
    return values.every(value => !value || !text.includes(value))
      && !Array.from(document.querySelectorAll('input')).some(input => Boolean(input.value))
  }, ['A', 'B', 'C'].flatMap(k => [process.env[`SYN_${k}_EMAIL`], process.env[`SYN_${k}_PASSWORD`]]))
  expect(safe, 'screenshot contains no credentials').toBe(true)
}
