<template>
  <view class="page page-lock chat-page-wrap">
    <ChatThread v-if="conversationId" :conversation-id="conversationId" :prefill="prefill" />
  </view>
</template>

<script setup lang="ts">
/*
 * Thin route wrapper. The entire chat experience lives in
 * components/ChatThread.vue so it can be reused two ways:
 *   · here, as a full pushed page (mobile / narrow), keyed by the
 *     route ?id= param
 *   · embedded as the right pane of the desktop two-pane messages view
 *     (pages/messages/index.vue ≥768px)
 * ChatThread owns auth-gating, realtime subscriptions, offers and
 * presence — see its onMounted/onUnmounted.
 */
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import ChatThread from '../../components/ChatThread.vue'

const conversationId = ref('')
const prefill = ref('')

onLoad((options) => {
  if (options?.id) conversationId.value = options.id as string
  // prefill stays URL-encoded here; ChatThread decodes it (preserves the
  // original chat page's decodeURIComponent behaviour).
  if (options?.prefill) prefill.value = options.prefill as string
})
</script>

<style scoped>
.chat-page-wrap {
  height: 100vh; height: 100dvh;
  max-width: 480px; margin: 0 auto;
  display: flex; flex-direction: column;
}
@media (min-width: 768px) {
  /* On desktop the thread reads better a touch wider than the phone cap. */
  .chat-page-wrap { max-width: 720px; }
}
</style>
