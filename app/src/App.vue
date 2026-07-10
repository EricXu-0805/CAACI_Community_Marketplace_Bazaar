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
   * Expired / invalid email link (signup-confirm OR password recovery):
   * Supabase redirects to `${origin}/#error=access_denied&error_code=otp_expired
   * &error_description=...` with NO code. Without this branch the code-probe
   * below finds nothing and returns, leaving the unroutable `#error=...` hash —
   * the router can't match it, so the user sees a blank screen. Catch it here:
   * clear the hash and send them to login with a notice. Error-only and
   * orthogonal to the PKCE / recovery / OAuth code paths (which all require a
   * `code`; an error redirect never carries one).
   */
  const errInUrl = /[#?&]error_code=/.test(hash) || /[#?&]error_code=/.test(search)
  const onResetRoute = (hash.split('?')[0] || '').toLowerCase().includes('/pages/reset-password/')
  // Let the reset-password page render its own tailored "link expired" UI; only
  // rescue the root/signup-confirm case, which otherwise blanks on `#error=`.
  if (errInUrl && !onResetRoute) {
    console.log('[reset-pw-debug] entry: auth error redirect detected, routing to login')
    try { window.history.replaceState(null, '', window.location.pathname) } catch {}
    setTimeout(() => {
      uni.reLaunch({ url: '/pages/login/index' })
      setTimeout(() => uni.showToast({
        title: '邮件链接已失效，请重新获取 · Link expired, request a new one',
        icon: 'none',
        duration: 3500,
      }), 300)
    }, 0)
    return
  }

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

    /*
     * Proactive "new version available" check. This app has NO service worker,
     * so an open tab keeps running the bundle it booted with after a deploy —
     * users (and device QA) end up testing a stale build and report fixes as
     * "not done". On returning to the foreground we re-fetch index.html
     * (no-store) and compare the live entry-bundle hash to the one this tab
     * booted with; a mismatch means a deploy landed → offer a one-tap refresh.
     * Prompt at most once per distinct deployed hash so it never nags.
     */
    if (typeof document !== 'undefined') {
      const entryHash = (): string | null => {
        const s = document.querySelector('script[type="module"][src*="/assets/index-"]') as HTMLScriptElement | null
        const m = s?.src.match(/index-([\w-]+)\.js/)
        return m ? m[1] : null
      }
      const bootHash = entryHash()
      let prompting = false
      let promptedHash: string | null = null
      const checkVersion = async () => {
        if (!bootHash || prompting) return
        try {
          const html = await fetch(`/?_v=${Date.now()}`, { cache: 'no-store' }).then((r) => r.text())
          const m = html.match(/\/assets\/index-([\w-]+)\.js/)
          const live = m ? m[1] : null
          if (live && live !== bootHash && live !== promptedHash) {
            prompting = true
            promptedHash = live
            uni.showModal({
              title: t('app.updateTitle'),
              content: t('app.updateAvailable'),
              confirmText: t('app.updateNow'),
              cancelText: t('app.updateLater'),
              success: (res) => {
                prompting = false
                if (res.confirm) { try { window.location.reload() } catch {} }
              },
              fail: () => { prompting = false },
            })
          }
        } catch {}
      }
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkVersion()
      })
      setTimeout(checkVersion, 45000)
    }
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
  --text-muted:     #6B6459;
  --text-faint:     #B6AE9F;
  --text-disabled:  #C0BCB2;
  --ink:         #2A2A2E;
  --ink-soft:    #57524B;
  --ink-quiet:   #6B6459;
  --ink-faint:   #B6AE9F;
  --ink-inverse: #F5F0E6;
  --ink-disabled: #C0BCB2;
  --bg-page:    #F7F4EE;
  --bg-elev-1:  #FFFFFF;
  --bg-elev-2:  #F1ECE2;
  --bg-subtle:  #F1ECE2;
  --bg-inset:   #E9E2D4;
  --canvas:        #F7F4EE;
  --surface:       #FFFFFF;
  --surface-alt:   #F1ECE2;
  --parchment:     #F1ECE2;
  --frame:         #E9E2D4;
  --surface-rgb: 255, 255, 255;
  --canvas-rgb:  247, 244, 238;
  --paper:      #FFFFFF;
  --paper-2:    #F1ECE2;
  --paper-3:    #E9E2D4;
  --line-hair:  rgba(42, 42, 46, 0.06);
  --line-soft:  rgba(42, 42, 46, 0.10);
  --line-bold:  rgba(42, 42, 46, 0.16);
  --border:        #ECE5DA;
  --border-strong: #DBD2C2;
  --border-hair:   rgba(42, 42, 46, 0.05);
  --border-warm:   #ECE5DA;
  --brand:          #C74A2F;
  --brand-deep:     #A23A22;
  --brand-soft:     #F5D9CE;
  --brand-ghost:    #FBEAE2;
  --campus-blue:      #13294B;
  --campus-blue-soft: #E5EAF2;
  --campus-blue-deep: #0A1A33;
  --campus-blue-surface: #13294B;
  --campus-orange:    #FF5F05;
  --campus-orange-deep: #B33D00;
  --campus-orange-surface: #B33D00;
  --campus-orange-soft: #FFF1E6;
  --accent-primary:      #C74A2F;
  --accent-primary-soft: #F5D9CE;
  --accent-primary-deep: #A03A24;
  --accent-action:       #C74A2F;
  --accent-ink:          #2A2A2E;
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
  --font-sans:  var(--font-hei);
  --shadow-hair:  0 0 0 1px rgba(54, 40, 28, 0.07);
  --shadow-soft:  0 1px 2px rgba(54, 40, 28, 0.05), 0 4px 14px rgba(54, 40, 28, 0.07);
  --shadow-pop:   0 2px 6px rgba(54, 40, 28, 0.06), 0 14px 30px rgba(54, 40, 28, 0.10);
  --shadow-float: 0 1px 2px rgba(54, 40, 28, 0.08), 0 26px 58px -16px rgba(54, 40, 28, 0.20);
  --shadow-cta:   0 2px 4px rgba(199, 74, 47, 0.15), 0 12px 28px -8px rgba(199, 74, 47, 0.28);
  --shadow-brand: 0 2px 4px rgba(199, 74, 47, 0.15), 0 12px 28px -8px rgba(199, 74, 47, 0.28);
  --shadow-fab:   0 4px 14px rgba(199, 74, 47, 0.30);
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

  --t-display: 40px;   --lh-display: 1.08;  --ls-display: -0.025em;
  --t-h1:      28px;   --lh-h1:      1.18;  --ls-h1:      -0.02em;
  --t-h2:      22px;   --lh-h2:      1.25;  --ls-h2:      -0.015em;
  --t-h3:      17px;   --lh-h3:      1.3;   --ls-h3:      -0.01em;
  --t-body:    15px;   --lh-body:    1.6;   --ls-body:    0.02em;
  --t-caption: 13px;   --lh-caption: 1.45;
  --t-meta:    12px;   --lh-meta:    1.4;
  --t-micro:   11px;   --lh-micro:   1.4;
  --t-tag:     10px;   --lh-tag:     1;
  --t-price-lg: 22px;
  --t-price-md: 17px;
  --t-price-sm: 14px;
  --ls-price:  -0.02em;

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
  /* Paint the document root so no region ever falls through to the
     browser-default canvas (black under a dark-mode browser). On desktop
     the translucent fixed sidebar and short/centered pages would otherwise
     expose an unpainted band. --canvas is defined on :root and flips per
     theme ([data-theme=dark] + @media dark), so it resolves correctly here. */
  background: var(--canvas);
  min-height: 100%;
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

/* Auto (system) dark must mirror the manual toggle — without this, users
   on prefers-color-scheme:dark with no manual override got the LIGHT
   floor (#2A2A2E) on dark backgrounds: every bare <text> unreadable.
   Root cause of the 2026-06 "黑面 tab 看不清" meeting finding. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) text {
    color: #F0E8D6;
  }
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
  --text-muted:     #6B6459;   /* ink-quiet — meta · stone */
  --text-faint:     #B6AE9F;   /* ink-faint — scaffolding */
  --text-disabled:  #C0BCB2;

  /* ---------- NEW SEMANTIC NAMES (prefer these going forward) ---------- */
  --ink:         #2A2A2E;   /* warm charcoal — body + titles */
  --ink-soft:    #57524B;
  --ink-quiet:   #6B6459;
  --ink-faint:   #B6AE9F;
  --ink-inverse: #F5F0E6;   /* text on ink panels (cream) */
  --ink-disabled: #C0BCB2;

  /* ---------- SURFACES ----------
   * Three-layer stack:
   *   canvas (page bg)  — warm cream
   *   surface (card)    — slightly lighter paper
   *   surface-alt       — chip / inset / tab bar paper-fabric
   *   frame             — pressed chip / hover
   */
  --bg-page:    #F7F4EE;   /* canvas - page background */
  --bg-elev-1:  #FFFFFF;   /* surface - card (clean warm white) */
  --bg-elev-2:  #F1ECE2;   /* surface-alt - tab bar + inset bg */
  --bg-subtle:  #F1ECE2;   /* chip / input / meta bg */
  --bg-inset:   #E9E2D4;   /* pressed chip / frame */

  --canvas:        #F7F4EE;
  --surface:       #FFFFFF;
  --surface-alt:   #F1ECE2;
  --parchment:     #F1ECE2;   /* alias for tab bar treatment */
  --frame:         #E9E2D4;

  /*
   * Surface + canvas RGB triplets — for rgba() so frosted-glass
   * headers can fade out over the native surface color. Dark-
   * mode block below flips these to dark equivalents.
   */
  --surface-rgb: 255, 255, 255;
  --canvas-rgb:  247, 244, 238;

  /* Legacy paper aliases (back-compat with Phase 1-3 code) */
  --paper:      #FFFFFF;
  --paper-2:    #F1ECE2;
  --paper-3:    #E9E2D4;

  /* ---------- BORDERS (warm beige — paper-edge feel) ---------- */
  --line-hair:  rgba(42, 42, 46, 0.06);
  --line-soft:  rgba(42, 42, 46, 0.10);
  --line-bold:  rgba(42, 42, 46, 0.16);

  --border:        #ECE5DA;
  --border-strong: #DBD2C2;
  --border-hair:   rgba(42, 42, 46, 0.05);
  --border-warm:   #ECE5DA;   /* same as default; kept for back-compat */

  /* ---------- BRAND (terracotta — pottery red) ---------- */
  --brand:          #C74A2F;   /* terracotta — price · CTA · seal */
  --brand-deep:     #A23A22;   /* hover / pressed */
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
  --campus-orange-surface: #B33D00; /* stable fill: white text stays AA in both themes */
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
  --accent-good:         #5D7C4A;   /* sage olive — verified · free price */
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
  --font-sans:  var(--font-hei);

  /* ---------- ELEVATION (warm ink alpha — paper drop shadow)
   * Apple-style 3-layer soft lift, tuned to warm cream canvas.
   * No heavy black drop-shadows — uses ink charcoal at low alpha
   * so the lift reads as "card on paper" instead of "screen". */
  --shadow-hair:       0 0 0 1px rgba(54, 40, 28, 0.07);
  --shadow-soft:       0 1px 2px rgba(54, 40, 28, 0.05),
                       0 4px 14px rgba(54, 40, 28, 0.07);
  --shadow-pop:        0 2px 6px rgba(54, 40, 28, 0.06),
                       0 14px 30px rgba(54, 40, 28, 0.10);
  --shadow-float:      0 1px 2px rgba(54, 40, 28, 0.08),
                       0 26px 58px -16px rgba(54, 40, 28, 0.20);
  --shadow-cta:        0 2px 4px rgba(199, 74, 47, 0.15),
                       0 12px 28px -8px rgba(199, 74, 47, 0.28);
  --shadow-brand:      var(--shadow-cta);
  --shadow-fab:        0 4px 14px rgba(199, 74, 47, 0.30);

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

  /* M1 — type scale + price scale tokens (kit v5 colors_and_type.css).
   * Consumed by global .t-* classes below. ls-body 0.02em + lh-body 1.6
   * is the kit's anti-plastic body stack — body text already applies
   * these inline above; tokens are the spec source. */
  --t-display: 40px;   --lh-display: 1.08;  --ls-display: -0.025em;
  --t-h1:      28px;   --lh-h1:      1.18;  --ls-h1:      -0.02em;
  --t-h2:      22px;   --lh-h2:      1.25;  --ls-h2:      -0.015em;
  --t-h3:      17px;   --lh-h3:      1.3;   --ls-h3:      -0.01em;
  --t-body:    15px;   --lh-body:    1.6;   --ls-body:    0.02em;
  --t-caption: 13px;   --lh-caption: 1.45;
  --t-meta:    12px;   --lh-meta:    1.4;
  --t-micro:   11px;   --lh-micro:   1.4;
  --t-tag:     10px;   --lh-tag:     1;
  --t-price-lg: 22px;
  --t-price-md: 17px;
  --t-price-sm: 14px;
  --ls-price:  -0.02em;
}

/* M1 — desktop type-scale bump (kit v5 colors_and_type.css:456-462).
 * H5 ≥768px only; mp-weixin is mobile and never hits this breakpoint
 * so no page/.page mirror is needed. */
@media (min-width: 768px) {
  :root {
    --t-display: 56px;   --lh-display: 1.05;
    --t-h1:      38px;   --lh-h1:      1.15;
    --t-h2:      26px;
    --t-body:    16px;
  }
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
  --bg-page:    #12100D;   /* graphite — deeper, less chocolate */
  --bg-elev-1:  #201E1A;
  --bg-elev-2:  #2C2A25;   /* chip bg — warm-graphite step */
  --bg-subtle:  #2C2A25;
  --bg-inset:   #383530;   /* pressed/inset */

  --canvas:     #12100D;   /* graphite — deeper, less chocolate */
  --surface:    #201E1A;
  --surface-alt: #2C2A25;
  /* P0-3: tab bar reverses depth direction in dark — bar is DEEPER than
   * canvas so it reads as a base shelf instead of a floating panel. */
  --parchment:  #0D0C0A;   /* now darker than canvas */
  --frame:      #34312B;
  --paper:      #201E1A;
  --paper-2:    #2C2A25;   /* alias of surface-alt */
  --paper-3:    #383530;   /* pressed/inset */

  --surface-rgb: 32, 30, 26;
  --canvas-rgb:  18, 16, 13;   /* matches new --canvas #12100D so frosted-glass headers fade without color banding */

  --line-hair:  rgba(240, 232, 214, 0.08);
  --line-soft:  rgba(240, 232, 214, 0.12);
  --line-bold:  rgba(240, 232, 214, 0.18);
  --border:        rgba(245, 240, 232, 0.12);
  --border-strong: rgba(245, 240, 232, 0.22);
  --border-hair:   rgba(245, 240, 232, 0.07);

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
  --campus-orange-surface: #B33D00; /* stable fill: white text stays AA in both themes */
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
    --bg-page:    #12100D;
    --bg-elev-1:  #201E1A;
    --bg-elev-2:  #2C2A25;
    --bg-subtle:  #2C2A25;
    --bg-inset:   #383530;

    --canvas:     #12100D;
    --surface:    #201E1A;
    --surface-alt: #2C2A25;
    /* P0-3: tab bar reverses depth direction (deeper than canvas). */
    --parchment:  #0D0C0A;
    --frame:      #34312B;
    --paper:      #201E1A;
    --paper-2:    #2C2A25;
    --paper-3:    #383530;

    --surface-rgb: 32, 30, 26;
    --canvas-rgb:  18, 16, 13;   /* matches new --canvas #12100D */

    --line-hair:  rgba(240, 232, 214, 0.08);
    --line-soft:  rgba(240, 232, 214, 0.12);
    --line-bold:  rgba(240, 232, 214, 0.18);
    --border:        rgba(245, 240, 232, 0.12);
    --border-strong: rgba(245, 240, 232, 0.22);
    --border-hair:   rgba(245, 240, 232, 0.07);
    --text-disabled: rgba(240, 232, 214, 0.22);

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
    /* Aliases must follow the base trio so var() resolves to the dark values. */
    --accent-good:   var(--success);
    --accent-warn:   var(--warning);
    --accent-danger: var(--danger);

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
 * Use serif on numbers + brand + prices + headings; sans on
 * everything else. Never mix serif for a 10-11px CN label —
 * it glyph-crams on retina screens.
 * ============================================================ */

/* ============================================================
 * M1 — kit v5 semantic type ladder (mirrored from
 * colors_and_type.css §SEMANTIC TYPE CLASSES, lines 336-373).
 *
 * Phase 1a (M1, this PR) installs definitions only. No surface
 * consumes these yet — `.t-*` migration is M3. Zero visual
 * change expected.
 * ============================================================ */
.t-display { font-family: var(--font-serif); font-weight: var(--font-weight-regular);
             font-size: var(--t-display); line-height: var(--lh-display);
             letter-spacing: var(--ls-display); color: var(--ink); }
.t-h1      { font-family: var(--font-serif); font-weight: var(--font-weight-medium);
             font-size: var(--t-h1); line-height: var(--lh-h1);
             letter-spacing: var(--ls-h1); color: var(--ink); }
.t-h2      { font-family: var(--font-serif); font-weight: var(--font-weight-medium);
             font-size: var(--t-h2); line-height: var(--lh-h2);
             letter-spacing: var(--ls-h2); color: var(--ink); }
.t-h3      { font-family: var(--font-serif); font-weight: var(--font-weight-medium);
             font-size: var(--t-h3); line-height: var(--lh-h3);
             letter-spacing: var(--ls-h3); color: var(--ink); }
.t-title    { font-family: var(--font-hei); font-weight: var(--font-weight-semi);
              font-size: 15px; line-height: 1.35; color: var(--ink); }
.t-body     { font-family: var(--font-hei); font-size: var(--t-body);
              line-height: var(--lh-body); letter-spacing: var(--ls-body);
              color: var(--ink); }
.t-caption  { font-family: var(--font-hei); font-size: var(--t-caption);
              line-height: var(--lh-caption); color: var(--ink); }
.t-meta     { font-family: var(--font-hei); font-size: var(--t-meta);
              line-height: var(--lh-meta); color: var(--ink-quiet); }
.t-micro    { font-family: var(--font-mono); font-size: var(--t-micro);
              line-height: var(--lh-micro); color: var(--ink-quiet);
              letter-spacing: 0.06em; }
.t-tag      { font-family: var(--font-mono); font-size: var(--t-tag);
              font-weight: var(--font-weight-medium); line-height: var(--lh-tag);
              letter-spacing: 0.12em; text-transform: uppercase; }
.t-eyebrow  { font-family: var(--font-mono); font-size: 11px;
              letter-spacing: 0.16em; text-transform: uppercase;
              color: var(--ink-quiet); }

.t-price        { font-family: var(--font-serif); font-weight: var(--font-weight-semi);
                  letter-spacing: var(--ls-price); color: var(--brand); }
.t-price.lg     { font-size: var(--t-price-lg); }
.t-price.md     { font-size: var(--t-price-md); }
.t-price.sm     { font-size: var(--t-price-sm); }
.t-price.free   { color: var(--accent-good); }

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
.u-btn-brand:active { background: var(--brand-deep); box-shadow: var(--shadow-soft); }

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
.u-btn-ink:active { opacity: 0.9; }

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
  color: var(--ink-inverse);
  border-color: var(--ink);
}
.u-chip.brand {
  background: var(--brand-soft);
  color: var(--brand-deep);
  border-color: transparent;
}
.u-chip.warn {
  background: var(--warning-soft);
  color: var(--warning);
  border-color: transparent;
}

/* ---------- MOTION (transform/opacity only — mp-weixin safe) ---------- */
@keyframes heart-pop { 0% { transform: scale(1); } 40% { transform: scale(1.32); } 100% { transform: scale(1); } }
.u-anim-heart-pop { animation: heart-pop var(--dur-2) var(--ease-warm); }

/* ============================================================
 * v6 shared primitives — one source of truth so every surface
 * (feed, detail gallery, plaza mini-card, profile/seller grids,
 * search) renders photoless items + list entrances identically.
 * ============================================================ */

/* Branded photoless tile — warm theme-aware wash + a faded 集 seal,
   sized by the caller (it fills its box / inherits the aspect slot a
   real photo would take). Replaces the cold gray "No Image" SVG that
   read as a broken image — the single biggest undesigned tell. */
.u-thumb-ph {
  /* width only — height comes from the caller's inline aspect-ratio
     (feed cards) so the masonry slot is preserved. Fixed-height
     containers (detail hero, square tiles) add .u-thumb-ph--fill. */
  width: 100%;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(125% 110% at 50% 0%, var(--surface-alt) 0%, var(--frame) 100%);
}
.u-thumb-ph--fill { height: 100%; }
.u-thumb-ph-seal {
  font-family: var(--font-serif);
  font-weight: 600; color: var(--brand);
  opacity: 0.16; line-height: 1;
  font-size: 42px;
}
.u-thumb-ph--sm .u-thumb-ph-seal,
.u-thumb-ph-seal.sm { font-size: 26px; }

/* Inline "求购 / WANTED" listing-type marker for the feed cards that don't use
   the UBadge image overlay (profile / seller / following / history rows). Solid
   campus-blue, matching .u-badge--wanted, so a buyer scanning a feed can tell a
   request from a sale at a glance. Pair with listingPriceLabel() so the price
   line reads "预算 $X / 面议" instead of "Free". */
.u-wanted-tag {
  display: inline-block;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  background: var(--campus-blue-surface);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.45;
}

/* ── Liquid-glass chrome ──────────────────────────────────────────────────
 * Apple-style translucent + blurred surfaces for the app FRAME (tab bar, page
 * headers, bottom sheets, desktop sidebar) — content refracts through the
 * chrome instead of hiding behind a flat panel. Stays on the warm palette
 * because the fill derives from --surface-rgb, which flips per theme.
 *
 *   · .u-glass        — the surface (translucent fill + blur + rim-light + lift)
 *   · .u-glass--hair-t / --hair-b — add a hairline on the top/bottom edge
 *
 * H5 only gets the real backdrop blur; mp-weixin (no backdrop-filter) falls
 * back to the solid --surface so chrome never turns into an unreadable smear.
 * Reduced-transparency users also get the solid fill. The rim-light is an inset
 * top line (light catching the glass edge); the drop is a soft warm lift. */
.u-glass {
  /* #ifdef H5 */
  background: rgba(var(--surface-rgb), 0.60);
  -webkit-backdrop-filter: saturate(195%) blur(28px);
  backdrop-filter: saturate(195%) blur(28px);
  /* #endif */
  /* #ifndef H5 */
  background: var(--surface);
  /* #endif */
  box-shadow:
    inset 0 1px 0 0 rgba(255, 255, 255, 0.85),
    0 8px 28px -10px rgba(60, 42, 28, 0.28);
}
.u-glass--hair-b { border-bottom: 0.5px solid rgba(40, 30, 20, 0.07); }
.u-glass--hair-t { border-top: 0.5px solid rgba(40, 30, 20, 0.07); }

/* QA6 #11 — app-wide horizontal-scroll lock. `clip` (not `hidden`) so .page
   never becomes a scroll container — `hidden` flips overflow-y to `auto` and
   breaks viewport-relative position:sticky chrome. Pages with fixed-position
   children (e.g. saved-searches' FAB + sheets) could otherwise be panned
   sideways, clipping the header. Scoped horizontal scroll-views (the category
   rail etc.) have their own scroll context and are unaffected. */
page, .page { overflow-x: clip; }

[data-theme="dark"] .u-glass {
  /* #ifdef H5 */
  background: rgba(var(--surface-rgb), 0.46);
  /* #endif */
  box-shadow:
    inset 0 1px 0 0 rgba(255, 255, 255, 0.12),
    0 10px 30px -10px rgba(0, 0, 0, 0.6);
}
[data-theme="dark"] .u-glass--hair-b { border-bottom-color: rgba(245, 240, 232, 0.08); }
[data-theme="dark"] .u-glass--hair-t { border-top-color: rgba(245, 240, 232, 0.08); }

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .u-glass {
    /* #ifdef H5 */
    background: rgba(var(--surface-rgb), 0.46);
    /* #endif */
    box-shadow:
      inset 0 1px 0 0 rgba(255, 255, 255, 0.12),
      0 10px 30px -10px rgba(0, 0, 0, 0.6);
  }
  :root:not([data-theme="light"]) .u-glass--hair-b { border-bottom-color: rgba(245, 240, 232, 0.08); }
  :root:not([data-theme="light"]) .u-glass--hair-t { border-top-color: rgba(245, 240, 232, 0.08); }
}

@media (prefers-reduced-transparency: reduce) {
  .u-glass {
    /* #ifdef H5 */
    background: var(--surface);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    /* #endif */
  }
}

/* One-shot list entrance — fade + rise the first time an element
   mounts. `backwards` fill (not `both`) applies the from-state before
   start to avoid a first-frame flash, but does NOT retain the end-
   state, so it can't outrank an :active press transform afterwards. */
@keyframes u-rise {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: none; }
}
.u-rise { animation: u-rise var(--dur-3, 360ms) var(--ease-warm, ease) backwards; }

/* #ifdef H5 */
/* Staggered list entrance — put .u-stagger on a container whose direct
   children are the cards/rows; each one fades + rises in sequence so a
   list "fans in" instead of popping as one block. The cascade caps at the
   10th child (later items share the last delay) so long / paginated lists
   never wait seconds. transform/opacity only = GPU-cheap. H5-only: it leans
   on the `>` child combinator + :nth-child, which mp-weixin's WXSS handles
   inconsistently — there the cards simply appear (graceful, build stays
   green). Appended (load-more) rows animate on mount with their nth-child
   delay; already-settled rows are untouched. Honors reduced-motion below. */
.u-stagger > * { animation: u-rise var(--dur-3, 360ms) var(--ease-warm, ease) backwards; }
.u-stagger > *:nth-child(1)  { animation-delay: 0ms; }
.u-stagger > *:nth-child(2)  { animation-delay: 36ms; }
.u-stagger > *:nth-child(3)  { animation-delay: 72ms; }
.u-stagger > *:nth-child(4)  { animation-delay: 108ms; }
.u-stagger > *:nth-child(5)  { animation-delay: 144ms; }
.u-stagger > *:nth-child(6)  { animation-delay: 180ms; }
.u-stagger > *:nth-child(7)  { animation-delay: 216ms; }
.u-stagger > *:nth-child(8)  { animation-delay: 252ms; }
.u-stagger > *:nth-child(9)  { animation-delay: 288ms; }
.u-stagger > *:nth-child(10) { animation-delay: 324ms; }
.u-stagger > *:nth-child(n+11) { animation-delay: 360ms; }
@media (prefers-reduced-motion: reduce) {
  .u-stagger > * { animation: none; }
}
/* #endif */

/* Skeleton placeholder — a warm inset block that gently pulses while content
   loads. --bg-inset flips per theme, so it reads on light and dark. Pair with
   a per-list shape (avatar circle, text line) that overrides border-radius. */
.u-sk {
  background: var(--bg-inset);
  border-radius: 6px;
  animation: u-shimmer 1.5s ease-in-out infinite;
}
@keyframes u-shimmer {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .u-sk { animation: none; }
}

/* Sheet backdrop fade-in — masks are v-if'd, so the dim sweeps in on
   mount (backwards fill = no first-frame flash). Pairs with the warm
   spring slide-up now shared by every bottom sheet. */
@keyframes u-fade-in { from { opacity: 0; } to { opacity: 1; } }
.u-mask-in { animation: u-fade-in var(--dur-2, 220ms) var(--ease-std, ease) backwards; }

@media (prefers-reduced-motion: reduce) {
  .u-rise { animation: none; }
  .u-mask-in { animation: none; }
}

/* ============================================================
 * Global tactile press — every button-like surface shrinks a
 * touch on tap and settles back on the warm curve, so the whole
 * app feels responsive ("丝滑"). On H5 :active arms on tap (uni
 * @click attaches the listener that enables it); on mp-weixin
 * :active never fires on view components — the press there is
 * hover-class="u-mp-pressed" (see the #ifndef H5 block below).
 * transform/opacity only = GPU-cheap + WXSS-safe.
 * Honors prefers-reduced-motion. The warm settle (ease-warm)
 * on release is what reads as silky vs. a flat linear snap.
 * ============================================================ */
.u-btn, .u-btn-primary, .u-btn-brand, .u-btn-ink, .u-btn-ghost,
.u-chip, .u-press, .tap,
[role="button"], button, uni-button {
  transition:
    transform 170ms var(--ease-warm, cubic-bezier(0.2, 0.8, 0.2, 1)),
    box-shadow var(--dur-2, 220ms) var(--ease-warm, cubic-bezier(0.2, 0.8, 0.2, 1)),
    background var(--dur-1, 120ms) var(--ease-std, ease),
    opacity var(--dur-1, 120ms) var(--ease-std, ease);
  -webkit-tap-highlight-color: transparent;
}
.u-chip:active, .u-press:active, .tap:active,
[role="button"]:active, button:active, uni-button:active,
.u-btn-primary:active, .u-btn-brand:active, .u-btn-ink:active, .u-btn-ghost:active {
  transform: scale(0.96);
}
@media (prefers-reduced-motion: reduce) {
  .u-anim-heart-pop { animation: none; }
  .u-btn, .u-btn-primary, .u-btn-brand, .u-btn-ink, .u-btn-ghost,
  .u-chip, .u-press, .tap, [role="button"], button, uni-button { transition: none; }
  .u-chip:active, .u-press:active, .tap:active, [role="button"]:active,
  button:active, uni-button:active,
  .u-btn-primary:active, .u-btn-brand:active, .u-btn-ink:active, .u-btn-ghost:active { transform: none; }
}

/* #ifndef H5 */
/* mp press: :active never fires on view components — WeChat's pressed-state
   mechanism is hover-class. Components opt in with hover-class="u-mp-pressed"
   (UButton root, CustomTabBar tabs). The base transition rule above contains
   [role="button"], an attribute selector WXSS rejects — and one invalid
   selector drops the WHOLE rule — so mp gets its own WXSS-safe copy here.
   Also strip the native <button> hairline WeChat draws via ::after on the
   4 form pages. */
.u-btn, .u-chip, .u-press, .tap, .tab, button {
  transition: transform 170ms var(--ease-warm, cubic-bezier(0.2, 0.8, 0.2, 1));
}
.u-mp-pressed {
  transform: scale(0.96);
}
button::after {
  border: none;
}
/* #endif */

/* ============================================================
 * Adaptive shell contract (iPad + Mac, ≥768px) — adaptive.css.
 *
 * Phones unchanged: the bottom CustomTabBar owns nav and the rail
 * stays display:none. From 768px up, AppSidebar.vue mounts as a
 * fixed left rail (replacing the old top DesktopNav); any page that
 * opts in with `.has-sidebar` on its root reserves the rail width
 * with padding-left, so its content flows in the remaining column
 * (multi-col feed / two-pane messages / centered reading panes are
 * handled per-page). One source of truth for the rail width so the
 * sidebar and the reservation can never drift apart.
 * ============================================================ */
:root { --sidebar-w: 240px; }
@media (min-width: 768px) {
  .has-sidebar { padding-left: var(--sidebar-w, 240px); box-sizing: border-box; }
}

/* #ifdef H5 */
/*
 * uni-app's H5 picker popup ships at z-index 999, which puts it UNDER any
 * in-app bottom sheet (ChatThread's offer/meetup sheets sit at 1000/1001).
 * Net effect: opening the meetup time picker from a sheet rendered the
 * popup dimmed behind the sheet mask, and tapping 完成/取消 hit the mask
 * instead — closing the whole sheet and eating the picked spot/date.
 * Pickers are a modal-on-top-of-modal; they must beat every app sheet.
 * (The popup is teleported to the uni-app root, NOT kept inside the
 * <uni-picker> element — selector must be the bare class.)
 */
.uni-picker-container { z-index: 1100 !important; }

/*
 * QA6 r7 — warm the native H5 action sheet (long-press → 置顶/免打扰/标记已读/
 * 删除, chat more-actions, report menus). uni ships it bare system-default
 * (flat rgb(252,252,253) card, 5px radius, 18px black rows, no separators) — Eric:
 * "太素". Re-skin to the app's bottom-sheet language: rounded elevated cards,
 * generous rows, hairline separators, themed ink + active state, quieter Cancel.
 * uni teleports the sheet to the document root (outside page scope) and sets some
 * inline styles, so this is a GLOBAL block with !important. CSS vars cascade from
 * :root, so it auto-adapts to dark theme. (mp uses the OS-native sheet — H5 only.)
 */
.uni-actionsheet__mask { background: rgba(28, 22, 16, 0.42) !important; }
.uni-actionsheet__menu,
.uni-actionsheet__action {
  background: var(--bg-elev-1) !important;
  border-radius: 16px !important;
  overflow: hidden;
  box-shadow: 0 10px 34px rgba(40, 30, 20, 0.16);
}
.uni-actionsheet__action { margin-top: 8px !important; }
.uni-actionsheet__cell {
  color: var(--text-primary) !important;
  font-size: 16px !important;
  font-weight: 500 !important;
  padding: 15px 16px !important;
  position: relative;
  transition: background 0.12s ease;
}
.uni-actionsheet__cell:active { background: var(--paper-2) !important; }
/* hairline between stacked menu rows (skip the last) */
.uni-actionsheet__menu .uni-actionsheet__cell:not(:last-child)::after {
  content: ''; position: absolute; left: 16px; right: 16px; bottom: 0;
  height: 0.5px; background: var(--line-hair);
}
/* optional title row (when an action sheet passes one) reads as a quiet caption */
.uni-actionsheet__title {
  color: var(--ink-quiet) !important;
  font-size: 13px !important;
  padding: 14px 16px !important;
}
/* the Cancel group stands apart — quieter ink, a touch heavier */
.uni-actionsheet__action .uni-actionsheet__cell {
  color: var(--ink-quiet) !important;
  font-weight: 600 !important;
}
/* #endif */
</style>
