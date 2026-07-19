import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import {
  captureAccountRequest,
  getActiveAccountId,
  isAccountRequestCurrent,
  onAccountTransition,
  type AccountRequestToken,
} from './accountScope'

export type ReportTarget = 'item' | 'user' | 'message' | 'post' | 'comment'

export type ModerationLoadResult =
  | { ok: true; userId: string; cached: boolean }
  | {
      ok: false
      reason: 'unauthenticated' | 'load_failed' | 'account_changed'
      error?: unknown
    }

const blockedIds = ref<Set<string>>(new Set())
let loadedForUserId: string | null = null
let loadInFlightForUserId: string | null = null
let loadInFlight: Promise<ModerationLoadResult> | null = null

function resetModerationState() {
  blockedIds.value = new Set()
  loadedForUserId = null
  loadInFlightForUserId = null
  loadInFlight = null
}

onAccountTransition(resetModerationState)

export function useModeration() {
  const { supabase } = useSupabase()

  async function requireEntryAccountToken(): Promise<AccountRequestToken> {
    const entryUserId = getActiveAccountId()
    if (!entryUserId) throw new Error('Not authenticated')
    const token = captureAccountRequest(entryUserId)
    if (!isAccountRequestCurrent(token)) throw new Error('Authentication changed')
    const { data: { session } } = await supabase.auth.getSession()
    if (
      !session?.user
      || session.user.id !== token.userId
      || !isAccountRequestCurrent(token)
    ) throw new Error('Authentication changed')
    return token
  }

  async function queryBlockedIds(userId: string): Promise<ModerationLoadResult> {
    const token = captureAccountRequest(userId)
    if (!isAccountRequestCurrent(token)) {
      return { ok: false, reason: 'account_changed' }
    }

    let response
    try {
      response = await supabase
        .from('blocks')
        .select('blocked_id')
        .eq('blocker_id', token.userId)
    } catch (error) {
      if (!isAccountRequestCurrent(token)) return { ok: false, reason: 'account_changed' }
      loadedForUserId = null
      return { ok: false, reason: 'load_failed', error }
    }
    const { data, error } = response
    if (!isAccountRequestCurrent(token)) {
      return { ok: false, reason: 'account_changed' }
    }
    // A failed load must NOT mark loaded=true with an empty set — that would
    // silently disable all block filtering for the whole session (a blocked
    // harasser's messages/conversations reappear). Return an explicit failure
    // so security-sensitive callers can remain fail-closed and offer a retry.
    if (error) {
      if (isAccountRequestCurrent(token)) loadedForUserId = null
      return { ok: false, reason: 'load_failed', error }
    }
    blockedIds.value = new Set((data || []).map(r => r.blocked_id))
    loadedForUserId = token.userId
    return { ok: true, userId: token.userId, cached: false }
  }

  async function loadBlockedIds(): Promise<ModerationLoadResult> {
    const entryUserId = getActiveAccountId()
    const entryToken = entryUserId ? captureAccountRequest(entryUserId) : null
    let session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'] = null
    try {
      const sessionResult = await supabase.auth.getSession()
      session = sessionResult.data.session
    } catch (error) {
      if (entryToken && !isAccountRequestCurrent(entryToken)) {
        return { ok: false, reason: 'account_changed' }
      }
      // getSession is usually local, but storage/runtime failures are still a
      // failed security prerequisite. Invalidate the snapshot for an active
      // account instead of treating the empty Set as authoritative.
      if (getActiveAccountId()) loadedForUserId = null
      return { ok: false, reason: 'load_failed', error }
    }

    if (!session?.user) {
      if (!getActiveAccountId()) resetModerationState()
      return { ok: false, reason: 'unauthenticated' }
    }
    if (entryToken && (
      session.user.id !== entryToken.userId
      || !isAccountRequestCurrent(entryToken)
    )) return { ok: false, reason: 'account_changed' }

    const userId = session.user.id
    // App startup, inbox and a deep-linked thread can all request the same
    // snapshot at once. Share one account-scoped query so a slower failure
    // cannot overwrite a newer success and spuriously close/open the gate.
    if (loadInFlight && loadInFlightForUserId === userId) return loadInFlight

    const request = queryBlockedIds(userId)
    loadInFlightForUserId = userId
    loadInFlight = request
    try {
      return await request
    } finally {
      if (loadInFlight === request) {
        loadInFlight = null
        loadInFlightForUserId = null
      }
    }
  }

  async function ensureLoaded(): Promise<ModerationLoadResult> {
    const activeUserId = getActiveAccountId()
    if (!activeUserId) return { ok: false, reason: 'unauthenticated' }
    if (loadedForUserId === activeUserId) {
      return { ok: true, userId: activeUserId, cached: true }
    }
    return loadBlockedIds()
  }

  function isBlocked(userId: string): boolean {
    return blockedIds.value.has(userId)
  }

  async function reportTarget(
    targetType: ReportTarget,
    targetId: string,
    reason: string,
    note = ''
  ) {
    const token = await requireEntryAccountToken()

    const { error } = await supabase.from('reports').insert({
      reporter_id: token.userId,
      target_type: targetType,
      target_id: targetId,
      reason: reason.slice(0, 50),
      note: note.slice(0, 500),
    })
    if (!isAccountRequestCurrent(token)) return
    // Only the intended pending-only index is an idempotent duplicate. The
    // historical permanent constraint used the same SQLSTATE and accidentally
    // suppressed later incidents after a report was resolved; treating every
    // 23505 as success would hide that data loss again.
    const errorText = error
      ? `${(error as any).message || ''} ${(error as any).details || ''} ${(error as any).hint || ''}`
      : ''
    const duplicatePending = (error as any)?.code === '23505'
      && errorText.includes('uq_reports_pending_per_reporter_target')
    if (error && !duplicatePending) throw error
  }

  async function blockUser(blockedId: string) {
    const token = await requireEntryAccountToken()
    if (token.userId === blockedId) throw new Error('Cannot block yourself')

    const { error } = await supabase.from('blocks').insert({
      blocker_id: token.userId,
      blocked_id: blockedId,
    })
    if (!isAccountRequestCurrent(token)) return
    if (error && error.code !== '23505') throw error
    blockedIds.value.add(blockedId)
  }

  async function unblockUser(blockedId: string) {
    const token = await requireEntryAccountToken()

    const { error } = await supabase
      .from('blocks')
      .delete()
      .eq('blocker_id', token.userId)
      .eq('blocked_id', blockedId)
    if (!isAccountRequestCurrent(token)) return
    if (error) throw error
    // The server delete committed, so an already-loaded snapshot remains
    // authoritative after removing this id. Keeping loadedForUserId intact
    // lets a newly opened thread recover immediately instead of depending on
    // another network read that could transiently fail closed.
    blockedIds.value.delete(blockedId)
  }

  function clearBlocked() {
    resetModerationState()
  }

  return {
    blockedIds,
    isBlocked,
    loadBlockedIds,
    ensureLoaded,
    reportTarget,
    blockUser,
    unblockUser,
    clearBlocked,
  }
}
