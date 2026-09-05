<template>
  <view class="page page-lock chat-page-wrap" :class="[mpThemeClass, { 'kb-up': !!vvStyle }]" :style="[vvStyle, mpChrome]">
    <text class="sr-only" role="heading" aria-level="1">{{ t('nav.messages') }}</text>
    <!-- #ifndef H5 -->
    <AppToast />
    <!-- #endif -->
    <ChatThread v-if="conversationId" :conversation-id="conversationId" :prefill="prefill" />
    <!-- #ifdef H5 -->
    <view v-if="vvDebug" class="vv-debug">{{ vvDebug }}</view>
    <!-- #endif -->
  </view>
</template>

<script setup lang="ts">
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
// #ifndef H5
import AppToast from '../../components/AppToast.vue'
// #endif
/*
 * Thin route wrapper. The entire chat experience lives in
 * components/ChatThread.vue so it can be reused two ways:
 *   · here, as a full pushed page (mobile / narrow), keyed by the
 *     route ?id= param
 *   · embedded as the right pane of the desktop two-pane messages view
 *     (pages/messages/index.vue ≥1100px on H5)
 * ChatThread owns auth-gating, realtime subscriptions, offers and
 * presence — see its onMounted/onUnmounted.
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useVisualViewportInset } from '../../composables/useVisualViewportInset'
import { onLoad } from '@dcloudio/uni-app'
import ChatThread from '../../components/ChatThread.vue'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'

const conversationId = ref('')
const prefill = ref('')
const { t } = useI18n()
const { currentUser, awaitAuthReady } = useAuth()
let routeMounted = false

onLoad((options) => {
  if (options?.id) conversationId.value = options.id as string
  // prefill stays URL-encoded here; ChatThread decodes it (preserves the
  // original chat page's decodeURIComponent behaviour).
  if (options?.prefill) prefill.value = options.prefill as string
})

// A bare /chat URL has no thread to render. Waiting for the shared auth
// handshake avoids sending a signed-in cold start to login, while the mounted
// guard prevents a late handshake from navigating after this page was left.
onMounted(() => {
  routeMounted = true
  if (conversationId.value) return
  void (async () => {
    const state = await awaitAuthReady()
    if (!routeMounted || conversationId.value) return
    uni.reLaunch({
      url: state === 'authenticated' ? '/pages/messages/index' : '/pages/login/index',
    })
  })()
})

onUnmounted(() => {
  routeMounted = false
})

// A pushed mobile chat otherwise survives sign-out with its component-local
// conversation detail still rendered. Unmount immediately and leave the old
// route whenever the authenticated identity changes.
watch(() => currentUser.value?.id ?? null, (userId, previousUserId) => {
  if (!previousUserId || userId === previousUserId) return
  conversationId.value = ''
  uni.reLaunch({ url: userId ? '/pages/messages/index' : '/pages/login/index' })
})

// Both the pushed route and embedded desktop thread use the same fixed-box
// viewport reference. iPad soft keyboards also shrink only the visual viewport.
const viewportInset = useVisualViewportInset()
const vvStyle = computed(() => viewportInset.value > 0 ? { bottom: `${viewportInset.value}px` } : undefined)
const vvDebug = computed(() => {
  // #ifdef H5
  if (import.meta.env.DEV && new URL(window.location.href).searchParams.has('kbdebug')) {
    const viewport = window.visualViewport
    if (viewport) return `cH${document.documentElement.clientHeight} vvH${Math.round(viewport.height)} occ${viewportInset.value}`
  }
  // #endif
  return ''
})
</script>

<style scoped>
.chat-page-wrap {
  height: 100vh; height: 100dvh;
  max-width: 480px; margin: 0 auto;
  display: flex; flex-direction: column;
}
/* #ifdef H5 */
/* Inset controls the height; do not combine top/bottom with an explicit dvh
   height. This applies to full-page chat on iPad and desktop deep links too. */
.chat-page-wrap { position: fixed; inset: 0; height: auto; }
.chat-page-wrap.kb-up :deep(.input-bar) { padding-bottom: 9px; }
/* #endif */
@media (min-width: 768px) {
  /* On desktop the thread reads better a touch wider than the phone cap. */
  .chat-page-wrap { max-width: 720px; }
}
/* #ifdef H5 */
.vv-debug {
  position: absolute; top: 0; left: 0; z-index: 9999;
  font: 11px/1.3 monospace; color: #fff; background: rgba(0, 0, 0, 0.75);
  padding: 2px 6px; pointer-events: none;
}
/* #endif */
</style>
