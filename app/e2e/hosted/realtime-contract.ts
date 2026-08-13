import { createHash } from 'node:crypto'
import {
  accessSync,
  constants as fsConstants,
  realpathSync,
  statSync,
} from 'node:fs'
import { isIP } from 'node:net'
import { isAbsolute, resolve } from 'node:path'

export type HostedActorRole = 'member-a' | 'member-b' | 'member-c'

export interface ApprovedHostedRealtimeTarget {
  readonly projectRef: string
  readonly datasetLineage: string
  readonly appOrigin: string
  readonly commit: string
  readonly entryDocumentSha256: string
  readonly appAssets: readonly HostedAssetDigest[]
  readonly environmentSentinelId: string
  readonly fixtureRevision: number
  readonly fixtureManifestSha256: string
  readonly providerDisableProofSha256: string
  readonly providerProofExpiresAt: string
}

export interface HostedAssetDigest {
  readonly path: string
  readonly sha256: string
}

export interface HostedRealtimeAccount {
  readonly role: HostedActorRole
  readonly email: string
  readonly password: string
  readonly expectedUserId: string
}

export interface HostedRealtimeContract {
  readonly protocolRevision: 2
  readonly runId: string
  readonly appOrigin: string
  readonly supabaseOrigin: string
  readonly projectRef: string
  readonly commit: string
  readonly datasetLineage: string
  readonly entryDocumentSha256: string
  readonly appAssets: readonly HostedAssetDigest[]
  readonly environmentSentinelId: string
  readonly fixtureRevision: number
  readonly fixtureManifestSha256: string
  readonly providerDisableProofSha256: string
  readonly providerProofExpiresAt: string
  readonly publishableKey: string
  readonly accounts: readonly HostedRealtimeAccount[]
  readonly conversations: Readonly<{ ab: string; ac: string }>
}

export interface HostedDeploymentManifest {
  readonly schema: 1
  readonly environment: 'preview'
  readonly deployable: true
  readonly projectRef: string
  readonly appOrigin: string
  readonly release: string
  readonly commit: string
}

export interface HostedEnvironmentSentinel {
  readonly protocol_revision: 2
  readonly sentinel_id: string
  readonly project_ref: string
  readonly dataset_lineage: string
  readonly fixture_revision: number
  readonly fixture_manifest_sha256: string
  readonly provider_disable_proof_sha256: string
  readonly provider_proof_expires_at: string
  readonly lifecycle_state: 'ready' | 'cleaned'
  readonly synthetic_only: true
  readonly disposable: true
  readonly provider_side_effects_disabled: true
  readonly write_cleanup_supported: true
  readonly residue_count: 0
  readonly expires_at: string
}

type Env = Record<string, string | undefined>

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROJECT_REF_RE = /^[a-z0-9]{20}$/
const COMMIT_RE = /^[0-9a-f]{40}$/
const LINEAGE_RE = /^[a-z0-9][a-z0-9._-]{7,79}$/
const CONFIRMATION = 'WRITE DISPOSABLE SYNTHETIC STAGING DATA'
const MAX_MANIFEST_BYTES = 4096
const MAX_ENTRY_DOCUMENT_BYTES = 256 * 1024
export const MAX_HOSTED_ASSET_BYTES = 8 * 1024 * 1024
const MAX_HOSTED_ASSET_COUNT = 256
const MIN_SENTINEL_LIFETIME_MS = 60 * 60 * 1000
const MAX_SENTINEL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
const MIN_PROVIDER_PROOF_LIFETIME_MS = 60 * 60 * 1000
const MAX_PROVIDER_PROOF_LIFETIME_MS = 24 * 60 * 60 * 1000
// PostgreSQL text cannot contain NUL. ASCII Unit Separator (0x1f) is safe in
// PostgreSQL text and makes the fixture manifest unambiguous without JSON
// serialization differences. Keep this field order in sync with ACTIVATE.sql:
// version, project ref, lineage, sentinel, revision, A/B/C role+UUID, AB/AC UUID.
const FIXTURE_MANIFEST_SEPARATOR = '\x1f'
const FIXTURE_MANIFEST_VERSION = 'caaci-hosted-fixture-v1'

// Public identifiers, not credentials. These two independent denies remain
// effective even if an operator makes every expected value self-consistent.
const KNOWN_PRODUCTION_PROJECT_REFS = new Set(['lfhvgprfphyfvhidegum'])
const KNOWN_PRODUCTION_APP_HOST = 'illinimarket.com'

const FORBIDDEN_ENV_KEYS = [
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'ADMIN_TOKEN',
  'OPENAI_API_KEY',
  'RESEND_API_KEY',
  'SENTRY_AUTH_TOKEN',
  'WECHAT_APPSECRET',
  'VERCEL_TOKEN',
  'GITHUB_TOKEN',
  'PWDEBUG',
  'DEBUG',
  'ACTIONS_STEP_DEBUG',
  'RUNNER_DEBUG',
] as const
const AUTOMATION_ENV_KEYS = [
  'BITBUCKET_BUILD_NUMBER',
  'BUILDKITE',
  'CIRCLECI',
  'CI',
  'CODEBUILD_BUILD_ID',
  'DRONE',
  'GITHUB_ACTIONS',
  'GITHUB_JOB',
  'GITHUB_RUN_ID',
  'GITHUB_WORKFLOW',
  'GITLAB_CI',
  'JENKINS_URL',
  'NETLIFY',
  'RENDER',
  'TEAMCITY_VERSION',
  'TF_BUILD',
  'TRAVIS',
  'VERCEL',
] as const
const AUTOMATION_ENV_PREFIXES = [
  'BUILDKITE_',
  'CIRCLE_',
  'CI_',
  'GITHUB_RUNNER_',
  'GITLAB_',
  'JENKINS_',
  'RUNNER_',
  'TEAMCITY_',
] as const

function contractFailure(reason: string): never {
  throw new Error(`hosted_realtime_contract_invalid: ${reason}`)
}

function manifestFailure(reason: string): never {
  throw new Error(`hosted_realtime_manifest_invalid: ${reason}`)
}

function exactValue(env: Env, key: string): string {
  const value = env[key]
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    contractFailure(`missing ${key}`)
  }
  return value
}

function exactTrue(env: Env, key: string): void {
  if (env[key] !== 'true') contractFailure(`gate ${key}`)
}

export function hostedCanaryAutomationEnvDetected(env: Env): boolean {
  return (
    AUTOMATION_ENV_KEYS.some(key => Boolean(env[key]))
    || Object.entries(env).some(([key, value]) => (
      Boolean(value)
      && AUTOMATION_ENV_PREFIXES.some(prefix => key.startsWith(prefix))
    ))
  )
}

export function assertHostedBrowserExecutable(
  value: string | undefined,
): string {
  if (
    typeof value !== 'string'
    || !value
    || value !== value.trim()
    || value.length > 4096
    || /[\u0000-\u001f\u007f]/.test(value)
    || !isAbsolute(value)
    || resolve(value) !== value
  ) contractFailure('browser executable')

  try {
    if (
      realpathSync(value) !== value
      || !statSync(value).isFile()
    ) contractFailure('browser executable')
    accessSync(value, fsConstants.X_OK)
  } catch {
    contractFailure('browser executable')
  }
  return value
}

function exactUuid(env: Env, key: string): string {
  const value = exactValue(env, key).toLowerCase()
  if (!UUID_RE.test(value)) contractFailure(`identity ${key}`)
  return value
}

function publicKeyIsAllowed(value: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9._-]{8,}$/.test(value)) return true
  if (/^sb_secret_/i.test(value)) return false

  const parts = value.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return payload?.role === 'anon'
  } catch {
    return false
  }
}

function exactEmail(env: Env, key: string): string {
  const value = exactValue(env, key)
  if (
    value.length > 320
    || /\s/.test(value)
    || !/^[^@]+@[^@]+\.[^@]+$/.test(value)
  ) contractFailure(`account ${key}`)
  return value
}

function exactPassword(env: Env, key: string): string {
  const value = exactValue(env, key)
  if (
    value.length < 16
    || value.length > 1024
    || /[\u0000-\u001f\u007f]/.test(value)
  ) contractFailure(`account ${key}`)
  return value
}

function normalizeApprovedTarget(
  value: ApprovedHostedRealtimeTarget,
): ApprovedHostedRealtimeTarget | null {
  const projectRef = String(value?.projectRef || '').trim().toLowerCase()
  const datasetLineage = String(value?.datasetLineage || '').trim().toLowerCase()
  const appOrigin = strictPreviewOrigin(String(value?.appOrigin || ''))
  const commit = String(value?.commit || '').trim().toLowerCase()
  const entryDocumentSha256 =
    String(value?.entryDocumentSha256 || '').trim().toLowerCase()
  const rawAssets = value?.appAssets
  const appAssets = Array.isArray(rawAssets)
    ? rawAssets.map(asset => Object.freeze({
      path: String(asset?.path || ''),
      sha256: String(asset?.sha256 || '').trim().toLowerCase(),
    }))
    : []
  const environmentSentinelId =
    String(value?.environmentSentinelId || '').trim().toLowerCase()
  const fixtureRevision = Number(value?.fixtureRevision)
  const fixtureManifestSha256 =
    String(value?.fixtureManifestSha256 || '').trim().toLowerCase()
  const providerDisableProofSha256 =
    String(value?.providerDisableProofSha256 || '').trim().toLowerCase()
  const providerProofExpiresAt =
    String(value?.providerProofExpiresAt || '').trim()
  const providerProofExpiresAtMs = Date.parse(providerProofExpiresAt)
  if (
    !PROJECT_REF_RE.test(projectRef)
    || !LINEAGE_RE.test(datasetLineage)
    || !appOrigin
    || !COMMIT_RE.test(commit)
    || !/^[0-9a-f]{64}$/.test(entryDocumentSha256)
    || appAssets.length < 1
    || appAssets.length > MAX_HOSTED_ASSET_COUNT
    || appAssets.some(asset => (
      !/^\/(?:assets|static)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/
        .test(asset.path)
      || asset.path.includes('..')
      || asset.path.includes('//')
      || asset.path.includes('%')
      || /(?:bearer|password|token|secret)/i.test(asset.path)
      || !/^[0-9a-f]{64}$/.test(asset.sha256)
    ))
    || new Set(appAssets.map(asset => asset.path)).size !== appAssets.length
    || !UUID_RE.test(environmentSentinelId)
    || !Number.isSafeInteger(fixtureRevision)
    || fixtureRevision < 1
    || !/^[0-9a-f]{64}$/.test(fixtureManifestSha256)
    || !/^[0-9a-f]{64}$/.test(providerDisableProofSha256)
    || !Number.isFinite(providerProofExpiresAtMs)
    || new Date(providerProofExpiresAtMs).toISOString()
      !== providerProofExpiresAt
  ) return null
  return Object.freeze({
    projectRef,
    datasetLineage,
    appOrigin,
    commit,
    entryDocumentSha256,
    appAssets: Object.freeze(appAssets),
    environmentSentinelId,
    fixtureRevision,
    fixtureManifestSha256,
    providerDisableProofSha256,
    providerProofExpiresAt,
  })
}

function strictPreviewOrigin(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:'
    || raw !== url.origin
    || url.username
    || url.password
    || url.port
    || url.pathname !== '/'
    || url.search
    || url.hash
    || hostname.includes('xn--')
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || isIP(hostname.replace(/^\[|\]$/g, '')) !== 0
    || hostname === KNOWN_PRODUCTION_APP_HOST
    || hostname.endsWith(`.${KNOWN_PRODUCTION_APP_HOST}`)
    || !hostname.endsWith('.vercel.app')
    || hostname === 'vercel.app'
  ) return null

  return url.origin
}

function accountFromEnv(
  env: Env,
  prefix: 'A' | 'B' | 'C',
  role: HostedActorRole,
): HostedRealtimeAccount {
  return Object.freeze({
    role,
    email: exactEmail(env, `CAACI_HOSTED_CANARY_${prefix}_EMAIL`),
    password: exactPassword(env, `CAACI_HOSTED_CANARY_${prefix}_PASSWORD`),
    expectedUserId: exactUuid(env, `CAACI_HOSTED_CANARY_${prefix}_USER_ID`),
  })
}

/**
 * Pure, zero-network preflight. The caller must pass the source-controlled
 * allowlist; environment variables can select but cannot invent a target.
 */
export function loadHostedRealtimeContract(
  env: Env,
  approvedTargets: readonly ApprovedHostedRealtimeTarget[],
): HostedRealtimeContract {
  if (hostedCanaryAutomationEnvDetected(env)) {
    contractFailure('manual execution only')
  }
  for (const key of FORBIDDEN_ENV_KEYS) {
    if (env[key]) contractFailure('privileged or debug environment')
  }

  if (env.CAACI_HOSTED_CANARY_MODE !== 'realtime-staging') {
    contractFailure('mode')
  }
  if (env.CAACI_HOSTED_CANARY_LAUNCHER !== 'v2') {
    contractFailure('safe launcher')
  }
  if (env.CAACI_HOSTED_CANARY_CONFIRM !== CONFIRMATION) {
    contractFailure('confirmation')
  }
  exactTrue(env, 'CAACI_HOSTED_CANARY_WRITE_ENABLED')
  exactTrue(env, 'CAACI_HOSTED_CANARY_TARGET_IS_STAGING')
  exactTrue(env, 'CAACI_HOSTED_CANARY_ACCOUNTS_ARE_SYNTHETIC')
  exactTrue(env, 'CAACI_HOSTED_CANARY_DATASET_IS_DISPOSABLE')
  const runId = exactUuid(env, 'CAACI_HOSTED_CANARY_RUN_ID')

  const projectRef = exactValue(env, 'CAACI_HOSTED_CANARY_PROJECT_REF').toLowerCase()
  if (
    !PROJECT_REF_RE.test(projectRef)
    || KNOWN_PRODUCTION_PROJECT_REFS.has(projectRef)
  ) contractFailure('project ref')

  const datasetLineage =
    exactValue(env, 'CAACI_HOSTED_CANARY_DATASET_LINEAGE').toLowerCase()
  if (!LINEAGE_RE.test(datasetLineage)) contractFailure('dataset lineage')

  const normalizedTargets = approvedTargets
    .map(normalizeApprovedTarget)
    .filter((target): target is ApprovedHostedRealtimeTarget => target !== null)
  const target = normalizedTargets.find(candidate => (
    candidate.projectRef === projectRef
    && candidate.datasetLineage === datasetLineage
  ))
  if (!target) contractFailure('target is not source-controlled')

  const appOrigin = strictPreviewOrigin(
    exactValue(env, 'CAACI_HOSTED_CANARY_APP_ORIGIN'),
  )
  if (!appOrigin || appOrigin !== target.appOrigin) {
    contractFailure('app origin')
  }
  const commit = exactValue(env, 'CAACI_HOSTED_CANARY_COMMIT_SHA').toLowerCase()
  if (!COMMIT_RE.test(commit) || commit !== target.commit) {
    contractFailure('commit')
  }

  const publishableKey = exactValue(env, 'CAACI_HOSTED_CANARY_PUBLISHABLE_KEY')
  if (!publicKeyIsAllowed(publishableKey)) contractFailure('publishable key')

  const accounts = Object.freeze([
    accountFromEnv(env, 'A', 'member-a'),
    accountFromEnv(env, 'B', 'member-b'),
    accountFromEnv(env, 'C', 'member-c'),
  ])
  const conversations = Object.freeze({
    ab: exactUuid(env, 'CAACI_HOSTED_CANARY_AB_CONVERSATION_ID'),
    ac: exactUuid(env, 'CAACI_HOSTED_CANARY_AC_CONVERSATION_ID'),
  })

  const identities = accounts.map(account => account.expectedUserId)
  const emails = accounts.map(account => account.email.toLowerCase())
  const allIds = [...identities, conversations.ab, conversations.ac]
  if (
    new Set(identities).size !== identities.length
    || new Set(emails).size !== emails.length
    || new Set(allIds).size !== allIds.length
  ) contractFailure('actors and conversations must be distinct')

  const fixtureManifestSha256 = createHash('sha256')
    .update([
      FIXTURE_MANIFEST_VERSION,
      projectRef,
      datasetLineage,
      target.environmentSentinelId,
      String(target.fixtureRevision),
      accounts[0].role,
      accounts[0].expectedUserId,
      accounts[1].role,
      accounts[1].expectedUserId,
      accounts[2].role,
      accounts[2].expectedUserId,
      'ab',
      conversations.ab,
      'ac',
      conversations.ac,
    ].join(FIXTURE_MANIFEST_SEPARATOR), 'utf8')
    .digest('hex')
  if (fixtureManifestSha256 !== target.fixtureManifestSha256) {
    contractFailure('fixture manifest')
  }

  return Object.freeze({
    protocolRevision: 2,
    runId,
    appOrigin,
    supabaseOrigin: `https://${projectRef}.supabase.co`,
    projectRef,
    commit,
    datasetLineage,
    entryDocumentSha256: target.entryDocumentSha256,
    appAssets: target.appAssets,
    environmentSentinelId: target.environmentSentinelId,
    fixtureRevision: target.fixtureRevision,
    fixtureManifestSha256,
    providerDisableProofSha256: target.providerDisableProofSha256,
    providerProofExpiresAt: target.providerProofExpiresAt,
    publishableKey,
    accounts,
    conversations,
  })
}

/**
 * A source-controlled target is necessary but not sufficient. Before browser
 * credentials are ever entered into the Preview, an ordinary canary user must
 * read this server-owned staging sentinel. It proves that the selected project
 * is synthetic-only, has external providers disabled, supports exact cleanup,
 * and starts with no residue from a previous run.
 */
export function assertHostedEnvironmentSentinel(
  contract: HostedRealtimeContract,
  value: unknown,
  expectedLifecycleState: 'ready' | 'cleaned',
  nowMs = Date.now(),
): HostedEnvironmentSentinel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return contractFailure('environment sentinel shape')
  }
  const candidate = value as Record<string, unknown>
  const expectedKeys = [
    'dataset_lineage',
    'disposable',
    'expires_at',
    'fixture_manifest_sha256',
    'fixture_revision',
    'lifecycle_state',
    'project_ref',
    'protocol_revision',
    'provider_disable_proof_sha256',
    'provider_proof_expires_at',
    'provider_side_effects_disabled',
    'residue_count',
    'sentinel_id',
    'synthetic_only',
    'write_cleanup_supported',
  ]
  const expiresAt = String(candidate.expires_at || '')
  const expiresAtMs = Date.parse(expiresAt)
  const providerProofExpiresAt =
    String(candidate.provider_proof_expires_at || '')
  const providerProofExpiresAtMs = Date.parse(providerProofExpiresAt)
  if (
    Object.keys(candidate).sort().join('\0') !== expectedKeys.join('\0')
    || String(candidate.sentinel_id || '').toLowerCase()
      !== contract.environmentSentinelId
    || String(candidate.project_ref || '').toLowerCase() !== contract.projectRef
    || candidate.protocol_revision !== contract.protocolRevision
    || String(candidate.dataset_lineage || '').toLowerCase()
      !== contract.datasetLineage
    || candidate.fixture_revision !== contract.fixtureRevision
    || candidate.fixture_manifest_sha256 !== contract.fixtureManifestSha256
    || candidate.provider_disable_proof_sha256
      !== contract.providerDisableProofSha256
    || providerProofExpiresAt !== contract.providerProofExpiresAt
    || candidate.lifecycle_state !== expectedLifecycleState
    || candidate.synthetic_only !== true
    || candidate.disposable !== true
    || candidate.provider_side_effects_disabled !== true
    || candidate.write_cleanup_supported !== true
    || candidate.residue_count !== 0
    || !Number.isFinite(expiresAtMs)
    || expiresAtMs < nowMs + MIN_SENTINEL_LIFETIME_MS
    || expiresAtMs > nowMs + MAX_SENTINEL_LIFETIME_MS
    || !Number.isFinite(providerProofExpiresAtMs)
    || providerProofExpiresAtMs
      < nowMs + MIN_PROVIDER_PROOF_LIFETIME_MS
    || providerProofExpiresAtMs
      > nowMs + MAX_PROVIDER_PROOF_LIFETIME_MS
  ) contractFailure('environment sentinel mismatch')

  return Object.freeze({
    protocol_revision: 2,
    sentinel_id: contract.environmentSentinelId,
    project_ref: contract.projectRef,
    dataset_lineage: contract.datasetLineage,
    fixture_revision: contract.fixtureRevision,
    fixture_manifest_sha256: contract.fixtureManifestSha256,
    provider_disable_proof_sha256: contract.providerDisableProofSha256,
    provider_proof_expires_at: contract.providerProofExpiresAt,
    lifecycle_state: expectedLifecycleState,
    synthetic_only: true,
    disposable: true,
    provider_side_effects_disabled: true,
    write_cleanup_supported: true,
    residue_count: 0,
    expires_at: expiresAt,
  })
}

/**
 * Auth `app_metadata` is admin/server-owned; `user_metadata` is deliberately
 * ignored because the user can edit it. Return one boolean so reporter errors
 * never reveal the actual UUID or metadata values.
 */
export function hostedActorMetadataMatches(
  user: unknown,
  actor: HostedRealtimeAccount,
  contract: HostedRealtimeContract,
): boolean {
  if (!user || typeof user !== 'object') return false
  const candidate = user as {
    id?: unknown
    app_metadata?: unknown
  }
  const metadata = candidate.app_metadata
  if (!metadata || typeof metadata !== 'object') return false
  const appMetadata = metadata as Record<string, unknown>
  return (
    String(candidate.id || '').toLowerCase() === actor.expectedUserId
    && appMetadata.caaci_hosted_canary === true
    && appMetadata.caaci_dataset_lineage === contract.datasetLineage
    && appMetadata.caaci_canary_role === actor.role
  )
}

export function assertHostedDeploymentManifest(
  contract: HostedRealtimeContract,
  value: unknown,
): HostedDeploymentManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return manifestFailure('shape')
  }
  const manifest = value as Record<string, unknown>
  if (
    manifest.schema !== 1
    || manifest.environment !== 'preview'
    || manifest.deployable !== true
    || manifest.projectRef !== contract.projectRef
    || manifest.appOrigin !== contract.appOrigin
    || manifest.release !== contract.commit.slice(0, 7)
    || manifest.commit !== contract.commit
  ) manifestFailure('identity mismatch')

  return Object.freeze({
    schema: 1,
    environment: 'preview',
    deployable: true,
    projectRef: contract.projectRef,
    appOrigin: contract.appOrigin,
    release: contract.commit.slice(0, 7),
    commit: contract.commit,
  })
}

/**
 * This is the first and only allowed remote request before actor login. It
 * sends no cookies, referrer, account value, project key or authorization.
 */
export async function fetchAndVerifyHostedDeploymentManifest(
  contract: HostedRealtimeContract,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<HostedDeploymentManifest> {
  const manifestUrl = `${contract.appOrigin}/deployment-manifest.json`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await fetchImpl(manifestUrl, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok || response.url !== manifestUrl) {
      return manifestFailure('fetch response')
    }
    const contentType = response.headers.get('content-type') || ''
    const contentLength = Number(response.headers.get('content-length') || '0')
    if (
      !/^application\/json(?:;|$)/i.test(contentType)
      || !Number.isFinite(contentLength)
      || contentLength < 0
      || contentLength > MAX_MANIFEST_BYTES
    ) manifestFailure('response boundary')

    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) {
      return manifestFailure('response boundary')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return manifestFailure('json')
    }
    return assertHostedDeploymentManifest(contract, parsed)
  } catch {
    return manifestFailure('fetch')
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * The manifest is served by the application under test and cannot establish
 * its own identity. Bind the exact immutable Preview to a source-reviewed
 * index document hash before any account credential is used.
 */
export async function fetchAndVerifyHostedEntryDocument(
  contract: HostedRealtimeContract,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await fetchImpl(`${contract.appOrigin}/`, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: { accept: 'text/html' },
      signal: controller.signal,
    })
    const contentType = response.headers.get('content-type') || ''
    const contentLength = Number(response.headers.get('content-length') || '0')
    if (
      !response.ok
      || response.url !== `${contract.appOrigin}/`
      || !/^text\/html(?:;|$)/i.test(contentType)
      || !Number.isFinite(contentLength)
      || contentLength < 0
      || contentLength > MAX_ENTRY_DOCUMENT_BYTES
    ) return manifestFailure('entry response')
    const body = await response.arrayBuffer()
    if (body.byteLength > MAX_ENTRY_DOCUMENT_BYTES) {
      return manifestFailure('entry response')
    }
    const digest = createHash('sha256')
      .update(Buffer.from(body))
      .digest('hex')
    if (digest !== contract.entryDocumentSha256) {
      return manifestFailure('entry identity')
    }
  } catch {
    return manifestFailure('entry fetch')
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Pin the complete same-origin JS/CSS/static graph before any credentials are
 * used. The browser boundary later permits only these exact paths and hashes
 * every path again on first use, closing mutable-alias and lazy-chunk gaps.
 */
export async function fetchAndVerifyHostedAssets(
  contract: HostedRealtimeContract,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  for (const asset of contract.appAssets) {
    const assetUrl = `${contract.appOrigin}${asset.path}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetchImpl(assetUrl, {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        headers: { accept: '*/*' },
        signal: controller.signal,
      })
      const contentType = response.headers.get('content-type') || ''
      const contentLength = Number(
        response.headers.get('content-length') || '0',
      )
      if (
        !response.ok
        || response.url !== assetUrl
        || /^text\/html(?:;|$)/i.test(contentType)
        || !Number.isFinite(contentLength)
        || contentLength < 0
        || contentLength > MAX_HOSTED_ASSET_BYTES
      ) return manifestFailure('asset response')
      const body = await response.arrayBuffer()
      if (body.byteLength > MAX_HOSTED_ASSET_BYTES) {
        return manifestFailure('asset response')
      }
      const digest = createHash('sha256')
        .update(Buffer.from(body))
        .digest('hex')
      if (digest !== asset.sha256) return manifestFailure('asset identity')
    } catch {
      return manifestFailure('asset fetch')
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function hostedDeploymentManifestProof(
  contract: HostedRealtimeContract,
): string {
  return createHash('sha256')
    .update([
      'caaci-hosted-realtime-v2',
      contract.appOrigin,
      contract.projectRef,
      contract.commit,
      contract.datasetLineage,
      contract.entryDocumentSha256,
      ...contract.appAssets.flatMap(asset => [asset.path, asset.sha256]),
    ].join('\0'))
    .digest('hex')
}

export function assertHostedDeploymentManifestProof(
  contract: HostedRealtimeContract,
  env: Env,
): void {
  if (
    env.CAACI_HOSTED_CANARY_MANIFEST_PROOF
    !== hostedDeploymentManifestProof(contract)
  ) contractFailure('deployment manifest was not verified')
}
