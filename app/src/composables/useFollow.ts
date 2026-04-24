import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import type { Item } from '../types'

const following = ref<Set<string>>(new Set())
const followingLoaded = ref(false)

const PUBLIC_PROFILE_FIELDS_FULL = 'id, nickname, avatar_url, location, is_illini_verified, status_text, status_emoji'
const PUBLIC_PROFILE_FIELDS_LEGACY = 'id, nickname, avatar_url, location, is_illini_verified'
/*
 * Keep in sync with useItems.ts LIST_ITEM_FIELDS_FULL. The follow feed
 * renders the same card UI as the home feed, so it needs the same DB
 * columns: image_dimensions for slot-accurate aspect reservation
 * (migration 014) and title_i18n / description_i18n / source_lang for
 * the en↔zh switch (migration 015). Omitting them makes followed-seller
 * cards fall back to 4/5 aspect and untranslated titles — a subtle
 * regression that only shows up for users following foreign-language
 * sellers.
 */
const LIST_ITEM_FIELDS_FULL =
  'id, user_id, title, title_i18n, description_i18n, source_lang, price, category, condition, status, location, location_verified, images, image_dimensions, view_count, favorite_count, negotiable, created_at'
const LIST_ITEM_FIELDS_LEGACY =
  'id, user_id, title, price, category, condition, status, location, images, view_count, favorite_count, negotiable, created_at'

let followLocVerifiedAvailable = true
let followStatusAvailable = true

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
    const runQuery = () => {
      const fields = followLocVerifiedAvailable ? LIST_ITEM_FIELDS_FULL : LIST_ITEM_FIELDS_LEGACY
      const profileFields = followStatusAvailable ? PUBLIC_PROFILE_FIELDS_FULL : PUBLIC_PROFILE_FIELDS_LEGACY
      /*
       * Cast select() to any — same pattern as useItems.ts:101. The
       * wider field list added for image_dimensions + i18n crosses
       * supabase-js's discriminated-union inference ceiling (TS2590).
       * Type assertion at the return boundary (below) restores the
       * proper Item[] shape for callers.
       */
      return supabase
        .from('items')
        .select(`${fields}, profile:profiles(${profileFields})` as any)
        .in('user_id', ids)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)
    }
    let { data, error } = await runQuery()
    if (error?.code === '42703' && String(error.message || '').includes('location_verified')) {
      console.warn('[useFollow] items.location_verified missing — falling back (run migration 020)')
      followLocVerifiedAvailable = false
      ;({ data, error } = await runQuery())
    }
    if (error?.code === '42703' && /status_/.test(String(error.message || ''))) {
      console.warn('[useFollow] profiles.status_* missing — falling back (run migration 021)')
      followStatusAvailable = false
      ;({ data } = await runQuery())
    }
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
