import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import type { ItemCategory } from '../types'
import {
  captureAccountRequest,
  getActiveAccountId,
  isAccountRequestCurrent,
  onAccountTransition,
} from './accountScope'

export type SavedSearchListingType = 'sell' | 'wanted' | 'both'

export interface SavedSearch {
  id: string
  user_id: string
  keyword: string
  category: ItemCategory | null
  listing_type: SavedSearchListingType
  price_min: number | null
  price_max: number | null
  created_at: string
  last_notified_at: string | null
}

const SAVED_SEARCH_FIELDS = 'id, user_id, keyword, category, listing_type, price_min, price_max, created_at, last_notified_at'

const items = ref<SavedSearch[]>([])
const loaded = ref(false)

function resetSavedSearchState() {
  items.value = []
  loaded.value = false
}

onAccountTransition(resetSavedSearchState)

export function useSavedSearch() {
  const { supabase } = useSupabase()
  const { currentUser } = useAuth()

  async function fetchMine(): Promise<SavedSearch[]> {
    if (!currentUser.value) {
      if (!getActiveAccountId()) resetSavedSearchState()
      return []
    }
    const uid = currentUser.value.id
    const token = captureAccountRequest(uid)
    if (!isAccountRequestCurrent(token)) return []
    const { data, error } = await supabase
      .from('saved_searches')
      .select(SAVED_SEARCH_FIELDS)
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
    if (!isAccountRequestCurrent(token)) return []
    if (error) throw error
    items.value = (data || []) as SavedSearch[]
    loaded.value = true
    return items.value
  }

  async function create(input: {
    keyword: string
    category?: ItemCategory | null
    listingType?: SavedSearchListingType
    priceMin?: number | null
    priceMax?: number | null
  }): Promise<SavedSearch> {
    if (!currentUser.value) throw new Error('Not authenticated')
    const keyword = input.keyword.trim()
    const priceMin = input.priceMin ?? null
    const priceMax = input.priceMax ?? null
    if (!keyword || keyword.length > 60) throw new Error('invalid_saved_search_keyword')
    if ((priceMin !== null && (!Number.isFinite(priceMin) || priceMin < 0))
      || (priceMax !== null && (!Number.isFinite(priceMax) || priceMax < 0))) {
      throw new Error('invalid_saved_search_price')
    }
    if (priceMin !== null && priceMax !== null && priceMin > priceMax) {
      throw new Error('invalid_saved_search_price_range')
    }
    const uid = currentUser.value.id
    const token = captureAccountRequest(uid)
    if (!isAccountRequestCurrent(token)) throw new Error('Authentication changed')
    const { data, error } = await supabase
      .from('saved_searches')
      .insert({
        user_id: uid,
        keyword,
        category: input.category ?? null,
        listing_type: input.listingType ?? 'sell',
        price_min: priceMin,
        price_max: priceMax,
      })
      .select()
      .single()
    if (!isAccountRequestCurrent(token)) throw new Error('Authentication changed')
    if (error) throw error
    const row = data as SavedSearch
    items.value = [row, ...items.value]
    return row
  }

  async function remove(id: string) {
    if (!currentUser.value) throw new Error('Not authenticated')
    const token = captureAccountRequest(currentUser.value.id)
    if (!isAccountRequestCurrent(token)) throw new Error('Not authenticated')
    const { error } = await supabase
      .from('saved_searches')
      .delete()
      .eq('id', id)
      .eq('user_id', token.userId)
    if (!isAccountRequestCurrent(token)) return
    if (error) throw error
    items.value = items.value.filter(s => s.id !== id)
  }

  function reset() {
    resetSavedSearchState()
  }

  return { items, loaded, fetchMine, create, remove, reset }
}
