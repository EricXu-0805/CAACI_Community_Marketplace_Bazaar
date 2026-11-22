import { captureAccountRequest, isAccountRequestCurrent, type AccountRequestToken } from './accountScope'
import { useAuth } from './useAuth'
import { useSupabase } from './useSupabase'
import { useCommunityEvents } from './useCommunityEvents'
import { assertWritesAllowed } from './useRestriction'
import { mpTextGate } from './useWechatSecCheck'
import { checkContent, remoteModerate } from '../utils/contentSafety'
import { normalizeEventText } from '../utils/communityEvents'
import {
  isDefinitiveMutationRejection, mutationCommitState, mutationOutcomeError,
} from '../api/mutationCommit'

const ERROR_KEYS = {
  member_event_not_eligible: 'events.needVerify',
  member_event_time_out_of_range: 'events.err.timeRange',
  member_event_active_limit: 'events.err.activeLimit',
  member_event_reserved_wording: 'events.err.reservedWording',
  member_event_link_not_allowed: 'events.err.noLinks',
  member_event_title_too_long: 'events.err.titleTooLong',
  member_event_location_invalid: 'events.err.locationInvalid',
  member_event_cancel_final: 'events.err.cancelFinal',
  member_event_rpc_required: 'events.err.notSubmitted',
  event_discussion_closed: 'events.err.discussionClosed',
  official_account_unset: 'events.err.discussionUnavailable',
  member_events_closed: 'events.err.closed',
  member_event_title_required: 'events.err.titleRequired',
  member_event_content_invalid: 'events.err.contentInvalid',
  member_event_end_invalid: 'events.err.endInvalid',
} as const
export type MemberEventField = 'title' | 'content' | 'location' | 'startsAt' | 'endsAt'
type Failure = keyof typeof ERROR_KEYS | 'not_authenticated' | 'account_changed'
  | 'result_unavailable' | `moderation_block:${string}`

export class MemberEventError extends Error {
  constructor(readonly reason: Failure, readonly field: MemberEventField | null = null) {
    super(reason)
    this.name = 'MemberEventError'
  }
}

export function memberEventErrorKey(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('message' in error) || typeof error.message !== 'string') return null
  return Object.entries(ERROR_KEYS).find(([code]) => code === error.message)?.[1] ?? null
}

export interface MemberEventInput {
  readonly postId: string
  readonly title: string
  readonly content: string
  readonly location: string
  readonly startsAt: string
  readonly endsAt: string | null
}
const LINK = /(https?:\/\/|www[.]|[a-z0-9-]+[.](com|net|org|edu|cn|io|me|ly|link)\b)/i
const RESERVED = /(官方|主办|official|hosted by)/i
const DAY = 86_400_000
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function requireCurrentAccount(token: AccountRequestToken, outcome: 'not_committed' | 'committed') {
  if (!isAccountRequestCurrent(token)) throw mutationOutcomeError(new MemberEventError('account_changed'), outcome)
}

export function useMemberEventWrites() {
  const { currentUser, awaitAuthReady } = useAuth()
  const { supabase } = useSupabase()
  const { invalidate } = useCommunityEvents()

  async function createMemberEvent(input: MemberEventInput): Promise<{ readonly post_id: string; readonly event_id: string }> {
    let submitted = false
    try {
      await awaitAuthReady()
      const user = currentUser.value
      if (!user) throw new MemberEventError('not_authenticated')
      const token = captureAccountRequest(user.id)
      requireCurrentAccount(token, 'not_committed')
      assertWritesAllowed()
      if (!user.is_illini_verified) throw new MemberEventError('member_event_not_eligible')
      const title = normalizeEventText(input.title)
      const content = input.content.trim()
      const location = normalizeEventText(input.location)
      if (!title) throw new MemberEventError('member_event_title_required', 'title')
      if (Array.from(title).length > 60) throw new MemberEventError('member_event_title_too_long', 'title')
      if (!content || Array.from(content).length > 2000) throw new MemberEventError('member_event_content_invalid', 'content')
      if (!location || Array.from(location).length > 80) throw new MemberEventError('member_event_location_invalid', 'location')
      const texts = [
        ['title', title], ['content', content], ['location', location],
      ] as const
      for (const [field, value] of texts) {
        if (LINK.test(value)) throw new MemberEventError('member_event_link_not_allowed', field)
        if (field !== 'content' && RESERVED.test(value)) throw new MemberEventError('member_event_reserved_wording', field)
      }
      const start = Date.parse(input.startsAt), now = Date.now()
      if (!Number.isFinite(start) || start <= now || start > now + 60 * DAY) {
        throw new MemberEventError('member_event_time_out_of_range', 'startsAt')
      }
      if (input.endsAt !== null) {
        const end = Date.parse(input.endsAt)
        if (!Number.isFinite(end) || end < start || end > start + 30 * DAY) {
          throw new MemberEventError('member_event_end_invalid', 'endsAt')
        }
      }
      for (const [field, value] of texts) {
        const safety = checkContent(value, { kind: 'post' })
        if (!safety.ok) throw new MemberEventError(`moderation_block:${safety.category}`, field)
      }
      const text = `${title}\n${content}\n${location}`
      const remote = await remoteModerate(text, token)
      if (remote.flagged) throw new MemberEventError('moderation_block:sensitive_word')
      requireCurrentAccount(token, 'not_committed')
      await mpTextGate(text, 3, token)
      requireCurrentAccount(token, 'not_committed')
      submitted = true
      const response = await supabase.rpc('create_member_event', {
        post_id_in: input.postId, title_in: title, content_in: content,
        event_in: { starts_at: input.startsAt, ends_at: input.endsAt, location },
      })
      if (response.error) {
        const error = { ...response.error, status: response.status }
        throw mutationOutcomeError(error, isDefinitiveMutationRejection(error) ? 'not_committed' : 'unknown')
      }
      const data: unknown = response.data
      if (!record(data) || data.post_id !== input.postId || typeof data.event_id !== 'string') {
        throw mutationOutcomeError(new MemberEventError('result_unavailable'), 'unknown')
      }
      requireCurrentAccount(token, 'committed')
      invalidate()
      return { post_id: input.postId, event_id: data.event_id }
    } catch (error) {
      if (error instanceof Error && mutationCommitState(error)) throw error
      throw mutationOutcomeError(error, submitted ? 'unknown' : 'not_committed')
    }
  }

  async function cancelMemberEvent(id: string): Promise<{ readonly id: string; readonly cancelled_at: string }> {
    let submitted = false
    try {
      await awaitAuthReady()
      const user = currentUser.value
      if (!user) throw new MemberEventError('not_authenticated')
      const token = captureAccountRequest(user.id)
      requireCurrentAccount(token, 'not_committed')
      // D-49: taking down one's own activity stays available under restriction.
      submitted = true
      const response = await supabase.from('community_events').update({ cancelled_at: new Date().toISOString() })
        .eq('id', id).eq('organizer_user_id', user.id).select('id, cancelled_at').single()
      if (response.error) {
        const error = { ...response.error, status: response.status }
        throw mutationOutcomeError(error, isDefinitiveMutationRejection(error) ? 'not_committed' : 'unknown')
      }
      const data: unknown = response.data
      if (!record(data) || data.id !== id || typeof data.cancelled_at !== 'string') {
        throw mutationOutcomeError(new MemberEventError('result_unavailable'), 'unknown')
      }
      requireCurrentAccount(token, 'committed')
      invalidate()
      return { id, cancelled_at: data.cancelled_at }
    } catch (error) {
      if (error instanceof Error && mutationCommitState(error)) throw error
      throw mutationOutcomeError(error, submitted ? 'unknown' : 'not_committed')
    }
  }

  return { createMemberEvent, cancelMemberEvent }
}
