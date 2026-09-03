import { ref, watch } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import { subscribeToUserNotifications } from './useRealtimeFallback'
import { pushToast } from './useAppToast'
import { useI18n } from './useI18n'
import { formatPrice } from '../utils'
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
  notificationBodyKey,
  notificationDestination,
  notificationIcon,
  notificationTitleText,
  notificationToastKind,
  notificationTypeLabelKey,
  type Notification,
} from '../api/notifications'

export {
  notificationDestination,
  notificationIcon,
  notificationTitleText,
  notificationTypeLabelKey,
}
export type { Notification } from '../api/notifications'

const notifications = ref<Notification[]>([])
const unreadNotifCount = ref(0)

const BODY_SENTINEL_KEYS: Record<string, string> = {
  saved_search_match: 'notif.savedSearchMatch',
  new_listing_from_followee: 'notif.followeeListing',
  transaction_rating_received: 'notif.ratingReceived',
  deal_marked_sold: 'notif.dealMarkedSold',
  new_follower: 'notif.newFollower',
  post_comment: 'notif.postComment',
  post_like: 'notif.postLike',
  post_comment_like: 'notif.commentLike',
  report_outcome_resolved: 'notif.reportResolved',
  report_outcome_dismissed: 'notif.reportDismissed',
  appeal_outcome_denied: 'notif.appealDenied',
  // notify_suspension_change (20260720035037) writes this one as copy, and
  // bilingual, so it is looked up by the sentence itself.
  '另一项账号限制仍在生效 · Another account restriction remains active':
    'notif.otherRestrictionActive',
}

/*
 * The sold and price-drop triggers write the amount as '$' || price::text
 * (migrations 005, 006, 065). price is DECIMAL(10,2), so that is '$25.00' and
 * '$1234.50' where the app's own formatPrice says '$25' and '$1,234.50' — and
 * '$0.00' where every other surface says Free. The row cannot be formatted at
 * insert time anyway: the reader's language is not known there. Reformat on
 * the way to the screen, the same reason the two sentinels above are keys
 * rather than sentences.
 */
const PRICE_BODY_RE = /^\$(\d+(?:\.\d+)?)(?: → \$(\d+(?:\.\d+)?))?$/

export function notificationBodyText(
  notification: Notification,
  translate: (key: string) => string,
): string {
  const messageKey = BODY_SENTINEL_KEYS[notificationBodyKey(notification.body).key]
  if (messageKey) return translate(messageKey)
  const amounts = PRICE_BODY_RE.exec(notification.body || '')
  if (amounts) {
    const free = translate('home.free')
    const [, from, to] = amounts
    return to === undefined
      ? formatPrice(Number(from), free)
      : `${formatPrice(Number(from), free)} → ${formatPrice(Number(to), free)}`
  }
  return notification.body
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
// Any local mutation that an older list/count snapshot could roll back bumps
// this revision. A snapshot only applies after one quiet revision.
let notificationStateGeneration = 0
const MAX_NOTIFICATION_SNAPSHOT_RESTARTS = 3
const restoredStructuredActivityIds = new Set<string>()
const deliveredLiveNotificationIds = new Set<string>()
const locallyReadNotificationIds = new Set<string>()
const deletedNotificationIds = new Set<string>()
let structuredInboxRefreshQueuedFor: string | null = null
const LIVE_NOTIFICATION_RECONCILE_RETRY_MS = 1500
type NotificationMutationBarrier = {
  userId: string
  promise: Promise<void>
  release: () => void
}
const notificationMutationBarriers = new Set<NotificationMutationBarrier>()
let notificationMutationEpoch = 0
let verifyLiveNotificationsForUserId: string | null = null
let requestNotificationReconcile: ((userId: string) => void) | null = null

function rememberNotificationId(set: Set<string>, id: string) {
  set.add(id)
  if (set.size > 512) {
    const oldest = set.values().next().value
    if (oldest) set.delete(oldest)
  }
}

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

function beginNotificationMutationBarrier(userId: string): () => void {
  notificationMutationEpoch += 1
  let resolveBarrier!: () => void
  const barrier: NotificationMutationBarrier = {
    userId,
    promise: new Promise<void>((resolve) => {
      resolveBarrier = resolve
    }),
    release: () => {},
  }
  let released = false
  barrier.release = () => {
    if (released) return
    released = true
    notificationMutationBarriers.delete(barrier)
    resolveBarrier()
  }
  notificationMutationBarriers.add(barrier)
  return barrier.release
}

function applyAuthoritativeRead(id: string) {
  rememberNotificationId(locallyReadNotificationIds, id)
  const current = notifications.value.find(row => row.id === id)
  if (!current || current.is_read) return
  notificationStateGeneration += 1
  notifications.value = notifications.value.map(row => (
    row.id === id ? { ...row, is_read: true } : row
  ))
  // List rows and the exact badge come from independent snapshots. Even when
  // this stale row is visibly unread, the badge may already belong to a newer
  // row that is absent from the list. Keep the conservative overcount until
  // the listener's authoritative reconcile applies both snapshots.
}

function applyAuthoritativeDelete(id: string) {
  rememberNotificationId(deletedNotificationIds, id)
  locallyReadNotificationIds.delete(id)
  const current = notifications.value.find(row => row.id === id)
  if (!current) return
  notificationStateGeneration += 1
  notifications.value = notifications.value.filter(row => row.id !== id)
  // Do not infer count ownership from list membership; a torn list/count pair
  // can make this badge belong to another, genuinely unread notification.
}

async function verifyAndHandleLiveNotificationAfterMarkAll(
  row: Notification,
  isOwnerCurrent: () => boolean,
  forceVerification = false,
): Promise<boolean> {
  if (
    !forceVerification
    && verifyLiveNotificationsForUserId !== row.user_id
  ) {
    if (!isOwnerCurrent()) return false
    handleIncoming(row)
    return true
  }

  // A WAL INSERT can be delivered while mark-all is in flight, or its point
  // read can start just before a new mark-all begins. Wait for every same-user
  // UPDATE and retry whenever the epoch changes across the read. The final
  // classification and handleIncoming call stay in this same synchronous
  // continuation, so another mark-all cannot slip between them.
  while (true) {
    const pending = [...notificationMutationBarriers]
      .filter(barrier => barrier.userId === row.user_id)
      .map(barrier => barrier.promise)
    if (pending.length > 0) {
      await Promise.all(pending)
      continue
    }

    if (
      !isOwnerCurrent()
      || (
        !forceVerification
        && verifyLiveNotificationsForUserId !== row.user_id
      )
      || getActiveAccountId() !== row.user_id
    ) return false
    const token = captureAccountRequest(row.user_id)
    if (!isAccountRequestCurrent(token)) return false
    const epochAtReadStart = notificationMutationEpoch

    const { supabase } = useSupabase()
    const { data, error } = await supabase
      .from('notifications')
      .select('id, user_id, is_read')
      .eq('user_id', token.userId)
      .eq('id', row.id)
      .limit(1)
    if (!isOwnerCurrent() || !isAccountRequestCurrent(token)) return false
    if (
      epochAtReadStart !== notificationMutationEpoch
      || [...notificationMutationBarriers].some(
        barrier => barrier.userId === row.user_id,
      )
    ) continue
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('notification_live_verify_malformed')
    if (data.length === 0) {
      applyAuthoritativeDelete(row.id)
      return true
    }

    const current = data[0] as {
      id?: unknown
      user_id?: unknown
      is_read?: unknown
    }
    if (
      data.length !== 1
      || current.id !== row.id
      || current.user_id !== token.userId
      || typeof current.is_read !== 'boolean'
    ) throw new Error('notification_live_verify_malformed')

    if (current.is_read) {
      applyAuthoritativeRead(row.id)
      return true
    }
    handleIncoming({ ...row, is_read: false })
    return true
  }
}

async function markReadById(id: string) {
  const { supabase } = useSupabase()
  const token = captureActiveAccountRequest()
  if (!token) return
  const releaseMutationBarrier = beginNotificationMutationBarrier(token.userId)
  try {
    // supabase-js resolves with { error } and does NOT throw on an RLS/HTTP
    // failure, so a bare await can't observe a failed write. Gate the local row
    // update on a clean write, then reconcile the independent exact badge.
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('user_id', token.userId)
    if (error || !isAccountRequestCurrent(token)) return
    notificationStateGeneration += 1
    rememberNotificationId(locallyReadNotificationIds, id)
    const n = notifications.value.find(x => x.id === id)
    if (n && !n.is_read) {
      n.is_read = true
    }
    requestNotificationReconcile?.(token.userId)
  } catch {
    /* best-effort; the row stays unread and gets caught on next fetch */
  } finally {
    releaseMutationBarrier()
  }
}

function handleIncoming(row: Notification) {
  if (!row || !row.id) return
  if (!row.user_id || row.user_id !== getActiveAccountId()) return
  if (deletedNotificationIds.has(row.id)) return
  const wasLocallyRead = locallyReadNotificationIds.has(row.id)
  const incoming = wasLocallyRead && !row.is_read
    ? { ...row, is_read: true }
    : row
  const isFirstLiveDelivery = !deliveredLiveNotificationIds.has(row.id)
  if (isFirstLiveDelivery) {
    deliveredLiveNotificationIds.add(row.id)
    if (deliveredLiveNotificationIds.size > 512) {
      const oldest = deliveredLiveNotificationIds.values().next().value
      if (oldest) deliveredLiveNotificationIds.delete(oldest)
    }
  }
  // Run archive reconciliation before notification-list de-duplication. The
  // initial list fetch and realtime subscription intentionally overlap; the
  // list can therefore contain this row before the realtime callback arrives.
  restoreInboxForStructuredActivity(incoming)
  if (!notifications.value.some(n => n.id === row.id)) {
    notificationStateGeneration += 1
    notifications.value = [incoming, ...notifications.value].slice(0, 50)
    if (!incoming.is_read) unreadNotifCount.value++
  }
  if (!isFirstLiveDelivery || wasLocallyRead) return
  // Already rendered in-list on the notifications page — don't double-surface.
  if (currentPageIsNotifications()) return
  const { t } = useI18n()
  const destination = notificationDestination(row)
  pushToast({
    kind: notificationToastKind(row.type),
    title: notificationTitleText(row, t),
    body: notificationBodyText(row, t) || undefined,
    route: destination.url,
    switchTab: destination.switchTab,
    onTap: () => { void markReadById(row.id) },
  })
}

function startNotificationsListener(
  userId: string,
  onReady?: (isListenerCurrent: () => boolean) => void | Promise<void>,
) {
  // Replace, don't bail: if currentUser flips identity in a single tick the
  // watcher may not see the intermediate null, so always tear down any prior
  // channel before subscribing — otherwise the new user gets an orphaned
  // channel still scoped to the old uid and receives nothing.
  if (notifUnsub) stopNotificationsListener()
  const token = captureAccountRequest(userId)
  let alive = true
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null
  let listenerLiveVersion = 0
  let reconciledThroughLiveVersion = 0
  let reconcileFlight: Promise<void> | null = null
  const isListenerCurrent = () => alive && isAccountRequestCurrent(token)

  const runAuthoritativeReconcile = (): Promise<void> | undefined => {
    if (!onReady || !isListenerCurrent()) return
    if (reconcileFlight) return reconcileFlight

    const targetLiveVersion = listenerLiveVersion
    const flight = Promise.resolve()
      .then(() => onReady(isListenerCurrent))
      .then(() => {
        if (isListenerCurrent()) {
          reconciledThroughLiveVersion = Math.max(
            reconciledThroughLiveVersion,
            targetLiveVersion,
          )
        }
      })
      .finally(() => {
        if (reconcileFlight === flight) reconcileFlight = null
      })
    reconcileFlight = flight
    return flight
  }

  /*
   * The notification rows and exact unread count are two independent HTTP
   * snapshots. An INSERT can commit between them and its realtime callback
   * can arrive only after both values were applied, leaving the badge one high
   * or one low. Every accepted live row therefore queues one post-event
   * authoritative snapshot. The transport readiness callback and this live
   * repair share one flight, so a direct-poll tick cannot start two snapshots.
   * Events arriving during an older flight queue one later pass.
   */
  const queueLiveReconcile = (delayMs = 0) => {
    if (!onReady || !isListenerCurrent()) return
    if (reconciledThroughLiveVersion >= listenerLiveVersion) return
    if (reconcileTimer) return
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null
      if (!isListenerCurrent()) return
      const task = runAuthoritativeReconcile()
      if (!task) return
      void task
        .then(() => {
          if (
            isListenerCurrent()
            && reconciledThroughLiveVersion < listenerLiveVersion
          ) queueLiveReconcile()
        })
        .catch(() => {
          if (
            isListenerCurrent()
            && reconciledThroughLiveVersion < listenerLiveVersion
          ) queueLiveReconcile(LIVE_NOTIFICATION_RECONCILE_RETRY_MS)
        })
    }, delayMs)
  }

  const queueMutationReconcile = (requestedUserId: string) => {
    if (requestedUserId !== userId || !isListenerCurrent()) return
    listenerLiveVersion += 1
    queueLiveReconcile()
  }
  requestNotificationReconcile = queueMutationReconcile

  const reconcileNotificationsFromSubscription = () => (
    runAuthoritativeReconcile()
  )

  const stopTransport = subscribeToUserNotifications(
    userId,
    async (row) => {
      if (
        !isListenerCurrent()
        || !row?.id
        || row.user_id !== userId
      ) return
      const mutationPending = [...notificationMutationBarriers].some(
        barrier => barrier.userId === row.user_id,
      )
      if (
        verifyLiveNotificationsForUserId === row.user_id
        || mutationPending
      ) {
        const handled = await verifyAndHandleLiveNotificationAfterMarkAll(
          row,
          isListenerCurrent,
          mutationPending,
        )
        if (!handled || !isListenerCurrent()) return
      } else {
        handleIncoming(row)
      }
      listenerLiveVersion += 1
      queueLiveReconcile()
    },
    reconcileNotificationsFromSubscription,
    reconcileNotificationsFromSubscription,
  )
  notifUnsub = () => {
    alive = false
    if (requestNotificationReconcile === queueMutationReconcile) {
      requestNotificationReconcile = null
    }
    if (reconcileTimer) {
      clearTimeout(reconcileTimer)
      reconcileTimer = null
    }
    stopTransport()
  }
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
  notificationStateGeneration += 1
  stopNotificationsListener()
  clearNotificationsState()
  restoredStructuredActivityIds.clear()
  deliveredLiveNotificationIds.clear()
  locallyReadNotificationIds.clear()
  deletedNotificationIds.clear()
  verifyLiveNotificationsForUserId = null
  requestNotificationReconcile = null
  notificationMutationEpoch += 1
  for (const barrier of [...notificationMutationBarriers]) barrier.release()
  structuredInboxRefreshQueuedFor = null
})

export function useNotifications() {
  const { supabase } = useSupabase()

  async function fetchNotifications(
    ownerIsCurrent: () => boolean = () => true,
  ): Promise<boolean> {
    const requestId = ++latestNotificationFetchId
    let session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'] = null
    try {
      const result = await supabase.auth.getSession()
      session = result.data.session
    } catch (error) {
      if (!ownerIsCurrent() || requestId !== latestNotificationFetchId) return false
      throw error
    }
    if (!ownerIsCurrent()) return false
    if (!session?.user) return false
    const token = captureAccountRequest(session.user.id)
    if (!isAccountRequestCurrent(token)) return false
    let snapshotRestarts = 0

    while (
      ownerIsCurrent()
      && isAccountRequestCurrent(token)
      && requestId === latestNotificationFetchId
    ) {
      const stateGenerationAtStart = notificationStateGeneration
      const results = await Promise.all([
        fetchNotificationRowsWithCompatibility<Notification>((fields) => (
          supabase
            .from('notifications')
            .select(fields)
            .eq('user_id', token.userId)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
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
        if (
          !ownerIsCurrent()
          || !isAccountRequestCurrent(token)
          || requestId !== latestNotificationFetchId
        ) return null
        throw error
      })

      if (!results) return false
      const [listRows, countResult] = results
      if (
        !ownerIsCurrent()
        || !isAccountRequestCurrent(token)
        || requestId !== latestNotificationFetchId
      ) return false
      if (countResult.error) throw countResult.error
      if (stateGenerationAtStart !== notificationStateGeneration) {
        // Keep the newer live row/toast or successful read/delete mutation and
        // retry this same readiness barrier. A detached recursive fetch would
        // compete with the transport retry and make both requests stale.
        snapshotRestarts += 1
        if (snapshotRestarts >= MAX_NOTIFICATION_SNAPSHOT_RESTARTS) return false
        continue
      }
      notificationStateGeneration += 1
      notifications.value = listRows
      // This also reconciles the direct-poll bootstrap window: MP seeds its
      // server cursor first, then onReady triggers another list fetch. A row that
      // landed during seeding is reflected here even though it is not replayed
      // as a fresh toast.
      for (const row of listRows) restoreInboxForStructuredActivity(row)
      unreadNotifCount.value = countResult.count || 0
      return true
    }
    return false
  }

  async function markAllRead() {
    const token = captureActiveAccountRequest()
    if (!token || !isAccountRequestCurrent(token)) return
    // From this point until the next account transition, an INSERT callback may
    // be an arbitrarily delayed WAL delivery from before this UPDATE. There is
    // no trustworthy client timestamp/timeout that distinguishes it from a
    // genuinely new notification, so future callbacks use an exact point read.
    verifyLiveNotificationsForUserId = token.userId
    const releaseMutationBarrier = beginNotificationMutationBarrier(token.userId)
    const stateGenerationAtStart = notificationStateGeneration
    const unreadIdsAtStart = new Set(
      notifications.value.filter(n => !n.is_read).map(n => n.id),
    )
    let barrierReleased = false
    const releaseBarrier = () => {
      if (barrierReleased) return
      barrierReleased = true
      releaseMutationBarrier()
    }
    try {
      let session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'] = null
      const result = await supabase.auth.getSession()
      session = result.data.session
      if (session?.user.id !== token.userId || !isAccountRequestCurrent(token)) return

      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', token.userId)
        .eq('is_read', false)
      if (!isAccountRequestCurrent(token)) return
      if (error) throw error

      const localStateStayedQuiet = (
        stateGenerationAtStart === notificationStateGeneration
      )
      notificationStateGeneration += 1
      // Rows known to be unread when this command began were definitely covered
      // by the successful server UPDATE. Preserve that fact even if an older
      // snapshot landed while the write was pending. The exact badge can only be
      // reset when no local state changed across the write; otherwise it may
      // already belong to a genuinely newer unread notification.
      notifications.value = notifications.value.map(n => (
        unreadIdsAtStart.has(n.id) ? { ...n, is_read: true } : n
      ))
      for (const id of unreadIdsAtStart) {
        rememberNotificationId(locallyReadNotificationIds, id)
      }
      if (localStateStayedQuiet) unreadNotifCount.value = 0
      // Release queued WAL verification as soon as the UPDATE has settled.
      // The post-write list/count repair is independent and may retry later.
      releaseBarrier()
      await fetchNotifications().catch(() => {
        /* conservative local state remains; page/transport retries */
      })
    } catch (error) {
      if (!isAccountRequestCurrent(token)) return
      throw error
    } finally {
      releaseBarrier()
    }
  }

  async function markRead(id: string) {
    const token = captureActiveAccountRequest()
    if (!token) return
    const releaseMutationBarrier = beginNotificationMutationBarrier(token.userId)
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id)
        .eq('user_id', token.userId)
      if (!isAccountRequestCurrent(token)) return
      if (error) throw error
      notificationStateGeneration += 1
      rememberNotificationId(locallyReadNotificationIds, id)
      const n = notifications.value.find(x => x.id === id)
      if (n && !n.is_read) {
        n.is_read = true
      }
      requestNotificationReconcile?.(token.userId)
    } finally {
      releaseMutationBarrier()
    }
  }

  async function deleteNotification(id: string) {
    const token = captureActiveAccountRequest()
    if (!token) return
    const releaseMutationBarrier = beginNotificationMutationBarrier(token.userId)
    try {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', id)
        .eq('user_id', token.userId)
      if (!isAccountRequestCurrent(token)) return
      if (error) throw error
      notificationStateGeneration += 1
      rememberNotificationId(deletedNotificationIds, id)
      locallyReadNotificationIds.delete(id)
      notifications.value = notifications.value.filter(n => n.id !== id)
      requestNotificationReconcile?.(token.userId)
    } finally {
      releaseMutationBarrier()
    }
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
        startNotificationsListener(u.id, (isListenerCurrent) => {
          // H5 subscription handshake / MP server-cursor seeding is complete.
          // Reconcile once more to close the intentional fetch+subscribe race.
          // Returning the promise lets the transport retry this barrier after a
          // transient failure and repeat it while direct polling owns recovery.
          return fetchNotifications(isListenerCurrent).then((reconciled) => {
            if (!reconciled && isListenerCurrent()) {
              throw new Error('notification_reconcile_failed')
            }
          })
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
