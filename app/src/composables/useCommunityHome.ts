import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import { useModeration } from './useModeration'
import type { Item, Profile } from '../types'
import type { HomeItem, HomePost, HomePostData } from '../utils/communityHome'
import { POST_CATEGORIES, type PostCategory } from '../utils/communityPost'
import { ACTIVE_REGION } from '../utils/region'
import { sanitizeItemResources } from '../utils/publicResource'

/** A home row: what buildHomeSections reads, plus the author the latest list names. */
export type CommunityHomePost = HomePost & { profile?: Pick<Profile, 'id' | 'nickname' | 'avatar_url'> | null }
export type CommunityHomeItem = HomeItem & Pick<Item, 'user_id' | 'title_i18n' | 'listing_type' | 'listing_details'>
export interface CommunityHomeData {
  posts: HomePostData
  items: CommunityHomeItem[]
  /** When the snapshot was read; relative times are worded against it. */
  now: number
}

const WEEK = 7 * 86_400_000
// Titles only: the home shows no body text and no post images (SPEC 5.4).
const HOME_POST_SELECT = 'id, user_id, title, category, is_official, is_pinned, comment_count, status, created_at, profile:profiles!posts_user_id_fkey(id, nickname, avatar_url)'
const HOME_ITEM_FIELDS = 'id, user_id, title, title_i18n, price, images, status, listing_type, listing_details, created_at'

/**
 * Reads for the community home (ENGINEERING §7). The requests run together and
 * the result is handed to buildHomeSections, which alone decides what each
 * block shows. Every community query names the active region.
 */
export function useCommunityHome() {
  const { supabase } = useSupabase()
  const { currentUser } = useAuth()
  const moderation = useModeration()
  const homeData = ref<CommunityHomeData | null>(null)
  const homeLoading = ref(false)
  const homeFailed = ref(false)
  let latestRequest = 0

  // Requests 1–6: one feed per board, and one across boards that holds topics only.
  function feed(category: PostCategory | null, limit: number) {
    const scoped = supabase.from('posts').select(HOME_POST_SELECT).eq('region', ACTIVE_REGION).eq('status', 'active')
    return (category ? scoped.eq('category', category) : scoped.not('title', 'is', null))
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit)
  }

  async function loadHome() {
    const requestId = ++latestRequest
    homeLoading.value = true
    homeFailed.value = false
    try {
      if (currentUser.value) {
        const gate = await moderation.ensureLoaded()
        if (requestId !== latestRequest) return
        if (!gate.ok) throw new Error('moderation_gate_unavailable')
      }
      const now = Date.now()
      const [feeds, weekly, total, market] = await Promise.all([
        Promise.all([feed(null, 40), ...POST_CATEGORIES.map(category => feed(category, 8))]),
        // Request 7: this week's topics, counted per board on the client.
        supabase.from('posts').select('id, category, comment_count')
          .eq('region', ACTIVE_REGION).eq('status', 'active').not('title', 'is', null)
          .gte('created_at', new Date(now - WEEK).toISOString()).limit(1000),
        // Topics and updates in the region, for "see all N discussions".
        supabase.from('posts').select('id', { count: 'exact', head: true })
          .eq('region', ACTIVE_REGION).eq('status', 'active'),
        // Request 8: listings for sale. Items carry no region (ENGINEERING §4).
        supabase.from('items').select(HOME_ITEM_FIELDS).eq('status', 'active').eq('listing_type', 'sell')
          .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(6),
      ])
      if (requestId !== latestRequest) return
      const failed = [...feeds, weekly, total, market].find(result => result.error)
      if (failed) throw failed.error

      // Request 9, only once five of this week's topics have three replies or more.
      const weeklyRows = (weekly.data || []) as { id: string; category: PostCategory | null; comment_count: number }[]
      const busy = weeklyRows.filter(row => row.comment_count >= 3).map(row => row.id)
      const repliers = new Map<string, string[]>()
      if (busy.length >= 5) {
        const replies = await supabase.from('post_comments').select('post_id, user_id').in('post_id', busy)
        if (requestId !== latestRequest) return
        if (replies.error) throw replies.error
        for (const reply of (replies.data || []) as { post_id: string; user_id: string }[]) {
          repliers.set(reply.post_id, [...(repliers.get(reply.post_id) || []), reply.user_id])
        }
      }

      const blocked = moderation.blockedIds.value
      const candidates = feeds
        .flatMap(result => (result.data || []) as unknown as CommunityHomePost[])
        .filter(post => !blocked.has(post.user_id))
        .map(post => repliers.has(post.id) ? { ...post, reply_user_ids: repliers.get(post.id) } : post)
      homeData.value = {
        posts: { candidates, weeklyCategories: weeklyRows, totalDiscussionCount: total.count || 0 },
        items: ((market.data || []) as unknown as CommunityHomeItem[])
          .map(sanitizeItemResources)
          .filter(item => !blocked.has(item.user_id)),
        now,
      }
    } catch {
      if (requestId !== latestRequest) return
      console.error('[community home] load failed')
      homeFailed.value = true
    } finally {
      if (requestId === latestRequest) homeLoading.value = false
    }
  }

  // The snapshot is filtered by one account's block list; drop it with the account.
  function clearHome() {
    latestRequest += 1
    homeData.value = null
    homeLoading.value = false
    homeFailed.value = false
  }

  return { homeData, homeLoading, homeFailed, loadHome, clearHome }
}
