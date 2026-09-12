import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

test.use({ browserName: process.env.UI_AUDIT_BROWSER === 'chromium' ? 'chromium' : 'webkit' })

for (const lang of ['en', 'zh'] as const) test(`search timeout: ${lang} retains intent and recovers after narrowing the category`, async ({ page }) => {
  const calls: Record<string, unknown>[] = []
  const reads: URL[] = []
  await page.addInitScript(language => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', language)
  }, lang)
  await page.routeWebSocket(/supabase\.co/, socket => socket.close())
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ contentType: 'application/json', body: '{}' }))
  await page.route('**/*.supabase.co/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.includes('/rpc/search_items_fuzzy')) {
      const args = route.request().postDataJSON()
      calls.push(args)
      if (args.category_in !== 'furniture') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({
        code: '57014', message: 'canceling statement due to statement timeout', details: 'search_items_fuzzy_v2 internal context',
      }) })
      return route.fulfill({ contentType: 'application/json', body: '[]' })
    }
    reads.push(url)
    return route.fulfill({ contentType: 'application/json', body: '[]' })
  })
  await page.goto('/#/')
  await page.locator('.search-proxy:visible').click()
  const query = page.getByRole('searchbox')
  await query.fill('desk')
  await query.press('Enter')
  const message = lang === 'en'
    ? 'Search took too long. Choose a category, narrow the price range, or try again shortly.'
    : '搜索暂时超时了。试试选择分类、缩小价格范围，或稍后重试。'
  await expect(page.getByRole('alert')).toContainText(message)
  await expect(page.locator('.result-count')).toHaveCount(0)
  expect(calls).toHaveLength(1)
  expect(calls[0].terms_in).toContain('desk')
  await expect(page.getByText('search_items_fuzzy_v2 internal context', { exact: true })).toHaveCount(0)
  if (process.env.UI_AUDIT_CAPTURE) {
    const dir=resolve('../output/playwright/launch-readiness-20260911/ui')
    mkdirSync(dir,{recursive:true})
    await page.screenshot({path:resolve(dir,`timeout-${lang}-${process.env.UI_AUDIT_BROWSER || 'webkit'}.png`)})
  }
  const furniture = page.locator('.pill').filter({ hasText: lang === 'en' ? /^Furniture$/ : /^家具$/ })
  await furniture.click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect.poll(() => calls.length).toBe(2)
  await expect(page.locator('.empty-title')).toBeVisible()
  expect(calls[1]).toMatchObject({ category_in: 'furniture', terms_in: calls[0].terms_in })
  // Narrowing the search must not silently switch to unfiltered browsing.
  expect(reads.filter(url=>url.pathname.endsWith('/items')&&url.searchParams.has('category'))).toHaveLength(0)
  expect((await furniture.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await expect(furniture).toHaveAttribute('aria-pressed', 'true')
})
