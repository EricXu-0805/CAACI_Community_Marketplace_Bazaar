import { useSupabase } from './useSupabase'

export type ReportTarget = 'item' | 'user' | 'message'

export function useModeration() {
  const { supabase } = useSupabase()

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
  }

  async function listBlockedIds(): Promise<string[]> {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return []

    const { data, error } = await supabase
      .from('blocks')
      .select('blocked_id')
      .eq('blocker_id', session.user.id)
    if (error) return []
    return (data || []).map(row => row.blocked_id)
  }

  return { reportTarget, blockUser, unblockUser, listBlockedIds }
}
