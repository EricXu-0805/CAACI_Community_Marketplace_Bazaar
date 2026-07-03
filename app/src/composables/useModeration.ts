import { ref } from 'vue'
import { useSupabase } from './useSupabase'

export type ReportTarget = 'item' | 'user' | 'message' | 'post' | 'comment'

const blockedIds = ref<Set<string>>(new Set())
let loaded = false

export function useModeration() {
  const { supabase } = useSupabase()

  async function loadBlockedIds() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) { blockedIds.value = new Set(); loaded = false; return }

    const { data, error } = await supabase
      .from('blocks')
      .select('blocked_id')
      .eq('blocker_id', session.user.id)
    // A failed load must NOT mark loaded=true with an empty set — that would
    // silently disable all block filtering for the whole session (a blocked
    // harasser's messages/conversations reappear). Leave loaded=false so
    // ensureLoaded() retries on the next call. (QA8 audit — was `{ data }`.)
    if (error) { loaded = false; return }
    blockedIds.value = new Set((data || []).map(r => r.blocked_id))
    loaded = true
  }

  async function ensureLoaded() {
    if (!loaded) await loadBlockedIds()
  }

  function isBlocked(userId: string): boolean {
    return blockedIds.value.has(userId)
  }

  /*
   * Insert a report row, then block on a 5–10s padding window.
   *
   * The DB write itself is a single row that returns in ~80ms, which
   * made the flow feel like the tap was swallowed and invited frivolous
   * repeat reports. Padding the perceived processing time (while the
   * caller shows a loading indicator) signals that a human moderator
   * will actually review, mirrors the pacing of larger marketplaces,
   * and meaningfully reduces double-submits. Callers that need the
   * raw insert (e.g. internal tooling) can pass skipDelay: true.
   */
  async function reportTarget(
    targetType: ReportTarget,
    targetId: string,
    reason: string,
    note = '',
    opts: { skipDelay?: boolean } = {}
  ) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')

    const startedAt = Date.now()

    const { error } = await supabase.from('reports').insert({
      reporter_id: session.user.id,
      target_type: targetType,
      target_id: targetId,
      reason: reason.slice(0, 50),
      note: note.slice(0, 500),
    })
    // 23505 = the unique-pending index (migration 074): this reporter already
    // has a pending report on this target. Treat as idempotent success (one
    // report per person per target) rather than surfacing a DB error.
    if (error && (error as any).code !== '23505') throw error

    if (!opts.skipDelay) {
      const floorMs = 5000
      const ceilingMs = 10000
      const elapsed = Date.now() - startedAt
      const jitter = Math.floor(Math.random() * (ceilingMs - floorMs))
      const remaining = Math.max(0, floorMs - elapsed) + jitter
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining))
    }
  }

  async function blockUser(blockedId: string) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')
    if (session.user.id === blockedId) throw new Error('Cannot block yourself')

    const { error } = await supabase.from('blocks').insert({
      blocker_id: session.user.id,
      blocked_id: blockedId,
    })
    if (error && error.code !== '23505') throw error
    blockedIds.value.add(blockedId)
  }

  async function unblockUser(blockedId: string) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')

    const { error } = await supabase
      .from('blocks')
      .delete()
      .eq('blocker_id', session.user.id)
      .eq('blocked_id', blockedId)
    if (error) throw error
    blockedIds.value.delete(blockedId)
  }

  function clearBlocked() {
    blockedIds.value = new Set()
    loaded = false
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
