import type {
  HostedRealtimeAccount,
  HostedRealtimeContract,
} from './realtime-contract'

const READ_ONLY_REST_TABLES = new Set([
  'blocks',
  'conversations',
  'conversation_archives',
  'items',
  'meetups',
  'messages',
  'notifications',
  'offers',
  'profiles',
])
const AUTH_METHODS = new Map([
  ['/auth/v1/token', new Set(['OPTIONS', 'POST'])],
  ['/auth/v1/user', new Set(['GET', 'OPTIONS'])],
  ['/auth/v1/logout', new Set(['OPTIONS', 'POST'])],
  ['/auth/v1/health', new Set(['GET', 'OPTIONS'])],
])
const SAFE_BROWSER_HEADER_NAMES = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'accept-profile',
  'access-control-request-headers',
  'access-control-request-method',
  'apikey',
  'authorization',
  'cache-control',
  'content-language',
  'content-profile',
  'content-type',
  'dnt',
  'if-modified-since',
  'if-none-match',
  'origin',
  'pragma',
  'prefer',
  'priority',
  'range',
  'range-unit',
  'referer',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'sec-fetch-user',
  'sec-gpc',
  'upgrade-insecure-requests',
  'user-agent',
  'x-client-info',
  'x-supabase-api-version',
])
const SUPABASE_REQUEST_HEADER_NAMES = new Set([
  'accept',
  'accept-profile',
  'apikey',
  'authorization',
  'content-profile',
  'content-type',
  'prefer',
  'range',
  'range-unit',
  'x-client-info',
  'x-supabase-api-version',
])
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ITEM_IMAGE_PATH_RE =
  /^\/storage\/v1\/(?:object|render\/image)\/public\/item-images\/items\/([0-9a-f-]{36})\/([A-Za-z0-9][A-Za-z0-9._/-]{0,299})$/i
const MANAGED_BANNER_PATH_RE =
  /^\/storage\/v1\/(?:object|render\/image)\/public\/banners\/managed\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{64}\.(?:png|jpg|webp)$/i
export interface HostedPhoenixFrame {
  readonly joinRef: string | null
  readonly ref: string | null
  readonly topic: string
  readonly event: string
  readonly payload: Record<string, unknown>
}

export interface HostedPhoenixBroadcastPush {
  readonly joinRef: string
  readonly ref: string
  readonly topic: string
  readonly event: string
  readonly payload: Record<string, unknown>
}

export type HostedDeniedRealtimeProbe = 'random' | 'global' | 'user'

/**
 * AUTH-02 is the only place where the local egress guard intentionally lets
 * an invalid private topic reach hosted Realtime. The target is derived from
 * the frozen run/actor contract, never from an argument or environment value.
 */
export function hostedDeniedRealtimeProbeTopic(
  contract: HostedRealtimeContract,
  actor: HostedRealtimeAccount,
  probe: HostedDeniedRealtimeProbe,
): string {
  if (probe === 'random') return `conversation:${contract.runId}`
  if (probe === 'global') return 'online-users'
  if (probe === 'user') return `user:${actor.expectedUserId}`
  throw new Error('hosted_realtime_denied_probe_invalid')
}

function restResource(pathname: string): string | null {
  const match = /^\/rest\/v1\/([a-z_][a-z0-9_]*)$/.exec(pathname)
  return match?.[1] || null
}

function exactJsonObject(
  body: string | null | undefined,
): Record<string, unknown> | null {
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > 4096) {
    return null
  }
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
  const actual = Object.keys(value).sort()
  return (
    actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index])
  )
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

function safeBrowserHeaderValue(name: string, value: string): boolean {
  if (
    value.length > 2_048
    || /[\u0000-\u0008\u000a-\u001f\u007f]/.test(value)
  ) return false
  if (name === 'accept') {
    const allowedMediaTypes = new Set([
      '*/*',
      'application/json',
      'application/signed-exchange',
      'application/xhtml+xml',
      'application/xml',
      'image/*',
      'image/apng',
      'image/avif',
      'image/svg+xml',
      'image/webp',
      'text/css',
      'text/html',
      'text/plain',
    ])
    return value.length <= 512 && value.split(',').every(part => {
      const mediaType = part.trim().split(';', 1)[0].toLowerCase()
      return allowedMediaTypes.has(mediaType)
    })
  }
  if (name === 'accept-language' || name === 'content-language') {
    if (value.length > 128) return false
    return value.split(',').every(part => (
      /^(?:\*|[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*)(?:;q=(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?))?$/
        .test(part.trim())
    ))
  }
  if (name === 'content-type') {
    return /^(?:application\/(?:json|x-www-form-urlencoded)|text\/plain)(?:\s*;\s*charset=utf-8)?$/i
      .test(value)
  }
  if (name === 'range') return /^bytes=\d+-\d*$/.test(value)
  if (name === 'range-unit') return value === 'items'
  if (name === 'accept-profile' || name === 'content-profile') {
    return value === 'public'
  }
  if (name === 'prefer') {
    return value.split(',').every(part => (
      /^(?:return=(?:minimal|representation)|count=(?:exact|planned|estimated)|resolution=merge-duplicates)$/i
        .test(part.trim())
    ))
  }
  if (name === 'x-client-info') {
    return (
      value.length <= 256
      && /^supabase-js(?:-[A-Za-z0-9]+)?\/[0-9][A-Za-z0-9.+-]*$/
        .test(value)
    )
  }
  if (name === 'x-supabase-api-version') {
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
  }
  if (name === 'cache-control') {
    return ['max-age=0', 'no-cache', 'no-store'].includes(value.toLowerCase())
  }
  if (name === 'pragma') return value.toLowerCase() === 'no-cache'
  if (name === 'priority') return /^u=[0-7](?:,\s*i)?$/.test(value)
  return true
}

function safeBrowserReferrer(
  value: string,
  contract: HostedRealtimeContract,
): boolean {
  try {
    const url = new URL(value)
    return (
      url.origin === contract.appOrigin
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && value.length <= 2_048
    )
  } catch {
    return false
  }
}

/**
 * Universal browser egress gate. It runs before entry/assets, local mocks, or
 * any continued request, so a compromised Preview cannot smuggle credentials
 * into Vercel/Supabase/CDN logs through a custom header or URL.
 */
export function hostedBrowserRequestHeadersAllowed(
  contract: HostedRealtimeContract,
  actor: HostedRealtimeAccount,
  rawUrl: string,
  method: string,
  headers: Headers,
  issuedAccessTokens: readonly string[],
  forbiddenSecretValues: readonly string[] = issuedAccessTokens,
): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  const normalizedMethod = method.toUpperCase()
  let invalid = false
  headers.forEach((value, rawName) => {
    const name = rawName.toLowerCase()
    if (
      !SAFE_BROWSER_HEADER_NAMES.has(name)
      || !safeBrowserHeaderValue(name, value)
      || (
        name !== 'authorization'
        && /(?:bearer\s+|eyJ[A-Za-z0-9_-]{8,}\.|sb_secret_)/i.test(value)
      )
      || contract.accounts.some(account => value.includes(account.password))
    ) invalid = true
  })
  if (invalid) return false

  const referrer = headers.get('referer')
  if (referrer && !safeBrowserReferrer(referrer, contract)) return false
  const origin = headers.get('origin')
  if (origin && origin !== contract.appOrigin) return false

  let decodedPathAndQuery = ''
  try {
    decodedPathAndQuery = decodeURIComponent(`${url.pathname}${url.search}`)
  } catch {
    return false
  }
  const knownSecrets = [
    ...contract.accounts.map(account => account.password),
    ...forbiddenSecretValues,
  ]
  const exactPasswordGrant = (
    url.origin === contract.supabaseOrigin
    && url.pathname === '/auth/v1/token'
    && url.searchParams.size === 1
    && url.searchParams.get('grant_type') === 'password'
  )
  if (
    url.href.length > 8_192
    || /[\u0000-\u001f\u007f]/.test(decodedPathAndQuery)
    || (
      /(?:bearer\s+|eyJ[A-Za-z0-9_-]{8,}\.|sb_secret_|refresh[_-]?token|access[_-]?token|password)/i
        .test(decodedPathAndQuery)
      && !exactPasswordGrant
    )
    || knownSecrets.some(secret => (
      decodedPathAndQuery.includes(secret)
      || url.href.includes(encodeURIComponent(secret))
    ))
  ) return false

  if (url.origin === contract.appOrigin) {
    return (
      !headers.has('authorization')
      && !headers.has('apikey')
      && !headers.has('cookie')
      && !headers.has('proxy-authorization')
    )
  }
  if (url.origin !== contract.supabaseOrigin) return false
  if (headers.has('cookie') || headers.has('proxy-authorization')) return false

  if (normalizedMethod === 'OPTIONS') {
    const requestedMethod = headers.get('access-control-request-method')
    if (
      headers.has('authorization')
      || headers.has('apikey')
      || (
        requestedMethod
        && !['GET', 'HEAD', 'POST', 'PATCH'].includes(requestedMethod)
      )
    ) return false
    const requestedHeaders = headers.get('access-control-request-headers')
    return !requestedHeaders || requestedHeaders.split(',').every(name => (
      SUPABASE_REQUEST_HEADER_NAMES.has(name.trim().toLowerCase())
    ))
  }

  const authorization = headers.get('authorization') || ''
  const apikey = headers.get('apikey')
  if (url.pathname.startsWith('/storage/v1/')) {
    return !authorization && !apikey
  }
  if (
    url.pathname === '/auth/v1/token'
    || url.pathname === '/auth/v1/health'
  ) {
    return (
      apikey === contract.publishableKey
      && authorization === `Bearer ${contract.publishableKey}`
    )
  }
  const accessToken = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : ''
  return (
    apikey === contract.publishableKey
    && issuedAccessTokens.includes(accessToken)
    && tokenSubjectMatches(accessToken, actor)
  )
}

function authRequestAllowed(
  url: URL,
  method: string,
  actor: HostedRealtimeAccount,
  body: string | null | undefined,
): boolean {
  const methods = AUTH_METHODS.get(url.pathname)
  if (!methods?.has(method)) return false
  if (method === 'OPTIONS') {
    if (url.pathname === '/auth/v1/token') {
      return (
        url.searchParams.size === 1
        && url.searchParams.get('grant_type') === 'password'
      )
    }
    if (url.pathname === '/auth/v1/logout') {
      return (
        url.searchParams.size === 1
        && url.searchParams.get('scope') === 'local'
      )
    }
    return !url.search
  }

  if (url.pathname === '/auth/v1/token') {
    if (
      method !== 'POST'
      || url.searchParams.size !== 1
      || url.searchParams.get('grant_type') !== 'password'
    ) return false
    const payload = exactJsonObject(body)
    const security = (
      payload?.gotrue_meta_security
      && typeof payload.gotrue_meta_security === 'object'
      && !Array.isArray(payload.gotrue_meta_security)
    ) ? payload.gotrue_meta_security as Record<string, unknown> : null
    return !!payload
      && exactKeys(payload, ['email', 'gotrue_meta_security', 'password'])
      && payload.email === actor.email
      && payload.password === actor.password
      && !!security
      && Object.keys(security).length === 0
  }
  if (url.pathname === '/auth/v1/logout') {
    return (
      method === 'POST'
      && url.searchParams.size === 1
      && url.searchParams.get('scope') === 'local'
      && (!body || body === '{}')
    )
  }
  return (
    (url.pathname === '/auth/v1/user' && method === 'GET' && !url.search)
    || (url.pathname === '/auth/v1/health' && method === 'GET' && !url.search)
  )
}

function safeReadQuery(url: URL): boolean {
  if (url.href.length > 8192) return false
  for (const [key, value] of url.searchParams) {
    if (
      !/^[a-z_][a-z0-9_.]*$/i.test(key)
      || key.length > 64
      || value.length > 2048
      || /[\u0000-\u001f\u007f]/.test(value)
      || /(?:bearer\s+|eyJ[a-zA-Z0-9_-]{8,}\.|sb_secret_|password)/i.test(value)
    ) return false
  }
  return true
}

function publicStorageReadAllowed(url: URL, method: string): boolean {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) return false
  const itemImageMatch = ITEM_IMAGE_PATH_RE.exec(url.pathname)
  const exactManagedBanner = MANAGED_BANNER_PATH_RE.test(url.pathname)
  if (!itemImageMatch && !exactManagedBanner) return false
  if (itemImageMatch) {
    const [, owner, suffix] = itemImageMatch
    if (
      !UUID_RE.test(owner)
      || suffix.includes('//')
      || suffix.includes('/./')
      || suffix.includes('/../')
      || suffix.endsWith('.')
      || suffix.endsWith('/')
      || /(?:bearer|password|token|secret)/i.test(suffix)
    ) return false
  }
  if (url.pathname.startsWith('/storage/v1/object/public/')) {
    return !url.search
  }
  if (!url.pathname.startsWith('/storage/v1/render/image/public/')) return false
  const allowed = new Map([
    ['width', new Set(['96', '480', '640', '1280'])],
    ['height', new Set(['96'])],
    ['quality', new Set(['72', '75', '82'])],
    ['resize', new Set(['contain', 'cover'])],
  ])
  if (url.searchParams.size < 3 || url.searchParams.size > 4) return false
  for (const [key, value] of url.searchParams) {
    if (!allowed.get(key)?.has(value)) return false
  }
  return true
}

function exactConversationReadReceipt(
  url: URL,
  actor: HostedRealtimeAccount,
  contract: HostedRealtimeContract,
  body: string | null | undefined,
): boolean {
  const conversationFilter = url.searchParams.get('conversation_id')
  const allowedConversation = (
    conversationFilter === `eq.${contract.conversations.ab}`
    || conversationFilter === `eq.${contract.conversations.ac}`
  )
  return (
    allowedConversation
    && url.searchParams.get('sender_id') === `neq.${actor.expectedUserId}`
    && url.searchParams.get('is_read') === 'eq.false'
    && [...url.searchParams.keys()].every(key => (
      ['conversation_id', 'sender_id', 'is_read'].includes(key)
    ))
    && body === '{"is_read":true}'
  )
}

export function hostedFingerprintRequestMockable(
  contract: HostedRealtimeContract,
  rawUrl: string,
  method: string,
  body?: string | null,
): boolean {
  try {
    const url = new URL(rawUrl)
    if (
      url.username
      || url.password
      || /%(?:2f|5c)/i.test(url.pathname)
    ) return false
    if (
      url.origin === contract.supabaseOrigin
      && url.pathname === '/rest/v1/rpc/record_fingerprint'
      && !url.search
      && method.toUpperCase() === 'OPTIONS'
      && !body
    ) return true
    const payload = exactJsonObject(body)
    return (
      url.origin === contract.supabaseOrigin
      && url.pathname === '/rest/v1/rpc/record_fingerprint'
      && !url.search
      && method.toUpperCase() === 'POST'
      && !!payload
      && exactKeys(payload, ['fp_hash_in', 'ua_snippet_in'])
      && typeof payload.fp_hash_in === 'string'
      && /^[0-9a-f]{64}$/.test(payload.fp_hash_in)
      && typeof payload.ua_snippet_in === 'string'
      && payload.ua_snippet_in.length <= 200
    )
  } catch {
    return false
  }
}

export function hostedReadReceiptRequestMockable(
  contract: HostedRealtimeContract,
  actor: HostedRealtimeAccount,
  rawUrl: string,
  method: string,
  body?: string | null,
): boolean {
  try {
    const url = new URL(rawUrl)
    if (
      url.username
      || url.password
      || /%(?:2f|5c)/i.test(url.pathname)
      || url.origin !== contract.supabaseOrigin
      || url.pathname !== '/rest/v1/messages'
    ) return false
    const normalizedMethod = method.toUpperCase()
    if (normalizedMethod === 'OPTIONS') {
      return (
        !body
        && exactConversationReadReceipt(
          url,
          actor,
          contract,
          '{"is_read":true}',
        )
      )
    }
    return (
      normalizedMethod === 'PATCH'
      && exactConversationReadReceipt(url, actor, contract, body)
    )
  } catch {
    return false
  }
}

export function hostedHttpRequestAllowed(
  contract: HostedRealtimeContract,
  actor: HostedRealtimeAccount,
  rawUrl: string,
  method: string,
  body?: string | null,
): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (
    url.username
    || url.password
    || /%(?:2f|5c)/i.test(url.pathname)
  ) return false

  const normalizedMethod = method.toUpperCase()
  if (url.origin === contract.appOrigin) {
    const staticPath = (
      url.pathname === '/'
      || contract.appAssets.some(asset => asset.path === url.pathname)
    )
    return (
      ['GET', 'HEAD'].includes(normalizedMethod)
      && staticPath
      && !url.search
    )
  }
  if (url.origin !== contract.supabaseOrigin) return false

  if (AUTH_METHODS.has(url.pathname)) {
    return authRequestAllowed(url, normalizedMethod, actor, body)
  }

  if (url.pathname.startsWith('/storage/v1/')) {
    return publicStorageReadAllowed(url, normalizedMethod)
  }

  const rpc = /^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/.exec(url.pathname)?.[1]
  if (rpc) {
    return (
      rpc === 'get_my_profile'
      && (
        normalizedMethod === 'OPTIONS'
        || (
          normalizedMethod === 'POST'
          && !url.search
          && (!body || body === '{}')
        )
      )
    )
  }

  const resource = restResource(url.pathname)
  if (!resource || !READ_ONLY_REST_TABLES.has(resource)) return false
  if (['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod)) {
    return safeReadQuery(url)
  }
  return false
}

export function hostedRealtimeSocketAllowed(
  contract: HostedRealtimeContract,
  rawUrl: string,
): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      url.protocol === 'wss:'
      && url.host === `${contract.projectRef}.supabase.co`
      && url.pathname === '/realtime/v1/websocket'
      && !url.username
      && !url.password
      && url.searchParams.size === 2
      && url.searchParams.get('apikey') === contract.publishableKey
      && url.searchParams.get('vsn') === '2.0.0'
    )
  } catch {
    return false
  }
}

export function decodeHostedPhoenixFrame(
  message: string | Buffer,
): HostedPhoenixFrame | null {
  if (
    typeof message !== 'string'
    || Buffer.byteLength(message, 'utf8') > 64 * 1024
  ) return null
  try {
    const decoded = JSON.parse(message)
    if (Array.isArray(decoded)) {
      if (decoded.length !== 5) return null
      const [joinRef, ref, topic, event, payload] = decoded
      if (
        (joinRef !== null && typeof joinRef !== 'string')
        || (ref !== null && typeof ref !== 'string')
        || typeof topic !== 'string'
        || typeof event !== 'string'
        || topic.length === 0
        || topic.length > 255
        || event.length === 0
        || event.length > 255
        || (typeof joinRef === 'string' && joinRef.length > 255)
        || (typeof ref === 'string' && ref.length > 255)
        || !payload
        || typeof payload !== 'object'
        || Array.isArray(payload)
      ) return null
      return {
        joinRef: typeof joinRef === 'string' ? joinRef : null,
        ref: typeof ref === 'string' ? ref : null,
        topic,
        event,
        payload,
      }
    }
    if (
      decoded
      && typeof decoded === 'object'
      && !Array.isArray(decoded)
      && Object.keys(decoded).every(key => (
        key === 'join_ref'
        || key === 'ref'
        || key === 'topic'
        || key === 'event'
        || key === 'payload'
      ))
      && Object.keys(decoded).length >= 3
      && (decoded.join_ref === undefined
        || decoded.join_ref === null
        || typeof decoded.join_ref === 'string')
      && (decoded.ref === undefined
        || decoded.ref === null
        || typeof decoded.ref === 'string')
      && typeof decoded.topic === 'string'
      && typeof decoded.event === 'string'
      && decoded.topic.length > 0
      && decoded.topic.length <= 255
      && decoded.event.length > 0
      && decoded.event.length <= 255
      && (typeof decoded.join_ref !== 'string'
        || decoded.join_ref.length <= 255)
      && (typeof decoded.ref !== 'string' || decoded.ref.length <= 255)
      && decoded.payload
      && typeof decoded.payload === 'object'
      && !Array.isArray(decoded.payload)
    ) {
      return {
        joinRef: typeof decoded.join_ref === 'string'
          ? decoded.join_ref
          : null,
        ref: typeof decoded.ref === 'string' ? decoded.ref : null,
        topic: decoded.topic,
        event: decoded.event,
        payload: decoded.payload,
      }
    }
  } catch {
  }
  return null
}

function strictUtf8(bytes: Uint8Array): string | null {
  const decoded = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).toString('utf8')
  return Buffer.from(decoded, 'utf8').equals(Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  )) ? decoded : null
}

export function decodeHostedPhoenixBroadcastPush(
  message: ArrayBuffer | ArrayBufferView,
): HostedPhoenixBroadcastPush | null {
  const bytes = ArrayBuffer.isView(message)
    ? new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
    : new Uint8Array(message)
  if (
    bytes.byteLength < 7
    || bytes.byteLength > 64 * 1024
    || bytes[0] !== 3
  ) return null

  const joinRefLength = bytes[1]
  const refLength = bytes[2]
  const topicLength = bytes[3]
  const eventLength = bytes[4]
  const metadataLength = bytes[5]
  const payloadEncoding = bytes[6]
  const metadataEnd = (
    7
    + joinRefLength
    + refLength
    + topicLength
    + eventLength
    + metadataLength
  )
  if (
    topicLength === 0
    || eventLength === 0
    || metadataLength !== 0
    || payloadEncoding !== 1
    || metadataEnd >= bytes.byteLength
  ) return null

  let offset = 7
  const readText = (length: number): string | null => {
    const value = strictUtf8(bytes.subarray(offset, offset + length))
    offset += length
    return value
  }
  const joinRef = readText(joinRefLength)
  const ref = readText(refLength)
  const topic = readText(topicLength)
  const event = readText(eventLength)
  const payloadText = strictUtf8(bytes.subarray(metadataEnd))
  if (
    joinRef === null
    || ref === null
    || !topic
    || !event
    || payloadText === null
  ) return null

  try {
    const payload = JSON.parse(payloadText)
    if (
      !payload
      || typeof payload !== 'object'
      || Array.isArray(payload)
    ) return null
    return {
      joinRef,
      ref,
      topic,
      event,
      payload: payload as Record<string, unknown>,
    }
  } catch {
    return null
  }
}

function knownConversation(
  contract: HostedRealtimeContract,
  value: string,
): boolean {
  return (
    value === contract.conversations.ab
    || value === contract.conversations.ac
  )
}

function exactPostgresBinding(
  candidate: unknown,
  actor: HostedRealtimeAccount,
  contract: HostedRealtimeContract,
  topic: string,
): boolean {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return false
  }
  const binding = candidate as Record<string, unknown>
  if (
    !exactKeys(binding, ['event', 'filter', 'schema', 'table'])
    || binding.schema !== 'public'
  ) return false

  const conversationTopic = /^realtime:(messages|offers|meetups):(.+)$/.exec(topic)
  if (conversationTopic) {
    const [, resource, conversationId] = conversationTopic
    if (!knownConversation(contract, conversationId)) return false
    const table = resource === 'messages' ? 'messages' : resource
    const allowedEvents = resource === 'messages'
      ? new Set(['INSERT', 'UPDATE'])
      : new Set(['*'])
    return (
      binding.table === table
      && allowedEvents.has(String(binding.event))
      && binding.filter === `conversation_id=eq.${conversationId}`
    )
  }
  if (topic === `realtime:user-${actor.expectedUserId}-new-messages`) {
    return (
      binding.table === 'messages'
      && binding.event === 'INSERT'
      && binding.filter === `sender_id=neq.${actor.expectedUserId}`
    )
  }
  if (topic === `realtime:user-${actor.expectedUserId}-notifications`) {
    return (
      binding.table === 'notifications'
      && binding.event === 'INSERT'
      && binding.filter === `user_id=eq.${actor.expectedUserId}`
    )
  }
  if (topic === `realtime:hosted-notification-${contract.runId}`) {
    return (
      binding.table === 'notifications'
      && binding.event === 'INSERT'
      && binding.filter
        === `user_id=eq.${contract.accounts[0].expectedUserId}`
    )
  }
  if (/^realtime:hosted-pg-[0-9a-f-]{36}$/i.test(topic)) {
    const match = /^conversation_id=eq\.(.+)$/.exec(String(binding.filter))
    return (
      binding.table === 'messages'
      && binding.event === 'INSERT'
      && !!match
      && knownConversation(contract, match[1])
    )
  }
  return false
}

export function hostedRealtimeJoinAllowed(
  contract: HostedRealtimeContract,
  actor: HostedRealtimeAccount,
  frame: HostedPhoenixFrame,
  options: {
    anonymous?: boolean
    deniedProbe?: HostedDeniedRealtimeProbe
  } = {},
): boolean {
  if (
    frame.event !== 'phx_join'
    || !safePhoenixRef(frame.ref)
    || (
      frame.joinRef !== null
      && (
        !safePhoenixRef(frame.joinRef)
        || frame.joinRef !== frame.ref
      )
    )
    || !exactKeys(frame.payload, ['access_token', 'config'])
  ) return false
  const accessToken = frame.payload.access_token
  if (
    typeof accessToken !== 'string'
    || (
      options.anonymous
        ? accessToken !== contract.publishableKey
        : !tokenSubjectMatches(accessToken, actor)
    )
  ) return false
  const config = frame.payload.config
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return false
  }
  const candidate = config as Record<string, unknown>
  if (!exactKeys(candidate, [
    'broadcast',
    'postgres_changes',
    'presence',
    'private',
  ])) return false
  const bindings = candidate.postgres_changes
  if (!Array.isArray(bindings)) return false
  const presence = candidate.presence
  const broadcast = candidate.broadcast
  if (
    !presence
    || typeof presence !== 'object'
    || Array.isArray(presence)
    || !broadcast
    || typeof broadcast !== 'object'
    || Array.isArray(broadcast)
  ) return false
  const presenceConfig = presence as Record<string, unknown>
  const broadcastConfig = broadcast as Record<string, unknown>
  if (
    !exactKeys(presenceConfig, ['enabled', 'key'])
    || !exactKeys(broadcastConfig, ['ack', 'self'])
    || typeof presenceConfig.enabled !== 'boolean'
    || typeof presenceConfig.key !== 'string'
    || typeof broadcastConfig.ack !== 'boolean'
    || typeof broadcastConfig.self !== 'boolean'
  ) return false

  const privateMatch = /^realtime:conversation:(.+)$/.exec(frame.topic)
  const deniedProbeTopic = options.deniedProbe
    ? `realtime:${hostedDeniedRealtimeProbeTopic(
      contract,
      actor,
      options.deniedProbe,
    )}`
    : null
  if (deniedProbeTopic && frame.topic === deniedProbeTopic) {
    return (
      options.anonymous !== true
      && candidate.private === true
      && bindings.length === 0
      && presenceConfig.key === actor.expectedUserId
      && presenceConfig.enabled === true
      && broadcastConfig.self === false
      && broadcastConfig.ack === true
    )
  }
  if (privateMatch) {
    return (
      knownConversation(contract, privateMatch[1])
      && candidate.private === true
      && bindings.length === 0
      && presenceConfig.key === (
        options.anonymous ? 'anonymous-canary' : actor.expectedUserId
      )
      && typeof presenceConfig.enabled === 'boolean'
      && broadcastConfig.self === false
      && broadcastConfig.ack === true
    )
  }

  return (
    candidate.private === false
    && presenceConfig.key === ''
    && presenceConfig.enabled === false
    && broadcastConfig.self === false
    && broadcastConfig.ack === false
    && bindings.length > 0
    && bindings.every(binding => (
      exactPostgresBinding(binding, actor, contract, frame.topic)
    ))
  )
}

function safePhoenixRef(value: string | null): value is string {
  return (
    typeof value === 'string'
    && /^[1-9][0-9]{0,11}$/.test(value)
  )
}

function privateConversationFromTopic(
  contract: HostedRealtimeContract,
  topic: string,
): string | null {
  const match = /^realtime:conversation:(.+)$/.exec(topic)
  return match && knownConversation(contract, match[1]) ? match[1] : null
}

function hostedPresencePushAllowed(
  contract: HostedRealtimeContract,
  actor: HostedRealtimeAccount,
  frame: HostedPhoenixFrame,
  allowScenarioMarkers: boolean,
): boolean {
  if (
    frame.event !== 'presence'
    || !safePhoenixRef(frame.joinRef)
    || !safePhoenixRef(frame.ref)
    || !privateConversationFromTopic(contract, frame.topic)
    || frame.payload.type !== 'presence'
  ) return false

  if (frame.payload.event === 'untrack') {
    return exactKeys(frame.payload, ['event', 'type'])
  }
  if (
    frame.payload.event !== 'track'
    || !exactKeys(frame.payload, ['event', 'payload', 'type'])
  ) return false
  const payload = frame.payload.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false
  }
  const presence = payload as Record<string, unknown>
  const expectedKeys = allowScenarioMarkers
    ? ['online_at', 'presence_marker', 'user_id']
    : ['online_at', 'user_id']
  const onlineAt = presence.online_at
  return (
    exactKeys(presence, expectedKeys)
    && presence.user_id === actor.expectedUserId
    && typeof onlineAt === 'number'
    && Number.isSafeInteger(onlineAt)
    && onlineAt >= 1_500_000_000_000
    && onlineAt <= Date.now() + 60_000
    && (
      !allowScenarioMarkers
      || (
        typeof presence.presence_marker === 'string'
        && UUID_RE.test(presence.presence_marker)
      )
    )
  )
}

export function hostedRealtimeOutboundTextFrameAllowed(
  contract: HostedRealtimeContract,
  actor: HostedRealtimeAccount,
  frame: HostedPhoenixFrame,
  allowedAccessTokens: ReadonlySet<string>,
  options: {
    readonly anonymous?: boolean
    readonly allowScenarioMarkers?: boolean
    readonly deniedProbe?: HostedDeniedRealtimeProbe
  } = {},
): boolean {
  if (frame.event === 'phx_join') {
    const accessToken = frame.payload.access_token
    return (
      typeof accessToken === 'string'
      && (
        options.anonymous
          ? accessToken === contract.publishableKey
          : allowedAccessTokens.has(accessToken)
      )
      && hostedRealtimeJoinAllowed(contract, actor, frame, options)
    )
  }
  if (
    frame.topic === 'phoenix'
    && frame.event === 'heartbeat'
  ) {
    return (
      frame.joinRef === null
      && safePhoenixRef(frame.ref)
      && exactKeys(frame.payload, [])
    )
  }
  if (frame.event === 'phx_leave') {
    return (
      safePhoenixRef(frame.joinRef)
      && safePhoenixRef(frame.ref)
      && exactKeys(frame.payload, [])
    )
  }
  if (frame.event === 'access_token') {
    const accessToken = frame.payload.access_token
    return (
      safePhoenixRef(frame.joinRef)
      && safePhoenixRef(frame.ref)
      && exactKeys(frame.payload, ['access_token'])
      && typeof accessToken === 'string'
      && (
        options.anonymous
          ? accessToken === contract.publishableKey
          : allowedAccessTokens.has(accessToken)
      )
      && (
        options.anonymous
        || tokenSubjectMatches(accessToken, actor)
      )
    )
  }
  return hostedPresencePushAllowed(
    contract,
    actor,
    frame,
    options.allowScenarioMarkers === true,
  )
}

export function hostedRealtimeBroadcastPushAllowed(
  contract: HostedRealtimeContract,
  actor: HostedRealtimeAccount,
  frame: HostedPhoenixBroadcastPush,
  options: { readonly allowScenarioMarkers?: boolean } = {},
): boolean {
  const conversationId = privateConversationFromTopic(contract, frame.topic)
  if (
    !conversationId
    || frame.event !== 'typing'
    || !safePhoenixRef(frame.joinRef)
    || !safePhoenixRef(frame.ref)
  ) return false
  const expectedKeys = options.allowScenarioMarkers
    ? ['conversation_id', 'marker', 'user_id']
    : ['conversation_id', 'user_id']
  return (
    exactKeys(frame.payload, expectedKeys)
    && frame.payload.conversation_id === conversationId
    && frame.payload.user_id === actor.expectedUserId
    && (
      !options.allowScenarioMarkers
      || (
        typeof frame.payload.marker === 'string'
        && UUID_RE.test(frame.payload.marker)
      )
    )
  )
}
