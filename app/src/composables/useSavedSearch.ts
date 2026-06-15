import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import type { ItemCategory } from '../types'

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

export function useSavedSearch() {
  const { supabase } = useSupabase()
  const { currentUser } = useAuth()

  async function fetchMine(): Promise<SavedSearch[]> {
    if (!currentUser.value) { items.value = []; loaded.value = true; return [] }
    const { data, error } = await supabase
      .from('saved_searches')
      .select(SAVED_SEARCH_FIELDS)
      .eq('user_id', currentUser.value.id)
      .order('created_at', { ascending: false })
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
    const { data, error } = await supabase
      .from('saved_searches')
      .insert({
        user_id: currentUser.value.id,
        keyword: input.keyword.trim(),
        category: input.category ?? null,
        listing_type: input.listingType ?? 'sell',
        price_min: input.priceMin ?? null,
        price_max: input.priceMax ?? null,
      })
      .select()
      .single()
    if (error) throw error
    const row = data as SavedSearch
    items.value = [row, ...items.value]
    return row
  }

  async function remove(id: string) {
    const { error } = await supabase
      .from('saved_searches')
      .delete()
      .eq('id', id)
    if (error) throw error
    items.value = items.value.filter(s => s.id !== id)
  }

  function reset() {
    items.value = []
    loaded.value = false
  }

  return { items, loaded, fetchMine, create, remove, reset }
}
