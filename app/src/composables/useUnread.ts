import { ref, watch } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import { useI18n } from './useI18n'
import { subscribeToUserInbox } from './useRealtimeFallback'
import { invalidateConversations, applyIncomingMessage, useMessages } from './useMessages'
import { useModeration } from './useModeration'
import {
  captureAccountRequest,
  getActiveAccountId,
  isAccountRequestCurrent,
  onAccountTransition,
} from './accountScope'
import { fetchArchivedConversationIds } from '../api/conversationArchive'
import { readAllAscendingKeyset } from '../api/paginatedRead'

const unreadCount = ref(0)
const unreadConvIds = ref<Set<string>>(new Set())
const hasMutedUnread = ref(false)
const mutedConvIds = ref<Set<string>>(new Set())
let inboxUnsub: (() => void) | null = null
// Last-writer-wins guard: two incoming messages fire two concurrent
// refreshUnreadCount() calls; without this an earlier-issued (slower) response
// can land after a later one — or after a markAsRead — and write a stale badge.
let unreadSeq = 0
// Register the auth watcher exactly once for the session. useUnread() is
// called from AppSidebar + CustomTabBar + messages page + every ChatThread
// mount; without this guard each call stacked another watch(currentUser)
// (the returned stop handle was never used), so every desktop conversation
// switch leaked one more watcher firing a redundant refreshUnreadCount.
let unreadWatchBootstrapped = false
const LIVE_INBOX_RECONCILE_RETRY_MS = 1500

function resetUnreadState() {
  unreadSeq += 1
  if (inboxUnsub) {
    inboxUnsub()
    inboxUnsub = null
  }
  unreadCount.value = 0
  unreadConvIds.value = new Set()
  hasMutedUnread.value = false
  mutedConvIds.value = new Set()
}

onAccountTransition(resetUnreadState)

export function useUnread() {
  const { supabase } = useSupabase()
  const { currentUser } = useAuth()
  const { t } = useI18n()
  const { blockedIds, ensureLoaded } = useModeration()

  async function refreshUnreadCount(): Promise<{
    mutedSet: Set<string>
    moderationReady: boolean
    reconciled: boolean
  }> {
    if (!currentUser.value) {
      if (!getActiveAccountId()) resetUnreadState()
      return { mutedSet: new Set(), moderationReady: true, reconciled: true }
    }

    const uid = currentUser.value.id
    const token = captureAccountRequest(uid)
    if (!isAccountRequestCurrent(token)) {
      return { mutedSet: new Set(), moderationReady: false, reconciled: false }
    }
    const seq = ++unreadSeq
    try {
      const ownerIsCurrent = () => (
        seq === unreadSeq && isAccountRequestCurrent(token)
      )
      const convsRaw = await readAllAscendingKeyset<any>({
        isOwnerCurrent: ownerIsCurrent,
        keyOf: row => row?.id,
        fetchPage: (afterId, requestedRows) => {
          let query = supabase
            .from('conversations')
            .select(`
              id,
              buyer_id,
              seller_id,
              is_muted_buyer,
              is_muted_seller,
              unread_messages:messages(id)
            `)
            .or(`buyer_id.eq.${uid},seller_id.eq.${uid}`)
            .eq('unread_messages.is_read', false)
            .neq('unread_messages.sender_id', uid)
          if (afterId) query = query.gt('id', afterId)
          query = query
            .order('id', { ascending: true })
            .limit(requestedRows)
          // This is a per-conversation existence witness, not a global row
          // cap. A thread with 500+ unread messages therefore cannot hide the
          // next unread thread behind a truncated messages response.
          return query.limit(1, { referencedTable: 'unread_messages' })
        },
      })

      // A query error must NOT be read as "zero unread" — that silently clears
      // the badge on a transient failure and shows unread messages as read.
      // Keep the prior count and let the next refresh retry. (QA8 audit.)
      if (convsRaw === null || !ownerIsCurrent()) {
        return {
          mutedSet: isAccountRequestCurrent(token) ? mutedConvIds.value : new Set(),
          moderationReady: false,
          reconciled: false,
        }
      }

      // Drop conversations with a blocked counterparty so their messages don't
      // inflate the badge (the inbox list already hides them — useMessages.ts).
      // Keeps the count + list in agreement (B12).
      const moderationGate = await ensureLoaded()
      if (!isAccountRequestCurrent(token)) {
        return { mutedSet: new Set(), moderationReady: false, reconciled: false }
      }
      if (!moderationGate.ok) {
        // Keep the last badge but suppress realtime rendering/toasts until the
        // block boundary can be checked authoritatively.
        return { mutedSet: mutedConvIds.value, moderationReady: false, reconciled: false }
      }
      let convs = convsRaw && blockedIds.value.size > 0
        ? convsRaw.filter((c: any) => !blockedIds.value.has(c.buyer_id) && !blockedIds.value.has(c.seller_id))
        : convsRaw

      const archivedIds = await fetchArchivedConversationIds(supabase, uid, {
        isOwnerCurrent: ownerIsCurrent,
      })
      if (archivedIds === null || !ownerIsCurrent()) {
        return { mutedSet: new Set(), moderationReady: false, reconciled: false }
      }
      if (convs && archivedIds.size > 0) {
        convs = convs.filter((c: any) => !archivedIds.has(c.id))
      }

      if (!convs || convs.length === 0) {
        const applied = seq === unreadSeq && isAccountRequestCurrent(token)
        if (applied) {
          unreadCount.value = 0
          unreadConvIds.value = new Set()
          hasMutedUnread.value = false
          mutedConvIds.value = new Set()
        }
        return { mutedSet: new Set(), moderationReady: true, reconciled: applied }
      }

      const muted = new Set<string>()
      for (const c of convs) {
        const isMuted = (c.buyer_id === uid && c.is_muted_buyer) || (c.seller_id === uid && c.is_muted_seller)
        if (isMuted) muted.add(c.id)
      }

      // The left embedded relation deliberately omits `!inner`: conversations
      // with zero unread messages must remain in this snapshot so muted state
      // stays complete. The filtered child array is empty for those rows and
      // contains at most one id when an unread incoming message exists.
      const unreadSet = new Set<string>(
        convs
          .filter((c: any) => Array.isArray(c.unread_messages) && c.unread_messages.length > 0)
          .map((c: any) => c.id),
      )

      let count = 0
      let mutedWithUnread = false
      for (const cid of unreadSet) {
        if (muted.has(cid)) {
          mutedWithUnread = true
        } else {
          count++
        }
      }
      // Last-issued refresh wins; a stale earlier response must not clobber it.
      const applied = seq === unreadSeq && isAccountRequestCurrent(token)
      if (applied) {
        mutedConvIds.value = muted
        unreadCount.value = count
        unreadConvIds.value = unreadSet
        hasMutedUnread.value = mutedWithUnread
      }
      return { mutedSet: muted, moderationReady: true, reconciled: applied }
    } catch {
      // Keep the last known count on a transient failure rather than masking
      // unread as read by zeroing the badge. (QA8 audit.)
      return {
        mutedSet: isAccountRequestCurrent(token) ? mutedConvIds.value : new Set(),
        moderationReady: false,
        reconciled: false,
      }
    }
  }

  function startListening() {
    if (inboxUnsub || !currentUser.value) return

    const userId = currentUser.value.id
    const token = captureAccountRequest(userId)
    if (!isAccountRequestCurrent(token)) return
    let listenerAlive = true
    let inboxDeliveryVersion = 0
    let conversationLiveVersion = 0
    let conversationsReconciledThroughVersion = 0
    let conversationRefreshFlight: Promise<boolean> | null = null
    let conversationRefreshTimer: ReturnType<typeof setTimeout> | null = null
    let inboxReconcileRetryTimer: ReturnType<typeof setTimeout> | null = null
    const isListenerCurrent = () => (
      listenerAlive && isAccountRequestCurrent(token)
    )

    const runConversationRefresh = (): Promise<boolean> => {
      if (!isListenerCurrent()) return Promise.resolve(false)
      if (conversationRefreshFlight) return conversationRefreshFlight
      if (conversationRefreshTimer) {
        clearTimeout(conversationRefreshTimer)
        conversationRefreshTimer = null
      }

      const targetVersion = conversationLiveVersion
      const flight = useMessages()
        .fetchConversations(userId, { force: true, silent: true })
        .then((reconciled) => {
          if (isListenerCurrent() && reconciled) {
            conversationsReconciledThroughVersion = Math.max(
              conversationsReconciledThroughVersion,
              targetVersion,
            )
          }
          return reconciled
        })
        .finally(() => {
          if (conversationRefreshFlight === flight) {
            conversationRefreshFlight = null
          }
        })
      conversationRefreshFlight = flight
      return flight
    }

    const queueConversationRefresh = (delayMs = 0) => {
      if (
        !isListenerCurrent()
        || conversationsReconciledThroughVersion >= conversationLiveVersion
        || conversationRefreshTimer
      ) return

      const attempt = () => {
        conversationRefreshTimer = null
        if (!isListenerCurrent()) return
        void runConversationRefresh()
          .then((reconciled) => {
            if (!isListenerCurrent()) return
            if (
              reconciled
              && conversationsReconciledThroughVersion >= conversationLiveVersion
            ) return
            queueConversationRefresh(
              reconciled ? 0 : LIVE_INBOX_RECONCILE_RETRY_MS,
            )
          })
          .catch(() => {
            if (isListenerCurrent()) {
              queueConversationRefresh(LIVE_INBOX_RECONCILE_RETRY_MS)
            }
          })
      }

      if (delayMs > 0) {
        conversationRefreshTimer = setTimeout(attempt, delayMs)
      } else {
        attempt()
      }
    }

    const reconcileInboxFromSubscription = () => {
      if (!isListenerCurrent()) return
      // Re-read both badge and inbox so a message committed in the
      // snapshot/subscribe or WS/poll handoff gap cannot stay archived or
      // invisible. Returning the promise lets readiness retry after a
      // transient failure; the same guarded callback also runs periodically
      // while direct polling owns degraded recovery.
      invalidateConversations()
      return Promise.all([
        refreshUnreadCount(),
        runConversationRefresh(),
      ]).then(([unreadState, conversationsReconciled]) => {
        if (
          isListenerCurrent()
          && (!unreadState.reconciled || !conversationsReconciled)
        ) throw new Error('inbox_reconcile_failed')
      })
    }
    const queueInboxReconcileRetry = () => {
      if (!isListenerCurrent() || inboxReconcileRetryTimer) return
      inboxReconcileRetryTimer = setTimeout(() => {
        inboxReconcileRetryTimer = null
        if (!isListenerCurrent()) return
        void Promise.resolve(reconcileInboxFromSubscription())
          .catch(() => {
            if (isListenerCurrent()) queueInboxReconcileRetry()
          })
      }, LIVE_INBOX_RECONCILE_RETRY_MS)
    }
    const stopTransport = subscribeToUserInbox(
      userId,
      async (newMsg: any) => {
        if (!isListenerCurrent()) return
        // Transport delivery invokes the async handler synchronously up to its
        // first await. Capture that source order now so later badge/moderation
        // responses cannot finish out of order and roll the inbox preview back.
        const deliveryVersion = ++inboxDeliveryVersion
        // Decide the toast from the freshly-fetched muted set, not the shared ref:
        // for a brand-new conversation the ref isn't populated yet, so the old
        // synchronous check would toast a just-muted thread on its first message.
        const { mutedSet, moderationReady, reconciled } = await refreshUnreadCount()
        if (!isListenerCurrent()) return
        // A new incoming message changes the conversations list (preview, sort,
        // or a brand-new conversation row); drop the SWR cache so the next
        // messages-tab onShow refetches instead of serving a stale list.
        invalidateConversations()
        if (!reconciled) queueInboxReconcileRetry()
        if (!moderationReady) return
        // ...and live-reorder the already-loaded list so the active thread jumps
        // to the top of its group while the user is looking at it (QA6 #4). A
        // missing row is restored by the forced fetch below.
        const updatedExistingRow = applyIncomingMessage(
          newMsg,
          userId,
          deliveryVersion,
        )
        if (!updatedExistingRow) {
          // A newly-created conversation, or one whose per-user archive was
          // just cleared by this activity, is not present in the current list to
          // reorder. Restore it immediately while the inbox is open instead of
          // waiting for a tab switch/pull-to-refresh.
          conversationLiveVersion += 1
          queueConversationRefresh()
        }
        const convId = newMsg?.conversation_id
        // refreshUnreadCount above already ran ensureLoaded(), so blockedIds is
        // warm — suppress the toast for a blocked sender (B12).
        const fromBlocked = newMsg?.sender_id && blockedIds.value.has(newMsg.sender_id)
        if (convId && !mutedSet.has(convId) && !fromBlocked) {
          uni.showToast({ title: t('msg.newMessage'), icon: 'none', duration: 2000 })
        }
      },
      reconcileInboxFromSubscription,
      reconcileInboxFromSubscription,
    )
    inboxUnsub = () => {
      if (!listenerAlive) return
      listenerAlive = false
      if (conversationRefreshTimer) {
        clearTimeout(conversationRefreshTimer)
        conversationRefreshTimer = null
      }
      if (inboxReconcileRetryTimer) {
        clearTimeout(inboxReconcileRetryTimer)
        inboxReconcileRetryTimer = null
      }
      stopTransport()
    }
  }

  function stopListening() {
    resetUnreadState()
  }

  /*
   * Identity watcher (session-singleton, see unreadWatchBootstrapped). On an
   * identity flip we tear down the previous user's inbox subscription so it
   * doesn't keep ticking against the new user's session; on a present user we
   * refresh + (re)subscribe. startListening/refreshUnreadCount are idempotent.
   */
  if (!unreadWatchBootstrapped) {
    unreadWatchBootstrapped = true
    watch(currentUser, (u, prev) => {
      if (prev && (!u || u.id !== prev.id)) {
        stopListening()
      }
      if (u) {
        refreshUnreadCount()
        startListening()
      } else {
        stopListening()
      }
    }, { immediate: true })
  }

  return {
    unreadCount,
    unreadConvIds,
    mutedConvIds,
    hasMutedUnread,
    refreshUnreadCount,
    stopListening,
  }
}
