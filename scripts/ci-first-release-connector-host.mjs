// Host-assisted ordinary release primitives, not another automatic CI gate.
// The trusted host reviews CI, history, candidate identity and serialization.
// Local receipts are audit records, not authenticated proof of that review.
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { RELEASE_PROJECT } from './check-ci-first-release.mjs'
import { createReleaseStore } from './run-ci-first-release.mjs'
import { createBrowserIdentityReader } from './ci-first-release-browser-identity.mjs'
import { createConnectorPromotionTransport } from './ci-first-release-connector-transport.mjs'

const INTENT = 'promote-intent.json'
const VERIFIED = 'verified.json'
const DOMAINS = ['illinimarket.com', 'www.illinimarket.com']
const WWW = 'https://www.illinimarket.com'
const ID = /^dpl_[A-Za-z0-9]{1,128}$/
const SHA = /^[0-9a-f]{40}$/
const positive = value => Number.isSafeInteger(value) && value > 0
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fields = ['projectId', 'teamId', 'repositoryId', 'requestedSha', 'runId', 'runAttempt', 'deploymentId', 'previousDeploymentId']
class HostError extends Error {
  constructor(code) { super(`release_connector_host_${code}`); this.code = this.message }
}
function check(condition, code) { if (!condition) throw new HostError(code) }
function scopeOf(raw) {
  check(object(raw) && raw.projectId === RELEASE_PROJECT && typeof raw.teamId === 'string'
    && /^team_[A-Za-z0-9]{1,128}$/.test(raw.teamId) && typeof raw.requestedSha === 'string'
    && positive(raw.repositoryId) && SHA.test(raw.requestedSha) && positive(raw.runId) && positive(raw.runAttempt)
    && typeof raw.deploymentId === 'string' && typeof raw.previousDeploymentId === 'string'
    && ID.test(raw.deploymentId) && ID.test(raw.previousDeploymentId)
    && raw.deploymentId !== raw.previousDeploymentId, 'invalid_scope')
  return Object.freeze(Object.fromEntries(fields.map(key => [key, raw[key]])))
}
function sameScope(a, b) {
  const checked = scopeOf(a)
  check(fields.every(key => checked[key] === b[key]), 'scope_changed')
}
function reviewOf(review, scope, now, maxAgeMs) {
  check(object(review), 'review_required')
  sameScope(review.scope, scope)
  check(positive(review.observedAt) && review.observedAt <= now && now - review.observedAt <= maxAgeMs
    && typeof review.evidenceRef === 'string' && review.evidenceRef.length > 0
    && review.evidenceRef.length <= 1024 && !/[\r\n\x00]/.test(review.evidenceRef), 'stale_or_invalid_review')
  check(Array.isArray(review.aliases) && review.aliases.length === 2, 'alias_review_invalid')
  const ids = DOMAINS.map(alias => {
    const matches = review.aliases.filter(item => item?.alias === alias)
    check(matches.length === 1 && matches[0].projectId === scope.projectId
      && [scope.previousDeploymentId, scope.deploymentId].includes(matches[0].deploymentId), 'alias_conflict')
    return matches[0].deploymentId
  })
  return { observedAt: review.observedAt, evidenceRef: review.evidenceRef, ids }
}
function intentOf(value, scope) {
  check(value?.schema === 1 && value.kind === 'supervised-connector'
    && ['invoke_once', 'observe_existing_transition'].includes(value.action)
    && positive(value.recordedAt), 'invalid_intent')
  sameScope(value.scope, scope)
  return value
}
function outcome(status, extra = {}) {
  return { status, singleToolInvocationProtocol: true, singleHttpAttempt: false,
    internalHttpAttempts: 'unknown', claimsAtomicCronHandoff: false, ...extra }
}

// A reservation emits tool arguments ONCE, after fsync of intent. The host calls
// the connector at most once with them, without retries/fallback. If it crashes
// before calling, recovery is still read-only: absence of a result is ambiguous.
// No provider mutation is performed by this function, even with execute:true.
export function reserveConnectorInvocation({ store, scope: raw, review, execute = false,
  now = Date.now, maxAgeMs = 300_000 } = {}) {
  let unlock, preserve = false
  try {
    check(typeof execute === 'boolean' && typeof now === 'function'
      && positive(maxAgeMs) && maxAgeMs <= 300_000, 'invalid_options')
    const scope = scopeOf(raw)
    // Recovery can inspect an existing intent even if a crash left the lock.
    if (store.has(INTENT)) {
      intentOf(store.read(INTENT), scope)
      return outcome('reconcile_only', { scope, readOnly: true, reason: 'durable_intent_exists' })
    }
    unlock = store.lock()
    if (store.has(INTENT)) {
      intentOf(store.read(INTENT), scope)
      return outcome('reconcile_only', { scope, readOnly: true, reason: 'durable_intent_exists' })
    }
    check(!['preparation.json', 'candidate.json', VERIFIED].some(name => store.has(name)), 'different_release_state')
    const checkedAt = now()
    check(positive(checkedAt), 'invalid_clock')
    const reviewed = reviewOf(review, scope, checkedAt, maxAgeMs)
    const transitioning = reviewed.ids.includes(scope.deploymentId)
    if (!execute && !transitioning) return outcome('ready_read_only', { scope, authorizesRelease: false })
    const intent = { schema: 1, kind: 'supervised-connector', scope, recordedAt: checkedAt,
      action: transitioning ? 'observe_existing_transition' : 'invoke_once',
      review: { observedAt: reviewed.observedAt, evidenceRef: reviewed.evidenceRef },
      singleHttpAttempt: false, internalHttpAttempts: 'unknown' }
    preserve = true
    store.write(INTENT, intent)
    preserve = false
    if (transitioning) return outcome('reconcile_only', { scope, readOnly: true, reason: 'alias_already_transitioning' })
    return outcome('reserved', { scope, authorizesRelease: false,
      request: { deploymentId: scope.deploymentId, projectId: scope.projectId, teamId: scope.teamId },
      next: 'Invoke the existing ordinary connector once only if this exact release is separately authorized; then read back.' })
  } catch (error) {
    return outcome('blocked', { reason: error instanceof HostError ? error.code : 'release_connector_host_state_failed',
      requiresReadOnlyReconciliation: true })
  } finally {
    if (unlock) {
      try { unlock({ preserve }) }
      catch { return outcome('blocked', { reason: 'release_connector_host_lock_release_failed', requiresReadOnlyReconciliation: true }) }
    }
  }
}

// The host supplies its actual readback review, not the Promote tool response.
// This never emits a request; unresolved/conflicting outcomes keep the intent.
export function recordConnectorReadback({ store, scope: raw, review, now = Date.now, maxAgeMs = 300_000 } = {}) {
  try {
    check(typeof now === 'function' && positive(maxAgeMs) && maxAgeMs <= 300_000, 'invalid_options')
    const scope = scopeOf(raw)
    const intent = intentOf(store.read(INTENT), scope)
    const at = now()
    check(positive(at), 'invalid_clock')
    const checked = reviewOf(review, scope, at, maxAgeMs)
    check(checked.observedAt >= intent.recordedAt, 'readback_precedes_intent')
    check(['verified', 'unresolved'].includes(review.status), 'invalid_readback_status')
    if (review.status !== 'verified' || !checked.ids.every(id => id === scope.deploymentId)) {
      return outcome('unresolved', { scope, readOnly: true, requiresReadOnlyReconciliation: true })
    }
    // The supplied evidence must include candidate + formal nonce identities
    // and root redirect. The host is responsible for reviewing that evidence;
    // this helper deliberately does not pretend a JSON boolean authenticates it.
    if (!store.has(VERIFIED)) store.write(VERIFIED, { schema: 1, kind: 'supervised-connector', scope,
      recordedAt: at, observedAt: checked.observedAt, evidenceRef: checked.evidenceRef })
    else {
      const existing = store.read(VERIFIED)
      check(existing?.schema === 1 && existing.kind === 'supervised-connector', 'invalid_readback_record')
      sameScope(existing.scope, scope)
    }
    return outcome('verified_by_host_review', { scope, readOnly: true, evidenceRef: checked.evidenceRef })
  } catch (error) {
    return outcome('unresolved', { reason: error instanceof HostError ? error.code : 'release_connector_host_readback_failed',
      readOnly: true, requiresReadOnlyReconciliation: true })
  }
}

// Composes existing authenticated metadata reads and a host screen-confirmation
// callback. It never extracts browser cookies or adds deployment bypasses.
export function createConnectorHostAdapter({ reads, teamId, execute = false, requestPromote,
  captureBrowserIdentity, now = Date.now, browserMaxAgeMs = 60_000 } = {}) {
  const readMethods = ['readSnapshot', 'readCandidates', 'readDeployment', 'readAliases', 'readIdentity', 'readRootRedirect']
  check(object(reads) && readMethods.every(name => typeof reads[name] === 'function'), 'invalid_read_adapter')
  const writer = createConnectorPromotionTransport({ teamId, execute, requestPromote })
  const browsers = new Map()
  const readDeployment = async input => {
    const d = await reads.readDeployment(input)
    check(d?.projectId === RELEASE_PROJECT && d.teamId === teamId && d.id === input?.deploymentId,
      'deployment_scope_mismatch')
    if (d.url !== null && d.url !== undefined) {
      let url
      try { url = new URL(d.url) } catch { throw new HostError('invalid_candidate_origin') }
      check(url.protocol === 'https:' && url.origin === d.url && !url.username && !url.password && !url.port
        && /^[a-z0-9-]+\.vercel\.app$/.test(url.hostname), 'invalid_candidate_origin')
      if (!browsers.has(d.url)) browsers.set(d.url, createBrowserIdentityReader({
        capture: captureBrowserIdentity, allowedOrigins: [d.url], now, maxAgeMs: browserMaxAgeMs,
      }))
    }
    return d
  }
  return Object.freeze({ ...Object.fromEntries(readMethods.map(name => [name, (...args) => reads[name](...args)])),
    readDeployment,
    async readIdentity(input) {
      if (input?.origin === WWW) return reads.readIdentity(input)
      check(browsers.has(input?.origin), 'candidate_metadata_required')
      return browsers.get(input.origin)(input)
    },
    verifyPromotionSupport: writer.verifyPromotionSupport,
    promote: writer.promote,
  })
}

// A file-based bridge lets the current tools host reserve locally, invoke its
// existing MCP tool, and later record normal readback. No server or secret is
// needed. Importing this module performs no command, navigation or cloud call.
function invokedAsCli() {
  if (!process.argv[1]) return false
  try {
    // Node resolves the module URL while argv can retain /tmp or another
    // symlink. Compare canonical files so a real invocation cannot exit zero
    // without executing the reservation/readback command.
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch { return false }
}
if (invokedAsCli()) {
  try {
    const [mode, directory, inputFile, flag, ...rest] = process.argv.slice(2)
    check(['reserve', 'readback'].includes(mode) && directory && inputFile && !rest.length
      && (flag === undefined || (mode === 'reserve' && flag === '--execute')), 'invalid_arguments')
    const raw = readFileSync(inputFile, 'utf8')
    check(Buffer.byteLength(raw) <= 32 * 1024, 'input_too_large')
    const input = JSON.parse(raw)
    const store = createReleaseStore(directory)
    const options = { store, scope: input.scope, review: input.review, execute: flag === '--execute' }
    const result = mode === 'reserve' ? reserveConnectorInvocation(options) : recordConnectorReadback(options)
    console.log(JSON.stringify(result))
    if (['blocked', 'unresolved'].includes(result.status)) process.exitCode = 1
  } catch {
    console.error('Connector host operation blocked: invalid local input or state. Do not retry a remote mutation.')
    process.exitCode = 1
  }
}
