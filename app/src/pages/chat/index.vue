<template>
  <view class="page page-lock chat-page-wrap" :style="vvStyle">
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
import { ref, onMounted, onUnmounted } from 'vue'
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

/*
 * QA7-r3 #3: keyboard avoidance. interactive-widget=resizes-content did NOT
 * reliably shrink the layout on Eric's iOS Safari — the keyboard left the input
 * bar floating with a gap and the whole webview pannable. CSS (dvh / inset)
 * can't be trusted across iOS versions, so drive the fixed page box from
 * visualViewport directly: pin it to exactly the current visible rect (top =
 * offsetTop, height = visible height). The input bar (flex bottom) then always
 * sits on top of the keyboard with nothing below to pan. H5 + phone only;
 * desktop has no soft keyboard and keeps the CSS dvh height.
 */
const vvStyle = ref<Record<string, string> | undefined>(undefined)
// #ifdef H5
let vv: any = null
function syncVV() {
  if (!vv) return
  if (window.innerWidth >= 768) { vvStyle.value = undefined; return }
  vvStyle.value = { top: `${Math.round(vv.offsetTop)}px`, height: `${Math.round(vv.height)}px` }
}
onMounted(() => {
  vv = window.visualViewport
  if (!vv) return
  vv.addEventListener('resize', syncVV)
  vv.addEventListener('scroll', syncVV)
  syncVV()
})
onUnmounted(() => {
  if (!vv) return
  vv.removeEventListener('resize', syncVV)
  vv.removeEventListener('scroll', syncVV)
})
// #endif
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
