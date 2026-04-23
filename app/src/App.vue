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
  /*
   * Body defaults per the refinement-pass "fix the plastic feel" rules:
   *   letter-spacing 0.02em + line-height 1.7 + color #13294B.
   * Tight 0 letter-spacing + 1.4 line-height was the single biggest
   * source of cram-scanned-like-plastic vibes on CJK screens.
   *
   * Uses CSS variables so dark mode can flip everything via
   * [data-theme="dark"] on <html> or via system preference.
   */
  background-color: var(--canvas);
  font-family:
    'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC',
    -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text',
    'Helvetica Neue', 'Microsoft YaHei', system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.6;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  letter-spacing: 0.02em;
  font-feature-settings: 'kern';
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
 * Design tokens — UIUC Fusion (refinement pass v4).
 *
 * Ports the production design-system tokens from
 *   /Users/xiaogangxu/Downloads/Illini Market Design System/
 *   uploads/illini_refinement_pass_tab_typography_search.html
 *
 * This is the explicit "fix the plastic feel" pass. The old
 * v3 ivory_academy went too warm (terracotta + ink); the real
 * Illini Market direction is:
 *   · UIUC Illini Blue  #13294B  → all body text + titles
 *   · Illini Orange     #E84A27  → brand · price · CTA
 *   · Warm parchment    #FBF7EB  → canvas
 *   · White surface     #FFFFFF  → cards sitting on the canvas
 *   · Paper / tab bg    #F6F0DF  → tab bar + inset chips
 *   · UIUC-blue borders rgba(19,41,75,0.08) — subtle cool cast,
 *     not warm beige. This is why the app feels "crisper" in
 *     the refinement pass.
 *
 * Migration history:
 *   v1 — neutral grey (#fafafb + #1a1a1a black)
 *   v2 — warm campus market (#faf7f0 cream + #FF5A4C coral)
 *   v3 — 米白书院 (#F5F0E6 ivory + #C74A2F terracotta)
 *   v4 — UIUC Fusion (#FBF7EB + #13294B + #E84A27) ← here
 *
 * Legacy variable names (--accent-primary, --bg-page, --text-*)
 * are preserved so every page cascades without code edits.
 */
:root {
  /* ---------- TEXT (all tiers cascade from UIUC navy) ---------- */
  --text-primary:   #13294B;   /* ink       — UIUC Illini Blue */
  --text-secondary: #3E3D35;   /* ink-soft  — warm near-black */
  --text-tertiary:  #4A4738;
  --text-muted:     #6B6A5A;   /* ink-quiet — warm stone */
  --text-faint:     #8E8C7E;   /* ink-faint — scaffolding */
  --text-disabled:  #B0AE9E;

  /* ---------- NEW SEMANTIC NAMES (prefer these going forward) ---------- */
  --ink:         #13294B;   /* UIUC navy — body + titles */
  --ink-soft:    #3E3D35;
  --ink-quiet:   #6B6A5A;
  --ink-faint:   #8E8C7E;
  --ink-inverse: #FBF7EB;   /* text on ink panels */

  /* ---------- SURFACES ----------
   * Three-layer stack — outer frame → canvas (page) → surface (card).
   * Parchment (--parchment / --surface-alt) is a 4th, specific-use
   * tone for tab bar + chip insets so they read as "paper fabric"
   * over the canvas instead of plastic white on top of cream.
   */
  --bg-page:    #FBF7EB;   /* canvas - page background */
  --bg-elev-1:  #FFFFFF;   /* surface - card (pure white) */
  --bg-elev-2:  #F6F0DF;   /* parchment - tab bar + inset bg */
  --bg-subtle:  #F6F0DF;   /* chip / input / meta bg */
  --bg-inset:   #EDE6D5;   /* pressed chip / frame */

  --canvas:        #FBF7EB;
  --surface:       #FFFFFF;
  --surface-alt:   #F6F0DF;   /* alias · parchment */
  --parchment:     #F6F0DF;
  --frame:         #EDE6D5;

  /* Legacy paper aliases (back-compat with Phase 1-3 code) */
  --paper:      #FFFFFF;
  --paper-2:    #F6F0DF;
  --paper-3:    #EDE6D5;

  /* ---------- BORDERS (UIUC blue alpha — gives subtle cool cast) ---------- */
  --line-hair:  rgba(19, 41, 75, 0.08);
  --line-soft:  rgba(19, 41, 75, 0.12);
  --line-bold:  rgba(19, 41, 75, 0.18);

  --border:        rgba(19, 41, 75, 0.08);
  --border-strong: rgba(19, 41, 75, 0.18);
  --border-hair:   rgba(19, 41, 75, 0.06);
  --border-warm:   #E8DFCC;   /* legacy warm beige — kept for opt-in retro surfaces */

  /* ---------- BRAND (Illini Orange) ---------- */
  --brand:          #E84A27;   /* Illini orange — price · CTA · seal */
  --brand-deep:     #B43A1C;   /* hover / pressed · Altgeld-ish */
  --brand-soft:     #FDEEE8;   /* chip bg · soft fill */
  --brand-ghost:    #FDF5F0;   /* hover tint on white */

  /* ---------- UIUC Campus accents (verified badge / official content) ---------- */
  --campus-blue:      #13294B;
  --campus-blue-soft: #E5EAF2;
  --campus-orange:    #E84A27;
  --campus-orange-deep: #B43A1C;

  /* Legacy accent names map to brand so existing pages cascade. */
  --accent-primary:      var(--brand);
  --accent-primary-soft: var(--brand-soft);
  --accent-primary-deep: var(--brand-deep);
  --accent-action:       var(--brand);
  --accent-ink:          var(--ink);
  --accent-green:        #5D7C4A;
  --accent-good:         #5D7C4A;
  --accent-warn:         #D4923C;
  --accent-danger:       #B53333;

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

  /* ---------- ELEVATION (UIUC navy alpha — crisper than warm brown) ---------- */
  --shadow-hair:       0 0 0 1px rgba(19, 41, 75, 0.06);
  --shadow-soft:       0 1px 2px rgba(19, 41, 75, 0.04),
                       0 4px 12px rgba(19, 41, 75, 0.06);
  --shadow-pop:        0 2px 4px rgba(19, 41, 75, 0.05),
                       0 12px 28px rgba(19, 41, 75, 0.10);
  --shadow-float:      0 1px 2px rgba(19, 41, 75, 0.06),
                       0 24px 56px -16px rgba(19, 41, 75, 0.20);
  --shadow-cta:        0 2px 4px rgba(232, 74, 39, 0.15),
                       0 12px 28px -8px rgba(232, 74, 39, 0.28);
  --shadow-brand:      var(--shadow-cta);

  /* ----------------------------------------------------------
   * MOTION — 5 durations × 5 easing curves, from motion.html
   *
   *   dur-1 120ms  micro   button hover, chip toggle
   *   dur-2 220ms  tap     press state, card lift
   *   dur-3 360ms  sheet   bottom sheet, drawer, toast
   *   dur-4 560ms  page    page transition, detail open
   *   dur-5 900ms  story   onboarding, loading spinner
   *
   *   ease-std   default (slow-fast-slow)
   *   ease-in    element entrance
   *   ease-out   element exit
   *   ease-warm  card lift, like bounce (spring-ish)
   *   ease-crisp tab switch, emphasis
   * ---------------------------------------------------------- */
  --dur-1: 120ms;
  --dur-2: 220ms;
  --dur-3: 360ms;
  --dur-4: 560ms;
  --dur-5: 900ms;
  --ease-std:   cubic-bezier(0.4, 0, 0.2, 1);
  --ease-in:    cubic-bezier(0, 0, 0.2, 1);
  --ease-out:   cubic-bezier(0.4, 0, 1, 1);
  --ease-warm:  cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-crisp: cubic-bezier(0.7, 0, 0.3, 1);
}

/*
 * ============================================================
 * Dark mode — "夜读书房" (night study)
 *
 * Two triggers (either one activates):
 *   1. html[data-theme="dark"]  — manual toggle (prefer this)
 *   2. @media (prefers-color-scheme: dark) — system setting
 *
 * Ported from uni.scss L194-221. The dark palette is warm-tinted
 * rather than cool — keeps the "paper" feel consistent with the
 * light canvas. Brand orange lightens from #E84A27 → #E06A4A to
 * stay legible on dark ink.
 * ============================================================ */
[data-theme="dark"] {
  --ink:         #F0E8D6;
  --ink-soft:    rgba(240, 232, 214, 0.72);
  --ink-quiet:   rgba(240, 232, 214, 0.52);
  --ink-faint:   rgba(240, 232, 214, 0.32);
  --ink-inverse: #1C1A17;

  --text-primary:   var(--ink);
  --text-secondary: var(--ink-soft);
  --text-tertiary:  var(--ink-soft);
  --text-muted:     var(--ink-quiet);
  --text-faint:     var(--ink-faint);
  --text-disabled:  rgba(240, 232, 214, 0.22);

  --bg-page:    #1C1A17;
  --bg-elev-1:  #26231E;
  --bg-elev-2:  #2E2A23;
  --bg-subtle:  #2E2A23;
  --bg-inset:   #332F28;

  --canvas:     #1C1A17;
  --surface:    #26231E;
  --surface-alt: #2E2A23;
  --parchment:  #2E2A23;
  --frame:      #332F28;
  --paper:      #26231E;
  --paper-2:    #2E2A23;
  --paper-3:    #332F28;

  --line-hair:  rgba(240, 232, 214, 0.08);
  --line-soft:  rgba(240, 232, 214, 0.12);
  --line-bold:  rgba(240, 232, 214, 0.18);
  --border:        rgba(240, 232, 214, 0.10);
  --border-strong: rgba(240, 232, 214, 0.20);
  --border-hair:   rgba(240, 232, 214, 0.06);

  --brand:       #E06A4A;
  --brand-deep:  #C45A3A;
  --brand-soft:  rgba(224, 106, 74, 0.15);
  --brand-ghost: rgba(224, 106, 74, 0.08);

  --success:      #8BA670;
  --success-soft: rgba(139, 166, 112, 0.15);
  --warning:      #E5B170;
  --warning-soft: rgba(229, 177, 112, 0.15);
  --danger:       #E06666;
  --danger-soft:  rgba(224, 102, 102, 0.15);

  --accent-good:   var(--success);
  --accent-warn:   var(--warning);
  --accent-danger: var(--danger);

  --shadow-hair: 0 0 0 1px rgba(0, 0, 0, 0.3);
  --shadow-soft: 0 1px 2px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2);
  --shadow-pop:  0 2px 4px rgba(0, 0, 0, 0.35), 0 12px 28px rgba(0, 0, 0, 0.3);
  --shadow-float:0 1px 2px rgba(0, 0, 0, 0.4), 0 24px 56px -16px rgba(0, 0, 0, 0.5);
  --shadow-cta:  0 2px 4px rgba(224, 106, 74, 0.25), 0 12px 28px -8px rgba(224, 106, 74, 0.4);
}

/*
 * System-preference fallback — honors the user's OS theme when
 * they haven't manually overridden via data-theme="dark". Lets
 * the app ship with no settings UI and still feel dark-native
 * for night users.
 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ink:         #F0E8D6;
    --ink-soft:    rgba(240, 232, 214, 0.72);
    --ink-quiet:   rgba(240, 232, 214, 0.52);
    --ink-faint:   rgba(240, 232, 214, 0.32);
    --ink-inverse: #1C1A17;

    --text-primary:   var(--ink);
    --text-secondary: var(--ink-soft);
    --text-tertiary:  var(--ink-soft);
    --text-muted:     var(--ink-quiet);
    --text-faint:     var(--ink-faint);

    --bg-page:    #1C1A17;
    --bg-elev-1:  #26231E;
    --bg-elev-2:  #2E2A23;
    --bg-subtle:  #2E2A23;
    --bg-inset:   #332F28;

    --canvas:     #1C1A17;
    --surface:    #26231E;
    --surface-alt: #2E2A23;
    --parchment:  #2E2A23;
    --frame:      #332F28;
    --paper:      #26231E;
    --paper-2:    #2E2A23;
    --paper-3:    #332F28;

    --line-hair:  rgba(240, 232, 214, 0.08);
    --border:        rgba(240, 232, 214, 0.10);
    --border-strong: rgba(240, 232, 214, 0.20);

    --brand:       #E06A4A;
    --brand-deep:  #C45A3A;
    --brand-soft:  rgba(224, 106, 74, 0.15);
  }
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
