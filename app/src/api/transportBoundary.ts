export interface TransportDeadlineOptions {
  /** Time allowed to receive response headers for ordinary JSON requests. */
  headerTimeoutMs?: number
  /** Time allowed to receive response headers while uploading binary/form data. */
  uploadHeaderTimeoutMs?: number
  /** Time allowed after headers for JSON/text/form-data body consumption. */
  structuredBodyTimeoutMs?: number
  /** Longer body window for legitimate storage downloads. */
  binaryBodyTimeoutMs?: number
}

const DEFAULT_HEADER_TIMEOUT_MS = 25_000
const DEFAULT_UPLOAD_HEADER_TIMEOUT_MS = 5 * 60_000
const DEFAULT_STRUCTURED_BODY_TIMEOUT_MS = 25_000
const DEFAULT_BINARY_BODY_TIMEOUT_MS = 5 * 60_000

type BodyReaderName = 'json' | 'text' | 'formData' | 'blob' | 'arrayBuffer'
const TRANSPORT_ABORT_SYMBOL = Symbol.for('caaci.transport.abort')
const TRANSPORT_CALLER_SIGNAL_SYMBOL = Symbol.for('caaci.transport.callerSignal')

function transportAbortError(code: string): Error {
  const error = new Error(code)
  error.name = 'AbortError'
  return error
}

function isBinaryRequestBody(body: BodyInit | null | undefined): boolean {
  if (!body) return false
  if (typeof FormData !== 'undefined' && body instanceof FormData) return true
  if (typeof Blob !== 'undefined' && body instanceof Blob) return true
  if (typeof ArrayBuffer !== 'undefined') {
    if (body instanceof ArrayBuffer) return true
    if (typeof ArrayBuffer.isView === 'function' && ArrayBuffer.isView(body as ArrayBufferView)) return true
  }
  // A streamed request body is generally a large upload. Do not impose the
  // small JSON request window on it even in browsers with no Blob constructor.
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return true
  return false
}

function inputRequest(input: RequestInfo | URL): Request | null {
  return typeof Request !== 'undefined' && input instanceof Request ? input : null
}

function usesUploadWindow(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (init?.body !== undefined && init.body !== null) return isBinaryRequestBody(init.body)

  const request = inputRequest(input)
  if (!request || request.method === 'GET' || request.method === 'HEAD') return false
  const contentType = (init?.headers ? new Headers(init.headers) : request.headers)
    .get('content-type')
    ?.toLowerCase() || ''
  return /^(?:multipart\/form-data|application\/octet-stream|image\/|video\/|audio\/)/.test(contentType)
}

function raceWithAbortAndDeadline<T>(
  operation: Promise<T>,
  controller: AbortController,
  callerSignal: AbortSignal | null | undefined,
  timeoutMs: number,
  timeoutCode: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let callerAbort: (() => void) | null = null

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try { controller.abort() } catch {}
      reject(transportAbortError(timeoutCode))
    }, timeoutMs)
  })

  const caller = new Promise<never>((_, reject) => {
    if (!callerSignal) return
    callerAbort = () => {
      try { controller.abort() } catch {}
      reject(transportAbortError('request_aborted'))
    }
    if (callerSignal.aborted) callerAbort()
    else callerSignal.addEventListener('abort', callerAbort, { once: true })
  })

  return Promise.race([operation, deadline, caller]).finally(() => {
    if (timer) clearTimeout(timer)
    if (callerAbort) callerSignal?.removeEventListener('abort', callerAbort)
  })
}

/**
 * Keep the request AbortController connected while a Response body is being
 * consumed. Native fetch resolves as soon as headers arrive, so a timeout
 * wrapped only around `fetch()` leaves `response.json()`/`.text()` able to
 * wait forever on a stalled peer.
 *
 * Structured API responses keep the ordinary short deadline. Blob and
 * ArrayBuffer reads receive a deliberately longer window so Supabase Storage
 * downloads are bounded without treating legitimate media as tiny JSON.
 */
function wrapResponseBodyDeadline(
  response: Response,
  controller: AbortController,
  callerSignal: AbortSignal | null | undefined,
  structuredTimeoutMs: number,
  binaryTimeoutMs: number,
): Response {
  // mpFetch has already buffered the full body before it resolves and exposes
  // `body: null`; its text/json methods are immediate Promise resolutions.
  // Native 204/HEAD responses also land here. Avoid requiring Proxy support in
  // older mini-program JavaScript engines when there is no live stream left to
  // stall.
  if (response.body === null) return response

  const bodyReaders = new Set<BodyReaderName>([
    'json',
    'text',
    'formData',
    'blob',
    'arrayBuffer',
  ])

  return new Proxy(response, {
    get(target, property) {
      if (property === TRANSPORT_ABORT_SYMBOL) {
        return () => {
          try { controller.abort() } catch {}
        }
      }
      if (property === TRANSPORT_CALLER_SIGNAL_SYMBOL) return callerSignal ?? null
      if (property === 'clone') {
        return () => wrapResponseBodyDeadline(
          target.clone(),
          controller,
          callerSignal,
          structuredTimeoutMs,
          binaryTimeoutMs,
        )
      }
      if (typeof property === 'string' && bodyReaders.has(property as BodyReaderName)) {
        const reader = Reflect.get(target, property, target)
        if (typeof reader !== 'function') return reader
        return (...args: unknown[]) => {
          const timeoutMs = property === 'blob' || property === 'arrayBuffer'
            ? binaryTimeoutMs
            : structuredTimeoutMs
          let operation: Promise<unknown>
          try {
            operation = Promise.resolve(reader.apply(target, args))
          } catch (error) {
            operation = Promise.reject(error)
          }
          return raceWithAbortAndDeadline(
            operation,
            controller,
            callerSignal,
            timeoutMs,
            'response_body_timeout',
          )
        }
      }

      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * Adapt a fetch implementation for H5, mini-program and Supabase global.fetch.
 * Both the header phase and every built-in body reader have deterministic
 * abort boundaries. The caller's AbortSignal remains authoritative during
 * body consumption as well as while waiting for headers.
 */
export function withTransportDeadlines(
  baseFetch: typeof fetch,
  options: TransportDeadlineOptions = {},
): typeof fetch {
  const headerTimeoutMs = options.headerTimeoutMs ?? DEFAULT_HEADER_TIMEOUT_MS
  const uploadHeaderTimeoutMs = options.uploadHeaderTimeoutMs ?? DEFAULT_UPLOAD_HEADER_TIMEOUT_MS
  const structuredBodyTimeoutMs = options.structuredBodyTimeoutMs ?? DEFAULT_STRUCTURED_BODY_TIMEOUT_MS
  const binaryBodyTimeoutMs = options.binaryBodyTimeoutMs ?? DEFAULT_BINARY_BODY_TIMEOUT_MS

  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController()
    // fetch(Request) inherits Request.signal unless init.signal overrides it.
    // Preserve that native contract so Supabase or callers using a Request
    // object can still cancel while headers or the body are in flight.
    const callerSignal = init?.signal ?? inputRequest(input)?.signal
    const headerWindow = usesUploadWindow(input, init)
      ? uploadHeaderTimeoutMs
      : headerTimeoutMs

    let response: Response
    try {
      response = await raceWithAbortAndDeadline(
        Promise.resolve(baseFetch(input, { ...init, signal: controller.signal })),
        controller,
        callerSignal,
        headerWindow,
        'response_headers_timeout',
      )
    } catch (error) {
      // Ensure implementations which only observe the signal (rather than the
      // race rejection) do not keep an upload/request alive in the background.
      try { controller.abort() } catch {}
      throw error
    }

    return wrapResponseBodyDeadline(
      response,
      controller,
      callerSignal,
      structuredBodyTimeoutMs,
      binaryBodyTimeoutMs,
    )
  }

  return wrapped as typeof fetch
}
