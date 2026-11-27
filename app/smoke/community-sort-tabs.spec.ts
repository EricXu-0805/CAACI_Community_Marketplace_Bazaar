import { test, expect, type Page } from '@playwright/test'
import { text } from './community-topic-fixture'
import zh from '../src/composables/i18n/messages/zh'

/*
 * P3.4 (SPEC 5.2 ④, 6.1, 6.2): the community lists can be ordered by latest
 * activity, by newest, by unanswered and by hot. All discussions has those
 * four tabs and 关注的人, a board page has the four, and the home's latest list
 * has the first three. The lists page by a keyset, so a topic that is posted
 * or answered between two pages is neither repeated nor skipped.
 *
 * Every read is answered from the rows below the way PostgREST would answer
 * it, so what is on screen is decided by the request the page really sent.
 */
const HOUR = 3_600_000
const BOARDS = ['campus-life', 'settling-market', 'alumni-career', 'events-social', 'local-deals']
// One author per topic: a board card on the home shows at most two rows by the same person.
const author = (n: number) => ({
  id: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`, nickname: `Member ${n}`, avatar_url: null, is_illini_verified: false, uid: null,
})
type Row = Record<string, unknown> & { id: string; title: string; last_activity_at: string; created_at: string }
const name = (n: number) => `Topic ${String(n).padStart(2, '0')}`
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

// Thirty topics, one an hour, newest first: Topic 00 is an hour old, Topic 29 thirty.
function topics(): Row[] {
  const rows = Array.from({ length: 30 }, (_, n): Row => {
    const posted = ago((n + 1) * HOUR)
    return {
      id: `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`, user_id: author(n).id, title: name(n), category: BOARDS[n % 5],
      content: 'What do you think?', images: [], image_dimensions: [], content_i18n: null, source_lang: 'en', region: 'cu',
      is_official: false, is_pinned: false, is_featured: false, locked_at: null, like_count: 0, comment_count: 0, status: 'active',
      created_at: posted, updated_at: posted, last_activity_at: posted, answered_at: null, profile: author(n), post_items: [],
    }
  })
  // The oldest topic was answered a minute ago, and one in the middle half an hour ago.
  Object.assign(rows[29], { comment_count: 2, last_activity_at: ago(60_000), answered_at: ago(120_000) })
  Object.assign(rows[12], { comment_count: 3, last_activity_at: ago(30 * 60_000), answered_at: ago(40 * 60_000) })
  // Two topics have likes.
  rows[5].like_count = 9
  rows[3].like_count = 4
  return rows
}

interface Served { rows: Row[]; reads: URL[] }
interface Reply { post_id: string; user_id: string }

// Enough of PostgREST for these lists: eq, in, is.null, not.is.null and gte filters,
// the keyset condition, order, offset and limit.
function read(rows: Row[], url: URL): Row[] {
  const query = url.searchParams
  let out = rows.filter(row => [...query].every(([key, value]) => {
    if (['select', 'order', 'limit', 'offset', 'or'].includes(key) || key.includes('.')) return true
    if (value.startsWith('eq.')) return String(row[key]) === value.slice(3)
    if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(String(row[key]))
    if (value === 'is.null') return row[key] === null
    if (value === 'not.is.null') return row[key] !== null
    if (value.startsWith('gte.')) return String(row[key]) >= value.slice(4)
    return true
  }))
  const cursor = /(\w+)\.lt\.([^,]+),and\(\w+\.eq\.[^,]+,id\.lt\.([^)]+)\)/.exec(query.get('or') || '')
  if (cursor) {
    const [, column, at, id] = cursor
    const after = (row: Row) => String(row[column]) < at || (String(row[column]) === at && row.id < id)
    // After a pinned row come the pinned rows behind it and every unpinned one.
    out = out.filter(row => (query.get('or')!.startsWith('(and(is_pinned.eq.true') && !row.is_pinned) || after(row))
  }
  const order = (query.get('order') || '').split(',').filter(Boolean).map(part => part.split('.'))
  out = [...out].sort((a, b) => {
    for (const [column, direction] of order) {
      if (a[column] === b[column]) continue
      return ((a[column] as string) > (b[column] as string) ? 1 : -1) * (direction === 'desc' ? -1 : 1)
    }
    return 0
  })
  const offset = Number(query.get('offset') || 0)
  return out.slice(offset, offset + Number(query.get('limit') || out.length))
}

async function open(page: Page, path: string, rows: Row[], options: { lang?: 'en' | 'zh'; replies?: Reply[] } = {}): Promise<Served> {
  const served: Served = { rows, reads: [] }
  await page.addInitScript(lang => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', lang)
    localStorage.setItem('theme_pref', 'light')
  }, options.lang || 'en')
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ flagged: false, categories: [] }),
  }))
  await page.route('**/*.supabase.co/**', route => {
    const request = route.request(), url = new URL(request.url())
    // The home asks who replied to this week's busy topics; that decides whether there is a hot list.
    if (url.pathname.endsWith('/rest/v1/post_comments') && options.replies) {
      return route.fulfill({ contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: JSON.stringify(options.replies) })
    }
    if (!url.pathname.endsWith('/rest/v1/posts')) {
      return route.fulfill({ contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: '[]' })
    }
    const found = read(served.rows, url)
    if (request.method() === 'HEAD') {
      return route.fulfill({ status: 200, headers: { 'content-range': `*/${found.length}`, 'access-control-expose-headers': 'content-range' }, body: '' })
    }
    served.reads.push(url)
    return route.fulfill({ contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: JSON.stringify(found) })
  })
  await page.goto(`/#/pages/plaza/index${path}`, { waitUntil: 'networkidle' })
  return served
}

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/\.supabase\.co(?:[:/]|$)/, socket => socket.close())
})

const tabs = (page: Page) => page.locator('.feed-tabs [role="tab"]')
const listed = (page: Page) => page.locator('.topic-row .tr-title').allTextContents()
const names = (...numbers: number[]) => numbers.map(name)
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
// uni's <scroll-view> scrolls on an inner element; reaching its end asks for the next page.
const scrollFeedToEnd = (page: Page) => page.locator('#plaza-feed-panel').evaluate(root => {
  const scroller = [root, ...root.querySelectorAll('*')].find(el =>
    /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 4)
  if (scroller) scroller.scrollTop = scroller.scrollHeight
})

const PHONE = { width: 390, height: 844, scale: 2, mobile: true }
const DESKTOP = { width: 1280, height: 800, scale: 1, mobile: false }

for (const size of [PHONE, DESKTOP]) {
  test.describe(`sort tabs at ${size.width}px`, () => {
    // uni-h5 reads the window width from the screen, so both have to move.
    test.use({
      viewport: { width: size.width, height: size.height },
      screen: { width: size.width, height: size.height },
      deviceScaleFactor: size.scale, isMobile: size.mobile, hasTouch: size.mobile,
    })

    test('all discussions has five tabs, opens on latest activity, and each tab lists its own order', async ({ page }) => {
      await open(page, '?view=all', topics())
      await expect(tabs(page)).toHaveText([
        text('plaza.tab.active'), text('plaza.tab.recent'), text('plaza.tab.unanswered'), text('plaza.tab.hot'), text('plaza.tab.following'),
      ])
      await expect(tabs(page).first()).toHaveAttribute('aria-selected', 'true')
      // Latest activity: the oldest topic was answered a minute ago, so it leads.
      await expect.poll(async () => (await listed(page)).slice(0, 4)).toEqual(names(29, 12, 0, 1))
      await expect(page.locator('.topic-row')).toHaveCount(20)

      await tabs(page).nth(1).click()
      await expect.poll(async () => (await listed(page)).slice(0, 4)).toEqual(names(0, 1, 2, 3))

      // Unanswered: only topics nobody but the author has replied to, each one tagged.
      await tabs(page).nth(2).click()
      await expect.poll(() => listed(page)).toEqual(names(...range(0, 11), ...range(13, 20)))
      await expect(page.locator('.topic-row .tr-tag-ask')).toHaveCount(20)

      // Hot: likes first, then replies, then newest.
      await tabs(page).nth(3).click()
      await expect.poll(async () => (await listed(page)).slice(0, 6)).toEqual(names(5, 3, 12, 29, 0, 1))
    })

    test('the home latest list has three tabs; "see more" opens all discussions in the same order', async ({ page }) => {
      await open(page, '', topics())
      const latest = page.locator('.ch [data-block="latest"]')
      const latestTabs = latest.locator('[role="tab"]')
      const rows = () => latest.locator('.ch-lr-t').allTextContents()
      // The board cards take the newest topics of each board; what is left is listed here.
      const left = size.mobile ? range(15, 29) : range(20, 29)
      await expect(latestTabs).toHaveText([text('plaza.tab.active'), text('plaza.tab.recent'), text('plaza.tab.unanswered')])
      await expect(latestTabs.first()).toHaveAttribute('aria-selected', 'true')
      await expect.poll(rows).toEqual(names(29, ...left.filter(n => n !== 29)).slice(0, 10))

      await latestTabs.nth(1).click()
      await expect(latestTabs.nth(1)).toHaveAttribute('aria-selected', 'true')
      await expect.poll(rows).toEqual(names(...left).slice(0, 10))

      await latestTabs.nth(2).click()
      await expect.poll(rows).toEqual(names(...left.filter(n => n !== 29)).slice(0, 10))

      await latest.locator('.ch-more').click()
      await expect(page).toHaveURL(/pages\/plaza\/index\?view=all$/)
      await expect(tabs(page).nth(2)).toHaveAttribute('aria-selected', 'true')
      await expect.poll(async () => (await listed(page)).slice(0, 3)).toEqual(names(0, 1, 2))
    })
  })
}

// D-54 2h: on a phone the latest list has four tabs once there is a hot list. Each one has to be on
// screen and take a tap, in both languages; a tab that only fits the document is not enough, because
// the page clips what overflows sideways.
for (const width of [360, 390]) {
  test.describe(`home latest tabs at ${width}px`, () => {
    test.use({
      viewport: { width, height: 844 }, screen: { width, height: 844 },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    })
    for (const lang of ['zh', 'en'] as const) {
      test(`every tab is whole, on screen and tappable in ${lang}`, async ({ page }) => {
        // Every topic is busy enough for the hot list: three replies from two other members.
        const rows = topics().map(row => ({ ...row, comment_count: 3, answered_at: row.created_at }))
        const replies = rows.flatMap(row => [author(101), author(102), author(101)].map(member => ({ post_id: row.id, user_id: member.id })))
        await open(page, '', rows, { lang, replies })
        const label = (key: string) => (lang === 'zh' ? (zh as Record<string, string>)[key] : text(key))
        const latest = page.locator('.ch [data-block="latest"]')
        const latestTabs = latest.locator('[role="tab"]')
        await expect(latestTabs).toHaveText([
          label('plaza.tab.active'), label('plaza.tab.recent'), label('plaza.tab.unanswered'), label('home.hotWeek'),
        ])
        // Bring the block up without moving anything sideways: its title starts at the left edge.
        await latest.locator('.ch-sec-t').scrollIntoViewIfNeeded()
        const sideways = await latestTabs.first().evaluate(node => {
          let moved = 0
          for (let box: Element | null = node; box; box = box.parentElement) moved += Math.abs(box.scrollLeft)
          return moved
        })
        expect(sideways).toBe(0)
        // Every box is measured where it is, before anything is clicked, and every miss is listed.
        const measured = await latestTabs.evaluateAll((nodes, limits) => {
          const title = nodes[0].closest('[data-block="latest"]')!.querySelector('.ch-sec-t')!
          const lines = title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight)
          const problems = lines >= 1.5 ? [`the title takes ${Math.round(lines)} lines`] : []
          for (const node of nodes) {
            const name = (node.textContent || '').trim()
            const rect = node.getBoundingClientRect()
            // What a finger lands on at the middle of the tab is the tab itself.
            const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
            if (rect.left < 0) problems.push(`${name}: starts at ${Math.round(rect.left)}`)
            if (rect.right > limits.width) problems.push(`${name}: ends at ${Math.round(rect.right)} of ${limits.width}`)
            if (rect.top < 0 || rect.bottom > limits.height) problems.push(`${name}: off screen vertically`)
            if (rect.height < 44) problems.push(`${name}: ${Math.round(rect.height)}px tall`)
            if (!top || !(top === node || node.contains(top))) problems.push(`${name}: covered or clipped`)
            if (node.scrollWidth > node.clientWidth + 1) problems.push(`${name}: label cut`)
          }
          return problems
        }, { width, height: 844 })
        expect(measured).toEqual([])

        for (let index = 0; index < 4; index += 1) {
          const tab = latestTabs.nth(index)
          await tab.click()
          await expect(tab).toHaveAttribute('aria-selected', 'true')
          await expect(latest.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1)
        }
        // The last tab is the week's busiest topics, and it lists some.
        await expect.poll(() => latest.locator('.ch-lr').count()).toBeGreaterThan(0)
        await page.screenshot({ path: test.info().outputPath(`home-latest-tabs-${width}-${lang}.png`) })
      })
    }
  })
}

test('the next page starts after the last row: a topic posted or answered in between is neither repeated nor skipped', async ({ page }) => {
  const served = await open(page, '?view=all', topics())
  const firstPage = names(29, 12, ...range(0, 11), ...range(13, 18))
  await expect.poll(() => listed(page)).toEqual(firstPage)

  // Between the two pages a new topic is posted, and one the reader has not reached yet is answered.
  const now = new Date().toISOString()
  served.rows.unshift({ ...served.rows[0], id: '30000000-0000-4000-8000-000000000099', title: 'Brand new', created_at: now, last_activity_at: now })
  Object.assign(served.rows.find(row => row.title === name(27))!, { comment_count: 1, last_activity_at: now, answered_at: now })

  const cursor = topics()[18]
  await expect.poll(async () => {
    await scrollFeedToEnd(page)
    return page.locator('.topic-row').count()
  }, { timeout: 15_000 }).toBeGreaterThan(20)
  // Everything behind Topic 18 follows once. The two that moved to the top since are not
  // shown again here, and nothing already on screen is repeated.
  await expect.poll(() => listed(page)).toEqual([...firstPage, ...names(...range(19, 26), 28)])

  const next = served.reads.at(-1)!.searchParams
  expect(next.get('offset')).toBeNull()
  expect(next.get('is_pinned')).toBe('eq.false')
  expect(next.get('order')).toBe('is_pinned.desc,last_activity_at.desc,id.desc')
  expect(next.get('or')).toMatch(/^\(last_activity_at\.lt\.[^,]+,and\(last_activity_at\.eq\.[^,]+,id\.lt\.30000000-0000-4000-8000-000000000018\)\)$/)
  expect(Date.parse(/\.lt\.([^,]+),/.exec(next.get('or')!)![1])).toBe(Date.parse(String(served.rows.find(row => row.id === cursor.id)!.last_activity_at)))
})

test('a board page has the four order tabs and no 关注的人', async ({ page }) => {
  await open(page, '?board=campus-life', topics())
  await expect(tabs(page)).toHaveText([
    text('plaza.tab.active'), text('plaza.tab.recent'), text('plaza.tab.unanswered'), text('plaza.tab.hot'),
  ])
  await expect(tabs(page).first()).toHaveAttribute('aria-selected', 'true')
  // Only this board's topics, the most recently active first.
  await expect.poll(() => listed(page)).toEqual(names(0, 5, 10, 15, 20, 25))
})

test('unanswered with every topic answered says so', async ({ page }) => {
  const answered = topics().map(row => ({ ...row, comment_count: 1, answered_at: row.created_at }))
  await open(page, '?view=all', answered)
  await expect(page.locator('.topic-row')).toHaveCount(20)
  await tabs(page).nth(2).click()
  await expect(page.locator('#plaza-feed-panel .empty .empty-text')).toHaveText(text('plaza.emptyUnanswered'))
  await expect(page.locator('.topic-row')).toHaveCount(0)
})
