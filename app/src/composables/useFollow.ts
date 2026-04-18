import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import type { Item } from '../types'

const following = ref<Set<string>>(new Set())
const followingLoaded = ref(false)

const PUBLIC_PROFILE_FIELDS = 'id, nickname, avatar_url, location, is_illini_verified'
const LIST_ITEM_FIELDS =
  'id, user_id, title, price, category, condition, status, location, images, view_count, favorite_count, negotiable, created_at'

export function useFollow() {
  const { supabase } = useSupabase()
  const { currentUser } = useAuth()

  async function loadMyFollowing() {
    if (!currentUser.value) {
      following.value = new Set()
      followingLoaded.value = true
      return
    }
    const { data } = await supabase
      .from('follows')
      .select('followee_id')
      .eq('follower_id', currentUser.value.id)
    following.value = new Set((data || []).map((f: { followee_id: string }) => f.followee_id))
    followingLoaded.value = true
  }

  function isFollowing(sellerId: string): boolean {
    return following.value.has(sellerId)
  }

  async function toggleFollow(sellerId: string): Promise<boolean> {
    if (!currentUser.value) throw new Error('Not authenticated')
    if (sellerId === currentUser.value.id) throw new Error('Cannot follow yourself')
    if (isFollowing(sellerId)) {
      const { error } = await supabase
        .from('follows')
        .delete()
        .eq('follower_id', currentUser.value.id)
        .eq('followee_id', sellerId)
      if (error) throw error
      following.value.delete(sellerId)
      return false
    } else {
      const { error } = await supabase
        .from('follows')
        .insert({ follower_id: currentUser.value.id, followee_id: sellerId })
      if (error && error.code !== '23505') throw error
      following.value.add(sellerId)
      return true
    }
  }

  async function fetchFollowingFeed(page: number = 0, pageSize: number = 20): Promise<Item[]> {
    if (!currentUser.value) return []
    if (following.value.size === 0) {
      if (!followingLoaded.value) await loadMyFollowing()
      if (following.value.size === 0) return []
    }
    const ids = Array.from(following.value)
    const { data } = await supabase
      .from('items')
      .select(`${LIST_ITEM_FIELDS}, profile:profiles(${PUBLIC_PROFILE_FIELDS})`)
      .in('user_id', ids)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1)
    return (data || []) as unknown as Item[]
  }

  async function followerCount(userId: string): Promise<number> {
    const { count } = await supabase
      .from('follows')
      .select('*', { count: 'estimated', head: true })
      .eq('followee_id', userId)
    return count || 0
  }

  function reset() {
    following.value = new Set()
    followingLoaded.value = false
  }

  return {
    following,
    followingLoaded,
    loadMyFollowing,
    isFollowing,
    toggleFollow,
    fetchFollowingFeed,
    followerCount,
    reset,
  }
}
