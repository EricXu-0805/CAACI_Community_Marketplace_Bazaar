import { ref } from 'vue'
import { useSupabase } from './useSupabase'

export interface Notification {
  id: string
  user_id: string
  type: 'price_drop' | 'system' | 'sold'
  title: string
  body: string
  item_id: string | null
  is_read: boolean
  created_at: string
}

const notifications = ref<Notification[]>([])
const unreadNotifCount = ref(0)

export function useNotifications() {
  const { supabase } = useSupabase()

  async function fetchNotifications() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (!error && data) {
      notifications.value = data as Notification[]
      unreadNotifCount.value = data.filter((n: any) => !n.is_read).length
    }
  }

  async function markAllRead() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return

    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', session.user.id)
      .eq('is_read', false)

    notifications.value = notifications.value.map(n => ({ ...n, is_read: true }))
    unreadNotifCount.value = 0
  }

  async function markRead(id: string) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    const n = notifications.value.find(x => x.id === id)
    if (n && !n.is_read) {
      n.is_read = true
      unreadNotifCount.value = Math.max(0, unreadNotifCount.value - 1)
    }
  }

  async function deleteNotification(id: string) {
    await supabase.from('notifications').delete().eq('id', id)
    const wasUnread = notifications.value.find(x => x.id === id && !x.is_read)
    notifications.value = notifications.value.filter(n => n.id !== id)
    if (wasUnread) unreadNotifCount.value = Math.max(0, unreadNotifCount.value - 1)
  }

  function clearNotifications() {
    notifications.value = []
    unreadNotifCount.value = 0
  }

  return {
    notifications,
    unreadNotifCount,
    fetchNotifications,
    markAllRead,
    markRead,
    deleteNotification,
    clearNotifications,
  }
}
