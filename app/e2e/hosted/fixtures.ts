import { createHash } from 'node:crypto'
import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
  type WebSocketRoute,
} from '@playwright/test'
import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from '@supabase/supabase-js'
import { APPROVED_HOSTED_REALTIME_TARGETS } from './approved-targets'
import {
  assertHostedDeploymentManifestProof,
  assertHostedEnvironmentSentinel,
  hostedActorMetadataMatches,
  loadHostedRealtimeContract,
  MAX_HOSTED_ASSET_BYTES,
  type HostedRealtimeAccount,
  type HostedRealtimeContract,
} from './realtime-contract'
import {
  decodeHostedPhoenixBroadcastPush,
  decodeHostedPhoenixFrame,
  hostedBrowserRequestHeadersAllowed,
  hostedFingerprintRequestMockable,
  hostedHttpRequestAllowed,
  hostedReadReceiptRequestMockable,
  hostedRealtimeBroadcastPushAllowed,
  hostedRealtimeOutboundTextFrameAllowed,
  hostedRealtimeSocketAllowed,
} from './network-boundary'
import {
  createHostedGuardedFetch,
  createHostedGuardedWebSocketTransport,
  fetchHostedEnvironmentSentinel,
  HostedCanaryWriteRegistry,
  revokeExactHostedSession,
} from './sdk-boundary'

export const hostedContract = loadHostedRealtimeContract(
  process.env,
  APPROVED_HOSTED_REALTIME_TARGETS,
)

export interface HostedTopicObservation {
  readonly joinAttempts: number
  readonly successfulJoins: number
  readonly active: boolean
  readonly activeSockets: number
}

export interface HostedConversationReadObservation {
  readonly snapshots: number
  readonly directSeeds: number
  readonly directIncrements: number
}

export interface HostedNetworkController {
  attachPage(page: Page): void
  assertBrowserRequestAllowed(request: Request): Promise<void>
  beginTeardown(): Promise<void>
  setActor(actor: HostedRealtimeAccount): Promise<void>
  topicObservation(topic: string): HostedTopicObservation
  conversationReadObservation(
    conversationId: string,
  ): HostedConversationReadObservation
  conversationIncrementMessageCount(
    conversationId: string,
    messageId: string,
  ): number
  conversationIncrementMessageMatches(
    conversationId: string,
    messageId: string,
    senderId: string,
    content: string,
  ): boolean
  conversationIncrementResponseTimes(
    conversationId: string,
  ): readonly number[]
  conversationDirectIncrementAttempts(conversationId: string): number
  waitForConversationReadsIdle(conversationId: string): Promise<void>
  topicMessageCount(topic: string, messageId: string): number
  actorActiveSocketCount(actor: HostedRealtimeAccount): number
  faultRealtimeTopic(topic: string): Promise<void>
  blockConversationReads(conversationId: string): () => void
  revokeIssuedSessions(expectedAccessToken?: string): Promise<void>
  assertNoViolation(): Promise<void>
}

interface MutableTopicObservation {
  joinAttempts: number
  successfulJoins: number
  activeSocketId: number | null
  messageCounts: Map<string, number>
}

interface MutableConversationReadObservation {
  snapshots: number
  directSeeds: number
  directIncrements: number
  directIncrementMessageCounts: Map<string, number>
  directIncrementMessages: Map<string, Readonly<{
    senderId: string
    content: string
    messageType: string
  }>>
  directIncrementResponseTimes: number[]
  directIncrementAttempts: number
  pendingRequests: number
}

interface RoutedSocket {
  readonly id: number
  readonly browser: WebSocketRoute
  readonly server: WebSocketRoute
  readonly joinedTopics: Set<string>
  readonly pendingJoinTopicByRef: Map<string, string>
  readonly actorId: string
  readonly closedPromise: Promise<void>
  readonly resolveClosed: () => void
  closing: boolean
  closed: boolean
  browserClosed: boolean
  serverClosed: boolean
}

const MESSAGE_FIELDS =
  'id,conversation_id,sender_id,content,message_type,is_read,created_at'
const MESSAGE_SNAPSHOT_FIELDS =
  `${MESSAGE_FIELDS},sender:profiles(id,nickname,avatar_url)`
const HOSTED_DISABLED_REFRESH_TOKEN = 'caaci-hosted-refresh-disabled'

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

function hostedRefreshTokenShapeAllowed(refreshToken: string): boolean {
  return (
    refreshToken.length >= 16
    && refreshToken.length <= 8_192
    && !/[\u0000-\u0020\u007f]/.test(refreshToken)
  )
}

function classifyConversationMessageRead(
  contract: HostedRealtimeContract,
  rawUrl: string,
): {
  conversationId: string
  kind: 'snapshots' | 'directSeeds' | 'directIncrements'
} | null {
  try {
    const url = new URL(rawUrl)
    if (
      url.origin !== contract.supabaseOrigin
      || url.pathname !== '/rest/v1/messages'
    ) return null
    const filter = url.searchParams.get('conversation_id')
    const conversationId = filter?.startsWith('eq.') ? filter.slice(3) : ''
    if (
      conversationId !== contract.conversations.ab
      && conversationId !== contract.conversations.ac
    ) return null
    const select = url.searchParams.get('select')
    const order = url.searchParams.get('order')
    const limit = url.searchParams.get('limit')
    if (
      select === MESSAGE_SNAPSHOT_FIELDS
      && order === 'created_at.desc'
      && limit === '200'
    ) return { conversationId, kind: 'snapshots' }
    if (
      select === 'id,created_at'
      && order === 'created_at.desc,id.desc'
      && limit === '1'
    ) return { conversationId, kind: 'directSeeds' }
    if (
      select === MESSAGE_FIELDS
      && order === 'created_at.asc,id.asc'
      && limit === '50'
      && (
        url.searchParams.has('or')
        || url.searchParams.has('created_at')
      )
    ) return { conversationId, kind: 'directIncrements' }
  } catch {
  }
  return null
}

function isExactPasswordTokenRequest(
  contract: HostedRealtimeContract,
  request: Request,
): boolean {
  try {
    const url = new URL(request.url())
    return (
      request.method() === 'POST'
      && url.origin === contract.supabaseOrigin
      && url.pathname === '/auth/v1/token'
      && url.searchParams.size === 1
      && url.searchParams.get('grant_type') === 'password'
    )
  } catch {
    return false
  }
}

async function installNetworkBoundary(
  context: BrowserContext,
  contract: HostedRealtimeContract,
  initialActor: HostedRealtimeAccount,
): Promise<HostedNetworkController> {
  let actor = initialActor
  let actorSwitching = false
  let browserAuthClosed = false
  let networkViolations = 0
  let nextSocketId = 0
  let verifiedEntryDocument: Buffer | null = null
  const verifiedAssets = new Map<
    string,
    Readonly<{ body: Buffer; contentType: string }>
  >()
  const blockedConversationReads = new Set<string>()
  const realtimeSockets = new Set<RoutedSocket>()
  const pendingResponseAudits = new Set<Promise<void>>()
  const pendingTokenRequests = new Set<Request>()
  const activePasswordTokenRoutes = new Set<Request>()
  const attachedPages = new WeakSet<Page>()
  const issuedAccessTokens = new Set<string>()
  const issuedRefreshTokenByAccessToken = new Map<string, string>()
  const pendingReadRequests = new WeakMap<
    Request,
    { conversationId: string }
  >()
  const topicObservations = new Map<string, MutableTopicObservation>()
  const conversationReads =
    new Map<string, MutableConversationReadObservation>()

  const topicState = (topic: string): MutableTopicObservation => {
    let state = topicObservations.get(topic)
    if (!state) {
      state = {
        joinAttempts: 0,
        successfulJoins: 0,
        activeSocketId: null,
        messageCounts: new Map(),
      }
      topicObservations.set(topic, state)
    }
    return state
  }

  const conversationState = (
    conversationId: string,
  ): MutableConversationReadObservation => {
    let state = conversationReads.get(conversationId)
    if (!state) {
      state = {
        snapshots: 0,
        directSeeds: 0,
        directIncrements: 0,
        directIncrementMessageCounts: new Map(),
        directIncrementMessages: new Map(),
        directIncrementResponseTimes: [],
        directIncrementAttempts: 0,
        pendingRequests: 0,
      }
      conversationReads.set(conversationId, state)
    }
    return state
  }

  const beginSocketClose = (record: RoutedSocket): void => {
    if (record.closing || record.closed) return
    record.closing = true
    for (const topic of record.joinedTopics) {
      const state = topicState(topic)
      if (state.activeSocketId === record.id) state.activeSocketId = null
    }
    record.pendingJoinTopicByRef.clear()
  }

  const finishSocketClose = (record: RoutedSocket): void => {
    if (
      record.closed
      || !record.browserClosed
      || !record.serverClosed
    ) return
    record.closed = true
    realtimeSockets.delete(record)
    record.resolveClosed()
  }

  const waitForSocketClose = async (
    record: RoutedSocket,
    timeoutMs = 5_000,
  ): Promise<boolean> => {
    if (record.closed) return true
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<false>(resolve => {
      timer = setTimeout(() => resolve(false), timeoutMs)
    })
    const closed = record.closedPromise.then(() => true as const)
    const result = await Promise.race([closed, timedOut])
    if (timer) clearTimeout(timer)
    return result
  }

  const closeSocket = async (
    record: RoutedSocket,
    code: number,
    reason: string,
  ): Promise<void> => {
    beginSocketClose(record)
    await Promise.allSettled([
      record.browser.close({ code, reason }),
      record.server.close({ code, reason }),
    ])
    if (!await waitForSocketClose(record)) {
      networkViolations += 1
      throw new Error('hosted_realtime_socket_close_timeout')
    }
  }

  const conversationReadIsBlocked = (
    rawUrl: string,
    method: string,
  ): boolean => {
    if (method.toUpperCase() !== 'GET') return false
    try {
      const url = new URL(rawUrl)
      const filter = url.searchParams.get('conversation_id')
      return (
        url.origin === contract.supabaseOrigin
        && url.pathname === '/rest/v1/messages'
        && !!filter
        && filter.startsWith('eq.')
        && blockedConversationReads.has(filter.slice(3))
      )
    } catch {
      return false
    }
  }

  const browserRequestAllowed = async (request: Request): Promise<boolean> => {
    await Promise.allSettled([...pendingResponseAudits])
    let requestHeaders: Headers
    try {
      requestHeaders = new Headers(await request.allHeaders())
    } catch {
      return false
    }
    return hostedBrowserRequestHeadersAllowed(
      contract,
      actor,
      request.url(),
      request.method(),
      requestHeaders,
      [...issuedAccessTokens],
      [
        ...issuedAccessTokens,
        ...issuedRefreshTokenByAccessToken.values(),
      ],
    )
  }

  await context.route('**/*', async route => {
    const request = route.request()
    const body = request.postData()
    if (!await browserRequestAllowed(request)) {
      networkViolations += 1
      await route.abort('blockedbyclient')
      return
    }
    let requestUrl: URL | null = null
    try {
      requestUrl = new URL(request.url())
    } catch {
    }
    const exactEntryRequest = (
      requestUrl?.origin === contract.appOrigin
      && requestUrl.pathname === '/'
      && !requestUrl.search
      && request.method() === 'GET'
    )
    const versionProbeRequest = (
      requestUrl?.origin === contract.appOrigin
      && requestUrl.pathname === '/'
      && requestUrl.searchParams.size === 1
      && /^\d{13}$/.test(requestUrl.searchParams.get('_v') || '')
      && request.method() === 'GET'
    )
    const approvedAsset = (
      requestUrl?.origin === contract.appOrigin
      && !requestUrl.search
      && request.method() === 'GET'
    ) ? contract.appAssets.find(asset => asset.path === requestUrl?.pathname) : null
    if (exactEntryRequest) {
      if (verifiedEntryDocument) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: verifiedEntryDocument,
        })
        return
      }
      try {
        const response = await route.fetch({
          headers: { accept: 'text/html' },
          maxRedirects: 0,
          timeout: 15_000,
        })
        const contentType = response.headers()['content-type'] || ''
        const entryBody = await response.body()
        const digest = createHash('sha256').update(entryBody).digest('hex')
        if (
          response.url() !== `${contract.appOrigin}/`
          || response.status() < 200
          || response.status() >= 300
          || !/^text\/html(?:;|$)/i.test(contentType)
          || entryBody.byteLength > 1024 * 1024
          || digest !== contract.entryDocumentSha256
        ) throw new Error('hosted_realtime_entry_boundary_failed')
        verifiedEntryDocument = entryBody
        await route.fulfill({ response, body: entryBody })
      } catch {
        networkViolations += 1
        await route.abort('blockedbyclient')
      }
      return
    }
    if (versionProbeRequest) {
      if (!verifiedEntryDocument) {
        networkViolations += 1
        await route.abort('blockedbyclient')
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: verifiedEntryDocument,
      })
      return
    }
    if (approvedAsset) {
      const cached = verifiedAssets.get(approvedAsset.path)
      if (cached) {
        await route.fulfill({
          status: 200,
          contentType: cached.contentType,
          body: cached.body,
        })
        return
      }
      try {
        const response = await route.fetch({
          headers: { accept: '*/*' },
          maxRedirects: 0,
          timeout: 15_000,
        })
        const contentType = response.headers()['content-type'] || ''
        const assetBody = await response.body()
        const digest = createHash('sha256').update(assetBody).digest('hex')
        if (
          response.url() !== `${contract.appOrigin}${approvedAsset.path}`
          || response.status() < 200
          || response.status() >= 300
          || /^text\/html(?:;|$)/i.test(contentType)
          || assetBody.byteLength > MAX_HOSTED_ASSET_BYTES
          || digest !== approvedAsset.sha256
        ) throw new Error('hosted_realtime_asset_boundary_failed')
        verifiedAssets.set(approvedAsset.path, Object.freeze({
          body: assetBody,
          contentType,
        }))
        await route.fulfill({ response, body: assetBody })
      } catch {
        networkViolations += 1
        await route.abort('blockedbyclient')
      }
      return
    }
    if (isExactPasswordTokenRequest(contract, request)) {
      if (
        browserAuthClosed
        || !hostedHttpRequestAllowed(
          contract,
          actor,
          request.url(),
          request.method(),
          body,
        )
      ) {
        networkViolations += 1
        await route.abort('blockedbyclient')
        return
      }
      activePasswordTokenRoutes.add(request)
      try {
        const response = await route.fetch({
          maxRedirects: 0,
          timeout: 15_000,
        })
        const contentType = response.headers()['content-type'] || ''
        const contentLength =
          Number(response.headers()['content-length'] || '0')
        if (
          response.url() !== request.url()
          || response.status() < 200
          || response.status() >= 300
          || !/^application\/json(?:;|$)/i.test(contentType)
          || !Number.isFinite(contentLength)
          || contentLength < 0
          || contentLength > 128 * 1024
        ) throw new Error('hosted_realtime_token_response_failed')
        const responseBody = await response.body()
        if (responseBody.byteLength > 128 * 1024) {
          throw new Error('hosted_realtime_token_response_failed')
        }
        const payload = JSON.parse(responseBody.toString('utf8'))
        const accessToken = String(payload?.access_token || '')
        const refreshToken = String(payload?.refresh_token || '')
        if (hostedAccessTokenShapeAllowed(accessToken)) {
          issuedAccessTokens.add(accessToken)
        }
        if (
          !hostedAccessTokenShapeAllowed(accessToken)
          || !hostedRefreshTokenShapeAllowed(refreshToken)
          || !hostedActorMetadataMatches(payload?.user, actor, contract)
        ) throw new Error('hosted_realtime_token_response_failed')
        issuedRefreshTokenByAccessToken.set(accessToken, refreshToken)
        const sanitizedPayload = {
          ...payload,
          refresh_token: HOSTED_DISABLED_REFRESH_TOKEN,
        }
        delete sanitizedPayload.provider_token
        delete sanitizedPayload.provider_refresh_token
        await route.fulfill({
          response,
          body: JSON.stringify(sanitizedPayload),
        })
      } catch {
        networkViolations += 1
        await route.abort('blockedbyclient').catch(() => {})
      } finally {
        activePasswordTokenRoutes.delete(request)
      }
      return
    }
    if (conversationReadIsBlocked(request.url(), request.method())) {
      await route.abort('connectionrefused')
      return
    }
    if (hostedFingerprintRequestMockable(
      contract,
      request.url(),
      request.method(),
      body,
    )) {
      await route.fulfill({
        status: request.method() === 'OPTIONS' ? 204 : 200,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': contract.appOrigin,
          'access-control-allow-headers':
            'apikey,authorization,content-type,x-client-info,x-supabase-api-version',
          'access-control-allow-methods': 'POST,OPTIONS',
        },
        body: request.method() === 'OPTIONS' ? '' : 'null',
      })
      return
    }
    if (hostedReadReceiptRequestMockable(
      contract,
      actor,
      request.url(),
      request.method(),
      body,
    )) {
      await route.fulfill({
        status: request.method() === 'OPTIONS' ? 204 : 200,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': contract.appOrigin,
          'access-control-allow-headers':
            'apikey,authorization,content-type,prefer,x-client-info,x-supabase-api-version',
          'access-control-allow-methods': 'PATCH,OPTIONS',
          'content-profile': 'public',
        },
        body: request.method() === 'OPTIONS' ? '' : '[]',
      })
      return
    }
    if (hostedHttpRequestAllowed(
      contract,
      actor,
      request.url(),
      request.method(),
      body,
    )) {
      await route.continue()
      return
    }
    networkViolations += 1
    await route.abort('blockedbyclient')
  })

  await context.routeWebSocket(/.*/, websocketRoute => {
    if (
      actorSwitching
      || !hostedRealtimeSocketAllowed(contract, websocketRoute.url())
      || websocketRoute.protocols().length !== 0
    ) {
      networkViolations += 1
      void websocketRoute.close({ code: 1008, reason: 'blocked' })
      return
    }
    const serverRoute = websocketRoute.connectToServer()
    let resolveClosed: () => void = () => {}
    const closedPromise = new Promise<void>(resolve => {
      resolveClosed = resolve
    })
    const record: RoutedSocket = {
      id: ++nextSocketId,
      browser: websocketRoute,
      server: serverRoute,
      joinedTopics: new Set(),
      pendingJoinTopicByRef: new Map(),
      actorId: actor.expectedUserId,
      closedPromise,
      resolveClosed,
      closing: false,
      closed: false,
      browserClosed: false,
      serverClosed: false,
    }
    realtimeSockets.add(record)

    websocketRoute.onMessage(message => {
      if (record.closing || record.closed) return
      if (typeof message === 'string') {
        const frame = decodeHostedPhoenixFrame(message)
        if (
          !frame
          || !hostedRealtimeOutboundTextFrameAllowed(
            contract,
            actor,
            frame,
            issuedAccessTokens,
          )
        ) {
          networkViolations += 1
          void closeSocket(record, 1008, 'blocked').catch(() => {})
          return
        }
        if (frame.event === 'phx_join') {
          topicState(frame.topic).joinAttempts += 1
          record.pendingJoinTopicByRef.set(frame.ref!, frame.topic)
        } else {
          const knownControl = (
            frame.topic === 'phoenix'
            && frame.event === 'heartbeat'
          )
          const knownJoinedTopic = record.joinedTopics.has(frame.topic)
          const pendingTopic = [...record.pendingJoinTopicByRef.values()]
            .includes(frame.topic)
          const pendingLeave = frame.event === 'phx_leave' && pendingTopic
          if (!knownControl && !knownJoinedTopic && !pendingLeave) {
            networkViolations += 1
            void closeSocket(record, 1008, 'blocked').catch(() => {})
            return
          }
          if (frame.event === 'phx_leave') {
            for (const [ref, topic] of record.pendingJoinTopicByRef) {
              if (topic === frame.topic) {
                record.pendingJoinTopicByRef.delete(ref)
              }
            }
            record.joinedTopics.delete(frame.topic)
            const state = topicState(frame.topic)
            if (state.activeSocketId === record.id) state.activeSocketId = null
          }
        }
      } else {
        const broadcast = decodeHostedPhoenixBroadcastPush(message)
        if (
          !broadcast
          || !record.joinedTopics.has(broadcast.topic)
          || !hostedRealtimeBroadcastPushAllowed(
            contract,
            actor,
            broadcast,
          )
        ) {
          networkViolations += 1
          void closeSocket(record, 1008, 'blocked').catch(() => {})
          return
        }
      }
      serverRoute.send(message)
    })

    serverRoute.onMessage(message => {
      if (record.closing || record.closed) return
      const frame = decodeHostedPhoenixFrame(message)
      if (frame?.event === 'phx_reply' && frame.ref) {
        const topic = record.pendingJoinTopicByRef.get(frame.ref)
        record.pendingJoinTopicByRef.delete(frame.ref)
        if (topic && frame.topic === topic && frame.payload.status === 'ok') {
          record.joinedTopics.add(topic)
          const state = topicState(topic)
          state.successfulJoins += 1
          state.activeSocketId = record.id
        }
      }
      if (frame?.event === 'postgres_changes') {
        const data = frame.payload.data
        const row = (
          data
          && typeof data === 'object'
          && !Array.isArray(data)
        ) ? (data as Record<string, unknown>).record : null
        const messageId = (
          row
          && typeof row === 'object'
          && !Array.isArray(row)
        ) ? String((row as Record<string, unknown>).id || '') : ''
        if (messageId) {
          const state = topicState(frame.topic)
          state.messageCounts.set(
            messageId,
            (state.messageCounts.get(messageId) || 0) + 1,
          )
        }
      }
      websocketRoute.send(message)
    })

    websocketRoute.onClose(() => {
      if (record.browserClosed) return
      record.browserClosed = true
      beginSocketClose(record)
      finishSocketClose(record)
      void serverRoute.close({ code: 1000, reason: 'client-close' })
    })
    serverRoute.onClose((code, reason) => {
      if (record.serverClosed) return
      record.serverClosed = true
      beginSocketClose(record)
      finishSocketClose(record)
      void websocketRoute.close({ code, reason })
    })
  })

  return {
    async assertBrowserRequestAllowed(request) {
      if (!await browserRequestAllowed(request)) {
        networkViolations += 1
        throw new Error('hosted_realtime_browser_request_boundary_failed')
      }
    },
    attachPage(page: Page) {
      if (attachedPages.has(page)) return
      attachedPages.add(page)
      const settleRequest = (request: Request) => {
        pendingTokenRequests.delete(request)
        const pending = pendingReadRequests.get(request)
        if (!pending) return
        pendingReadRequests.delete(request)
        const state = conversationState(pending.conversationId)
        state.pendingRequests = Math.max(0, state.pendingRequests - 1)
      }
      page.on('request', request => {
        if (isExactPasswordTokenRequest(contract, request)) {
          pendingTokenRequests.add(request)
        }
        const classified = classifyConversationMessageRead(
          contract,
          request.url(),
        )
        if (!classified || request.method() !== 'GET') return
        if (classified.kind === 'directIncrements') {
          conversationState(
            classified.conversationId,
          ).directIncrementAttempts += 1
        }
        pendingReadRequests.set(request, {
          conversationId: classified.conversationId,
        })
        conversationState(classified.conversationId).pendingRequests += 1
      })
      page.on('requestfinished', settleRequest)
      page.on('requestfailed', settleRequest)
      page.on('response', response => {
        const audit = (async () => {
          try {
            const request = response.request()
            let responseUrl: URL | null = null
            try {
              responseUrl = new URL(response.url())
            } catch {
            }
            const exactTokenResponse = (
              request.method() === 'POST'
              && responseUrl?.origin === contract.supabaseOrigin
              && responseUrl.pathname === '/auth/v1/token'
              && responseUrl.searchParams.size === 1
              && responseUrl.searchParams.get('grant_type') === 'password'
            )
            if (exactTokenResponse) {
              const contentType = response.headers()['content-type'] || ''
              const contentLength =
                Number(response.headers()['content-length'] || '0')
              if (
                response.status() < 200
                || response.status() >= 300
                || !/^application\/json(?:;|$)/i.test(contentType)
                || !Number.isFinite(contentLength)
                || contentLength < 0
                || contentLength > 128 * 1024
              ) {
                networkViolations += 1
                return
              }
              const body = await response.body()
              if (body.byteLength > 128 * 1024) {
                networkViolations += 1
                return
              }
              const payload = JSON.parse(body.toString('utf8'))
              const accessToken = String(payload?.access_token || '')
              if (!hostedAccessTokenShapeAllowed(accessToken)) {
                networkViolations += 1
                return
              }
              issuedAccessTokens.add(accessToken)
              return
            }
            const exactLocalLogoutResponse = (
              request.method() === 'POST'
              && responseUrl?.origin === contract.supabaseOrigin
              && responseUrl.pathname === '/auth/v1/logout'
              && responseUrl.searchParams.size === 1
              && responseUrl.searchParams.get('scope') === 'local'
            )
            if (exactLocalLogoutResponse) {
              if (![200, 204].includes(response.status())) {
                networkViolations += 1
                return
              }
              const headers = await request.allHeaders()
              const authorization = headers.authorization || ''
              if (authorization.startsWith('Bearer ')) {
                const accessToken = authorization.slice(7)
                issuedAccessTokens.delete(accessToken)
                issuedRefreshTokenByAccessToken.delete(accessToken)
              }
              return
            }
            if (
              request.method() !== 'GET'
              || response.status() < 200
              || response.status() >= 300
            ) return
            const classified = classifyConversationMessageRead(
              contract,
              response.url(),
            )
            if (!classified) return
            const state = conversationState(classified.conversationId)
            state[classified.kind] += 1
            if (classified.kind !== 'directIncrements') return
            state.directIncrementResponseTimes.push(Date.now())
            if (state.directIncrementResponseTimes.length > 64) {
              state.directIncrementResponseTimes.splice(
                0,
                state.directIncrementResponseTimes.length - 64,
              )
            }

            const contentType = response.headers()['content-type'] || ''
            const contentLength =
              Number(response.headers()['content-length'] || '0')
            if (
              !/^application\/json(?:;|$)/i.test(contentType)
              || !Number.isFinite(contentLength)
              || contentLength < 0
              || contentLength > 256 * 1024
            ) {
              networkViolations += 1
              return
            }
            const body = await response.body()
            if (body.byteLength > 256 * 1024) {
              networkViolations += 1
              return
            }
            const rows = JSON.parse(body.toString('utf8'))
            if (!Array.isArray(rows) || rows.length > 50) {
              networkViolations += 1
              return
            }
            for (const row of rows) {
              if (
                !row
                || typeof row !== 'object'
                || Array.isArray(row)
                || String(row.conversation_id || '').toLowerCase()
                  !== classified.conversationId
              ) continue
              const messageId = String(row.id || '').toLowerCase()
              if (!/^[0-9a-f-]{36}$/.test(messageId)) continue
              const senderId = String(row.sender_id || '').toLowerCase()
              const content = String(row.content || '')
              const messageType = String(row.message_type || '')
              state.directIncrementMessageCounts.set(
                messageId,
                (state.directIncrementMessageCounts.get(messageId) || 0) + 1,
              )
              state.directIncrementMessages.set(messageId, Object.freeze({
                senderId,
                content,
                messageType,
              }))
            }
          } catch {
            networkViolations += 1
          }
        })()
        pendingResponseAudits.add(audit)
        void audit.finally(() => pendingResponseAudits.delete(audit))
      })
    },
    async beginTeardown() {
      browserAuthClosed = true
      const deadline = Date.now() + 10_000
      while (
        activePasswordTokenRoutes.size !== 0
        && Date.now() < deadline
      ) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      if (activePasswordTokenRoutes.size !== 0) {
        throw new Error('hosted_realtime_browser_auth_not_quiescent')
      }
    },
    async setActor(nextActor) {
      const exactActor = contract.accounts.find(candidate => (
        candidate.expectedUserId === nextActor.expectedUserId
        && candidate.role === nextActor.role
      ))
      if (!exactActor) throw new Error('hosted_realtime_actor_switch_denied')
      actorSwitching = true
      try {
        const sockets = [...realtimeSockets]
        if (sockets.length !== 0) {
          await Promise.allSettled(
            sockets.map(socket => closeSocket(socket, 1000, 'actor-switch')),
          )
          throw new Error('hosted_realtime_actor_switch_residual_socket')
        }
        actor = exactActor
      } finally {
        actorSwitching = false
      }
    },
    topicObservation(topic) {
      const state = topicState(topic)
      const activeSockets = [...realtimeSockets].filter(socket => (
        socket.joinedTopics.has(topic)
        && !socket.closed
        && !socket.closing
      )).length
      return Object.freeze({
        joinAttempts: state.joinAttempts,
        successfulJoins: state.successfulJoins,
        active: activeSockets > 0,
        activeSockets,
      })
    },
    conversationReadObservation(conversationId) {
      const state = conversationState(conversationId)
      return Object.freeze({
        snapshots: state.snapshots,
        directSeeds: state.directSeeds,
        directIncrements: state.directIncrements,
      })
    },
    conversationIncrementMessageCount(conversationId, messageId) {
      return (
        conversationState(conversationId)
          .directIncrementMessageCounts.get(messageId) || 0
      )
    },
    conversationIncrementMessageMatches(
      conversationId,
      messageId,
      senderId,
      content,
    ) {
      const state = conversationState(conversationId)
      const message = state.directIncrementMessages.get(messageId)
      return (
        state.directIncrementMessageCounts.get(messageId) === 1
        && message?.senderId === senderId
        && message.content === content
        && message.messageType === 'text'
      )
    },
    conversationIncrementResponseTimes(conversationId) {
      return Object.freeze([
        ...conversationState(conversationId).directIncrementResponseTimes,
      ])
    },
    conversationDirectIncrementAttempts(conversationId) {
      return conversationState(conversationId).directIncrementAttempts
    },
    async waitForConversationReadsIdle(conversationId) {
      const state = conversationState(conversationId)
      const deadline = Date.now() + 10_000
      let stableSince = 0
      let previousCount = -1
      while (Date.now() < deadline) {
        await Promise.allSettled([...pendingResponseAudits])
        const responseCount =
          state.snapshots + state.directSeeds + state.directIncrements
        if (state.pendingRequests === 0 && responseCount === previousCount) {
          if (!stableSince) stableSince = Date.now()
          if (Date.now() - stableSince >= 1_000) return
        } else {
          stableSince = 0
          previousCount = responseCount
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error('hosted_realtime_conversation_reads_not_idle')
    },
    topicMessageCount(topic, messageId) {
      return topicState(topic).messageCounts.get(messageId) || 0
    },
    actorActiveSocketCount(targetActor) {
      return [...realtimeSockets].filter(socket => (
        socket.actorId === targetActor.expectedUserId
        && !socket.closed
        && !socket.closing
      )).length
    },
    async faultRealtimeTopic(topic) {
      const state = topicState(topic)
      const socket = [...realtimeSockets].find(candidate => (
        candidate.id === state.activeSocketId
        && candidate.joinedTopics.has(topic)
        && !candidate.closed
      ))
      if (!socket) throw new Error('hosted_realtime_active_topic_not_observed')
      await closeSocket(socket, 1011, 'canary-fault')
    },
    blockConversationReads(conversationId) {
      if (
        conversationId !== contract.conversations.ab
        && conversationId !== contract.conversations.ac
      ) throw new Error('hosted_realtime_read_fault_denied')
      blockedConversationReads.add(conversationId)
      return () => {
        blockedConversationReads.delete(conversationId)
      }
    },
    async revokeIssuedSessions(expectedAccessToken) {
      const deadline = Date.now() + 10_000
      while (
        (
          pendingTokenRequests.size !== 0
          || activePasswordTokenRoutes.size !== 0
        )
        && Date.now() < deadline
      ) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      const pendingRequestFailed = (
        pendingTokenRequests.size !== 0
        || activePasswordTokenRoutes.size !== 0
      )
      await Promise.allSettled([...pendingResponseAudits])
      const expectedTokenFailed = (
        expectedAccessToken
        && !issuedAccessTokens.has(expectedAccessToken)
      )
      let failed = false
      const revocationTargets = new Set(issuedAccessTokens)
      if (expectedAccessToken) revocationTargets.add(expectedAccessToken)
      for (const accessToken of revocationTargets) {
        try {
          await revokeExactHostedSession(contract, accessToken)
          issuedAccessTokens.delete(accessToken)
          issuedRefreshTokenByAccessToken.delete(accessToken)
        } catch {
          failed = true
        }
      }
      if (
        pendingRequestFailed
        || expectedTokenFailed
        || failed
        || issuedAccessTokens.size !== 0
        || issuedRefreshTokenByAccessToken.size !== 0
      ) {
        throw new Error('hosted_realtime_issued_session_revoke_failed')
      }
    },
    async assertNoViolation() {
      await Promise.allSettled([...pendingResponseAudits])
      const closeResults = await Promise.all(
        [...realtimeSockets].map(socket => waitForSocketClose(socket)),
      )
      if (closeResults.some(closed => !closed)) networkViolations += 1
      if (
        networkViolations !== 0
        || pendingTokenRequests.size !== 0
        || activePasswordTokenRoutes.size !== 0
        || issuedAccessTokens.size !== 0
        || issuedRefreshTokenByAccessToken.size !== 0
      ) {
        throw new Error('hosted_realtime_network_boundary_failed')
      }
    },
  }
}

function browserSessionMatches(
  page: Page,
  contract: HostedRealtimeContract,
  actor: HostedRealtimeAccount,
): Promise<boolean> {
  return page.evaluate(({ storageKey, expectedUserId, datasetLineage, role }) => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (!stored) return false
      const outer = JSON.parse(stored)
      const session = (
        outer
        && typeof outer === 'object'
        && outer.tag === 'caaci-auth-value-v2'
        && typeof outer.value === 'string'
      ) ? JSON.parse(outer.value) : outer
      const user = session?.user
        || session?.currentSession?.user
        || session?.session?.user
      return (
        String(user?.id || '').toLowerCase() === expectedUserId
        && user?.app_metadata?.caaci_hosted_canary === true
        && user?.app_metadata?.caaci_dataset_lineage === datasetLineage
        && user?.app_metadata?.caaci_canary_role === role
      )
    } catch {
      return false
    }
  }, {
    storageKey: `sb-${contract.projectRef}-auth-token`,
    expectedUserId: actor.expectedUserId,
    datasetLineage: contract.datasetLineage,
    role: actor.role,
  })
}

function browserAccessToken(
  page: Page,
  contract: HostedRealtimeContract,
): Promise<string | null> {
  return page.evaluate(storageKey => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (!stored) return null
      const outer = JSON.parse(stored)
      const session = (
        outer
        && typeof outer === 'object'
        && outer.tag === 'caaci-auth-value-v2'
        && typeof outer.value === 'string'
      ) ? JSON.parse(outer.value) : outer
      const token = session?.access_token
        || session?.currentSession?.access_token
        || session?.session?.access_token
      return typeof token === 'string' ? token : null
    } catch {
      return null
    }
  }, `sb-${contract.projectRef}-auth-token`)
}

function tokenSubjectMatches(
  accessToken: string,
  actor: HostedRealtimeAccount,
): boolean {
  try {
    const parts = accessToken.split('.')
    if (parts.length !== 3) return false
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    )
    return String(payload?.sub || '').toLowerCase() === actor.expectedUserId
  } catch {
    return false
  }
}

async function serverBrowserSessionMatches(
  accessToken: string,
  actor: HostedRealtimeAccount,
  contract: HostedRealtimeContract,
): Promise<boolean> {
  if (!tokenSubjectMatches(accessToken, actor)) return false
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)
  const endpoint = `${contract.supabaseOrigin}/auth/v1/user`
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        apikey: contract.publishableKey,
        authorization: `Bearer ${accessToken}`,
      },
      signal: controller.signal,
    })
    const length = Number(response.headers.get('content-length') || '0')
    const contentType = response.headers.get('content-type') || ''
    if (
      !response.ok
      || response.url !== endpoint
      || !/^application\/json(?:;|$)/i.test(contentType)
      || !Number.isFinite(length)
      || length < 0
      || length > 64 * 1024
    ) return false
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > 64 * 1024) return false
    return hostedActorMetadataMatches(JSON.parse(text), actor, contract)
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export async function assertHostedBrowserActor(
  page: Page,
  actor: HostedRealtimeAccount,
  contract: HostedRealtimeContract = hostedContract,
): Promise<void> {
  const accessToken = await browserAccessToken(page, contract)
  if (
    !accessToken
    || !await browserSessionMatches(page, contract, actor)
    || !await serverBrowserSessionMatches(accessToken, actor, contract)
  ) throw new Error('hosted_realtime_browser_actor_boundary_failed')
}

export async function loginHostedActor(
  page: Page,
  actor: HostedRealtimeAccount,
  contract: HostedRealtimeContract = hostedContract,
): Promise<void> {
  await page.goto(`${contract.appOrigin}/#/pages/login/index`, {
    waitUntil: 'domcontentloaded',
  })
  await page.locator('uni-input input').nth(0).fill(actor.email)
  await page.locator('uni-input input').nth(1).fill(actor.password)
  await page.locator('uni-button.submit-btn').click()
  await page.waitForURL(
    url => !url.hash.includes('/pages/login/index'),
    { timeout: 20_000 },
  )
  await assertHostedBrowserActor(page, actor, contract)
}

export async function openHostedConversation(
  page: Page,
  conversationId: string,
): Promise<void> {
  await page.evaluate(id => {
    window.location.hash = `/pages/chat/index?id=${encodeURIComponent(id)}`
  }, conversationId)
  await page.locator('.input-bar').waitFor({
    state: 'visible',
    timeout: 30_000,
  })
}

export async function signOutHostedActor(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '/pages/settings/index'
  })
  await page.locator('[aria-label="Sign Out"]').waitFor({
    state: 'visible',
    timeout: 20_000,
  })
  await page.locator('[aria-label="Sign Out"]').click()
  await page.locator('.uni-modal__btn_primary').last().click()
  await page.waitForFunction(storageKey => (
    !localStorage.getItem(storageKey)
  ), `sb-${hostedContract.projectRef}-auth-token`, { timeout: 20_000 })
}

export interface HostedBrowserActor {
  readonly actor: HostedRealtimeAccount
  readonly context: BrowserContext
  readonly page: Page
  readonly network: HostedNetworkController
}

export interface HostedSdkActor {
  readonly actor: HostedRealtimeAccount
  readonly client: SupabaseClient
  readonly accessToken: string
  insertMessage(
    conversationId: string,
    messageId?: string,
  ): Promise<{ id: string; marker: string }>
}

export interface HostedWorld {
  readonly contract: HostedRealtimeContract
  readonly browserActors: Readonly<{
    a: HostedBrowserActor
    b: HostedBrowserActor
    c: HostedBrowserActor
  }>
  readonly sdkActors: Readonly<{
    a: HostedSdkActor
    b: HostedSdkActor
    c: HostedSdkActor
  }>
}

async function createBrowserActor(
  browser: Browser,
  actor: HostedRealtimeAccount,
): Promise<HostedBrowserActor> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    locale: 'en-US',
    colorScheme: 'light',
    acceptDownloads: false,
    ignoreHTTPSErrors: false,
    serviceWorkers: 'block',
  })
  let network: HostedNetworkController | null = null
  try {
    network = await installNetworkBoundary(context, hostedContract, actor)
    context.on('page', openedPage => network?.attachPage(openedPage))
    for (const openedPage of context.pages()) network.attachPage(openedPage)
    const page = await context.newPage()
    network.attachPage(page)
    await page.addInitScript(() => {
      localStorage.setItem('welcomed', '1')
      localStorage.setItem('lang', 'en')
    })
    await loginHostedActor(page, actor)
    return { actor, context, page, network }
  } catch (error) {
    let cleanupFailed = false
    try {
      if (network) await network.beginTeardown()
    } catch {
      cleanupFailed = true
    }
    try {
      await context.close()
    } catch {
      cleanupFailed = true
    }
    try {
      if (network) await network.revokeIssuedSessions()
    } catch {
      cleanupFailed = true
    }
    if (cleanupFailed) {
      throw new Error('hosted_realtime_browser_setup_cleanup_failed')
    }
    throw error
  }
}

async function createSdkActor(
  actor: HostedRealtimeAccount,
  registry: HostedCanaryWriteRegistry,
): Promise<HostedSdkActor> {
  const client = createClient(
    hostedContract.supabaseOrigin,
    hostedContract.publishableKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: createHostedGuardedFetch(hostedContract, actor, registry),
      },
      realtime: {
        transport: createHostedGuardedWebSocketTransport(hostedContract, actor),
      },
    },
  )
  let issuedAccessToken: string | null = null
  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: actor.email,
      password: actor.password,
    })
    if (typeof data.session?.access_token === 'string') {
      issuedAccessToken = data.session.access_token
    }
    if (
      error
      || !data.session
      || !hostedActorMetadataMatches(data.user, actor, hostedContract)
    ) {
      throw new Error('hosted_realtime_sdk_actor_boundary_failed')
    }
    await client.realtime.setAuth(data.session.access_token)
    return {
      actor,
      client,
      accessToken: data.session.access_token,
      async insertMessage(conversationId, messageId = crypto.randomUUID()) {
        const id = messageId.toLowerCase()
        const marker = `caaci-hosted-canary-${id}`
        registry.registerAttempt(actor, conversationId, id, hostedContract)
        const { data: inserted, error: insertError } = await client.rpc(
          'hosted_realtime_canary_insert_message',
          {
            p_run_id: hostedContract.runId,
            p_id: id,
            p_conversation_id: conversationId,
            p_content: marker,
          },
        )
        const row = Array.isArray(inserted) ? inserted[0] : inserted
        if (
          insertError
          || !row
          || typeof row !== 'object'
          || String((row as Record<string, unknown>).id || '') !== id
        ) throw new Error('hosted_realtime_synthetic_insert_failed')
        return { id, marker }
      },
    }
  } catch {
    let cleanupFailed = false
    if (issuedAccessToken) {
      try {
        await revokeExactHostedSession(hostedContract, issuedAccessToken)
        issuedAccessToken = null
      } catch {
        cleanupFailed = true
      }
    }
    try {
      const statuses = await client.removeAllChannels()
      if (statuses.some(status => status !== 'ok')) cleanupFailed = true
    } catch {
      cleanupFailed = true
    }
    try {
      await Promise.resolve(client.realtime.disconnect())
    } catch {
      cleanupFailed = true
    }
    throw new Error(
      cleanupFailed
        ? 'hosted_realtime_sdk_setup_cleanup_failed'
        : 'hosted_realtime_sdk_actor_boundary_failed',
    )
  }
}

async function beginHostedRun(actor: HostedSdkActor): Promise<void> {
  if (actor.actor.role !== 'member-a') {
    throw new Error('hosted_realtime_run_coordinator_failed')
  }
  const startedAt = Date.now()
  const { data, error } = await actor.client.rpc(
    'hosted_realtime_canary_begin_run',
    { p_run_id: hostedContract.runId },
  )
  const result = Array.isArray(data) ? data[0] : data
  const leaseExpiresAt = Date.parse(
    String((result as Record<string, unknown> | null)?.lease_expires_at || ''),
  )
  if (
    error
    || !result
    || typeof result !== 'object'
    || (result as Record<string, unknown>).run_id !== hostedContract.runId
    || !Number.isFinite(leaseExpiresAt)
    || leaseExpiresAt < startedAt + 20 * 60 * 1_000
    || leaseExpiresAt > startedAt + 60 * 60 * 1_000
  ) throw new Error('hosted_realtime_run_begin_failed')
}

async function prepareSdkActorForCleanup(
  actor: HostedSdkActor,
): Promise<void> {
  let cleanupFailed = false
  try {
    const removals = await actor.client.removeAllChannels()
    if (removals.some(status => status !== 'ok')) cleanupFailed = true
  } catch {
    cleanupFailed = true
  }
  try {
    await Promise.resolve(actor.client.realtime.disconnect())
  } catch {
    cleanupFailed = true
  }
  if (cleanupFailed) throw new Error('hosted_realtime_cleanup_failed')
}

async function cleanupHostedRun(
  coordinator: HostedSdkActor,
  registry: HostedCanaryWriteRegistry,
): Promise<void> {
  const ids = registry.allIds()
  const completedRunShapeMatches =
    registry.completedRunShapeMatches(hostedContract)
  const { data, error } = await coordinator.client.rpc(
    'hosted_realtime_canary_cleanup',
    {
      p_run_id: hostedContract.runId,
      p_message_ids: ids,
    },
  )
  const result = Array.isArray(data) ? data[0] : data
  if (
    error
    || !result
    || typeof result !== 'object'
    || (result as Record<string, unknown>).residue_count !== 0
  ) throw new Error('hosted_realtime_cleanup_failed')

  // A transport failure before the insert reaches PostgREST is still kept in
  // the local attempt registry. The server may safely clean every row it did
  // receive and report fewer deletes; retain that mismatch as a failed run,
  // but clear the local registry once global server residue is proven zero.
  registry.clearAll(ids)
  if (
    (result as Record<string, unknown>).deleted_count !== ids.length
    || !completedRunShapeMatches
  ) {
    throw new Error('hosted_realtime_cleanup_count_failed')
  }
}

async function removeChannel(
  actor: HostedSdkActor,
  channel: RealtimeChannel,
): Promise<void> {
  const status = await actor.client.removeChannel(channel)
  if (status !== 'ok') {
    throw new Error('hosted_realtime_channel_teardown_failed')
  }
}

export { expect, removeChannel }

export function createHostedAnonymousClient(
  boundaryActor: HostedRealtimeAccount = hostedContract.accounts[0],
): SupabaseClient {
  return createClient(
    hostedContract.supabaseOrigin,
    hostedContract.publishableKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: async () => {
          throw new Error('hosted_realtime_anonymous_http_denied')
        },
      },
      realtime: {
        transport: createHostedGuardedWebSocketTransport(
          hostedContract,
          boundaryActor,
          { anonymous: true },
        ),
      },
    },
  )
}

type WorkerFixtures = {
  world: HostedWorld
}

export const test = base.extend<{}, WorkerFixtures>({
  world: [async ({ browser }, use) => {
    assertHostedDeploymentManifestProof(hostedContract, process.env)
    const registry = new HostedCanaryWriteRegistry()
    const browserActors: HostedBrowserActor[] = []
    const sdkActors: HostedSdkActor[] = []
    let runStarted = false
    try {
      const sentinel = await fetchHostedEnvironmentSentinel(hostedContract)
      assertHostedEnvironmentSentinel(
        hostedContract,
        Array.isArray(sentinel) ? sentinel[0] : sentinel,
        'ready',
      )
      sdkActors.push(await createSdkActor(hostedContract.accounts[0], registry))
      await beginHostedRun(sdkActors[0])
      runStarted = true
      for (const actor of hostedContract.accounts.slice(1)) {
        sdkActors.push(await createSdkActor(actor, registry))
      }
      for (const actor of hostedContract.accounts) {
        browserActors.push(await createBrowserActor(browser, actor))
      }

      await use({
        contract: hostedContract,
        browserActors: {
          a: browserActors[0],
          b: browserActors[1],
          c: browserActors[2],
        },
        sdkActors: {
          a: sdkActors[0],
          b: sdkActors[1],
          c: sdkActors[2],
        },
      })
    } finally {
      let teardownFailed = false
      for (const actor of browserActors) {
        const boundary = actor.network
        try {
          await boundary.beginTeardown()
        } catch {
          teardownFailed = true
        }
        let expectedAccessToken: string | undefined
        try {
          const observed = await browserAccessToken(actor.page, hostedContract)
          if (
            observed
            && !hostedContract.accounts.some(candidate => (
              tokenSubjectMatches(observed, candidate)
            ))
          ) {
            teardownFailed = true
          } else {
            expectedAccessToken = observed || undefined
          }
        } catch {
          teardownFailed = true
        }
        try {
          await actor.context.close()
        } catch {
          teardownFailed = true
        }
        try {
          await boundary.revokeIssuedSessions(expectedAccessToken)
        } catch {
          teardownFailed = true
        }
        try {
          await boundary.assertNoViolation()
        } catch {
          teardownFailed = true
        }
      }
      for (const actor of sdkActors) {
        try {
          await prepareSdkActorForCleanup(actor)
        } catch {
          teardownFailed = true
        }
      }
      if (runStarted && sdkActors[0]) {
        try {
          await cleanupHostedRun(sdkActors[0], registry)
        } catch {
          teardownFailed = true
        }
      }
      // Database cleanup deliberately has no DELETE privilege on Supabase's
      // managed auth.sessions table. Revoke every exact SDK session through
      // the ordinary Auth boundary after the coordinator no longer needs its
      // access token for the cleanup RPC.
      for (const actor of sdkActors) {
        try {
          await revokeExactHostedSession(
            hostedContract,
            actor.accessToken,
          )
        } catch {
          teardownFailed = true
        }
      }
      if (registry.size !== 0) teardownFailed = true
      try {
        const sentinel = await fetchHostedEnvironmentSentinel(hostedContract)
        assertHostedEnvironmentSentinel(
          hostedContract,
          Array.isArray(sentinel) ? sentinel[0] : sentinel,
          'cleaned',
        )
      } catch {
        teardownFailed = true
      }
      if (teardownFailed) throw new Error('hosted_realtime_teardown_failed')
    }
  }, { scope: 'worker', timeout: 120_000 }],
})
