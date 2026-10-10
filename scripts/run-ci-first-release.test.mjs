import assert from 'node:assert/strict'
import test from 'node:test'
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync, symlinkSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createReleaseAdapter, createReleaseStore, parseReleaseArguments, runCiFirstRelease } from './run-ci-first-release.mjs'
import { REQUIRED_RELEASE_CHECKS, RELEASE_PROJECT, RELEASE_REPOSITORY } from './check-ci-first-release.mjs'

const SHA = 'a'.repeat(40)
const OLD = 'dpl_Old'
const ID = 'dpl_Candidate'
const TEAM = 'team_Existing'
const REPO = 12345
const RUN = 731
const ATTEMPT = 2
const WWW = 'https://www.illinimarket.com'
const START = 1_800_000_000_000

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'illini-promote-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = createReleaseStore(dir)
  const calls = []
  const state = { time: START, promoted: false, aliasPair: null, readyStates: [], readyState: 'READY',
    snapshotMutate: () => {}, deploymentMutate: () => {}, identityMutate: () => {}, promotionError: null }
  const scope = { requestedSha: SHA, teamId: TEAM, repositoryId: REPO, runId: RUN, runAttempt: ATTEMPT }
  const options = { store, now: () => state.time, wait: async ms => { calls.push('wait'); state.time += ms }, pollMs: 1, maxReadyMs: 20, maxObserveMs: 3 }
  const adapter = {
    async verifyPromotionSupport() {
      calls.push('capability')
      return { method: 'POST', pathTemplate: '/v10/projects/{projectId}/promote/{deploymentId}', force: false, singleAttempt: true }
    },
    async readSnapshot({ candidateId }) {
      calls.push('snapshot')
      const snapshot = { requestedSha: SHA, mainSha: SHA, projectId: RELEASE_PROJECT, teamId: TEAM, repositoryId: REPO,
        vercelConfig: { git: { deploymentEnabled: false } },
        productionCandidates: { projectId: RELEASE_PROJECT, complete: true, items: candidateId ? [{ id: candidateId }] : [] },
        run: { id: RUN, run_attempt: ATTEMPT, repository: { full_name: RELEASE_REPOSITORY }, path: '.github/workflows/ci.yml',
          name: 'CI', head_branch: 'main', head_sha: SHA, event: 'push', status: 'completed', conclusion: 'success' },
        jobs: { run_id: RUN, run_attempt: ATTEMPT, complete: true, items: REQUIRED_RELEASE_CHECKS.map(name => ({ name,
          status: 'completed', conclusion: 'success', run_id: RUN, run_attempt: ATTEMPT, head_sha: SHA })) },
      }
      state.snapshotMutate(snapshot)
      return snapshot
    },
    async readDeployment({ deploymentId }) {
      calls.push('deployment')
      const d = { id: deploymentId, projectId: RELEASE_PROJECT, teamId: TEAM, target: 'production',
        readyState: state.readyStates.shift() || state.readyState, createdAt: START + 1000,
        url: 'https://candidate-example.vercel.app', gitSource: { type: 'github', repoId: REPO, ref: 'main', sha: SHA } }
      state.deploymentMutate(d)
      return d
    },
    async readAliases() {
      calls.push('aliases')
      const ids = state.aliasPair || Array(2).fill(state.promoted ? ID : OLD)
      return { projectId: RELEASE_PROJECT, teamId: TEAM, complete: true,
        items: ['illinimarket.com', 'www.illinimarket.com'].map((alias, i) => ({ alias, deploymentId: ids[i], projectId: RELEASE_PROJECT })) }
    },
    async readIdentity({ origin, nonce }) {
      calls.push(origin === WWW ? 'formal-identity' : 'candidate-identity')
      const identity = { schema: 1, environment: 'production', deploymentId: ID, commit: SHA,
        projectRef: 'lfhvgprfphyfvhidegum', appOrigin: 'https://illinimarket.com', nonce }
      state.identityMutate(identity, origin)
      return identity
    },
    async readRootRedirect() { calls.push('root-redirect'); return { status: 308, location: `${WWW}/` } },
    async promote({ deploymentId }) {
      calls.push('promote')
      assert.equal(deploymentId, ID)
      const intent = JSON.parse(readFileSync(join(dir, 'promote-intent.json')))
      assert.equal(intent.deploymentId, ID, 'durable intent precedes mutation')
      if (state.promotionError) throw new Error(state.promotionError)
      state.promoted = true
      return { accepted: true }
    },
  }
  const run = extra => runCiFirstRelease({ ...options, adapter, ...extra })
  return { dir, store, calls, state, adapter, options, scope, run,
    prepare: () => run({ mode: 'prepare', ...scope }),
    watch: (execute = false) => run({ mode: 'watch', deploymentId: ID, execute }),
  }
}

test('pre-create protocol/CI/aliases are prepared; READY immediately runs final guards and one normal promotion', async t => {
  const f = fixture(t)
  assert.equal((await f.prepare()).status, 'prepared')
  assert.deepEqual(f.calls, ['capability', 'snapshot', 'aliases'])
  f.calls.length = 0
  f.state.readyStates = ['BUILDING', 'READY']
  const outcome = await f.watch(true)
  assert.equal(outcome.status, 'verified')
  assert.equal(outcome.claimsAtomicCronHandoff, false)
  assert.equal(f.calls.filter(c => c === 'promote').length, 1)
  assert.deepEqual(f.calls.slice(0, 8), ['deployment', 'wait', 'deployment', 'snapshot', 'deployment', 'candidate-identity', 'aliases', 'promote'])
  assert.ok(existsSync(join(f.dir, 'verified.json')))
  assert.equal((await f.watch(true)).readOnly, true)
  assert.equal(f.calls.filter(c => c === 'promote').length, 1, 'successful rerun cannot promote again')
})

test('default watch is read-only and does not persist a promotion intent', async t => {
  const f = fixture(t)
  await f.prepare()
  assert.equal((await f.watch()).status, 'ready_read_only')
  assert.equal(f.calls.includes('promote'), false)
  assert.equal(f.store.has('promote-intent.json'), false)
  assert.equal((await f.watch(true)).status, 'verified')
})

test('a CLI transport with implicit retries supports inspection but explicitly blocks execution', async t => {
  const f = fixture(t)
  f.adapter.verifyPromotionSupport = async () => ({ method: 'POST', pathTemplate: '/v10/projects/{projectId}/promote/{deploymentId}', force: false, singleAttempt: false })
  const prepared = await f.prepare()
  assert.equal(prepared.status, 'prepared')
  assert.equal(prepared.executionAvailable, false)
  assert.equal(prepared.doNotCreateForThisHandoff, true)
  assert.equal((await f.watch()).status, 'ready_read_only')
  assert.equal((await f.watch(true)).reason, 'single_attempt_promotion_transport_unavailable')
  assert.equal(f.calls.includes('promote'), false)
  assert.equal(f.store.has('promote-intent.json'), false)
})

test('failed capability or creation preflight cannot prepare a candidate handoff', async t => {
  for (const mutate of [
    f => { f.adapter.verifyPromotionSupport = async () => ({ method: 'POST', force: true }) },
    f => { f.state.snapshotMutate = s => { s.mainSha = 'b'.repeat(40) } },
    f => { f.state.snapshotMutate = s => { s.productionCandidates.complete = false } },
    f => { f.state.snapshotMutate = s => { s.productionCandidates.items = [{ id: 'dpl_Other' }] } },
    f => { f.state.aliasPair = [OLD, 'dpl_Other'] },
  ]) {
    const f = fixture(t); mutate(f)
    assert.equal((await f.prepare()).status, 'blocked')
    assert.equal(f.store.has('preparation.json'), false)
    assert.equal(f.calls.includes('promote'), false)
  }
})

test('fresh main/CI attempt, complete jobs, competing candidates and alias conflicts block promotion', async t => {
  for (const mutate of [
    f => { f.state.snapshotMutate = s => { s.mainSha = 'b'.repeat(40) } },
    f => { f.state.snapshotMutate = s => { s.run.run_attempt++ } },
    f => { f.state.snapshotMutate = s => { s.jobs.items[0].conclusion = 'failure' } },
    f => { f.state.snapshotMutate = s => { s.jobs.complete = false } },
    f => { f.state.snapshotMutate = s => { s.productionCandidates.items.push({ id: 'dpl_Competing' }) } },
    f => { f.state.aliasPair = [OLD, 'dpl_Unexpected'] },
  ]) {
    const f = fixture(t); await f.prepare(); mutate(f)
    assert.equal((await f.watch(true)).status, 'blocked')
    assert.equal(f.calls.includes('promote'), false)
    assert.equal(f.store.has('promote-intent.json'), false)
  }
})

test('candidate metadata, creation timing and every runtime identity field remain mandatory', async t => {
  const changes = [
    d => { d.id = 'dpl_Other' }, d => { d.projectId = 'prj_other' }, d => { d.teamId = 'team_Other' },
    d => { d.target = 'preview' }, d => { d.gitSource.sha = 'b'.repeat(40) },
    d => { d.gitSource.repoId++ }, d => { d.gitSource.ref = 'feature' },
    d => { d.createdAt = START - 1 }, d => { d.createdAt = START + 120001 },
    d => { d.url = 'https://attacker.example' }, d => { d.readyState = 'UNKNOWN' },
  ]
  for (const mutate of changes) {
    const f = fixture(t); await f.prepare(); f.state.deploymentMutate = mutate
    assert.equal((await f.watch(true)).status, 'blocked')
    assert.equal(f.calls.includes('promote'), false)
  }
  for (const key of ['schema', 'environment', 'deploymentId', 'commit', 'projectRef', 'appOrigin', 'nonce']) {
    const f = fixture(t); await f.prepare(); f.state.identityMutate = identity => { identity[key] = 'wrong' }
    assert.equal((await f.watch(true)).status, 'blocked')
    assert.equal(f.calls.includes('promote'), false)
  }
})

test('terminal states and READY polling timeout never promote or rebuild', async t => {
  for (const state of ['ERROR', 'CANCELED', 'BLOCKED', 'BUILDING']) {
    const f = fixture(t); await f.prepare(); f.state.readyState = state
    const outcome = await f.watch(true)
    assert.equal(outcome.status, 'blocked')
    assert.equal(f.calls.includes('promote'), false)
    assert.ok(f.calls.length < 50)
  }
})

test('automatic full or partial alias assignment suppresses Promote and is observed read-only', async t => {
  const full = fixture(t); await full.prepare(); full.state.promoted = true
  assert.equal((await full.watch(true)).status, 'verified')
  assert.equal(full.calls.includes('promote'), false)
  const partial = fixture(t); await partial.prepare(); partial.state.aliasPair = [OLD, ID]
  const outcome = await partial.watch(true)
  assert.equal(outcome.status, 'unresolved')
  assert.equal(outcome.readOnly, true)
  assert.equal(partial.calls.includes('promote'), false)
  for (const f of [full, partial]) {
    assert.equal(f.store.has('promote-intent.json'), true, 'observed automatic transition is durable')
    f.state.promoted = false; f.state.aliasPair = null
    assert.equal((await f.watch(true)).status, 'unresolved', 'rollback does not authorize another promotion')
    assert.equal(f.calls.includes('promote'), false)
  }
})

test('failure to persist an observed automatic transition leaves a blocking lock even without a journal', async t => {
  const f = fixture(t); await f.prepare(); f.state.aliasPair = [OLD, ID]
  const write = f.store.write
  f.store.write = (name, value) => { if (name === 'promote-intent.json') throw new Error('no-space'); write(name, value) }
  assert.equal((await f.watch(true)).status, 'blocked')
  f.store.write = write; f.state.aliasPair = null
  assert.equal((await f.watch(true)).reason, 'release_locked')
  assert.equal(f.calls.includes('promote'), false)
})

test('lost promotion response is reconciled without retry, including when it actually succeeded', async t => {
  const unknown = fixture(t); await unknown.prepare(); unknown.state.promotionError = 'secret-provider-body'
  const failed = await unknown.watch(true)
  assert.equal(failed.status, 'unresolved')
  assert.equal(failed.requiresReadOnlyReconciliation, true)
  assert.doesNotMatch(JSON.stringify(failed), /secret-provider-body/)
  assert.equal((await unknown.watch(true)).status, 'unresolved')
  assert.equal(unknown.calls.filter(c => c === 'promote').length, 1)
  unknown.state.promoted = true
  assert.equal((await unknown.run({ mode: 'reconcile', deploymentId: ID })).status, 'verified')
  assert.equal(unknown.calls.filter(c => c === 'promote').length, 1)
  const lost = fixture(t); await lost.prepare()
  lost.adapter.promote = async () => { lost.calls.push('promote'); lost.state.promoted = true; throw new Error('lost') }
  const recovered = await lost.watch(true)
  assert.equal(recovered.status, 'verified')
  assert.equal(recovered.receiptOrJournalUnknown, true)
  assert.equal(lost.calls.filter(c => c === 'promote').length, 1)
})

test('unknown receipt shapes trigger immediate readback and never another promotion', async t => {
  for (const receipt of [null, undefined, { accepted: false }, { accepted: 'true' }]) {
    const f = fixture(t); await f.prepare()
    f.adapter.promote = async () => { f.calls.push('promote'); f.state.promoted = true; return receipt }
    const outcome = await f.watch(true)
    assert.equal(outcome.status, 'verified')
    assert.equal(outcome.readOnlyReconciliation, true)
    assert.ok(f.calls.includes('formal-identity'))
    assert.equal((await f.watch(true)).readOnly, true)
    assert.equal(f.calls.filter(c => c === 'promote').length, 1)
  }
})

test('native transport/name are prepared without reading a credential and must match at watch', async t => {
  const f = fixture(t)
  let credentialReads = 0
  const native = { transport: 'native-https', tokenEnv: 'ILLINI_TEST_DUMMY_TOKEN' }
  const adapter = await createReleaseAdapter({ teamId: TEAM, repositoryId: REPO, ...native,
    execute: true, readAdapter: f.adapter,
    getToken: () => {
      credentialReads++
      assert.equal(f.store.has('promote-intent.json'), true, 'credential access follows durable intent')
      throw new Error('dummy-accessor-error-secret-marker')
    },
  })
  const prepared = await f.run({ mode: 'prepare', ...f.scope, ...native, adapter })
  assert.equal(prepared.executionAvailable, true)
  assert.equal(prepared.credentialsVerified, false)
  assert.equal(prepared.permissionsVerified, false)
  assert.equal(prepared.authorizesCreation, false)
  assert.equal(credentialReads, 0)
  assert.equal(f.store.read('preparation.json').promotion.tokenEnv, native.tokenEnv)
  assert.equal((await f.run({ mode: 'watch', deploymentId: ID, ...native, adapter })).status, 'ready_read_only')
  assert.equal(credentialReads, 0)
  for (const selection of [{ transport: 'cli' }, { ...native, tokenEnv: 'ILLINI_OTHER_DUMMY_TOKEN' }]) {
    assert.equal((await f.run({ mode: 'watch', deploymentId: ID, execute: true, ...selection, adapter })).reason, 'prepared_transport_mismatch')
    assert.equal(credentialReads, 0)
  }
  f.state.snapshotMutate = s => { s.mainSha = 'b'.repeat(40) }
  assert.equal((await f.run({ mode: 'watch', deploymentId: ID, execute: true, ...native, adapter })).status, 'blocked')
  assert.equal(credentialReads, 0)
  f.state.snapshotMutate = () => {}
  const attempted = await f.run({ mode: 'watch', deploymentId: ID, execute: true, ...native, adapter })
  assert.equal(attempted.status, 'unresolved')
  assert.equal(credentialReads, 1)
  assert.doesNotMatch(JSON.stringify(attempted), /secret-marker/)
  await f.run({ mode: 'watch', deploymentId: ID, execute: true, ...native, adapter })
  await f.run({ mode: 'reconcile', deploymentId: ID, adapter: f.adapter })
  assert.equal(credentialReads, 1, 'restart/reconciliation never reads the credential again')
  assert.doesNotMatch(readFileSync(join(f.dir, 'promote-intent.json'), 'utf8'), /secret-marker/)
})

test('native adapter defaults to read-only and does not invoke its accessor during capability checks', async t => {
  const f = fixture(t)
  let calls = 0
  const adapter = await createReleaseAdapter({ teamId: TEAM, repositoryId: REPO,
    transport: 'native-https', tokenEnv: 'ILLINI_TEST_DUMMY_TOKEN', readAdapter: f.adapter,
    getToken: () => { calls++; return 'dummy-test-only' },
  })
  assert.equal((await adapter.verifyPromotionSupport()).singleAttempt, true)
  await assert.rejects(adapter.promote({ deploymentId: ID }))
  assert.equal(calls, 0)
})

test('CLI native transport requires an explicit safe environment name; default remains read-only', () => {
  const base = ['watch', '--state-dir', '/tmp/not-opened', '--candidate-id', ID]
  assert.equal(parseReleaseArguments([...base]).transport, 'cli')
  assert.equal(parseReleaseArguments([...base]).execute, false)
  const native = parseReleaseArguments([...base, '--transport', 'native-https', '--token-env', 'ILLINI_TEST_DUMMY_TOKEN', '--execute'])
  assert.equal(native.transport, 'native-https')
  assert.equal(native.tokenEnv, 'ILLINI_TEST_DUMMY_TOKEN')
  assert.equal(native.execute, true)
  for (const suffix of [
    ['--transport', 'native-https'], ['--token-env', 'ILLINI_TEST_DUMMY_TOKEN'], ['--transport', 'other'],
    ['--transport', 'native-https', '--token-env', 'bad-name'],
    ['--transport', 'native-https', '--token-env', 'TOKEN\nHEADER'],
    ...['\n', '\r', '\r\n'].map(ending => ['--transport', 'native-https', '--token-env', `ILLINI_TEST_DUMMY_TOKEN${ending}`]),
  ]) assert.throws(() => parseReleaseArguments([...base, ...suffix]))
})

test('disk failure before/after intent persistence cannot cause a remote retry', async t => {
  for (const afterPersist of [false, true]) {
    const f = fixture(t); await f.prepare()
    const write = f.store.write
    f.store.write = (name, value) => {
      if (name === 'promote-intent.json') {
        if (afterPersist) write(name, value)
        else writeFileSync(join(f.dir, name), '{') // an interrupted file also poisons retries
        throw new Error('disk-failure')
      }
      write(name, value)
    }
    assert.equal((await f.watch(true)).status, 'blocked')
    f.store.write = write
    await f.watch(true)
    assert.equal(f.calls.includes('promote'), false)
  }
})

test('post-success journal failure still returns observed verification but never permits a second write', async t => {
  const f = fixture(t); await f.prepare()
  const write = f.store.write
  f.store.write = (name, value) => { if (name === 'verified.json') throw new Error('disk-failed'); write(name, value) }
  const outcome = await f.watch(true)
  assert.equal(outcome.status, 'verified')
  assert.equal(outcome.receiptOrJournalUnknown, true)
  await f.watch(true)
  assert.equal(f.calls.filter(c => c === 'promote').length, 1)
})

test('post-promotion identity, redirect and alias mismatch cannot be reported as verified', async t => {
  for (const mutate of [
    f => { f.state.identityMutate = (identity, origin) => { if (origin === WWW) identity.deploymentId = OLD } },
    f => { f.state.identityMutate = (identity, origin) => { if (origin === WWW) identity.appOrigin = WWW } },
    f => { f.adapter.readRootRedirect = async () => ({ status: 302, location: 'https://attacker.example/' }) },
    f => { f.adapter.promote = async () => { f.calls.push('promote'); f.state.aliasPair = [ID, 'dpl_Other']; return { accepted: true } } },
  ]) {
    const f = fixture(t); await f.prepare(); mutate(f)
    assert.equal((await f.watch(true)).status, 'unresolved')
    await f.watch(true)
    assert.equal(f.calls.filter(c => c === 'promote').length, 1)
  }
})

test('both runtime origins changing after promotion cannot bypass the stored baseline during recovery', async t => {
  const f = fixture(t); await f.prepare()
  f.adapter.promote = async () => {
    f.calls.push('promote'); f.state.promoted = true
    f.state.identityMutate = identity => { identity.appOrigin = WWW }
    return { accepted: true }
  }
  assert.equal((await f.watch(true)).reason, 'runtime_origin_changed')
  assert.equal((await f.run({ mode: 'reconcile', deploymentId: ID })).reason, 'runtime_origin_changed')
  assert.equal(f.store.has('verified.json'), false)
  assert.equal(f.calls.filter(c => c === 'promote').length, 1)
})

test('one project lock covers concurrent calls; an abandoned lock is never stolen for a write', async t => {
  const f = fixture(t); await f.prepare()
  const unlock = f.store.lock()
  assert.equal((await f.watch(true)).reason, 'release_locked')
  assert.equal(f.calls.includes('promote'), false)
  unlock()
  await f.watch(true)
  const abandoned = f.store.lock()
  assert.equal((await f.run({ mode: 'reconcile', deploymentId: ID })).status, 'verified')
  assert.equal(f.calls.filter(c => c === 'promote').length, 1)
  abandoned()
})

test('candidate binding and corrupt/symlinked local journals fail closed', async t => {
  const f = fixture(t); await f.prepare(); await f.watch()
  assert.equal((await f.run({ mode: 'watch', deploymentId: 'dpl_Other', execute: true })).status, 'blocked')
  writeFileSync(join(f.dir, 'promote-intent.json'), '{broken secret-marker')
  assert.equal((await f.watch(true)).status, 'blocked')
  assert.equal(f.calls.includes('promote'), false)
  const linked = fixture(t); await linked.prepare()
  symlinkSync(join(f.dir, 'promote-intent.json'), join(linked.dir, 'promote-intent.json'))
  assert.equal((await linked.watch(true)).status, 'blocked')
  assert.equal(linked.calls.includes('promote'), false)
})

test('canonical state roots survive ancestor aliases and reject root/lock replacement and unsafe permissions', t => {
  const dir = mkdtempSync(join(tmpdir(), 'illini-store-boundary-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const real = join(dir, 'real'), linked = join(dir, 'linked')
  mkdirSync(real, { mode: 0o700 }); symlinkSync(real, linked)
  const first = createReleaseStore(join(linked, 'state'))
  const unlockFirst = first.lock()
  // Retargeting the original ancestor alias does not retarget a captured store.
  unlinkSync(linked); symlinkSync(join(dir, 'elsewhere'), linked)
  assert.equal(first.has('preparation.json'), false)
  const root = join(real, 'state'), old = join(real, 'old')
  renameSync(root, old); mkdirSync(root, { mode: 0o700 })
  const second = createReleaseStore(root), unlockSecond = second.lock()
  assert.throws(() => first.has('preparation.json'), /state_directory_replaced/)
  assert.throws(unlockFirst, /state_directory_replaced/)
  assert.equal(existsSync(join(root, `${RELEASE_PROJECT}.lock`)), true, 'old owner cannot remove replacement lock')
  unlockSecond()
  const unlock = second.lock()
  const lock = join(root, `${RELEASE_PROJECT}.lock`)
  renameSync(lock, join(root, 'abandoned.lock'))
  writeFileSync(lock, 'replacement', { mode: 0o600 })
  assert.throws(unlock, /release_lock_replaced/)
  assert.equal(readFileSync(lock, 'utf8'), 'replacement')
  chmodSync(root, 0o755)
  assert.throws(() => createReleaseStore(root), /unsafe_state_permissions/)
  assert.throws(() => second.has('preparation.json'), /unsafe_state_permissions/)
})

test('CLI rejects unknown flags and --execute on reconciliation before loading an adapter', () => {
  const script = new URL('./run-ci-first-release.mjs', import.meta.url).pathname
  for (const args of [['watch', '--force'], ['reconcile', '--state-dir', '/tmp/unused', '--execute']]) {
    const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /Release blocked/)
  }
})
