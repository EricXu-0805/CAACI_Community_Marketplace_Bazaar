import { ref, watch } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import { useI18n } from './useI18n'

const unreadCount = ref(0)
const unreadConvIds = ref<Set<string>>(new Set())
let channel: ReturnType<ReturnType<typeof useSupabase>['supabase']['channel']> | null = null

export function useUnread() {
  const { supabase } = useSupabase()
  const { currentUser } = useAuth()
  const { t } = useI18n()

  async function refreshUnreadCount() {
    if (!currentUser.value) { unreadCount.value = 0; return }

    try {
      const { data: convs } = await supabase
        .from('conversations')
        .select('id')
        .or(`buyer_id.eq.${currentUser.value.id},seller_id.eq.${currentUser.value.id}`)

      if (!convs || convs.length === 0) { unreadCount.value = 0; return }

      const convIds = convs.map((c: any) => c.id)
      const { data: unreadMsgs, count } = await supabase
        .from('messages')
        .select('conversation_id', { count: 'exact' })
        .neq('sender_id', currentUser.value.id)
        .eq('is_read', false)
        .in('conversation_id', convIds)

      unreadCount.value = count || 0
      unreadConvIds.value = new Set((unreadMsgs || []).map((m: any) => m.conversation_id))
    } catch {
      unreadCount.value = 0
    }
  }

  function startListening() {
    if (channel || !currentUser.value) return

    const userId = currentUser.value.id
    channel = supabase
      .channel(`user-${userId}-new-messages`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `sender_id=neq.${userId}`,
        },
        () => {
          unreadCount.value++
          uni.showToast({ title: t('msg.newMessage'), icon: 'none', duration: 2000 })
        }
      )
      .subscribe()
  }

  function stopListening() {
    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }
    unreadCount.value = 0
  }

  watch(currentUser, (u) => {
    if (u) {
      refreshUnreadCount()
      startListening()
    } else {
      stopListening()
    }
  }, { immediate: true })

  return { unreadCount, unreadConvIds, refreshUnreadCount, stopListening }
}
