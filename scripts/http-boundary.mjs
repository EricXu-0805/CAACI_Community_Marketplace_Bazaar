const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_BYTES = 1024 * 1024

/**
 * Accept production HTTPS origins and explicit loopback HTTP for local
 * rehearsals. Paths, credentials, query strings and fragments are rejected so
 * a privileged key is never sent to an accidentally malformed destination.
 */
export function normalizeSupabaseOrigin(raw) {
  try {
    const url = new URL(String(raw || '').trim())
    const loopbackHttp = url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !loopbackHttp) return ''
    if (url.username || url.password || url.search || url.hash) return ''
    if (url.pathname !== '/' && url.pathname !== '') return ''
    return url.origin
  } catch {
    return ''
  }
}

/**
 * Backfill media must come from the configured Supabase Storage origin. Rows
 * are database content, not a trusted egress allowlist; following arbitrary
 * URLs here would turn an operator's laptop/runner into an SSRF client.
 */
export function normalizeStorageObjectUrl(raw, supabaseOrigin) {
  try {
    const origin = normalizeSupabaseOrigin(supabaseOrigin)
    if (!origin) return ''
    const url = new URL(String(raw || '').trim())
    if (url.origin !== origin || url.username || url.password || url.hash) return ''
    if (!url.pathname.startsWith('/storage/v1/object/')) return ''
    return url.toString()
  } catch {
    return ''
  }
}

function parseContentLength(headers) {
  const raw = headers?.get?.('content-length')
  if (!raw || !/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

async function readBoundedBytes(response, maxBytes) {
  const declared = parseContentLength(response.headers)
  if (declared !== null && declared > maxBytes) {
    try { await response.body?.cancel() } catch {}
    throw new Error('response_too_large')
  }

  const body = response.body
  if (!body || typeof body.getReader !== 'function') {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw new Error('response_too_large')
    return bytes
  }

  const reader = body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) throw new Error('response_malformed')
      size += value.byteLength
      if (size > maxBytes) {
        try { await reader.cancel() } catch {}
        throw new Error('response_too_large')
      }
      chunks.push(value)
    }
  } finally {
    try { reader.releaseLock() } catch {}
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/**
 * Fetch and fully buffer a small operational response under one timeout. The
 * same AbortSignal remains live while the body is read, closing the common
 * "headers arrived, body stalled forever" gap.
 */
export async function fetchBounded(
  fetchImpl,
  input,
  init = {},
  { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {},
) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch_required')
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('invalid_timeout')
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError('invalid_max_bytes')

  const controller = new AbortController()
  const upstreamSignal = init.signal
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason)
  if (upstreamSignal?.aborted) abortFromUpstream()
  else upstreamSignal?.addEventListener?.('abort', abortFromUpstream, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('request_timeout')), timeoutMs)

  try {
    const response = await fetchImpl(input, {
      ...init,
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    const bytes = await readBoundedBytes(response, maxBytes)
    const decoder = new TextDecoder()
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      bytes,
      async text() {
        return decoder.decode(bytes)
      },
      async json() {
        return JSON.parse(decoder.decode(bytes))
      },
    }
  } finally {
    clearTimeout(timer)
    upstreamSignal?.removeEventListener?.('abort', abortFromUpstream)
  }
}
