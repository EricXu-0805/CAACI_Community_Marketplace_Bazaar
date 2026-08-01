import type { HostedRealtimeAccount, HostedRealtimeContract } from './realtime-contract'
import {
  decodeHostedPhoenixBroadcastPush,
  decodeHostedPhoenixFrame,
  hostedHttpRequestAllowed,
  hostedRealtimeBroadcastPushAllowed,
  hostedRealtimeJoinAllowed,
  hostedRealtimeOutboundTextFrameAllowed,
  hostedRealtimeSocketAllowed,
} from './network-boundary'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_RESPONSE_BYTES = 128 * 1024
const ALLOWED_HEADER_NAMES = new Set([
  'accept',
  'accept-profile',
  'apikey',
  'authorization',
  'content-profile',
  'content-type',
  'prefer',
  'x-client-info',
  'x-supabase-api-version',
])

interface RegisteredWrite {
  readonly actorId: string
  readonly conversationId: string
}

export class HostedCanaryWriteRegistry {
  private readonly attempts = new Map<string, RegisteredWrite>()

  registerAttempt(
    actor: HostedRealtimeAccount,
    conversationId: string,
    messageId: string,
    contract: HostedRealtimeContract,
  ): void {
    const actorMayWrite = (
      actor.role === 'member-a'
      || (
        actor.role === 'member-c'
        && conversationId === contract.conversations.ac
      )
    )
    if (
      !UUID_RE.test(messageId)
      || !actorMayWrite
      || (
        conversationId !== contract.conversations.ab
        && conversationId !== contract.conversations.ac
      )
      || this.attempts.has(messageId)
    ) throw new Error('hosted_realtime_write_registry_failed')
    this.attempts.set(messageId, {
      actorId: actor.expectedUserId,
      conversationId,
    })
  }

  matches(
    actor: HostedRealtimeAccount,
    conversationId: string,
    messageId: string,
  ): boolean {
    const entry = this.attempts.get(messageId)
    return (
      entry?.actorId === actor.expectedUserId
      && entry.conversationId === conversationId
    )
  }

  idsFor(actor: HostedRealtimeAccount): readonly string[] {
    return [...this.attempts]
      .filter(([, entry]) => entry.actorId === actor.expectedUserId)
      .map(([id]) => id)
      .sort()
  }

  allIds(): readonly string[] {
    return [...this.attempts.keys()].sort()
  }

  completedRunShapeMatches(contract: HostedRealtimeContract): boolean {
    const counts = {
      aAb: 0,
      aAc: 0,
      cAc: 0,
      other: 0,
    }
    for (const entry of this.attempts.values()) {
      if (
        entry.actorId === contract.accounts[0].expectedUserId
        && entry.conversationId === contract.conversations.ab
      ) {
        counts.aAb += 1
      } else if (
        entry.actorId === contract.accounts[0].expectedUserId
        && entry.conversationId === contract.conversations.ac
      ) {
        counts.aAc += 1
      } else if (
        entry.actorId === contract.accounts[2].expectedUserId
        && entry.conversationId === contract.conversations.ac
      ) {
        counts.cAc += 1
      } else {
        counts.other += 1
      }
    }
    return (
      this.attempts.size === 8
      && counts.aAb === 5
      && counts.aAc === 2
      && counts.cAc === 1
      && counts.other === 0
    )
  }

  clearAll(ids: readonly string[]): void {
    const expected = this.allIds()
    if (
      ids.length !== expected.length
      || ids.some((id, index) => id !== expected[index])
    ) throw new Error('hosted_realtime_write_registry_failed')
    this.attempts.clear()
  }

  clearFor(actor: HostedRealtimeAccount, ids: readonly string[]): void {
    for (const id of ids) {
      const entry = this.attempts.get(id)
      if (entry?.actorId !== actor.expectedUserId) {
        throw new Error('hosted_realtime_write_registry_failed')
      }
    }
    for (const id of ids) this.attempts.delete(id)
  }

  get size(): number {
    return this.attempts.size
  }
}

function exactJsonObject(body: string): Record<string, unknown> | null {
  if (Buffer.byteLength(body, 'utf8') > 4096) return null
  try {
    const parsed = JSON.parse(body)
    return (
      parsed
      && typeof parsed === 'object'
      && !Array.isArray(parsed)
    ) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return (
    Object.keys(value).sort().join('\0')
    === [...expected].sort().join('\0')
  )
}

function tokenSubjectMatches(
  value: string,
  actor: HostedRealtimeAccount,
): boolean {
  if (value.startsWith('Bearer ')) {
    const token = value.slice(7)
    try {
      const parts = token.split('.')
      if (parts.length !== 3) return false
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8'),
      )
      return String(payload?.sub || '').toLowerCase() === actor.expectedUserId
    } catch {
      return false
    }
  }
  return false
}

function baseRequestHeadersAllowed(
  headers: Headers,
  contract: HostedRealtimeContract,
): boolean {
  let invalidHeader = false
  headers.forEach((_value, name) => {
    if (!ALLOWED_HEADER_NAMES.has(name.toLowerCase())) invalidHeader = true
  })
  if (invalidHeader) return false
  return headers.get('apikey') === contract.publishableKey
}

function publishableAuthorizationMatches(
  headers: Headers,
  contract: HostedRealtimeContract,
): boolean {
  return (
    headers.get('authorization')
    === `Bearer ${contract.publishableKey}`
  )
}

function actorAuthorizationMatches(
  headers: Headers,
  actor: HostedRealtimeAccount,
): boolean {
  return tokenSubjectMatches(headers.get('authorization') || '', actor)
}

function rpcRequestAllowed(
  url: URL,
  actor: HostedRealtimeAccount,
  contract: HostedRealtimeContract,
  registry: HostedCanaryWriteRegistry,
  body: string,
): boolean {
  if (url.search) return false
  const rpc = /^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/.exec(url.pathname)?.[1]
  const payload = exactJsonObject(body)
  if (!rpc || !payload) return false

  if (rpc === 'hosted_realtime_canary_begin_run') {
    return (
      actor.role === 'member-a'
      && exactKeys(payload, ['p_run_id'])
      && payload.p_run_id === contract.runId
    )
  }
  if (rpc === 'hosted_realtime_canary_insert_message') {
    if (!exactKeys(
      payload,
      ['p_content', 'p_conversation_id', 'p_id', 'p_run_id'],
    )) {
      return false
    }
    const id = String(payload.p_id || '').toLowerCase()
    const conversationId = String(payload.p_conversation_id || '').toLowerCase()
    return (
      payload.p_run_id === contract.runId
      &&
      payload.p_content === `caaci-hosted-canary-${id}`
      && registry.matches(actor, conversationId, id)
    )
  }
  if (rpc === 'hosted_realtime_canary_cleanup') {
    if (
      actor.role !== 'member-a'
      || !exactKeys(payload, ['p_message_ids', 'p_run_id'])
      || payload.p_run_id !== contract.runId
    ) return false
    const ids = payload.p_message_ids
    const expected = registry.allIds()
    return (
      Array.isArray(ids)
      && ids.length === expected.length
      && ids.every((id, index) => id === expected[index])
    )
  }
  return false
}

export function hostedSdkRequestAllowed(
  contract: HostedRealtimeContract,
  actor: HostedRealtimeAccount,
  registry: HostedCanaryWriteRegistry,
  rawUrl: string,
  method: string,
  headers: Headers,
  body: string,
): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (
    url.origin !== contract.supabaseOrigin
    || url.username
    || url.password
    || /%(?:2f|5c)/i.test(url.pathname)
    || (
      method.toUpperCase() !== 'POST'
      && method.toUpperCase() !== 'GET'
    )
    || !baseRequestHeadersAllowed(headers, contract)
  ) return false

  if (url.pathname.startsWith('/auth/v1/')) {
    const allowedAuthorization = url.pathname === '/auth/v1/token'
      ? publishableAuthorizationMatches(headers, contract)
      : actorAuthorizationMatches(headers, actor)
    return (
      allowedAuthorization
      && hostedHttpRequestAllowed(contract, actor, rawUrl, method, body)
    )
  }
  return (
    method.toUpperCase() === 'POST'
    && actorAuthorizationMatches(headers, actor)
    && rpcRequestAllowed(url, actor, contract, registry, body)
  )
}

export function hostedEnvironmentPreflightRequestAllowed(
  contract: HostedRealtimeContract,
  rawUrl: string,
  method: string,
  headers: Headers,
  body: string,
): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  const payload = exactJsonObject(body)
  return (
    url.origin === contract.supabaseOrigin
    && !url.username
    && !url.password
    && url.pathname
      === '/rest/v1/rpc/hosted_realtime_canary_environment'
    && !url.search
    && method.toUpperCase() === 'POST'
    && baseRequestHeadersAllowed(headers, contract)
    && publishableAuthorizationMatches(headers, contract)
    && !!payload
    && exactKeys(payload, [])
  )
}

export async function fetchHostedEnvironmentSentinel(
  contract: HostedRealtimeContract,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<unknown> {
  const endpoint =
    `${contract.supabaseOrigin}/rest/v1/rpc/hosted_realtime_canary_environment`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)
  try {
    const request = new Request(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        apikey: contract.publishableKey,
        authorization: `Bearer ${contract.publishableKey}`,
        'content-profile': 'public',
        'content-type': 'application/json',
      },
      body: '{}',
      signal: controller.signal,
    })
    if (!hostedEnvironmentPreflightRequestAllowed(
      contract,
      request.url,
      request.method,
      request.headers,
      await request.clone().text(),
    )) throw new Error('hosted_realtime_environment_preflight_failed')

    const response = await fetchImpl(request, {
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    const contentType = response.headers.get('content-type') || ''
    const contentLength = Number(response.headers.get('content-length') || '0')
    if (
      !response.ok
      || response.url !== endpoint
      || !/^application\/json(?:;|$)/i.test(contentType)
      || !Number.isFinite(contentLength)
      || contentLength < 0
      || contentLength > MAX_RESPONSE_BYTES
    ) throw new Error('hosted_realtime_environment_preflight_failed')
    const body = await response.arrayBuffer()
    if (body.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error('hosted_realtime_environment_preflight_failed')
    }
    return JSON.parse(Buffer.from(body).toString('utf8'))
  } catch {
    throw new Error('hosted_realtime_environment_preflight_failed')
  } finally {
    clearTimeout(timeout)
  }
}

function hostedAccessTokenShapeAllowed(accessToken: string): boolean {
  if (
    accessToken.length < 64
    || accessToken.length > 8_192
    || /[\u0000-\u0020\u007f]/.test(accessToken)
  ) return false
  const parts = accessToken.split('.')
  return (
    parts.length === 3
    && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))
  )
}

/**
 * One-shot escape hatch used only to revoke a token just observed from the
 * exact password-login endpoint. It deliberately does not trust the token
 * subject, because subject/metadata mismatch is the failure being cleaned up.
 */
export async function revokeExactHostedSession(
  contract: HostedRealtimeContract,
  accessToken: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  if (!hostedAccessTokenShapeAllowed(accessToken)) {
    throw new Error('hosted_realtime_exact_session_revoke_failed')
  }
  const endpoint =
    `${contract.supabaseOrigin}/auth/v1/logout?scope=local`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)
  try {
    const request = new Request(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        apikey: contract.publishableKey,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: '{}',
      signal: controller.signal,
    })
    const response = await fetchImpl(request, {
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    })
    const length = Number(response.headers.get('content-length') || '0')
    if (
      response.url !== endpoint
      || ![200, 204].includes(response.status)
      || !Number.isFinite(length)
      || length < 0
      || length > MAX_RESPONSE_BYTES
    ) throw new Error('hosted_realtime_exact_session_revoke_failed')
    const body = await response.arrayBuffer()
    if (body.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error('hosted_realtime_exact_session_revoke_failed')
    }
  } catch {
    throw new Error('hosted_realtime_exact_session_revoke_failed')
  } finally {
    clearTimeout(timeout)
  }
}

export function createHostedGuardedFetch(
  contract: HostedRealtimeContract,
  actor: HostedRealtimeAccount,
  registry: HostedCanaryWriteRegistry,
  fetchImpl: typeof fetch = globalThis.fetch,
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init)
    const body = await request.clone().text()
    if (!hostedSdkRequestAllowed(
      contract,
      actor,
      registry,
      request.url,
      request.method,
      request.headers,
      body,
    )) throw new Error('hosted_realtime_sdk_network_boundary_failed')

    const response = await fetchImpl(request, {
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    const length = Number(response.headers.get('content-length') || '0')
    const contentType = response.headers.get('content-type') || ''
    const isLocalLogout = (
      new URL(request.url).pathname === '/auth/v1/logout'
      && new URL(request.url).searchParams.get('scope') === 'local'
      && [200, 204].includes(response.status)
    )
    if (
      response.url !== request.url
      || (
        !isLocalLogout
        && !/^application\/json(?:;|$)/i.test(contentType)
      )
      || !Number.isFinite(length)
      || length < 0
      || length > MAX_RESPONSE_BYTES
    ) throw new Error('hosted_realtime_sdk_response_boundary_failed')
    const actual = await response.clone().arrayBuffer()
    if (actual.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error('hosted_realtime_sdk_response_boundary_failed')
    }
    return response
  }
}

export function createHostedGuardedWebSocketTransport(
  contract: HostedRealtimeContract,
  actor: HostedRealtimeAccount,
  options: { anonymous?: boolean } = {},
): typeof WebSocket {
  return class HostedGuardedWebSocket extends WebSocket {
    private readonly allowedTopics = new Set<string>()
    private readonly allowedAccessTokens = new Set<string>()

    constructor(address: string | URL, protocols?: string | string[]) {
      const rawUrl = String(address)
      if (
        protocols !== undefined
        || !hostedRealtimeSocketAllowed(contract, rawUrl)
      ) {
        throw new Error('hosted_realtime_sdk_socket_boundary_failed')
      }
      super(address)
    }

    override send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      if (typeof data === 'string') {
        const frame = decodeHostedPhoenixFrame(data)
        if (frame?.event === 'phx_join') {
          if (!hostedRealtimeJoinAllowed(contract, actor, frame, options)) {
            throw new Error('hosted_realtime_sdk_socket_boundary_failed')
          }
          const accessToken = frame.payload.access_token
          if (typeof accessToken === 'string' && !options.anonymous) {
            this.allowedAccessTokens.add(accessToken)
          }
          if (!hostedRealtimeOutboundTextFrameAllowed(
            contract,
            actor,
            frame,
            this.allowedAccessTokens,
            {
              ...options,
              allowScenarioMarkers: true,
            },
          )) {
            throw new Error('hosted_realtime_sdk_socket_boundary_failed')
          }
          this.allowedTopics.add(frame.topic)
        } else if (frame) {
          if (!hostedRealtimeOutboundTextFrameAllowed(
            contract,
            actor,
            frame,
            this.allowedAccessTokens,
            {
              ...options,
              allowScenarioMarkers: true,
            },
          )) {
            throw new Error('hosted_realtime_sdk_socket_boundary_failed')
          }
          const control = frame.topic === 'phoenix' && frame.event === 'heartbeat'
          if (!control && !this.allowedTopics.has(frame.topic)) {
            throw new Error('hosted_realtime_sdk_socket_boundary_failed')
          }
          if (frame.event === 'phx_leave') this.allowedTopics.delete(frame.topic)
        } else {
          throw new Error('hosted_realtime_sdk_socket_boundary_failed')
        }
      } else {
        if (
          data instanceof Blob
          || (
            !(data instanceof ArrayBuffer)
            && !ArrayBuffer.isView(data)
          )
        ) {
          throw new Error('hosted_realtime_sdk_socket_boundary_failed')
        }
        const broadcast = decodeHostedPhoenixBroadcastPush(
          ArrayBuffer.isView(data) ? data : data as ArrayBuffer,
        )
        if (
          !broadcast
          || !this.allowedTopics.has(broadcast.topic)
          || !hostedRealtimeBroadcastPushAllowed(
            contract,
            actor,
            broadcast,
            { allowScenarioMarkers: true },
          )
        ) throw new Error('hosted_realtime_sdk_socket_boundary_failed')
      }
      super.send(data)
    }

    override close(_code?: number, _reason?: string): void {
      super.close(1000, 'client-close')
    }
  }
}
