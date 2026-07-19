import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { useI18n } from './useI18n'
import { captureException } from '../utils/sentry'
import {
  captureAccountRequest,
  isAccountRequestCurrent,
  onAccountTransition,
} from './accountScope'

const favoriteIds = ref<Set<string>>(new Set())
const loading = ref(false)

function resetFavoriteState() {
  favoriteIds.value = new Set()
  loading.value = false
}

onAccountTransition(resetFavoriteState)

export function useFavorites() {
  const { supabase } = useSupabase()
  const { t } = useI18n()

  async function loadMyFavorites(userId: string) {
    const token = captureAccountRequest(userId)
    if (!isAccountRequestCurrent(token)) return
    const { data, error } = await supabase
      .from('favorites')
      .select('item_id')
      .eq('user_id', userId)

    // Don't let a failed load masquerade as "nothing favorited" silently:
    // capture it (so it's visible in Sentry/console) and keep the prior set
    // rather than overwriting it with an empty one.
    if (error) {
      if (!isAccountRequestCurrent(token)) return
      console.error('[favorites] load failed')
      captureException(error, { tags: { source: 'loadMyFavorites' } })
      return
    }
    if (data && isAccountRequestCurrent(token)) {
      favoriteIds.value = new Set(data.map((f: { item_id: string }) => f.item_id))
    }
  }

  function isFavorited(itemId: string): boolean {
    return favoriteIds.value.has(itemId)
  }

  async function toggleFavorite(userId: string, itemId: string): Promise<{ ok: boolean; favorited: boolean }> {
    const token = captureAccountRequest(userId)
    if (!isAccountRequestCurrent(token)) return { ok: false, favorited: false }
    if (loading.value) return { ok: false, favorited: isFavorited(itemId) }
    loading.value = true

    try {
      if (isFavorited(itemId)) {
        const { error } = await supabase
          .from('favorites')
          .delete()
          .eq('user_id', userId)
          .eq('item_id', itemId)
        if (error) throw error
        if (!isAccountRequestCurrent(token)) return { ok: false, favorited: false }
        favoriteIds.value.delete(itemId)
        return { ok: true, favorited: false }
      } else {
        const { error } = await supabase
          .from('favorites')
          .insert({ user_id: userId, item_id: itemId })
        if (error && error.code !== '23505') throw error
        if (!isAccountRequestCurrent(token)) return { ok: false, favorited: false }
        favoriteIds.value.add(itemId)
        return { ok: true, favorited: true }
      }
    } catch (error) {
      if (!isAccountRequestCurrent(token)) return { ok: false, favorited: false }
      console.error('[favorites] toggle failed')
      uni.showToast({ title: t('error.actionFailed'), icon: 'none' })
      return { ok: false, favorited: isFavorited(itemId) }
    } finally {
      if (isAccountRequestCurrent(token)) loading.value = false
    }
  }

  async function fetchMyFavoriteItems(userId: string) {
    const token = captureAccountRequest(userId)
    if (!isAccountRequestCurrent(token)) return []
    const { data, error } = await supabase
      .from('favorites')
      .select('item_id, item:items(id, user_id, title, price, category, condition, status, listing_type, location, images, image_dimensions, view_count, favorite_count, negotiable, created_at, profile:profiles(id, nickname, avatar_url, location))')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (!isAccountRequestCurrent(token)) return []
    if (error) throw error
    if (!data) return []
    return data
      .map((f: any) => f.item)
      .filter(Boolean) as import('../types').Item[]
  }

  function reset() {
    resetFavoriteState()
  }

  return {
    favoriteIds,
    loading,
    loadMyFavorites,
    isFavorited,
    toggleFavorite,
    fetchMyFavoriteItems,
    reset,
  }
}
