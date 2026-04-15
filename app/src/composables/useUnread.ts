import { ref, watch } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import { useI18n } from './useI18n'

const unreadCount = ref(0)
let subscribed = false

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
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .neq('sender_id', currentUser.value.id)
        .eq('is_read', false)
        .in('conversation_id', convIds)

      unreadCount.value = count || 0
    } catch {
      unreadCount.value = 0
    }
  }

  function startListening() {
    if (subscribed || !currentUser.value) return
    subscribed = true

    const userId = currentUser.value.id
    supabase
      .channel('global-new-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as any
          if (msg.sender_id !== userId) {
            unreadCount.value++
            uni.showToast({ title: t('msg.newMessage'), icon: 'none', duration: 2000 })
          }
        }
      )
      .subscribe()
  }

  watch(currentUser, (u) => {
    if (u) {
      refreshUnreadCount()
      startListening()
    } else {
      unreadCount.value = 0
    }
  }, { immediate: true })

  return { unreadCount, refreshUnreadCount }
}
