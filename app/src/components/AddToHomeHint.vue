<template>
  <!-- #ifdef H5 -->
  <view v-if="show" class="a2hs">
    <image class="a2hs-icon" src="/static/logo-mark.svg" :alt="t('app.name')" mode="aspectFit" />
    <view class="a2hs-text">
      <text class="a2hs-title">{{ t('a2hs.title') }}</text>
      <text class="a2hs-body">{{ t('a2hs.body') }}</text>
    </view>
    <view class="a2hs-close" role="button" tabindex="0" :aria-label="t('a11y.close')" @click="dismiss" @keydown.enter.prevent="dismiss" @keydown.space.prevent="dismiss">
      <UIcon name="close" size="xs" color="currentColor" aria-hidden="true" />
    </view>
  </view>
  <!-- #endif -->
</template>

<script setup lang="ts">
/*
 * AddToHomeHint — one-time, dismissible nudge for iOS Safari users to install
 * the site as a PWA (manifest.webmanifest already declares display:standalone).
 * Running standalone drops Safari's URL pill + form-accessory bar, which is the
 * unavoidable browser chrome behind the chat-keyboard gap (QA7) — so the install
 * is the real "native feel" fix, not a CSS tweak.
 *
 * H5-only (the whole template + logic compile out of mp-weixin). iOS can't fire
 * beforeinstallprompt, so this is purely instructional (point at Share → Add to
 * Home Screen). Shown once on the home page; dismissal is remembered locally.
 * It floats above the tab bar rather than below the header — see the note on
 * .a2hs for what that position was costing.
 */
import { ref, onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from '../composables/useI18n'
import UIcon from './UIcon.vue'

const { t } = useI18n()
const show = ref(false)
const KEY = 'a2hs_dismissed_v1'
let dismissedForSession = false
let cleanupViewportTracking = () => {}

// #ifdef H5
onMounted(() => {
  try {
    const ua = navigator.userAgent || ''
    // iPadOS 13+ reports as MacIntel with touch; treat it as iOS too.
    const isIOS = /iPad|iPhone|iPod/.test(ua)
      || ((navigator as any).platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1)
    const nav: any = window.navigator
    const standalone = nav.standalone === true
      || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    dismissedForSession = localStorage.getItem(KEY) === '1'
    if (!isIOS || standalone || dismissedForSession) return

    let revealReady = false
    // A phone can enter in a >768px landscape viewport and rotate to portrait
    // without remounting this component. Re-evaluate width on every resize so
    // that initial orientation cannot permanently suppress the hint.
    const updateVisibility = () => {
      show.value = revealReady && !dismissedForSession && window.innerWidth < 768
    }
    window.addEventListener('resize', updateVisibility)
    // A short beat so it doesn't fight first paint. The timer may elapse while
    // landscape is ineligible; the next portrait resize reveals it.
    const revealTimer = setTimeout(() => {
      revealReady = true
      updateVisibility()
    }, 1200)
    cleanupViewportTracking = () => {
      clearTimeout(revealTimer)
      window.removeEventListener('resize', updateVisibility)
    }
  } catch {}
})
// #endif

onBeforeUnmount(() => cleanupViewportTracking())

function dismiss() {
  dismissedForSession = true
  show.value = false
  // #ifdef H5
  try { localStorage.setItem(KEY, '1') } catch {}
  // #endif
}
</script>

<style scoped>
/* #ifdef H5 */
/* Floats low, not under the header. Pinned below the header it covered every
   browse control the home page has — the search field, the filter button and
   both halves of the On sale / Wanted switch — from the 1.2s reveal until the
   reader found the close button. Down here it also points at the Share button
   it names, which lives in Safari's bottom toolbar.
   166px clears the .back-top lane in pages/index/index.vue (bottom 116px +
   40px tall) with a 10px gap; sitting on the tab bar at 70px instead would
   swallow that button whole, since it carries z-index 100 to this one's 300. */
.a2hs {
  position: fixed; z-index: 300;
  left: 12px; right: 12px;
  bottom: calc(166px + env(safe-area-inset-bottom, 0px));
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  background: var(--bg-elev-1);
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
  animation: a2hs-in 0.32s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}
@keyframes a2hs-in {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: none; }
}
.a2hs-icon {
  width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;
}
.a2hs-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.a2hs-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.a2hs-body { font-size: 12px; color: var(--text-secondary); line-height: 1.4; }
.a2hs-close {
  width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
  color: var(--text-subtle); flex-shrink: 0; cursor: pointer;
}
.a2hs-close:active { opacity: 0.6; }

/* A phone in landscape has no fixed vertical lane large enough for this card:
   keeping the 156px back-to-top clearance puts it over the segment/category
   controls, while moving it down would cover the tab/back-to-top controls.
   Hide it for the short landscape viewport and let the same undismissed hint
   reappear when the phone rotates back to portrait. */
@media (orientation: landscape) and (max-height: 500px) {
  .a2hs { display: none; }
}
/* #endif */
</style>
