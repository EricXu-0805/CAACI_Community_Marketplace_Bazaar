import { test, expect } from '@playwright/test'
import { supabaseRefForBuild } from './supabase-ref'
import en from '../src/composables/i18n/messages/en'
import zh from '../src/composables/i18n/messages/zh'
import { CURRENT_CONSENT_VERSION } from '../src/legal'

/**
 * A notification headline is written by a database trigger, which cannot know
 * which language the person who opens the app reads. Every trigger up to
 * 20260903070000 solved that by writing both — '报价被接受 · Offer accepted' —
 * and the page printed the column as it stood, so a Chinese reader read the
 * English half and an English reader read the Chinese half, on every row.
 *
 * The two lines around it were already localized (the type chip through
 * notificationTypeLabelKey, the body through notificationBodyText), which is
 * why this was only ever visible in the middle line.
 *
 * The proof has to be the rendered page: the helper can be perfect while the
 * template still interpolates the raw column.
 */

const REF = supabaseRefForBuild()
const UID = '11111111-1111-4111-8111-111111111111'
const GEN = 'notification-title-generation-1'
const ROUTE = 'pages/notifications/index'

const PROFILE = {
  id: UID, nickname: 'Test User', avatar_url: null, tos_version: CURRENT_CONSENT_VERSION,
  suspension_level: 0, suspended_until: null, is_illini_verified: true, bio: '', location: 'UIUC',
}

/*
 * One row per shape this column has: a legacy bilingual literal (which is
 * every fixed-copy row in production today), a sentinel written by
 * 20260903090000, and a title that is user content — notify_item_sold (065)
 * stores the item's own title, so a lookup that rewrote what it did not
 * recognise would erase a real listing name.
 */
const LISTING_TITLE = 'IKEA 书桌 desk'
const ROWS = [
  { id: 'n1', user_id: UID, type: 'offer', title: '报价被接受 · Offer accepted',
    body: '$25.00', item_id: null, conversation_id: null, is_read: false,
    created_at: '2026-09-03T12:00:00Z' },
  { id: 'n2', user_id: UID, type: 'system', title: 'report_resolved',
    body: 'report_outcome_resolved', item_id: null, conversation_id: null, is_read: true,
    created_at: '2026-09-03T11:00:00Z' },
  { id: 'n3', user_id: UID, type: 'sold', title: LISTING_TITLE,
    body: '$30.00', item_id: null, conversation_id: null, is_read: true,
    created_at: '2026-09-03T10:00:00Z' },
  /*
   * The one body shape #317 could not cover: seed_digest_reminders writes the
   * count into a bilingual sentence, so it can never be a sentinel key. Two of
   * these are on production right now. Both counts are here because English
   * needs plural agreement and a single-count fixture would not notice.
   */
  { id: 'n4', user_id: UID, type: 'unread_message', title: '未读消息 · Unread messages',
    body: '你有 2 条未读消息 · 2 unread messages', item_id: null, conversation_id: null,
    is_read: true, created_at: '2026-09-03T09:00:00Z' },
  { id: 'n5', user_id: UID, type: 'unread_message', title: '未读消息 · Unread messages',
    body: '你有 1 条未读消息 · 1 unread message', item_id: null, conversation_id: null,
    is_read: true, created_at: '2026-09-03T08:00:00Z' },
]

const EXPECTED: Record<'en' | 'zh', string[]> = {
  en: [en['notif.titleOfferAccepted'], en['notif.titleReportResolved'], LISTING_TITLE,
    en['notif.titleUnreadMessages'], en['notif.titleUnreadMessages']],
  zh: [zh['notif.titleOfferAccepted'], zh['notif.titleReportResolved'], LISTING_TITLE,
    zh['notif.titleUnreadMessages'], zh['notif.titleUnreadMessages']],
}

/* Plural agreement is the reason both counts are in the fixture. */
function unreadBody(language: 'en' | 'zh', count: number): string {
  const raw = (language === 'en' ? en : zh)['notif.unreadMessages']
  const pipe = raw.indexOf('|')
  const form = pipe === -1 ? raw : count === 1 ? raw.slice(0, pipe) : raw.slice(pipe + 1)
  return form.replace('{count}', String(count))
}

for (const lang of ['en', 'zh'] as const) {
  test(`a ${lang} reader sees notification headlines in ${lang} only`, async ({ page }) => {
    await page.addInitScript(([ref, uid, gen, language]) => {
      localStorage.setItem('welcomed', '1')
      localStorage.setItem('lang', language)
      localStorage.setItem('theme_pref', 'light')
      localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
        tag: 'caaci-auth-value-v2', generation: gen,
        value: JSON.stringify({
          access_token: 'stub', token_type: 'bearer', expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub',
          user: { id: uid, email: 'a@illinois.edu', aud: 'authenticated', role: 'authenticated' },
        }),
      }))
      localStorage.setItem(
        `sb-${ref}-auth-token-auth-boundary-v2`,
        JSON.stringify({ v: 2, mode: 'allowed', generation: gen }),
      )
    }, [REF, UID, GEN, lang] as const)

    await page.route('**/*.supabase.co/**', async (route) => {
      const url = decodeURIComponent(route.request().url())
      const fixture = url.includes('/rpc/get_my_profile')
        ? PROFILE
        : url.includes('/notifications')
          ? (url.includes('is_read=eq.false') ? [{ id: 'n1' }] : ROWS)
          : []
      // PostgREST answers .single() with the object itself, not a one-row array.
      const wantsObject = (route.request().headers()['accept'] || '')
        .includes('vnd.pgrst.object+json')
      const body = wantsObject && Array.isArray(fixture) ? (fixture[0] ?? null) : fixture
      await route.fulfill({
        status: 200, contentType: 'application/json',
        headers: { 'content-range': '0-4/5' }, body: JSON.stringify(body),
      })
    })

    await page.goto(`/#/${ROUTE}`, { waitUntil: 'domcontentloaded' })
    const titles = page.locator(`uni-page[data-page="${ROUTE}"] .notif-title`)
    await expect(titles).toHaveText(EXPECTED[lang], { timeout: 60_000 })

    const rendered = await titles.allInnerTexts()
    // The bilingual literal joins its two halves with ' · '. Whatever else a
    // headline ends up saying, it must not be saying it twice.
    for (const title of rendered) {
      expect(title, `two languages in one headline: ${title}`).not.toContain(' · ')
    }
    // Controls on the lookup itself: a sentinel must never reach a reader, and
    // the other language's wording must not be on screen either.
    const other = lang === 'en' ? zh : en
    expect(rendered.join('\n')).not.toContain('report_resolved')
    expect(rendered.join('\n')).not.toContain(other['notif.titleOfferAccepted'])

    /*
     * The body under the headline. A localized headline over a half-Chinese,
     * half-English line is the shape this whole file exists to prevent, and
     * the unread-count body was the last one still doing it.
     */
    const bodies = page.locator(`uni-page[data-page="${ROUTE}"] .notif-body`)
    const renderedBodies = (await bodies.allInnerTexts()).map(value => (value || '').trim())
    expect(renderedBodies, `two languages in one body:\n${renderedBodies.join('\n')}`)
      .not.toContain('你有 2 条未读消息 · 2 unread messages')
    expect(renderedBodies).toContain(unreadBody(lang, 2))
    expect(renderedBodies).toContain(unreadBody(lang, 1))
    for (const body of renderedBodies) {
      expect(body, `two languages in one body: ${body}`).not.toContain(' · ')
    }
  })
}
