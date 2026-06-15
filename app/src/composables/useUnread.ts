import { ref, watch } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import { useI18n } from './useI18n'
import { subscribeToUserInbox } from './useRealtimeFallback'
import { invalidateConversations } from './useMessages'

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

export function useUnread() {
  const { supabase } = useSupabase()
  const { currentUser } = useAuth()
  const { t } = useI18n()

  async function refreshUnreadCount(): Promise<{ mutedSet: Set<string> }> {
    if (!currentUser.value) {
      unreadCount.value = 0
      unreadConvIds.value = new Set()
      hasMutedUnread.value = false
      mutedConvIds.value = new Set()
      return { mutedSet: new Set() }
    }

    const seq = ++unreadSeq
    const uid = currentUser.value.id
    try {
      const { data: convs } = await supabase
        .from('conversations')
        .select('id, buyer_id, seller_id, is_muted_buyer, is_muted_seller')
        .or(`buyer_id.eq.${uid},seller_id.eq.${uid}`)

      if (!convs || convs.length === 0) {
        if (seq === unreadSeq) {
          unreadCount.value = 0
          unreadConvIds.value = new Set()
          hasMutedUnread.value = false
          mutedConvIds.value = new Set()
        }
        return { mutedSet: new Set() }
      }

      const convIds = convs.map((c: any) => c.id)
      const muted = new Set<string>()
      for (const c of convs) {
        const isMuted = (c.buyer_id === uid && c.is_muted_buyer) || (c.seller_id === uid && c.is_muted_seller)
        if (isMuted) muted.add(c.id)
      }

      const { data: unreadMsgs } = await supabase
        .from('messages')
        .select('conversation_id')
        .neq('sender_id', uid)
        .eq('is_read', false)
        .in('conversation_id', convIds)
        .limit(500)

      const unreadSet = new Set<string>((unreadMsgs || []).map((m: any) => m.conversation_id))

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
      if (seq === unreadSeq) {
        mutedConvIds.value = muted
        unreadCount.value = count
        unreadConvIds.value = unreadSet
        hasMutedUnread.value = mutedWithUnread
      }
      return { mutedSet: muted }
    } catch {
      if (seq === unreadSeq) unreadCount.value = 0
      return { mutedSet: mutedConvIds.value }
    }
  }

  function startListening() {
    if (inboxUnsub || !currentUser.value) return

    const userId = currentUser.value.id
    inboxUnsub = subscribeToUserInbox(userId, async (newMsg: any) => {
      // Decide the toast from the freshly-fetched muted set, not the shared ref:
      // for a brand-new conversation the ref isn't populated yet, so the old
      // synchronous check would toast a just-muted thread on its first message.
      const { mutedSet } = await refreshUnreadCount()
      // A new incoming message changes the conversations list (preview, sort,
      // or a brand-new conversation row); drop the SWR cache so the next
      // messages-tab onShow refetches instead of serving a stale list.
      invalidateConversations()
      const convId = newMsg?.conversation_id
      if (convId && !mutedSet.has(convId)) {
        uni.showToast({ title: t('msg.newMessage'), icon: 'none', duration: 2000 })
      }
    })
  }

  function stopListening() {
    if (inboxUnsub) {
      inboxUnsub()
      inboxUnsub = null
    }
    unreadCount.value = 0
    hasMutedUnread.value = false
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
