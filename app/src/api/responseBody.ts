export interface BoundedResponseOptions {
  maxBytes: number
  timeoutMs?: number
}

const DEFAULT_READ_TIMEOUT_MS = 25_000
const TRANSPORT_ABORT_SYMBOL = Symbol.for('caaci.transport.abort')
const TRANSPORT_CALLER_SIGNAL_SYMBOL = Symbol.for('caaci.transport.callerSignal')
const activeStreamReaders = new WeakMap<object, ReadableStreamDefaultReader<Uint8Array>>()

export class ResponseBodyBoundaryError extends Error {
  readonly code: 'response_body_too_large' | 'response_body_timeout' | 'response_body_invalid'

  constructor(code: ResponseBodyBoundaryError['code']) {
    super(code)
    this.name = 'ResponseBodyBoundaryError'
    this.code = code
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i += 1
      } else {
        bytes += 3
      }
    } else bytes += 3

  }
  return bytes
}

function declaredLength(response: Response): number | null {
  const raw = response.headers?.get?.('content-length')
  if (!raw || !/^\d+$/.test(raw.trim())) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function abortAndCancelResponse(response: Response): void {
  try {
    const abortTransport = (response as any)[TRANSPORT_ABORT_SYMBOL]
    abortTransport?.()
  } catch {}

  try {
    const reader = activeStreamReaders.get(response)
    const cancellation = reader ? reader.cancel() : response.body?.cancel()
    if (cancellation && typeof cancellation.catch === 'function') {
      void cancellation.catch(() => {})
    }
  } catch {}
}

function withReadTimeout<T>(operation: Promise<T>, response: Response, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let callerAbort: (() => void) | null = null
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // platformFetch also aborts its transport controller. This cancellation
      // is a best-effort fallback for injected/test fetchers and native
      // responses that were not created by platformFetch.
      abortAndCancelResponse(response)
      reject(new ResponseBodyBoundaryError('response_body_timeout'))
    }, timeoutMs)
  })

  let callerSignal: AbortSignal | null = null
  try {
    const possibleSignal = (response as any)[TRANSPORT_CALLER_SIGNAL_SYMBOL]
    if (possibleSignal && typeof possibleSignal.addEventListener === 'function') {
      callerSignal = possibleSignal as AbortSignal
    }
  } catch {}
  const caller = new Promise<never>((_, reject) => {
    if (!callerSignal) return
    callerAbort = () => {
      abortAndCancelResponse(response)
      const error = new Error('request_aborted')
      error.name = 'AbortError'
      reject(error)
    }
    if (callerSignal.aborted) callerAbort()
    else callerSignal.addEventListener('abort', callerAbort, { once: true })
  })

  return Promise.race([operation, deadline, caller]).finally(() => {
    if (timer) clearTimeout(timer)
    if (callerAbort) callerSignal?.removeEventListener('abort', callerAbort)
  })
}

async function readStreamText(response: Response, maxBytes: number): Promise<string> {
  const body = response.body
  if (!body || typeof body.getReader !== 'function') return response.text()
  const reader = body.getReader()
  activeStreamReaders.set(response, reader)
  const decoder = new TextDecoder()
  const parts: string[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        abortAndCancelResponse(response)
        throw new ResponseBodyBoundaryError('response_body_too_large')
      }
      parts.push(decoder.decode(value, { stream: true }))
    }
    parts.push(decoder.decode())
    return parts.join('')
  } finally {
    activeStreamReaders.delete(response)
    try { reader.releaseLock() } catch {}
  }
}

/**
 * Read a small API response without trusting Content-Length. The header is an
 * early rejection only; the decoded UTF-8 byte count remains authoritative so
 * chunked or dishonest responses cannot bypass the limit. Mini-program
 * responses expose `.text()` but no readable stream, so this intentionally
 * uses the cross-platform body reader rather than H5-only stream APIs.
 */
export async function readBoundedText(
  response: Response,
  options: BoundedResponseOptions,
): Promise<string> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
    throw new TypeError('invalid_response_body_limit')
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('invalid_response_body_timeout')
  }
  const maxBytes = options.maxBytes
  const length = declaredLength(response)
  if (length !== null && length > maxBytes) {
    abortAndCancelResponse(response)
    throw new ResponseBodyBoundaryError('response_body_too_large')
  }

  const text = await withReadTimeout(
    Promise.resolve().then(() => (
      typeof TextDecoder !== 'undefined'
        ? readStreamText(response, maxBytes)
        : response.text()
    )),
    response,
    timeoutMs,
  )
  if (utf8ByteLength(text) > maxBytes) {
    throw new ResponseBodyBoundaryError('response_body_too_large')
  }
  return text
}

export async function readBoundedJson<T = unknown>(
  response: Response,
  options: BoundedResponseOptions,
): Promise<T> {
  const text = await readBoundedText(response, options)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ResponseBodyBoundaryError('response_body_invalid')
  }
}
