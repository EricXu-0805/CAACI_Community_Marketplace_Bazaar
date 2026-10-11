// Local JSONL bridge between a persistent Node process and the existing tools
// host. No cloud call on import; no deployment creation or credential reader.
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { createCliAdapter } from './ci-first-release-cli-adapter.mjs'
import { createReleaseStore } from './run-ci-first-release.mjs'
import { createConnectorHostAdapter } from './ci-first-release-connector-host.mjs'
import { createSupervisedHandoff } from './ci-first-release-supervised-handoff.mjs'
import { RELEASE_PROJECT } from './check-ci-first-release.mjs'

const ID = /^dpl_[A-Za-z0-9]{1,128}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SCOPE_KEYS = ['projectId', 'teamId', 'repositoryId', 'requestedSha', 'runId', 'runAttempt', 'previousDeploymentId']
const KINDS = new Set(['prepare_resources', 'review_history', 'supply_candidate', 'capture_browser_identity', 'promote'])
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const positive = value => Number.isSafeInteger(value) && value > 0
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const ref = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
class HostBridgeError extends Error {
  constructor(code) { super(`supervised_host_${code}`); this.code = this.message }
}
function check(condition, code) { if (!condition) throw new HostBridgeError(code) }
export function validateHostScope(value) {
  check(exact(value, SCOPE_KEYS) && value.projectId === RELEASE_PROJECT
    && /^team_[A-Za-z0-9]{1,128}$/.test(value.teamId) && /^[0-9a-f]{40}$/.test(value.requestedSha)
    && [value.repositoryId, value.runId, value.runAttempt].every(positive)
    && ID.test(value.previousDeploymentId), 'scope_invalid')
  return Object.freeze(Object.fromEntries(SCOPE_KEYS.map(key => [key, value[key]])))
}

// The peer consumes bytes, not readline's unbounded line buffering. Any bad
// input poisons the session, rejects every pending request and prevents future
// promotion dispatch. An already emitted mutation cannot be cancelled/retried.
export function createJsonLinePeer({ input, output, timeoutMs = 180_000,
  maxLineBytes = 64 * 1024, now = Date.now } = {}) {
  check(input && typeof input.on === 'function' && output && typeof output.write === 'function'
    && positive(timeoutMs) && timeoutMs <= 300_000 && positive(maxLineBytes)
    && maxLineBytes <= 1024 * 1024 && typeof now === 'function', 'peer_options_invalid')
  let buffer = Buffer.alloc(0), failure, closed = false
  const pending = new Map()
  function fail(code) {
    if (failure || closed) return
    failure = new HostBridgeError(code)
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(failure) }
    pending.clear()
  }
  function assertOpen() { if (failure) throw failure; check(!closed, 'peer_closed') }
  function emit(message) {
    assertOpen()
    if (output.destroyed || output.writableEnded) { fail('output_closed'); throw failure }
    try { output.write(`${JSON.stringify(message)}\n`) } catch { fail('output_failed'); throw failure }
  }
  function onData(chunk) {
    if (failure || closed) return
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    buffer = Buffer.concat([buffer, bytes])
    while (!failure) {
      const end = buffer.indexOf(10)
      if (end < 0) { if (buffer.length > maxLineBytes) fail('input_too_large'); break }
      if (end > maxLineBytes) { fail('input_too_large'); break }
      const line = buffer.subarray(0, end)
      buffer = buffer.subarray(end + 1)
      let message
      try { message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)) }
      catch { fail('input_invalid'); break }
      if (!exact(message, ['schema', 'type', 'requestId', 'kind', 'result'])
        || message.schema !== 1 || message.type !== 'response' || !UUID.test(message.requestId)
        || !KINDS.has(message.kind)) { fail('response_invalid'); break }
      const item = pending.get(message.requestId)
      if (!item || item.kind !== message.kind) { fail('response_unexpected'); break }
      // A delayed event loop may deliver data before an already due timer.
      // Enforce the same monotonic deadline at the response boundary too.
      if (performance.now() >= item.deadline) { fail('response_timeout'); break }
      // Remove before resolving. A duplicate in the same chunk poisons the
      // session before a promise continuation could emit a promotion request.
      pending.delete(message.requestId)
      clearTimeout(item.timer)
      try {
        const value = item.validate(message.result, item.requestedAt)
        if (performance.now() >= item.deadline) {
          fail('response_timeout'); item.reject(failure); break
        }
        item.resolve(value)
      }
      catch { fail('result_invalid'); item.reject(failure) }
    }
  }
  const onEnd = () => fail('input_ended')
  const onClose = () => fail('input_closed')
  const onError = () => fail('input_failed')
  const onOutputError = () => fail('output_failed')
  const onOutputClose = () => fail('output_closed')
  input.on('data', onData); input.on('end', onEnd); input.on('close', onClose); input.on('error', onError)
  output.on?.('error', onOutputError); output.on?.('close', onOutputClose)
  return Object.freeze({
    assertOpen,
    request(kind, payload, validate, requestTimeoutMs = timeoutMs) {
      assertOpen()
      check(KINDS.has(kind) && object(payload) && typeof validate === 'function'
        && positive(requestTimeoutMs) && requestTimeoutMs <= timeoutMs, 'request_invalid')
      const requestId = randomUUID(), requestedAt = now(), deadline = performance.now() + requestTimeoutMs
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail('response_timeout'), requestTimeoutMs)
        pending.set(requestId, { kind, requestedAt, deadline, validate, resolve, reject, timer })
        try { emit({ schema: 1, type: 'request', requestId, kind, requestedAt, payload }) }
        catch { clearTimeout(timer); pending.delete(requestId); reject(failure || new HostBridgeError('output_failed')) }
      })
    },
    event(event, result) { emit({ schema: 1, type: 'event', event, result }) },
    // A terminal summary may still be sent after invalid stdin; it contains
    // only caller-selected fixed status codes, never the bad input or errors.
    terminal(result) {
      try { output.write(`${JSON.stringify({ schema: 1, type: 'event', event: 'finished', result })}\n`) } catch {}
    },
    close() {
      if (closed) return
      fail('peer_closed'); closed = true
      input.removeListener('data', onData); input.removeListener('end', onEnd); input.removeListener('close', onClose); input.removeListener('error', onError)
      output.removeListener?.('error', onOutputError); output.removeListener?.('close', onOutputClose)
      buffer = Buffer.alloc(0)
    },
  })
}

function observed(value, startedAt, now) {
  check(positive(value) && value >= startedAt && value <= now(), 'observation_invalid')
}
function summary(result) {
  const statuses = ['prepared', 'reconcile_only', 'ready_read_only', 'verified', 'unresolved', 'blocked']
  const safe = { status: statuses.includes(result?.status) ? result.status : 'blocked',
    singleToolInvocationProtocol: true, singleHttpAttempt: false,
    internalHttpAttempts: 'unknown', claimsAtomicCronHandoff: false }
  if (ID.test(result?.deploymentId)) safe.deploymentId = result.deploymentId
  for (const name of ['readOnly', 'authorizesCreation', 'authorizesRelease', 'promotionAttempted', 'receiptUnknown', 'requiresReadOnlyReconciliation', 'runtimeOriginBaselineVerified']) {
    if (typeof result?.[name] === 'boolean') safe[name] = result[name]
  }
  // Core-generated codes only; no provider/CLI/error message is returned.
  if (typeof result?.reason === 'string' && /^supervised_[a-z_]{1,80}$/.test(result.reason)) safe.reason = result.reason
  safe.timings = Object.fromEntries(Object.entries(result?.timings || {}).filter(([key, value]) =>
    ['preparedAt', 'readyObservedAt', 'finalAliasesAt', 'reservedAt', 'promotionInvokedAt', 'promotionReturnedAt', 'verifiedAt'].includes(key) && positive(value)))
  return safe
}
function publicInventory(raw) {
  check(Array.isArray(raw) && raw.length <= 10_000, 'inventory_invalid')
  return raw.map(item => {
    check(object(item) && ID.test(item.id)
      && ['QUEUED', 'INITIALIZING', 'BUILDING', 'READY', 'ERROR', 'CANCELED', 'BLOCKED'].includes(item.readyState), 'inventory_invalid')
    const out = { id: item.id, readyState: item.readyState }
    if (item.readySubstate !== undefined) {
      check(['STAGED', 'PROMOTED', 'ROLLING'].includes(item.readySubstate), 'inventory_invalid')
      out.readySubstate = item.readySubstate
    }
    if (item.createdAt !== undefined) { check(positive(item.createdAt), 'inventory_invalid'); out.createdAt = item.createdAt }
    if (item.aliasAssigned !== undefined) { check(typeof item.aliasAssigned === 'boolean', 'inventory_invalid'); out.aliasAssigned = item.aliasAssigned }
    return out
  })
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export async function runSupervisedHost({ scope: rawScope, directory, execute = false,
  reconcileDeploymentId, peer, reads, store, now = Date.now, handoffOptions = {} } = {}) {
  let result
  try {
    const scope = validateHostScope(rawScope)
    check(typeof execute === 'boolean' && !(execute && reconcileDeploymentId)
      && (reconcileDeploymentId === undefined || ID.test(reconcileDeploymentId)), 'options_invalid')
    const journal = store || createReleaseStore(directory)
    const metadata = reads || createCliAdapter({ teamId: scope.teamId, repositoryId: scope.repositoryId, execute: false })
    // Check peer state before and after every read, including parallel reads.
    const guarded = Object.fromEntries(['readSnapshot', 'readCandidates', 'readDeployment', 'readAliases', 'readIdentity', 'readRootRedirect'].map(name => [name,
      async (...args) => { peer.assertOpen(); const value = await metadata[name](...args); peer.assertOpen(); return value }]))
    let emittedPromotion = false
    const adapter = createConnectorHostAdapter({ reads: guarded, teamId: scope.teamId, execute, now,
      requestPromote: async args => {
        peer.assertOpen()
        const intent = journal.read('promote-intent.json')
        check(execute && !emittedPromotion && exact(args, ['projectId', 'teamId', 'deploymentId'])
          && args.projectId === scope.projectId && args.teamId === scope.teamId && ID.test(args.deploymentId)
          && intent?.kind === 'supervised-connector' && intent.action === 'invoke_once'
          && intent.scope?.deploymentId === args.deploymentId
          && SCOPE_KEYS.every(key => intent.scope?.[key] === scope[key]), 'promotion_not_reserved')
        emittedPromotion = true
        // Transport's own 10s deadline remains authoritative. Eight seconds
        // here closes the RPC first; late/ambiguous outcomes retain the journal.
        const receipt = await peer.request('promote', args, value => {
          check(exact(value, ['outcome']) && ['tool_returned', 'unknown'].includes(value.outcome), 'promotion_receipt_invalid')
          return value
        }, 8_000)
        check(receipt.outcome === 'tool_returned', 'promotion_outcome_unknown')
        return { isError: false, content: [] }
      },
      captureBrowserIdentity: request => peer.request('capture_browser_identity', {
        requestedUrl: request.requestedUrl, origin: request.origin, nonce: request.nonce, requestedAt: request.requestedAt,
      }, value => {
        check(exact(value, ['captureMode', 'requestedUrl', 'observedUrl', 'observedAt', 'evidenceRef', 'identity'])
          && exact(value.identity, ['schema', 'environment', 'deploymentId', 'commit', 'projectRef', 'appOrigin', 'nonce']), 'browser_receipt_invalid')
        // The browser reader enforces exact URL/nonce, identity grammar, age and
        // one-use evidence. It cannot independently authenticate screen review.
        return value
      }),
    })
    const handoff = createSupervisedHandoff({ ...handoffOptions, store: journal, adapter, scope, now,
      prepareHostResources: ({ scope: preparedScope }) => peer.request('prepare_resources', { scope: preparedScope,
        requirements: ['existing_metadata_readers', 'existing_connector', 'existing_browser_session', 'exact_release_authorization_if_execute'],
        executeRequested: execute }, (value, startedAt) => {
        check(exact(value, ['ready', 'observedAt', 'evidenceRef']) && value.ready === true && ref(value.evidenceRef), 'resources_receipt_invalid')
        observed(value.observedAt, startedAt, now)
        return value
      }),
      reviewHistory: request => {
        const inventory = publicInventory(request.inventory.items)
        const baseline = request.baseline ? publicInventory(request.baseline) : undefined
        return peer.request('review_history', { phase: request.phase, scope: request.scope, inventory,
          inventoryDigest: digest(inventory), ...(baseline ? { baseline, baselineDigest: digest(baseline) } : {}),
          ...(request.candidateId ? { candidateId: request.candidateId } : {}) }, (value, startedAt) => {
          check(exact(value, ['reviewed', 'observedAt', 'evidenceRef']) && value.reviewed === true && ref(value.evidenceRef), 'history_receipt_invalid')
          observed(value.observedAt, startedAt, now)
          return value
        })
      },
    })
    if (reconcileDeploymentId) result = await handoff.reconcile({ deploymentId: reconcileDeploymentId })
    else {
      const prepared = await handoff.prepare()
      if (prepared.status !== 'prepared') result = prepared
      else {
        peer.event('prepared', { ...summary(prepared), scope, preparedAt: prepared.preparation.preparedAt })
        const { deploymentId } = await peer.request('supply_candidate', { scope,
          preparedAt: prepared.preparation.preparedAt, createsDeployment: false }, value => {
          check(exact(value, ['deploymentId']) && ID.test(value.deploymentId)
            && value.deploymentId !== scope.previousDeploymentId, 'candidate_invalid')
          return value
        })
        peer.assertOpen()
        result = await handoff.watch({ preparation: prepared.preparation, deploymentId, execute })
      }
    }
  } catch (error) {
    result = { status: 'blocked', reason: error instanceof HostBridgeError ? error.code : 'supervised_host_failed',
      requiresReadOnlyReconciliation: true }
  }
  const safe = summary(result)
  peer.terminal(safe)
  return safe
}

function cliOptions(argv) {
  const options = {}, seen = new Set()
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    check(['--scope', '--journal', '--execute', '--reconcile'].includes(key) && !seen.has(key), 'arguments_invalid')
    seen.add(key)
    if (key === '--execute') options.execute = true
    else { check(typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('--'), 'arguments_invalid'); options[key.slice(2)] = argv[++i] }
  }
  check(options.scope && options.journal && !(options.execute && options.reconcile), 'arguments_invalid')
  return options
}
let main = false
try { main = Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) } catch {}
if (main) {
  let peer, rawMode = false
  try {
    const options = cliOptions(process.argv.slice(2))
    const bytes = readFileSync(options.scope)
    check(bytes.length <= 16 * 1024, 'scope_file_too_large')
    const scope = validateHostScope(JSON.parse(bytes.toString('utf8')))
    // exec_command tty:false closes stdin on this Mac. PTY raw mode keeps the
    // process alive and disables echo; no receipt is interpolated into a shell.
    if (process.stdin.isTTY) { process.stdin.setRawMode(true); rawMode = true }
    peer = createJsonLinePeer({ input: process.stdin, output: process.stdout })
    process.stdin.resume()
    const result = await runSupervisedHost({ scope, directory: options.journal, execute: options.execute || false,
      reconcileDeploymentId: options.reconcile, peer })
    if (!['ready_read_only', 'verified'].includes(result.status)) process.exitCode = 1
  } catch {
    // Deliberately no path, input, stack or subprocess error text.
    process.stderr.write('Supervised host blocked: invalid input or unavailable local session.\n')
    process.exitCode = 1
  } finally {
    peer?.close()
    if (rawMode) { try { process.stdin.setRawMode(false) } catch {} }
    process.stdin.pause()
  }
}
