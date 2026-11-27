import { computed, onUnmounted, ref, type Ref } from 'vue'
import { onHide } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import { useModeration } from '../../composables/useModeration'
import { useMessages } from '../../composables/useMessages'
import { captureAccountRequest, isAccountRequestCurrent } from '../../composables/accountScope'
import { friendlyErrorMessage } from '../../utils'
import type { CommunityEvent } from '../../utils/communityEvents'

export function useOrganizerContact(event: Readonly<Ref<CommunityEvent | null>>) {
  const { currentUser, requireAuth, awaitAuthReady } = useAuth()
  const { ensureLoaded, isBlocked } = useModeration()
  const { getOrCreateDirectConversation } = useMessages()
  const { t, lang } = useI18n()
  const busy = ref(false)
  const canContact = computed(() => !!event.value?.organizer_user_id
    && event.value.source_type === 'member' && event.value.organizer_user_id !== currentUser.value?.id)
  let epoch = 0
  let mounted = true
  async function contact() {
    if (busy.value) return
    const mine = ++epoch, id = event.value?.id
    let current = () => mounted && mine === epoch && event.value?.id === id
    busy.value = true
    try {
      await awaitAuthReady()
      const row = event.value
      if (!current() || !requireAuth() || !currentUser.value || !row || !canContact.value || !row.organizer_user_id) return
      const peer = row.organizer_user_id
      const token = captureAccountRequest(currentUser.value.id)
      current = () => mounted && mine === epoch && event.value?.id === id && isAccountRequestCurrent(token)
      const gate = await ensureLoaded()
      if (!current()) return
      if (!gate.ok || isBlocked(peer)) {
        uni.showToast({ title: friendlyErrorMessage({ message: 'conversation_unavailable' }, lang.value === 'zh' ? 'zh' : 'en'), icon: 'none' })
        return
      }
      const conversation = await getOrCreateDirectConversation(token.userId, peer)
      if (current()) uni.navigateTo({ url: `/pages/chat/index?id=${conversation.id}` })
    } catch (error) {
      if (!(error instanceof Error) && !(error && typeof error === 'object' && 'message' in error && typeof error.message === 'string')) throw error
      if (current()) uni.showToast({ title: friendlyErrorMessage(error, lang.value === 'zh' ? 'zh' : 'en') || t('detail.chatFail'), icon: 'none' })
    } finally {
      if (mine === epoch) busy.value = false
    }
  }
  onHide(() => { epoch += 1; busy.value = false })
  onUnmounted(() => { mounted = false; epoch += 1 })
  return { canContact, busy, contact }
}
