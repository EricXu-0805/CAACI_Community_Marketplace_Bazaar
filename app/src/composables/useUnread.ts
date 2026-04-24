import { ref, watch } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import { useI18n } from './useI18n'
import { subscribeToUserInbox } from './useRealtimeFallback'

const unreadCount = ref(0)
const unreadConvIds = ref<Set<string>>(new Set())
const hasMutedUnread = ref(false)
const mutedConvIds = ref<Set<string>>(new Set())
let inboxUnsub: (() => void) | null = null

export function useUnread() {
  const { supabase } = useSupabase()
  const { currentUser } = useAuth()
  const { t } = useI18n()

  async function refreshUnreadCount() {
    if (!currentUser.value) {
      unreadCount.value = 0
      unreadConvIds.value = new Set()
      hasMutedUnread.value = false
      mutedConvIds.value = new Set()
      return
    }

    const uid = currentUser.value.id
    try {
      const { data: convs } = await supabase
        .from('conversations')
        .select('id, buyer_id, seller_id, is_muted_buyer, is_muted_seller')
        .or(`buyer_id.eq.${uid},seller_id.eq.${uid}`)

      if (!convs || convs.length === 0) {
        unreadCount.value = 0
        unreadConvIds.value = new Set()
        hasMutedUnread.value = false
        return
      }

      const convIds = convs.map((c: any) => c.id)
      const muted = new Set<string>()
      for (const c of convs) {
        const isMuted = (c.buyer_id === uid && c.is_muted_buyer) || (c.seller_id === uid && c.is_muted_seller)
        if (isMuted) muted.add(c.id)
      }
      mutedConvIds.value = muted

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
      unreadCount.value = count
      unreadConvIds.value = unreadSet
      hasMutedUnread.value = mutedWithUnread
    } catch {
      unreadCount.value = 0
    }
  }

  function startListening() {
    if (inboxUnsub || !currentUser.value) return

    const userId = currentUser.value.id
    inboxUnsub = subscribeToUserInbox(userId, (newMsg: any) => {
      refreshUnreadCount()
      const convId = newMsg?.conversation_id
      if (convId && !mutedConvIds.value.has(convId)) {
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
   * watch returns its own stopHandle; we tear that down whenever the
   * currentUser flips identity so the previous user's subscription
   * doesn't keep ticking against the new user's session. Without
   * this, signing out + back in as a different user left an orphan
   * realtime channel ticking on the prior uid.
   */
  const stopWatch = watch(currentUser, (u, prev) => {
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

  return {
    unreadCount,
    unreadConvIds,
    mutedConvIds,
    hasMutedUnread,
    refreshUnreadCount,
    stopListening,
    stopWatch,
  }
}
