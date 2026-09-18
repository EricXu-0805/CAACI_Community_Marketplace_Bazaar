import { test, expect, type Page } from '@playwright/test'
import { CURRENT_CONSENT_VERSION } from '../src/legal'
import { supabaseRefForCompiledBuild } from './supabase-ref'

const projectRef = supabaseRefForCompiledBuild()
const owner = '11111111-1111-4111-8111-111111111111'

async function fixture(page: Page) {
  await page.addInitScript(({ ref, owner }) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
    const generation = 'compiled-draft-acceptance'
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      tag: 'caaci-auth-value-v2', generation,
      value: JSON.stringify({ access_token: 'stub', refresh_token: 'stub', token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: owner, email: 'fixture@example.invalid', aud: 'authenticated', role: 'authenticated' } }),
    }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({ v: 2, mode: 'allowed', generation }))
  }, { ref: projectRef, owner })
  await page.routeWebSocket(/supabase\.co/, socket => socket.close())
  await page.route('**/*.sentry.io/**', route => route.abort())
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ contentType: 'application/json', body: '{}' }))
  await page.route('**/*.supabase.co/**', route => {
    const path = new URL(route.request().url()).pathname
    const profile = { id: owner, nickname: 'Draft fixture', avatar_url: null, bio: '',
      tos_version: CURRENT_CONSENT_VERSION, suspension_level: 0, suspended_until: null }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(
      path.endsWith('/get_my_profile') ? profile : path.endsWith('/profiles') ? [profile] : [],
    ) })
  })
}

test('compiled publishing saves durably, restores after reload, and discards only by choice', async ({ page }) => {
  await fixture(page)
  await page.goto('/#/pages/publish/index')
  const title = page.getByRole('textbox', { name: 'Title (required)', exact: true })
  await title.fill('Keep this listing through a browser reload')
  await page.locator('.image-tip').click()
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page).not.toHaveURL(/pages\/publish\/index/)
  await expect(page.getByText('Draft saved for this visit. Keep this tab open; refreshing or closing it can lose these edits.', { exact: true })).toHaveCount(0)

  // A fresh document removes component memory; only a real persistent draft
  // can satisfy this. Dev-server window.uni shims cannot hide the regression.
  await page.reload()
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await page.getByRole('button', { name: 'Keep', exact: true }).click()
  await expect(title).toHaveValue('Keep this listing through a browser reload')
  await expect(page.locator('.draft-storage-notice')).toHaveCount(0)
  await page.locator('.image-tip').click()
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  await page.getByRole('button', { name: 'Drop', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(title).toHaveValue('')
  await expect(page.getByText('Restore draft?', { exact: true })).toHaveCount(0)
})
