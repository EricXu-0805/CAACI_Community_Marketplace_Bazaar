import { test, expect } from '@playwright/test'

// This case needs Vite's emitted preload wrapper; a dev-server event mock
// cannot prove that Vue's handled lazy-route rejection reaches our recovery.
test('a missing compiled route reloads once and restores the requested journey', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
  })
  await page.routeWebSocket(/supabase\.co/, socket => socket.close())
  await page.route('**/*.supabase.co/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }))
  // Model a deployment: the open entry references a removed hash, while the
  // refreshed entry references the current one. WebKit can remember a failed
  // module URL across reloads, so returning 404 once for an unchanged hash is
  // a different (persistent resource failure) scenario.
  let servedOldEntry = false, failedUrl = '', reloads = 0
  await page.route('**/assets/index-*.js', async route => {
    if (servedOldEntry) return route.continue()
    const response = await route.fetch()
    const source = await response.text()
    expect(source).toMatch(/pages-publish-index\.[\w-]+\.js/)
    servedOldEntry = true
    await route.fulfill({ response, body: source.replaceAll(/pages-publish-index\.[\w-]+\.js/g, 'pages-publish-index.removed-release.js') })
  })
  await page.route('**/assets/pages-publish-index.removed-release.js', route => {
    failedUrl = route.request().url()
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Previous release chunk unavailable' })
  })
  await page.goto('/#/pages/index/index')
  await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeVisible()
  page.on('load', () => { reloads++ })
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible()
  expect(failedUrl).toContain('/assets/pages-publish-index.')
  expect(reloads).toBe(1)
  await expect(page).toHaveURL(/pages\/login\/index\?intent=/)
  await expect(page.getByText('The connection timed out, click the screen to try again.')).toHaveCount(0)
})
