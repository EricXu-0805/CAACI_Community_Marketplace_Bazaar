<template>
  <view class="page page-lock chat-page-wrap" :class="{ 'kb-up': !!vvStyle }" :style="vvStyle">
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
// #ifndef H5
import AppToast from '../../components/AppToast.vue'
// #endif
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
 * QA7-r4 #3 — chat keyboard avoidance (the fix that stuck, after 3 misses).
 *
 * This page root is ONE fixed element (.page-lock = position:fixed; inset:0 on
 * mobile H5). Prior attempts all tried to control its HEIGHT and trusted one
 * viewport number:
 *   · attempts 1-2 trusted interactive-widget=resizes-content to shrink the
 *     fixed ICB — unreliable/laggy on this iOS Safari, so the input bar stayed
 *     under the keyboard.
 *   · attempt 3 set inline height = visualViewport.height — but the meta DOES
 *     partially shrink the layout, so vv.height is measured against an already-
 *     shrunk frame AND excludes Safari's form-accessory bar (~44px). Asserting
 *     it as height DOUBLE-SUBTRACTED → the box ended ~145px too short → the page
 *     canvas showed through below the input bar and the webview was pannable.
 *
 * Fix: never assert height. Anchor top:0 (from .page-lock) and drive only
 * `bottom` = the keyboard-occluded band, measured against
 * documentElement.clientHeight — the SAME layout-viewport reference that
 * position:fixed resolves against (innerHeight/vv.height are not). This is
 * self-consistent in BOTH resize modes: if the layout already shrank,
 * offsetTop+vv.height ≈ clientHeight so occluded ≈ 0 (no double-subtract, the
 * inset already sits the box above the keyboard); if it did NOT shrink,
 * occluded is the real keyboard band and `bottom` lifts the box onto it. No
 * transform is introduced (that would re-break input tap-focus on iOS).
 * H5 + phone only; desktop keeps the CSS dvh height (it opts out of page-lock).
 */
const vvStyle = ref<Record<string, string> | undefined>(undefined)
const vvDebug = ref('')
// #ifdef H5
let vv: any = null
let dbg = false
function syncVV() {
  if (!vv) return
  if (window.innerWidth >= 768) { vvStyle.value = undefined; vvDebug.value = ''; return }
  const lay = document.documentElement.clientHeight || window.innerHeight
  const visibleBottom = Math.round(vv.offsetTop + vv.height)
  const occluded = Math.max(0, Math.min(lay - visibleBottom, lay - 1))
  vvStyle.value = occluded > 0 ? { bottom: `${occluded}px` } : undefined
  // Diagnostic readout. Off by default; flip on with ?kbdebug in the URL so it
  // works on the production build too (import.meta.env.DEV is false there).
  if (dbg) {
    vvDebug.value = `cH${lay} iH${Math.round(window.innerHeight)} vvH${Math.round(vv.height)} oT${Math.round(vv.offsetTop)} occ${occluded}`
  }
}
onMounted(() => {
  try { dbg = import.meta.env.DEV || window.location.href.indexOf('kbdebug') !== -1 } catch {}
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
/* #ifdef H5 */
@media (max-width: 767px) {
  /* .page-lock is position:fixed; top:0 + the JS-driven `bottom` govern the box.
     Drop the explicit dvh height so the box is NOT over-constrained (top + bottom
     + height = over-constrained → `bottom` is dropped and the inline lift is
     ignored). Paired with the measured `bottom` this does NOT depend on the ICB
     shrinking (which is what made the earlier height:auto attempt fail). */
  .chat-page-wrap { height: auto; }
  /* When the keyboard is up the box is already lifted onto the keyboard top by
     the `bottom` inset, so the composer's home-indicator safe-area padding is
     dead space below it (the cream band Eric saw). Drop it so the input bar
     sits flush at the visible-viewport bottom. The Safari URL pill + form-
     accessory bar below that are browser chrome and can't be removed in a tab. */
  .chat-page-wrap.kb-up :deep(.input-bar) { padding-bottom: 9px; }
}
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
