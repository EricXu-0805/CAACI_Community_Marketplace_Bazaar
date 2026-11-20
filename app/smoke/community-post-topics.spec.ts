import { test, expect, type Page } from '@playwright/test'
import { supabaseRefForBuild } from './supabase-ref'
import { CURRENT_CONSENT_VERSION } from '../src/legal'

// Mocked HTTP sessions must never reach the hosted Realtime service.
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/\.supabase\.co(?:[:/]|$)/, socket => socket.close())
})

const REF = supabaseRefForBuild()
const UID = '11111111-1111-4111-8111-111111111111'
const GEN = 'attach-picker-generation-0001'
const PROFILE = {
  id: UID, nickname: 'Test User', avatar_url: null, tos_version: CURRENT_CONSENT_VERSION,
  suspension_level: 0, suspended_until: null, is_illini_verified: true, bio: 'hi', location: 'UIUC',
}

async function openPlazaComposer(page: Page, install: () => Promise<void>, lang: 'en' | 'zh' = 'en', options: { open?: boolean; level?: number } = {}) {
  await page.addInitScript(([ref, uid, gen, lang]) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', lang)
    localStorage.setItem('theme_pref', 'light')
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      tag: 'caaci-auth-value-v2', generation: gen,
      value: JSON.stringify({
        access_token: 'stub', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
        user: { id: uid, email: 'a@illinois.edu', aud: 'authenticated', role: 'authenticated' },
      }),
    }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({
      v: 2, mode: 'allowed', generation: gen,
    }))
  }, [REF, UID, GEN, lang] as const)

  await page.route('**/*.supabase.co/**', async route => {
    const profile = options.level === undefined ? PROFILE : {
      ...PROFILE, suspension_level: options.level,
      suspended_until: options.level === 5 ? 'infinity' : '2100-12-03T12:34:56Z',
    }
    const body = route.request().url().includes('/rpc/get_my_profile') ? profile : []
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/1' }, body: JSON.stringify(body),
    })
  })

  await install()
  await page.goto('/#/pages/plaza/index?view=all', { waitUntil: 'networkidle' })
  if (options.level !== undefined && options.level >= 2) return
  await expect(page.locator('[data-test=region-switcher]')).toHaveCount(0)
  await expect(page.locator('[data-test=region-label]').first()).toHaveText(/^(Champaign-Urbana|香槟)$/)
  if (options.open === false) return
  await page.getByRole('button', { name: lang === 'zh' ? '发话题' : 'New topic', exact: true }).filter({ visible: true }).click({ timeout: 15_000 })
  await expect(page.locator('.comp-attach-btn').first()).toBeVisible({ timeout: 10_000 })
}


const LEGACY = { id: '22222222-2222-4222-8222-222222222222', user_id: UID, content: 'Legacy campus update', title: null, category: null,
  images: [], like_count: 0, comment_count: 0, created_at: '2026-11-01T00:00:00Z', profile: PROFILE, status: 'active' }
const TOPIC = { ...LEGACY, id: '33333333-3333-4333-8333-333333333333', title: 'Quantum study group', category: 'campus-life', content: 'Meet at the library' }

async function fixture(page: Page, lang: 'en' | 'zh' = 'en') {
  const writes: Record<string, unknown>[] = [], searches: Record<string, unknown>[] = []
  const posts = [TOPIC, LEGACY]
  const behavior = { failPublish: false, failRecovery: false, persistOnFailure: true }
  await openPlazaComposer(page, async () => {
    await page.route(/\/api\/(moderate|translate)(?:\?|$)/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ flagged: false, categories: [] }) }))
    await page.route('**/rest/v1/rpc/search_community_posts', route => {
      const query = route.request().postDataJSON(); searches.push(query)
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(posts.filter(post => post.category === query.category_in && post.title?.includes('Quantum'))) })
    })
    await page.route('**/rest/v1/posts?**', route => {
      const request = route.request(), url = new URL(request.url())
      let body: unknown
      if (request.method() === 'POST') {
        const payload = request.postDataJSON(); writes.push(payload)
        const post = { ...LEGACY, ...payload }
        if (!behavior.failPublish || behavior.persistOnFailure) posts.unshift(post)
        if (behavior.failPublish) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'response lost' }) })
        body = post
      } else if (url.searchParams.has('user_id') && behavior.failRecovery) {
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'offline' }) })
      } else if (request.headers().accept?.includes('vnd.pgrst.object')) {
        body = posts.find(post => `eq.${post.id}` === url.searchParams.get('id'))
      } else if (url.searchParams.has('id')) {
        body = posts.filter(post => `eq.${post.id}` === url.searchParams.get('id'))
      } else {
        body = url.searchParams.has('category') ? posts.filter(post => `eq.${post.category}` === url.searchParams.get('category')) : posts
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
  }, lang)
  return { writes, searches, behavior }
}

for (const width of [390, 1280]) {
  test(`legacy rows, board filtering, title search and topic board links coexist at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const h = await fixture(page)
    await page.locator('.comp-cancel').click()
    await expect(page.getByText('Legacy campus update', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: TOPIC.title })).toBeVisible()
    await page.locator('.board-filters').getByRole('button', { name: 'Campus life', exact: true }).click()
    await expect(page.getByText('Legacy campus update', { exact: true })).toHaveCount(0)
    // All discussions searches from the top bar on phones and from the page header on desktop (HOME.3).
    const search = page.locator(width < 1024 ? '.sb-input input' : '.cx-search input')
    await search.fill('Quantum')
    await expect.poll(() => h.searches.length).toBeGreaterThan(0)
    expect(h.searches.at(-1)?.category_in).toBe('campus-life')
    await page.getByRole('heading', { name: TOPIC.title }).click()
    await expect(page).toHaveURL(new RegExp(`pages/post/index.*id=${TOPIC.id}`))
    await expect(page.locator('.post-topic-title')).toHaveText(TOPIC.title)
    await expect(page.locator('.post-board')).toHaveText('Campus life')
    await page.screenshot({ path: `test-results/visual/P2.10/board-link-${width}-light-en.png` })
    const searchesBeforeBoardLink = h.searches.length
    await page.locator('.post-board').click()
    // On H5 the board link opens that board's page, whose address names it (HOME.5).
    await expect(page).toHaveURL(/#\/pages\/plaza\/index\?board=campus-life$/)
    await expect(page.locator('.board-head').getByRole('heading', { level: 1 })).toHaveText('Campus life')
    // Desktop keeps the header search on every view; a phone board page has none.
    if (width >= 1024) await expect(search).toHaveValue('')
    else await expect(page.locator('.sb-input')).toHaveCount(0)
    await expect(page.getByText('Legacy campus update', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: TOPIC.title })).toBeVisible()
    // The board list was read without the earlier words: no further search request.
    expect(h.searches.length).toBe(searchesBeforeBoardLink)
  })
}

test('topic validates metadata before writing and sends the selected board', async ({ page }) => {
  const h = await fixture(page)
  await page.locator('.comp-cancel').click()
  await page.locator('.board-filters').getByRole('button', { name: 'Campus life', exact: true }).click()
  await page.getByRole('button', { name: 'New topic', exact: true }).filter({ visible: true }).click()
  const composer = page.locator('.composer-fullpage')
  await expect(composer.getByRole('button', { name: 'Topic', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(composer.getByRole('button', { name: 'Campus life', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.comp-textarea textarea').fill('Looking for a weekly study group')
  await page.locator('.comp-submit').click()
  await expect(composer.locator('.field-error')).toHaveText(['Add a title'])
  expect(h.writes).toHaveLength(0)
  await page.locator('.topic-title-input input').fill('Calculus study group')
  await expect(composer.locator('.field-error')).toHaveCount(0)
  await composer.getByRole('button', { name: 'Ask alumni', exact: true }).click()
  await page.locator('.comp-submit').click()
  await expect(composer).toHaveCount(0)
  expect(h.writes).toHaveLength(1)
  expect(h.writes[0]).toMatchObject({ title: 'Calculus study group', category: 'alumni-career', content: 'Looking for a weekly study group' })
  await expect(page).toHaveURL(new RegExp(`pages/post/index.*id=${h.writes[0].id}`))
  await expect(page.getByRole('heading', { name: 'Calculus study group' })).toBeVisible()
})

test('existing update entry publishes without topic metadata', async ({ page }) => {
  const h = await fixture(page)
  await page.locator('.comp-cancel').click()
  await page.locator('.board-filters').getByRole('button', { name: 'Campus life', exact: true }).click()
  await page.getByRole('button', { name: 'New topic', exact: true }).filter({ visible: true }).click()
  await page.locator('.composer-fullpage').getByRole('button', { name: 'Update', exact: true }).click()
  await expect(page.locator('.topic-title-input')).toHaveCount(0)
  await page.locator('.comp-textarea textarea').fill('A short campus update')
  await page.locator('.comp-submit').click()
  await expect(page.locator('.composer-fullpage')).toHaveCount(0)
  expect(h.writes[0]).toMatchObject({ title: null, category: null, content: 'A short campus update' })
  await expect(page).toHaveURL(new RegExp(`pages/post/index.*id=${h.writes[0].id}`))
  await expect(page.getByText('A short campus update', { exact: true })).toBeVisible()
})

test('topic is the default and missing fields are explained under each field, without a toast', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const h = await fixture(page, 'zh')
  const composer = page.locator('.composer-fullpage')
  await expect(composer.getByRole('button', { name: '话题', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const order = await composer.evaluate(root => ['.topic-board-options', '.topic-title-input', '.comp-textarea']
    .map(selector => root.querySelector(selector)!.getBoundingClientRect().top))
  expect(order).toEqual([...order].sort((a, b) => a - b))
  await page.locator('.comp-submit').click()
  await expect(composer.locator('.field-error')).toHaveText(['请选一个板块', '请填写标题', '请填写正文'])
  await expect(page.locator('.uni-toast')).toHaveCount(0)
  expect(h.writes).toHaveLength(0)
  await composer.getByRole('button', { name: '校园日常', exact: true }).click()
  await page.locator('.comp-textarea textarea').fill('想找人一起复习')
  await expect(composer.locator('.field-error')).toHaveText(['请填写标题'])
  // uni-h5 draws the placeholder as its own element, not the input's attribute.
  await expect(page.locator('.topic-title-input .uni-input-placeholder')).toHaveText('例如：CS 225 和 MATH 241 放同一学期会不会太累？')
  await page.locator('.comp-submit').click()
  await expect(page.locator('.topic-title-input input')).toBeFocused()
  await expect(page.locator('.uni-toast')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/visual/P2.4/composer-390-light-zh.png' })
  expect(h.writes).toHaveLength(0)
})

const RETRY_TITLE = 'Study together near Grainger this weekend, with calculus practice questions and a short break afterwards'
async function fillRetryTopic(page: Page) {
  const composer = page.locator('.composer-fullpage')
  await composer.getByRole('button', { name: 'Campus life', exact: true }).click()
  await page.locator('.topic-title-input input').fill(RETRY_TITLE)
  await expect(page.locator('.title-left')).toContainText(String(120 - RETRY_TITLE.length))
  await page.locator('.comp-textarea textarea').fill('Meet at the library')
  await expect(page.locator('.comp-count')).toContainText(String(2000 - 'Meet at the library'.length))
}

for (const width of [390, 1280]) {
  test(`unknown publish keeps its draft and checks the same id at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const h = await fixture(page)
    await fillRetryTopic(page)
    h.behavior.failPublish = true
    h.behavior.failRecovery = true
    await page.locator('.comp-submit').click()
    await expect(page.locator('.comp-submit')).toHaveText('Check whether it posted')
    await expect(page.locator('.composer-notice')).toContainText('Your text is still here.')
    expect(h.writes).toHaveLength(1)
    const postId = String(h.writes[0].id)
    await page.screenshot({ path: `test-results/visual/P2.8/unknown-${width}-light-en.png` })
    await page.locator('.comp-cancel').click()
    await expect(page.getByRole('button', { name: 'Keep draft', exact: true })).toBeVisible()
    await page.screenshot({ path: `test-results/visual/P2.8/draft-confirm-${width}-light-en.png` })
    await page.getByRole('button', { name: 'Keep draft', exact: true }).click()
    await expect(page.locator('.composer-fullpage')).toHaveCount(0)
    await page.getByRole('button', { name: 'New topic', exact: true }).filter({ visible: true }).click()
    await expect(page.locator('.composer-fullpage')).toContainText('Restored your unsent draft')
    await expect(page.locator('.topic-title-input input')).toHaveValue(RETRY_TITLE)
    await expect(page.locator('.comp-textarea textarea')).toHaveValue('Meet at the library')
    await expect(page.locator('.comp-submit')).toHaveText('Check whether it posted')
    h.behavior.failRecovery = false
    await page.locator('.comp-submit').click()
    await expect(page).toHaveURL(new RegExp(`pages/post/index.*id=${postId}`))
    expect(h.writes).toHaveLength(1)
    expect(await page.evaluate(() => localStorage.getItem('plaza_composer_draft_v1'))).toBeNull()
  })
}

test('an absent uncertain post can be sent again with the same id', async ({ page }) => {
  const h = await fixture(page)
  await fillRetryTopic(page)
  h.behavior.failPublish = true
  h.behavior.persistOnFailure = false
  await page.locator('.comp-submit').click()
  await expect(page.locator('.comp-submit')).toHaveText('Check whether it posted')
  const postId = String(h.writes[0].id)
  await page.locator('.comp-submit').click()
  await expect(page.locator('.composer-notice')).toContainText("It didn't post. You can send it again.")
  await expect(page.locator('.comp-submit')).toHaveText('Post')
  expect(h.writes).toHaveLength(1)
  h.behavior.failPublish = false
  await page.locator('.comp-submit').click()
  await expect(page).toHaveURL(new RegExp(`pages/post/index.*id=${postId}`))
  expect(h.writes).toHaveLength(2)
  expect(h.writes.map(write => write.id)).toEqual([postId, postId])
})

test('discarding a composer removes its saved draft and account changes remove it too', async ({ page }) => {
  await fixture(page)
  await fillRetryTopic(page)
  await page.locator('.comp-cancel').click()
  await page.getByRole('button', { name: 'Keep draft', exact: true }).click()
  await page.getByRole('button', { name: 'New topic', exact: true }).filter({ visible: true }).click()
  await expect(page.locator('.composer-fullpage')).toContainText('Restored your unsent draft')
  await page.locator('.comp-cancel').click()
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  expect(await page.evaluate(() => localStorage.getItem('plaza_composer_draft_v1'))).toBeNull()
  await page.getByRole('button', { name: 'New topic', exact: true }).filter({ visible: true }).click()
  await expect(page.locator('.topic-title-input input')).toHaveValue('')
  await fillRetryTopic(page)
  await page.locator('.comp-cancel').click()
  await page.getByRole('button', { name: 'Keep draft', exact: true }).click()
  await page.evaluate(ref => {
    const channel = new BroadcastChannel(`sb-${ref}-auth-token`)
    channel.postMessage({ event: 'SIGNED_OUT', session: null })
    channel.close()
  }, REF)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('plaza_composer_draft_v1'))).toBeNull()
})

for (const [lang, width] of [['en', 390], ['zh', 1280]] as const) {
  test(`publishing text and restriction date follow the current language in ${lang} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await fixture(page, lang)
    const composer = page.locator('.composer-fullpage')
    await composer.getByRole('button', { name: lang === 'zh' ? '动态' : 'Update', exact: true }).click()
    await page.locator('.comp-textarea textarea').fill('A campus update')
    let releasePost!: () => void
    const pendingPost = new Promise<void>(resolve => { releasePost = resolve })
    await page.route('**/rest/v1/posts?**', async route => {
      if (route.request().method() !== 'POST') return route.fallback()
      await pendingPost
      await route.fulfill({
        status: 400, contentType: 'application/json',
        body: JSON.stringify({ code: 'P0001', message: 'suspension_active:2:2026-12-03T12:34:56Z' }),
      })
    })
    await page.locator('.comp-submit').click()
    await expect(page.locator('.comp-submit')).toHaveText(lang === 'zh' ? '发布中…' : 'Posting…')
    await page.screenshot({ path: `test-results/visual/D45/publishing-${width}-${lang}.png` })
    releasePost()
    const date = await page.evaluate(lang => new Date('2026-12-03T12:34:56Z').toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US'), lang)
    await expect(page.locator('uni-toast')).toContainText(lang === 'zh'
      ? `账号受限期间不能发帖，${date} 恢复`
      : `You can't post while your account is restricted. Access returns ${date}.`)
    await expect(composer).toBeVisible()
    await expect(page.locator('.comp-submit')).toHaveText(lang === 'zh' ? '发布' : 'Post')
  })
}

for (const [lang, width] of [['en', 390], ['en', 1280], ['zh', 390]] as const) {
  for (const level of [0, 1, 2, 3, 4, 5]) {
    test(`L${level} retains the account gate before browsing or composing in ${lang} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      let writes = 0
      await openPlazaComposer(page, async () => {
        await page.route('**/rest/v1/posts?**', route => {
          if (route.request().method() !== 'GET') writes++
          // Topic rows open their detail page; only legacy updates have an inline reply sheet.
          const idFilter = new URL(route.request().url()).searchParams.get('id')
          const rows = [TOPIC, LEGACY].filter(post => !idFilter || idFilter === `eq.${post.id}`)
          const body = route.request().headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
        })
        await page.route('**/rest/v1/post_comments?**', route => {
          if (route.request().method() !== 'GET') writes++
          return route.fulfill({ contentType: 'application/json', body: '[]' })
        })
      }, lang, { open: false, level })

      if (level >= 2) {
        await expect(page).toHaveURL(/pages\/suspended\/index/)
        await expect(page.locator('.composer-fullpage')).toHaveCount(0)
        expect(writes).toBe(0)
        return
      }
      await expect(page).toHaveURL(/pages\/plaza\/index/)
      await expect(page.getByRole('heading', { name: TOPIC.title, exact: true })).toBeVisible()
      await expect(page.locator('.post-card')).toContainText(LEGACY.content)
      await page.locator('.post-card').getByRole('button', { name: lang === 'zh' ? '回复' : 'Reply', exact: true }).click()
      const sheet = page.locator('.comment-sheet')
      await expect(sheet).toBeVisible()
      await expect(sheet.locator('textarea')).toBeVisible()
      await sheet.locator('.as-close').click()
      await expect(sheet).toHaveCount(0)

      await page.getByRole('button', { name: lang === 'zh' ? '发话题' : 'New topic', exact: true }).filter({ visible: true }).click()
      await expect(page.locator('.composer-fullpage')).toBeVisible()
      await page.locator('.comp-cancel').click()
      await page.getByRole('heading', { name: TOPIC.title, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`pages/post/index.*id=${TOPIC.id}`))
      const input = page.locator('.input-wrapper')
      await expect(input.locator('input')).toBeVisible()
      expect(writes).toBe(0)
    })
  }
}
