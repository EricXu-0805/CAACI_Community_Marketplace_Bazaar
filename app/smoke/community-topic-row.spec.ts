import { test, expect, type Locator, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { supabaseRefForBuild } from './supabase-ref'

/*
 * P2.12 (SPEC 6.3.2): in the community list a topic is one forum row and an
 * update keeps its card. This covers the row itself, the linked-item line and
 * first image, the actions that now live only on the topic page, first-screen
 * density, and the SPEC 9.6 audit with the light/dark x zh/en x 390/768/1280
 * screenshots.
 *
 * axe-core is not a repo dependency (BACKLOG 0.3, STOP-8). run-checks mounts
 * the workstation copy read-only at /dev-env; where it is absent (CI) the axe
 * half of the audit is skipped and the log says so.
 */

const REF = supabaseRefForBuild()
const AXE = [process.env.AXE_CORE_PATH, '/dev-env/tools/node_modules/axe-core/axe.min.js']
  .find((path): path is string => !!path && existsSync(path))
const SHOTS = 'test-results/visual/P2.12'

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/\.supabase\.co(?:[:/]|$)/, socket => socket.close())
})

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR
// Relative to the run, so "3 小时前" stays true for as long as the run takes.
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`

type Person = { id: string; nickname: string; avatar_url: null; is_illini_verified: boolean; uid: null }
const person = (n: number, nickname: string): Person =>
  ({ id: uuid('10000000', n), nickname, avatar_url: null, is_illini_verified: false, uid: null })
const STAFF = person(1, '玉米地站务')
const KEVIN = person(2, 'Kevin Z.')
const BANZHUAN = person(3, '香槟搬砖人')
const YUKI = person(4, 'yuki_uiuc')
const ECE = person(5, 'ECE 大二')
const MIA = person(6, 'Mia L.')

// Post photos are the app's own banner art, served for the storage URLs below.
type Photo = 'welcome' | 'publish' | 'safety'
const photo = (owner: Person, name: Photo) =>
  `https://${REF}.supabase.co/storage/v1/object/public/item-images/items/${owner.id}/${name}.png`

type ItemSpec = [number, string, string, number, 'active' | 'reserved' | 'sold']
const linked = (owner: Person, items: ItemSpec[]) => items.map(([n, zh, en, price, status], order) => ({
  display_order: order,
  item: {
    id: uuid('20000000', n), user_id: owner.id, title: zh, title_i18n: { zh, en }, price,
    images: [], image_dimensions: null, status, listing_type: 'sell', listing_details: null,
  },
}))

type Row = Record<string, unknown> & { id: string; title: string | null; category: string | null }
function post(n: number, author: Person, fields: Partial<Row> & Record<string, unknown>): Row {
  return {
    id: uuid('30000000', n), user_id: author.id, title: null, category: null, content: '',
    images: [], image_dimensions: [], content_i18n: null, source_lang: 'zh',
    is_official: false, is_pinned: false, like_count: 0, comment_count: 0, status: 'active',
    created_at: ago(HOUR), updated_at: ago(HOUR), profile: author, post_items: [], ...fields,
  }
}

// SPEC 9.6 fixtures: a 60-character Chinese title, English course names, a
// topic with no reply, one linked to a sold item, topics without images.
const LONG_TITLE = '这学期同时选了三门带实验的课，每周还有两次小组讨论，想问问大家都是怎么安排复习和睡眠的，才不至于在期中那一周直接垮掉呢？'

function listPosts(): Row[] {
  return [
    post(1, STAFF, {
      title: '新生落脚清单：第一周要办的 8 件事', category: 'settling-market', is_official: true, is_pinned: true,
      comment_count: 23, created_at: ago(2 * DAY + 3 * HOUR),
      content: '从 i-card、银行卡到手机卡和 SSN 预约，按先后顺序整理了第一周要跑的地方，每一步都写了要带的材料和大概要排多久的队。',
    }),
    post(2, BANZHUAN, {
      title: LONG_TITLE, category: 'campus-life', created_at: ago(47 * MINUTE),
      content: '我这学期选了 CHEM 102、PHYS 211 和 MCB 150，三门都有实验报告，再加上每周两次小组讨论，现在每天只能睡五个多小时。想听听大家是怎么分配时间的，有没有哪门课的实验报告可以提前写，或者哪些讨论课其实可以少花点时间准备？',
    }),
    post(3, KEVIN, {
      title: 'CS 225 和 MATH 241 放同一学期会不会太累？', category: 'campus-life', comment_count: 12,
      created_at: ago(3 * HOUR + 10 * MINUTE), images: [photo(KEVIN, 'welcome')],
      content: 'CS 225 的 MP 每两周一个，MATH 241 每周都有作业，听说期中前后会撞在一起。上过的同学觉得能扛住吗？',
    }),
    post(4, YUKI, {
      title: '毕业清东西：书桌、台灯、显示器打包出', category: 'settling-market', comment_count: 5, created_at: ago(5 * HOUR),
      images: [photo(YUKI, 'publish'), photo(YUKI, 'safety'), photo(YUKI, 'welcome')],
      post_items: linked(YUKI, [[1, '台灯', 'Desk lamp', 15, 'sold'], [2, '书桌', 'Desk', 45, 'active'], [3, '显示器', 'Monitor', 60, 'reserved']]),
      content: '五月底回国，东西都在 Green St 附近，可以自取，打包买有优惠。台灯已经被订了，书桌和显示器还在。',
    }),
    post(5, MIA, {
      title: '出一辆九成新的自行车，送车锁和车灯', category: 'settling-market', comment_count: 2, created_at: ago(8 * HOUR),
      post_items: linked(MIA, [[4, '自行车', 'Bike', 80, 'active']]),
      content: '去年秋天买的 Trek，平时只骑去上课，刹车上个月刚换过。只能自取，在 Urbana。',
    }),
    post(6, ECE, {
      title: '大二才开始找实习，现在投暑期还来得及吗？', category: 'alumni-career', comment_count: 9, created_at: ago(DAY + 2 * HOUR),
      content: '专业是 ECE，GPA 3.6，之前没有实习经历，只做过两个课程项目。现在才开始投会不会太晚？简历应该先补什么？',
    }),
    post(7, BANZHUAN, {
      title: '这周六去芝加哥中国城，有人一起拼车吗？', category: 'events-social', comment_count: 3, created_at: ago(DAY + 6 * HOUR),
      content: '周六上午九点从 Illini Union 出发，晚上七点左右回来，车上还有两个空位，油费平摊。',
    }),
    post(8, YUKI, {
      title: 'Campustown 现在哪家火锅还开着？', category: 'local-deals', comment_count: 7, created_at: ago(2 * DAY + HOUR),
      images: [photo(YUKI, 'safety')],
      content: '之前常去的那家好像关了，想找一家能坐下六个人的，最好可以提前订位。',
    }),
    post(9, MIA, {
      title: '刚到香槟还没有 SSN，哪家银行能先开户？', category: 'settling-market', comment_count: 14, created_at: ago(3 * DAY),
      content: '学校邮件里推荐了几家银行，有的说必须要 SSN，有的说护照和 I-20 就可以，最近去办过的同学说说？',
    }),
    post(10, ECE, {
      title: 'ECE 391 MP2 有没有一起 debug 的小组', category: 'campus-life', comment_count: 1, created_at: ago(4 * DAY),
      content: '每周二、四晚上在 Grainger 三楼，欢迎一起来，带上你的 bug。',
    }),
    post(11, KEVIN, {
      title: 'Krannert 这周的免费音乐会值得去吗', category: 'events-social', comment_count: 2, created_at: ago(5 * DAY),
      content: '看到周四晚上有学生乐团的演出，免费但要提前在网上领票，去过的同学说说体验？',
    }),
    post(12, BANZHUAN, {
      title: 'Urbana 哪里能买到便宜的书桌？', category: 'settling-market', created_at: ago(40 * DAY),
      content: '不想去宜家那么远，附近有没有二手店或者群可以看看？',
    }),
  ]
}

// SPEC 6.3.2 density fixture: one-line title, one-line excerpt, no image, no item.
function densePosts(): Row[] {
  const rows: [string, string, string, Person][] = [
    ['周末去哪自习比较安静', '想找个人少的地方', 'campus-life', KEVIN],
    ['MATH 415 期末怎么复习', '还有两周就考试了', 'campus-life', ECE],
    ['求推荐 Urbana 的理发店', '剪短发就行', 'local-deals', YUKI],
    ['冬天的外套在哪买划算', '第一次在这边过冬', 'settling-market', MIA],
    ['有人一起去做志愿者吗', '周六上午出发', 'events-social', BANZHUAN],
    ['CS 128 答疑时间改了吗', '课程网站没更新', 'campus-life', KEVIN],
    ['实习面试被问项目细节', '怎么准备比较好', 'alumni-career', ECE],
    ['图书馆期末周几点关门', '想晚一点走', 'campus-life', YUKI],
    ['哪家奶茶店今天开门', '感恩节放假了', 'local-deals', MIA],
    ['新生研讨课值得选吗', '学分不多', 'alumni-career', BANZHUAN],
    ['找室友一起看房', '明年八月入住', 'settling-market', KEVIN],
    ['健身房几点人比较少', '想避开高峰', 'events-social', ECE],
  ]
  return rows.map(([title, content, category, author], i) => post(100 + i, author, {
    title, content, category, comment_count: (i * 7) % 19 + 1, created_at: ago((i + 1) * 47 * MINUTE),
  }))
}

async function serve(page: Page, posts: Row[]) {
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ flagged: false, categories: [] }),
  }))
  await page.route('**/*.supabase.co/**', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname.includes('/storage/v1/')) {
      const name = url.pathname.split('/').pop()!.replace(/\.png$/, '')
      return route.fulfill({ contentType: 'image/png', body: readFileSync(resolve(`src/static/banner-${name}.png`)) })
    }
    if (url.pathname.endsWith('/rest/v1/posts')) {
      const eq = (key: string) => url.searchParams.get(key)?.replace(/^eq\./, '')
      const rows = posts.filter(row => (!eq('id') || row.id === eq('id')) && (!eq('category') || row.category === eq('category')))
      const single = request.headers().accept?.includes('vnd.pgrst.object')
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(single ? rows[0] ?? null : rows) })
    }
    return route.fulfill({ contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: '[]' })
  })
}

// Wait for webfonts and the one-shot entrance animation, so boxes are final.
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(document.getAnimations()
      .filter(animation => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)))
      .map(animation => animation.finished.catch(() => undefined)))
  })
}

async function openList(page: Page, options: { lang: 'zh' | 'en'; theme: 'light' | 'dark'; posts: Row[] }) {
  await page.addInitScript(([lang, theme]) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', lang)
    localStorage.setItem('theme_pref', theme)
  }, [options.lang, options.theme] as const)
  await page.emulateMedia({ colorScheme: options.theme })
  await serve(page, options.posts)
  await page.goto('/#/pages/plaza/index', { waitUntil: 'networkidle' })
  await expect(page.locator('.topic-row').first()).toBeVisible({ timeout: 15_000 })
  await settle(page)
}

// uni-h5 paints <image> as a background once its loader has the file.
async function thumbsPainted(page: Page) {
  await expect.poll(() => page.locator('.tr-thumb-img > div').evaluateAll(layers =>
    layers.length > 0 && layers.every(layer => getComputedStyle(layer).backgroundImage.startsWith('url(')))).toBe(true)
}

const rowWith = (page: Page, title: string) =>
  page.locator('.topic-row').filter({ has: page.locator('.tr-title', { hasText: title }) })

const metaLine = async (row: Locator) =>
  (await row.locator('.tr-meta > *').allInnerTexts()).map(part => part.trim()).join(' ')

const lines = (text: Locator) => text.evaluate(el => ({
  lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
  clipped: el.scrollHeight > el.clientHeight + 1,
}))

// Distance from each reply count or tag to its row's right padding edge.
const replyOffsets = (page: Page) => page.locator('.topic-row').evaluateAll(rows => rows.flatMap(row => {
  const end = row.querySelector('.tr-replies')
  if (!end) return []
  const edge = row.getBoundingClientRect().right - parseFloat(getComputedStyle(row).paddingRight)
  return [Math.round(edge - end.getBoundingClientRect().right)]
}))

async function rowsOnFirstScreen(page: Page) {
  return page.evaluate(() => {
    const feed = document.querySelector('#plaza-feed-panel')!.getBoundingClientRect()
    const bar = document.querySelector('.tabbar')
    const barTop = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : Infinity
    const bottom = Math.min(feed.bottom, window.innerHeight, barTop)
    const rows = [...document.querySelectorAll('.topic-row')].map(row => row.getBoundingClientRect())
    return {
      count: rows.filter(rect => rect.top >= feed.top - 0.5 && rect.bottom <= bottom + 0.5).length,
      rowHeight: rows[0]?.height ?? 0,
      listTop: rows[0]?.top ?? 0,
      bottom,
    }
  })
}

// SPEC 9.6 within one subtree: visible text under 12px (digits inside .u-badge
// excepted) and, where axe is mounted, color-contrast violations.
async function audit(page: Page, scope: string) {
  const small = await page.evaluate(selector => {
    const root = document.querySelector(selector)
    if (!root) return [{ text: `missing ${selector}`, size: 0 }]
    const found: { text: string; size: number }[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent || '').trim()
      const parent = node.parentElement
      if (!text || !parent || parent.getClientRects().length === 0) continue
      const style = getComputedStyle(parent)
      if (style.visibility === 'hidden' || style.display === 'none') continue
      if (/^\d+$/.test(text) && parent.closest('.u-badge')) continue
      const size = parseFloat(style.fontSize)
      if (size < 12) found.push({ text: text.slice(0, 40), size })
    }
    return found
  }, scope)
  let contrast: string[] | null = null
  if (AXE) {
    if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE })
    contrast = await page.evaluate(async selector => {
      const result = await (window as any).axe.run(document.querySelector(selector), {
        runOnly: { type: 'rule', values: ['color-contrast'] }, resultTypes: ['violations'],
      })
      return result.violations.flatMap((rule: any) =>
        rule.nodes.map((node: any) => `${node.target.join(' ')}: ${node.failureSummary.replace(/\s+/g, ' ')}`))
    }, scope)
  }
  return { small, contrast }
}

const SIZES = [
  { width: 390, height: 844, scale: 2, mobile: true },
  { width: 768, height: 1024, scale: 1, mobile: false },
  { width: 1280, height: 800, scale: 1, mobile: false },
]

for (const size of SIZES) {
  test.describe(`topic list at ${size.width}px`, () => {
    // uni-h5 reads the window width from the screen, so both have to move.
    test.use({
      viewport: { width: size.width, height: size.height },
      screen: { width: size.width, height: size.height },
      deviceScaleFactor: size.scale, isMobile: size.mobile, hasTouch: size.mobile,
    })

    for (const theme of ['light', 'dark'] as const) for (const lang of ['zh', 'en'] as const) {
      test(`④⑥ ${theme} ${lang}: screenshot and visual audit`, async ({ page }) => {
        await openList(page, { lang, theme, posts: listPosts() })
        await thumbsPainted(page)
        const name = `list-${theme}-${lang}-${size.width}`
        await page.screenshot({ path: `${SHOTS}/${name}.png`, animations: 'disabled' })

        const list = await audit(page, '.posts')
        const whole = await audit(page, 'body')
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        console.log(`AUDIT P2.12 ${name} list_small=${list.small.length} list_axe=${list.contrast?.length ?? 'skipped'}`
          + ` page_small=${whole.small.length} page_axe=${whole.contrast?.length ?? 'skipped'} overflow=${overflow}px`)
        console.log(list.contrast
          ? `AXE color-contrast violations=${list.contrast.length} (P2.12 ${name}, topic list)`
          : `AXE color-contrast skipped: axe-core is not mounted (P2.12 ${name})`)
        if (whole.small.length) console.log(`  page text under 12px: ${JSON.stringify(whole.small.slice(0, 8))}`)
        if (whole.contrast?.length) console.log(`  page contrast: ${whole.contrast.slice(0, 8).join(' | ')}`)

        expect(list.small, 'text under 12px in the topic list').toEqual([])
        if (list.contrast) expect(list.contrast, 'axe color-contrast in the topic list').toEqual([])
        expect(overflow, 'horizontal overflow').toBe(0)
      })
    }

    if (size.width === 390) {
      test('① a row: title in at most 2 lines, 14px excerpt in 2, one meta line, tabular reply count at the right', async ({ page }) => {
        await openList(page, { lang: 'zh', theme: 'light', posts: listPosts() })

        const long = rowWith(page, LONG_TITLE)
        const title = long.locator('.tr-title')
        await expect(title).toHaveCSS('font-size', '17px')
        await expect(title).toHaveCSS('font-weight', '600')
        expect(await lines(title)).toEqual({ lines: 2, clipped: true })
        const excerpt = long.locator('.tr-excerpt')
        await expect(excerpt).toHaveCSS('font-size', '14px')
        expect(await lines(excerpt)).toEqual({ lines: 2, clipped: true })
        // No reply yet and posted within 30 days: the tag replaces the count.
        await expect(long.locator('.tr-tag-ask')).toHaveText('待回答')
        await expect(long.locator('.tr-count')).toHaveCount(0)

        const course = rowWith(page, 'CS 225 和 MATH 241')
        expect(await metaLine(course)).toBe('校园日常 · Kevin Z. · 3 小时前')
        await expect(course.locator('.tr-meta-item').first()).toHaveCSS('font-size', '13px')
        const count = course.locator('.tr-count')
        await expect(count).toHaveText('12')
        await expect(count).toHaveCSS('font-variant-numeric', 'tabular-nums')
        // Counts end at the row's right padding edge, with or without an image.
        const offsets = await replyOffsets(page)
        expect(offsets.length).toBeGreaterThan(5)
        expect([...new Set(offsets)]).toEqual([0])

        expect(await metaLine(page.locator('.topic-row').first())).toBe('置顶 · 落脚香槟 · 玉米地站务 官方 · 2 天前')
        await expect(rowWith(page, 'Urbana 哪里能买到便宜的书桌').locator('.tr-replies')).toHaveCount(0)

        // Inside a board the board name leaves the meta line.
        await page.locator('.board-filters').getByRole('button', { name: '校园日常', exact: true }).click()
        await expect(page.locator('.topic-row')).toHaveCount(3)
        expect(await metaLine(rowWith(page, 'CS 225 和 MATH 241'))).toBe('Kevin Z. · 3 小时前')
      })

      test('② a linked item adds one plain line; the first image sits at the right, 72x72 with radius 8', async ({ page }) => {
        await openList(page, { lang: 'zh', theme: 'light', posts: listPosts() })
        await thumbsPainted(page)

        const sale = rowWith(page, '毕业清东西')
        await expect(sale.locator('.tr-linked')).toHaveText('关联 · 台灯 $15 · 已售出 · 等 3 件')
        await expect(sale.locator('.tr-linked')).toHaveCSS('font-size', '13px')
        await expect(rowWith(page, '自行车').locator('.tr-linked')).toHaveText('关联 · 自行车 $80 · 在售')
        await expect(rowWith(page, '大二才开始找实习').locator('.tr-linked')).toHaveCount(0)

        const thumb = sale.locator('.tr-thumb')
        await expect(thumb).toHaveCSS('border-radius', '8px')
        const [row, image, heading] = await Promise.all([sale.boundingBox(), thumb.boundingBox(), sale.locator('.tr-title').boundingBox()])
        expect(image!.width).toBeCloseTo(72, 0)
        expect(image!.height).toBeCloseTo(72, 0)
        expect(row!.x + row!.width - (image!.x + image!.width)).toBeCloseTo(16, 0)
        expect(image!.x).toBeGreaterThanOrEqual(heading!.x + heading!.width)
        expect(await thumb.locator('.tr-thumb-img > div').evaluate(el => getComputedStyle(el).backgroundImage))
          .toContain(`/items/${YUKI.id}/publish.png`)
        await expect(sale.locator('.tr-thumb-more')).toHaveText('+2')
        await expect(sale.locator('.tr-thumb-more')).toHaveCSS('font-size', '12px')
        await expect(rowWith(page, '大二才开始找实习').locator('.tr-thumb')).toHaveCount(0)
      })

      test('③ like, share and translate are on the topic page, not the row; an update keeps its card', async ({ page }) => {
        const topic = post(40, KEVIN, {
          title: 'Where can I find a cheap desk in Urbana?', category: 'settling-market', comment_count: 3, like_count: 5,
          created_at: ago(2 * HOUR), content: 'Any thrift stores near campus? 想找二手的。',
        })
        const update = post(41, MIA, { content: 'The quad looks great in the snow today.', comment_count: 2, like_count: 4, created_at: ago(3 * HOUR) })
        await openList(page, { lang: 'en', theme: 'light', posts: [topic, update] })

        const row = page.locator('.topic-row')
        await expect(row).toHaveCount(1)
        await expect(row.locator('[role="button"]')).toHaveCount(0)
        await expect(row.locator('.pa-btn, .pc-translate, .post-actions')).toHaveCount(0)

        const card = page.locator('.post-card')
        await expect(card).toHaveCount(1)
        await expect(card.getByText('The quad looks great in the snow today.', { exact: true })).toBeVisible()
        for (const name of ['Like', 'Reply', 'Share', 'Translate']) {
          await expect(card.getByRole('button', { name, exact: true })).toBeVisible()
        }

        await row.click()
        await expect(page).toHaveURL(new RegExp(`pages/post/index\\?id=${topic.id}`))
        await expect(page.locator('.post-topic-title')).toHaveText(topic.title!)
        for (const name of ['Like', 'Share', 'Translate']) {
          await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
        }
      })
    }

    if (size.width === 1280) {
      test('① desktop: one-line title; excerpt, 240px meta and count share a line; image centred at the right', async ({ page }) => {
        await openList(page, { lang: 'en', theme: 'light', posts: listPosts() })
        await thumbsPainted(page)

        const long = rowWith(page, LONG_TITLE)
        expect(await lines(long.locator('.tr-title'))).toEqual({ lines: 1, clipped: true })
        expect((await lines(long.locator('.tr-excerpt'))).lines).toBe(1)
        const [excerpt, meta, tag] = await Promise.all(['.tr-excerpt', '.tr-meta', '.tr-replies'].map(s => long.locator(s).boundingBox()))
        expect(Math.abs(excerpt!.y + excerpt!.height / 2 - (meta!.y + meta!.height / 2))).toBeLessThan(2)
        expect(meta!.x).toBeGreaterThanOrEqual(excerpt!.x + excerpt!.width)
        expect(meta!.width).toBeCloseTo(240, 0)
        expect(tag!.x).toBeGreaterThanOrEqual(meta!.x + meta!.width)
        await expect(long.locator('.tr-tag-ask')).toHaveText('Unanswered')
        expect(await metaLine(rowWith(page, 'CS 225 和 MATH 241'))).toBe('Campus life · Kevin Z. · 3h ago')
        // A meta line longer than 240px (pinned, official) stays on one line with the author whole.
        const pinned = page.locator('.topic-row').first()
        expect(await metaLine(pinned)).toBe('Pinned · Settling in · 玉米地站务 Official · 2d ago')
        expect((await pinned.locator('.tr-meta').boundingBox())!.height).toBeLessThanOrEqual(21)
        expect(await pinned.locator('.tr-author').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
        expect([...new Set(await replyOffsets(page))]).toEqual([0])

        const sale = rowWith(page, '毕业清东西')
        await expect(sale.locator('.tr-linked')).toHaveText('Linked · Desk lamp $15 · Sold · 3 items in all')
        await expect(rowWith(page, '自行车').locator('.tr-linked')).toHaveText('Linked · Bike $80 · Available')
        const [row, image] = await Promise.all([sale.boundingBox(), sale.locator('.tr-thumb').boundingBox()])
        expect(image!.width).toBeCloseTo(72, 0)
        expect(image!.height).toBeCloseTo(72, 0)
        expect(row!.x + row!.width - (image!.x + image!.width)).toBeCloseTo(16, 0)
        expect(Math.abs(row!.y + row!.height / 2 - (image!.y + image!.height / 2))).toBeLessThan(1)
      })
    }

    if (size.width === 390 || size.width === 1280) {
      const least = size.width === 390 ? 5 : 8
      test(`⑤ the first screen holds at least ${least} rows at ${size.width}x${size.height}`, async ({ page }) => {
        await openList(page, { lang: 'zh', theme: 'light', posts: densePosts() })
        for (const row of await page.locator('.topic-row').all()) {
          expect((await lines(row.locator('.tr-title'))).lines, 'density fixture title').toBe(1)
          expect((await lines(row.locator('.tr-excerpt'))).lines, 'density fixture excerpt').toBe(1)
        }
        const screen = await rowsOnFirstScreen(page)
        console.log(`DENSITY P2.12 ${size.width}x${size.height} rows=${screen.count} row_height=${screen.rowHeight.toFixed(1)}px`
          + ` list_top=${screen.listTop.toFixed(1)}px visible_bottom=${screen.bottom.toFixed(1)}px`)
        expect(screen.count).toBeGreaterThanOrEqual(least)
      })
    }
  })
}
