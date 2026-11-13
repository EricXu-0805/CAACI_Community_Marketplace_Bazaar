import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { supabaseRefForBuild } from './supabase-ref'
import { visualAudit } from './visual-audit'
import { CURRENT_CONSENT_VERSION } from '../src/legal'
import posts20 from './fixtures/community-home/20-posts.mjs'
import posts60 from './fixtures/community-home/60-posts.mjs'
import emptyBoard from './fixtures/community-home/empty-board.mjs'
import { now as NOW, items as ITEMS, makePost } from './fixtures/community-home/helpers.mjs'

/*
 * HOME.3 (SPEC 5.2, 5.3): the community tab opens on the forum home and the
 * flat list has moved to "all discussions". The page is driven through mocked
 * PostgREST with the HOME.2 fixtures, so what each block holds is still decided
 * by buildHomeSections; this checks what reaches the screen at 390 and 1280.
 *
 * The clock is fixed at the fixtures' own "now", which keeps "3 小时前" true.
 */

const REF = supabaseRefForBuild()
const SHOTS = 'test-results/visual/HOME.3'
// HOME.4: direction A (D-35) on the same home, and its screenshot matrix.
const SHOTS_A = 'test-results/visual/HOME.4'
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const BOARDS = ['campus-life', 'settling-market', 'alumni-career', 'events-social', 'local-deals']
const BOARD_ZH = ['校园日常', '落脚香槟', '学长学姐说', '找搭子', '吃喝好店']

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/\.supabase\.co(?:[:/]|$)/, socket => socket.close())
})

type Row = Record<string, unknown> & {
  id: string; user_id: string; title: string | null; category: string | null; status: string; created_at: string; comment_count: number
}
// A fixture post as PostgREST returns it: the author is embedded.
const asRow = (post: Record<string, unknown>, nickname?: string): Row => ({
  content: '', images: [], image_dimensions: [], like_count: 0, post_items: [], updated_at: post.created_at,
  profile: { id: post.user_id, nickname: nickname ?? `Author ${String(post.id).slice(-3)}`, avatar_url: null },
  ...post,
} as Row)

const SELLER = '10000000-0000-4000-8000-000000000009'
const itemPhoto = (name: string) => `https://${REF}.supabase.co/storage/v1/object/public/item-images/items/${SELLER}/${name}.png`
const asItem = (item: Record<string, unknown>, fields: Record<string, unknown> = {}) =>
  ({ user_id: SELLER, title_i18n: null, listing_type: 'sell', listing_details: null, ...item, ...fields })
const PLAIN_ITEMS = ITEMS.map(item => asItem(item))

/*
 * A realistic Chinese home for the screenshots and the audit, carrying the SPEC
 * 9.6 cases a home can show: a 60-character title, titles with English course
 * names, topics with no reply, and dates from this week, this year and last.
 */
const LONG_TITLE = '这学期同时选了三门带实验的课，每周还有两次小组讨论，想问问大家都是怎么安排复习和睡眠的，才不至于在期中那一周直接垮掉呢？'
const NAMES = ['Kevin Z.', '香槟搬砖人', 'yuki_uiuc', 'ECE 大二', 'Mia L.', '陈同学', '阿柚', '王一凡']
type Topic = [board: number, title: string, replies: number, age: number, flags?: Record<string, unknown>]
const TOPICS: Topic[] = [
  [0, '2027 春季选课：注册时间线和常见坑', 12, 11 * DAY, { is_pinned: true, is_official: true }],
  [0, '期末周 Grainger 几点去还能找到座位？', 0, 40 * MINUTE],
  [0, LONG_TITLE, 18, 2 * HOUR],
  [0, 'CS 225 和 MATH 241 放同一学期会不会太累？', 6, DAY + 2 * HOUR],
  [0, 'ECE 110 的 lab 报告一般要写多久？', 3, 4 * HOUR],
  [0, '期末两门考试撞了时间，conflict exam 怎么申请', 4, DAY + 5 * HOUR],
  [1, '租房合同签之前看一眼：押金、转租、退租检查', 9, 375 * DAY, { is_pinned: true }],
  [1, '伊利诺伊驾照笔试能选中文吗？在 Champaign 哪里考？', 0, HOUR],
  [1, '刚到香槟还没有 SSN，哪家银行能先开户？', 14, 3 * HOUR],
  [1, 'Green Street 附近一居室月租 1200 美元算贵吗？', 3, 2 * DAY],
  [1, '两室公寓冬天暖气费一个月大概多少', 11, 2 * HOUR + 20 * MINUTE],
  [1, '银行卡开 Chase 还是 Busey？Busey 离学校近一些', 8, 8 * HOUR],
  [2, '大二才开始找实习，现在投暑期还来得及吗？', 27, 5 * HOUR],
  [2, 'MCS 和 MS 找工作时差别大吗？', 0, 3 * HOUR + 30 * MINUTE],
  [2, 'Career Fair 前简历找谁帮忙看比较好？', 11, 6 * HOUR],
  [2, 'Career Fair 投的简历两周没消息，正常吗', 8, 4 * DAY],
  [2, '想转 CS，转专业申请的 essay 应该写什么', 6, HOUR + 10 * MINUTE],
  [2, '第一份实习 offer 要不要谈薪资', 10, DAY + 8 * HOUR],
  [3, '这周六去芝加哥中国城，有人一起拼车吗？', 21, HOUR + 30 * MINUTE],
  [3, '找周末一起去 ARC 打羽毛球的搭子', 0, 30 * MINUTE],
  [3, '期末周想找人一起在图书馆自习，互相监督', 5, 2 * HOUR + 40 * MINUTE],
  [3, 'State Farm Center 看篮球，学生票有人一起吗', 4, 3 * DAY],
  [3, '每周三晚上 Main Library 自习，有一起的吗', 2, 3 * HOUR + 10 * MINUTE],
  [3, '12 月去芝加哥看圣诞灯展，求拼车，2 个人', 3, 6 * HOUR + 30 * MINUTE],
  [4, '本板守则：只写自己去过的店，照片自己拍', 2, 24 * DAY, { is_pinned: true }],
  [4, 'Campustown 现在哪家火锅还开着？', 0, 2 * HOUR + 10 * MINUTE],
  [4, '想买新鲜的鱼，香槟哪个超市靠谱？', 9, 4 * HOUR + 20 * MINUTE],
  [4, '附近有能订中式生日蛋糕的店吗？', 12, 2 * DAY + 3 * HOUR],
  [4, 'Neil Street 那家韩式炸鸡有人吃过吗', 4, HOUR + 20 * MINUTE],
  [4, '想订一个生日蛋糕，香槟哪家可以，要提前几天', 6, 10 * HOUR],
  // Older this week: past the latest list, so the busiest of them reach "hot this week".
  [1, '香槟冬天的羽绒服买多长合适', 31, 3 * DAY + HOUR],
  [1, '押金被扣 $600，值得上小额法庭吗', 26, 4 * DAY],
  [1, '二手车在 Carvana 买还是找本地车行', 19, 4 * DAY + 2 * HOUR],
  [3, '第一次感恩节留校，大家怎么过', 17, 5 * DAY],
  [2, '资格考没过，第二次之前怎么调整', 14, 5 * DAY + HOUR],
  [1, 'MTD 22 路晚上 10 点以后还有车吗', 3, 5 * DAY + 3 * HOUR],
  [2, '读完 MEng 回国找工作，学历认证要准备什么材料', 5, 5 * DAY + 6 * HOUR],
  [3, '春季想组队参加黑客松，还缺一个做前端的', 4, 6 * DAY],
  [4, '周末带爸妈吃饭，Champaign 哪家中餐适合', 12, 6 * DAY + HOUR],
  [0, 'CS 128 和 ECE 220 同一学期修会不会太累', 6, 6 * DAY + 3 * HOUR],
  // Official and featured: the "start here" list. The page does not ask for
  // is_featured yet (the column arrives with P3.1), so only this mock supplies it.
  [1, '新生落脚清单：第一周要办的 8 件事', 23, 5 * DAY + 12 * HOUR, { is_official: true, is_featured: true }],
  [0, '社区守则（2026 年 11 月版）', 4, 30 * DAY, { is_official: true, is_featured: true }],
]
const SHOWCASE: Row[] = TOPICS.map(([board, title, replies, age, flags], i) => asRow(makePost(`topic-${String(i).padStart(2, '0')}`, {
  title, category: BOARDS[board], comment_count: replies, created_at: ago(age),
  user_id: flags?.is_official ? 'official-account' : `author-${i % NAMES.length}`, ...flags,
}), flags?.is_official ? '玉米地站务' : NAMES[i % NAMES.length]))
const SHOWCASE_ITEMS = [
  ['宜家 MICKE 书桌，白色 105×50 cm', 35, 'welcome'], ['Trek FX 2 自行车，M 码，送 U 型锁', 180, 'publish'],
  ['象印 3 杯电饭煲，用了一年', 25, 'safety'], ['戴尔 24 英寸显示器，带支架', 60, 'publish'],
  ['台灯，可调亮度', 0, 'safety'], ['CS 225 教材，几乎全新', 12.5, 'welcome'],
].map(([title, price, art], i) => asItem(ITEMS[i], { title, price, images: [itemPhoto(String(art))] }))

interface Served { posts: Row[]; items: Record<string, unknown>[] }
interface Seen { posts: URL[]; rpc: string[] }

// Enough of PostgREST for this page: eq, not.is.null and gte filters, order, limit, offset, and HEAD counts.
function select(rows: Row[], url: URL) {
  const param = (key: string) => url.searchParams.get(key) || ''
  const order = param('order').split(',').filter(Boolean).map(part => part.split('.'))
  return rows
    .filter(row => row.status === 'active')
    .filter(row => !param('category') || param('category') === `eq.${row.category}`)
    .filter(row => !param('id') || param('id') === `eq.${row.id}`)
    .filter(row => param('title') !== 'not.is.null' || row.title !== null)
    .filter(row => !param('created_at').startsWith('gte.') || row.created_at >= param('created_at').slice(4))
    .sort((a, b) => {
      for (const [field, direction] of order) {
        if (a[field] === b[field]) continue
        return ((a[field] as string) > (b[field] as string) ? 1 : -1) * (direction === 'desc' ? -1 : 1)
      }
      return 0
    })
}

async function serve(page: Page, data: Served, profile?: Record<string, unknown>): Promise<Seen> {
  const seen: Seen = { posts: [], rpc: [] }
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ flagged: false, categories: [] }),
  }))
  await page.route('**/*.supabase.co/**', route => {
    const request = route.request(), url = new URL(request.url())
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: JSON.stringify(body) })
    const limited = <T>(rows: T[]) => {
      const offset = Number(url.searchParams.get('offset') || 0)
      return rows.slice(offset, offset + Number(url.searchParams.get('limit') || rows.length))
    }
    if (url.pathname.includes('/storage/v1/')) {
      const art = /(welcome|publish|safety)\.png/.exec(url.pathname)?.[1] || 'welcome'
      return route.fulfill({ contentType: 'image/png', body: readFileSync(resolve(`src/static/banner-${art}.png`)) })
    }
    if (url.pathname.endsWith('/rest/v1/posts')) {
      seen.posts.push(url)
      const rows = select(data.posts, url)
      if (request.method() === 'HEAD') {
        // Across origins a page reads Content-Range only when the server exposes it, as Supabase does.
        return route.fulfill({ status: 200, headers: { 'content-range': `*/${rows.length}`, 'access-control-expose-headers': 'content-range' }, body: '' })
      }
      const single = request.headers().accept?.includes('vnd.pgrst.object')
      return json(single ? rows[0] ?? null : limited(rows))
    }
    if (url.pathname.endsWith('/rest/v1/items')) {
      return json(limited([...data.items].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))))
    }
    if (url.pathname.endsWith('/rest/v1/post_comments')) {
      // Three replies from two people under every topic asked about.
      const ids = (/^in\.\((.*)\)$/.exec(url.searchParams.get('post_id') || '')?.[1] || '').split(',').filter(Boolean)
      return json(ids.flatMap(id => ['replier-a', 'replier-a', 'replier-b'].map(user_id => ({ post_id: id.replace(/"/g, ''), user_id }))))
    }
    if (url.pathname.includes('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop()!
      seen.rpc.push(name)
      return json(name === 'get_my_profile' && profile ? profile : [])
    }
    return json([])
  })
  return seen
}

// Wait for webfonts and the one-shot entrance animations, so boxes are final.
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(document.getAnimations()
      .filter(animation => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)))
      .map(animation => animation.finished.catch(() => undefined)))
  })
}

async function openHome(page: Page, data: Served, options: { lang?: 'zh' | 'en'; theme?: 'light' | 'dark'; path?: string } = {}) {
  const { lang = 'zh', theme = 'light', path = '/#/pages/plaza/index' } = options
  await page.addInitScript(([language, colour]) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', language)
    localStorage.setItem('theme_pref', colour)
  }, [lang, theme] as const)
  await page.emulateMedia({ colorScheme: theme })
  await page.clock.setFixedTime(new Date(NOW))
  const seen = await serve(page, data)
  await page.goto(path, { waitUntil: 'networkidle' })
  await expect(page.locator('.ch [data-block="board"]').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.ch .ch-row-sk')).toHaveCount(0)
  await settle(page)
  return seen
}

const board = (page: Page, slug: string) => page.locator(`.ch [data-board="${slug}"]`)
const postIds = (page: Page) => page.locator('[data-post-id]').evaluateAll(rows => rows.map(row => row.getAttribute('data-post-id')))
// A count drawn as "0" is the thing SPEC 5.4 rule 8 forbids, wherever it sits.
const zeroCounts = (page: Page) => page.locator('.ch, .cx-hdr, .cx-m').evaluateAll(roots => roots.flatMap(root => {
  const found: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (/^0(\D|$)/.test((node.textContent || '').trim())) found.push(node.parentElement?.className || 'text')
  }
  return found
}))
const top = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!.y

const PHONE = { width: 390, height: 844, scale: 2, mobile: true }
const TABLET = { width: 768, height: 1024, scale: 1, mobile: false }
const DESKTOP = { width: 1280, height: 800, scale: 1, mobile: false }
// The community surface is everything on the page but the app's shared chrome:
// the tab bar and, from 768px to 1023px, the left rail. Both predate this page.
const SURFACE = { include: '.page', exclude: ['.tabbar', '.app-sidebar'] }

// What a token paints, as this page resolves it in the theme it is showing.
const tokenColours = (page: Page, tokens: string[]) => page.evaluate(names => {
  const probe = document.body.appendChild(document.createElement('i'))
  const colours = names.map(name => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color })
  probe.remove()
  return colours
}, tokens)

// The home scrolls inside its own scroll-view, on an inner element of uni's. A
// picture of all of it needs a window as tall as what that element holds.
async function shootWhole(page: Page, path: string, size: { width: number; height: number }) {
  const hidden = await page.locator('.home-scroll').evaluate(root => {
    const scroller = [root, ...root.querySelectorAll('*')].find(el =>
      /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 4)
    return scroller ? scroller.scrollHeight - scroller.clientHeight : 0
  })
  await page.setViewportSize({ width: size.width, height: size.height + hidden })
  await page.waitForLoadState('networkidle')
  await settle(page)
  await page.screenshot({ path, animations: 'disabled' })
}

/*
 * HOME.4 (SPEC 9.5, 9.6): the home in direction A. One fixture, drawn in light
 * and dark, Chinese and English, at 390, 768 and 1280: twelve first screens,
 * each audited, each with a picture of the whole page beside it.
 */
for (const size of [PHONE, TABLET, DESKTOP]) {
  test.describe(`the home in direction A at ${size.width}px`, () => {
    // uni-h5 reads the window width from the screen, so both have to move.
    test.use({
      viewport: { width: size.width, height: size.height },
      screen: { width: size.width, height: size.height },
      deviceScaleFactor: size.scale, isMobile: size.mobile, hasTouch: size.mobile,
    })

    for (const theme of ['light', 'dark'] as const) for (const lang of ['zh', 'en'] as const) {
      test(`①② ${theme} ${lang}: board colours, ink prices, the screenshot and the SPEC 9.6 audit`, async ({ page }) => {
        await openHome(page, { posts: SHOWCASE, items: SHOWCASE_ITEMS }, { lang, theme })
        const name = `home-${size.width}-${theme}-${lang}`
        await page.screenshot({ path: `${SHOTS_A}/${name}.png`, animations: 'disabled' })

        // SPEC 5.4 rule 6: a board's colour is on its 3px bar and its name; six boards, six colours.
        const slugs = [...BOARDS, 'market']
        const colours = await tokenColours(page, slugs.map(slug => `--board-${slug}`))
        expect(new Set(colours).size).toBe(6)
        const painted = await page.locator('.ch-grid > .ch-card').evaluateAll(cards => cards.map(card => [
          getComputedStyle(card.querySelector('.ch-bar')!).backgroundColor,
          getComputedStyle(card.querySelector('.ch-bname')!).color,
        ]))
        expect(painted).toEqual(colours.map(colour => [colour, colour]))
        // SPEC 5.2 ④: in the latest list a row's board is named in that board's colour.
        const labels = await page.locator('.ch-lr .ch-lb').evaluateAll(els => els.map(el =>
          [[...el.classList].find(cls => cls.startsWith('ch-b-'))!.slice(5), getComputedStyle(el).color]))
        expect(labels.length).toBe(size === DESKTOP ? 15 : 10)
        for (const [slug, colour] of labels) expect(colour, `the ${slug} label`).toBe(colours[slugs.indexOf(slug)])

        // SPEC 9.5: a price is ink, weight 600, in tabular numerals; the brand colour is not a price colour.
        const [ink, brand] = await tokenColours(page, ['--ink', '--brand'])
        const price = page.locator('.ch-price').first()
        await expect(price).toHaveCSS('color', ink)
        await expect(price).toHaveCSS('font-weight', '600')
        await expect(price).toHaveCSS('font-variant-numeric', 'tabular-nums')
        expect(ink).not.toBe(brand)

        const surface = await visualAudit(page, `HOME.4 ${name}`, SURFACE)
        const whole = await visualAudit(page, `HOME.4 ${name} whole page`, { include: 'body' })
        expect(surface.small, 'text under 12px on the community home').toEqual([])
        expect(surface.contrast, 'contrast on the community home').toEqual([])
        if (surface.axe) expect(surface.axe, 'axe color-contrast on the community home').toEqual([])
        expect(surface.overflow, 'horizontal overflow').toBe(0)
        // From 1024px the page has no shared chrome left, so the whole page is held to the same.
        if (size === DESKTOP) expect(whole.small, 'text under 12px on the whole desktop page').toEqual([])

        await shootWhole(page, `${SHOTS_A}/${name}-full.png`, size)
      })
    }
  })
}

for (const size of [PHONE, DESKTOP]) {
  test.describe(`community home at ${size.width}px`, () => {
    // uni-h5 reads the window width from the screen, so both have to move.
    test.use({
      viewport: { width: size.width, height: size.height },
      screen: { width: size.width, height: size.height },
      deviceScaleFactor: size.scale, isMobile: size.mobile, hasTouch: size.mobile,
    })

    // The screenshots and the SPEC 9.6 audit of this home are the HOME.4 matrix above.
    test('⑤ every post is drawn once, no count reads 0, and every posts query names the region', async ({ page }) => {
      for (const posts of [posts60, posts20]) {
        const seen = await openHome(page, { posts: posts.map(post => asRow(post)), items: PLAIN_ITEMS })
        const ids = await postIds(page)
        expect(ids.length).toBeGreaterThan(15)
        expect(new Set(ids).size, 'a data-post-id appears twice').toBe(ids.length)
        expect(await zeroCounts(page)).toEqual([])
        // The fixtures have no replies at all: a tag stands where a count would.
        await expect(page.locator('.ch .ch-cnt, .ch .ch-pill')).toHaveCount(0)
        await expect(page.locator('.ch .ch-tag-ask').first()).toHaveText('待回答')

        expect(seen.posts.length).toBeGreaterThanOrEqual(8)
        expect(seen.posts.filter(url => url.searchParams.get('region') !== 'eq.cu').map(String)).toEqual([])
        expect(seen.posts.filter(url => url.searchParams.get('status') !== 'eq.active').map(String)).toEqual([])
      }
    })

    if (size === PHONE) {
      test('① 390: chips, start-here bar, five boards of three, the market strip, then at most ten latest', async ({ page }) => {
        await openHome(page, { posts: SHOWCASE, items: SHOWCASE_ITEMS })

        const chips = page.locator('.cx-chips .cx-chip')
        await expect(chips).toHaveText(['全部', ...BOARD_ZH])
        await expect(chips.first()).toHaveAttribute('aria-current', 'page')
        await expect(page.locator('.cx-chips')).toHaveCSS('height', '44px')
        await expect(page.locator('.cx-top')).toHaveCSS('height', '48px')

        const fold = page.locator('.ch [data-block="start-here"] .ch-fold')
        await expect(fold).toHaveText('新来先看 · 2 篇 ›')
        await expect(page.getByText('近期活动')).toHaveCount(0)

        const sections = page.locator('.ch [data-block="board"]')
        await expect(sections.locator('.ch-bname')).toHaveText(BOARD_ZH)
        for (const slug of BOARDS) {
          await expect(board(page, slug).locator('[data-post-id]')).toHaveCount(3)
          await expect(board(page, slug).locator('.ch-fill')).toHaveCount(0)
        }
        // A pinned topic leads its board; the row under the title is count or tag, then time.
        const pinned = board(page, 'campus-life').locator('.ch-row').first()
        await expect(pinned.locator('.ch-row-t')).toHaveText('2027 春季选课：注册时间线和常见坑')
        await expect(pinned.locator('.ch-meta > *')).toHaveText(['置顶', '12 条回复', '·', '11月2日'])
        await expect(board(page, 'campus-life').locator('.ch-row').nth(1).locator('.ch-meta > *')).toHaveText(['待回答', '·', '40 分钟前'])

        const market = page.locator('.ch [data-block="market"]')
        await expect(market.locator('.ch-bname')).toHaveText('二手新上架')
        await expect(market.locator('.ch-tile')).toHaveCount(7)
        await expect(market.locator('.ch-tile').last()).toHaveText('看全部二手')
        await expect(market.locator('.ch-price').first()).toHaveText('$35')
        // It scrolls sideways inside itself: the page does not get wider.
        expect(await market.locator('.ch-strip').evaluate(root => [...root.querySelectorAll('*')].some(el =>
          /(auto|scroll)/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 4))).toBe(true)

        const latest = page.locator('.ch [data-block="latest"]')
        await expect(latest.locator('.ch-sec-t')).toHaveText('全站最新')
        await expect(latest.locator('.ch-lr')).toHaveCount(10)
        await expect(latest.locator('[role="tab"]')).toHaveCount(0)
        await expect(latest.locator('.ch-more')).toHaveText('查看全部讨论')

        // Top to bottom, in the order SPEC 5.3 gives.
        const order = [
          await top(page, '.cx-chips'), await top(page, '.ch [data-block="start-here"]'),
          ...await Promise.all(BOARDS.map(slug => top(page, `.ch [data-board="${slug}"]`))),
          await top(page, '.ch [data-block="market"]'), await top(page, '.ch [data-block="latest"]'),
        ]
        expect(order).toEqual([...order].sort((a, b) => a - b))

        // The bar opens in place.
        await fold.click()
        await expect(page.locator('.ch [data-block="start-here"] .ch-guide-t')).toHaveText(['新生落脚清单：第一周要办的 8 件事', '社区守则（2026 年 11 月版）'])
        const ids = await postIds(page)
        expect(new Set(ids).size).toBe(ids.length)

        const fab = page.getByRole('button', { name: '发话题', exact: true })
        await expect(fab).toBeVisible()
        const [button, bar] = await Promise.all([fab.boundingBox(), page.locator('.tabbar').boundingBox()])
        expect(button!.width).toBeCloseTo(52, 0)
        // 16px above the bar, give or take the bar's hairline top border.
        expect(Math.abs(bar!.y - (button!.y + button!.height) - 16)).toBeLessThanOrEqual(1)
      })

      test('① with fewer than five left, the latest block is only the button; a short board gets one filler', async ({ page }) => {
        // Four boards of four: three go to each section, which leaves four for the latest list.
        await openHome(page, { posts: emptyBoard.slice(0, 16).map(post => asRow(post)), items: PLAIN_ITEMS.slice(0, 2) })
        const latest = page.locator('.ch [data-block="latest"]')
        await expect(latest.locator('.ch-lr')).toHaveCount(0)
        await expect(latest.locator('.ch-sec-t')).toHaveCount(0)
        await expect(latest.locator('.ch-more')).toHaveText('查看全部讨论')
        await expect(board(page, 'local-deals').locator('[data-post-id]')).toHaveCount(0)
        await expect(board(page, 'local-deals').locator('.ch-fill')).toHaveText('适合在这里问：火锅、超市、生日蛋糕 发第一帖 ›')
        await expect(page.locator('.ch [data-block="market"] .ch-tile')).toHaveText([/Item 0/, /Item 1/, '发布第一件 ›', '看全部二手'])
      })

      test('③ the search icon opens all discussions with the field focused, and it reads 搜话题', async ({ page }) => {
        const seen = await openHome(page, { posts: posts20.map(post => asRow(post)), items: PLAIN_ITEMS })
        await page.getByRole('button', { name: '搜索', exact: true }).click()
        await expect(page).toHaveURL(/pages\/plaza\/index\?view=all$/)
        await expect(page.locator('.sb-input .uni-input-placeholder')).toHaveText('搜话题')
        await expect(page.locator('.sb-input input')).toBeFocused()
        await expect(page.locator('.cx-title')).toHaveText('全部讨论')
        await expect(page.locator('.topic-row')).toHaveCount(20)

        await page.locator('.sb-input input').fill('拼车')
        await expect.poll(() => seen.rpc).toContain('search_community_posts')
        // Until P4.10 the field searches the community only.
        expect(seen.rpc.filter(name => name !== 'search_community_posts')).toEqual([])
      })

      test('the views have addresses: a board, all discussions, and an unknown one opens the home', async ({ page }) => {
        const data = { posts: posts20.map(post => asRow(post)), items: PLAIN_ITEMS }
        await openHome(page, data)
        await page.locator('.cx-chip', { hasText: '找搭子' }).click()
        await expect(page).toHaveURL(/pages\/plaza\/index\?board=events-social$/)
        await expect(page.locator('.cx-chip.on')).toHaveText('找搭子')
        await expect(page.locator('.topic-row')).toHaveCount(4)
        await expect(page.locator('.ch')).toHaveCount(0)
        await page.getByRole('button', { name: '返回', exact: true }).click()
        await expect(page).toHaveURL(/pages\/plaza\/index$/)
        await expect(page.locator('.ch [data-block="board"]')).toHaveCount(5)

        await page.goto('/#/pages/plaza/index?board=no-such-board', { waitUntil: 'networkidle' })
        await page.reload({ waitUntil: 'networkidle' })
        await expect(page.locator('.ch [data-block="board"]')).toHaveCount(5)
        await expect(page.locator('.cx-chip.on')).toHaveText('全部')
        await page.goto('/#/pages/plaza/index?view=all', { waitUntil: 'networkidle' })
        await page.reload({ waitUntil: 'networkidle' })
        await expect(page.locator('.topic-row')).toHaveCount(20)
        await expect(page.locator('.ch')).toHaveCount(0)

        // The tab page stays alive between visits. Coming back by an address that
        // names a view opens that view, whatever view the page was left on.
        await page.goto('/#/pages/legal/index?type=terms')
        await expect(page.locator('.cx-top')).toHaveCount(0)
        await page.goto('/#/pages/plaza/index?board=campus-life')
        await expect(page.locator('.cx-chip.on')).toHaveText('校园日常')
        await expect(page.locator('.topic-row')).toHaveCount(4)
        // A bare address is what the tab bar opens: the view stays, and the address follows it.
        await page.goto('/#/pages/legal/index?type=terms')
        await expect(page.locator('.cx-top')).toHaveCount(0)
        await page.goto('/#/pages/plaza/index')
        await expect(page.locator('.cx-chip.on')).toHaveText('校园日常')
        await expect(page).toHaveURL(/pages\/plaza\/index\?board=campus-life$/)
      })

      test('a filler opens the composer with its board chosen', async ({ page }) => {
        const UID = '11111111-1111-4111-8111-111111111111', GEN = 'community-home-generation-0001'
        await page.addInitScript(([ref, uid, gen]) => {
          localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
            tag: 'caaci-auth-value-v2', generation: gen,
            value: JSON.stringify({
              access_token: 'stub', token_type: 'bearer', expires_in: 3600,
              expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
              user: { id: uid, email: 'a@illinois.edu', aud: 'authenticated', role: 'authenticated' },
            }),
          }))
          localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({ v: 2, mode: 'allowed', generation: gen }))
        }, [REF, UID, GEN] as const)
        await page.addInitScript(() => {
          localStorage.setItem('welcomed', '1'); localStorage.setItem('lang', 'zh'); localStorage.setItem('theme_pref', 'light')
        })
        await page.clock.setFixedTime(new Date(NOW))
        await serve(page, { posts: emptyBoard.map(post => asRow(post)), items: PLAIN_ITEMS }, {
          id: UID, nickname: 'Test User', avatar_url: null, tos_version: CURRENT_CONSENT_VERSION,
          suspension_level: 0, suspended_until: null, is_illini_verified: true, bio: 'hi', location: 'UIUC',
        })
        await page.goto('/#/pages/plaza/index', { waitUntil: 'networkidle' })
        // Signed in: no notice asking to join.
        await expect(board(page, 'local-deals').locator('.ch-fill')).toBeVisible({ timeout: 15_000 })
        await expect(page.locator('.ch-guest')).toHaveCount(0)
        await board(page, 'local-deals').locator('.ch-fill').click()
        const composer = page.locator('.composer-fullpage')
        await expect(composer.getByRole('button', { name: '吃喝好店', exact: true })).toHaveAttribute('aria-pressed', 'true')
        await expect(composer.getByRole('button', { name: '校园日常', exact: true })).toHaveAttribute('aria-pressed', 'false')
      })

      test('the notice for visitors closes and stays closed on this device', async ({ page }) => {
        await openHome(page, { posts: posts20.map(post => asRow(post)), items: PLAIN_ITEMS })
        await expect(page.locator('.ch-guest-t')).toHaveText('伊利诺伊华人论坛，现开放香槟地区')
        await expect(page.locator('.ch-guest').getByRole('button', { name: '用校园邮箱加入', exact: true })).toBeVisible()
        await page.locator('.ch-guest').getByRole('button', { name: '关闭', exact: true }).click()
        await expect(page.locator('.ch-guest')).toHaveCount(0)
        await page.reload({ waitUntil: 'networkidle' })
        await expect(page.locator('.ch [data-block="board"]').first()).toBeVisible()
        await expect(page.locator('.ch-guest')).toHaveCount(0)
      })
    }

    if (size === DESKTOP) {
      test('② 1280: 876px main with a 2×3 grid and fifteen latest, a 300px sidebar, and no left rail', async ({ page }) => {
        await openHome(page, { posts: SHOWCASE, items: SHOWCASE_ITEMS })

        const [main, side, grid] = await Promise.all(['.ch-main', '.ch-side', '.ch-grid'].map(s => page.locator(s).boundingBox()))
        expect(main!.width).toBeCloseTo(876, 0)
        expect(side!.width).toBeCloseTo(300, 0)
        expect(main!.x).toBeCloseTo(40, 0)
        expect(side!.x - (main!.x + main!.width)).toBeCloseTo(24, 0)
        await expect(page.locator('.app-sidebar')).toBeHidden()
        await expect(page.locator('.tabbar')).toBeHidden()
        await expect(page.locator('.cx-hdr')).toHaveCSS('height', '56px')

        // Two columns, three rows, in the fixed order; the market card is the sixth.
        const cards = page.locator('.ch-grid > .ch-card')
        await expect(cards.locator('.ch-bname')).toHaveText([...BOARD_ZH, '二手好物'])
        const boxes = await cards.evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.bottom)] }))
        for (const row of [0, 1, 2]) {
          const [left, right] = [boxes[row * 2], boxes[row * 2 + 1]]
          expect(left[2]).toBe(426)
          expect(right[0] - (left[0] + left[2])).toBe(24)
          expect(left[1]).toBe(right[1])
          expect(left[3], 'two cards in a row end on the same line').toBe(right[3])
          if (row) expect(left[1] - boxes[(row - 1) * 2][3]).toBe(16)
        }
        expect(Math.round(grid!.x)).toBe(boxes[0][0])
        // 1280×800: the first two rows of cards are whole on the first screen.
        expect(boxes[3][3]).toBeLessThanOrEqual(800)

        const campus = board(page, 'campus-life')
        await expect(campus.locator('.ch-desc')).toHaveText('课程、考试、校园里的事')
        await expect(campus.locator('[data-post-id]')).toHaveCount(4)
        await expect(campus.locator('.ch-row').first().locator('.ch-tag')).toHaveText('置顶')
        await expect(campus.locator('.ch-row').first()).toHaveCSS('height', '34px')
        await expect(campus.locator('.ch-row').nth(1).locator('.ch-tag-ask')).toHaveText('待回答')
        await expect(campus.locator('.ch-row').nth(2).locator('.ch-row-m > *')).toHaveText(['18', '2 小时前'])
        expect(await campus.locator('.ch-row').nth(2).locator('.ch-row-t').evaluate(el => el.scrollWidth > el.clientWidth), 'a long title is cut to one line').toBe(true)
        await expect(page.locator('.ch-grid .ch-week')).toHaveText(['本周 6 新帖', '本周 10 新帖', '本周 8 新帖', '本周 8 新帖', '本周 6 新帖'])
        // The longest date there is, last year's, still shows whole beside its count.
        const oldest = board(page, 'settling-market').locator('.ch-row').first()
        await expect(oldest.locator('.ch-row-m > *')).toHaveText(['9', '2025年11月3日'])
        const [dateBox, cardBox] = await Promise.all([oldest.locator('.ch-row-m').boundingBox(), board(page, 'settling-market').boundingBox()])
        expect(dateBox!.x + dateBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width - 20)

        const market = page.locator('.ch [data-block="market"]')
        await expect(market.locator('.ch-item')).toHaveCount(3)
        await expect(market.locator('.ch-item').first()).toHaveCSS('height', '48px')
        await expect(market.locator('.ch-price')).toHaveText(['$35', '$180', '$25'])
        await expect(market.locator('.ch-link')).toHaveText('全部二手 ›')

        const latest = page.locator('.ch [data-block="latest"]')
        await expect(latest.locator('.ch-lr')).toHaveCount(15)
        // Until P3.4 there is one order, so no tab row.
        await expect(latest.locator('[role="tab"]')).toHaveCount(0)
        await expect(latest.locator('.ch-more')).toHaveText('查看更多 ›')
        const first = latest.locator('.ch-lr').first()
        await expect(first.locator('.ch-lr-t')).toHaveText('12 月去芝加哥看圣诞灯展，求拼车，2 个人')
        await expect(first.locator('.ch-meta .ch-mi')).toHaveText(['找搭子', '·', '王一凡', '·', '6 小时前'])
        await expect(first.locator('.ch-pill')).toHaveText('3')
        expect((await first.boundingBox())!.height).toBeGreaterThanOrEqual(56)

        // Sidebar, top to bottom. No event source exists before P4.8, so that block is absent.
        await expect(page.locator('.ch-side [role="heading"]')).toHaveText(['新来先看', '本周热议', '关于本站'])
        await expect(page.getByText('近期活动')).toHaveCount(0)
        await expect(page.locator('.ch-side [data-block="start-here"] .ch-guide-t')).toHaveText(['新生落脚清单：第一周要办的 8 件事', '社区守则（2026 年 11 月版）'])
        const hot = page.locator('.ch-side [data-block="hot"] .ch-hot')
        await expect(hot).toHaveCount(5)
        await expect(hot.first().locator('.ch-row-t')).toHaveText('周末带爸妈吃饭，Champaign 哪家中餐适合')
        await expect(hot.locator('.ch-cnt')).toHaveText(['12', '6', '5', '4', '3'])
        await expect(page.locator('.ch-side [data-block="about"] [role="button"]')).toHaveText(['社区守则', '用户协议', '隐私政策', '意见反馈'])

        const ids = await postIds(page)
        expect(ids.length).toBe(20 + 15 + 2 + 5)
        expect(new Set(ids).size).toBe(ids.length)
      })

      test('④ 20 posts: six full cards and the latest block as one line; 60 posts: fifteen latest rows', async ({ page }) => {
        await openHome(page, { posts: posts20.map(post => asRow(post)), items: PLAIN_ITEMS })
        for (const slug of BOARDS) {
          await expect(board(page, slug).locator('[data-post-id]')).toHaveCount(4)
          await expect(board(page, slug).locator('.ch-fill')).toHaveCount(0)
        }
        const market = page.locator('.ch [data-block="market"]')
        await expect(market.locator('.ch-item')).toHaveCount(3)
        await expect(market.locator('.ch-fill')).toHaveCount(0)
        const latest = page.locator('.ch [data-block="latest"]')
        await expect(latest.locator('.ch-lr')).toHaveCount(0)
        await expect(latest.locator('.ch-sec-t')).toHaveCount(0)
        await expect(latest.locator('.ch-more')).toHaveText('查看全部 20 个讨论 ›')
        expect((await latest.boundingBox())!.height).toBeCloseTo(40, 0)
        await expect(page.locator('.ch-week')).toHaveCount(5)
        await page.screenshot({ path: `${SHOTS}/home-1280-light-zh-20-posts.png`, animations: 'disabled' })

        await openHome(page, { posts: posts60.map(post => asRow(post)), items: PLAIN_ITEMS })
        await expect(page.locator('.ch [data-block="latest"] .ch-lr')).toHaveCount(15)
        for (const slug of BOARDS) await expect(board(page, slug).locator('[data-post-id]')).toHaveCount(4)

        await page.locator('.ch [data-block="latest"] .ch-more').click()
        await expect(page).toHaveURL(/pages\/plaza\/index\?view=all$/)
        await expect(page.locator('.topic-row').first()).toBeVisible()
      })

      test('③ the header search reads 搜话题 and searches the community only', async ({ page }) => {
        const seen = await openHome(page, { posts: posts20.map(post => asRow(post)), items: PLAIN_ITEMS })
        const field = page.locator('.cx-search')
        await expect(field.locator('.uni-input-placeholder')).toHaveText('搜话题')
        const box = await field.boundingBox()
        expect(box!.width).toBeCloseTo(320, 0)
        expect(box!.height).toBeCloseTo(36, 0)
        const compose = await page.locator('.cx-compose').boundingBox()
        expect(compose!.width).toBeCloseTo(72, 0)
        expect(compose!.height).toBeCloseTo(36, 0)

        await field.locator('input').fill('拼车')
        await field.locator('input').press('Enter')
        await expect(page).toHaveURL(/pages\/plaza\/index\?view=all$/)
        await expect.poll(() => seen.rpc).toContain('search_community_posts')
        expect(seen.rpc.filter(name => name !== 'search_community_posts')).toEqual([])
        await expect(field.locator('input')).toHaveValue('拼车')
      })

      test('the header menu lists the five boards and all discussions', async ({ page }) => {
        await openHome(page, { posts: posts20.map(post => asRow(post)), items: PLAIN_ITEMS })
        const toggle = page.locator('.cx-nav-on')
        await expect(toggle).toHaveAttribute('aria-expanded', 'false')
        await toggle.click()
        await expect(toggle).toHaveAttribute('aria-expanded', 'true')
        await expect(page.locator('.cx-pop .cx-pop-i')).toHaveText([...BOARD_ZH, '全部讨论'])
        // Each board leads with its own colour, as on its card.
        expect(await page.locator('.cx-pop .cx-pop-bar').evaluateAll(bars => bars.map(bar => getComputedStyle(bar).backgroundColor)))
          .toEqual(await tokenColours(page, BOARDS.map(slug => `--board-${slug}`)))
        await page.keyboard.press('Escape')
        await expect(page.locator('.cx-pop')).toHaveCount(0)
        await toggle.click()
        await page.locator('.cx-pop .cx-pop-i', { hasText: '吃喝好店' }).click()
        await expect(page).toHaveURL(/pages\/plaza\/index\?board=local-deals$/)
        await expect(page.locator('.cx-pop')).toHaveCount(0)
        await expect(page.locator('.topic-row')).toHaveCount(4)
      })
    }
  })
}

test('⑤ the CSS added for the home holds no hex colour', () => {
  const styles = (file: string) => [...readFileSync(resolve(file), 'utf8').matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')
  const page = styles('src/pages/plaza/index.vue')
  const added = page.slice(page.indexOf('.home-scroll {'))
  expect(added.length).toBeGreaterThan(200)
  for (const [name, css] of [
    ['CommunityHome.vue', styles('src/components/CommunityHome.vue')],
    ['CommunityHeader.vue', styles('src/components/CommunityHeader.vue')],
    ['CommunityAbout.vue', styles('src/components/CommunityAbout.vue')],
    ['plaza/index.vue (home rules)', added],
  ]) {
    expect(css.length, name).toBeGreaterThan(200)
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) || [], `hex literals in ${name}`).toEqual([])
    expect(css.match(/rgba?\(/g) || [], `raw colours in ${name}`).toEqual([])
  }
  // HOME.4 restyled two shared badges; their rules name tokens only.
  const badges = styles('src/components/UBadge.vue')
  for (const variant of ['official', 'illini']) {
    const rule = new RegExp(`\\.u-badge--${variant}\\s*\\{[^}]*\\}`).exec(badges)?.[0] || ''
    expect(rule.length, variant).toBeGreaterThan(60)
    expect(rule.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || [], `raw colours in .u-badge--${variant}`).toEqual([])
  }
})
