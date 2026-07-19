import { readBoundedJson } from './responseBody'

export type AccountDeletionResult = { status: 'completed' | 'pending' }

export class AccountDeletionRequestError extends Error {
  readonly outcome: 'rejected' | 'unknown'

  constructor(outcome: 'rejected' | 'unknown', message: string) {
    super(message)
    this.name = 'AccountDeletionRequestError'
    this.outcome = outcome
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

const EXPLICIT_REJECTIONS = new Set([
  'not_configured',
  'unauthorized',
  'invalid_request',
  'forbidden',
  'delete_unavailable',
  'admin_recovery_transfer_required',
])

const MAX_DELETE_RESPONSE_BYTES = 64 * 1024
const DELETE_RESPONSE_TIMEOUT_MS = 10_000

/**
 * Start/resume the idempotent account-deletion saga and classify the commit
 * outcome. A missing response or an unrecognised response is never treated as
 * a definite rejection: the durable job may already have been committed at
 * the edge even though its acknowledgement did not reach this device.
 */
export async function requestAccountDeletion(
  endpoint: string,
  accessToken: string,
  fetcher: FetchLike,
  responseTimeoutMs = DELETE_RESPONSE_TIMEOUT_MS,
): Promise<AccountDeletionResult> {
  let response: Response
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
  } catch {
    throw new AccountDeletionRequestError('unknown', 'delete_transport_unknown')
  }

  let payload: any
  try {
    payload = await readBoundedJson<any>(response, {
      maxBytes: MAX_DELETE_RESPONSE_BYTES,
      timeoutMs: responseTimeoutMs,
    })
  } catch {
    throw new AccountDeletionRequestError('unknown', 'delete_response_unknown')
  }

  if (response.status === 200 && payload?.status === 'completed') {
    return { status: 'completed' }
  }
  if (response.status === 202 && payload?.status === 'pending') {
    return { status: 'pending' }
  }

  if (!response.ok && EXPLICIT_REJECTIONS.has(String(payload?.error || ''))) {
    throw new AccountDeletionRequestError('rejected', String(payload.error))
  }

  throw new AccountDeletionRequestError('unknown', 'delete_response_unknown')
}

export function accountDeletionOutcomeUnknown(error: unknown): boolean {
  return error instanceof AccountDeletionRequestError && error.outcome === 'unknown'
}
