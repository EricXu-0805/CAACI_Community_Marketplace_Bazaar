import type { App } from 'vue'

/*
 * Sentry initialisation for Illini Market.
 *
 * The @sentry/vue static import + initSentry body are wrapped in
 * #ifdef H5. uni-app's conditional-compilation preprocessor strips
 * the entire H5 block before Vite bundles, so the mp-weixin /
 * mp-alipay / etc. builds never see the Sentry SDK — no bundle
 * weight on mini-program targets, where Sentry's browser SDK can't
 * run anyway (no fetch, no Performance API, no addEventListener).
 *
 * Synchronous init (vs the previous async dynamic import) is what
 * keeps the @sentry/vue "Misconfigured SDK. Vue app is already
 * mounted." warning from firing — uni-app calls our createApp() and
 * mounts immediately, so Sentry has to be live before that mount.
 *
 * captureException is the only call surface other modules should
 * use. On H5 with DSN configured, it forwards to Sentry. On
 * mp-weixin or H5 without DSN, it falls back to console.error so
 * crashes still surface in WeChat DevTools / browser DevTools.
 */

// #ifdef H5
import * as Sentry from '@sentry/vue'
// #endif

type CaptureContext = {
  tags?: Record<string, string>
  extra?: Record<string, unknown>
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug'
}

export function initSentry(app: App): void {
  // #ifdef H5
  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined) || ''
  if (!dsn) return

  const env = (import.meta.env.MODE as string | undefined) || 'production'
  const release = (import.meta.env.VITE_RELEASE as string | undefined) || undefined

  try {
    Sentry.init({
      app,
      dsn,
      environment: env,
      release,
      /*
       * 10% sampling on traces — enough to spot trends without melting
       * the Sentry quota. Fully sampled errors so nothing slips through.
       * profilesSampleRate left unset (Sentry profiling adds a heavy
       * runtime cost; revisit only if we need flame graphs).
       */
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      integrations: [
        Sentry.browserTracingIntegration(),
      ],
      /*
       * Drop the three highest-volume noise sources before they hit the
       * Sentry quota. Each one is benign behavior, not a real bug:
       *
       *   · Failed to fetch dynamically imported module / Unable to
       *     preload CSS — stale chunk references after a Vercel deploy.
       *     The window.unhandledrejection listener in App.vue picks
       *     these up and triggers window.location.reload() so the user
       *     gets the new bundle automatically.
       *   · AbortError: Share canceled — DOMException code 20 thrown
       *     when a user dismisses the native share sheet. The share
       *     callsites already .catch() this; this filter is a
       *     belt-and-suspenders for any future callsite that forgets.
       */
      ignoreErrors: [
        /Failed to fetch dynamically imported module/i,
        /Unable to preload CSS/i,
        'AbortError: Share canceled',
      ],
      /*
       * Strip user-identifying request data by default. Supabase URLs
       * carry the project ref; Vercel edge URLs carry our own domain;
       * neither leaks PII but we drop request bodies anyway in case a
       * future call site stuffs a moderation reason or chat snippet
       * into a payload.
       */
      sendDefaultPii: false,
      beforeSend(event, hint) {
        if (event.request) {
          delete event.request.cookies
          delete event.request.data
        }

        /*
         * Normalize uni-app callback rejections from the {errMsg: "..."}
         * shape into a real exception value so Sentry can group them by
         * the actual error string instead of bucketing every single one
         * under the unhelpful "Object captured as promise rejection
         * with keys: errMsg" placeholder.
         *
         * The underlying offenders are uni.* APIs (chooseImage,
         * uploadFile, previewImage, showShareMenu, etc) whose .fail
         * callbacks reject without wrapping err in `new Error(...)`.
         * Most call sites in this repo wrap correctly; this catches
         * any future leak so the alert remains debuggable.
         */
        const orig = hint?.originalException as { errMsg?: unknown } | null | undefined
        if (
          orig &&
          typeof orig === 'object' &&
          !(orig instanceof Error) &&
          'errMsg' in orig &&
          typeof orig.errMsg === 'string'
        ) {
          event.exception = {
            values: [{ type: 'UniAppRejection', value: orig.errMsg }],
          }
          event.tags = { ...event.tags, source: 'uni-app-errMsg' }
        }
        return event
      },
    })
  } catch (err) {
    /*
     * Sentry init failure must never break app boot. Log to console
     * so the reason is visible during dev/preview without leaving a
     * tracking hole at runtime — captureException calls below quietly
     * fall through to console.error since the Sentry.captureException
     * call itself will throw if init failed.
     */
    console.warn('[sentry] init failed', err)
  }
  // #endif
  // #ifndef H5
  void app
  // #endif
}

export function captureException(err: unknown, ctx?: CaptureContext): void {
  // #ifdef H5
  try {
    Sentry.captureException(err, ctx as Parameters<typeof Sentry.captureException>[1])
    return
  } catch (telemErr) {
    console.warn('[sentry] captureException failed', telemErr)
  }
  // #endif
  if (ctx?.tags || ctx?.extra) {
    console.error('[error]', err, ctx)
  } else {
    console.error('[error]', err)
  }
}

export function addBreadcrumb(crumb: {
  category: string
  message: string
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug'
  data?: Record<string, unknown>
}): void {
  // #ifdef H5
  try {
    Sentry.addBreadcrumb({
      category: crumb.category,
      message: crumb.message,
      level: crumb.level || 'info',
      data: crumb.data,
    })
    return
  } catch (telemErr) {
    console.warn('[sentry] addBreadcrumb failed', telemErr)
  }
  // #endif
  void crumb
}
