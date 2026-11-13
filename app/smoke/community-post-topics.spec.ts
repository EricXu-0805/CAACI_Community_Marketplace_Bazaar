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

async function openPlazaComposer(page: Page, install: () => Promise<void>, lang: 'en' | 'zh' = 'en') {
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
    const body = route.request().url().includes('/rpc/get_my_profile') ? PROFILE : []
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/1' }, body: JSON.stringify(body),
    })
  })

  await install()
  await page.goto('/#/pages/plaza/index', { waitUntil: 'networkidle' })
  await expect(page.locator('[data-test=region-switcher]')).toHaveCount(0)
  await expect(page.locator('[data-test=region-label]').first()).toHaveText(/^(Champaign-Urbana|香槟)$/)
  await page.getByRole('button', { name: lang === 'zh' ? '发布新帖' : 'New post', exact: true }).filter({ visible: true }).click({ timeout: 15_000 })
  await expect(page.locator('.comp-attach-btn').first()).toBeVisible({ timeout: 10_000 })
}


const LEGACY = { id: '22222222-2222-4222-8222-222222222222', user_id: UID, content: 'Legacy campus update', title: null, category: null,
  images: [], like_count: 0, comment_count: 0, created_at: '2026-11-01T00:00:00Z', profile: PROFILE, status: 'active' }
const TOPIC = { ...LEGACY, id: '33333333-3333-4333-8333-333333333333', title: 'Quantum study group', category: 'campus-life', content: 'Meet at the library' }

async function fixture(page: Page, lang: 'en' | 'zh' = 'en') {
  const writes: Record<string, unknown>[] = [], searches: Record<string, unknown>[] = []
  const posts = [TOPIC, LEGACY]
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
        const post = { ...LEGACY, ...payload, id: '44444444-4444-4444-8444-444444444444' }; posts.unshift(post); body = post
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
  return { writes, searches }
}

test('legacy rows, board filtering, title search and topic detail coexist', async ({ page }) => {
  const h = await fixture(page)
  await page.locator('.comp-cancel').click()
  await expect(page.getByText('Legacy campus update', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: TOPIC.title })).toBeVisible()
  await page.locator('.board-filters').getByRole('button', { name: 'Campus life', exact: true }).click()
  await expect(page.getByText('Legacy campus update', { exact: true })).toHaveCount(0)
  await page.locator('.sb-input input').fill('Quantum')
  await expect.poll(() => h.searches.length).toBeGreaterThan(0)
  expect(h.searches.at(-1)?.category_in).toBe('campus-life')
  await page.getByRole('heading', { name: TOPIC.title }).click()
  await expect(page).toHaveURL(new RegExp(`pages/post/index.*id=${TOPIC.id}`))
  await expect(page.locator('.post-topic-title')).toHaveText(TOPIC.title)
  await expect(page.locator('.post-board')).toHaveText('Campus life')
})

test('topic validates metadata before writing and sends the selected board', async ({ page }) => {
  const h = await fixture(page)
  await page.locator('.comp-cancel').click()
  await page.locator('.board-filters').getByRole('button', { name: 'Campus life', exact: true }).click()
  await page.getByRole('button', { name: 'New post', exact: true }).filter({ visible: true }).click()
  const composer = page.locator('.composer-fullpage')
  await expect(composer.getByRole('button', { name: 'Topic', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(composer.getByRole('button', { name: 'Campus life', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.comp-textarea textarea').fill('Looking for a weekly study group')
  await page.locator('.comp-submit').click()
  await expect(composer.locator('.field-error')).toHaveText(['Add a title'])
  expect(h.writes).toHaveLength(0)
  await page.locator('.topic-title-input input').fill('Calculus study group')
  await composer.getByRole('button', { name: 'Ask alumni', exact: true }).click()
  await page.locator('.comp-submit').click()
  await expect(composer).toHaveCount(0)
  expect(h.writes).toHaveLength(1)
  expect(h.writes[0]).toMatchObject({ title: 'Calculus study group', category: 'alumni-career', content: 'Looking for a weekly study group' })
  await expect(page).toHaveURL(/pages\/post\/index.*id=44444444/);
  await expect(page.getByRole('heading', { name: 'Calculus study group' })).toBeVisible()
})

test('existing update entry publishes without topic metadata', async ({ page }) => {
  const h = await fixture(page)
  await page.locator('.comp-cancel').click()
  await page.locator('.board-filters').getByRole('button', { name: 'Campus life', exact: true }).click()
  await page.getByRole('button', { name: 'New post', exact: true }).filter({ visible: true }).click()
  await page.locator('.composer-fullpage').getByRole('button', { name: 'Update', exact: true }).click()
  await expect(page.locator('.topic-title-input')).toHaveCount(0)
  await page.locator('.comp-textarea textarea').fill('A short campus update')
  await page.locator('.comp-submit').click()
  await expect(page.locator('.composer-fullpage')).toHaveCount(0)
  expect(h.writes[0]).toMatchObject({ title: null, category: null, content: 'A short campus update' })
  await expect(page).toHaveURL(/pages\/post\/index.*id=44444444/)
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
