import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import { useModeration } from './useModeration'
import { captureException } from '../utils/sentry'
import type { Item } from '../types'
import {
  captureAccountRequest,
  getActiveAccountId,
  isAccountRequestCurrent,
  onAccountTransition,
} from './accountScope'

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

function resetFollowingState() {
  following.value = new Set()
  followingLoaded.value = false
}

onAccountTransition(resetFollowingState)

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
  const moderation = useModeration()

  async function requireModerationSnapshot() {
    const gate = await moderation.ensureLoaded()
    if (!gate.ok) throw new Error('moderation_gate_unavailable')
  }

  async function loadMyFollowing() {
    if (!currentUser.value) {
      if (!getActiveAccountId()) resetFollowingState()
      return
    }
    const uid = currentUser.value.id
    const token = captureAccountRequest(uid)
    if (!isAccountRequestCurrent(token)) return
    const { data, error } = await supabase
      .from('follows')
      .select('followee_id')
      .eq('follower_id', uid)
    // A failed load otherwise reads as "you follow no one" (empty feed) with
    // no signal — capture it and keep the prior set instead of zeroing it.
    if (error) {
      if (!isAccountRequestCurrent(token)) return
      console.error('[follow] load failed')
      captureException(error, { tags: { source: 'loadMyFollowing' } })
      return
    }
    if (isAccountRequestCurrent(token)) {
      following.value = new Set((data || []).map((f: { followee_id: string }) => f.followee_id))
      followingLoaded.value = true
    }
  }

  function isFollowing(sellerId: string): boolean {
    return following.value.has(sellerId)
  }

  async function toggleFollow(sellerId: string): Promise<boolean> {
    if (!currentUser.value) throw new Error('Not authenticated')
    const uid = currentUser.value.id
    const token = captureAccountRequest(uid)
    if (!isAccountRequestCurrent(token)) throw new Error('Authentication changed')
    if (sellerId === uid) throw new Error('Cannot follow yourself')
    await requireModerationSnapshot()
    if (!isAccountRequestCurrent(token)) throw new Error('Authentication changed')
    if (moderation.blockedIds.value.has(sellerId)) throw new Error('moderation_gate_unavailable')
    if (isFollowing(sellerId)) {
      const { error } = await supabase
        .from('follows')
        .delete()
        .eq('follower_id', uid)
        .eq('followee_id', sellerId)
      if (!isAccountRequestCurrent(token)) return false
      if (error) throw error
      following.value.delete(sellerId)
      return false
    } else {
      const { error } = await supabase
        .from('follows')
        .insert({ follower_id: uid, followee_id: sellerId })
      if (!isAccountRequestCurrent(token)) return false
      if (error && error.code !== '23505') throw error
      following.value.add(sellerId)
      return true
    }
  }

  async function fetchFollowingFeed(page: number = 0, pageSize: number = 20): Promise<Item[]> {
    if (!currentUser.value) return []
    const uid = currentUser.value.id
    const token = captureAccountRequest(uid)
    if (!isAccountRequestCurrent(token)) return []
    await requireModerationSnapshot()
    if (!isAccountRequestCurrent(token)) return []
    if (following.value.size === 0) {
      if (!followingLoaded.value) await loadMyFollowing()
      if (!isAccountRequestCurrent(token)) return []
      if (following.value.size === 0) return []
    }
    const ids = Array.from(following.value).filter(id => !moderation.blockedIds.value.has(id))
    if (ids.length === 0) return []
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
    if (!isAccountRequestCurrent(token)) return []
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
    const uid = currentUser.value.id
    const token = captureAccountRequest(uid)
    if (!isAccountRequestCurrent(token)) return []
    await requireModerationSnapshot()
    if (!isAccountRequestCurrent(token)) return []
    let query = supabase
      .from('follows')
      .select(`created_at, followee_id, followee:profiles!follows_followee_id_fkey(${PUBLIC_PROFILE_FIELDS})` as any)
      .eq('follower_id', uid)
      .order('created_at', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1)
    if (moderation.blockedIds.value.size > 0) {
      query = query.not('followee_id', 'in', `(${Array.from(moderation.blockedIds.value).join(',')})`)
    }
    const { data, error } = await query
    if (!isAccountRequestCurrent(token)) return []
    if (error) throw error
    return (data || [])
      .map((r: any) => r.followee)
      .filter((profile: FollowedProfile | null) => !!profile && !moderation.blockedIds.value.has(profile.id)) as FollowedProfile[]
  }

  async function followerCount(userId: string): Promise<number> {
    const { count } = await supabase
      .from('follows')
      .select('followee_id', { count: 'estimated', head: true })
      .eq('followee_id', userId)
    return count || 0
  }

  function reset() {
    resetFollowingState()
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
