import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import type { Rating } from '../types'

const PUBLIC_PROFILE_FIELDS = 'id, nickname, avatar_url, is_illini_verified, uid'
const RATING_FIELDS = 'id, rater_id, ratee_id, item_id, stars, comment, created_at'

export function useRatings() {
  const { supabase } = useSupabase()
  const { currentUser } = useAuth()

  async function submitRating(input: {
    rateeId: string
    itemId: string
    stars: number
    comment?: string
  }): Promise<Rating> {
    if (!currentUser.value) throw new Error('Not authenticated')
    if (input.stars < 1 || input.stars > 5) throw new Error('Stars must be 1-5')
    const { data, error } = await supabase
      .from('ratings')
      .insert({
        rater_id: currentUser.value.id,
        ratee_id: input.rateeId,
        item_id: input.itemId,
        stars: input.stars,
        comment: input.comment?.trim() || null,
      })
      .select()
      .single()
    if (error) throw error
    return data as Rating
  }

  async function fetchForUser(userId: string, limit = 20): Promise<Rating[]> {
    const { data, error } = await supabase
      .from('ratings')
      .select(`${RATING_FIELDS}, rater:profiles!ratings_rater_id_fkey(${PUBLIC_PROFILE_FIELDS})`)
      .eq('ratee_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data || []) as unknown as Rating[]
  }

  async function hasRated(rateeId: string, itemId: string): Promise<boolean> {
    if (!currentUser.value) return false
    const { data } = await supabase
      .from('ratings')
      .select('id')
      .eq('rater_id', currentUser.value.id)
      .eq('ratee_id', rateeId)
      .eq('item_id', itemId)
      .maybeSingle()
    return !!data
  }

  return { submitRating, fetchForUser, hasRated }
}
