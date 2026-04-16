import { ref } from 'vue'
import { useSupabase } from './useSupabase'

export type ReportTarget = 'item' | 'user' | 'message'

const blockedIds = ref<Set<string>>(new Set())
let loaded = false

export function useModeration() {
  const { supabase } = useSupabase()

  async function loadBlockedIds() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) { blockedIds.value = new Set(); loaded = false; return }

    const { data } = await supabase
      .from('blocks')
      .select('blocked_id')
      .eq('blocker_id', session.user.id)
    blockedIds.value = new Set((data || []).map(r => r.blocked_id))
    loaded = true
  }

  async function ensureLoaded() {
    if (!loaded) await loadBlockedIds()
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
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')

    const { error } = await supabase.from('reports').insert({
      reporter_id: session.user.id,
      target_type: targetType,
      target_id: targetId,
      reason: reason.slice(0, 50),
      note: note.slice(0, 500),
    })
    if (error) throw error
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
