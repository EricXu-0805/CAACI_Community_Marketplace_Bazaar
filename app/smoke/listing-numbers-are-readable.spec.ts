import { test, expect, type Page } from '@playwright/test'

/**
 * The two numbers a browsing student reads on a listing.
 *
 * On a 390px phone the home card's bottom row held an avatar, a nickname, the
 * Illini pill, the seller rating, a timestamp, a heart and a favourite count in
 * about 155px. Everything after the nickname was shrinkable, so the rating was
 * cut mid-glyph: "4.0/5" painted as "4.0/" plus half a 5, and on a verified
 * seller's card it shrank to a bare "4". A rating that reads "4" out of nothing
 * is worse than no rating at all.
 *
 * The detail page then printed "1 views" and "0 wants" — t() with a hardcoded
 * plural, next to a review count that had used tc() all along.
 *
 * Both are measured on the rendered page rather than asserted against the
 * stylesheet or the catalog, and the plural forms are read in both languages.
 */

const SELLER_ID = '99999999-9999-4999-8999-999999999999'
const SHORT_NICK = 'Xiaoyu Zhang' // 12 characters, the reported case
const LONG_NICK = 'Bartholomew Featherstonehaugh'

const RATED_TITLE = 'Rated seller desk lamp'
const LONG_NICK_TITLE = 'Long name floor lamp'
const VERIFIED_TITLE = 'Verified seller reading lamp'

function seller(over: Record<string, unknown> = {}) {
  return {
    id: SELLER_ID, nickname: SHORT_NICK, avatar_url: null, location: 'Green St',
    is_illini_verified: false, avg_rating: 4, rating_count: 7,
    status_text: null, status_emoji: null, ...over,
  }
}

function itemRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id, user_id: SELLER_ID, title: RATED_TITLE, title_i18n: null, description_i18n: null,
    source_lang: 'en', price: 12, category: 'other', condition: 'good', status: 'active',
    listing_type: 'sell', location: 'Green St', location_verified: false, images: [],
    image_dimensions: null, view_count: 1, favorite_count: 2, negotiable: false,
    created_at: '2026-08-30T00:00:00Z', description: 'A desk lamp.',
    updated_at: '2026-08-30T00:00:00Z', profile: seller(), ...over,
  }
}

const HOME_ROWS = [
  itemRow('11111111-1111-4111-8111-111111111111'),
  itemRow('22222222-2222-4222-8222-222222222222', {
    title: LONG_NICK_TITLE, profile: seller({ nickname: LONG_NICK }),
  }),
  // The worst case: the Illini pill cannot shrink, so on this card the rating
  // was squeezed down to a bare "4".
  itemRow('66666666-6666-4666-8666-666666666666', {
    title: VERIFIED_TITLE, profile: seller({ is_illini_verified: true }),
  }),
]

async function stub(page: Page, { lang = 'en', rows = HOME_ROWS }: { lang?: string; rows?: unknown[] } = {}) {
  await page.addInitScript(chosen => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', chosen)
    localStorage.setItem('theme_pref', 'light')
  }, lang)
  await page.route('**/*.supabase.co/**', async route => {
    const url = new URL(route.request().url())
    let body: unknown = []
    if (url.pathname.endsWith('/rest/v1/items')) body = rows
    // `.single()` asks PostgREST for an object, not an array; a detail page fed
    // an array renders as "listing not found" and every assertion below would
    // be measuring the wrong screen.
    if ((route.request().headers()['accept'] || '').includes('vnd.pgrst.object')) {
      body = Array.isArray(body) ? body[0] ?? {} : body
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-1/2' }, body: JSON.stringify(body),
    })
  })
}

type Box = {
  scroll: number
  client: number
  width: number
  visibleWidth: number
  rightEdgeIsPainted: boolean
  text: string
}

/*
 * Two ways a line of text gets cut, and both have to be measured.
 *
 * The element can clip its own text (scrollWidth > clientWidth), or an
 * ancestor with overflow:hidden can clip the element itself — in which case
 * the element's own numbers agree perfectly while half the glyph never
 * reaches the screen. So intersect the box with every clipping ancestor, and
 * hit-test the last pixel column: clipped-away content is not hittable.
 */
async function measure(page: Page, cardTitle: string, selector: string): Promise<Box> {
  const card = page.locator('.card', { hasText: cardTitle })
  const el = card.locator(selector).first()
  await expect(el).toBeVisible()
  // elementFromPoint reads viewport coordinates, so a card below the fold
  // would report an unhittable edge however it is laid out. Scroll the card,
  // never the element under test: overflow:hidden boxes are still
  // programmatically scrollable, and scrolling one hides the very clip this
  // is here to measure.
  await card.scrollIntoViewIfNeeded()
  return el.evaluate(node => {
    const rect = node.getBoundingClientRect()
    let left = rect.left
    let right = rect.right
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      if (style.overflow === 'visible' && style.overflowX === 'visible') continue
      const box = parent.getBoundingClientRect()
      left = Math.max(left, box.left)
      right = Math.min(right, box.right)
    }
    const probe = document.elementFromPoint(rect.right - 1, rect.top + rect.height / 2)
    return {
      scroll: node.scrollWidth,
      client: node.clientWidth,
      width: rect.width,
      visibleWidth: Math.max(0, right - left),
      rightEdgeIsPainted: !!probe && (probe === node || node.contains(probe)),
      text: (node.textContent || '').trim(),
    }
  })
}

function expectWholeTextIsVisible(box: Box, what: string) {
  expect(box.client, `${what} collapsed to nothing`).toBeGreaterThan(0)
  expect(
    box.scroll,
    `${what} clips its own text: ${box.scroll}px of text in a ${box.client}px box`,
  ).toBeLessThanOrEqual(box.client)
  expect(
    box.visibleWidth,
    `${what} is cut off by an ancestor: ${box.width.toFixed(1)}px wide, ${box.visibleWidth.toFixed(1)}px of it visible`,
  ).toBeGreaterThan(box.width - 0.5)
  expect(box.rightEdgeIsPainted, `${what} has an unhittable right edge`).toBe(true)
}

test('a 390px card shows the whole seller rating', async ({ page }) => {
  await stub(page)
  expect(page.viewportSize()?.width, 'this spec is about the narrow phone card').toBe(390)
  await page.goto('/#/pages/index/index', { waitUntil: 'domcontentloaded' })

  const rating = await measure(page, RATED_TITLE, '.seller-rating')
  expect(rating.text, 'the rating cell rendered something other than the fixture').toBe('4.0/5')
  expectWholeTextIsVisible(rating, 'the seller rating')

  // Control: the same measurement, on a name that genuinely cannot fit, must
  // report an overflow — otherwise the assertion above could never go red.
  const longNick = await measure(page, LONG_NICK_TITLE, '.seller-nick')
  expect(longNick.text).toBe(LONG_NICK)
  expect(longNick.scroll, 'the overflow measurement is blind').toBeGreaterThan(longNick.client)
  const clipping = await page.locator('.card', { hasText: LONG_NICK_TITLE })
    .locator('.seller-nick').first()
    .evaluate(node => {
      const style = getComputedStyle(node)
      return { overflow: style.overflow, textOverflow: style.textOverflow }
    })
  expect(clipping, 'an over-long nickname is hard-cut instead of ellipsised')
    .toEqual({ overflow: 'hidden', textOverflow: 'ellipsis' })

  // …and beside a name that has to be truncated, and beside the Illini pill.
  expectWholeTextIsVisible(
    await measure(page, LONG_NICK_TITLE, '.seller-rating'),
    'the rating next to an over-long nickname',
  )
  const verified = await measure(page, VERIFIED_TITLE, '.seller-rating')
  expect(verified.text).toBe('4.0/5')
  expectWholeTextIsVisible(verified, 'the rating on a verified seller\'s card')
})

test('a desktop column shows the whole rating too', async ({ page }) => {
  await stub(page)
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto('/#/pages/index/index', { waitUntil: 'domcontentloaded' })

  // The desktop grid packs three or four columns into the same width, so its
  // cards are barely wider than the phone's and the row was clipped there too.
  const rating = await measure(page, RATED_TITLE, '.seller-rating')
  expect(rating.text).toBe('4.0/5')
  expectWholeTextIsVisible(rating, 'the seller rating')
  expectWholeTextIsVisible(
    await measure(page, VERIFIED_TITLE, '.seller-rating'),
    'the rating on a verified seller\'s card',
  )
})

async function statLabels(page: Page, id: string) {
  await page.goto(`/#/pages/detail/index?id=${id}`, { waitUntil: 'domcontentloaded' })
  const stats = page.locator('.stats-row .stat')
  await expect(stats.first()).toBeVisible()
  const read = async (i: number) => ({
    num: (await stats.nth(i).locator('.stat-num').innerText()).trim(),
    label: (await stats.nth(i).locator('.stat-label').innerText()).trim(),
  })
  return { views: await read(0), wants: await read(1) }
}

test('the detail counts agree in number with the count they label', async ({ page }) => {
  const one = itemRow('33333333-3333-4333-8333-333333333333', { view_count: 1, favorite_count: 1 })
  await stub(page, { rows: [one] })
  expect(await statLabels(page, one.id)).toEqual({
    views: { num: '1', label: 'view' },
    wants: { num: '1', label: 'want' },
  })
})

test('the detail counts stay plural above one', async ({ page }) => {
  const many = itemRow('44444444-4444-4444-8444-444444444444', { view_count: 2, favorite_count: 12 })
  await stub(page, { rows: [many] })
  expect(await statLabels(page, many.id)).toEqual({
    views: { num: '2', label: 'views' },
    wants: { num: '12', label: 'wants' },
  })
})

test('Chinese labels are unchanged by the English plural forms', async ({ page }) => {
  const one = itemRow('55555555-5555-4555-8555-555555555555', { view_count: 1, favorite_count: 3 })
  await stub(page, { lang: 'zh', rows: [one] })
  // A `|` in the Chinese catalog would surface here as "浏览|浏览".
  expect(await statLabels(page, one.id)).toEqual({
    views: { num: '1', label: '浏览' },
    wants: { num: '3', label: '想要' },
  })
})
