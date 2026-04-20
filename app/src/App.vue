<script setup lang="ts">
import { watch } from 'vue'
import { onLaunch } from "@dcloudio/uni-app"
import { useAuth } from "./composables/useAuth"
import { useI18n } from "./composables/useI18n"
import { CURRENT_CONSENT_VERSION } from './legal'

const { init, currentUser } = useAuth()
const { t } = useI18n()

/*
 * Re-consent + onboarding gate.
 *
 * Runs whenever the logged-in profile changes (login, signup, page
 * refresh). Decides in order:
 *   1. If profile has no onboarded_at → send to the onboarding wizard.
 *   2. Else if profile.tos_version < CURRENT_CONSENT_VERSION → send
 *      to the re-consent screen.
 *   3. Else let the user through.
 *
 * We exempt a handful of routes from the redirect so users can actually
 * READ the ToS and Privacy on those screens, and so the routing step
 * of the gate itself doesn't fight with auth / password-reset flows.
 */
const GATE_EXEMPT_PAGES = [
  'pages/onboarding/index',
  'pages/reconsent/index',
  'pages/suspended/index',
  'pages/legal/index',
  'pages/login/index',
  'pages/reset-password/index',
  'pages/welcome/index',
  'pages/settings/index',
]

function currentPagePath(): string {
  try {
    const pages = getCurrentPages() as Array<{ route?: string }>
    if (pages.length === 0) return ''
    return pages[pages.length - 1].route || ''
  } catch {
    return ''
  }
}

function isSuspensionActive(u: { suspension_level?: number; suspended_until?: string | null }): boolean {
  if (!u.suspension_level || u.suspension_level < 2) return false
  if (!u.suspended_until) return true
  const ends = Date.parse(u.suspended_until)
  if (Number.isNaN(ends)) return true
  return ends > Date.now()
}

function enforceConsentGate() {
  const u = currentUser.value
  if (!u) return
  const here = currentPagePath()
  if (GATE_EXEMPT_PAGES.some(p => here === p)) return

  if (isSuspensionActive(u)) {
    uni.reLaunch({ url: '/pages/suspended/index' })
    return
  }
  if (!u.onboarded_at) {
    uni.reLaunch({ url: '/pages/onboarding/index' })
    return
  }
  if (!u.tos_version || u.tos_version < CURRENT_CONSENT_VERSION) {
    uni.reLaunch({ url: '/pages/reconsent/index' })
  }
}

watch(currentUser, () => {
  setTimeout(enforceConsentGate, 100)
})

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

/* ============================================
   Global scrollbar suppression for all uni-app
   <scroll-view> elements on H5. uni-app compiles
   scroll-view to a wrapper containing an inner
   <div class="uni-scroll-view"> which is the actual
   scroller. Page-level scoped styles can't reach that
   div, so we hide it globally here. This is stronger
   than per-component :show-scrollbar="false". Pages
   can still opt into visible scrollbars by overriding
   this on a specific class if needed.
   ============================================ */
uni-scroll-view ::-webkit-scrollbar,
.uni-scroll-view::-webkit-scrollbar {
  width: 0 !important;
  height: 0 !important;
  display: none !important;
  background: transparent !important;
}
uni-scroll-view, .uni-scroll-view {
  scrollbar-width: none !important;
  -ms-overflow-style: none !important;
}

view, text { box-sizing: border-box; }

input, textarea {
  font-family: inherit;
  letter-spacing: inherit;
}

input:focus-visible,
textarea:focus-visible,
button:focus-visible,
.focusable:focus-visible {
  outline: 2px solid #1a7aff !important;
  outline-offset: 2px;
  border-radius: 4px;
}

.hit-target {
  position: relative;
}
.hit-target::after {
  content: '';
  position: absolute;
  inset: -8px;
  min-width: 44px;
  min-height: 44px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

:root {
  --text-secondary: #5a5a63;
  --text-tertiary:  #767680;
  --text-disabled:  #a0a0a8;
}
</style>
