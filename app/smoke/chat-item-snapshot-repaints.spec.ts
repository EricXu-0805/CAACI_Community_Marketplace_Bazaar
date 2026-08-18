import { test, expect, type Page } from '@playwright/test'
import { supabaseRefForBuild } from './supabase-ref'

/**
 * The chat has to notice that the listing closed underneath it.
 *
 * The item is read once, when the thread opens, and written to `itemInfo`.
 * Offers and meetups each have realtime plus a poll behind them; the item has
 * neither, and the H5 foreground heal refreshed messages, offers and meetups
 * but not the conversation. So a listing the seller sold from another screen
 * left the buyer's thread showing a live price, a Make-an-Offer button and live
 * meetup buttons for as long as the thread stayed open.
 *
 * Every tap then hit `item_unavailable_for_offer` from the chat boundary
 * trigger (20260717141822:579), which no message table mapped — so it fell to
 * the machine-sentinel fallback and the student read "Something went wrong"
 * about a listing that was simply sold. Tapping again gave the same toast.
 *
 * The template already has the right closed state (`chat.itemClosed`, shown in
 * place of the buttons when `itemAllowsTransaction` is false). It just never
 * learned.
 */

const REF = supabaseRefForBuild()
const ME = '11111111-1111-4111-8111-111111111111'
const SELLER = '22222222-2222-4222-8222-222222222222'
const CONV = '33333333-3333-4333-8333-333333333333'
const ITEM = '44444444-4444-4444-8444-444444444444'
const GEN = 'chat-snapshot-generation-0001'

const ME_PROFILE = {
  id: ME, nickname: 'Me', avatar_url: null, tos_version: '2026-08-01',
  suspension_level: 0, suspended_until: null, is_illini_verified: true, bio: '', location: 'UIUC',
}
const SELLER_PROFILE = { id: SELLER, nickname: 'Seller', avatar_url: null }

function conversationRow(itemStatus: string) {
  return {
    id: CONV, item_id: ITEM, buyer_id: ME, seller_id: SELLER,
    last_message_at: '2026-08-18T00:00:00Z', created_at: '2026-08-18T00:00:00Z',
    is_pinned_buyer: false, is_pinned_seller: false, is_muted_buyer: false, is_muted_seller: false,
    item: {
      id: ITEM, title: 'Desk lamp', title_i18n: null, images: [], price: 15,
      status: itemStatus, negotiable: true, user_id: SELLER,
      category: 'other', listing_type: 'sell', location: 'UIUC',
    },
    buyer: ME_PROFILE, seller: SELLER_PROFILE,
  }
}

type Thread = { sellItem: (status: string) => void; failOfferWith: (message: string | null) => void }

async function openThread(page: Page): Promise<Thread> {
  let itemStatus = 'active'
  let offerFailure: string | null = null

  await page.addInitScript(([ref, uid, gen]) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
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
  }, [REF, ME, GEN] as const)

  await page.route('**/*.supabase.co/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname + url.search
    if (path.includes('/rpc/make_offer')) {
      if (offerFailure) {
        return route.fulfill({
          status: 400, contentType: 'application/json',
          body: JSON.stringify({ message: offerFailure, code: 'P0001' }),
        })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
    }
    let body: unknown = []
    if (path.includes('/rpc/get_my_profile')) body = ME_PROFILE
    else if (path.includes('/rest/v1/conversations')) body = conversationRow(itemStatus)
    else if (path.includes('/rest/v1/profiles')) body = [ME_PROFILE]
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/1' }, body: JSON.stringify(body),
    })
  })

  await page.goto(`/#/pages/chat/index?id=${CONV}`, { waitUntil: 'networkidle' })
  await expect(page.locator('.offer-btn').first()).toBeVisible({ timeout: 15_000 })

  return {
    sellItem: (status: string) => { itemStatus = status },
    failOfferWith: (message: string | null) => { offerFailure = message },
  }
}

async function submitAnOffer(page: Page) {
  await page.locator('.offer-btn').first().click()
  await expect(page.locator('.offer-sheet')).toBeVisible({ timeout: 5_000 })
  await page.locator('.offer-sheet input.uni-input-input').first().fill('12')
  await page.locator('.os-submit').first().click()
}

function toastText(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('uni-toast, .uni-toast')]
    .map(e => e.textContent!.trim()).filter(Boolean).join(' | '))
}

test('an offer refused because the listing closed says so, and the buttons go away', async ({ page }) => {
  const thread = await openThread(page)

  // The seller marks it sold from another screen. Nothing pushes that here.
  thread.sellItem('sold')
  thread.failOfferWith('item_unavailable_for_offer')

  await submitAnOffer(page)
  await page.waitForTimeout(2_000)

  const toast = await toastText(page)
  expect(toast, 'the student was told "something went wrong" about a listing that was simply sold')
    .not.toMatch(/went wrong|操作失败/i)
  expect(toast, 'the refusal does not mention the listing at all').toMatch(/closed|no longer available/i)

  // And the affordance repaints, so the next tap cannot fail the same way.
  await expect(page.locator('.offer-btn'), 'the Make-an-Offer button survived the listing it belongs to')
    .toHaveCount(0, { timeout: 5_000 })
})

test('an offer that fails for any other reason leaves the thread alone', async ({ page }) => {
  // The control. Without it, the assertions above are satisfied by a thread
  // that tears its own buttons down whenever anything at all goes wrong.
  const thread = await openThread(page)
  thread.failOfferWith('invalid price')

  await submitAnOffer(page)
  await page.waitForTimeout(2_000)

  expect(await toastText(page)).toMatch(/valid price/i)
  await expect(page.locator('.offer-btn').first(), 'an unrelated failure removed the offer button')
    .toBeVisible()
})
