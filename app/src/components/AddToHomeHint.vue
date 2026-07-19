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
 */
import { ref, onMounted } from 'vue'
import { useI18n } from '../composables/useI18n'
import UIcon from './UIcon.vue'

const { t } = useI18n()
const show = ref(false)
const KEY = 'a2hs_dismissed_v1'

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
    const dismissed = localStorage.getItem(KEY) === '1'
    // Phone widths only (≥768 uses the desktop sidebar shell, not a tab/PWA flow).
    if (isIOS && !standalone && !dismissed && window.innerWidth < 768) {
      // A short beat so it doesn't fight first paint.
      setTimeout(() => { show.value = true }, 1200)
    }
  } catch {}
})
// #endif

function dismiss() {
  show.value = false
  // #ifdef H5
  try { localStorage.setItem(KEY, '1') } catch {}
  // #endif
}
</script>

<style scoped>
/* #ifdef H5 */
.a2hs {
  position: fixed; z-index: 300;
  left: 12px; right: 12px;
  top: calc(env(safe-area-inset-top, 0px) + 58px);
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  background: var(--bg-elev-1);
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
  animation: a2hs-in 0.32s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}
@keyframes a2hs-in {
  from { opacity: 0; transform: translateY(-12px); }
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
/* #endif */
</style>
