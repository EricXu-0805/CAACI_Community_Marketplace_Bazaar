import { ref, watch } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import { subscribeToUserNotifications } from './useRealtimeFallback'
import { pushToast } from './useAppToast'
import { useI18n } from './useI18n'
import { invalidateConversations, useMessages } from './useMessages'
import {
  captureAccountRequest,
  captureActiveAccountRequest,
  getActiveAccountId,
  isAccountRequestCurrent,
  onAccountTransition,
} from './accountScope'
import {
  fetchNotificationRowsWithCompatibility,
  notificationDestination,
  notificationIcon,
  notificationToastKind,
  notificationTypeLabelKey,
  type Notification,
} from '../api/notifications'

export {
  notificationDestination,
  notificationIcon,
  notificationTypeLabelKey,
}
export type { Notification } from '../api/notifications'

const notifications = ref<Notification[]>([])
const unreadNotifCount = ref(0)

const BODY_SENTINEL_KEYS: Record<string, string> = {
  saved_search_match: 'notif.savedSearchMatch',
  new_listing_from_followee: 'notif.followeeListing',
}

export function notificationBodyText(
  notification: Notification,
  translate: (key: string) => string,
): string {
  const key = BODY_SENTINEL_KEYS[notification.body]
  return key ? translate(key) : notification.body
}

/*
 * In-app realtime delivery. A single module-scoped subscription pushes a
 * branded toast (useAppToast) + bumps the red-dot the moment a notification
 * row is inserted for the logged-in user. Bootstrapped once off currentUser
 * (see useNotifications below); torn down + rebuilt when the identity flips.
 */
let notifUnsub: (() => void) | null = null
let bootstrapped = false
let latestNotificationFetchId = 0
let notificationLiveGeneration = 0
const restoredStructuredActivityIds = new Set<string>()
let structuredInboxRefreshQueuedFor: string | null = null

function restoreInboxForStructuredActivity(row: Notification) {
  if (
    !row?.id
    || !row.conversation_id
    || (row.type !== 'offer' && row.type !== 'meetup')
    || !row.user_id
    || row.user_id !== getActiveAccountId()
  ) return

  const eventKey = `${row.user_id}:${row.id}`
  if (restoredStructuredActivityIds.has(eventKey)) return
  restoredStructuredActivityIds.add(eventKey)
  if (restoredStructuredActivityIds.size > 200) {
    const oldest = restoredStructuredActivityIds.values().next().value
    if (oldest) restoredStructuredActivityIds.delete(oldest)
  }

  invalidateConversations()
  if (structuredInboxRefreshQueuedFor === row.user_id) return
  structuredInboxRefreshQueuedFor = row.user_id
  const userId = row.user_id
  // Coalesce an initial 50-row notification snapshot into one authoritative
  // inbox fetch. conversation_archives remains the source of truth, so old
  // structured notifications cannot resurrect a row archived more recently.
  void Promise.resolve().then(() => {
    if (structuredInboxRefreshQueuedFor !== userId) return
    structuredInboxRefreshQueuedFor = null
    if (getActiveAccountId() === userId) {
      void useMessages().fetchConversations(userId, { force: true })
    }
  })
}

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
  const token = captureActiveAccountRequest()
  if (!token) return
  try {
    // supabase-js resolves with { error } and does NOT throw on an RLS/HTTP
    // failure, so a bare await can't observe a failed write. Gate the local
    // badge decrement on a clean write — otherwise the badge drops while the
    // row is still unread server-side (until the next fetch re-inflates it).
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('user_id', token.userId)
    if (error || !isAccountRequestCurrent(token)) return
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
  if (!row.user_id || row.user_id !== getActiveAccountId()) return
  notificationLiveGeneration += 1
  // Run archive reconciliation before notification-list de-duplication. The
  // initial list fetch and realtime subscription intentionally overlap; the
  // list can therefore contain this row before the realtime callback arrives.
  restoreInboxForStructuredActivity(row)
  if (notifications.value.some(n => n.id === row.id)) return
  notifications.value = [row, ...notifications.value].slice(0, 50)
  if (!row.is_read) unreadNotifCount.value++
  // Already rendered in-list on the notifications page — don't double-surface.
  if (currentPageIsNotifications()) return
  const { t } = useI18n()
  const destination = notificationDestination(row)
  pushToast({
    kind: notificationToastKind(row.type),
    title: row.title,
    body: notificationBodyText(row, t) || undefined,
    route: destination.url,
    switchTab: destination.switchTab,
    onTap: () => { void markReadById(row.id) },
  })
}

function startNotificationsListener(userId: string, onReady?: () => void) {
  // Replace, don't bail: if currentUser flips identity in a single tick the
  // watcher may not see the intermediate null, so always tear down any prior
  // channel before subscribing — otherwise the new user gets an orphaned
  // channel still scoped to the old uid and receives nothing.
  if (notifUnsub) stopNotificationsListener()
  const token = captureAccountRequest(userId)
  notifUnsub = subscribeToUserNotifications(
    userId,
    (row) => {
      if (isAccountRequestCurrent(token)) handleIncoming(row)
    },
    () => {
      if (isAccountRequestCurrent(token)) onReady?.()
    },
  )
}

function stopNotificationsListener() {
  if (notifUnsub) {
    notifUnsub()
    notifUnsub = null
  }
}

function clearNotificationsState() {
  notifications.value = []
  unreadNotifCount.value = 0
}

// Clear private singleton state at the authoritative session transition, not
// later when Vue happens to flush its currentUser watcher.
onAccountTransition(() => {
  latestNotificationFetchId += 1
  notificationLiveGeneration += 1
  stopNotificationsListener()
  clearNotificationsState()
  restoredStructuredActivityIds.clear()
  structuredInboxRefreshQueuedFor = null
})

export function useNotifications() {
  const { supabase } = useSupabase()

  async function fetchNotifications() {
    const requestId = ++latestNotificationFetchId
    const liveGenerationAtStart = notificationLiveGeneration
    let session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'] = null
    try {
      const result = await supabase.auth.getSession()
      session = result.data.session
    } catch (error) {
      if (requestId !== latestNotificationFetchId) return
      throw error
    }
    if (!session?.user) return
    const token = captureAccountRequest(session.user.id)
    if (!isAccountRequestCurrent(token)) return

    const results = await Promise.all([
      fetchNotificationRowsWithCompatibility<Notification>((fields) => (
        supabase
          .from('notifications')
          .select(fields)
          .eq('user_id', token.userId)
          .order('created_at', { ascending: false })
          .limit(50)
      )),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', token.userId)
        .eq('is_read', false),
    ]).catch(error => {
      // A request that belonged to A may reject after B has already loaded.
      // Treat that rejection as stale control flow; surfacing it would let A's
      // late failure overwrite B's page error/toast state.
      if (!isAccountRequestCurrent(token) || requestId !== latestNotificationFetchId) return null
      throw error
    })

    if (!results) return
    const [listRows, countResult] = results
    if (!isAccountRequestCurrent(token) || requestId !== latestNotificationFetchId) return
    if (countResult.error) throw countResult.error
    if (liveGenerationAtStart !== notificationLiveGeneration) {
      // A realtime row mutated the list/badge after these HTTP snapshots began.
      // Applying them would erase that newer row or roll back its unread count.
      // Keep the live state and issue a post-commit reconciliation snapshot.
      void fetchNotifications().catch(() => { /* live state remains authoritative */ })
      return
    }
    notifications.value = listRows
    // This also reconciles the direct-poll bootstrap window: MP seeds its
    // server cursor first, then onReady triggers another list fetch. A row that
    // landed during seeding is reflected here even though it is not replayed
    // as a fresh toast.
    for (const row of listRows) restoreInboxForStructuredActivity(row)
    unreadNotifCount.value = countResult.count || 0
  }

  async function markAllRead() {
    const token = captureActiveAccountRequest()
    if (!token || !isAccountRequestCurrent(token)) return
    let session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'] = null
    try {
      const result = await supabase.auth.getSession()
      session = result.data.session
    } catch (error) {
      if (!isAccountRequestCurrent(token)) return
      throw error
    }
    if (session?.user.id !== token.userId || !isAccountRequestCurrent(token)) return

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', token.userId)
      .eq('is_read', false)
    if (!isAccountRequestCurrent(token)) return
    if (error) throw error

    notifications.value = notifications.value.map(n => ({ ...n, is_read: true }))
    unreadNotifCount.value = 0
  }

  async function markRead(id: string) {
    const token = captureActiveAccountRequest()
    if (!token) return
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('user_id', token.userId)
    if (!isAccountRequestCurrent(token)) return
    if (error) throw error
    const n = notifications.value.find(x => x.id === id)
    if (n && !n.is_read) {
      n.is_read = true
      unreadNotifCount.value = Math.max(0, unreadNotifCount.value - 1)
    }
  }

  async function deleteNotification(id: string) {
    const token = captureActiveAccountRequest()
    if (!token) return
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', id)
      .eq('user_id', token.userId)
    if (!isAccountRequestCurrent(token)) return
    if (error) throw error
    const wasUnread = notifications.value.find(x => x.id === id && !x.is_read)
    notifications.value = notifications.value.filter(n => n.id !== id)
    if (wasUnread) unreadNotifCount.value = Math.max(0, unreadNotifCount.value - 1)
  }

  function clearNotifications() {
    clearNotificationsState()
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
        startNotificationsListener(u.id, () => {
          // H5 subscription handshake / MP server-cursor seeding is complete.
          // Reconcile once more to close the intentional fetch+subscribe race.
          fetchNotifications().catch(() => { /* next page show retries */ })
        })
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
