import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import { captureException } from '../utils/sentry'
import type { Item } from '../types'

export interface FollowedProfile {
  id: string
  nickname: string | null
  avatar_url: string | null
  location: string | null
  is_illini_verified: boolean
  status_text: string | null
  status_emoji: string | null
}

const following = ref<Set<string>>(new Set())
const followingLoaded = ref(false)

/*
 * Keep in sync with useItems.ts. Both composables render the same card
 * UI; if you add a new column here, add it there too. The legacy
 * 014/015/020/021-fallback paths were retired in the 035-era cleanup
 * since every active database has these columns.
 */
const PUBLIC_PROFILE_FIELDS = 'id, nickname, avatar_url, location, is_illini_verified, status_text, status_emoji'
const LIST_ITEM_FIELDS =
  'id, user_id, title, title_i18n, description_i18n, source_lang, price, category, condition, status, listing_type, location, location_verified, images, image_dimensions, view_count, favorite_count, negotiable, created_at'

export function useFollow() {
  const { supabase } = useSupabase()
  const { currentUser } = useAuth()

  async function loadMyFollowing() {
    if (!currentUser.value) {
      following.value = new Set()
      followingLoaded.value = true
      return
    }
    const { data, error } = await supabase
      .from('follows')
      .select('followee_id')
      .eq('follower_id', currentUser.value.id)
    // A failed load otherwise reads as "you follow no one" (empty feed) with
    // no signal — capture it and keep the prior set instead of zeroing it.
    if (error) {
      console.error('Failed to load following:', error)
      captureException(error, { tags: { source: 'loadMyFollowing' } })
      return
    }
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
    /*
     * Cast select() to any — same TS2590 union-complexity workaround
     * documented in useItems.ts. Type assertion at the return boundary
     * below restores the proper Item[] shape for callers.
     */
    const { data, error } = await supabase
      .from('items')
      .select(`${LIST_ITEM_FIELDS}, profile:profiles(${PUBLIC_PROFILE_FIELDS})` as any)
      .in('user_id', ids)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1)
    if (error) throw error
    return (data || []) as unknown as Item[]
  }

  /*
   * The people you follow (not their listings). The 关注 surface shows
   * followed USERS — fetchFollowingFeed above is the items-from-followed
   * sellers query that drives the home "Following" feed; this is the
   * distinct "list of people" query. follows has two FKs to profiles, so
   * the embed must name the followee FK explicitly.
   */
  async function fetchFollowingProfiles(page: number = 0, pageSize: number = 30): Promise<FollowedProfile[]> {
    if (!currentUser.value) return []
    const { data, error } = await supabase
      .from('follows')
      .select(`created_at, followee:profiles!follows_followee_id_fkey(${PUBLIC_PROFILE_FIELDS})` as any)
      .eq('follower_id', currentUser.value.id)
      .order('created_at', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1)
    if (error) throw error
    return (data || []).map((r: any) => r.followee).filter(Boolean) as FollowedProfile[]
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
    fetchFollowingProfiles,
    followerCount,
    reset,
  }
}
