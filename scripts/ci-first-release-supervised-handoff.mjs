// Supervised orchestration using existing authorized readers and connector.
// No deployment creation, credential access, runtime-gate change or cloud call
// at import. History classification and browser observation remain trusted host
// work; this module validates their binding, not their independent authenticity.
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RELEASE_PROJECT, RELEASE_REPOSITORY, REQUIRED_RELEASE_CHECKS } from './check-ci-first-release.mjs'
import { createReleaseStore } from './run-ci-first-release.mjs'
import { createConnectorHostAdapter, reserveConnectorInvocation } from './ci-first-release-connector-host.mjs'

const INTENT = 'promote-intent.json'
const VERIFIED = 'verified.json'
const WWW = 'https://www.illinimarket.com'
const DOMAINS = ['illinimarket.com', 'www.illinimarket.com']
const PROJECT_REF = 'lfhvgprfphyfvhidegum'
const ID = /^dpl_[A-Za-z0-9]{1,128}$/
const SHA = /^[0-9a-f]{40}$/
const SCOPE_FIELDS = ['projectId', 'teamId', 'repositoryId', 'requestedSha', 'runId', 'runAttempt', 'previousDeploymentId']
const INVENTORY_FIELDS = ['id', 'projectId', 'teamId', 'target', 'readyState', 'readySubstate', 'createdAt', 'aliasAssigned']
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const positive = value => Number.isSafeInteger(value) && value > 0
class HandoffError extends Error {
  constructor(code) { super(`supervised_${code}`); this.code = this.message }
}
function check(condition, code) { if (!condition) throw new HandoffError(code) }
function freeze(value) {
  if (object(value) || Array.isArray(value)) {
    for (const item of Object.values(value)) freeze(item)
    Object.freeze(value)
  }
  return value
}
const copy = value => JSON.parse(JSON.stringify(value))
function scopeOf(raw) {
  check(object(raw) && raw.projectId === RELEASE_PROJECT && /^team_[A-Za-z0-9]{1,128}$/.test(raw.teamId)
    && SHA.test(raw.requestedSha) && positive(raw.repositoryId) && positive(raw.runId)
    && positive(raw.runAttempt) && ID.test(raw.previousDeploymentId), 'invalid_scope')
  return freeze(Object.fromEntries(SCOPE_FIELDS.map(key => [key, raw[key]])))
}
function sameScope(raw, scope) {
  check(object(raw) && SCOPE_FIELDS.every(key => raw[key] === scope[key]), 'scope_changed')
}
function inventoryOf(raw, scope) {
  check(raw?.projectId === scope.projectId && raw.teamId === scope.teamId
    && raw.complete === true && Array.isArray(raw.items) && raw.items.length <= 10_000, 'inventory_incomplete')
  const seen = new Set()
  const items = raw.items.map(item => {
    check(object(item) && ID.test(item.id) && !seen.has(item.id) && item.projectId === scope.projectId
      && item.teamId === scope.teamId && item.target === 'production'
      && ['QUEUED', 'INITIALIZING', 'BUILDING', 'READY', 'ERROR', 'CANCELED', 'BLOCKED'].includes(item.readyState)
      && (item.readySubstate === undefined || ['STAGED', 'PROMOTED', 'ROLLING'].includes(item.readySubstate))
      && (item.createdAt === undefined || positive(item.createdAt))
      && (item.aliasAssigned === undefined || typeof item.aliasAssigned === 'boolean'), 'inventory_invalid')
    seen.add(item.id)
    return Object.fromEntries(INVENTORY_FIELDS.filter(key => Object.hasOwn(item, key)).map(key => [key, item[key]]))
  })
  return freeze(items.sort((a, b) => a.id.localeCompare(b.id)))
}
function validateSnapshot(raw, scope) {
  check(raw?.requestedSha === scope.requestedSha && raw.mainSha === scope.requestedSha
    && raw.projectId === scope.projectId && raw.teamId === scope.teamId
    && raw.repositoryId === scope.repositoryId && raw.vercelConfig?.git?.deploymentEnabled === false, 'snapshot_scope_changed')
  const run = raw.run
  check(run?.id === scope.runId && run.run_attempt === scope.runAttempt
    && run.repository?.full_name === RELEASE_REPOSITORY && run.repository.id === scope.repositoryId
    && run.head_sha === scope.requestedSha && run.head_branch === 'main'
    && run.path === '.github/workflows/ci.yml' && run.name === 'CI'
    && ['push', 'workflow_dispatch'].includes(run.event)
    && run.status === 'completed' && run.conclusion === 'success', 'ci_changed')
  const jobs = raw.jobs
  check(jobs?.run_id === scope.runId && jobs.run_attempt === scope.runAttempt && jobs.complete === true
    && Array.isArray(jobs.items) && jobs.items.length === REQUIRED_RELEASE_CHECKS.length, 'ci_jobs_incomplete')
  for (const name of REQUIRED_RELEASE_CHECKS) {
    const matches = jobs.items.filter(job => job?.name === name)
    check(matches.length === 1 && matches[0].run_id === scope.runId && matches[0].run_attempt === scope.runAttempt
      && matches[0].head_sha === scope.requestedSha && matches[0].status === 'completed'
      && matches[0].conclusion === 'success', 'ci_job_failed')
  }
  return inventoryOf(raw.productionCandidates, scope)
}
function aliasesOf(raw, scope, candidateId) {
  check(raw?.projectId === scope.projectId && raw.teamId === scope.teamId && raw.complete === true
    && Array.isArray(raw.items) && raw.items.length === 2, 'alias_inventory_invalid')
  return DOMAINS.map(alias => {
    const found = raw.items.filter(item => item?.alias === alias)
    check(found.length === 1 && found[0].projectId === scope.projectId
      && [scope.previousDeploymentId, candidateId].filter(Boolean).includes(found[0].deploymentId), 'alias_conflict')
    return { alias, projectId: scope.projectId, deploymentId: found[0].deploymentId }
  })
}
function deploymentOf(raw, scope, id, preparedAt) {
  check(raw?.id === id && raw.projectId === scope.projectId && raw.teamId === scope.teamId
    && raw.target === 'production' && raw.gitSource?.type === 'github'
    && String(raw.gitSource.repoId) === String(scope.repositoryId) && raw.gitSource.ref === 'main'
    && raw.gitSource.sha === scope.requestedSha && positive(raw.createdAt)
    && (preparedAt === undefined || raw.createdAt >= preparedAt), 'candidate_mismatch')
  check(['QUEUED', 'INITIALIZING', 'BUILDING', 'READY', 'ERROR', 'CANCELED', 'BLOCKED'].includes(raw.readyState), 'candidate_state_unknown')
  if (raw.readyState === 'READY') {
    let url
    try { url = new URL(raw.url) } catch { throw new HandoffError('candidate_origin_invalid') }
    check(url.protocol === 'https:' && url.origin === raw.url && !url.username && !url.password && !url.port
      && /^[a-z0-9-]+\.vercel\.app$/.test(url.hostname), 'candidate_origin_invalid')
  }
  return raw
}
function identityOf(raw, scope, id, nonce) {
  check(raw?.schema === 1 && raw.environment === 'production' && raw.deploymentId === id
    && raw.commit === scope.requestedSha && raw.projectRef === PROJECT_REF
    && [WWW, 'https://illinimarket.com'].includes(raw.appOrigin) && raw.nonce === nonce, 'identity_mismatch')
  return { schema: 1, environment: 'production', deploymentId: id, commit: scope.requestedSha,
    projectRef: PROJECT_REF, appOrigin: raw.appOrigin, nonce,
    ...(raw.browserEvidence ? { browserEvidence: copy(raw.browserEvidence) } : {}) }
}

export function createSupervisedHandoff({ store, adapter, scope: rawScope, reviewHistory, prepareHostResources,
  now = Date.now, wait = delay, pollMs = 1_000, maxReadyMs = 900_000, maxObserveMs = 30_000,
  operationTimeoutMs = 180_000, maxEvidenceAgeMs = 60_000 } = {}) {
  const scope = scopeOf(rawScope)
  const methods = ['verifyPromotionSupport', 'readSnapshot', 'readDeployment', 'readAliases', 'readIdentity', 'readRootRedirect', 'promote']
  check(object(adapter) && methods.every(name => typeof adapter[name] === 'function')
    && object(store) && ['has', 'read', 'write', 'lock'].every(name => typeof store[name] === 'function')
    && typeof reviewHistory === 'function' && typeof prepareHostResources === 'function'
    && typeof now === 'function' && typeof wait === 'function', 'invalid_options')
  check(positive(pollMs) && pollMs <= 30_000 && positive(maxReadyMs) && maxReadyMs <= 1_800_000
    && positive(maxObserveMs) && maxObserveMs <= 300_000 && positive(operationTimeoutMs) && operationTimeoutMs <= 300_000
    && positive(maxEvidenceAgeMs) && maxEvidenceAgeMs <= 300_000, 'invalid_budgets')
  const prepared = new WeakSet()
  const candidateBindings = new WeakMap()
  let busy = false
  function context() { return { timings: {}, readCounts: {}, observations: [] } }
  function timestamp() { const at = now(); check(positive(at), 'clock_invalid'); return at }
  function result(ctx, status, extra = {}) {
    return { status, ...extra, timings: copy(ctx.timings),
      readCounts: Object.fromEntries(Object.entries(ctx.readCounts).filter(([name]) => name.startsWith('read'))),
      callCounts: { ...ctx.readCounts }, observations: copy(ctx.observations),
      singleToolInvocationProtocol: true, singleHttpAttempt: false,
      internalHttpAttempts: 'unknown', claimsAtomicCronHandoff: false }
  }
  async function call(ctx, name, fn, timeoutBudgetMs = operationTimeoutMs) {
    const startedAt = timestamp()
    const start = performance.now()
    const limit = Math.min(operationTimeoutMs, timeoutBudgetMs)
    check(limit > 0, 'operation_timeout')
    ctx.readCounts[name] = (ctx.readCounts[name] || 0) + 1
    let timer
    let completed = false
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new HandoffError('operation_timeout')), limit)
      })
      // Invoke immediately: reservation -> adapter entry has no asynchronous
      // preparation gap. Promise.race still observes late rejection safely.
      const pending = fn()
      const value = await Promise.race([
        Promise.resolve(pending), timeout,
      ])
      check(performance.now() - start < limit, 'operation_timeout')
      const completedAt = timestamp()
      check(completedAt >= startedAt, 'clock_invalid')
      completed = true
      return { value, startedAt, completedAt }
    } finally {
      clearTimeout(timer)
      ctx.observations.push({ operation: name, startedAt, completed,
        durationMs: Math.round((performance.now() - start) * 1000) / 1000 })
    }
  }
  function remaining(deadline, started, budget) {
    const left = Math.min(deadline - timestamp(), budget - (performance.now() - started))
    check(left > 0, 'phase_timeout')
    return left
  }
  function fresh(records) {
    const at = timestamp()
    for (const record of records) check(record.startedAt <= at && at - record.startedAt <= maxEvidenceAgeMs, 'evidence_stale')
  }
  function capability(value) {
    check(value?.transport === 'connector' && value.method === 'POST' && value.force === false
      && value.pathTemplate === '/v10/projects/{projectId}/promote/{deploymentId}'
      && value.singleToolInvocation === true && value.singleAttempt === false
      && value.internalHttpAttempts === 'unknown', 'connector_unavailable')
  }
  function intent(id) {
    const saved = store.read(INTENT)
    check(saved?.schema === 1 && saved.kind === 'supervised-connector'
      && ['invoke_once', 'observe_existing_transition'].includes(saved.action)
      && saved.scope?.deploymentId === id
      && (saved.runtimeAppOrigin === undefined
        || [WWW, 'https://illinimarket.com'].includes(saved.runtimeAppOrigin)), 'intent_invalid')
    sameScope(saved.scope, scope)
    return saved
  }
  function verifyStoredReadback(id) {
    const saved = store.read(VERIFIED)
    check(saved?.schema === 1 && saved.kind === 'supervised-connector'
      && saved.scope?.deploymentId === id && positive(saved.recordedAt), 'verified_record_invalid')
    sameScope(saved.scope, scope)
  }
  async function history(ctx, phase, inventory, baseline, candidateId) {
    const receipt = await call(ctx, 'reviewHistory', () => reviewHistory(freeze({ phase, scope,
      inventory: { projectId: scope.projectId, teamId: scope.teamId, complete: true, items: copy(inventory) },
      ...(baseline ? { baseline: copy(baseline) } : {}), ...(candidateId ? { candidateId } : {}) })))
    const review = receipt.value
    check(review?.reviewed === true && positive(review.observedAt)
      && review.observedAt >= receipt.startedAt && review.observedAt <= receipt.completedAt
      && typeof review.evidenceRef === 'string' && review.evidenceRef.length > 0
      && review.evidenceRef.length <= 1024 && !/[\r\n\x00]/.test(review.evidenceRef), 'history_review_missing')
    return { ...receipt, value: { observedAt: review.observedAt, evidenceRef: review.evidenceRef } }
  }
  async function prepare() {
    const ctx = context()
    try {
      if (store.has(INTENT)) return result(ctx, 'reconcile_only', { readOnly: true, reason: 'durable_intent_exists' })
      check(!['preparation.json', 'candidate.json', VERIFIED].some(name => store.has(name)), 'different_release_state')
      const resources = await call(ctx, 'prepareHostResources', () => prepareHostResources({ scope }))
      check(resources.value?.ready === true && typeof resources.value.evidenceRef === 'string'
        && resources.value.evidenceRef.length > 0, 'host_resources_unavailable')
      const support = await call(ctx, 'verifyPromotionSupport', () => adapter.verifyPromotionSupport())
      capability(support.value)
      const [snapshot, aliases] = await Promise.all([
        call(ctx, 'readSnapshot', () => adapter.readSnapshot(scope)),
        call(ctx, 'readAliases', () => adapter.readAliases()),
      ])
      const baseline = validateSnapshot(snapshot.value, scope)
      check(baseline.every(item => item.readyState === 'READY' && item.readySubstate !== 'ROLLING'), 'active_candidate_before_create')
      aliasesOf(aliases.value, scope)
      const classified = await history(ctx, 'prepare', baseline)
      fresh([snapshot, aliases, classified])
      check(!store.has(INTENT), 'intent_appeared')
      const preparation = freeze({ schema: 1, kind: 'supervised-handoff', scope, preparedAt: timestamp(),
        historicalCandidates: copy(baseline), historyEvidenceRef: classified.value.evidenceRef,
        resourceEvidenceRef: resources.value.evidenceRef })
      prepared.add(preparation)
      ctx.timings.preparedAt = preparation.preparedAt
      return result(ctx, 'prepared', { preparation, readOnly: true, authorizesCreation: false })
    } catch (error) { return result(ctx, 'blocked', { reason: error instanceof HandoffError ? error.code : 'supervised_prepare_failed' }) }
  }
  async function readIdentity(ctx, origin, id, timeoutBudgetMs) {
    const nonce = randomUUID()
    const receipt = await call(ctx, 'readIdentity', () => adapter.readIdentity({ origin, nonce }), timeoutBudgetMs)
    return { ...receipt, value: identityOf(receipt.value, scope, id, nonce) }
  }
  async function observe(ctx, id, expectedOrigin) {
    const started = performance.now(), deadline = timestamp() + maxObserveMs
    const left = () => remaining(deadline, started, maxObserveMs)
    do {
      const [candidate, aliases] = await Promise.all([
        call(ctx, 'readDeployment', () => adapter.readDeployment({ deploymentId: id }), left()),
        call(ctx, 'readAliases', () => adapter.readAliases(), left()),
      ])
      const deployment = deploymentOf(candidate.value, scope, id)
      const current = aliasesOf(aliases.value, scope, id)
      if (deployment.readyState === 'READY' && current.every(item => item.deploymentId === id)) {
        const [formal, standalone, redirect] = await Promise.all([
          readIdentity(ctx, WWW, id, left()), readIdentity(ctx, deployment.url, id, left()),
          call(ctx, 'readRootRedirect', () => adapter.readRootRedirect(), left()),
        ])
        check(formal.value.appOrigin === standalone.value.appOrigin
          && (!expectedOrigin || formal.value.appOrigin === expectedOrigin), 'runtime_origin_changed')
        check([307, 308].includes(redirect.value?.status) && redirect.value.location === `${WWW}/`, 'root_redirect_mismatch')
        const finalAliases = await call(ctx, 'readAliases', () => adapter.readAliases(), left())
        const checked = aliasesOf(finalAliases.value, scope, id)
        check(checked.every(item => item.deploymentId === id), 'alias_changed_during_readback')
        fresh([candidate, aliases, formal, standalone, redirect, finalAliases])
        left()
        const evidence = { observedAt: timestamp(), aliases: checked, formalIdentity: formal.value,
          candidateIdentity: standalone.value, rootRedirect: { status: redirect.value.status, location: redirect.value.location } }
        if (!store.has(VERIFIED)) {
          try { store.write(VERIFIED, { schema: 1, kind: 'supervised-connector',
            scope: { ...scope, deploymentId: id }, recordedAt: evidence.observedAt, evidence }) }
          catch (error) {
            // A cooperating read-only observer can win the exclusive create
            // after has(). Accept only an actual EEXIST with a valid, matching
            // record; persistence uncertainty and torn/conflicting records fail.
            if (error?.code !== 'EEXIST') throw error
            verifyStoredReadback(id)
          }
        } else verifyStoredReadback(id)
        ctx.timings.verifiedAt = evidence.observedAt
        return result(ctx, 'verified', { deploymentId: id, readOnly: true, evidence })
      }
      if (timestamp() >= deadline || performance.now() - started >= maxObserveMs) break
      const pause = Math.min(pollMs, left())
      await call(ctx, 'wait', () => wait(pause), left())
    } while (timestamp() <= deadline && performance.now() - started <= maxObserveMs)
    return result(ctx, 'unresolved', { deploymentId: id, readOnly: true, reason: 'supervised_alias_not_verified' })
  }
  async function run({ preparation, deploymentId, execute = false, recovery = false } = {}) {
    const ctx = context()
    let consumed = false
    let promotionAttempted = false
    if (busy) return result(ctx, 'blocked', { reason: 'supervised_busy' })
    busy = true
    try {
      check(ID.test(deploymentId) && deploymentId !== scope.previousDeploymentId && typeof execute === 'boolean', 'invalid_candidate')
      if (store.has(INTENT)) {
        const saved = intent(deploymentId)
        consumed = true
        return { ...await observe(ctx, deploymentId, saved.runtimeAppOrigin),
          runtimeOriginBaselineVerified: saved.runtimeAppOrigin !== undefined }
      }
      check(!recovery, 'intent_missing')
      check(prepared.has(preparation), 'preparation_not_bound')
      sameScope(preparation.scope, scope)
      const bound = candidateBindings.get(preparation)
      check(bound === undefined || bound === deploymentId, 'candidate_binding_changed')
      candidateBindings.set(preparation, deploymentId)
      check(!preparation.historicalCandidates.some(item => item.id === deploymentId), 'candidate_was_history')
      const started = performance.now(), deadline = timestamp() + maxReadyMs
      const readyLeft = () => remaining(deadline, started, maxReadyMs)
      let ready
      do {
        const polled = await call(ctx, 'readDeployment', () => adapter.readDeployment({ deploymentId }), readyLeft())
        ready = deploymentOf(polled.value, scope, deploymentId, preparation.preparedAt)
        if (ready.readyState === 'READY') break
        check(!['ERROR', 'CANCELED', 'BLOCKED'].includes(ready.readyState), 'candidate_not_releasable')
        check(timestamp() < deadline && performance.now() - started < maxReadyMs, 'ready_timeout')
        const pause = Math.min(pollMs, readyLeft())
        await call(ctx, 'wait', () => wait(pause), readyLeft())
      } while (timestamp() <= deadline && performance.now() - started <= maxReadyMs)
      check(ready.readyState === 'READY' && timestamp() <= deadline && performance.now() - started <= maxReadyMs, 'ready_timeout')
      ctx.timings.readyObservedAt = timestamp()
      // The prior READY observation registered this validated origin in the
      // existing host adapter. Compare the independent fresh metadata below.
      const [snapshot, candidate, identity] = await Promise.all([
        call(ctx, 'readSnapshot', () => adapter.readSnapshot({ ...scope, candidateId: deploymentId })),
        call(ctx, 'readDeployment', () => adapter.readDeployment({ deploymentId })),
        readIdentity(ctx, ready.url, deploymentId),
      ])
      const inventory = validateSnapshot(snapshot.value, scope)
      const others = inventory.filter(item => item.id !== deploymentId)
      check(JSON.stringify(others) === JSON.stringify(preparation.historicalCandidates), 'historical_inventory_changed')
      const entry = inventory.find(item => item.id === deploymentId)
      check(!entry || (entry.readyState === 'READY' && entry.readySubstate !== 'ROLLING'), 'candidate_inventory_changed')
      const current = deploymentOf(candidate.value, scope, deploymentId, preparation.preparedAt)
      check(current.readyState === 'READY' && current.url === ready.url, 'candidate_changed_after_ready')
      const classified = await history(ctx, 'ready', inventory, preparation.historicalCandidates, deploymentId)
      fresh([snapshot, candidate, identity, classified])
      // No report/prompt/resource discovery between this final read, synchronous
      // durable reservation, and entering the one host promotion callback.
      const aliases = await call(ctx, 'readAliases', () => adapter.readAliases())
      const checkedAliases = aliasesOf(aliases.value, scope, deploymentId)
      check(entry || checkedAliases.some(item => item.deploymentId === deploymentId), 'candidate_missing_from_inventory')
      fresh([snapshot, candidate, identity, classified, aliases])
      ctx.timings.finalAliasesAt = aliases.completedAt
      // Keep the observed origin alongside the new durable intent so recovery
      // can compare it too. Existing host/strict implementations are unchanged.
      const scopedStore = { has: name => store.has(name), read: name => store.read(name), lock: () => store.lock(),
        write: (name, value) => store.write(name, name === INTENT
          ? { ...value, runtimeAppOrigin: identity.value.appOrigin } : value) }
      const reservation = reserveConnectorInvocation({ store: scopedStore, scope: { ...scope, deploymentId }, execute,
        now, maxAgeMs: maxEvidenceAgeMs, review: { scope: { ...scope, deploymentId }, observedAt: aliases.completedAt,
          evidenceRef: classified.value.evidenceRef, aliases: checkedAliases } })
      if (reservation.status === 'ready_read_only') return result(ctx, 'ready_read_only', { deploymentId, authorizesRelease: false })
      check(['reserved', 'reconcile_only'].includes(reservation.status), 'reservation_blocked')
      consumed = true
      if (reservation.status === 'reconcile_only') {
        const saved = intent(deploymentId)
        return { ...await observe(ctx, deploymentId, saved.runtimeAppOrigin),
          runtimeOriginBaselineVerified: saved.runtimeAppOrigin !== undefined }
      }
      ctx.timings.reservedAt = timestamp()
      // Local fsync/unlock can be slow too. A consumed reservation whose
      // evidence expired while persisting must stop read-only, never send late.
      fresh([snapshot, candidate, identity, classified, aliases])
      let receiptUnknown = false
      try {
        // Calling the adapter happens synchronously inside the wrapper callback;
        // no extra async preparation or read is inserted after the reservation.
        const receipt = await call(ctx, 'promote', () => {
          ctx.timings.promotionInvokedAt = timestamp()
          promotionAttempted = true
          return adapter.promote({ deploymentId })
        })
        receiptUnknown = receipt.value?.invoked !== true || receipt.value.receipt !== 'tool_returned'
      } catch { receiptUnknown = true }
      ctx.timings.promotionReturnedAt = timestamp()
      return { ...await observe(ctx, deploymentId, identity.value.appOrigin), readOnly: !promotionAttempted,
        readbackOnlyAfterInvocation: true, promotionAttempted, receiptUnknown }
    } catch (error) {
      let needsReconciliation = consumed
      try { needsReconciliation ||= store.has(INTENT) } catch { needsReconciliation = true }
      return result(ctx, consumed ? 'unresolved' : 'blocked', { deploymentId, readOnly: !promotionAttempted, promotionAttempted,
        requiresReadOnlyReconciliation: needsReconciliation,
        reason: error instanceof HandoffError ? error.code : 'supervised_operation_failed' })
    } finally { busy = false }
  }
  return Object.freeze({ prepare, watch: options => run(options),
    reconcile: options => run({ ...options, execute: false, recovery: true }) })
}

// Explicit offline demonstration: real store + host/browser/connector modules,
// in-memory metadata and screen-confirmation fixtures. No real CLI/API/browser.
export async function runOfflineDemo() {
  const directory = mkdtempSync(join(tmpdir(), 'illini-supervised-demo-'))
  const store = createReleaseStore(directory)
  const scope = { projectId: RELEASE_PROJECT, teamId: 'team_Demo', repositoryId: 123,
    requestedSha: 'a'.repeat(40), runId: 456, runAttempt: 1, previousDeploymentId: 'dpl_Old' }
  const id = 'dpl_Demo', origin = 'https://candidate-demo.vercel.app'
  let candidateExists = false, switched = false, calls = 0, preparingTime
  const events = []
  const aliases = () => ({ projectId: scope.projectId, teamId: scope.teamId, complete: true,
    items: DOMAINS.map(alias => ({ alias, projectId: scope.projectId, deploymentId: switched ? id : scope.previousDeploymentId })) })
  const identity = nonce => ({ schema: 1, environment: 'production', deploymentId: id,
    commit: scope.requestedSha, projectRef: PROJECT_REF, appOrigin: 'https://illinimarket.com', nonce })
  const reads = {
    async readSnapshot() {
      events.push('snapshot')
      return { ...scope, mainSha: scope.requestedSha, vercelConfig: { git: { deploymentEnabled: false } },
        productionCandidates: { projectId: scope.projectId, teamId: scope.teamId, complete: true,
          items: candidateExists ? [{ id, projectId: scope.projectId, teamId: scope.teamId, target: 'production', readyState: 'READY' }] : [] },
        run: { id: scope.runId, run_attempt: 1, head_sha: scope.requestedSha, head_branch: 'main', name: 'CI',
          path: '.github/workflows/ci.yml', event: 'push', status: 'completed', conclusion: 'success',
          repository: { id: scope.repositoryId, full_name: RELEASE_REPOSITORY } },
        jobs: { run_id: scope.runId, run_attempt: 1, complete: true, items: REQUIRED_RELEASE_CHECKS.map(name => ({ name,
          run_id: scope.runId, run_attempt: 1, head_sha: scope.requestedSha, status: 'completed', conclusion: 'success' })) } }
    },
    async readDeployment() { events.push('metadata'); return { id, projectId: scope.projectId, teamId: scope.teamId,
      target: 'production', readyState: 'READY', createdAt: preparingTime, url: origin,
      gitSource: { type: 'github', repoId: scope.repositoryId, ref: 'main', sha: scope.requestedSha } } },
    async readAliases() { events.push('aliases'); return aliases() },
    async readIdentity({ nonce }) { events.push('formal-identity'); return identity(nonce) },
    async readRootRedirect() { return { status: 308, location: `${WWW}/` } },
    async readCandidates() { throw new Error('demo_should_not_call_separate_inventory') },
  }
  const adapter = createConnectorHostAdapter({ reads, teamId: scope.teamId, execute: true,
    requestPromote: async args => {
      check(store.has(INTENT) && store.read(INTENT).scope.deploymentId === args.deploymentId, 'demo_intent_missing')
      events.push('promote-after-durable-intent'); calls++; switched = true
      return { isError: false, content: [] }
    },
    captureBrowserIdentity: async request => {
      events.push('fixture-screen-observation')
      return { requestedUrl: request.requestedUrl, observedUrl: request.requestedUrl, observedAt: Date.now(),
        evidenceRef: `offline-${request.nonce}.png`, captureMode: 'existing-session-screen-confirmation', identity: identity(request.nonce) }
    } })
  const factory = () => createSupervisedHandoff({ store, adapter, scope,
    prepareHostResources: async () => ({ ready: true, evidenceRef: 'offline-resources' }),
    reviewHistory: async () => ({ reviewed: true, observedAt: Date.now(), evidenceRef: 'offline-history' }) })
  try {
    const handoff = factory()
    const preparation = await handoff.prepare()
    preparingTime = Date.now(); candidateExists = true // Fixture only, not deployment creation.
    const released = await handoff.watch({ preparation: preparation.preparation, deploymentId: id, execute: true })
    const recovered = await factory().reconcile({ deploymentId: id })
    return { offline: true, realCloudCalls: 0, fixturePromotionCalls: calls, events, preparation, released, recovered }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

let main = false
try { main = Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) } catch {}
if (main) {
  if (process.argv.length === 3 && process.argv[2] === '--demo') {
    runOfflineDemo().then(value => {
      console.log(JSON.stringify(value, null, 2))
      if (value.released?.status !== 'verified' || value.recovered?.status !== 'verified' || value.fixturePromotionCalls !== 1) process.exitCode = 1
    }, () => { console.error('Offline supervised handoff demonstration failed.'); process.exitCode = 1 })
  } else { console.error('Usage: node scripts/ci-first-release-supervised-handoff.mjs --demo (offline only)'); process.exitCode = 2 }
}
