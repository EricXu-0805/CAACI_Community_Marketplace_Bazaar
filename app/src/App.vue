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
  const search = window.location.search || ''
  /*
   * Supabase returns users from a password-reset email in TWO shapes,
   * depending on the auth flow:
   *
   *   · PKCE flow (our current setting, `flowType: 'pkce'`):
   *       https://site.com/?code=<uuid>
   *     The exchange is done via supabase.auth.exchangeCodeForSession(code).
   *
   *   · Implicit flow (legacy):
   *       https://site.com/#access_token=<jwt>&refresh_token=<jwt>&type=recovery
   *     The exchange is done via supabase.auth.setSession({...}).
   *
   * Previous iterations of this code only looked at the hash, missing
   * PKCE entirely — users were silently dropped at the home page with
   * no password form. We now detect BOTH and stash whichever parameters
   * are present on `window` so the reset-password page can consume them
   * after uni-app's reLaunch wipes the URL.
   */
  const hashIsRecovery = hash.includes('type=recovery') || hash.includes('access_token=')
  const searchIsRecovery = /[?&]code=[^&]+/.test(search)
  if (!hashIsRecovery && !searchIsRecovery) return false

  const onReset = hash.startsWith('#/pages/reset-password')
  if (onReset) return false

  try {
    ;(window as any).__authRecoveryHash = hash
    ;(window as any).__authRecoverySearch = search
  } catch {}

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
/*
 * ============================================================
 * Illini Market · 米白书院 (Ivory Academy) type + color system.
 *
 * Fonts load on H5 only (Google Fonts CDN). WeChat / Alipay /
 * Baidu mini-program builds ignore the @import and fall through
 * to the system stack — PingFang SC stays the Chinese rendering
 * path there until we self-host woff2 files under /static/fonts.
 *
 * Stack philosophy:
 *   · Display + prices + brand word-marks → Fraunces (EN) + Noto
 *     Serif SC (中文). Scholarly, bookshop-on-Green-Street feel.
 *   · UI body + meta + chips → Noto Sans SC for CN screen clarity
 *     at 11-13px (衬线在这个字号糊), Source Serif 4 / system for EN.
 *   · display=swap so we never block LCP behind webfonts; a system
 *     fallback renders immediately and swaps once Fraunces loads.
 * ============================================================ */
/* #ifdef H5 */
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Noto+Serif+SC:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600&display=swap');
/* #endif */

page {
  /* Ivory cream background matches the 米白书院 redesign and stays
     consistent across all pages. Individual .page containers are
     allowed to stack elev-1 (paper) surfaces on top for cards. */
  background-color: #F5F0E6;
  font-family:
    'Noto Sans SC',
    -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text',
    'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 15px;
  line-height: 1.5;
  color: #2A2A2E;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  letter-spacing: -0.01em;
  font-feature-settings: 'kern', 'ss01';
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
 * ============================================================
 * Design tokens — 米白书院 (Ivory Academy) palette v3.
 *
 * Ports the production design-system tokens from
 *   /Users/xiaogangxu/Downloads/Illini Market Design System/
 *   ui_kits/ivory_academy/tokens.css
 *
 * Migration history:
 *   v1 — neutral grey (#fafafb + #1a1a1a black)
 *   v2 — warm campus market (#faf7f0 cream + #FF5A4C coral)
 *   v3 — 米白书院 (#F5F0E6 ivory + #C74A2F terracotta) ← here
 *
 * Legacy variable names are preserved so every page cascades
 * without code edits — `var(--accent-primary)` now evaluates to
 * terracotta instead of coral, `var(--bg-page)` to ivory instead
 * of cream. New semantic names (--brand, --canvas, --paper,
 * --ink, --ink-soft) are added alongside and SHOULD be preferred
 * for new code.
 *
 * Palette reference:
 *   · Brand  #C74A2F  terracotta — prices, CTAs, brand seal
 *   · Canvas #F5F0E6  ivory cream — page background
 *   · Paper  #FBF8F2  brighter cream — card/sheet surface
 *   · Ink    #2A2A2E  soft near-black — body text
 *   · Border #E8DFCC  warm beige hairline
 *   · Success #5D7C4A sage — verified, free, safe-pickup
 *   · Warning #D4923C amber — OBO, price-drop, scam
 *   · Danger  #B53333 scholarly red — destructive
 *
 * Radius scale: xs 4 · sm 8 · md 12 · lg 18 · xl 28 · pill 999.
 * Shadow tints use rgba(31,29,27,...) — warm grey, NOT pure black.
 */
:root {
  /* ---------- TEXT (legacy names, still used by many pages) ---------- */
  --text-primary:   #2A2A2E;   /* ink       */
  --text-secondary: #57524B;   /* ink-soft  */
  --text-tertiary:  #6B6358;
  --text-muted:     #8B8478;   /* ink-quiet */
  --text-faint:     #B6AE9F;
  --text-disabled:  #B6AE9F;

  /* ---------- NEW SEMANTIC NAMES (prefer these going forward) ------- */
  --ink:         #2A2A2E;
  --ink-soft:    #57524B;
  --ink-quiet:   #8B8478;
  --ink-faint:   #B6AE9F;

  /* ---------- SURFACES ---------- */
  --bg-page:    #F5F0E6;   /* canvas    */
  --bg-elev-1:  #FBF8F2;   /* paper     */
  --bg-elev-2:  #F0E9DA;   /* paper-2   */
  --bg-subtle:  #F0E9DA;   /* chip / input bg */
  --bg-inset:   #E8DFCC;   /* pressed chip   */

  --canvas:     #F5F0E6;
  --paper:      #FBF8F2;
  --paper-2:    #F0E9DA;
  --paper-3:    #E8DFCC;

  /* ---------- BORDERS ---------- */
  --line-hair:  rgba(31, 29, 27, 0.08);
  --line-soft:  rgba(31, 29, 27, 0.12);
  --line-bold:  rgba(31, 29, 27, 0.18);

  --border:        #E8DFCC;
  --border-strong: #D8CDB3;
  --border-hair:   rgba(31, 29, 27, 0.08);

  /* ---------- BRAND (the one color that spends energy) ---------- */
  --brand:          #C74A2F;   /* terracotta — price · CTA · seal */
  --brand-deep:     #A23A22;   /* hover / pressed */
  --brand-soft:     #F5D9CE;   /* chip bg · soft fill */
  --brand-ghost:    #FBEAE2;   /* hover tint on paper */

  /* Legacy accent names map to brand so existing pages cascade. */
  --accent-primary:      var(--brand);
  --accent-primary-soft: var(--brand-soft);
  --accent-primary-deep: var(--brand-deep);
  --accent-action:       var(--brand);
  --accent-ink:          var(--ink);
  --accent-green:        #5D7C4A;
  --accent-good:         #5D7C4A;   /* success · was #22c55e */
  --accent-warn:         #D4923C;   /* warning · was #FF9500 */
  --accent-danger:       #B53333;   /* danger  · was #FF3B30 */

  /* Explicit success / warn / danger pairs (soft bg + foreground) */
  --success:      #5D7C4A;
  --success-soft: #E4EADA;
  --warning:      #D4923C;
  --warning-soft: #F5E4CB;
  --danger:       #B53333;
  --danger-soft:  #F0D4D4;

  /* ---------- RADII (ivory_academy 5 steps) ---------- */
  --radius-xs:    4px;
  --radius-sm:    8px;
  --radius-md:   12px;
  --radius-lg:   18px;
  --radius-xl:   28px;
  --radius-pill: 999px;

  /* ---------- SPACING (4pt grid) ---------- */
  --space-1:  4px;
  --space-2:  8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-7: 32px;
  --space-8: 48px;

  /* ---------- WEIGHT ---------- */
  --font-weight-regular: 400;
  --font-weight-medium:  500;
  --font-weight-semi:    600;
  --font-weight-bold:    700;

  /* ---------- TYPE FAMILIES ---------- */
  --font-serif:
    'Fraunces', 'Noto Serif SC', 'Songti SC', Georgia, 'Times New Roman', serif;
  --font-hei:
    'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'PingFang SC',
    'Microsoft YaHei', 'Helvetica Neue', sans-serif;
  --font-mono:
    'JetBrains Mono', 'SF Mono', Menlo, ui-monospace, monospace;

  /* ---------- ELEVATION (warm-tinted, not pure black) ---------- */
  --shadow-hair:       0 0 0 1px rgba(31, 29, 27, 0.06);
  --shadow-soft:       0 1px 2px rgba(31, 29, 27, 0.04),
                       0 4px 12px rgba(31, 29, 27, 0.04);
  --shadow-pop:        0 2px 4px rgba(31, 29, 27, 0.05),
                       0 12px 28px rgba(31, 29, 27, 0.08);
  --shadow-float:      0 1px 2px rgba(31, 29, 27, 0.06),
                       0 24px 56px -16px rgba(31, 29, 27, 0.18);
  --shadow-cta:        0 2px 4px rgba(199, 74, 47, 0.15),
                       0 12px 28px -8px rgba(199, 74, 47, 0.28);
  --shadow-brand:      var(--shadow-cta);
}

/*
 * ============================================================
 * Shared utility classes. Opt-in per page; not forced on
 * existing components so we don't break their scoped styles.
 *
 * TYPE CLASSES (ivory_academy ladder) — prefer these over
 * inline font-size hex stacks:
 *   .t-display      — Fraunces 28px hero word-mark
 *   .t-title-serif  — Fraunces 22px section title
 *   .t-price-serif  — Fraunces 22px terracotta price
 *   .t-label        — mono eyebrow 10px uppercase
 *   .t-meta         — 12px ink-quiet for timestamps, counters
 *
 * Use serif on numbers + brand + prices + headings; sans on
 * everything else. Never mix serif for a 10-11px CN label —
 * it glyph-crams on retina screens.
 * ============================================================ */

/* ---------- TYPE ---------- */
.t-display {
  font-family: var(--font-serif);
  font-size: 28px;
  line-height: 1.1;
  font-weight: 500;
  letter-spacing: -0.5px;
  color: var(--ink);
}
.t-title-serif {
  font-family: var(--font-serif);
  font-size: 22px;
  line-height: 1.25;
  font-weight: 500;
  letter-spacing: -0.3px;
  color: var(--ink);
}
.t-subtitle-serif {
  font-family: var(--font-serif);
  font-size: 15px;
  line-height: 1.35;
  font-weight: 500;
  color: var(--ink);
}
.t-price-serif {
  font-family: var(--font-serif);
  font-size: 22px;
  font-weight: 600;
  line-height: 1;
  color: var(--brand);
  letter-spacing: -0.01em;
  font-feature-settings: 'tnum';
}
.t-price-serif.sm { font-size: 17px; }
.t-price-serif.free { color: var(--success); }

.t-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: var(--ink-quiet);
  font-weight: 500;
}
.t-meta {
  font-size: 12px;
  line-height: 1.4;
  color: var(--ink-quiet);
}

/* ---------- SURFACES ---------- */
.u-card {
  background: var(--paper);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-soft);
}
.u-card.flat { box-shadow: none; }
.u-divider {
  height: 0.5px;
  background: var(--border-hair);
  width: 100%;
}

/* ---------- BUTTONS ----------
 *   .u-btn-primary = terracotta brand (backward-compat alias: the
 *                    previous coral `--accent-primary` callers now
 *                    inherit the ivory_academy brand tone with no
 *                    per-page edits)
 *   .u-btn-brand   = terracotta brand (explicit name)
 *   .u-btn-ink     = deep-ink CTA ladder — used for "default" action
 *                    buttons in ivory_academy (e.g. "Apply filters")
 *                    when brand should stay reserved for commits
 *                    ("Post Item", "Confirm Sold")
 *   .u-btn-ghost   = paper-2 neutral
 */
.u-btn-primary,
.u-btn-brand {
  background: var(--brand);
  color: #fff;
  padding: 12px 18px;
  border-radius: var(--radius-pill);
  font-size: 15px;
  font-weight: var(--font-weight-semi);
  text-align: center;
  cursor: pointer;
  border: 0;
  box-shadow: var(--shadow-cta);
  transition: background .15s ease, transform .08s ease;
}
.u-btn-primary:active,
.u-btn-brand:active { background: var(--brand-deep); transform: translateY(1px); }

.u-btn-ink {
  background: var(--ink);
  color: var(--canvas);
  padding: 12px 18px;
  border-radius: var(--radius-pill);
  font-size: 15px;
  font-weight: var(--font-weight-semi);
  text-align: center;
  cursor: pointer;
  border: 0;
  transition: opacity .15s ease, transform .08s ease;
}
.u-btn-ink:active { opacity: 0.85; transform: translateY(1px); }

.u-btn-ghost {
  background: var(--paper-2);
  color: var(--ink);
  padding: 12px 18px;
  border-radius: var(--radius-pill);
  font-size: 15px;
  font-weight: var(--font-weight-semi);
  text-align: center;
  cursor: pointer;
  border: 0;
}
.u-btn-ghost:active { background: var(--paper-3); }

/* Chip / pill rail — used in filters, tags, category bar */
.u-chip {
  font-size: 12px;
  font-weight: 500;
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--ink-soft);
  border: 0.5px solid var(--border-strong);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  cursor: pointer;
}
.u-chip.active {
  background: var(--ink);
  color: var(--canvas);
  border-color: var(--ink);
}
.u-chip.brand {
  background: var(--brand-soft);
  color: var(--brand-deep);
  border-color: transparent;
}
</style>
