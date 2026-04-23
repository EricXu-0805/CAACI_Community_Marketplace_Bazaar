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
  /*
   * IMPORTANT: reLaunch overwrites the URL hash, which would strip the
   * Supabase recovery token (access_token=... / type=recovery) that
   * detectSessionInUrl relies on. We stash the raw auth hash on window
   * so /pages/reset-password/index can re-parse it after navigation.
   * This must run synchronously BEFORE reLaunch, otherwise the SDK will
   * silently fail to produce a session and the page renders blank.
   */
  try { (window as any).__authRecoveryHash = hash } catch {}
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
  /* Warm cream background matches the Illini Market redesign and stays
     consistent across all pages. Individual .page containers are allowed
     to stack elev-1 (pure white) surfaces on top for cards. */
  background-color: #faf7f0;
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

/*
 * Design tokens — "Warm Campus Market" palette.
 *
 * This used to be a neutral grey scheme (#fafafb cool bg + black primary).
 * The redesigned CAACI brief is a warmer, friendlier market feel — cream
 * background, coral-red primary, soft earthy dividers, pill buttons. We
 * keep all the old variable *names* so every page updates atomically;
 * only their values change. The small handful of one-off hex literals
 * still sprinkled in page SCSS will get mopped up opportunistically.
 *
 * Palette reference:
 *   - Primary / CTA:  #FF5A4C coral red (was #1a1a1a black)
 *   - Primary soft:   #FFE8E4 (tag bg, hover tint)
 *   - Background:     #FAF7F0 cream off-white (was #fafafb cool grey)
 *   - Card surface:   #FFFFFF
 *   - Border hair:    #EFEAE0 warm beige
 *   - Accent:         #2D5B4E dark green (complement, use sparingly)
 *
 * Radius scale: xs 6, sm 8, md 12, lg 16, pill 22 (button height /2).
 */
:root {
  --text-primary:   #1a1a1a;
  --text-secondary: #4a4a4a;
  --text-tertiary:  #6e6e6e;
  --text-muted:     #8a8a8a;
  --text-faint:     #b8b8b8;
  --text-disabled:  #a0a0a8;

  --bg-page:    #faf7f0;
  --bg-elev-1:  #ffffff;
  --bg-elev-2:  #f5f0e8;
  --bg-subtle:  #f2ece0;
  --bg-inset:   #efeae0;

  --line-hair:  rgba(60, 40, 20, 0.06);
  --line-soft:  rgba(60, 40, 20, 0.10);
  --line-bold:  rgba(60, 40, 20, 0.14);

  --accent-primary: #FF5A4C;
  --accent-primary-soft: #FFE8E4;
  --accent-primary-deep: #E64A3D;
  --accent-action:  #FF5A4C;
  --accent-ink:     #1a1a1a;
  --accent-green:   #2D5B4E;
  --accent-good:    #22c55e;
  --accent-warn:    #FF9500;
  --accent-danger:  #FF3B30;

  --radius-xs:   6px;
  --radius-sm:   8px;
  --radius-md:  12px;
  --radius-lg:  16px;
  --radius-xl:  20px;
  --radius-pill: 999px;

  --space-1:  4px;
  --space-2:  8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;

  --font-weight-regular: 400;
  --font-weight-medium:  500;
  --font-weight-semi:    600;
  --font-weight-bold:    700;

  --shadow-soft: 0 1px 2px rgba(60, 40, 20, 0.03), 0 2px 12px rgba(60, 40, 20, 0.04);
  --shadow-pop:  0 4px 16px rgba(60, 40, 20, 0.08);
  --shadow-cta:  0 6px 14px rgba(255, 90, 76, 0.28);
}

/*
 * Shared utility classes. Opt-in per page; not forced on existing
 * components so we don't break their scoped styles.
 */
.u-card {
  background: var(--bg-elev-1);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-soft);
}
.u-divider {
  height: 0.5px;
  background: var(--line-hair);
  width: 100%;
}
.u-btn-primary {
  background: var(--accent-primary);
  color: #fff;
  padding: 12px 18px;
  border-radius: var(--radius-pill);
  font-size: 15px;
  font-weight: var(--font-weight-semi);
  text-align: center;
  cursor: pointer;
}
.u-btn-primary:active { opacity: 0.85; }
.u-btn-ghost {
  background: var(--bg-subtle);
  color: var(--text-primary);
  padding: 12px 18px;
  border-radius: var(--radius-pill);
  font-size: 15px;
  font-weight: var(--font-weight-semi);
  text-align: center;
  cursor: pointer;
}
.u-btn-ghost:active { background: var(--bg-inset); }
</style>
