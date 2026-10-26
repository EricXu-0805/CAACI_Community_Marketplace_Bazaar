import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createReleaseStore } from './run-ci-first-release.mjs'
import { REQUIRED_RELEASE_CHECKS, RELEASE_PROJECT, RELEASE_REPOSITORY } from './check-ci-first-release.mjs'
import { createSupervisedHandoff } from './ci-first-release-supervised-handoff.mjs'

const START = 1_800_000_000_000
const SHA = 'a'.repeat(40)
const ID = 'dpl_Candidate'
const OLD = 'dpl_Old'
const TEAM = 'team_Fixture'
const REPO = 12345
const RUN = 731
const ATTEMPT = 2
const WWW = 'https://www.illinimarket.com'
const ORIGIN = 'https://candidate-fixture.vercel.app'
const inventoryItem = (id, extra = {}) => ({ id, projectId: RELEASE_PROJECT, teamId: TEAM,
  target: 'production', readyState: 'READY', readySubstate: 'STAGED', ...extra })
const scope = Object.freeze({ projectId: RELEASE_PROJECT, teamId: TEAM, repositoryId: REPO,
  requestedSha: SHA, runId: RUN, runAttempt: ATTEMPT, previousDeploymentId: OLD })
const clone = value => structuredClone(value)
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

function fixture(t, extra = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'illini-supervised-handoff-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const disk = createReleaseStore(directory)
  const calls = []
  const counts = {}
  const state = { time: START, candidateExists: false, promoted: false, aliases: null,
    readyStates: [], readyState: 'READY', history: [], hooks: {}, mutate: {}, onIntent: null }
  const record = name => { calls.push(name); counts[name] = (counts[name] || 0) + 1 }
  const perform = async (name, make, input) => {
    record(name)
    if (state.hooks[name]) await state.hooks[name](input, counts[name])
    const value = make()
    state.mutate[name]?.(value, input, counts[name])
    return value
  }
  const store = { ...disk, write(name, value) {
    disk.write(name, value)
    calls.push(`persisted:${name}`)
    if (name === 'promote-intent.json') {
      queueMicrotask(() => calls.push('intent-microtask'))
      state.onIntent?.(value)
    }
  } }
  const snapshot = () => ({ requestedSha: SHA, mainSha: SHA, projectId: RELEASE_PROJECT,
    teamId: TEAM, repositoryId: REPO, vercelConfig: { git: { deploymentEnabled: false } },
    productionCandidates: { projectId: RELEASE_PROJECT, teamId: TEAM, complete: true,
      items: [...clone(state.history), ...(state.candidateExists ? [inventoryItem(ID)] : [])] },
    run: { id: RUN, run_attempt: ATTEMPT, repository: { id: REPO, full_name: RELEASE_REPOSITORY },
      path: '.github/workflows/ci.yml', name: 'CI', head_branch: 'main', head_sha: SHA,
      event: 'push', status: 'completed', conclusion: 'success' },
    jobs: { run_id: RUN, run_attempt: ATTEMPT, complete: true,
      items: REQUIRED_RELEASE_CHECKS.map(name => ({ name, status: 'completed', conclusion: 'success',
        run_id: RUN, run_attempt: ATTEMPT, head_sha: SHA })) } })
  const deployment = () => ({ id: ID, projectId: RELEASE_PROJECT, teamId: TEAM, target: 'production',
    readyState: state.readyStates.shift() || state.readyState, createdAt: START + 1, url: ORIGIN,
    gitSource: { type: 'github', repoId: REPO, ref: 'main', sha: SHA } })
  const aliases = () => ({ projectId: RELEASE_PROJECT, teamId: TEAM, complete: true,
    items: ['illinimarket.com', 'www.illinimarket.com'].map((alias, i) => ({ alias,
      projectId: RELEASE_PROJECT, deploymentId: state.aliases?.[i] || (state.promoted ? ID : OLD) })) })
  const adapter = {
    verifyPromotionSupport: () => perform('support', () => ({ method: 'POST',
      pathTemplate: '/v10/projects/{projectId}/promote/{deploymentId}', force: false,
      singleAttempt: false, singleToolInvocation: true, transport: 'connector', internalHttpAttempts: 'unknown' })),
    readSnapshot: input => perform('snapshot', snapshot, input),
    readDeployment: input => perform('deployment', deployment, input),
    readAliases: input => perform('aliases', aliases, input),
    readIdentity: input => perform(input.origin === WWW ? 'formal-identity' : 'candidate-identity',
      () => ({ schema: 1, environment: 'production', deploymentId: ID, commit: SHA,
        projectRef: 'lfhvgprfphyfvhidegum', appOrigin: 'https://illinimarket.com', nonce: input.nonce }), input),
    readRootRedirect: () => perform('redirect', () => ({ status: 308, location: `${WWW}/` })),
    async promote(input) {
      record('promote')
      assert.deepEqual(input, { deploymentId: ID })
      const intent = JSON.parse(readFileSync(join(directory, 'promote-intent.json'), 'utf8'))
      assert.equal(intent.scope.deploymentId, ID, 'real durable intent must exist before dummy host invocation')
      assert.equal(intent.scope.requestedSha, SHA)
      if (state.hooks.promote) return state.hooks.promote(input)
      state.promoted = true
      return { invoked: true, receipt: 'tool_returned' }
    },
  }
  const options = { store, adapter, scope, now: () => state.time,
    wait: async ms => { record('wait'); state.time += ms }, pollMs: 20, maxReadyMs: 100, maxObserveMs: 100,
    operationTimeoutMs: 200, maxEvidenceAgeMs: 60_000,
    prepareHostResources: () => perform('resources', () => ({ ready: true, evidenceRef: 'fixture-host-ready.json' })),
    reviewHistory: input => perform(`history:${input.phase}`, () => ({ reviewed: true,
      observedAt: state.time, evidenceRef: `fixture-history-${input.phase}.json` }), input), ...extra }
  const coordinator = createSupervisedHandoff(options)
  const f = { directory, disk, store, calls, counts, state, adapter, options, coordinator, snapshot, deployment,
    recreate: replacement => createSupervisedHandoff({ ...options, store: createReleaseStore(directory), ...replacement }),
    async prepare(target = coordinator) {
      const result = await target.prepare()
      if (result.status === 'prepared') state.time++
      return result
    },
    watch(preparation, execute = true, target = coordinator) {
      state.candidateExists = true
      return target.watch({ preparation, deploymentId: ID, execute })
    },
  }
  return f
}

async function prepared(f, target) {
  const result = await f.prepare(target)
  assert.equal(result.status, 'prepared', JSON.stringify(result))
  assert.ok(result.preparation)
  return result.preparation
}

function noPromotion(f) {
  assert.equal(f.counts.promote || 0, 0)
  assert.equal(f.disk.has('verified.json'), false)
}

test('host preparation must succeed before a candidate handoff can start', async t => {
  for (const mutation of [
    f => { f.state.mutate.resources = r => { r.ready = false } },
    f => { f.state.hooks.resources = () => { throw new Error('DUMMY_PRIVATE_HOST_ERROR') } },
    f => { f.state.mutate.support = r => { r.force = true } },
    f => { f.state.mutate.snapshot = r => { r.mainSha = 'b'.repeat(40) } },
    f => { f.state.mutate['history:prepare'] = r => { r.reviewed = false } },
  ]) {
    const f = fixture(t); mutation(f)
    const result = await f.prepare()
    assert.equal(result.status, 'blocked')
    assert.equal(result.preparation, undefined)
    assert.equal(f.counts.deployment || 0, 0)
    assert.equal(f.counts['candidate-identity'] || 0, 0)
    assert.doesNotMatch(JSON.stringify(result), /DUMMY_PRIVATE_HOST_ERROR/)
    noPromotion(f)
  }
})

test('a cloned or foreign-factory preparation cannot start candidate reads', async t => {
  const f = fixture(t); const p = await prepared(f)
  for (const [preparation, target] of [[clone(p), f.coordinator], [p, f.recreate()]]) {
    const result = await f.watch(preparation, true, target)
    assert.equal(result.status, 'blocked')
    assert.equal(f.counts.deployment || 0, 0)
  }
  noPromotion(f)
})

test('READY polling is bounded and terminal build failures never reach promotion', async t => {
  for (const status of ['ERROR', 'CANCELED', 'BLOCKED', 'UNKNOWN']) {
    const f = fixture(t); const p = await prepared(f); f.state.readyState = status
    const result = await f.watch(p)
    assert.equal(result.status, 'blocked', status)
    assert.equal(f.counts.deployment, 1)
    noPromotion(f)
  }
  const f = fixture(t); const p = await prepared(f); f.state.readyState = 'BUILDING'
  const result = await f.watch(p)
  assert.ok(['blocked', 'unresolved'].includes(result.status), JSON.stringify(result))
  assert.ok(f.counts.deployment <= 7, 'bounded number of polls under the injected deadline')
  assert.ok(f.counts.wait <= 6)
  noPromotion(f)
})

test('a hung READY metadata read times out without an unbounded wait or write', { timeout: 2000 }, async t => {
  const f = fixture(t, { operationTimeoutMs: 20 }); const p = await prepared(f)
  f.state.hooks.deployment = () => new Promise(() => {})
  const result = await f.watch(p)
  assert.ok(['blocked', 'unresolved'].includes(result.status))
  assert.equal(f.counts.deployment, 1)
  noPromotion(f)
})

test('READY triggers independent metadata, CI and candidate identity reads concurrently before final aliases', async t => {
  const f = fixture(t); const p = await prepared(f)
  f.calls.length = 0
  const gate = deferred(); const started = new Set()
  const hold = name => { started.add(name); return gate.promise }
  f.state.hooks.snapshot = () => hold('snapshot')
  f.state.hooks.deployment = (_input, count) => count > 1 ? hold('deployment') : undefined
  f.state.hooks['candidate-identity'] = () => hold('identity')
  const pending = f.watch(p)
  await tick()
  assert.deepEqual([...started].sort(), ['deployment', 'identity', 'snapshot'])
  assert.equal(f.calls.includes('promote'), false)
  assert.equal(f.calls.includes('aliases'), false, 'final aliases must wait for the fresh prerequisite reads')
  gate.resolve()
  assert.equal((await pending).status, 'verified')
  assert.equal(f.counts.promote, 1)
})

test('intent is fsynced before the sole dummy Promote, with no intervening await or host read', async t => {
  const f = fixture(t); const p = await prepared(f)
  f.state.readyStates = ['QUEUED', 'BUILDING', 'READY']
  const result = await f.watch(p)
  assert.equal(result.status, 'verified')
  const persisted = f.calls.indexOf('persisted:promote-intent.json')
  const invoked = f.calls.indexOf('promote')
  assert.ok(persisted >= 0 && invoked === persisted + 1, f.calls.join(', '))
  assert.ok(invoked < f.calls.indexOf('intent-microtask'), 'no asynchronous gap after reservation')
  assert.equal(f.counts.promote, 1)
  assert.equal(result.claimsAtomicCronHandoff, false)
  assert.equal(result.internalHttpAttempts, 'unknown')
  assert.equal(result.singleHttpAttempt, false)
  assert.equal(result.callCounts.promote, 1)
  assert.equal(result.readCounts.promote, undefined)
  assert.equal(result.observations.filter(item => item.operation === 'promote').length, 1)
  assert.equal(f.disk.read('promote-intent.json').singleHttpAttempt, false)
  assert.equal(f.disk.read('verified.json').scope.deploymentId, ID)
})

test('execute defaults to read-only and does not consume an otherwise unstarted handoff', async t => {
  const f = fixture(t); const p = await prepared(f)
  const result = await f.watch(p, false)
  assert.equal(result.status, 'ready_read_only')
  assert.equal(f.disk.has('promote-intent.json'), false)
  noPromotion(f)
})

test('fresh exact main, CI attempt, jobs and target changes block before intent', async t => {
  for (const mutate of [
    s => { s.mainSha = 'b'.repeat(40) },
    s => { s.run.run_attempt++ },
    s => { s.run.id++ },
    s => { s.run.head_sha = 'b'.repeat(40) },
    s => { s.jobs.complete = false },
    s => { s.jobs.items[0].conclusion = 'skipped' },
    s => { s.teamId = 'team_Other' },
    s => { s.repositoryId++ },
    s => { s.vercelConfig.git.deploymentEnabled = true },
    s => { s.productionCandidates.items.push(inventoryItem('dpl_Competing')) },
  ]) {
    const f = fixture(t); const p = await prepared(f); f.state.mutate.snapshot = mutate
    assert.equal((await f.watch(p)).status, 'blocked')
    assert.equal(f.disk.has('promote-intent.json'), false)
    noPromotion(f)
  }
})

test('candidate metadata and full runtime nonce identity must bind the prepared scope', async t => {
  for (const [key, mutate] of [
    ['deployment', d => { d.gitSource.sha = 'b'.repeat(40) }],
    ['deployment', d => { d.gitSource.ref = 'other' }],
    ['deployment', d => { d.gitSource.repoId++ }],
    ['deployment', d => { d.projectId = 'prj_Other' }],
    ['deployment', d => { d.teamId = 'team_Other' }],
    ['deployment', d => { d.target = 'preview' }],
    ['deployment', d => { d.createdAt = START - 1 }],
    ['candidate-identity', i => { i.deploymentId = OLD }],
    ['candidate-identity', i => { i.commit = 'b'.repeat(40) }],
    ['candidate-identity', i => { i.nonce = '00000000-0000-4000-8000-000000000000' }],
    ['candidate-identity', i => { i.projectRef = 'x'.repeat(20) }],
    ['candidate-identity', i => { i.environment = 'preview' }],
  ]) {
    const f = fixture(t); const p = await prepared(f); f.state.mutate[key] = mutate
    assert.equal((await f.watch(p)).status, 'blocked', key)
    assert.equal(f.disk.has('promote-intent.json'), false)
    noPromotion(f)
  }
})

test('a candidate URL changing between READY and its fresh metadata cannot borrow an earlier identity', async t => {
  const f = fixture(t); const p = await prepared(f)
  f.state.mutate.deployment = (d, _input, count) => { if (count > 1) d.url = 'https://other-fixture.vercel.app' }
  assert.equal((await f.watch(p)).status, 'blocked')
  noPromotion(f)
})

test('slow human/history evidence expires the other observations without silently refreshing or promoting', async t => {
  const f = fixture(t, { maxEvidenceAgeMs: 10 }); const p = await prepared(f)
  f.state.hooks['history:ready'] = () => { f.state.time += 11 }
  const result = await f.watch(p)
  assert.equal(result.status, 'blocked')
  assert.equal(f.counts.snapshot, 2, 'do not repeatedly fetch full history until it appears to pass')
  noPromotion(f)
})

test('historical inventory changes or an unapproved history review cannot authorize promotion', async t => {
  for (const change of [
    f => { f.state.history.push(inventoryItem('dpl_NewHistory')) },
    f => { f.state.history = [] },
    f => { f.state.history[0].readyState = 'BUILDING' },
    f => { f.state.history[0].readySubstate = 'ROLLING' },
    f => { f.state.mutate['history:ready'] = r => { r.reviewed = false } },
  ]) {
    const f = fixture(t); f.state.history = [inventoryItem('dpl_Historical')]
    const p = await prepared(f); change(f)
    assert.equal((await f.watch(p)).status, 'blocked')
    noPromotion(f)
  }
})

test('foreign or incomplete final aliases block, while observed partial/full switching becomes durably read-only', async t => {
  for (const ids of [[OLD, 'dpl_Foreign'], [ID, 'dpl_Foreign']]) {
    const f = fixture(t); const p = await prepared(f); f.state.aliases = ids
    assert.equal((await f.watch(p)).status, 'blocked')
    noPromotion(f)
  }
  for (const mutate of [a => { a.complete = false }, a => { a.items.pop() },
    a => { a.items[1] = clone(a.items[0]) }, a => { a.teamId = 'team_Other' }]) {
    const f = fixture(t); const p = await prepared(f); f.state.mutate.aliases = mutate
    assert.equal((await f.watch(p)).status, 'blocked')
    assert.equal(f.disk.has('promote-intent.json'), false)
    noPromotion(f)
  }
  for (const ids of [[OLD, ID], [ID, OLD], [ID, ID]]) {
    const f = fixture(t); const p = await prepared(f); f.state.aliases = ids
    await f.watch(p, false)
    assert.equal(f.disk.read('promote-intent.json').action, 'observe_existing_transition')
    f.state.aliases = [OLD, OLD]
    await f.recreate().watch({ deploymentId: ID, execute: true })
    assert.equal(f.counts.promote || 0, 0)
  }
})

test('a preparation binds its first candidate even after a read-only or failed watch', async t => {
  for (const fail of [false, true]) {
    const f = fixture(t); const p = await prepared(f)
    if (fail) f.state.readyState = 'ERROR'
    const first = await f.watch(p, false)
    assert.equal(first.status, fail ? 'blocked' : 'ready_read_only')
    const reads = f.counts.deployment
    const changed = await f.coordinator.watch({ preparation: p, deploymentId: 'dpl_Other', execute: true })
    assert.equal(changed.status, 'blocked')
    assert.equal(f.counts.deployment, reads, 'changing the candidate is rejected before a new metadata read')
    noPromotion(f)
  }
})

test('the actual default watch argument is read-only and a stable history remains admissible', async t => {
  const f = fixture(t); f.state.history = [inventoryItem('dpl_Historical')]
  const p = await prepared(f); f.state.candidateExists = true
  const result = await f.coordinator.watch({ preparation: p, deploymentId: ID })
  assert.equal(result.status, 'ready_read_only')
  assert.equal(f.disk.has('promote-intent.json'), false)
  noPromotion(f)
})

test('a timed-out host preparation never schedules later candidate work', { timeout: 2000 }, async t => {
  const f = fixture(t, { operationTimeoutMs: 20 })
  const late = deferred(); f.state.hooks.resources = () => late.promise
  assert.equal((await f.prepare()).status, 'blocked')
  late.resolve(); await tick()
  assert.equal(f.counts.support || 0, 0)
  assert.equal(f.counts.deployment || 0, 0)
  noPromotion(f)
})

test('an unknown host receipt can be resolved by actual readback without a second call', async t => {
  const f = fixture(t); const p = await prepared(f)
  f.state.hooks.promote = () => { f.state.promoted = true; throw new Error('DUMMY_UNKNOWN') }
  const result = await f.watch(p)
  assert.equal(result.status, 'verified')
  assert.equal(result.receiptUnknown, true)
  assert.equal(f.counts.promote, 1)
  assert.equal((await f.recreate().reconcile({ deploymentId: ID })).status, 'verified')
  assert.equal(f.counts.promote, 1)
})

test('readback rechecks aliases after identity instead of treating separate reads as an atomic snapshot', async t => {
  const f = fixture(t); const p = await prepared(f)
  f.state.hooks['formal-identity'] = () => { f.state.aliases = [ID, OLD] }
  const result = await f.watch(p)
  assert.notEqual(result.status, 'verified')
  assert.equal(f.counts.promote, 1)
  assert.equal(f.disk.has('verified.json'), false)
  assert.equal(result.claimsAtomicCronHandoff, false)
})

test('the total observation deadline applies even when each individual read returns successfully', async t => {
  const f = fixture(t, { maxObserveMs: 10 }); const p = await prepared(f)
  f.state.hooks['formal-identity'] = () => { f.state.time += 11 }
  const result = await f.watch(p)
  assert.notEqual(result.status, 'verified')
  assert.equal(f.counts.promote, 1)
  assert.equal(f.disk.has('verified.json'), false)
})

test('a conflicting verified record cannot be silently accepted during recovery', async t => {
  for (const mutate of [v => { v.scope.requestedSha = 'b'.repeat(40) }, v => { v.schema = 2 },
    v => { v.scope.deploymentId = 'dpl_Other' }]) {
    const f = fixture(t); const p = await prepared(f)
    f.state.hooks.promote = () => undefined
    await f.watch(p)
    const record = { schema: 1, kind: 'supervised-connector', scope: { ...scope, deploymentId: ID } }
    mutate(record); f.disk.write('verified.json', record); f.state.promoted = true
    const result = await f.recreate().reconcile({ deploymentId: ID })
    assert.notEqual(result.status, 'verified')
    assert.deepEqual(f.disk.read('verified.json'), record)
    assert.equal(f.counts.promote, 1)
  }
})

test('a cooperating observer winning verified creation is accepted after matching-scope readback', async t => {
  const f = fixture(t); const p = await prepared(f)
  f.state.hooks.promote = () => undefined
  await f.watch(p); f.state.promoted = true
  let winningRecord, exclusiveCreateFailed = false
  const competingStore = { ...f.disk, write(name, value) {
    assert.equal(name, 'verified.json')
    // Deterministically insert a cooperating writer between the real has() and
    // exclusive create. The second real disk create must raise EEXIST.
    winningRecord = { ...value, recordedAt: value.recordedAt - 1 }
    f.disk.write(name, winningRecord)
    try { f.disk.write(name, value) }
    catch (error) { exclusiveCreateFailed = error.code === 'EEXIST'; throw error }
  } }
  const result = await f.recreate({ store: competingStore }).reconcile({ deploymentId: ID })
  assert.equal(exclusiveCreateFailed, true)
  assert.equal(result.status, 'verified')
  assert.equal(result.readOnly, true)
  assert.equal(f.counts.promote, 1)
  assert.deepEqual(f.disk.read('verified.json'), winningRecord, 'the winning record is never overwritten')
})

test('competing verified creation must retain the full scope and valid record metadata', async t => {
  const mutations = [
    value => { value.schema++ }, value => { value.kind = 'other' },
    value => { value.recordedAt = 0 }, value => { delete value.recordedAt },
    ...Object.keys({ ...scope, deploymentId: ID }).map(key => value => {
      value.scope[key] = typeof value.scope[key] === 'number' ? value.scope[key] + 1 : `${value.scope[key]}x`
    }),
  ]
  for (const mutate of mutations) {
    const f = fixture(t); const p = await prepared(f)
    f.state.hooks.promote = () => undefined
    await f.watch(p); f.state.promoted = true
    let winningRecord
    const competingStore = { ...f.disk, write(name, value) {
      winningRecord = clone(value); mutate(winningRecord)
      f.disk.write(name, winningRecord)
      f.disk.write(name, value)
    } }
    const result = await f.recreate({ store: competingStore }).reconcile({ deploymentId: ID })
    assert.equal(result.status, 'unresolved')
    assert.equal(result.requiresReadOnlyReconciliation, true)
    assert.equal(f.counts.promote, 1)
    assert.deepEqual(f.disk.read('verified.json'), winningRecord)
  }
})

test('torn competing verification and non-EEXIST persistence failures remain unresolved', async t => {
  for (const failure of ['torn', 'io']) {
    const f = fixture(t); const p = await prepared(f)
    f.state.hooks.promote = () => undefined
    await f.watch(p); f.state.promoted = true
    const failingStore = { ...f.disk, write(name, value) {
      if (failure === 'torn') {
        writeFileSync(join(f.directory, name), '{"schema":', { mode: 0o600 })
        f.disk.write(name, value)
      } else {
        f.disk.write(name, value)
        throw Object.assign(new Error('DUMMY_PERSISTENCE_UNCERTAIN'), { code: 'EIO' })
      }
    } }
    const result = await f.recreate({ store: failingStore }).reconcile({ deploymentId: ID })
    assert.equal(result.status, 'unresolved')
    assert.equal(result.requiresReadOnlyReconciliation, true)
    assert.equal(f.counts.promote, 1)
    assert.doesNotMatch(JSON.stringify(result), /DUMMY_PERSISTENCE_UNCERTAIN/)
  }
})

test('an existing intent with a different scope blocks before any recovery read', async t => {
  const f = fixture(t); const p = await prepared(f)
  f.state.hooks.promote = () => undefined; await f.watch(p)
  const reads = f.counts.deployment
  const result = await f.recreate({ scope: { ...scope, requestedSha: 'b'.repeat(40) } })
    .watch({ deploymentId: ID, execute: true })
  assert.equal(result.status, 'blocked')
  assert.equal(f.counts.deployment, reads)
  assert.equal(f.counts.promote, 1)
})

test('runtime app origin remains bound by durable intent across a new coordinator', async t => {
  const f = fixture(t); const p = await prepared(f)
  f.state.hooks.promote = () => undefined; await f.watch(p)
  assert.equal(f.disk.read('promote-intent.json').runtimeAppOrigin, 'https://illinimarket.com')
  f.state.promoted = true
  f.state.mutate['formal-identity'] = i => { i.appOrigin = WWW }
  f.state.mutate['candidate-identity'] = i => { i.appOrigin = WWW }
  const recovered = await f.recreate().reconcile({ deploymentId: ID })
  assert.notEqual(recovered.status, 'verified')
  assert.equal(f.disk.has('verified.json'), false)
  assert.equal(f.counts.promote, 1)
})

test('a reservation race reconciles against the winning intent origin instead of the losing observation', async t => {
  const f = fixture(t); const p = await prepared(f)
  f.state.hooks.aliases = (_input, count) => {
    if (count !== 2) return
    // A different cooperating process wins after this instance's initial intent
    // check but before reserve. Its durable baseline is authoritative.
    f.disk.write('promote-intent.json', { schema: 1, kind: 'supervised-connector', action: 'invoke_once',
      scope: { ...scope, deploymentId: ID }, recordedAt: f.state.time, runtimeAppOrigin: WWW })
    f.state.promoted = true
  }
  const result = await f.watch(p)
  assert.notEqual(result.status, 'verified', 'both runtime observations differ from the winning baseline')
  assert.equal(f.disk.read('promote-intent.json').runtimeAppOrigin, WWW)
  noPromotion(f)
})

test('legacy intent recovery stays read-only and discloses a missing runtime-origin baseline', async t => {
  const f = fixture(t); const p = await prepared(f)
  f.state.hooks.promote = () => undefined; await f.watch(p)
  const saved = f.disk.read('promote-intent.json'); delete saved.runtimeAppOrigin
  writeFileSync(join(f.directory, 'promote-intent.json'), JSON.stringify(saved), { mode: 0o600 })
  f.state.promoted = true
  const recovered = await f.recreate().reconcile({ deploymentId: ID })
  assert.equal(recovered.status, 'verified')
  assert.equal(recovered.runtimeOriginBaselineVerified, false)
  assert.equal(f.counts.promote, 1)
})

test('same-instance reentry while the host callback is pending is bounded and cannot invoke twice', async t => {
  const f = fixture(t); const p = await prepared(f)
  const entered = deferred(), release = deferred()
  f.state.hooks.promote = () => { entered.resolve(); return release.promise }
  const first = f.watch(p); await entered.promise
  const second = await f.watch(p)
  assert.equal(second.status, 'blocked')
  assert.equal(f.counts.promote, 1)
  f.state.promoted = true; release.resolve({ invoked: true, receipt: 'tool_returned' })
  assert.equal((await first).status, 'verified')
})

test('unknown Promote result is reconciled once and never resent by a reconstructed coordinator', async t => {
  for (const reply of ['throw', 'undefined', 'false']) {
    const f = fixture(t); const p = await prepared(f)
    f.state.hooks.promote = () => {
      if (reply === 'throw') throw new Error('DUMMY_PRIVATE_PROVIDER_PAYLOAD')
      return reply === 'false' ? false : undefined
    }
    const result = await f.watch(p)
    assert.notEqual(result.status, 'verified')
    assert.equal(f.counts.promote, 1)
    assert.ok(f.calls.indexOf('aliases', f.calls.indexOf('promote')) > f.calls.indexOf('promote'))
    assert.doesNotMatch(JSON.stringify(result), /DUMMY_PRIVATE_PROVIDER_PAYLOAD/)
    const fresh = f.recreate()
    await fresh.watch({ deploymentId: ID, execute: true })
    assert.equal(f.counts.promote, 1)
    assert.equal(f.disk.has('promote-intent.json'), true)
    assert.equal(f.disk.has('verified.json'), false)
  }
})

test('a timed-out injected host may finish later, but recovery never creates another invocation', { timeout: 2000 }, async t => {
  const f = fixture(t, { operationTimeoutMs: 20 }); const p = await prepared(f)
  const late = deferred(); f.state.hooks.promote = () => late.promise
  const result = await f.watch(p)
  assert.notEqual(result.status, 'verified')
  assert.equal(f.counts.promote, 1)
  f.state.promoted = true
  late.resolve({ invoked: true, receipt: 'tool_returned' })
  await tick()
  const recovered = await f.recreate().reconcile({ deploymentId: ID })
  assert.equal(recovered.status, 'verified')
  assert.equal(f.counts.promote, 1)
})

test('persistence becomes uncertain after the actual intent write: no host call, no restart resend', async t => {
  const f = fixture(t); const p = await prepared(f)
  f.state.onIntent = () => { throw new Error('DUMMY_FSYNC_UNCERTAIN') }
  const result = await f.watch(p)
  assert.ok(['blocked', 'unresolved'].includes(result.status))
  assert.equal(f.disk.has('promote-intent.json'), true)
  await f.recreate().reconcile({ deploymentId: ID })
  noPromotion(f)
})

test('evidence expiring during durable reservation cannot authorize a late Promote', async t => {
  const f = fixture(t, { maxEvidenceAgeMs: 10 }); const p = await prepared(f)
  f.state.onIntent = () => { f.state.time += 11 }
  const result = await f.watch(p)
  assert.notEqual(result.status, 'verified')
  assert.equal(f.disk.has('promote-intent.json'), true)
  assert.equal(f.counts.promote || 0, 0, 'durable writes may consume the evidence age budget')
  await f.recreate().reconcile({ deploymentId: ID })
  noPromotion(f)
})

test('a clock failure before adapter entry keeps intent without falsely reporting a Promote invocation', async t => {
  let f, reserved = false, postReserveClockCalls = 0
  f = fixture(t, { now: () => {
    if (reserved && ++postReserveClockCalls > 2) throw new Error('DUMMY_CLOCK_FAILED')
    return f.state.time
  } })
  const p = await prepared(f); f.state.onIntent = () => { reserved = true }
  const result = await f.watch(p)
  assert.equal(f.disk.has('promote-intent.json'), true)
  assert.equal(f.counts.promote || 0, 0)
  assert.equal(result.promotionAttempted, false)
  assert.equal(result.readOnly, true)
  assert.doesNotMatch(JSON.stringify(result), /DUMMY_CLOCK_FAILED/)
})

test('a torn intent or abandoned lock cannot be mistaken for a new release', async t => {
  for (const kind of ['intent', 'lock']) {
    const f = fixture(t); const p = await prepared(f)
    const file = kind === 'intent' ? 'promote-intent.json' : `${RELEASE_PROJECT}.lock`
    writeFileSync(join(f.directory, file), kind === 'intent' ? '{"schema":' : '999999\n', { mode: 0o600 })
    const result = await f.watch(p)
    assert.ok(['blocked', 'unresolved'].includes(result.status))
    assert.equal(existsSync(join(f.directory, file)), true)
    noPromotion(f)
  }
})

test('another coordinator while the first host call is pending observes durable intent and cannot send', async t => {
  const f = fixture(t); const p = await prepared(f)
  const entered = deferred(), release = deferred()
  f.state.hooks.promote = () => { entered.resolve(); return release.promise }
  const first = f.watch(p)
  await entered.promise
  const before = { resources: f.counts.resources, support: f.counts.support,
    snapshot: f.counts.snapshot, history: f.counts['history:ready'] }
  const second = await f.recreate().watch({ deploymentId: ID, execute: true })
  assert.notEqual(second.status, 'verified')
  assert.deepEqual({ resources: f.counts.resources, support: f.counts.support,
    snapshot: f.counts.snapshot, history: f.counts['history:ready'] }, before)
  assert.equal(f.counts.promote, 1)
  f.state.promoted = true; release.resolve({ invoked: true, receipt: 'tool_returned' })
  await first
  assert.equal(f.counts.promote, 1)
})

test('two prepared coordinators sharing a real journal can race only to one host invocation', async t => {
  const f = fixture(t)
  const a = f.coordinator, b = f.recreate()
  const pa = await prepared(f, a), pb = await prepared(f, b)
  const results = await Promise.all([f.watch(pa, true, a), f.watch(pb, true, b)])
  assert.equal(f.counts.promote, 1)
  assert.ok(results.some(r => r.status === 'verified'))
  assert.equal(f.disk.read('promote-intent.json').scope.deploymentId, ID)
})

test('independent Node processes racing one journal emit at most one durable dummy host receipt', { timeout: 10_000 }, async t => {
  const f = fixture(t)
  const source = `
    import { appendFileSync, readFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { createInterface } from 'node:readline';
    import { createSupervisedHandoff } from ${JSON.stringify(new URL('./ci-first-release-supervised-handoff.mjs', import.meta.url).href)};
    import { createReleaseStore } from ${JSON.stringify(new URL('./run-ci-first-release.mjs', import.meta.url).href)};
    import { REQUIRED_RELEASE_CHECKS, RELEASE_REPOSITORY } from ${JSON.stringify(new URL('./check-ci-first-release.mjs', import.meta.url).href)};
    const lines = createInterface({ input: process.stdin });
    let scope, dir, resume, clock = ${START}, exists = false, preparation, handoff;
    const id = ${JSON.stringify(ID)}, old = ${JSON.stringify(OLD)}, origin = ${JSON.stringify(ORIGIN)};
    const identity = nonce => ({ schema: 1, environment: 'production', deploymentId: id,
      commit: scope.requestedSha, projectRef: 'lfhvgprfphyfvhidegum', appOrigin: 'https://illinimarket.com', nonce });
    for await (const line of lines) {
      if (!handoff) {
        ({ scope, directory: dir, resume } = JSON.parse(line));
        const store = createReleaseStore(dir);
        const adapter = {
          async verifyPromotionSupport() { return { transport: 'connector', method: 'POST', force: false,
            pathTemplate: '/v10/projects/{projectId}/promote/{deploymentId}', singleToolInvocation: true,
            singleAttempt: false, internalHttpAttempts: 'unknown' }; },
          async readSnapshot() { return { ...scope, mainSha: scope.requestedSha,
            vercelConfig: { git: { deploymentEnabled: false } },
            productionCandidates: { projectId: scope.projectId, teamId: scope.teamId, complete: true,
              items: exists ? [{ id, projectId: scope.projectId, teamId: scope.teamId, target: 'production', readyState: 'READY' }] : [] },
            run: { id: scope.runId, run_attempt: scope.runAttempt, repository: { id: scope.repositoryId, full_name: RELEASE_REPOSITORY },
              path: '.github/workflows/ci.yml', name: 'CI', head_branch: 'main', head_sha: scope.requestedSha,
              event: 'push', status: 'completed', conclusion: 'success' },
            jobs: { run_id: scope.runId, run_attempt: scope.runAttempt, complete: true,
              items: REQUIRED_RELEASE_CHECKS.map(name => ({ name, status: 'completed', conclusion: 'success',
                run_id: scope.runId, run_attempt: scope.runAttempt, head_sha: scope.requestedSha })) } }; },
          async readDeployment() { return { id, projectId: scope.projectId, teamId: scope.teamId, target: 'production',
            readyState: 'READY', createdAt: ${START + 1}, url: origin,
            gitSource: { type: 'github', repoId: scope.repositoryId, ref: 'main', sha: scope.requestedSha } }; },
          async readAliases() { return { projectId: scope.projectId, teamId: scope.teamId, complete: true,
            items: ['illinimarket.com', 'www.illinimarket.com'].map(alias => ({ alias, projectId: scope.projectId, deploymentId: old })) }; },
          async readIdentity({ nonce }) { return identity(nonce); },
          async readRootRedirect() { return { status: 308, location: 'https://www.illinimarket.com/' }; },
          async promote() {
            const intent = JSON.parse(readFileSync(join(dir, 'promote-intent.json'), 'utf8'));
            if (intent.scope.deploymentId !== id) throw new Error('dummy_intent_missing');
            appendFileSync(join(dir, 'dummy-host-receipts.log'), 'one\\n', { mode: 0o600 });
            return undefined;
          },
        };
        handoff = createSupervisedHandoff({ store, adapter, scope, now: () => clock,
          wait: async ms => { clock += ms }, pollMs: 20, maxReadyMs: 1000, maxObserveMs: 100, operationTimeoutMs: 1000,
          prepareHostResources: async () => {
            if (resume) throw new Error('recovery_should_not_prepare_resources');
            return { ready: true, evidenceRef: 'dummy-process-ready' };
          },
          reviewHistory: async () => {
            if (resume) throw new Error('recovery_should_not_review_history');
            return { reviewed: true, observedAt: clock, evidenceRef: 'dummy-history' };
          } });
        if (!resume) {
          const result = await handoff.prepare();
          if (result.status !== 'prepared') throw new Error('dummy_preparation_failed');
          preparation = result.preparation;
        }
        clock++;
        console.log(JSON.stringify({ type: 'ready' }));
      } else {
        if (line !== 'GO') throw new Error('dummy_bad_parent_message');
        exists = true;
        const result = resume ? await handoff.reconcile({ deploymentId: id })
          : await handoff.watch({ preparation, deploymentId: id, execute: true });
        console.log(JSON.stringify({ type: 'result', result }));
        lines.close(); process.stdin.destroy(); break;
      }
    }
  `
  const launch = (resume = false) => {
    // No inherited environment or host credentials are needed by these isolated children.
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], { env: {}, stdio: ['pipe', 'pipe', 'pipe'] })
    t.after(() => { if (child.exitCode === null) child.kill() })
    const ready = deferred(), result = deferred(), exited = deferred()
    let stderr = ''
    child.stderr.on('data', part => { stderr += part })
    createInterface({ input: child.stdout }).on('line', line => {
      try {
        const value = JSON.parse(line)
        if (value.type === 'ready') ready.resolve()
        else if (value.type === 'result') result.resolve(value.result)
      } catch (error) { ready.reject(error); result.reject(error) }
    })
    child.on('error', error => { ready.reject(error); result.reject(error); exited.reject(error) })
    child.on('close', code => {
      exited.resolve({ code, stderr })
      if (code !== 0) { const error = new Error(`dummy child failed: ${stderr}`); ready.reject(error); result.reject(error) }
    })
    child.stdin.write(`${JSON.stringify({ scope, directory: f.directory, resume })}\n`)
    return { child, ready: ready.promise, result: result.promise, exited: exited.promise }
  }
  const children = [launch(), launch()]
  await Promise.all(children.map(child => child.ready))
  for (const { child } of children) child.stdin.write('GO\n')
  const outcomes = await Promise.all(children.map(child => child.result))
  for (const outcome of outcomes) assert.ok(['blocked', 'unresolved'].includes(outcome.status), JSON.stringify(outcome))
  for (const closed of await Promise.all(children.map(child => child.exited))) assert.deepEqual(closed, { code: 0, stderr: '' })
  assert.equal(readFileSync(join(f.directory, 'dummy-host-receipts.log'), 'utf8'), 'one\n')
  assert.equal(f.disk.read('promote-intent.json').scope.deploymentId, ID)
  const restarted = launch(true)
  await restarted.ready; restarted.child.stdin.write('GO\n')
  const recovered = await restarted.result
  assert.equal(recovered.status, 'unresolved')
  assert.equal(recovered.callCounts.promote, undefined)
  assert.equal(recovered.callCounts.prepareHostResources, undefined)
  assert.deepEqual(await restarted.exited, { code: 0, stderr: '' })
  assert.equal(readFileSync(join(f.directory, 'dummy-host-receipts.log'), 'utf8'), 'one\n')
})

test('a successful tool receipt cannot replace formal identity and final alias readback', async t => {
  for (const change of [
    f => { f.state.mutate['formal-identity'] = i => { i.commit = 'b'.repeat(40) } },
    f => { f.state.mutate.redirect = r => { r.location = 'https://other.invalid/' } },
    f => { f.state.mutate.aliases = a => { if (f.state.promoted) a.items[1].deploymentId = OLD } },
    f => { f.state.mutate['candidate-identity'] = i => { if (f.state.promoted) i.appOrigin = WWW } },
  ]) {
    const f = fixture(t); const p = await prepared(f); change(f)
    const result = await f.watch(p)
    assert.notEqual(result.status, 'verified')
    assert.equal(f.counts.promote, 1)
    assert.equal(f.disk.has('verified.json'), false)
    await f.recreate().reconcile({ deploymentId: ID })
    assert.equal(f.counts.promote, 1)
  }
})
