import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import type { Rating, TransactionRatingEligibility } from '../types'
import {
  captureAccountRequest,
  isAccountRequestCurrent,
  type AccountRequestToken,
} from './accountScope'

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
    accountToken?: AccountRequestToken
  }): Promise<Rating> {
    const userId = currentUser.value?.id
    if (!userId) throw new Error('Not authenticated')
    const accountToken = input.accountToken || captureAccountRequest(userId)
    if (accountToken.userId !== userId || !isAccountRequestCurrent(accountToken)) {
      throw new Error('Account changed')
    }
    if (input.stars < 1 || input.stars > 5) throw new Error('Stars must be 1-5')
    const { data, error } = await supabase.rpc('submit_transaction_rating', {
      p_item_id: input.itemId,
      p_ratee_id: input.rateeId,
      p_stars: input.stars,
      p_comment: input.comment?.trim() || null,
      expected_user_id_in: accountToken.userId,
    })
    if (!isAccountRequestCurrent(accountToken)) throw new Error('Account changed')
    if (error) throw error
    return data as Rating
  }

  async function getEligibility(
    itemId: string,
    accountToken?: AccountRequestToken,
  ): Promise<TransactionRatingEligibility> {
    const userId = currentUser.value?.id
    if (!userId) return {
      eligible: false,
      ratee_id: null,
      ratee_nickname: null,
      already_rated: false,
    }
    const token = accountToken || captureAccountRequest(userId)
    if (token.userId !== userId || !isAccountRequestCurrent(token)) {
      throw new Error('Account changed')
    }
    const { data, error } = await supabase.rpc('get_transaction_rating_eligibility', {
      p_item_id: itemId,
      expected_user_id_in: token.userId,
    })
    if (!isAccountRequestCurrent(token)) throw new Error('Account changed')
    if (error) throw error
    const row = (Array.isArray(data) ? data[0] : data) as TransactionRatingEligibility | null
    return row || {
      eligible: false,
      ratee_id: null,
      ratee_nickname: null,
      already_rated: false,
    }
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
    const userId = currentUser.value?.id
    if (!userId) return false
    const accountToken = captureAccountRequest(userId)
    if (!isAccountRequestCurrent(accountToken)) return false
    const { data, error } = await supabase
      .from('ratings')
      .select('id')
      .eq('rater_id', accountToken.userId)
      .eq('ratee_id', rateeId)
      .eq('item_id', itemId)
      .maybeSingle()
    if (!isAccountRequestCurrent(accountToken)) return false
    if (error) throw error
    return !!data
  }

  return { submitRating, fetchForUser, hasRated, getEligibility }
}
