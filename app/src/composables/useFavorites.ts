import { ref } from 'vue'
import { useSupabase } from './useSupabase'

const favoriteIds = ref<Set<string>>(new Set())
const loading = ref(false)

export function useFavorites() {
  const { supabase } = useSupabase()

  async function loadMyFavorites(userId: string) {
    const { data } = await supabase
      .from('favorites')
      .select('item_id')
      .eq('user_id', userId)

    if (data) {
      favoriteIds.value = new Set(data.map((f: { item_id: string }) => f.item_id))
    }
  }

  function isFavorited(itemId: string): boolean {
    return favoriteIds.value.has(itemId)
  }

  async function toggleFavorite(userId: string, itemId: string): Promise<boolean> {
    if (loading.value) return isFavorited(itemId)
    loading.value = true

    try {
      if (isFavorited(itemId)) {
        const { error } = await supabase
          .from('favorites')
          .delete()
          .eq('user_id', userId)
          .eq('item_id', itemId)
        if (error) throw error
        favoriteIds.value.delete(itemId)
        return false
      } else {
        const { error } = await supabase
          .from('favorites')
          .insert({ user_id: userId, item_id: itemId })
        if (error && error.code !== '23505') throw error
        favoriteIds.value.add(itemId)
        return true
      }
    } catch (error) {
      console.error('Failed to toggle favorite:', error)
      uni.showToast({ title: 'Failed, please try again', icon: 'none' })
      return isFavorited(itemId)
    } finally {
      loading.value = false
    }
  }

  async function getFavoriteCount(itemId: string): Promise<number> {
    const { count, error } = await supabase
      .from('favorites')
      .select('*', { count: 'exact', head: true })
      .eq('item_id', itemId)

    if (error) return 0
    return count || 0
  }

  async function fetchMyFavoriteItems(userId: string) {
    const { data } = await supabase
      .from('favorites')
      .select('item_id, item:items(*, profile:profiles(id, nickname, avatar_url, location))')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (!data) return []
    return data
      .map((f: any) => f.item)
      .filter(Boolean) as import('../types').Item[]
  }

  return {
    favoriteIds,
    loading,
    loadMyFavorites,
    isFavorited,
    toggleFavorite,
    getFavoriteCount,
    fetchMyFavoriteItems,
  }
}
