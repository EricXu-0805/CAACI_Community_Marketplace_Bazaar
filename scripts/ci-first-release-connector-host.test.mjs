import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createReleaseStore, runCiFirstRelease } from './run-ci-first-release.mjs'
import { RELEASE_PROJECT } from './check-ci-first-release.mjs'
import { createConnectorPromotionTransport } from './ci-first-release-connector-transport.mjs'
import { createConnectorHostAdapter, reserveConnectorInvocation, recordConnectorReadback } from './ci-first-release-connector-host.mjs'

const NOW = 1_800_000_000_000
const ORIGIN = 'https://candidate-fixture.vercel.app'
const NONCE = '632d0cc4-54b7-42ba-a013-6c08f09a4048'
const scope = Object.freeze({ projectId: RELEASE_PROJECT, teamId: 'team_Fixture', repositoryId: 123,
  requestedSha: 'a'.repeat(40), runId: 456, runAttempt: 1, deploymentId: 'dpl_Candidate', previousDeploymentId: 'dpl_Old' })
const aliases = ids => ['illinimarket.com', 'www.illinimarket.com'].map((alias, i) => ({ alias,
  projectId: RELEASE_PROJECT, deploymentId: ids[i] }))
const review = (ids = ['dpl_Old', 'dpl_Old']) => ({ scope, observedAt: NOW, evidenceRef: 'fixture-review.json', aliases: aliases(ids) })
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'illini-connector-host-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = createReleaseStore(dir)
  const base = { store, scope, now: () => NOW }
  return { dir, store, base, reserve: extra => reserveConnectorInvocation({ ...base, review: review(), ...extra }) }
}

test('default is cloud-read-only and does not consume invocation; no false HTTP/CI guarantee', t => {
  const f = fixture(t)
  const result = f.reserve()
  assert.equal(result.status, 'ready_read_only')
  assert.equal(result.authorizesRelease, false)
  assert.equal(result.singleHttpAttempt, false)
  assert.equal(result.internalHttpAttempts, 'unknown')
  assert.equal(result.request, undefined)
  assert.equal(f.store.has('promote-intent.json'), false)
})

test('durable reservation precedes one injected tool; rebuilding all objects never emits another request', async t => {
  const f = fixture(t)
  const reserved = f.reserve({ execute: true })
  assert.equal(reserved.status, 'reserved')
  assert.deepEqual(reserved.request, { deploymentId: scope.deploymentId, projectId: scope.projectId, teamId: scope.teamId })
  let calls = 0
  const writer = createConnectorPromotionTransport({ teamId: scope.teamId, execute: true,
    requestPromote: async args => {
      calls++
      assert.deepEqual(args, reserved.request)
      assert.equal(JSON.parse(readFileSync(join(f.dir, 'promote-intent.json'))).scope.requestedSha, scope.requestedSha)
      return { isError: false, content: [] }
    } })
  assert.deepEqual(await writer.promote({ deploymentId: scope.deploymentId }), { invoked: true, receipt: 'tool_returned' })
  const restarted = reserveConnectorInvocation({ store: createReleaseStore(f.dir), scope, execute: true })
  assert.equal(restarted.status, 'reconcile_only')
  assert.equal(restarted.request, undefined)
  assert.equal(calls, 1)
  const done = recordConnectorReadback({ ...f.base, review: { ...review(['dpl_Candidate', 'dpl_Candidate']), status: 'verified' } })
  assert.equal(done.status, 'verified_by_host_review')
  assert.equal(f.reserve({ execute: true }).status, 'reconcile_only')
})

test('lost response cannot authorize resend, including a reconstructed connector writer', async t => {
  const f = fixture(t)
  f.reserve({ execute: true })
  let calls = 0
  const requestPromote = async () => { calls++; throw new Error('private provider response') }
  const writer = createConnectorPromotionTransport({ teamId: scope.teamId, execute: true, requestPromote })
  await assert.rejects(writer.promote({ deploymentId: scope.deploymentId }), /release_connector_tool_failed/)
  const restarted = f.reserve({ execute: true })
  assert.equal(restarted.status, 'reconcile_only')
  assert.equal(restarted.request, undefined)
  createConnectorPromotionTransport({ teamId: scope.teamId, execute: true, requestPromote })
  const unresolved = recordConnectorReadback({ ...f.base, review: { ...review(), status: 'unresolved' } })
  assert.equal(unresolved.status, 'unresolved')
  assert.equal(calls, 1)
})

test('partial or full automatic alias assignment persists observe-only intent and suppresses Promote', t => {
  for (const ids of [['dpl_Candidate', 'dpl_Old'], ['dpl_Candidate', 'dpl_Candidate']]) {
    const f = fixture(t)
    const result = f.reserve({ review: review(ids) })
    assert.equal(result.status, 'reconcile_only')
    assert.equal(result.reason, 'alias_already_transitioning')
    assert.equal(result.request, undefined)
    assert.equal(f.store.read('promote-intent.json').action, 'observe_existing_transition')
    assert.equal(f.reserve({ execute: true }).status, 'reconcile_only', 'later rollback cannot re-enable a write')
  }
})

test('stale/future/wrong-scope reviews and alias conflicts never reserve', t => {
  for (const mutate of [
    r => { r.observedAt = NOW - 300001 }, r => { r.observedAt = NOW + 1 },
    r => { r.scope = { ...scope, requestedSha: 'b'.repeat(40) } },
    r => { r.aliases[0].deploymentId = 'dpl_Unexpected' },
    r => { r.aliases[1].alias = 'illinimarket.com' }, r => { r.evidenceRef = '' },
  ]) {
    const f = fixture(t); const r = review(); mutate(r)
    assert.equal(f.reserve({ execute: true, review: r }).status, 'blocked')
    assert.equal(f.store.has('promote-intent.json'), false)
  }
})

test('foreign scope, different release state, or corrupt intent cannot produce request parameters', t => {
  const f = fixture(t)
  f.reserve({ execute: true })
  for (const replacement of [{ deploymentId: 'dpl_Other' }, { runAttempt: 2 }, { teamId: 'team_Other' }]) {
    const result = f.reserve({ scope: { ...scope, ...replacement }, execute: true })
    assert.equal(result.status, 'blocked'); assert.equal(result.request, undefined)
  }
  const g = fixture(t); g.store.write('preparation.json', { schema: 1 })
  assert.equal(g.reserve({ execute: true }).status, 'blocked')
  const h = fixture(t); h.store.write('promote-intent.json', { schema: 1, kind: 'strict-other' })
  assert.equal(h.reserve({ execute: true }).status, 'blocked')
})

test('uncertain persistence retains intent/lock and does not emit a request', t => {
  const f = fixture(t)
  const uncertain = { ...f.store, write(name, value) { f.store.write(name, value); throw new Error('fsync outcome unknown') } }
  const result = f.reserve({ execute: true, store: uncertain })
  assert.equal(result.status, 'blocked'); assert.equal(result.request, undefined)
  assert.equal(f.reserve({ execute: true }).status, 'reconcile_only')
})

test('conflicting or pre-intent readback is unresolved and cannot create verified receipt', t => {
  for (const mutate of [r => { r.observedAt = NOW - 1 }, r => { r.aliases[0].deploymentId = 'dpl_Other' }]) {
    const f = fixture(t); f.reserve({ execute: true })
    const r = { ...review(['dpl_Candidate', 'dpl_Candidate']), status: 'verified' }; mutate(r)
    assert.equal(recordConnectorReadback({ ...f.base, review: r }).status, 'unresolved')
    assert.equal(f.store.has('verified.json'), false)
  }
})

test('CLI file bridge consumes a fixture reservation across separate processes without cloud access', t => {
  const f = fixture(t)
  const inputPath = join(f.dir, 'fixture-input.json')
  writeFileSync(inputPath, JSON.stringify({ scope, review: { ...review(), observedAt: Date.now() } }))
  const args = ['scripts/ci-first-release-connector-host.mjs', 'reserve', f.dir, inputPath, '--execute']
  const first = spawnSync(process.execPath, args, { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
  assert.equal(first.status, 0, first.stderr)
  assert.equal(JSON.parse(first.stdout).status, 'reserved')
  const second = spawnSync(process.execPath, args, { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
  assert.equal(second.status, 0, second.stderr)
  assert.equal(JSON.parse(second.stdout).status, 'reconcile_only')
  assert.equal(JSON.parse(second.stdout).request, undefined)
})

test('CLI invocation through a file symlink persists intent and reconstructs as read-only', t => {
  const f = fixture(t)
  const inputPath = join(f.dir, 'fixture-input.json')
  const entryLink = join(f.dir, 'connector-host-link.mjs')
  writeFileSync(inputPath, JSON.stringify({ scope, review: { ...review(), observedAt: Date.now() } }))
  symlinkSync(fileURLToPath(new URL('./ci-first-release-connector-host.mjs', import.meta.url)), entryLink)
  const args = [entryLink, 'reserve', f.dir, inputPath, '--execute']
  const first = spawnSync(process.execPath, args, { encoding: 'utf8' })
  assert.equal(first.status, 0, first.stderr)
  assert.notEqual(first.stdout.trim(), '', 'a symlink entry must not silently skip the CLI main guard')
  const reserved = JSON.parse(first.stdout)
  assert.equal(reserved.status, 'reserved')
  assert.deepEqual(reserved.request, { deploymentId: scope.deploymentId, projectId: scope.projectId, teamId: scope.teamId })
  assert.deepEqual(f.store.read('promote-intent.json').scope, scope)
  const second = spawnSync(process.execPath, args, { encoding: 'utf8' })
  assert.equal(second.status, 0, second.stderr)
  assert.equal(JSON.parse(second.stdout).status, 'reconcile_only')
  assert.equal(JSON.parse(second.stdout).request, undefined)
})

test('composed host routes metadata-bound candidate to existing-session capture and formal domain to public reader', async () => {
  const calls = []
  const reads = Object.fromEntries(['readSnapshot', 'readCandidates', 'readAliases', 'readRootRedirect'].map(name => [name, async () => name]))
  reads.readIdentity = async input => { calls.push('public'); return input }
  reads.readDeployment = async ({ deploymentId }) => ({ id: deploymentId, projectId: RELEASE_PROJECT,
    teamId: scope.teamId, url: ORIGIN })
  const adapter = createConnectorHostAdapter({ reads, teamId: scope.teamId, requestPromote: async () => { throw new Error('must not invoke') },
    now: () => NOW, captureBrowserIdentity: async input => {
      calls.push('browser')
      return { requestedUrl: input.requestedUrl, observedUrl: input.requestedUrl, observedAt: NOW,
        evidenceRef: 'fixture.png', captureMode: 'existing-session-screen-confirmation',
        identity: { schema: 1, environment: 'production', deploymentId: scope.deploymentId, commit: scope.requestedSha,
          projectRef: 'lfhvgprfphyfvhidegum', appOrigin: 'https://illinimarket.com', nonce: input.nonce } }
    } })
  await assert.rejects(adapter.readIdentity({ origin: ORIGIN, nonce: NONCE }), /candidate_metadata_required/)
  await adapter.readDeployment({ deploymentId: scope.deploymentId })
  assert.equal((await adapter.readIdentity({ origin: ORIGIN, nonce: NONCE })).commit, scope.requestedSha)
  await adapter.readIdentity({ origin: 'https://www.illinimarket.com', nonce: NONCE })
  assert.deepEqual(calls, ['browser', 'public'])
  assert.equal((await adapter.verifyPromotionSupport()).singleAttempt, false)
  await assert.rejects(adapter.promote({ deploymentId: scope.deploymentId }), /execute_required/)
})

test('the existing strict runner rejects connector transport; host protocol does not silently weaken it', async t => {
  const f = fixture(t)
  const result = await runCiFirstRelease({ mode: 'prepare', transport: 'connector', store: f.store,
    adapter: {}, ...scope })
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, 'invalid_transport_selection')
})
