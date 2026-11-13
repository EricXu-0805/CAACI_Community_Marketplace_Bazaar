import { test, expect, type Page } from '@playwright/test'
import { supabaseRefForBuild } from './supabase-ref'
import { visualAudit } from './visual-audit'
import { CURRENT_CONSENT_VERSION } from '../src/legal'

/*
 * HOME.5 (SPEC 6.1, 6.2, 7): a board page opens with its name, what belongs
 * there and a way to start a topic there, and the board page and "all
 * discussions" each say something definite while loading, when a read fails,
 * when there is nothing, and when a search finds nothing.
 */

const REF = supabaseRefForBuild()
const SHOTS = 'test-results/visual/HOME.5'
const MINUTE = 60_000, HOUR = 60 * MINUTE
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/\.supabase\.co(?:[:/]|$)/, socket => socket.close())
})

const AUTHOR = { id: uuid('10000000', 2), nickname: 'Kevin Z.', avatar_url: null, is_illini_verified: false, uid: null }
type Row = Record<string, unknown> & { id: string; category: string | null; title: string | null }
const topic = (n: number, category: string, title: string, fields: Record<string, unknown> = {}): Row => ({
  id: uuid('30000000', n), user_id: AUTHOR.id, title, category, content: '想听听大家的经验，先谢谢了。',
  images: [], image_dimensions: [], content_i18n: null, source_lang: 'zh', is_official: false, is_pinned: false,
  like_count: 0, comment_count: n % 4, status: 'active', created_at: ago(n * 7 * MINUTE + HOUR), updated_at: ago(HOUR),
  profile: AUTHOR, post_items: [], ...fields,
})
const SETTLING = [
  '刚到香槟还没有 SSN，哪家银行能先开户？', 'Green Street 附近一居室月租 1200 美元算贵吗？',
  '伊利诺伊驾照笔试能选中文吗？在 Champaign 哪里考？', '两室公寓冬天暖气费一个月大概多少', 'MTD 22 路晚上 10 点以后还有车吗',
].map((title, i) => topic(i + 1, 'settling-market', title))
const BUDDIES = ['这周六去芝加哥中国城，有人一起拼车吗？', '找周末一起去 ARC 打羽毛球的搭子'].map((title, i) => topic(20 + i, 'events-social', title))
const MANY = Array.from({ length: 45 }, (_, i) => topic(100 + i, 'campus-life', `第 ${i + 1} 个话题：期末周怎么安排复习`))

interface Feed {
  rows: Row[]
  /** Offsets at or past this one answer 500. */
  failFrom: number
  /** Resolves when the first page may be answered. */
  hold: Promise<void> | null
  requests: number[]
  searches: Record<string, unknown>[]
}
const feed = (rows: Row[]): Feed => ({ rows, failFrom: Infinity, hold: null, requests: [], searches: [] })

async function serve(page: Page, state: Feed, profile?: Record<string, unknown>) {
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ flagged: false, categories: [] }),
  }))
  await page.route('**/*.supabase.co/**', async route => {
    const request = route.request(), url = new URL(request.url())
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: JSON.stringify(body) })
    if (url.pathname.endsWith('/rest/v1/posts')) {
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 20)
      state.requests.push(offset)
      if (state.hold) await state.hold
      if (offset >= state.failFrom) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
      const category = url.searchParams.get('category')?.replace(/^eq\./, '')
      return json(state.rows.filter(row => !category || row.category === category).slice(offset, offset + limit))
    }
    if (url.pathname.endsWith('/rest/v1/rpc/search_community_posts')) {
      state.searches.push(request.postDataJSON())
      return json([])
    }
    return json(url.pathname.endsWith('/rest/v1/rpc/get_my_profile') && profile ? profile : [])
  })
}

const UID = '11111111-1111-4111-8111-111111111111'
const PROFILE = {
  id: UID, nickname: 'Test User', avatar_url: null, tos_version: CURRENT_CONSENT_VERSION,
  suspension_level: 0, suspended_until: null, is_illini_verified: true, bio: 'hi', location: 'UIUC',
}
async function signIn(page: Page) {
  await page.addInitScript(([ref, uid]) => {
    const generation = 'community-board-generation-0001'
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      tag: 'caaci-auth-value-v2', generation,
      value: JSON.stringify({
        access_token: 'stub', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
        user: { id: uid, email: 'a@illinois.edu', aud: 'authenticated', role: 'authenticated' },
      }),
    }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({ v: 2, mode: 'allowed', generation }))
  }, [REF, UID] as const)
}

async function open(page: Page, path: string, state: Feed, options: { theme?: 'light' | 'dark'; signedIn?: boolean } = {}) {
  await page.addInitScript(theme => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'zh')
    localStorage.setItem('theme_pref', theme)
  }, options.theme || 'light')
  await page.emulateMedia({ colorScheme: options.theme || 'light' })
  if (options.signedIn) await signIn(page)
  await serve(page, state, options.signedIn ? PROFILE : undefined)
  await page.goto(`/#/pages/plaza/index${path}`, { waitUntil: 'domcontentloaded' })
}

// uni's <scroll-view> scrolls on an inner element; reaching its end asks for the next page.
const scrollFeedToEnd = (page: Page) => page.locator('#plaza-feed-panel').evaluate(root => {
  const scroller = [root, ...root.querySelectorAll('*')].find(el =>
    /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 4)
  if (scroller) scroller.scrollTop = scroller.scrollHeight
})
const tabs = (page: Page) => page.locator('.feed-tabs [role="tab"]')
const composerBoard = (page: Page, name: string) => page.locator('.composer-fullpage').getByRole('button', { name, exact: true })

const PHONE = { width: 390, height: 844, scale: 2, mobile: true }
const DESKTOP = { width: 1280, height: 800, scale: 1, mobile: false }

for (const size of [PHONE, DESKTOP]) {
  test.describe(`board page and all discussions at ${size.width}px`, () => {
    // uni-h5 reads the window width from the screen, so both have to move.
    test.use({
      viewport: { width: size.width, height: size.height },
      screen: { width: size.width, height: size.height },
      deviceScaleFactor: size.scale, isMobile: size.mobile, hasTouch: size.mobile,
    })

    test('① a board page: its name, what belongs there, and 发话题 with the board chosen', async ({ page }) => {
      await open(page, '?board=settling-market', feed([...SETTLING, ...BUDDIES]), { signedIn: true })
      const head = page.locator('.board-head')
      await expect(head.getByRole('heading', { level: 1 })).toHaveText('落脚香槟')
      await expect(head.locator('.bh-name')).toHaveCSS('font-weight', '600')
      await expect(head.locator('.bh-scope')).toHaveText('租房、银行卡、驾照、公交。买卖东西请去「二手」。')
      await expect(head.locator('.bh-scope')).toHaveCSS('font-size', '13px')
      // Only this board's topics, and with three or more of them no filler.
      await expect(page.locator('.topic-row')).toHaveCount(5)
      await expect(page.locator('.board-fill')).toHaveCount(0)
      // Inside a board the rows do not repeat its name.
      await expect(page.locator('.topic-row').first().locator('.tr-meta-item').first()).toHaveText('Kevin Z.')

      await head.getByRole('button', { name: '发话题', exact: true }).click()
      await expect(composerBoard(page, '落脚香槟')).toHaveAttribute('aria-pressed', 'true')
      await expect(composerBoard(page, '校园日常')).toHaveAttribute('aria-pressed', 'false')
    })

    test('① fewer than three topics: the filler follows the list and starts a topic in this board', async ({ page }) => {
      await open(page, '?board=events-social', feed([...SETTLING, ...BUDDIES]), { signedIn: true })
      await expect(page.locator('.topic-row')).toHaveCount(2)
      const filler = page.locator('.board-fill')
      await expect(filler).toHaveText('适合在这里问：拼车、饭搭子、一起自习 发第一帖 ›')
      const [last, fill] = await Promise.all([page.locator('.topic-row').last().boundingBox(), filler.boundingBox()])
      expect(fill!.y).toBeGreaterThanOrEqual(last!.y + last!.height - 1)
      await filler.click()
      await expect(composerBoard(page, '找搭子')).toHaveAttribute('aria-pressed', 'true')
    })

    test('② all discussions has 新发布｜热门｜关注的人; a board page has no 关注的人', async ({ page }) => {
      await open(page, '?view=all', feed([...SETTLING, ...BUDDIES]))
      await expect(tabs(page)).toHaveText(['新发布', '热门', '关注的人'])
      await expect(tabs(page).first()).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('.topic-row')).toHaveCount(7)
      for (const label of await tabs(page).locator('.ft-label').all()) await expect(label).toHaveCSS('font-size', '14px')
      // Arrow keys still walk the tabs in the order shown.
      await tabs(page).first().focus()
      await page.keyboard.press('ArrowRight')
      await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('End')
      await expect(tabs(page).nth(2)).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('.board-filters')).toHaveCount(0)

      await page.goto('/#/pages/plaza/index?board=settling-market')
      await page.reload()
      await expect(tabs(page)).toHaveText(['新发布', '热门'])
      await expect(tabs(page).first()).toHaveAttribute('aria-selected', 'true')
    })

    test('③ loading: three skeleton rows and no words', async ({ page }) => {
      const state = feed(SETTLING)
      let release!: () => void
      state.hold = new Promise<void>(resolve => { release = resolve })
      await open(page, '?view=all', state)
      await expect(page.locator('.post-skel')).toHaveCount(3)
      expect((await page.locator('.post-skel-list').innerText()).trim()).toBe('')
      await expect(page.locator('#plaza-feed-panel .empty')).toHaveCount(0)
      release()
      await expect(page.locator('.topic-row')).toHaveCount(5)
      await expect(page.locator('.post-skel')).toHaveCount(0)
    })

    test('③ the first load fails: the message and 重试, which loads the list', async ({ page }) => {
      const state = feed(SETTLING)
      state.failFrom = 0
      await open(page, '?board=settling-market', state)
      const failure = page.locator('#plaza-feed-panel').getByRole('alert')
      await expect(failure.locator('.empty-text')).toHaveText('没加载出来，检查网络后再试')
      await expect(page.locator('.topic-row')).toHaveCount(0)
      // A failed read is not an empty board.
      await expect(page.getByText('这个板块还没有话题。')).toHaveCount(0)
      await expect(page.locator('.board-fill')).toHaveCount(0)
      state.failFrom = Infinity
      await failure.getByRole('button', { name: '重试', exact: true }).click()
      await expect(page.locator('.topic-row')).toHaveCount(5)
      await expect(page.locator('#plaza-feed-panel').getByRole('alert')).toHaveCount(0)
    })

    test('③ a later page fails: the rows stay and the line under them retries', async ({ page }) => {
      const state = feed(MANY)
      state.failFrom = 20
      await open(page, '?view=all', state)
      await expect(page.locator('.topic-row')).toHaveCount(20)
      await expect.poll(async () => {
        await scrollFeedToEnd(page)
        return state.requests.filter(offset => offset === 20).length
      }, { timeout: 15_000 }).toBeGreaterThan(0)
      const retry = page.locator('#plaza-feed-panel').getByRole('alert').getByRole('button', { name: '加载失败，点这里重试', exact: true })
      await expect(retry).toBeVisible()
      await expect(page.locator('.topic-row')).toHaveCount(20)
      await expect(page.getByText('没加载出来，检查网络后再试')).toHaveCount(0)
      const [lastRow, line] = await Promise.all([page.locator('.topic-row').last().boundingBox(), retry.boundingBox()])
      expect(line!.y).toBeGreaterThanOrEqual(lastRow!.y + lastRow!.height - 1)

      state.failFrom = Infinity
      await retry.click()
      await expect(page.locator('.topic-row')).toHaveCount(40)
      await expect(page.locator('#plaza-feed-panel').getByRole('alert')).toHaveCount(0)
    })

    test('③ nothing yet: the example question and 发话题; an empty board adds its filler', async ({ page }) => {
      await open(page, '?view=all', feed([]), { signedIn: true })
      const empty = page.locator('#plaza-feed-panel .empty')
      await expect(empty.locator('.empty-text')).toHaveText('还没有话题。可以问一个具体的问题，比如：Urbana 哪里能买到便宜的书桌？')
      await expect(empty).not.toHaveAttribute('role', 'alert')
      await empty.getByRole('button', { name: '发话题', exact: true }).click()
      await expect(page.locator('.composer-fullpage .topic-title-input')).toBeVisible()
      await page.locator('.comp-cancel').click()

      await page.goto('/#/pages/plaza/index?board=local-deals')
      await page.reload()
      const board = page.locator('#plaza-feed-panel .empty')
      await expect(board.locator('.empty-text')).toHaveText('这个板块还没有话题。')
      await expect(board.locator('.board-fill')).toHaveText('适合在这里问：火锅、超市、生日蛋糕 发第一帖 ›')
      await board.getByRole('button', { name: '发话题', exact: true }).click()
      await expect(composerBoard(page, '吃喝好店')).toHaveAttribute('aria-pressed', 'true')
    })

    test('③ a search that finds nothing offers to ask it, with the words already in the title', async ({ page }) => {
      const state = feed(SETTLING)
      await open(page, '?view=all', state, { signedIn: true })
      await expect(page.locator('.topic-row')).toHaveCount(5)
      const field = page.locator(size.mobile ? '.sb-input input' : '.cx-search input')
      await field.fill('二手冰箱')
      // The field reaches the model behind a throttle; the result line is drawn from the model.
      const empty = page.locator('#plaza-feed-panel .empty')
      await expect(empty.locator('.empty-text')).toHaveText('没找到和「二手冰箱」有关的话题')
      expect(state.searches.at(-1)).toMatchObject({ region_in: 'cu' })
      await empty.getByRole('button', { name: '发话题', exact: true }).click()
      await expect(page.locator('.topic-title-input input')).toHaveValue('二手冰箱')
    })

    for (const theme of ['light', 'dark'] as const) {
      test(`${theme}: a board page and all discussions pass the visual audit`, async ({ page }) => {
        await open(page, '?board=settling-market', feed([...SETTLING, ...BUDDIES]), { theme })
        await expect(page.locator('.topic-row')).toHaveCount(5)
        await page.evaluate(() => document.fonts.ready)
        const name = `board-${size.width}-${theme}-zh`
        await page.screenshot({ path: `${SHOTS}/${name}.png`, animations: 'disabled' })
        const board = await visualAudit(page, `HOME.5 ${name}`, { include: '.page', exclude: ['.tabbar'] })

        await page.goto('/#/pages/plaza/index?view=all')
        await page.reload()
        await expect(page.locator('.topic-row')).toHaveCount(7)
        await page.screenshot({ path: `${SHOTS}/all-${size.width}-${theme}-zh.png`, animations: 'disabled' })
        const all = await visualAudit(page, `HOME.5 all-${size.width}-${theme}-zh`, { include: '.page', exclude: ['.tabbar'] })

        for (const audit of [board, all]) {
          expect(audit.small, 'text under 12px').toEqual([])
          expect(audit.contrast, 'contrast').toEqual([])
          if (audit.axe) expect(audit.axe, 'axe color-contrast').toEqual([])
          expect(audit.overflow, 'horizontal overflow').toBe(0)
        }
      })
    }
  })
}
