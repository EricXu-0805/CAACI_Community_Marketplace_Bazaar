const REDACTED = '[redacted]'

export function redactSensitiveText(value: string): string {
  return value
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted-jwt]')
    .replace(/([?&#]|\b)(access_token|refresh_token|code|state|token|apikey|authorization)=([^&#\s]+)/gi, `$1$2=${REDACTED}`)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
}

/**
 * Traces do not need URL queries or fragments.  Strip them wholesale rather
 * than trying to maintain an allowlist: auth callbacks carry credentials and
 * ordinary API spans can carry precise location/search terms.
 */
export function scrubTraceText(value: string): string {
  return redactSensitiveText(value).replace(
    /(https?:\/\/|\/)[^\s"'<>]*/gi,
    (urlish) => {
      const boundary = urlish.search(/[?#]/)
      return boundary >= 0 ? urlish.slice(0, boundary) : urlish
    },
  )
}

export function scrubTelemetryValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]'
  if (typeof value === 'string') return redactSensitiveText(value)
  if (Array.isArray(value)) return value.map((entry) => scrubTelemetryValue(entry, depth + 1))
  if (value && typeof value === 'object') {
    const clean: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|cookie|authorization|access.?token|refresh.?token|api.?key/i.test(key)) {
        clean[key] = REDACTED
      } else {
        clean[key] = scrubTelemetryValue(entry, depth + 1)
      }
    }
    return clean
  }
  return value
}

export function scrubTraceValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]'
  if (typeof value === 'string') return scrubTraceText(value)
  if (Array.isArray(value)) return value.map((entry) => scrubTraceValue(entry, depth + 1))
  if (value && typeof value === 'object') {
    const clean: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|cookie|authorization|access.?token|refresh.?token|api.?key/i.test(key)) {
        clean[key] = REDACTED
      } else if (/^(?:url\.)?(?:query|search|fragment|hash)(?:\.|$)|query_string/i.test(key)) {
        clean[key] = REDACTED
      } else {
        clean[key] = scrubTraceValue(entry, depth + 1)
      }
    }
    return clean
  }
  return value
}

export function scrubTelemetryRequest<T extends Record<string, unknown>>(request: T): T {
  const mutable = request as Record<string, unknown>
  delete mutable.cookies
  delete mutable.data
  delete mutable.headers
  delete mutable.query_string
  delete mutable.env
  if (typeof mutable.url === 'string') mutable.url = scrubTraceText(mutable.url)
  return request
}

export function scrubTelemetrySpan<T extends {
  description?: string
  data?: Record<string, unknown>
}>(span: T): T {
  if (span.description) span.description = scrubTraceText(span.description)
  if (span.data) span.data = scrubTraceValue(span.data) as Record<string, unknown>
  return span
}
