import { test, expect, type Page } from '@playwright/test'

const seller = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const row = (n: number) => ({
  id: `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`, user_id: seller,
  title: `Pagination listing ${n}`, description: '', title_i18n: null, description_i18n: null,
  source_lang: 'en', price: 10, status: 'active', category: 'other', condition: 'good',
  listing_type: 'sell', location: 'UIUC', images: [], image_dimensions: [],
  view_count: 0, favorite_count: 0, created_at: `2026-08-01T00:00:${String(59 - n).padStart(2, '0')}Z`,
  profile: { id: seller, nickname: 'Test seller', avatar_url: null },
})

async function bottom(page: Page) {
  await page.locator('.feed').evaluate(root => {
    const scroller = [root, ...root.querySelectorAll('*')].find(node => {
      const element = node as HTMLElement
      return /(auto|scroll)/.test(getComputedStyle(element).overflowY)
        && element.scrollHeight > element.clientHeight + 4
    }) as HTMLElement | undefined
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  })
}

test('home retries the same page, keeps the cards, and survives inserts/deletions above the cursor', async ({ page }) => {
  let data = Array.from({ length: 45 }, (_, i) => row(i + 1))
  let fail = false
  const requests: URL[] = []
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en'); localStorage.setItem('welcomed', '1')
  })
  await page.route('**/*.supabase.co/**', async route => {
    const url = new URL(route.request().url())
    if (!url.pathname.endsWith('/rest/v1/items')) {
      return route.fulfill({ contentType: 'application/json', body: '[]' })
    }
    requests.push(url)
    const cursor = url.searchParams.get('or')
    const offset = Number(url.searchParams.get('offset') || 0)
    if (fail && (cursor || offset > 0)) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"temporary failure"}' })
    }
    let candidates = data
    if (cursor) {
      const id = cursor.match(/id\.lt\.([0-9a-f-]+)/)?.[1]
      const boundary = Array.from({ length: 45 }, (_, i) => row(i + 1)).find(item => item.id === id)
      expect(boundary, 'request must carry the exact last row as its cursor').toBeTruthy()
      candidates = data.filter(item => item.created_at < boundary!.created_at
        || (item.created_at === boundary!.created_at && item.id < boundary!.id))
    }
    const result = candidates.slice(offset, offset + Number(url.searchParams.get('limit') || 20))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) })
  })
  await page.goto('/#/pages/index/index')
  await expect(page.getByText('Pagination listing 1', { exact: true })).toBeVisible()
  expect(requests[0].searchParams.get('order')).toBe('created_at.desc,id.desc')
  // Remove three rows above page two and insert a new head. Offsets would now
  // omit two previously unseen listings even if duplicate cards were filtered.
  data = [row(0), ...data.slice(3)]
  fail = true
  await expect.poll(async () => { await bottom(page); return requests.length }).toBeGreaterThan(1)
  await expect(page.getByRole('alert')).toBeVisible()
  expect(await page.locator('.card').count()).toBe(20)
  const failedCursor = requests.at(-1)!.searchParams.get('or')
  expect(failedCursor).toContain(row(20).id)
  fail = false
  await page.getByRole('alert').getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('.card')).toHaveCount(40)
  expect(requests.at(-1)!.searchParams.get('or')).toBe(failedCursor)
  expect(await page.getByText('Pagination listing 21', { exact: true }).count()).toBe(1)
  expect(await page.getByText('Pagination listing 1', { exact: true }).count()).toBe(1)
  await expect(page.getByRole('alert')).toHaveCount(0)
})
