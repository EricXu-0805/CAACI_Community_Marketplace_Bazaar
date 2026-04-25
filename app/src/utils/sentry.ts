import type { App } from 'vue'

/*
 * Sentry initialisation for Illini Market.
 *
 * Why a wrapper instead of inlining in main.ts:
 *   1. mp-weixin and other mini-program targets bundle the entire main.ts
 *      module graph; eagerly importing @sentry/vue would balloon the
 *      mp bundle by ~80 KB even though Sentry's browser SDK does not
 *      run on the WeChat JSCore (no fetch, no Performance API, no
 *      addEventListener). The #ifdef H5 guard plus dynamic import
 *      keeps the mp build slim — Sentry code is dropped entirely by
 *      uni-app's conditional compiler.
 *   2. Centralises the DSN / env / sample-rate config so future tweaks
 *      (release tagging, beforeSend filters) do not have to touch
 *      app boot code.
 *   3. Lets us gate on VITE_SENTRY_DSN being present at runtime —
 *      preview deploys without the DSN env var fall through to a
 *      no-op without errors, and local dev runs against `vite` keep
 *      the boot path lightweight (no DSN = no Sentry init).
 *
 * The captureException helper exported here is the only Sentry surface
 * the rest of the app should call. Components and composables do
 * `import { captureException } from '../utils/sentry'` and the wrapper
 * decides whether to forward to Sentry (H5 + DSN configured) or fall
 * back to console.error (mp-weixin, or H5 without DSN).
 */

type CaptureContext = {
  tags?: Record<string, string>
  extra?: Record<string, unknown>
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug'
}

let sentryRef: typeof import('@sentry/vue') | null = null

export async function initSentry(app: App): Promise<void> {
  // #ifdef H5
  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined) || ''
  if (!dsn) return

  try {
    const Sentry = await import('@sentry/vue')
    const env = (import.meta.env.MODE as string | undefined) || 'production'
    const release = (import.meta.env.VITE_RELEASE as string | undefined) || undefined

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
       * Strip user-identifying request data by default. Supabase URLs
       * carry the project ref; Vercel edge URLs carry our own domain;
       * neither leaks PII but we drop request bodies anyway in case a
       * future call site stuffs a moderation reason or chat snippet
       * into a payload.
       */
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.request) {
          delete event.request.cookies
          delete event.request.data
        }
        return event
      },
    })

    sentryRef = Sentry
  } catch (err) {
    /*
     * Sentry init failure must never break app boot. Log to console so
     * the reason is visible during dev/preview without leaving a tracking
     * hole at runtime — captureException calls below will quietly noop
     * since sentryRef stays null.
     */
    console.warn('[sentry] init failed', err)
  }
  // #endif
  // #ifndef H5
  void app
  // #endif
}

/*
 * Forward an exception to Sentry on H5 (when initialised), or fall
 * through to console.error elsewhere. Always swallows its own errors —
 * a broken telemetry path must never produce visible failures in the
 * app.
 */
export function captureException(err: unknown, ctx?: CaptureContext): void {
  if (sentryRef) {
    try {
      sentryRef.captureException(err, ctx as Parameters<typeof sentryRef.captureException>[1])
      return
    } catch (telemErr) {
      console.warn('[sentry] captureException failed', telemErr)
    }
  }
  if (ctx?.tags || ctx?.extra) {
    console.error('[error]', err, ctx)
  } else {
    console.error('[error]', err)
  }
}

export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  if (sentryRef) {
    try {
      sentryRef.captureMessage(message, level)
      return
    } catch (telemErr) {
      console.warn('[sentry] captureMessage failed', telemErr)
    }
  }
  if (level === 'error') console.error('[message]', message)
  else if (level === 'warning') console.warn('[message]', message)
  else console.log('[message]', message)
}
