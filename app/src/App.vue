<script setup lang="ts">
import { ref, watch } from 'vue'
import { onLaunch } from "@dcloudio/uni-app"
import { useAuth } from "./composables/useAuth"
import { useI18n } from "./composables/useI18n"
import { useTheme } from "./composables/useTheme"
import { CURRENT_CONSENT_VERSION } from './legal'
import { captureException } from './utils/sentry'

/*
 * Self-hosted webfonts.
 *
 * These used to come from fonts.googleapis.com at runtime — one remote
 * origin, blocking critical-path CSS, no SRI, and a third-party cookie
 * dependency that the CSP had to special-case. Fontsource ships the
 * same faces as npm packages with @font-face + unicode-range + woff2,
 * Vite bundles the CSS, and the font files land on our own origin so:
 *   · no 3rd-party DNS/TLS handshake before first paint
 *   · CSP frame-src/connect-src no longer needs googleapis.com
 *   · fonts are cacheable under our own asset-hash rules
 * font-display: swap is baked into each face, so the system fallback
 * renders immediately and Fraunces / Noto swap in once decoded.
 *
 * H5-only: mini-program platforms ignore @font-face webfonts anyway.
 */
// #ifdef H5
import '@fontsource-variable/fraunces/opsz.css'
import '@fontsource-variable/noto-sans-sc/wght.css'
import '@fontsource-variable/noto-serif-sc/wght.css'
// #endif

const { init, currentUser } = useAuth()
const { t } = useI18n()
useTheme()

/*
 * OAuth-callback affordance overlay (H5 only).
 *
 * Tracks whether the SPA booted with an OAuth `?code=` in the URL
 * (set synchronously by extractAuthCodeFromUrl below). When true,
 * onLaunch raises a uni.showLoading modal with mask:true that
 * covers the home/welcome page during the ~1.5–4.5s PKCE-exchange
 * + fetchProfile resolution window — see audit
 *   §"Where the perceptible delay originates"
 * for the full chain. The watcher below dismisses the modal as
 * soon as currentUser populates; an 8s safety timer prevents a
 * silently-failed exchange from leaving the modal stuck on screen.
 *
 * App.vue cannot render UI directly in uni-app (no <template>
 * block on the application instance), so the affordance is the
 * native uni.showLoading modal rather than a custom Vue overlay.
 * mp-weixin never enters this branch (extractAuthCodeFromUrl is
 * `#ifdef H5`, and the typeof-window guard short-circuits anyway).
 */
const oauthCallbackInFlight = ref(false)

/*
 * Re-consent + suspension gate.
 *
 * Runs whenever the logged-in profile changes (login, signup, page
 * refresh). Decides in order:
 *   1. If user is suspended (level >= 2, not expired) → /pages/suspended/index.
 *   2. Else if profile.tos_version < CURRENT_CONSENT_VERSION → /pages/reconsent/index.
 *   3. Else let the user through.
 *
 * O1 (2026-05-20): the onboarding flow was removed entirely. The previous
 * gate branch `if (!u.onboarded_at) → /pages/onboarding/index` was dropped
 * because F1/F1b/F1c all failed real-device verification on the nickname
 * input glyph clipping bug and audit revealed the wizard was collecting
 * mostly redundant or dead data (nickname is already in the signup form
 * for email users / available as full_name for Google OAuth; campus_area
 * column is never read elsewhere; avatar is editable post-signup via
 * profile/edit). The remaining load-bearing piece — legal consent — is
 * already handled by the reconsent branch below: new users have
 * tos_version='0' (per migration 032) which is < CURRENT_CONSENT_VERSION,
 * so they naturally fall through to the existing reconsent page on first
 * login. See docs/memory/o1_onboarding_removed.md.
 *
 * Onboarding route stays registered in pages.json + this exempt list as
 * an intentional orphan to keep any stale deep-link safe from 404.
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
  // O1 (2026-05-20): onboarding branch removed. New users (tos_version='0'
  // < CURRENT_CONSENT_VERSION per migration 032 default) fall through to
  // the reconsent check below — which is the canonical legal-consent surface.
  // See docs/memory/o1_onboarding_removed.md.
  if (!u.tos_version || u.tos_version < CURRENT_CONSENT_VERSION) {
    uni.reLaunch({ url: '/pages/reconsent/index' })
  }
}

watch(currentUser, () => {
  setTimeout(enforceConsentGate, 100)
})

/*
 * OAuth-callback overlay dismissal.
 *
 * Kept as a separate watcher (not merged into the consent-gate one
 * above) so the two concerns stay independent: consent-gate has a
 * 100ms debounce + may navigate away; this just hides the modal as
 * soon as currentUser populates. The 8s safety timer in onLaunch
 * is the failure-mode cover (silent PKCE/profile failure → modal
 * still dismisses), so most of the time this watcher fires first.
 */
watch(currentUser, (user) => {
  if (user && oauthCallbackInFlight.value) {
    oauthCallbackInFlight.value = false
    try { uni.hideLoading() } catch {}
  }
})

/*
 * extractAuthCodeFromUrl — synchronous PKCE-code rescue, runs before
 * supabase-js init can race us for the URL.
 *
 * Bug shape across the three rounds of investigation:
 *
 *   r1 (63bf953): redirectTo was '${origin}/' → Supabase bounced users
 *     to root, supabase-js consumed the recovery URL there but
 *     PASSWORD_RECOVERY fired before reset-password page existed.
 *
 *   r2 (86e45aa): changed redirectTo to '${origin}/#/pages/reset-
 *     password/index'. Predicted caveat: '?code=' might land in the
 *     hash fragment (after '#'), invisible to supabase-js's search-
 *     only detector. Built this function to handle THAT case.
 *
 *   r3 (this commit): user re-tested with new SMTP and showed actual
 *     evidence — '?code=' lands in window.location.search (BEFORE the
 *     '#'), not the hash. Browser parses it like:
 *       window.location.search = '?code=<pkce>'
 *       window.location.hash   = '#/pages/reset-password/index'
 *     supabase-js's detectSessionInUrl finds the search-side code,
 *     auto-exchanges it, and fires SIGNED_IN + INITIAL_SESSION — but
 *     NOT PASSWORD_RECOVERY (race / v2 implementation difference for
 *     search-based PKCE auto-exchange). Reset-password page's listener
 *     never receives the event, falls through to invalid-recovery
 *     error.
 *
 * Fix: pre-empt supabase-js's auto-detect by extracting the code from
 * EITHER search or hash (whichever the deployment lands it in), stash
 * it on window, clean the URL. The reset-password page then exchanges
 * the stashed code in onMounted AFTER subscribing the PASSWORD_RECOVERY
 * listener — so the synchronous event from exchangeCodeForSession's
 * resolve is caught.
 *
 * Why check search first:
 *   The user's verified evidence shows search is where Supabase actually
 *   puts it for the hash-routed redirectTo. Hash-side detection stays
 *   as a fallback for any future Supabase config / version change that
 *   shifts the code into the fragment.
 *
 * Why not just exchange right here?
 *   1. The supabase client doesn't exist yet — useSupabase()/createClient
 *      run inside the setTimeout below.
 *   2. exchangeCodeForSession's resolve fires PASSWORD_RECOVERY
 *      synchronously to subscribed listeners. The reset-password page's
 *      listener subscribes in onMounted, which runs AFTER this entry
 *      hook. If we exchanged here, the event would fire before any
 *      listener was subscribed → lost.
 *
 * Why history.replaceState rewrite the URL:
 *   1. Once we've stashed the code, leaving it in the URL invites
 *      supabase-js's detectSessionInUrl to also see it and auto-
 *      exchange (which is exactly what failed in r2's evidence —
 *      SIGNED_IN fires from the auto-exchange, no PASSWORD_RECOVERY).
 *      Cleaning the URL before supabase-js runs guarantees only OUR
 *      exchange (in reset-password's onMounted) actually happens.
 *   2. Browsers show the cleaner URL to the user.
 *   3. Back-button navigation can't replay the code.
 *
 * H5 only — mp targets don't have window.location / hash routing.
 */
function extractAuthCodeFromUrl(): void {
  // #ifdef H5
  if (typeof window === 'undefined') return
  const hash = window.location.hash || ''
  const search = window.location.search || ''
  console.log('[reset-pw-debug] entry: location.hash=', hash)
  console.log('[reset-pw-debug] entry: location.search=', search)

  /*
   * Two locations to probe, in priority order:
   *   1. window.location.search → '?code=xxx' before any '#'.
   *      This is what Supabase actually emits for hash-routed
   *      redirectTo (verified in r3 evidence).
   *   2. window.location.hash → '?code=xxx' AFTER the '#', as part
   *      of the fragment query. Predicted shape from r2; kept as
   *      fallback since some Supabase setups / future versions might
   *      place the code there.
   */
  let code: string | null = null
  let foundIn: 'search' | 'hash' | null = null

  if (search) {
    const params = new URLSearchParams(search)
    const c = params.get('code')
    if (c) {
      code = c
      foundIn = 'search'
    }
  }

  if (!code) {
    const codeInHash = hash.match(/[?&]code=([^&]+)/)
    if (codeInHash && codeInHash[1]) {
      code = decodeURIComponent(codeInHash[1])
      foundIn = 'hash'
    }
  }

  if (!code || !foundIn) {
    console.log('[reset-pw-debug] entry: no ?code= in either search or hash, skipping extraction')
    return
  }

  /*
   * Distinguish a recovery code (must be stashed for reset-password to
   * exchange in onMounted) from a non-recovery PKCE code (e.g. an
   * OAuth-callback redirect, which lands on `${origin}/` and should
   * be left for supabase-js's detectSessionInUrl pipeline to consume
   * as part of the SIGNED_IN flow).
   *
   * The cheap, reliable signal is the hash route component:
   *
   *   · Recovery email → redirectTo is `${origin}/#/pages/reset-password/index`
   *     so window.location.hash starts with '#/pages/reset-password/'.
   *   · Google OAuth   → redirectTo is `${origin}/`
   *     so window.location.hash is '' (empty) or '#/' or '#/pages/index/index'
   *     depending on which page first renders post-redirect.
   *   · Any other PKCE return shape we add later (Apple, GitHub, magic
   *     link, etc.) defaults to the OAuth branch — they go to the home
   *     page and supabase-js handles them transparently.
   *
   * If we stashed an OAuth code instead of letting supabase-js consume
   * it, two things break: (a) the SIGNED_IN event never fires (because
   * detectSessionInUrl can't find the code we just removed), and (b)
   * the reset-password page never mounts on a fresh OAuth login, so
   * __pendingAuthCode would sit in window forever and the user would
   * land on the home page un-authenticated despite the URL having
   * shown a valid code. The route check below prevents that footgun.
   */
  const hashRoute = (hash.split('?')[0] || '').toLowerCase()
  const isRecoveryRoute = hashRoute.includes('/pages/reset-password/')
  if (!isRecoveryRoute) {
    console.log(
      `[reset-pw-debug] entry: ?code= present in ${foundIn} but hash route is ${hashRoute || '(empty)'} — not recovery, leaving code in URL for supabase-js detectSessionInUrl (likely OAuth callback)`,
    )
    /*
     * Affordance flag for the OAuth-callback overlay. Read in onLaunch
     * after this function returns to decide whether to raise a
     * uni.showLoading modal during the PKCE-exchange + fetchProfile
     * window. `(window as any)` because we don't extend the global
     * Window interface for a single internal flag; leading semicolon
     * defends against ASI on the preceding console.log expression.
     */
    ;(window as any).__oauthInFlight = true
    return
  }

  console.log(`[reset-pw-debug] entry: detected recovery ?code= in ${foundIn}, extracting code=${code.slice(0, 8)}...`)

  ;(window as any).__pendingAuthCode = code

  try {
    /*
     * Strip code+state from wherever they were found, leaving any other
     * query params intact (lang, ref, etc.). state= is the PKCE round-
     * trip companion to code= and goes with it.
     */
    let newSearch = search
    let newHash = hash

    if (foundIn === 'search') {
      const params = new URLSearchParams(search)
      params.delete('code')
      params.delete('state')
      const remaining = params.toString()
      newSearch = remaining ? '?' + remaining : ''
    } else {
      // foundIn === 'hash' — strip from the hash's query portion
      const hashStr = hash.startsWith('#') ? hash.slice(1) : hash
      const qIdx = hashStr.indexOf('?')
      let path = hashStr
      let query = ''
      if (qIdx >= 0) {
        path = hashStr.slice(0, qIdx)
        query = hashStr.slice(qIdx + 1)
      }
      const params = new URLSearchParams(query)
      params.delete('code')
      params.delete('state')
      const remaining = params.toString()
      newHash = '#' + path + (remaining ? '?' + remaining : '')
    }

    const newUrl = window.location.pathname + newSearch + newHash
    console.log(`[reset-pw-debug] entry: rewriting URL to clear code from ${foundIn} →`, newUrl)
    window.history.replaceState({}, '', newUrl)
  } catch (err) {
    console.warn('[reset-pw-debug] entry: history.replaceState failed (continuing — code already stashed):', err)
  }
  // #endif
}

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
  /*
   * Hash-route guard mirrors extractAuthCodeFromUrl's Fix 6 check.
   * Without it, this function — which runs from setTimeout(0) AFTER
   * Fix 6's gatekeeper — fires on Google OAuth callbacks too: their
   * URL shape is /?code=<pkce>&state=<...> with empty hash, identical
   * at the regex level to a recovery email link. Pre-fix the
   * uni.reLaunch below hijacked OAuth callbacks to reset-password
   * page, where getSession() found a valid SIGNED_IN session but
   * PASSWORD_RECOVERY never fired (PKCE OAuth fires SIGNED_IN, not
   * recovery — confirmed across r1–r4 of P0-3) and the page surfaced
   * "重置链接无效或已过期". Diagnosis in
   * _ai_notes/OAUTH_RESET_PW_DIAGNOSIS.md (option 1).
   *
   * hashIsRecovery stays UNGATED — it covers the implicit-flow
   * recovery shape (#access_token=&type=recovery) which never
   * collides with OAuth (OAuth never lands access_token in hash).
   * Only searchIsRecovery needs the route gate, and the gate is the
   * same one Fix 6 uses in extractAuthCodeFromUrl (lines ~232-238):
   * a code in window.location.search counts as recovery only when
   * the hash route also points at /pages/reset-password/.
   *
   * Recovery email URL /?code=X#/pages/reset-password/index still
   * matches isRecoveryRoute=true, so this guard is a no-op for the
   * exception-fallback safety net (case #9 in the diagnosis): if
   * extractAuthCodeFromUrl threw and didn't strip+stash the code,
   * the URL still has ?code= AND the hash still routes to reset-
   * password, so searchIsRecovery is true here and the legacy
   * __authRecoverySearch path on reset-password's onMounted picks
   * up the slack.
   */
  const hashRoute = (hash.split('?')[0] || '').toLowerCase()
  const isRecoveryRoute = hashRoute.includes('/pages/reset-password/')
  const hashIsRecovery = hash.includes('type=recovery') || hash.includes('access_token=')
  const searchIsRecovery = /[?&]code=[^&]+/.test(search) && isRecoveryRoute
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
  /*
   * SYNCHRONOUS hash-PKCE-code rescue — must run BEFORE the setTimeout
   * below kicks off useSupabase() / createClient(). Once supabase-js
   * initializes, its detectSessionInUrl pipeline can choose to
   * history.replaceState the URL even when it didn't find anything to
   * exchange — wiping our hash code with it. Doing the extraction here,
   * synchronously in onLaunch's first tick, guarantees the code is
   * stashed and the URL cleaned before any of that runs.
   *
   * Wrapped in try/catch so a hash-parse oddity can never block the rest
   * of app boot — worst case we lose this one recovery attempt and the
   * existing /error= handling shows the user a friendly "link expired"
   * message in the .error block.
   */
  try {
    extractAuthCodeFromUrl()
  } catch (err) {
    console.warn('[reset-pw-debug] entry: extractAuthCodeFromUrl threw (non-fatal):', err)
  }

  /*
   * OAuth-callback overlay raise.
   *
   * Reads the flag set inside extractAuthCodeFromUrl's OAuth-callback
   * branch (search-side ?code= with non-recovery hash). When raised,
   * the user sees a blocking native loading modal instead of the
   * home/welcome page rendering in logged-out state during the
   * ~1.5–4.5s PKCE-exchange + fetchProfile resolution window. The
   * watcher on currentUser (script-setup top) hides the modal as
   * soon as the profile lands; the 8s setTimeout below is the
   * silent-failure safety belt — if PKCE exchange or fetchProfile
   * fails for any reason (network, RLS), the modal still dismisses
   * so the user isn't trapped.
   *
   * mp-weixin never enters this branch: extractAuthCodeFromUrl is
   * `#ifdef H5`-guarded and never sets the flag; the typeof-window
   * guard short-circuits regardless. Cost on mp-weixin = one boolean
   * check per cold start.
   */
  if (typeof window !== 'undefined' && (window as any).__oauthInFlight) {
    oauthCallbackInFlight.value = true
    try {
      uni.showLoading({ title: t('login.signingIn'), mask: true })
    } catch (err) {
      console.warn('[oauth-debug] showLoading failed (non-fatal):', err)
    }
    setTimeout(() => {
      if (oauthCallbackInFlight.value) {
        oauthCallbackInFlight.value = false
        try { uni.hideLoading() } catch {}
      }
    }, 8000)
  }

  /*
   * Global error handlers — register FIRST and synchronously, so any
   * subsequent rejection in the deferred-init block is captured rather
   * than vanishing into the WeChat service-thread void.
   *
   * onError fires for synchronous JS exceptions in any page lifecycle;
   * onUnhandledRejection fires for promise rejections without a .catch.
   * Both surface in the WeChat DevTools Console panel, which is the
   * only debugging surface we have once the app reaches a real device.
   */
  uni.onError?.((err: any) => {
    console.error('[onError]', err)
    captureException(err, { tags: { source: 'uni.onError' }, level: 'error' })
  })
  uni.onUnhandledRejection?.((e: any) => {
    const reason = e?.reason || e
    console.error('[onUnhandledRejection]', reason)
    captureException(reason, { tags: { source: 'uni.onUnhandledRejection' }, level: 'error' })
  })

  /*
   * Stale-chunk auto-recovery (H5 only).
   *
   * After a Vercel deploy the user's open tab still references the
   * previous bundle's content-hashed filenames. The next lazy import
   * (uni-app generates one per page route) or <link rel="modulepreload">
   * fetches a path that no longer exists and rejects with one of:
   *   "Failed to fetch dynamically imported module"
   *   "Unable to preload CSS for /assets/index-*.css"
   *
   * Both are harmless if the user refreshes — the new index.html has
   * fresh hashes. Auto-reload turns the rejection into a brief
   * "App updated, refreshing…" toast and a window.location.reload()
   * so users don't see a broken nav. preventDefault() also stops the
   * rejection from propagating to Sentry's global handler (the
   * ignoreErrors filter in utils/sentry.ts is the second line of
   * defense for any case where preventDefault doesn't work, e.g.
   * Safari treating it differently).
   */
  // #ifdef H5
  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (e) => {
      const reason: any = e?.reason
      const msg = String(reason?.message || reason || '')
      if (/Failed to fetch dynamically imported module|Unable to preload CSS/i.test(msg)) {
        e.preventDefault()
        try { uni.showToast({ title: t('app.deployRefreshing'), icon: 'none', duration: 1200 }) } catch {}
        setTimeout(() => { try { window.location.reload() } catch {} }, 500)
      }
    })
  }
  // #endif

  uni.onNetworkStatusChange?.((res: { isConnected: boolean }) => {
    if (!res.isConnected) {
      uni.showToast({ title: t('error.noNetwork'), icon: 'none', duration: 3000 })
    }
  })

  /*
   * Defer the heavy startup work (Supabase getSession round-trip, auth
   * subscription wire-up, and the first-launch reLaunch to /welcome)
   * to a 0-ms setTimeout so it runs AFTER the WeChat service thread
   * finishes its initial setData→view-thread handshake.
   *
   * Symptom this fixes: WeChat DevTools threw
   *   `Error: timeout at WAServiceMainContext.js?t=wechat&v=3.15.x:1`
   * with launch time stretching from ~1 s to 5 s+ and the first page
   * never painting (blank screen, no tabBar text). Two contributors:
   *
   *   1. WeChat 3.15.x base-library regression — confirmed by dcloud
   *      community + WeChat staff ("问题已知正在修复"). The runtime
   *      stricter-times the initial service-thread tick.
   *   2. Our own `init()` did `await supabase.auth.getSession()`
   *      synchronously inside onLaunch, blocking that tick with a
   *      network round-trip. Combined with `uni.reLaunch` firing in
   *      the same tick, the framework couldn't complete its initial
   *      setData before the timeout cutoff.
   *
   * setTimeout 0 yields the macrotask queue, lets the WeChat runtime
   * do its handshake, then runs init/reLaunch in the next loop. The
   * try/catch is the last line of defense — anything that throws here
   * gets logged to console instead of silently killing the boot.
   */
  setTimeout(() => {
    try {
      init()
    } catch (err) {
      console.error('[onLaunch] init failed:', err)
      captureException(err, { tags: { source: 'onLaunch.init' }, level: 'error' })
    }
    try {
      const routedToReset = detectAuthRecoveryAndRoute()
      if (!routedToReset && !uni.getStorageSync('welcomed')) {
        uni.reLaunch({ url: '/pages/welcome/index' })
      }
    } catch (err) {
      console.error('[onLaunch] welcome routing failed:', err)
      captureException(err, { tags: { source: 'onLaunch.welcomeRouting' }, level: 'error' })
    }

    /*
     * Hide WeChat's native bottom tabBar on mp-weixin. The pages.json
     * tabBar config is kept (uni.switchTab needs it for routing), but
     * we render our own CustomTabBar.vue inside each tab page, so the
     * native bar is a duplicate that overlaps. uni.hideTabBar persists
     * for the app lifecycle in mp-weixin — onLaunch is enough; we
     * don't need per-page onShow calls. H5 has its own #ifdef-guarded
     * `uni-tabbar { display: none }` rule in the global style above.
     */
    // #ifdef MP-WEIXIN
    try {
      uni.hideTabBar({ animation: false })
    } catch (err) {
      console.warn('[onLaunch] hideTabBar failed:', err)
    }
    // #endif
  }, 0)
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
/*
 * Google Fonts @import removed — webfonts are now self-hosted via
 * @fontsource packages imported in <script setup> above. Vite
 * inlines the @font-face declarations + woff2 assets onto our own
 * origin so there's no fonts.googleapis.com round-trip before first
 * paint, and the CSP no longer has to whitelist Google Fonts CDNs.
 */

page,
.page {
  /*
   * Body defaults + design tokens, scoped to BOTH the bare `page`
   * pseudo-element AND to any <view class="page"> root used across
   * the app. uni-app's mp-weixin compiler auto-injects its own
   * `page { --status-bar-height, ... }` rule AFTER our app.wxss,
   * which on some WXSS runtimes wipes out the preceding `page { ... }`
   * rule entirely (cascade-of-last-rule behaviour). Duplicating onto
   * .page gives us a second anchor that the framework never targets —
   * even if WXSS keeps only the framework's `page` rule, the class
   * rule on the root <view class="page"> still carries tokens and
   * inherits them to descendants. H5 is unaffected — :root{}
   * below still owns document-level tokens there.
   *
   * letter-spacing 0.02em + line-height 1.6 + warm-charcoal color
   * is the "anti-plastic" body stack per the refinement pass; tight
   * 0 letter-spacing + 1.4 line-height was the single biggest source
   * of the cram-scanned feel on CJK screens.
   */
  --text-primary:   #2A2A2E;
  --text-secondary: #57524B;
  --text-tertiary:  #6B6557;
  --text-muted:     #8B8478;
  --text-faint:     #B6AE9F;
  --text-disabled:  #C0BCB2;
  --ink:         #2A2A2E;
  --ink-soft:    #57524B;
  --ink-quiet:   #8B8478;
  --ink-faint:   #B6AE9F;
  --ink-inverse: #F5F0E6;
  --bg-page:    #F5F0E6;
  --bg-elev-1:  #FBF8F2;
  --bg-elev-2:  #F0E9DA;
  --bg-subtle:  #F0E9DA;
  --bg-inset:   #E8DFCC;
  --canvas:        #F5F0E6;
  --surface:       #FBF8F2;
  --surface-alt:   #F0E9DA;
  --parchment:     #F0E9DA;
  --frame:         #E8DFCC;
  --surface-rgb: 251, 248, 242;
  --canvas-rgb:  245, 240, 230;
  --paper:      #FBF8F2;
  --paper-2:    #F0E9DA;
  --paper-3:    #E8DFCC;
  --line-hair:  rgba(42, 42, 46, 0.06);
  --line-soft:  rgba(42, 42, 46, 0.10);
  --line-bold:  rgba(42, 42, 46, 0.16);
  --border:        #E8DFCC;
  --border-strong: #D8CDB3;
  --border-hair:   rgba(42, 42, 46, 0.05);
  --border-warm:   #E8DFCC;
  --brand:          #C74A2F;
  --brand-deep:     #A03A24;
  --brand-soft:     #F5D9CE;
  --brand-ghost:    #FBEAE2;
  --campus-blue:      #13294B;
  --campus-blue-soft: #E5EAF2;
  --campus-blue-deep: #0A1A33;
  --campus-blue-surface: #13294B;
  --campus-orange:    #FF5F05;
  --campus-orange-deep: #B33D00;
  --campus-orange-soft: #FFF1E6;
  --accent-primary:      #C74A2F;
  --accent-primary-soft: #F5D9CE;
  --accent-primary-deep: #A03A24;
  --accent-action:       #C74A2F;
  --accent-ink:          #2A2A2E;
  --accent-green:        #5D7C4A;
  --accent-good:         #5D7C4A;
  --accent-warn:         #D4923C;
  --accent-danger:       #B53333;
  --success:      #5D7C4A;
  --success-soft: #E4EADA;
  --warning:      #D4923C;
  --warning-soft: #F5E4CB;
  --danger:       #B53333;
  --danger-soft:  #F0D4D4;
  --radius-xs:    4px;
  --radius-sm:    8px;
  --radius-md:   12px;
  --radius-lg:   18px;
  --radius-xl:   28px;
  --radius-pill: 999px;
  --space-1:  4px;
  --space-2:  8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-7: 32px;
  --space-8: 48px;
  --font-weight-regular: 400;
  --font-weight-medium:  500;
  --font-weight-semi:    600;
  --font-weight-bold:    700;
  --font-serif: 'Fraunces', 'Noto Serif SC', 'Songti SC', Georgia, 'Times New Roman', serif;
  --font-hei:   'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', sans-serif;
  --font-mono:  'JetBrains Mono', 'SF Mono', Menlo, ui-monospace, monospace;
  --shadow-hair:  0 0 0 1px rgba(42, 42, 46, 0.06);
  --shadow-soft:  0 1px 2px rgba(42, 42, 46, 0.04), 0 4px 12px rgba(42, 42, 46, 0.06);
  --shadow-pop:   0 2px 4px rgba(42, 42, 46, 0.05), 0 12px 28px rgba(42, 42, 46, 0.08);
  --shadow-float: 0 1px 2px rgba(42, 42, 46, 0.06), 0 24px 56px -16px rgba(42, 42, 46, 0.18);
  --shadow-cta:   0 2px 4px rgba(199, 74, 47, 0.15), 0 12px 28px -8px rgba(199, 74, 47, 0.28);
  --shadow-brand: 0 2px 4px rgba(199, 74, 47, 0.15), 0 12px 28px -8px rgba(199, 74, 47, 0.28);
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

  /*
   * WeChat mp-weixin custom-navbar tokens — capsule button awareness.
   *
   * Every mp-weixin page (with navigationStyle: custom) has the
   * native capsule (minimize + close buttons) anchored top-right:
   *   · width:  87 px on iOS, 87 px on Android
   *   · height: 32 px on both
   *   · top:    statusBar + 4 px (iOS) / + 8 px (Android)
   *   · right:  7 px (iOS) / 10 px (Android)
   * Source: WeChat official navbar guidelines, verified against
   * uni.getMenuButtonBoundingClientRect() output. Values stay
   * remarkably stable across WeChat 2.x → 3.15.x.
   *
   * Net "WeChat reserved top area" = statusBar (--status-bar-height,
   * 25-44 px device-dependent) + 44 px capsule slot. Custom navbars
   * MUST be at least 44 px tall AND keep clickable elements out of
   * the right ~104 px (capsule width 87 + right gap 7 + visual breath
   * 10) or they get hidden under / collide with the capsule.
   *
   * Usage:
   *   .your-navbar {
   *     padding-top: var(--mp-status-bar);
   *     min-height: calc(var(--mp-status-bar) + var(--mp-navbar-height));
   *     padding-right: var(--mp-navbar-right-pad);
   *   }
   * H5 keeps env(safe-area-inset-top) for notch via the existing
   * fallback chain.
   */
  --mp-status-bar:        var(--status-bar-height, env(safe-area-inset-top, 0px));
  --mp-navbar-height:     44px;   /* capsule 32 + 12 padding */
  --mp-navbar-right-pad:  104px;  /* capsule 87 + 7 right + 10 breath */

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

/*
 * .page-lock was originally introduced to fix an H5-only quirk:
 * uni-app's uni-page-wrapper / uni-page-body wrap the page and
 * scroll independently, which on mobile web let the page header
 * scroll off-screen. Taking .page out of flow (position: fixed
 * inset 0) forces the viewport to own the scroll.
 *
 * On mp-weixin the WeChat runtime owns page scrolling natively
 * — there is no uni-page-wrapper equivalent and `position: fixed`
 * on the whole page root fights the compositor, empirically
 * making descendant <text> nodes invisible during first paint.
 * H5-only via #ifdef so mp renders normally.
 */
/* #ifdef H5 */
@media (max-width: 767px) {
  .page-lock {
    position: fixed !important;
    top: 0; left: 0; right: 0; bottom: 0;
    max-width: none !important;
    margin: 0 !important;
    z-index: 1;
  }
}
/* #endif */

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

view, text, input, button, textarea { box-sizing: border-box; }

/*
 * mp-weixin text color safety net.
 *
 * WeChat's `<text>` element is a native component, not a plain inline
 * box. CSS `color` and CSS custom properties set on `page` / `.page`
 * are NOT reliably inherited to `<text>` descendants on WXSS runtimes
 * (observed on base library 3.15.0 + uni-app Vue 3 SFC output). Result:
 * all bare `<text>{{ t('...') }}</text>` nodes rendered at #000 against
 * our intended ink, or worse — if the layout ancestor sets a dark
 * background, rendered transparent-on-dark.
 *
 * Hard-code the literal hex instead of `var(--ink)` so this works even
 * when custom properties fail to cascade (the failure mode we actually
 * hit: `page, .page { --ink: ... }` rule getting partially dropped by
 * the runtime after uni-app's own `page { --status-bar-height: ... }`
 * injection). Class-level `color: var(--ink)` rules on specific text
 * elements still win over this on cascade — they layer on top and
 * re-resolve when the var IS available. This is just the floor.
 *
 * H5 is unaffected — browsers inherit color from <html> / <body> /
 * .page just fine, and the hex matches --ink so no visual divergence.
 */
text {
  color: #2A2A2E;
  font-family: 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC',
    -apple-system, BlinkMacSystemFont, 'Helvetica Neue',
    'Microsoft YaHei', system-ui, sans-serif;
}

[data-theme="dark"] text {
  color: #F0E8D6;
}

input, textarea {
  font-family: inherit;
  letter-spacing: inherit;
}

input:focus-visible,
textarea:focus-visible,
button:focus-visible,
.focusable:focus-visible {
  outline: 2px solid var(--brand) !important;
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
 * Design tokens — Hybrid v5 (米白书院 commerce + UIUC accent)
 *
 * Source of truth (per dual-track tokens.css v2):
 *   /Users/xiaogangxu/Downloads/Illini Market Design System/
 *     uploads/illini-market-design-system.html
 *     uploads/illini-market-design-system-ff69aead.html
 *     tokens.css                  ← dual-track design intent
 *     uploads/uni.scss            ← matching SCSS source
 *
 * The two big design-system HTML files use 米白书院 throughout
 * (terracotta #C74A2F + warm charcoal #2A2A2E + cream #F5F0E6)
 * for ALL commerce, feed, detail, chat, profile, publish, and
 * tab-bar surfaces. UIUC navy + Illini orange are RESERVED for
 * specific moments of campus identity:
 *   · "Illini 认证" / verified-pickup badges
 *   · CAACI 官方 posts in plaza
 *   · 反诈 / scam-warning banners
 *   · academic seal moments (welcome, onboarding hero)
 * Never on prices, never on default CTAs.
 *
 * Why this beats v4 (UIUC Fusion):
 *   · navy ink on cream reads cold and corporate; warm-charcoal
 *     ink on cream reads bookish and lived-in (the anti-plastic
 *     direction the user has asked for since session 2).
 *   · terracotta carries the "stamp / seal / pottery" energy
 *     that matches the Fraunces serif headers.
 *   · UIUC identity is preserved — but as accreditation, not
 *     wallpaper. README.md explicitly names ivory_academy
 *     "PRIMARY" and marketplace "SECONDARY".
 *
 * Migration history:
 *   v1 — neutral grey (#fafafb + #1a1a1a black)
 *   v2 — warm campus market (#faf7f0 cream + #FF5A4C coral)
 *   v3 — 米白书院 (#F5F0E6 ivory + #C74A2F terracotta)
 *   v4 — UIUC Fusion (#FBF7EB + #13294B + #E84A27)
 *   v5 — Hybrid 双轨 (米白书院 + UIUC reserved) ← here
 *
 * Legacy variable names (--accent-primary, --bg-page, --text-*)
 * are preserved so every page cascades without code edits.
 */
/*
 * Design-token root — PLATFORM-SPLIT.
 *
 * First attempt used the combined selector list `:root, page { ... }`
 * on the theory that WXSS would ignore the unknown `:root` half and
 * apply the rule to `page`. That theory was wrong: WXSS appears to
 * reject the ENTIRE rule when any selector in the list is invalid,
 * so on mp-weixin the tokens never reached `page` and every
 * `var(--*)` lookup resolved to the CSS initial value (color
 * collapsed to black/transparent, backgrounds went white, text
 * became invisible on navy cards). The H5 side worked fine because
 * browsers happily drop the unknown `page` half of the list.
 *
 * Fix: split into two isolated rules with the same declaration block.
 * On H5, only `:root { ... }` takes effect (browsers don't know the
 * `page` element exists). On mp-weixin, only `page { ... }` takes
 * effect (WXSS doesn't know `:root`). The apparent duplication is
 * the price of cross-platform correctness; keep them in sync.
 */
:root {
  /* ---------- TEXT (warm charcoal — the anti-plastic ink) ---------- */
  --text-primary:   #2A2A2E;   /* ink       — warm charcoal */
  --text-secondary: #57524B;   /* ink-soft  — secondary, walnut */
  --text-tertiary:  #6B6557;
  --text-muted:     #8B8478;   /* ink-quiet — meta · stone */
  --text-faint:     #B6AE9F;   /* ink-faint — scaffolding */
  --text-disabled:  #C0BCB2;

  /* ---------- NEW SEMANTIC NAMES (prefer these going forward) ---------- */
  --ink:         #2A2A2E;   /* warm charcoal — body + titles */
  --ink-soft:    #57524B;
  --ink-quiet:   #8B8478;
  --ink-faint:   #B6AE9F;
  --ink-inverse: #F5F0E6;   /* text on ink panels (cream) */

  /* ---------- SURFACES ----------
   * Three-layer stack:
   *   canvas (page bg)  — warm cream
   *   surface (card)    — slightly lighter paper
   *   surface-alt       — chip / inset / tab bar paper-fabric
   *   frame             — pressed chip / hover
   */
  --bg-page:    #F5F0E6;   /* canvas - page background */
  --bg-elev-1:  #FBF8F2;   /* surface - card (warm white) */
  --bg-elev-2:  #F0E9DA;   /* surface-alt - tab bar + inset bg */
  --bg-subtle:  #F0E9DA;   /* chip / input / meta bg */
  --bg-inset:   #E8DFCC;   /* pressed chip / frame */

  --canvas:        #F5F0E6;
  --surface:       #FBF8F2;
  --surface-alt:   #F0E9DA;
  --parchment:     #F0E9DA;   /* alias for tab bar treatment */
  --frame:         #E8DFCC;

  /*
   * Surface + canvas RGB triplets — for rgba() so frosted-glass
   * headers can fade out over the native surface color. Dark-
   * mode block below flips these to dark equivalents.
   */
  --surface-rgb: 251, 248, 242;
  --canvas-rgb:  245, 240, 230;

  /* Legacy paper aliases (back-compat with Phase 1-3 code) */
  --paper:      #FBF8F2;
  --paper-2:    #F0E9DA;
  --paper-3:    #E8DFCC;

  /* ---------- BORDERS (warm beige — paper-edge feel) ---------- */
  --line-hair:  rgba(42, 42, 46, 0.06);
  --line-soft:  rgba(42, 42, 46, 0.10);
  --line-bold:  rgba(42, 42, 46, 0.16);

  --border:        #E8DFCC;
  --border-strong: #D8CDB3;
  --border-hair:   rgba(42, 42, 46, 0.05);
  --border-warm:   #E8DFCC;   /* same as default; kept for back-compat */

  /* ---------- BRAND (terracotta — pottery red) ---------- */
  --brand:          #C74A2F;   /* terracotta — price · CTA · seal */
  --brand-deep:     #A03A24;   /* hover / pressed */
  --brand-soft:     #F5D9CE;   /* chip bg · soft fill */
  --brand-ghost:    #FBEAE2;   /* hover tint on white */

  /* ---------- UIUC Campus accents (verified · official · academic seal)
   * Use ONLY when surface is genuinely about university identity:
   *   · Illini 认证 badge → background var(--campus-blue-soft) + text var(--campus-blue)
   *   · CAACI 官方 post header → background var(--campus-blue) + text var(--ink-inverse)
   *   · "查看 UIUC 校历 / 校园活动" entry CTAs → use --campus-orange
   * NEVER: prices, regular CTAs, body text, default buttons.
   * --------------------------------------------------------- */
  --campus-blue:      #13294B;
  --campus-blue-soft: #E5EAF2;
  --campus-blue-deep: #0A1A33;
  --campus-blue-surface: #13294B;
  --campus-orange:    #FF5F05;   /* canonical Illini Orange */
  --campus-orange-deep: #B33D00; /* Altgeld — AA on light gray */
  --campus-orange-soft: #FFF1E6;

  /* Legacy accent names map to brand so existing pages cascade.
   * Anything legacy that meant "this is the official brand color"
   * now resolves to terracotta. The two accent-good / warn / danger
   * are tuned to sit beside terracotta without clashing (sage olive
   * green, amber, vermilion). */
  --accent-primary:      var(--brand);
  --accent-primary-soft: var(--brand-soft);
  --accent-primary-deep: var(--brand-deep);
  --accent-action:       var(--brand);
  --accent-ink:          var(--ink);
  --accent-green:        #5D7C4A;   /* sage olive — verified · free price */
  --accent-good:         #5D7C4A;
  --accent-warn:         #D4923C;   /* amber — currency exchange warning */
  --accent-danger:       #B53333;   /* vermilion — destructive */

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

  /* ---------- ELEVATION (warm ink alpha — paper drop shadow)
   * Apple-style 3-layer soft lift, tuned to warm cream canvas.
   * No heavy black drop-shadows — uses ink charcoal at low alpha
   * so the lift reads as "card on paper" instead of "screen". */
  --shadow-hair:       0 0 0 1px rgba(42, 42, 46, 0.06);
  --shadow-soft:       0 1px 2px rgba(42, 42, 46, 0.04),
                       0 4px 12px rgba(42, 42, 46, 0.06);
  --shadow-pop:        0 2px 4px rgba(42, 42, 46, 0.05),
                       0 12px 28px rgba(42, 42, 46, 0.08);
  --shadow-float:      0 1px 2px rgba(42, 42, 46, 0.06),
                       0 24px 56px -16px rgba(42, 42, 46, 0.18);
  --shadow-cta:        0 2px 4px rgba(199, 74, 47, 0.15),
                       0 12px 28px -8px rgba(199, 74, 47, 0.28);
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
 * Tuned to keep the "paper" feel even at night — warm-tinted
 * dark surfaces, cream-on-charcoal text. Brand terracotta
 * brightens from #C74A2F → #E06A4A so it stays legible on
 * dark canvas without burning the eye. UIUC campus blue
 * lifts from #13294B → #2A4A7B for dark-mode AA contrast on
 * the verified-badge soft surface.
 * ============================================================ */
[data-theme="dark"],
[data-theme="dark"] page,
[data-theme="dark"] .page {
  --ink:         #F0E8D6;
  --ink-soft:    rgba(240, 232, 214, 0.72);
  --ink-quiet:   rgba(240, 232, 214, 0.52);
  --ink-faint:   rgba(240, 232, 214, 0.32);
  --ink-inverse: #1C1A17;
  /* P1-1: AA-contrast placeholder text (splits --ink-quiet into two roles
   * so .55-alpha placeholders stop collapsing into the same value as
   * meta/caption text, which fails AA on the deepened dark canvas). */
  --ink-placeholder: rgba(240, 232, 214, 0.62);
  /* P2-2: page-title softener — prevents the 14:1 over-contrast that
   * pure cream-on-charcoal produces on hero titles. Used by .ph-title
   * scoped styles in dark only. */
  --ink-strong:      rgba(240, 232, 214, 0.92);

  --text-primary:   var(--ink);
  --text-secondary: var(--ink-soft);
  --text-tertiary:  var(--ink-soft);
  --text-muted:     var(--ink-quiet);
  --text-faint:     var(--ink-faint);
  --text-disabled:  rgba(240, 232, 214, 0.22);

  /* P0-1: Surface ladder — widened ΔE so cards/chips/pressed states lift
   * visibly on dark. Canvas deepens 1 step; chip-bg + pressed-inset
   * lighten 1 step each; surface (#26231E) and frame (#332F28) stay as
   * middle anchors. Legacy `--bg-*` aliases mirror the new semantic
   * names so 198+ existing component usages get the visible benefit
   * automatically. */
  --bg-page:    #15130F;   /* was #1C1A17 — canvas deepens 1 step */
  --bg-elev-1:  #26231E;
  --bg-elev-2:  #36322B;   /* was #2E2A23 — chip bg lightens 1 step */
  --bg-subtle:  #36322B;   /* was #2E2A23 — chip bg lightens 1 step */
  --bg-inset:   #423D33;   /* was #332F28 — pressed/inset lightens 1 step */

  --canvas:     #15130F;   /* was #1C1A17 — canvas deepens 1 step */
  --surface:    #26231E;
  --surface-alt: #36322B;  /* was #2E2A23 — chip bg lightens 1 step */
  /* P0-3: tab bar reverses depth direction in dark — bar is DEEPER than
   * canvas so it reads as a base shelf instead of a floating panel. */
  --parchment:  #13110D;   /* was #2E2A23 — now darker than canvas */
  --frame:      #332F28;
  --paper:      #26231E;
  --paper-2:    #36322B;   /* was #2E2A23 — alias of surface-alt */
  --paper-3:    #423D33;   /* was #332F28 — pressed/inset lightens 1 step */

  --surface-rgb: 38, 35, 30;
  --canvas-rgb:  21, 19, 15;   /* matches new --canvas #15130F so frosted-glass headers fade without color banding */

  --line-hair:  rgba(240, 232, 214, 0.08);
  --line-soft:  rgba(240, 232, 214, 0.12);
  --line-bold:  rgba(240, 232, 214, 0.18);
  --border:        rgba(240, 232, 214, 0.10);
  --border-strong: rgba(240, 232, 214, 0.20);
  --border-hair:   rgba(240, 232, 214, 0.06);

  /* Brand — terracotta lifts to brighter ember on dark ink */
  --brand:       #E06A4A;
  --brand-deep:  #C45A3A;
  --brand-soft:  rgba(224, 106, 74, 0.15);
  --brand-ghost: rgba(224, 106, 74, 0.08);

  /* Campus accents — UIUC navy lifts so verified pill stays legible */
  --campus-blue:      #6A8AC2;
  --campus-blue-soft: rgba(106, 138, 194, 0.15);
  --campus-blue-deep: #4A6BA0;
  --campus-blue-surface: #13294B;
  --campus-orange:    #FF7B33;
  --campus-orange-deep: #FF9560;
  --campus-orange-soft: rgba(255, 123, 51, 0.15);
  /* P1-2: campus chip surface for dark — keeps navy aesthetic without
   * the chip graying out into the warm dark canvas. */
  --campus-blue-chip-bg:     rgba(19, 41, 75, 0.45);
  --campus-blue-chip-border: rgba(106, 138, 194, 0.3);
  /* P1-4: profile user-card gradient — desaturated navy pair for dark
   * mode (was a solid --campus-blue-surface; gradient lifts the large
   * panel off the deepened canvas without graying its identity). */
  --user-card-grad-dark:     linear-gradient(135deg, #1A2540, #2C3E5C);

  --success:      #8BA670;
  --success-soft: rgba(139, 166, 112, 0.15);
  --warning:      #E5B170;
  --warning-soft: rgba(229, 177, 112, 0.15);
  --danger:       #E06666;
  --danger-soft:  rgba(224, 102, 102, 0.15);

  --accent-good:   var(--success);
  --accent-warn:   var(--warning);
  --accent-danger: var(--danger);

  /* P0-2: shadows go warm-deep rgba(8,6,4,...) instead of pure black,
   * matching the warm canvas undertone so shadows read as "paper on
   * paper at night" rather than "object floating in void". --shadow-hair
   * becomes an Apple Big Sur–style inset top-edge highlight (a 0.5px
   * cream-tinted inset) so cards in dark mode catch a subtle edge-light
   * instead of relying on outline alone. */
  --shadow-hair: inset 0 0 0 0.5px rgba(240, 232, 214, 0.06);
  --shadow-soft: 0 1px 2px rgba(8, 6, 4, 0.6),  0 4px 12px rgba(8, 6, 4, 0.5);
  --shadow-pop:  0 2px 4px rgba(8, 6, 4, 0.7),  0 12px 28px rgba(8, 6, 4, 0.55);
  --shadow-float:0 1px 2px rgba(8, 6, 4, 0.7),  0 24px 56px -16px rgba(8, 6, 4, 0.7);
  --shadow-cta:  0 2px 4px rgba(224, 106, 74, 0.25), 0 12px 28px -8px rgba(224, 106, 74, 0.4);
}

/*
 * System-preference fallback — honors the user's OS theme when
 * they haven't manually overridden via data-theme="dark". Lets
 * the app ship with no settings UI and still feel dark-native
 * for night users.
 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]),
  :root:not([data-theme="light"]) page,
  :root:not([data-theme="light"]) .page {
    --ink:         #F0E8D6;
    --ink-soft:    rgba(240, 232, 214, 0.72);
    --ink-quiet:   rgba(240, 232, 214, 0.52);
    --ink-faint:   rgba(240, 232, 214, 0.32);
    --ink-inverse: #1C1A17;
    /* P1-1 + P2-2: mirror of [data-theme="dark"] — see commentary there. */
    --ink-placeholder: rgba(240, 232, 214, 0.62);
    --ink-strong:      rgba(240, 232, 214, 0.92);

    --text-primary:   var(--ink);
    --text-secondary: var(--ink-soft);
    --text-tertiary:  var(--ink-soft);
    --text-muted:     var(--ink-quiet);
    --text-faint:     var(--ink-faint);

    /* P0-1: widened surface ΔE — see [data-theme="dark"] block above for
     * the full rationale. Mirrored here so users who never toggle the
     * manual theme but have OS dark mode get the same ladder. */
    --bg-page:    #15130F;
    --bg-elev-1:  #26231E;
    --bg-elev-2:  #36322B;
    --bg-subtle:  #36322B;
    --bg-inset:   #423D33;

    --canvas:     #15130F;
    --surface:    #26231E;
    --surface-alt: #36322B;
    /* P0-3: tab bar reverses depth direction (deeper than canvas). */
    --parchment:  #13110D;
    --frame:      #332F28;
    --paper:      #26231E;
    --paper-2:    #36322B;
    --paper-3:    #423D33;

    --surface-rgb: 38, 35, 30;
    --canvas-rgb:  21, 19, 15;   /* matches new --canvas #15130F */

    --line-hair:  rgba(240, 232, 214, 0.08);
    --border:        rgba(240, 232, 214, 0.10);
    --border-strong: rgba(240, 232, 214, 0.20);

    --brand:       #E06A4A;
    --brand-deep:  #C45A3A;
    --brand-soft:  rgba(224, 106, 74, 0.15);

    --campus-blue:      #6A8AC2;
    --campus-blue-soft: rgba(106, 138, 194, 0.15);
    --campus-blue-deep: #4A6BA0;
    --campus-blue-surface: #13294B;
    --campus-orange:    #FF7B33;
    --campus-orange-deep: #FF9560;
    --campus-orange-soft: rgba(255, 123, 51, 0.15);
    /* P1-2 + P1-4: new dark-mode component tokens (see data-theme block). */
    --campus-blue-chip-bg:     rgba(19, 41, 75, 0.45);
    --campus-blue-chip-border: rgba(106, 138, 194, 0.3);
    --user-card-grad-dark:     linear-gradient(135deg, #1A2540, #2C3E5C);

    /* P0-2: warm-deep shadows + inset edge-light highlight — mirror of
     * the data-theme block. Adding these here also closes a pre-existing
     * gap where prefers-dark users (no manual theme) were inheriting
     * the LIGHT-mode shadow alphas on a dark canvas. */
    --shadow-hair: inset 0 0 0 0.5px rgba(240, 232, 214, 0.06);
    --shadow-soft: 0 1px 2px rgba(8, 6, 4, 0.6),  0 4px 12px rgba(8, 6, 4, 0.5);
    --shadow-pop:  0 2px 4px rgba(8, 6, 4, 0.7),  0 12px 28px rgba(8, 6, 4, 0.55);
    --shadow-float:0 1px 2px rgba(8, 6, 4, 0.7),  0 24px 56px -16px rgba(8, 6, 4, 0.7);
    --shadow-cta:  0 2px 4px rgba(224, 106, 74, 0.25), 0 12px 28px -8px rgba(224, 106, 74, 0.4);
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
