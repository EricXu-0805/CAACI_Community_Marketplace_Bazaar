import {
  readBoundedJson,
  ResponseBodyBoundaryError,
} from './responseBody'

/**
 * Backward-compatible error used by the WeChat auth boundary. New callers
 * should normally inspect ResponseBodyBoundaryError.code instead.
 */
export class ResponseBodyTooLargeError extends Error {
  readonly code = 'response_body_too_large'

  constructor(readonly maxBytes: number) {
    super('response_body_too_large')
    this.name = 'ResponseBodyTooLargeError'
  }
}

/**
 * Compatibility facade for the auth module. The canonical reader owns the
 * streaming byte cap, total body deadline, caller-signal propagation and
 * transport abort. Keeping one implementation prevents this path from
 * bypassing platformFetch by reading response.body directly.
 */
export async function readBoundedJsonResponse<T = unknown>(
  response: Response,
  maxBytes: number,
  timeoutMs = 25_000,
): Promise<T> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('invalid_response_body_limit')
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('invalid_response_body_timeout')
  }

  try {
    return await readBoundedJson<T>(response, { maxBytes, timeoutMs })
  } catch (error) {
    if (
      error instanceof ResponseBodyBoundaryError
      && error.code === 'response_body_too_large'
    ) {
      throw new ResponseBodyTooLargeError(maxBytes)
    }
    throw error
  }
}
