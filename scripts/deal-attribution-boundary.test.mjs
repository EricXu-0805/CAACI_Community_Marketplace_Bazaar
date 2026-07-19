import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const ROOT = new URL('../', import.meta.url)
const source = path => readFile(new URL(path, ROOT), 'utf8')

test('sold state is backed by a private exact-offer attribution ledger', async () => {
  const migration = await source('supabase/migrations/20260718210000_deal_attributed_ratings.sql')

  assert.match(migration, /CREATE TABLE private\.item_deals/)
  assert.match(migration, /item_id uuid PRIMARY KEY[\s\S]*REFERENCES public\.items\(id\) ON DELETE CASCADE/)
  assert.match(migration, /offer_id uuid UNIQUE[\s\S]*ON DELETE SET NULL/)
  assert.match(migration, /ALTER TABLE private\.item_deals FORCE ROW LEVEL SECURITY/)
  assert.match(migration, /REVOKE ALL ON TABLE private\.item_deals[\s\S]*service_role/)
  assert.doesNotMatch(migration, /ALTER TABLE public\.items[\s\S]*ADD COLUMN[^;]*(sold_to|buyer_id|counterparty_id)/i)

  const markSold = migration.slice(
    migration.indexOf('CREATE FUNCTION public.mark_item_sold'),
    migration.indexOf('CREATE FUNCTION public.get_transaction_rating_eligibility'),
  )
  assert.match(markSold, /WHERE item\.id = p_item_id\s+FOR UPDATE/)
  assert.match(markSold, /selected_offer\.status <> 'accepted'/)
  assert.match(markSold, /selected_offer\.item_id IS DISTINCT FROM p_item_id/)
  assert.match(markSold, /selected_conversation\.item_id IS DISTINCT FROM p_item_id/)
  assert.match(markSold, /selected_offer\.updated_at > selected_offer\.expires_at/)
  assert.match(markSold, /caller_id NOT IN[\s\S]*buyer_id[\s\S]*seller_id/)
  assert.match(markSold, /counterparty_id := CASE[\s\S]*buyer_id = caller_id[\s\S]*seller_id[\s\S]*buyer_id/)
  assert.match(markSold, /status = 'cancelled'[\s\S]*open_offer\.status = 'pending'/)
  assert.match(markSold, /selected_item\.status = 'sold'[\s\S]*existing_deal\.offer_id = p_offer_id[\s\S]*RETURN selected_item/)
  assert.doesNotMatch(markSold, /INSERT INTO public\.notifications/i)
})

test('rating creation and deletion are RPC-only and bound to the two attributed parties', async () => {
  const migration = await source('supabase/migrations/20260718210000_deal_attributed_ratings.sql')
  const submit = migration.slice(
    migration.indexOf('CREATE FUNCTION public.submit_transaction_rating'),
    migration.indexOf('CREATE FUNCTION public.guard_item_sale_attribution'),
  )

  assert.match(submit, /INNER JOIN private\.item_deals/)
  assert.match(submit, /caller_id NOT IN \(deal_owner_id, deal_counterparty_id\)/)
  assert.match(submit, /p_ratee_id IS DISTINCT FROM expected_ratee_id/)
  assert.match(submit, /FOR UPDATE OF item/)
  assert.match(submit, /existing_rating\.stars = p_stars[\s\S]*RETURN existing_rating/)
  assert.match(submit, /rating_already_submitted/)
  assert.match(migration, /DROP POLICY IF EXISTS "Participants can rate sold items"/)
  assert.match(migration, /DROP POLICY IF EXISTS "Raters can delete own rating"/)
  assert.match(migration, /REVOKE INSERT \(rater_id, ratee_id, item_id, stars, comment\)/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.submit_transaction_rating[\s\S]*TO authenticated/)
})

test('frontend never guesses a deal from conversations or writes sold/ratings directly', async () => {
  const [items, ratings, detail, profile, chat, types] = await Promise.all([
    source('app/src/composables/useItems.ts'),
    source('app/src/composables/useRatings.ts'),
    source('app/src/pages/detail/index.vue'),
    source('app/src/pages/profile/index.vue'),
    source('app/src/components/ChatThread.vue'),
    source('app/src/types/index.ts'),
  ])

  assert.match(items, /status === 'sold'[^]*mark_item_sold_rpc_required/)
  assert.match(items, /rpc\('get_item_sale_candidates'/)
  assert.match(items, /rpc\('mark_item_sold'/)
  assert.match(ratings, /rpc\('get_transaction_rating_eligibility'/)
  assert.match(ratings, /rpc\('submit_transaction_rating'/)
  assert.doesNotMatch(ratings, /\.from\('ratings'\)\s*\.insert/)
  assert.doesNotMatch(`${detail}\n${profile}`, /updateItemStatus\([^)]*,\s*['"]sold['"]/)
  assert.doesNotMatch(detail, /from\('conversations'\)[^]*canRate\.value/)
  assert.match(detail, /ratingTargetId\.value = ratingEligibility\.ratee_id/)
  assert.match(chat, /entry\.offer\.status === 'accepted'[^]*confirmAcceptedOfferSale\(entry\.offer\)/)
  assert.match(types, /OfferStatus[^\n]*'cancelled'/)
})

test('privacy and operations copy cover attribution visibility, retention and deletion', async () => {
  const [en, zh, rights] = await Promise.all([
    source('app/src/legal/privacy.en.ts'),
    source('app/src/legal/privacy.zh.ts'),
    source('docs/admin/RIGHTS_AND_CONTENT_REQUESTS.md'),
  ])
  assert.match(en, /exact accepted offer[\s\S]*never added to the public listing row/)
  assert.match(en, /foreign-key deletion clears[\s\S]*no longer available for rating eligibility/)
  assert.match(zh, /准确的已接受报价[\s\S]*不会写入公开商品行/)
  assert.match(zh, /外键删除会清空[\s\S]*不再能被用于评价资格/)
  assert.match(rights, /authoritative private sale-attribution row/)
  assert.match(rights, /deleting only the counterparty[\s\S]*clear participant/)
})
