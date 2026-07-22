import type { App } from 'vue'
import {
  scrubTelemetryRequest,
  scrubTelemetrySpan,
  scrubTraceText,
  scrubTraceValue,
} from './telemetryPrivacy'

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

type BreadcrumbLike = {
  category?: string
  message?: string
  data?: Record<string, unknown>
}

const SAFE_OPERATIONAL_REASONS = new Set([
  'no_session',
  'path_rejected',
  'session_mismatch',
  'storage_remove_failed',
])

function stableToken(value: unknown, fallback: string, maxLength = 80): string {
  if (typeof value !== 'string') return fallback
  const candidate = value.trim()
  if (!candidate || candidate.length > maxLength) return fallback
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(candidate) ? candidate : fallback
}

function safeErrorName(err: unknown): string {
  const name = err instanceof Error
    ? err.name
    : (err && typeof err === 'object' ? (err as { name?: unknown }).name : undefined)
  return stableToken(name, err && typeof err === 'object' ? 'ProviderError' : 'Error', 64)
}

function safeErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const record = err as { code?: unknown; status?: unknown; statusCode?: unknown }
  const raw = record.code ?? record.statusCode ?? record.status
  const candidate = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : raw
  const code = stableToken(candidate, '', 48)
  return code || undefined
}

function safeTelemetryUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const browserOrigin = typeof globalThis.location?.origin === 'string'
      && /^https?:\/\//i.test(globalThis.location.origin)
      ? globalThis.location.origin
      : 'https://telemetry.invalid'
    const parsed = new URL(value, browserOrigin)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined
    // Deliberately omit search + hash: filters can contain precise location,
    // free-form search text, account ids, or auth callback credentials.
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return undefined
  }
}

function safeHttpMethod(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const method = value.toUpperCase()
  return /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method) ? method : undefined
}

function safeHttpStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined
}

/**
 * Sentry's default browser integration records console arguments, fetch/XHR
 * URLs, history URLs and DOM details as breadcrumbs. Treat every breadcrumb
 * as untrusted: console arguments are dropped, network/navigation URLs retain
 * only origin + pathname, and application breadcrumbs retain only a stable
 * category (never their arbitrary message/data payload).
 */
function sanitizeBreadcrumb<T extends BreadcrumbLike>(breadcrumb: T): T | null {
  const category = stableToken(breadcrumb.category, 'application', 80)
  if (category === 'console') return null

  const clean = { ...breadcrumb, category } as T
  delete clean.data

  if (category === 'fetch' || category === 'xhr') {
    const originalData = breadcrumb.data || {}
    const data: Record<string, unknown> = {}
    const method = safeHttpMethod(originalData.method)
    const status = safeHttpStatus(originalData.status_code)
    const url = safeTelemetryUrl(originalData.url)
    if (method) data.method = method
    if (status) data.status_code = status
    if (url) data.url = url
    clean.data = data
    delete clean.message
    return clean
  }

  if (category === 'navigation') {
    const originalData = breadcrumb.data || {}
    const data: Record<string, unknown> = {}
    const from = safeTelemetryUrl(originalData.from)
    const to = safeTelemetryUrl(originalData.to)
    if (from) data.from = from
    if (to) data.to = to
    clean.data = data
    delete clean.message
    return clean
  }

  clean.message = `event:${category}`
  return clean
}

function sanitizeEventBreadcrumbs<T extends { breadcrumbs?: BreadcrumbLike[] }>(event: T): void {
  if (!event.breadcrumbs) return
  event.breadcrumbs = event.breadcrumbs
    .map((breadcrumb) => sanitizeBreadcrumb(breadcrumb))
    .filter((breadcrumb): breadcrumb is BreadcrumbLike => breadcrumb !== null)
}

function sanitizeStacktrace(stacktrace: unknown): void {
  if (!stacktrace || typeof stacktrace !== 'object') return
  const frames = (stacktrace as { frames?: Array<Record<string, unknown>> }).frames
  frames?.forEach((frame) => {
    for (const key of ['filename', 'abs_path'] as const) {
      if (typeof frame[key] === 'string') frame[key] = scrubTraceText(frame[key] as string)
    }
    // Browser events do not need local values or source-code context. Both can
    // contain Vue props, request payloads, or user-authored text.
    delete frame.vars
    delete frame.context_line
    delete frame.pre_context
    delete frame.post_context
    delete frame.function
    delete frame.module
    delete frame.package
  })
}

function safeEventTags(tags: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!tags) return undefined
  const clean: Record<string, string> = {}
  const source = stableToken(tags.source, '', 96)
  const errorName = stableToken(tags.error_name, '', 64)
  const errorCode = stableToken(tags.error_code, '', 48)
  if (source) clean.source = source
  if (errorName) clean.error_name = errorName
  if (errorCode) clean.error_code = errorCode
  if (tags.orphan_risk === 'true') clean.orphan_risk = 'true'
  if (tags.cleanup_attempted === 'true' || tags.cleanup_attempted === 'false') {
    clean.cleanup_attempted = tags.cleanup_attempted
  }
  if (typeof tags.reason === 'string' && SAFE_OPERATIONAL_REASONS.has(tags.reason)) {
    clean.reason = tags.reason
  }
  return Object.keys(clean).length > 0 ? clean : undefined
}

function sanitizeEventExceptionValues(event: {
  exception?: { values?: Array<Record<string, unknown>> }
}): void {
  event.exception?.values?.forEach((value) => {
    const type = stableToken(value.type, 'Error', 64)
    value.type = type
    value.value = `Captured ${type}`
    sanitizeStacktrace(value.stacktrace)
    sanitizeStacktrace(value.raw_stacktrace)
    if (value.mechanism && typeof value.mechanism === 'object') {
      delete (value.mechanism as Record<string, unknown>).data
    }
  })
}

function buildSafeCapturedError(err: unknown): { error: Error; name: string; code?: string } {
  const name = safeErrorName(err)
  const code = safeErrorCode(err)
  const message = code ? `Captured ${name} (${code})` : `Captured ${name}`
  const safe = new Error(message)
  safe.name = name

  // Retain useful call frames for debugging while removing the original first
  // line (which is the provider/UGC-bearing error message), arbitrary function
  // labels, and URL queries. Only normalized HTTP(S) frame locations survive.
  if (err instanceof Error && typeof err.stack === 'string') {
    const frames = err.stack
      .split('\n')
      .slice(1)
      .map((line) => line.match(/https?:\/\/[^\s)]+/i)?.[0])
      .map((url) => safeTelemetryUrl(url))
      .filter((url): url is string => Boolean(url))
      .map((url) => `    at ${url}`)
    if (frames.length > 0) safe.stack = `${name}: ${message}\n${frames.join('\n')}`
  }
  return { error: safe, name, code }
}

function safeCaptureContext(err: unknown, ctx?: CaptureContext): CaptureContext {
  const safe = buildSafeCapturedError(err)
  const source = stableToken(ctx?.tags?.source, 'application', 96)
  const tags: Record<string, string> = {
    source,
    error_name: safe.name,
  }
  if (safe.code) tags.error_code = safe.code
  if (ctx?.tags?.orphan_risk === 'true') tags.orphan_risk = 'true'
  if (ctx?.tags?.cleanup_attempted === 'true' || ctx?.tags?.cleanup_attempted === 'false') {
    tags.cleanup_attempted = ctx.tags.cleanup_attempted
  }
  if (typeof ctx?.tags?.reason === 'string' && SAFE_OPERATIONAL_REASONS.has(ctx.tags.reason)) {
    tags.reason = ctx.tags.reason
  }
  return { tags, level: ctx?.level }
}

function safeErrorSummary(err: unknown): string {
  const name = safeErrorName(err)
  const code = safeErrorCode(err)
  return code ? `${name} (${code})` : name
}

export function initSentry(app: App): void {
  // #ifdef H5
  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined) || ''
  if (!dsn) return

  const env = (import.meta.env.VITE_DEPLOY_ENV as string | undefined) || 'local'
  const release = (import.meta.env.VITE_RELEASE as string | undefined) || undefined

  try {
    Sentry.init({
      app,
      dsn,
      environment: env,
      release,
      // Vue error events otherwise include the component's complete props
      // object by default, which can contain listings, messages, or profiles.
      attachProps: false,
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
        // App.vue must synchronously consume password-recovery credentials
        // from the initial URL after createApp(). Starting an automatic page-
        // load span here would snapshot that URL first, before cleanup.
        Sentry.browserTracingIntegration({ instrumentPageLoad: false }),
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
      beforeBreadcrumb(breadcrumb) {
        return sanitizeBreadcrumb(breadcrumb)
      },
      beforeSend(event, hint) {
        if (event.request) {
          scrubTelemetryRequest(event.request as unknown as Record<string, unknown>)
        }
        delete event.user
        if (event.message) event.message = 'Application event'
        delete event.extra
        delete event.logentry
        event.tags = safeEventTags(event.tags as Record<string, unknown> | undefined)
        sanitizeEventExceptionValues(event as Parameters<typeof sanitizeEventExceptionValues>[0])
        sanitizeEventBreadcrumbs(event as Parameters<typeof sanitizeEventBreadcrumbs>[0])
        if (event.contexts) {
          const vue = event.contexts.vue as Record<string, unknown> | undefined
          if (vue) delete vue.propsData
          event.contexts = scrubTraceValue(event.contexts) as typeof event.contexts
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
            values: [{ type: 'UniAppRejection', value: 'Captured UniAppRejection' }],
          }
          event.tags = safeEventTags({ ...event.tags, source: 'uni-app-errMsg' })
        }
        return event
      },
      beforeSendTransaction(event) {
        if (event.request) {
          scrubTelemetryRequest(event.request as unknown as Record<string, unknown>)
        }
        delete event.user
        if (event.transaction) event.transaction = scrubTraceText(event.transaction)
        event.spans?.forEach((span) => scrubTelemetrySpan(span))
        if (event.contexts) event.contexts = scrubTraceValue(event.contexts) as typeof event.contexts
        if (event.extra) event.extra = scrubTraceValue(event.extra) as typeof event.extra
        sanitizeEventBreadcrumbs(event as Parameters<typeof sanitizeEventBreadcrumbs>[0])
        return event
      },
      beforeSendSpan(span) {
        return scrubTelemetrySpan(span)
      },
    })
  } catch {
    /*
     * Sentry init failure must never break app boot. Log to console
     * so the reason is visible during dev/preview without leaving a
     * tracking hole at runtime — captureException calls below quietly
     * fall through to console.error since the Sentry.captureException
     * call itself will throw if init failed.
     */
    console.warn('[sentry] init failed')
  }
  // #endif
  // #ifndef H5
  void app
  // #endif
}

export function captureException(err: unknown, ctx?: CaptureContext): void {
  // #ifdef H5
  try {
    const safe = buildSafeCapturedError(err)
    Sentry.captureException(
      safe.error,
      safeCaptureContext(err, ctx) as Parameters<typeof Sentry.captureException>[1],
    )
    return
  } catch {
    console.warn('[sentry] captureException failed')
  }
  // #endif
  console.error('[error]', safeErrorSummary(err))
}

export function addBreadcrumb(crumb: {
  category: string
  message: string
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug'
  data?: Record<string, unknown>
}): void {
  // #ifdef H5
  try {
    const safe = sanitizeBreadcrumb({
      category: crumb.category,
      message: crumb.message,
      level: crumb.level || 'info',
      data: crumb.data,
    })
    if (!safe) return
    Sentry.addBreadcrumb(safe)
    return
  } catch {
    console.warn('[sentry] addBreadcrumb failed')
  }
  // #endif
  void crumb
}
