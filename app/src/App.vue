<script setup lang="ts">
import { onLaunch } from "@dcloudio/uni-app"
import { useAuth } from "./composables/useAuth"
import { useI18n } from "./composables/useI18n"

const { init } = useAuth()
const { t } = useI18n()

function detectAuthRecoveryAndRoute(): boolean {
  // #ifdef H5
  if (typeof window === 'undefined') return false
  const hash = window.location.hash || ''
  const isRecovery = hash.includes('type=recovery') || hash.includes('access_token=')
  if (!isRecovery) return false
  const alreadyOnReset = hash.startsWith('#/pages/reset-password')
  if (alreadyOnReset) return false
  uni.reLaunch({ url: '/pages/reset-password/index' })
  return true
  // #endif
  // #ifndef H5
  return false
  // #endif
}

onLaunch(() => {
  init()
  const routedToReset = detectAuthRecoveryAndRoute()
  try {
    if (!routedToReset && !uni.getStorageSync('welcomed')) {
      uni.reLaunch({ url: '/pages/welcome/index' })
    }
  } catch {}
  uni.onUnhandledRejection?.((e: any) => {
    console.error('Unhandled rejection:', e.reason)
  })
  uni.onNetworkStatusChange?.((res: { isConnected: boolean }) => {
    if (!res.isConnected) {
      uni.showToast({ title: t('error.noNetwork'), icon: 'none', duration: 3000 })
    }
  })
})
</script>

<style>
page {
  background-color: #f7f7f8;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text',
    'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 15px;
  line-height: 1.5;
  color: #1a1a1a;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  letter-spacing: -0.01em;
}

/* ============================================
   On H5 mobile, uni-app's internal uni-page-wrapper
   / uni-page-body elements scroll instead of letting
   the inner .page do it. That makes the page header
   scroll off screen. The .page-lock class takes the
   page out of normal flow entirely (fixed inset 0),
   so there is nothing above it that can scroll.
   Desktop (>=768px) opts out since those pages want
   to scroll normally with the desktop nav on top.
   ============================================ */
html, body, uni-app, uni-page, uni-page-wrapper, uni-page-body, #app {
  overscroll-behavior: none;
}

@media (max-width: 767px) {
  .page-lock {
    position: fixed !important;
    top: 0; left: 0; right: 0; bottom: 0;
    max-width: none !important;
    margin: 0 !important;
    z-index: 1;
  }
}

uni-tabbar, .uni-tabbar, .uni-tabbar-bottom {
  display: none !important;
}

view, text { box-sizing: border-box; }

input, textarea {
  font-family: inherit;
  letter-spacing: inherit;
}
</style>
