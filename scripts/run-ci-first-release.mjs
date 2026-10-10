// This coordinator never creates a deployment. Cloud writes require --execute;
// a durable intent makes every subsequent invocation read-only for that release.
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { ciFirstReleaseFailures, RELEASE_PROJECT } from './check-ci-first-release.mjs'

const SHA = /^[0-9a-f]{40}$/
const DEPLOYMENT = /^dpl_[A-Za-z0-9]{1,128}$/
const TEAM = /^team_[A-Za-z0-9]+$/
const DOMAINS = ['illinimarket.com', 'www.illinimarket.com']
const WWW = 'https://www.illinimarket.com'
const PROJECT_REF = 'lfhvgprfphyfvhidegum'
const PROMOTE_PATH = '/v10/projects/{projectId}/promote/{deploymentId}'
const TOKEN_ENV = /^[A-Z][A-Z0-9_]{0,127}$/
const PREPARATION = 'preparation.json'
const CANDIDATE = 'candidate.json'
const INTENT = 'promote-intent.json'
const VERIFIED = 'verified.json'
const FILES = new Set([PREPARATION, CANDIDATE, INTENT, VERIFIED])

class ReleaseBlocked extends Error {
  constructor(code) { super(code); this.code = code }
}
function requireValue(value, code) { if (!value) throw new ReleaseBlocked(code) }
function positive(value) { return Number.isSafeInteger(value) && value > 0 }
function result(status, extra = {}) {
  return { status, claimsAtomicCronHandoff: false, ...extra }
}

// All cooperating invocations must use one trusted directory for this project.
// This is intentionally not a distributed lock, a lease or a stale-PID reaper.
export function createReleaseStore(directory) {
  const requestedRoot = resolve(directory)
  mkdirSync(requestedRoot, { recursive: true, mode: 0o700 })
  requireValue(!lstatSync(requestedRoot).isSymbolicLink(), 'unsafe_state_directory')
  // Resolve system aliases such as macOS /tmp once. Retargeting an ancestor
  // symlink later cannot send this store to another state directory.
  const root = realpathSync(requestedRoot)
  const owner = process.getuid()
  const lineage = []
  for (let current = root; ; current = dirname(current)) {
    const info = lstatSync(current)
    requireValue(info.isDirectory() && !info.isSymbolicLink()
      && [0, owner].includes(info.uid)
      && (!(info.mode & 0o022) || Boolean(info.mode & 0o1000)), 'unsafe_state_ancestor')
    lineage.push({ path: current, dev: info.dev, ino: info.ino })
    if (dirname(current) === current) break
  }
  const assertStable = () => {
    for (const expected of lineage) {
      const info = lstatSync(expected.path)
      requireValue(info.isDirectory() && !info.isSymbolicLink() && info.dev === expected.dev
        && info.ino === expected.ino && [0, owner].includes(info.uid)
        && (!(info.mode & 0o022) || Boolean(info.mode & 0o1000)), 'state_directory_replaced')
      if (expected.path === root) requireValue(info.uid === owner && !(info.mode & 0o077), 'unsafe_state_permissions')
    }
  }
  assertStable()
  const syncDirectory = () => {
    assertStable()
    const fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try {
      const info = fstatSync(fd)
      requireValue(info.dev === lineage[0].dev && info.ino === lineage[0].ino, 'state_directory_replaced')
      fsyncSync(fd)
    } finally { closeSync(fd) }
    assertStable()
  }
  const path = name => {
    assertStable()
    requireValue(FILES.has(name), 'invalid_state_file')
    return join(root, name)
  }
  return {
    has(name) {
      try { lstatSync(path(name)); return true }
      catch (error) { if (error.code === 'ENOENT') { assertStable(); return false }; throw error }
    },
    read(name) {
      const fd = openSync(path(name), constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const info = fstatSync(fd)
        requireValue(info.isFile() && info.nlink === 1 && info.uid === owner && !(info.mode & 0o077)
          && info.size <= 64 * 1024, 'invalid_state_file')
        const value = JSON.parse(readFileSync(fd, 'utf8'))
        assertStable()
        return value
      } finally { closeSync(fd) }
    },
    write(name, value) {
      const fd = openSync(path(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try { writeFileSync(fd, `${JSON.stringify(value)}\n`); fsyncSync(fd) } finally { closeSync(fd) }
      syncDirectory()
    },
    lock() {
      assertStable()
      const lockPath = join(root, `${RELEASE_PROJECT}.lock`)
      let fd
      try { fd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600) }
      catch { throw new ReleaseBlocked('release_locked') }
      try { writeFileSync(fd, `${process.pid}\n`); fsyncSync(fd); syncDirectory() }
      catch { closeSync(fd); throw new ReleaseBlocked('lock_persistence_failed') }
      const held = fstatSync(fd)
      return ({ preserve = false } = {}) => {
        try {
          if (preserve) return
          assertStable()
          const current = lstatSync(lockPath)
          requireValue(current.isFile() && !current.isSymbolicLink() && current.dev === held.dev
            && current.ino === held.ino && current.uid === owner && current.nlink === 1, 'release_lock_replaced')
          unlinkSync(lockPath)
          syncDirectory()
        } finally { closeSync(fd) }
      }
    },
  }
}

function validatePreparation(p) {
  requireValue(p?.schema === 1 && p.projectId === RELEASE_PROJECT && SHA.test(p.requestedSha)
    && TEAM.test(p.teamId) && positive(p.repositoryId) && positive(p.runId) && positive(p.runAttempt)
    && positive(p.preparedAt) && DEPLOYMENT.test(p.previousDeploymentId)
    && p.promotion?.method === 'POST' && p.promotion.pathTemplate === PROMOTE_PATH
    && p.promotion.force === false && typeof p.promotion.singleAttempt === 'boolean'
    && ['cli', 'native-https'].includes(p.promotion.transport)
    && (p.promotion.transport === 'cli' ? p.promotion.tokenEnv === null : TOKEN_ENV.test(p.promotion.tokenEnv)), 'invalid_preparation')
  return p
}

function verifySnapshot(snapshot, p, allowedCandidate) {
  requireValue(snapshot?.requestedSha === p.requestedSha && snapshot.teamId === p.teamId
    && snapshot.repositoryId === p.repositoryId, 'snapshot_scope_mismatch')
  const inventory = snapshot.productionCandidates
  requireValue(inventory?.projectId === RELEASE_PROJECT && inventory.complete === true
    && Array.isArray(inventory.items), 'incomplete_candidate_inventory')
  const ids = inventory.items.map(item => item?.id)
  requireValue(ids.every(id => DEPLOYMENT.test(id)) && new Set(ids).size === ids.length
    && ids.every(id => id === allowedCandidate), 'competing_candidate')
  // The existing creation preflight requires an empty inventory. At promotion,
  // remove ONLY this already-bound candidate; any other candidate was rejected.
  const failures = ciFirstReleaseFailures({ ...snapshot,
    productionCandidates: { ...inventory, items: [] } })
  requireValue(failures.length === 0 && snapshot.run.id === p.runId
    && snapshot.run.run_attempt === p.runAttempt, 'main_ci_or_configuration_changed')
}

function aliasIds(aliases, p) {
  requireValue(aliases?.projectId === RELEASE_PROJECT && aliases.teamId === p.teamId
    && aliases.complete === true && Array.isArray(aliases.items) && aliases.items.length === 2, 'invalid_alias_inventory')
  return DOMAINS.map(alias => {
    const matching = aliases.items.filter(item => item?.alias === alias)
    requireValue(matching.length === 1 && matching[0].projectId === RELEASE_PROJECT
      && DEPLOYMENT.test(matching[0].deploymentId), 'invalid_alias_inventory')
    return matching[0].deploymentId
  })
}

function verifyDeployment(d, p, id) {
  requireValue(d?.id === id && d.projectId === RELEASE_PROJECT && d.teamId === p.teamId
    && d.target === 'production' && d.gitSource?.type === 'github'
    && String(d.gitSource.repoId) === String(p.repositoryId) && d.gitSource.ref === 'main'
    && d.gitSource.sha === p.requestedSha, 'candidate_identity_mismatch')
  // Prepare immediately before the separately authorized create. A stale or
  // pre-existing deployment cannot be substituted for that CI-first candidate.
  requireValue(positive(d.createdAt) && d.createdAt >= p.preparedAt
    && d.createdAt - p.preparedAt <= 120_000, 'candidate_outside_prepared_window')
  requireValue(['QUEUED', 'INITIALIZING', 'BUILDING', 'READY', 'ERROR', 'CANCELED', 'BLOCKED'].includes(d.readyState), 'unknown_deployment_state')
  if (d.readyState === 'READY') {
    let url
    try { url = new URL(d.url) } catch { throw new ReleaseBlocked('invalid_candidate_origin') }
    requireValue(url.protocol === 'https:' && url.origin === d.url && !url.username && !url.password
      && !url.port && /^[a-z0-9-]+\.vercel\.app$/.test(url.hostname), 'invalid_candidate_origin')
  }
  return d
}

async function verifyIdentity(adapter, origin, p, id) {
  const nonce = randomUUID()
  const identity = await adapter.readIdentity({ origin, nonce })
  requireValue(identity?.schema === 1 && identity.environment === 'production'
    && identity.deploymentId === id && identity.commit === p.requestedSha
    && identity.projectRef === PROJECT_REF && [WWW, 'https://illinimarket.com'].includes(identity.appOrigin)
    && identity.nonce === nonce, 'runtime_identity_mismatch')
  return identity
}

function validateBinding(binding, p, id) {
  requireValue(binding?.schema === 1 && binding.projectId === RELEASE_PROJECT
    && binding.deploymentId === id && binding.requestedSha === p.requestedSha
    && binding.preparedAt === p.preparedAt, 'candidate_binding_mismatch')
}

async function observe(adapter, p, id, expectedAppOrigin) {
  const [d, aliases] = await Promise.all([
    adapter.readDeployment({ deploymentId: id }), adapter.readAliases(),
  ])
  verifyDeployment(d, p, id)
  const ids = aliasIds(aliases, p)
  requireValue(ids.every(value => [p.previousDeploymentId, id].includes(value)), 'alias_conflict')
  if (d.readyState !== 'READY' || !ids.every(value => value === id)) return false
  const [identity, candidateIdentity, redirect] = await Promise.all([
    verifyIdentity(adapter, WWW, p, id), verifyIdentity(adapter, d.url, p, id), adapter.readRootRedirect(),
  ])
  requireValue(identity.appOrigin === candidateIdentity.appOrigin, 'runtime_origin_changed')
  if (expectedAppOrigin) requireValue(identity.appOrigin === expectedAppOrigin, 'runtime_origin_changed')
  requireValue([307, 308].includes(redirect?.status) && redirect.location === `${WWW}/`, 'root_redirect_mismatch')
  // A new alias change during the anonymous probes is a conflict, not success.
  requireValue(aliasIds(await adapter.readAliases(), p).every(value => value === id), 'alias_changed_during_verification')
  return identity
}

async function observeUntil({ adapter, p, id, wait, now, maxObserveMs, pollMs, expectedAppOrigin }) {
  const deadline = now() + maxObserveMs
  do {
    if (await observe(adapter, p, id, expectedAppOrigin)) return result('verified', { deploymentId: id })
    if (now() >= deadline) break
    await wait(pollMs)
  } while (now() <= deadline)
  return result('unresolved', { deploymentId: id, reason: 'alias_not_verified' })
}

/** No cloud operation happens at import time; adapter methods are injectable. */
export async function runCiFirstRelease({ mode, store, adapter, requestedSha, teamId, repositoryId,
  runId, runAttempt, deploymentId, execute = false, transport = 'cli', tokenEnv, now = Date.now, wait = delay,
  pollMs = 1_000, maxReadyMs = 900_000, maxObserveMs = 30_000 }) {
  let unlock
  let p
  let mutationAttempted = false
  let preserveLock = false
  let runtimeAppOrigin
  try {
    requireValue(['prepare', 'watch', 'reconcile'].includes(mode) && typeof execute === 'boolean', 'invalid_mode')
    validateTransportSelection(transport, tokenEnv)
    requireValue(Number.isInteger(pollMs) && pollMs > 0 && pollMs <= 5_000
      && positive(maxReadyMs) && maxReadyMs <= 1_800_000
      && positive(maxObserveMs) && maxObserveMs <= 60_000, 'invalid_wait_budget')
    if (mode === 'prepare') {
      requireValue(!execute, 'prepare_is_read_only')
      requireValue(SHA.test(requestedSha) && TEAM.test(teamId) && positive(repositoryId)
        && positive(runId) && positive(runAttempt), 'invalid_release_scope')
      unlock = store.lock()
      requireValue(![PREPARATION, CANDIDATE, INTENT, VERIFIED].some(name => store.has(name)), 'existing_release_state')
      const capability = await adapter.verifyPromotionSupport()
      requireValue(capability?.method === 'POST' && capability.pathTemplate === PROMOTE_PATH
        && capability.force === false && typeof capability.singleAttempt === 'boolean'
        && (capability.transport === undefined || capability.transport === transport), 'ordinary_promotion_unavailable')
      const promotion = { ...capability, transport, tokenEnv: tokenEnv ?? null,
        credentialsVerified: false, permissionsVerified: false }
      p = { schema: 1, projectId: RELEASE_PROJECT, requestedSha, teamId, repositoryId, runId, runAttempt }
      verifySnapshot(await adapter.readSnapshot({ requestedSha, runId, runAttempt }), p)
      const ids = aliasIds(await adapter.readAliases(), p)
      requireValue(ids[0] === ids[1], 'aliases_not_on_one_previous_deployment')
      p = { ...p, preparedAt: now(), previousDeploymentId: ids[0], promotion }
      validatePreparation(p)
      store.write(PREPARATION, p)
      return result('prepared', { requestedSha, preparedAt: p.preparedAt, expiresForCreateAt: p.preparedAt + 120_000,
        executionAvailable: promotion.singleAttempt, credentialsVerified: false, permissionsVerified: false,
        authorizesCreation: false,
        ...(!promotion.singleAttempt ? { executionBlocker: 'single_attempt_promotion_transport_unavailable', doNotCreateForThisHandoff: true } : {}) })
    }

    p = validatePreparation(store.read(PREPARATION))
    requireValue(DEPLOYMENT.test(deploymentId), 'invalid_candidate_id')
    if (mode === 'watch') requireValue(p.promotion.transport === transport
      && p.promotion.tokenEnv === (tokenEnv ?? null), 'prepared_transport_mismatch')
    // Recovery is intentionally available even if a crash left the lock behind.
    // It cannot clear journals/locks, retry promotion, create, cancel or roll back.
    if (mode === 'reconcile' || store.has(INTENT) || store.has(VERIFIED)) {
      validateBinding(store.read(CANDIDATE), p, deploymentId)
      if (store.has(INTENT)) {
        const intent = store.read(INTENT)
        validateBinding(intent, p, deploymentId)
        requireValue([WWW, 'https://illinimarket.com'].includes(intent.runtimeAppOrigin), 'invalid_intent_identity')
        runtimeAppOrigin = intent.runtimeAppOrigin
      }
      const observed = await observeUntil({ adapter, p, id: deploymentId, wait, now, maxObserveMs, pollMs, expectedAppOrigin: runtimeAppOrigin })
      return { ...observed, readOnly: true }
    }
    requireValue(!execute || p.promotion.singleAttempt === true, 'single_attempt_promotion_transport_unavailable')
    unlock = store.lock()
    // Recheck under the lock: another cooperating process may just have exited.
    requireValue(!store.has(INTENT) && !store.has(VERIFIED), 'existing_promotion_intent')
    if (store.has(CANDIDATE)) validateBinding(store.read(CANDIDATE), p, deploymentId)
    else store.write(CANDIDATE, { schema: 1, projectId: RELEASE_PROJECT, deploymentId,
      requestedSha: p.requestedSha, preparedAt: p.preparedAt })

    const deadline = now() + maxReadyMs
    let candidate
    do {
      candidate = verifyDeployment(await adapter.readDeployment({ deploymentId }), p, deploymentId)
      if (candidate.readyState === 'READY') break
      requireValue(!['ERROR', 'CANCELED', 'BLOCKED'].includes(candidate.readyState), 'candidate_not_releasable')
      requireValue(now() < deadline, 'ready_timeout')
      await wait(pollMs)
    } while (now() <= deadline)
    requireValue(candidate.readyState === 'READY', 'ready_timeout')

    // No sleep, manual pause, protocol discovery or CI waiting after READY.
    const [snapshot, freshCandidate, candidateIdentity] = await Promise.all([
      adapter.readSnapshot({ requestedSha: p.requestedSha, runId: p.runId, runAttempt: p.runAttempt, candidateId: deploymentId }),
      adapter.readDeployment({ deploymentId }), verifyIdentity(adapter, candidate.url, p, deploymentId),
    ])
    verifySnapshot(snapshot, p, deploymentId)
    verifyDeployment(freshCandidate, p, deploymentId)
    requireValue(freshCandidate.readyState === 'READY' && freshCandidate.url === candidate.url, 'candidate_changed_after_ready')
    runtimeAppOrigin = candidateIdentity.appOrigin
    const binding = { schema: 1, projectId: RELEASE_PROJECT, deploymentId,
      requestedSha: p.requestedSha, preparedAt: p.preparedAt, runtimeAppOrigin }
    const ids = aliasIds(await adapter.readAliases(), p)
    requireValue(ids.every(id => [p.previousDeploymentId, deploymentId].includes(id)), 'alias_conflict')
    if (ids.some(id => id === deploymentId)) {
      // Production creation may already have started automatic domain assignment.
      // Never send another Promote just because only one alias has propagated.
      // Persist the observed transition even in default read-only mode. Later
      // alias rollback must never turn this same release back into a new write.
      preserveLock = true
      store.write(INTENT, { ...binding, observedAt: now(), action: 'automatic_alias_observed' })
      preserveLock = false
      return { ...await observeUntil({ adapter, p, id: deploymentId, wait, now, maxObserveMs, pollMs, expectedAppOrigin: runtimeAppOrigin }), readOnly: true }
    }
    if (!execute) return result('ready_read_only', { deploymentId, promotionPerformed: false, executionAvailable: p.promotion.singleAttempt })

    preserveLock = true
    store.write(INTENT, { ...binding, intendedAt: now(), method: 'POST', path: `/v10/projects/${RELEASE_PROJECT}/promote/${deploymentId}` })
    preserveLock = false
    mutationAttempted = true
    // A timeout or exception here is UNKNOWN, even if no response arrived.
    // There is deliberately no automatic write retry on either side of this call.
    requireValue((await adapter.promote({ deploymentId }))?.accepted === true, 'promotion_receipt_unknown')
    const observed = await observeUntil({ adapter, p, id: deploymentId, wait, now, maxObserveMs, pollMs, expectedAppOrigin: runtimeAppOrigin })
    if (observed.status === 'verified') {
      const formalIdentity = await verifyIdentity(adapter, WWW, p, deploymentId)
      requireValue(formalIdentity.appOrigin === candidateIdentity.appOrigin, 'runtime_origin_changed')
      store.write(VERIFIED, { ...binding, verifiedAt: now() })
    }
    return { ...observed, promotionAttempted: true }
  } catch (error) {
    if (mutationAttempted && (!(error instanceof ReleaseBlocked) || error.code === 'promotion_receipt_unknown')) {
      // A lost response may still have changed aliases. Inspect this candidate
      // only; read failures preserve the original unknown result and the intent.
      try {
        const observed = await observeUntil({ adapter, p, id: deploymentId, wait, now, maxObserveMs, pollMs, expectedAppOrigin: runtimeAppOrigin })
        if (observed.status === 'verified') return { ...observed, promotionAttempted: true, receiptOrJournalUnknown: true, readOnlyReconciliation: true }
      } catch { /* Do not echo subprocess errors, HTTP bodies or paths. */ }
    }
    let requiresReadOnlyReconciliation = mutationAttempted || preserveLock
    try { requiresReadOnlyReconciliation ||= Boolean(store && store.has(INTENT)) } catch { requiresReadOnlyReconciliation = true }
    return result(mutationAttempted ? 'unresolved' : 'blocked', {
      reason: error instanceof ReleaseBlocked ? error.code : 'operation_or_state_failed',
      ...(DEPLOYMENT.test(deploymentId) ? { deploymentId } : {}),
      promotionAttempted: mutationAttempted,
      requiresReadOnlyReconciliation,
    })
  } finally { if (unlock) unlock({ preserve: preserveLock }) }
}

function validateTransportSelection(transport, tokenEnv) {
  requireValue(['cli', 'native-https'].includes(transport)
    && (transport === 'native-https' ? typeof tokenEnv === 'string' && TOKEN_ENV.test(tokenEnv) : tokenEnv === undefined), 'invalid_transport_selection')
}

// The environment value is resolved only inside native.promote(), after the
// runner has persisted its intent. No credential lookup happens here/at import.
export async function createReleaseAdapter({ teamId, repositoryId, execute = false,
  transport = 'cli', tokenEnv, readAdapter, getToken } = {}) {
  validateTransportSelection(transport, tokenEnv)
  const { createCliAdapter } = await import('./ci-first-release-cli-adapter.mjs')
  const reads = readAdapter ?? createCliAdapter({ teamId, repositoryId })
  if (transport === 'cli') return reads
  const { createHttpsPromotionTransport } = await import('./ci-first-release-https-transport.mjs')
  const writer = createHttpsPromotionTransport({ teamId, execute, getToken: getToken ?? (() => process.env[tokenEnv]) })
  return Object.freeze({ ...reads,
    async verifyPromotionSupport() {
      // Retain pre-create checks for the installed read CLI's capabilities.
      await reads.verifyPromotionSupport()
      return writer.verifyPromotionSupport()
    },
    promote: writer.promote,
  })
}

export function parseReleaseArguments(args) {
  const mode = args.shift()
  const values = {}
  const accepted = new Set(['state-dir', 'sha', 'team-id', 'repo-id', 'run-id', 'run-attempt', 'candidate-id', 'transport', 'token-env'])
  let execute = false
  while (args.length) {
    const key = args.shift()
    if (key === '--execute' && !execute) { execute = true; continue }
    requireValue(key?.startsWith('--') && accepted.has(key.slice(2)) && !(key.slice(2) in values), 'invalid_arguments')
    const value = args.shift()
    requireValue(value && !value.startsWith('--'), 'invalid_arguments')
    values[key.slice(2)] = value
  }
  requireValue(values['state-dir'] && ['prepare', 'watch', 'reconcile'].includes(mode), 'invalid_arguments')
  requireValue(!(mode === 'reconcile' && execute), 'reconcile_is_read_only')
  const transport = values.transport ?? 'cli'
  validateTransportSelection(transport, values['token-env'])
  requireValue(mode !== 'reconcile' || transport === 'cli', 'reconcile_is_read_only')
  return { mode, execute, directory: values['state-dir'], requestedSha: values.sha, teamId: values['team-id'],
    repositoryId: Number(values['repo-id']), runId: Number(values['run-id']), runAttempt: Number(values['run-attempt']),
    deploymentId: values['candidate-id'], transport, tokenEnv: values['token-env'] }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).includes('--help')) {
    console.log('Read-only prepare: --state-dir DIR --sha SHA --team-id TEAM --repo-id ID --run-id ID --run-attempt N\nwatch: --state-dir DIR --candidate-id ID [--execute]\nNative transport opt-in on prepare/watch: --transport native-https --token-env APPROVED_EXISTING_ENV_NAME\nreconcile: --state-dir DIR --candidate-id ID\nDefault CLI transport is read-only. Native credentials are read only after durable execute intent.\nPreparation never verifies credentials/permissions or authorizes creation.\nNo create command; all invocations must share one project state directory.')
  } else {
    try {
      const options = parseReleaseArguments(process.argv.slice(2))
      const store = createReleaseStore(options.directory)
      const scope = options.mode === 'prepare' ? options : validatePreparation(store.read(PREPARATION))
      const adapter = await createReleaseAdapter({ teamId: scope.teamId, repositoryId: scope.repositoryId,
        execute: options.execute, transport: options.transport, tokenEnv: options.tokenEnv })
      const outcome = await runCiFirstRelease({ ...options, store, adapter })
      console.log(JSON.stringify(outcome, null, 2))
      if (!['prepared', 'ready_read_only', 'verified'].includes(outcome.status)) process.exitCode = 1
    } catch {
      console.error('Release blocked: invalid arguments, local state or adapter failure. No retry is authorized.')
      process.exitCode = 1
    }
  }
}
