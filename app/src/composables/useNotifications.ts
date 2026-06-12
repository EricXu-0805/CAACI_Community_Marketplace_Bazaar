import { ref, watch } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import { subscribeToUserNotifications } from './useRealtimeFallback'
import { pushToast } from './useAppToast'

export interface Notification {
  id: string
  user_id: string
  type: 'price_drop' | 'system' | 'sold' | 'offer' | 'meetup'
  title: string
  body: string
  item_id: string | null
  is_read: boolean
  created_at: string
}

const NOTIFICATION_FIELDS = 'id, user_id, type, title, body, item_id, is_read, created_at'

const notifications = ref<Notification[]>([])
const unreadNotifCount = ref(0)

/*
 * In-app realtime delivery. A single module-scoped subscription pushes a
 * branded toast (useAppToast) + bumps the red-dot the moment a notification
 * row is inserted for the logged-in user. Bootstrapped once off currentUser
 * (see useNotifications below); torn down + rebuilt when the identity flips.
 */
let notifUnsub: (() => void) | null = null
let bootstrapped = false

function currentPageIsNotifications(): boolean {
  try {
    const pages = getCurrentPages() as Array<{ route?: string }>
    if (!pages.length) return false
    return pages[pages.length - 1].route === 'pages/notifications/index'
  } catch {
    return false
  }
}

async function markReadById(id: string) {
  const { supabase } = useSupabase()
  try {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    const n = notifications.value.find(x => x.id === id)
    if (n && !n.is_read) {
      n.is_read = true
      unreadNotifCount.value = Math.max(0, unreadNotifCount.value - 1)
    }
  } catch {
    /* best-effort; the row stays unread and gets caught on next fetch */
  }
}

function handleIncoming(row: Notification) {
  if (!row || !row.id) return
  if (notifications.value.some(n => n.id === row.id)) return
  notifications.value = [row, ...notifications.value].slice(0, 50)
  if (!row.is_read) unreadNotifCount.value++
  // Already rendered in-list on the notifications page — don't double-surface.
  if (currentPageIsNotifications()) return
  pushToast({
    kind: row.type,
    title: row.title,
    body: row.body || undefined,
    route: row.item_id ? `/pages/detail/index?id=${row.item_id}` : '/pages/notifications/index',
    onTap: () => { void markReadById(row.id) },
  })
}

function startNotificationsListener(userId: string) {
  // Replace, don't bail: if currentUser flips identity in a single tick the
  // watcher may not see the intermediate null, so always tear down any prior
  // channel before subscribing — otherwise the new user gets an orphaned
  // channel still scoped to the old uid and receives nothing.
  if (notifUnsub) stopNotificationsListener()
  notifUnsub = subscribeToUserNotifications(userId, handleIncoming)
}

function stopNotificationsListener() {
  if (notifUnsub) {
    notifUnsub()
    notifUnsub = null
  }
}

export function useNotifications() {
  const { supabase } = useSupabase()

  async function fetchNotifications() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return

    const { data, error } = await supabase
      .from('notifications')
      .select(NOTIFICATION_FIELDS)
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error
    if (data) {
      notifications.value = data as Notification[]
      unreadNotifCount.value = data.filter((n: any) => !n.is_read).length
    }
  }

  async function markAllRead() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', session.user.id)
      .eq('is_read', false)
    if (error) throw error

    notifications.value = notifications.value.map(n => ({ ...n, is_read: true }))
    unreadNotifCount.value = 0
  }

  async function markRead(id: string) {
    const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    if (error) throw error
    const n = notifications.value.find(x => x.id === id)
    if (n && !n.is_read) {
      n.is_read = true
      unreadNotifCount.value = Math.max(0, unreadNotifCount.value - 1)
    }
  }

  async function deleteNotification(id: string) {
    const { error } = await supabase.from('notifications').delete().eq('id', id)
    if (error) throw error
    const wasUnread = notifications.value.find(x => x.id === id && !x.is_read)
    notifications.value = notifications.value.filter(n => n.id !== id)
    if (wasUnread) unreadNotifCount.value = Math.max(0, unreadNotifCount.value - 1)
  }

  function clearNotifications() {
    notifications.value = []
    unreadNotifCount.value = 0
  }

  /*
   * Bootstrap the realtime listener once, off the reactive currentUser. Any
   * surface that reads unreadNotifCount (tab bar, sidebar, profile) starts it
   * implicitly, so the red-dot + toasts are live app-wide for the session.
   * Guarded by a module flag so the many callers don't stack watchers/channels.
   */
  if (!bootstrapped) {
    bootstrapped = true
    const { currentUser } = useAuth()
    watch(currentUser, (u, prev) => {
      if (prev && (!u || u.id !== prev.id)) stopNotificationsListener()
      if (u) {
        fetchNotifications().catch(() => { /* red-dot stays at 0 until next fetch */ })
        startNotificationsListener(u.id)
      } else {
        stopNotificationsListener()
        clearNotifications()
      }
    }, { immediate: true })
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
