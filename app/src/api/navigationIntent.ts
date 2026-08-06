/**
 * One-shot, process-local navigation handoffs.
 *
 * Search/category handoffs deliberately never touch durable storage: they are
 * UI navigation state, not account data or search history. Welcome targets are
 * held as parsed route descriptors so a first-run reLaunch cannot become an
 * open redirect. Login targets use the same descriptor model plus an opaque
 * nonce; only that bounded record is mirrored to H5 sessionStorage so Google
 * OAuth can survive a full-page trip to the provider.
 */

export interface NavigationIntentOwner {
  readonly userId: string | null
  readonly identityGeneration: number
}

export type HomeNavigationIntent =
  | { readonly kind: 'query'; readonly query: string }
  | { readonly kind: 'category'; readonly category: ItemCategoryIntent }

type ItemCategoryIntent =
  | 'electronics'
  | 'furniture'
  | 'housing'
  | 'clothing'
  | 'books'
  | 'vehicles'
  | 'rideshare'
  | 'daily'
  | 'food'
  | 'other'

export type ReturnRoutePurpose = 'welcome' | 'login'

export interface ReturnRouteDescriptor {
  readonly path: string
  readonly params: Readonly<Record<string, string>>
}

interface OwnedHomeNavigationIntent {
  readonly owner: NavigationIntentOwner
  readonly value: HomeNavigationIntent
}

interface LoginReturnRecord {
  readonly version: 1
  readonly nonce: string
  readonly route: ReturnRouteDescriptor
  readonly createdAt: number
  readonly originIdentityGeneration: number
  readonly state: 'staged' | 'authorized'
  readonly authorizedUserId?: string
  readonly authorizedIdentityGeneration?: number
}

interface TimedOptions {
  readonly now?: number
}

interface StageOptions extends TimedOptions {
  readonly nonce?: string
}

interface LaunchOptions {
  readonly path?: unknown
  readonly query?: Readonly<Record<string, unknown>>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const NONCE_RE = /^[A-Za-z0-9_-]{12,80}$/
const MAX_RETURN_TARGET_LENGTH = 1024
const MAX_LOGIN_INTENT_AGE_MS = 30 * 60 * 1000
const LOGIN_SESSION_KEY = 'caaci.login-return.v1'

const ITEM_CATEGORIES = new Set<ItemCategoryIntent>([
  'electronics',
  'furniture',
  'housing',
  'clothing',
  'books',
  'vehicles',
  'rideshare',
  'daily',
  'food',
  'other',
])

const WELCOME_UUID_ROUTES = new Set([
  '/pages/detail/index',
  '/pages/post/index',
  '/pages/seller/index',
  '/pages/chat/index',
])

const WELCOME_NO_PARAM_ROUTES = new Set([
  '/pages/plaza/index',
])

const LOGIN_NO_PARAM_ROUTES = new Set([
  '/pages/index/index',
  '/pages/plaza/index',
  '/pages/publish/index',
  '/pages/messages/index',
  '/pages/profile/index',
  '/pages/following/index',
  '/pages/saved-searches/index',
  '/pages/notifications/index',
  '/pages/history/index',
  '/pages/settings/index',
  '/pages/blocked/index',
  '/pages/illini-verify/index',
  '/pages/profile/edit',
])

const LOGIN_UUID_ROUTES = new Set([
  ...WELCOME_UUID_ROUTES,
  '/pages/publish/edit',
])

let pendingHomeNavigationIntent: OwnedHomeNavigationIntent | null = null
let pendingWelcomeReturnIntent: { nonce: string; route: ReturnRouteDescriptor } | null = null
let pendingLoginReturnIntent: LoginReturnRecord | null = null

function sameOwner(a: NavigationIntentOwner, b: NavigationIntentOwner): boolean {
  return a.userId === b.userId && a.identityGeneration === b.identityGeneration
}

function cleanOwner(owner: NavigationIntentOwner): NavigationIntentOwner {
  return {
    userId: typeof owner?.userId === 'string' ? owner.userId : null,
    identityGeneration: Number.isInteger(owner?.identityGeneration)
      ? owner.identityGeneration
      : -1,
  }
}

export function stageHomeNavigationIntent(
  value: HomeNavigationIntent,
  owner: NavigationIntentOwner,
): boolean {
  let normalized: HomeNavigationIntent | null = null
  if (value?.kind === 'query') {
    const query = String(value.query || '').trim().slice(0, 120)
    if (query) normalized = { kind: 'query', query }
  } else if (value?.kind === 'category' && ITEM_CATEGORIES.has(value.category)) {
    normalized = { kind: 'category', category: value.category }
  }
  if (!normalized) return false
  pendingHomeNavigationIntent = { owner: cleanOwner(owner), value: normalized }
  return true
}

export function consumeHomeNavigationIntent(
  owner: NavigationIntentOwner,
): HomeNavigationIntent | null {
  const pending = pendingHomeNavigationIntent
  if (!pending) return null
  // A mismatched authority can never revive this intent later.
  pendingHomeNavigationIntent = null
  return sameOwner(pending.owner, cleanOwner(owner)) ? pending.value : null
}

export function clearHomeNavigationIntent(): void {
  pendingHomeNavigationIntent = null
}

function routePolicy(
  path: string,
  purpose: ReturnRoutePurpose,
): { required: readonly string[] } | null {
  if (purpose === 'welcome') {
    if (WELCOME_NO_PARAM_ROUTES.has(path)) return { required: [] }
    return WELCOME_UUID_ROUTES.has(path) ? { required: ['id'] } : null
  }
  if (LOGIN_NO_PARAM_ROUTES.has(path)) return { required: [] }
  if (LOGIN_UUID_ROUTES.has(path)) return { required: ['id'] }
  return null
}

function containsUnsafeEncoding(value: string): boolean {
  return /%25|%2e|%2f|%5c/i.test(value)
}

export function parseReturnRoute(
  rawTarget: unknown,
  purpose: ReturnRoutePurpose,
): ReturnRouteDescriptor | null {
  if (typeof rawTarget !== 'string') return null
  const raw = rawTarget.trim()
  if (
    !raw
    || raw.length > MAX_RETURN_TARGET_LENGTH
    || !raw.startsWith('/')
    || raw.startsWith('//')
    || raw.includes('\\')
    || raw.includes('#')
    || /[\u0000-\u001f\u007f]/.test(raw)
    || containsUnsafeEncoding(raw)
  ) return null

  const queryAt = raw.indexOf('?')
  const rawPath = queryAt >= 0 ? raw.slice(0, queryAt) : raw
  if (
    rawPath.includes('%')
    || rawPath.includes('..')
    || !/^\/pages\/[a-z0-9-]+\/[a-z0-9-]+$/.test(rawPath)
  ) return null

  const policy = routePolicy(rawPath, purpose)
  if (!policy) return null

  const query = queryAt >= 0 ? raw.slice(queryAt + 1) : ''
  const search = new URLSearchParams(query)
  const allowed = new Set(policy.required)
  const seen = new Set<string>()
  const params: Record<string, string> = {}
  let invalidParam = false
  search.forEach((value, key) => {
    if (!allowed.has(key) || seen.has(key) || value.length > 120) {
      invalidParam = true
      return
    }
    seen.add(key)
    params[key] = value
  })
  if (invalidParam) return null
  if (seen.size !== policy.required.length) return null
  for (const key of policy.required) {
    const value = params[key]
    if (!value || !UUID_RE.test(value)) return null
    params[key] = value.toLowerCase()
  }
  return { path: rawPath, params }
}

export function canonicalReturnRoute(
  route: ReturnRouteDescriptor | null,
): string | null {
  if (!route) return null
  const entries = Object.entries(route.params)
  if (entries.length === 0) return route.path
  const query = entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
  return `${route.path}?${query}`
}

function parseStoredRouteDescriptor(
  value: unknown,
  purpose: ReturnRoutePurpose,
): ReturnRouteDescriptor | null {
  if (!value || typeof value !== 'object') return null
  const row = value as { path?: unknown; params?: unknown }
  if (typeof row.path !== 'string' || !row.params || typeof row.params !== 'object') return null
  const paramEntries = Object.entries(row.params as Record<string, unknown>)
  if (paramEntries.some(([, param]) => typeof param !== 'string')) return null
  const canonical = canonicalReturnRoute({
    path: row.path,
    params: Object.fromEntries(paramEntries) as Record<string, string>,
  })
  return parseReturnRoute(canonical, purpose)
}

function routeFromPathAndQuery(
  path: unknown,
  query: Readonly<Record<string, unknown>> | undefined,
  purpose: ReturnRoutePurpose,
): ReturnRouteDescriptor | null {
  if (typeof path !== 'string') return null
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const entries = Object.entries(query || {})
  if (entries.some(([, value]) => typeof value !== 'string')) return null
  const suffix = entries.length === 0
    ? ''
    : `?${entries.map(([key, value]) => (
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    )).join('&')}`
  return parseReturnRoute(`${normalizedPath}${suffix}`, purpose)
}

export function welcomeRouteFromLaunch(
  launchOptions: LaunchOptions | undefined,
  h5Hash: unknown,
): ReturnRouteDescriptor | null {
  if (typeof h5Hash === 'string' && h5Hash.startsWith('#/')) {
    // A real H5 hash route is more authoritative than the generic launch path.
    return parseReturnRoute(h5Hash.slice(1), 'welcome')
  }
  return routeFromPathAndQuery(launchOptions?.path, launchOptions?.query, 'welcome')
}

export function loginReturnRouteFromPage(page: unknown): string | null {
  if (!page || typeof page !== 'object') return null
  const candidate = page as {
    route?: unknown
    options?: Readonly<Record<string, unknown>>
    $page?: { fullPath?: unknown }
  }
  if (typeof candidate.$page?.fullPath === 'string') {
    const h5Route = parseReturnRoute(candidate.$page.fullPath, 'login')
    if (h5Route) return canonicalReturnRoute(h5Route)
  }
  return canonicalReturnRoute(
    routeFromPathAndQuery(candidate.route, candidate.options, 'login'),
  )
}

function randomNonce(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.()
  if (randomUuid) return randomUuid.replace(/-/g, '')
  const random = Math.random().toString(36).slice(2)
  return `${Date.now().toString(36)}${random}${random}`.slice(0, 32)
}

export function stageWelcomeReturnIntent(
  route: ReturnRouteDescriptor,
  options: { nonce?: string } = {},
): string | null {
  const canonical = canonicalReturnRoute(route)
  const reparsed = parseReturnRoute(canonical, 'welcome')
  const nonce = options.nonce || randomNonce()
  if (!reparsed || !NONCE_RE.test(nonce)) return null
  pendingWelcomeReturnIntent = { nonce, route: reparsed }
  return nonce
}

export function consumeWelcomeReturnIntent(nonce: unknown): string | null {
  const pending = pendingWelcomeReturnIntent
  pendingWelcomeReturnIntent = null
  if (!pending || typeof nonce !== 'string' || pending.nonce !== nonce) return null
  return canonicalReturnRoute(pending.route)
}

function sessionStorageApi(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage
      ? window.sessionStorage
      : null
  } catch {
    return null
  }
}

function persistLoginRecord(record: LoginReturnRecord | null): void {
  pendingLoginReturnIntent = record
  const storage = sessionStorageApi()
  if (!storage) return
  try {
    if (record) storage.setItem(LOGIN_SESSION_KEY, JSON.stringify(record))
    else storage.removeItem(LOGIN_SESSION_KEY)
  } catch {
    // Runtime state still covers email/password and mini-program auth.
  }
}

function validLoginRecord(value: unknown, now: number): value is LoginReturnRecord {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<LoginReturnRecord>
  if (
    row.version !== 1
    || typeof row.nonce !== 'string'
    || !NONCE_RE.test(row.nonce)
    || !parseStoredRouteDescriptor(row.route, 'login')
    || typeof row.createdAt !== 'number'
    || !Number.isFinite(row.createdAt)
    || now < row.createdAt
    || now - row.createdAt > MAX_LOGIN_INTENT_AGE_MS
    || typeof row.originIdentityGeneration !== 'number'
    || !Number.isInteger(row.originIdentityGeneration)
    || (row.state !== 'staged' && row.state !== 'authorized')
  ) return false
  if (row.state === 'authorized') {
    return typeof row.authorizedUserId === 'string'
      && UUID_RE.test(row.authorizedUserId)
      && typeof row.authorizedIdentityGeneration === 'number'
      && Number.isInteger(row.authorizedIdentityGeneration)
  }
  return row.authorizedUserId === undefined && row.authorizedIdentityGeneration === undefined
}

function loadLoginRecord(now: number): LoginReturnRecord | null {
  if (validLoginRecord(pendingLoginReturnIntent, now)) return pendingLoginReturnIntent
  const storage = sessionStorageApi()
  if (!storage) {
    pendingLoginReturnIntent = null
    return null
  }
  try {
    const parsed: unknown = JSON.parse(storage.getItem(LOGIN_SESSION_KEY) || 'null')
    if (validLoginRecord(parsed, now)) {
      pendingLoginReturnIntent = parsed
      return parsed
    }
  } catch {}
  persistLoginRecord(null)
  return null
}

export function stageLoginReturnIntent(
  rawTarget: unknown,
  owner: NavigationIntentOwner,
  options: StageOptions = {},
): string | null {
  const clean = cleanOwner(owner)
  // Return intent is minted only from an authoritative anonymous action.
  if (clean.userId !== null || clean.identityGeneration < 0) return null
  const route = parseReturnRoute(rawTarget, 'login')
  const nonce = options.nonce || randomNonce()
  const now = options.now ?? Date.now()
  if (!route || !NONCE_RE.test(nonce) || !Number.isFinite(now)) return null
  persistLoginRecord({
    version: 1,
    nonce,
    route,
    createdAt: now,
    originIdentityGeneration: clean.identityGeneration,
    state: 'staged',
  })
  return nonce
}

export function buildLoginRoute(nonce: unknown): string {
  return typeof nonce === 'string' && NONCE_RE.test(nonce)
    ? `/pages/login/index?intent=${encodeURIComponent(nonce)}`
    : '/pages/login/index'
}

export function readLoginIntentNonce(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let value = raw
  try { value = decodeURIComponent(raw) } catch { return null }
  return NONCE_RE.test(value) ? value : null
}

export function authorizeLoginReturnIntent(
  rawNonce: unknown,
  authenticatedOwner: NavigationIntentOwner,
  options: TimedOptions = {},
): boolean {
  const nonce = readLoginIntentNonce(rawNonce)
  const owner = cleanOwner(authenticatedOwner)
  const now = options.now ?? Date.now()
  const record = loadLoginRecord(now)
  if (
    !nonce
    || !record
    || record.nonce !== nonce
    || record.state !== 'staged'
    || !owner.userId
    || !UUID_RE.test(owner.userId)
    || owner.identityGeneration < 0
  ) return false
  persistLoginRecord({
    ...record,
    state: 'authorized',
    authorizedUserId: owner.userId.toLowerCase(),
    authorizedIdentityGeneration: owner.identityGeneration,
  })
  return true
}

function authorizedTarget(
  rawNonce: unknown,
  ownerInput: NavigationIntentOwner,
  options: TimedOptions,
): string | null {
  const nonce = readLoginIntentNonce(rawNonce)
  const owner = cleanOwner(ownerInput)
  const record = loadLoginRecord(options.now ?? Date.now())
  if (!nonce || !record || record.nonce !== nonce || record.state !== 'authorized') return null
  if (
    record.authorizedUserId !== owner.userId?.toLowerCase()
    || record.authorizedIdentityGeneration !== owner.identityGeneration
  ) {
    // Identity mismatch is authoritative revocation, not a temporary miss.
    // Otherwise A -> B -> A could revive A's old target during the TTL.
    persistLoginRecord(null)
    return null
  }
  return canonicalReturnRoute(parseStoredRouteDescriptor(record.route, 'login'))
}

export function peekAuthorizedLoginReturnIntent(
  rawNonce: unknown,
  owner: NavigationIntentOwner,
  options: TimedOptions = {},
): string | null {
  return authorizedTarget(rawNonce, owner, options)
}

export function consumeAuthorizedLoginReturnIntent(
  rawNonce: unknown,
  owner: NavigationIntentOwner,
  options: TimedOptions = {},
): string | null {
  const target = authorizedTarget(rawNonce, owner, options)
  if (target) persistLoginRecord(null)
  return target
}

export function peekActiveAuthorizedLoginReturnIntent(
  owner: NavigationIntentOwner,
  options: TimedOptions = {},
): string | null {
  const record = loadLoginRecord(options.now ?? Date.now())
  if (!record) return null
  return authorizedTarget(record.nonce, owner, options)
}

export function consumeActiveAuthorizedLoginReturnIntent(
  owner: NavigationIntentOwner,
  options: TimedOptions = {},
): string | null {
  const record = loadLoginRecord(options.now ?? Date.now())
  if (!record) return null
  return consumeAuthorizedLoginReturnIntent(record.nonce, owner, options)
}

export function clearLoginReturnIntent(): void {
  persistLoginRecord(null)
}
