import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { createJsonLinePeer, runSupervisedHost, validateHostScope } from './ci-first-release-supervised-host.mjs'
import { createReleaseStore } from './run-ci-first-release.mjs'
import { RELEASE_PROJECT, RELEASE_REPOSITORY, REQUIRED_RELEASE_CHECKS } from './check-ci-first-release.mjs'

const scope = { projectId: RELEASE_PROJECT, teamId: 'team_Fixture', repositoryId: 123,
  requestedSha: 'a'.repeat(40), runId: 456, runAttempt: 1, previousDeploymentId: 'dpl_Previous' }
const id = 'dpl_Fixture', origin = 'https://fixture-candidate.vercel.app'
const response = (request, result) => JSON.stringify({ schema: 1, type: 'response', requestId: request.requestId, kind: request.kind, result }) + '\n'
function protocol(handler, options = {}) {
  const input = new PassThrough(), output = new PassThrough(), messages = []
  let bytes = ''
  output.on('data', chunk => {
    bytes += chunk
    let end
    while ((end = bytes.indexOf('\n')) !== -1) {
      const line = bytes.slice(0, end); bytes = bytes.slice(end + 1)
      const message = JSON.parse(line); messages.push(message)
      if (message.type === 'request') queueMicrotask(() => handler?.(message, input))
    }
  })
  return { input, output, messages, peer: createJsonLinePeer({ input, output, ...options }) }
}
function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'illini-host-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const store = createReleaseStore(directory)
  const state = { candidate: false, createdAt: 0, switched: false, reads: 0, promotions: 0, events: [] }
  const identity = nonce => ({ schema: 1, environment: 'production', deploymentId: id,
    commit: scope.requestedSha, projectRef: 'lfhvgprfphyfvhidegum', appOrigin: 'https://illinimarket.com', nonce })
  const reads = {
    async readSnapshot() {
      state.reads++; state.events.push('snapshot')
      return { ...scope, mainSha: scope.requestedSha, vercelConfig: { git: { deploymentEnabled: false } },
        secret: 'NEVER_OUTPUT_FIXTURE_PROVIDER_SECRET',
        productionCandidates: { projectId: scope.projectId, teamId: scope.teamId, complete: true,
          items: state.candidate ? [{ id, projectId: scope.projectId, teamId: scope.teamId, target: 'production', readyState: 'READY' }] : [] },
        run: { id: scope.runId, run_attempt: 1, repository: { id: scope.repositoryId, full_name: RELEASE_REPOSITORY },
          head_sha: scope.requestedSha, head_branch: 'main', name: 'CI', path: '.github/workflows/ci.yml', event: 'push', status: 'completed', conclusion: 'success' },
        jobs: { run_id: scope.runId, run_attempt: 1, complete: true, items: REQUIRED_RELEASE_CHECKS.map(name => ({ name,
          run_id: scope.runId, run_attempt: 1, head_sha: scope.requestedSha, status: 'completed', conclusion: 'success' })) } }
    },
    async readDeployment() { state.reads++; return { id, projectId: scope.projectId, teamId: scope.teamId, target: 'production',
      readyState: 'READY', createdAt: state.createdAt, url: origin,
      gitSource: { type: 'github', repoId: scope.repositoryId, ref: 'main', sha: scope.requestedSha } } },
    async readAliases() { state.reads++; state.events.push('aliases'); return { projectId: scope.projectId, teamId: scope.teamId, complete: true,
      items: ['illinimarket.com', 'www.illinimarket.com'].map(alias => ({ alias, projectId: scope.projectId, deploymentId: state.switched ? id : scope.previousDeploymentId })) } },
    async readIdentity({ nonce }) { return identity(nonce) },
    async readRootRedirect() { return { status: 308, location: 'https://www.illinimarket.com/' } },
    async readCandidates() { throw new Error('unexpected_separate_inventory') },
  }
  const wire = protocol((request, input) => {
    state.events.push(request.kind)
    if (options.intercept?.(request, input, state)) return
    let result
    switch (request.kind) {
      case 'prepare_resources': result = { ready: true, observedAt: Date.now(), evidenceRef: 'fixture-resources.json' }; break
      case 'review_history': result = { reviewed: true, observedAt: Date.now(), evidenceRef: `fixture-history-${request.payload.phase}.json` }; break
      case 'supply_candidate': state.candidate = true; state.createdAt = Date.now(); result = { deploymentId: id }; break
      case 'capture_browser_identity': result = { captureMode: 'existing-session-screen-confirmation', requestedUrl: request.payload.requestedUrl,
        observedUrl: request.payload.requestedUrl, observedAt: Date.now(), evidenceRef: `fixture-${request.payload.nonce}.png`, identity: identity(request.payload.nonce) }; break
      case 'promote':
        assert.equal(store.read('promote-intent.json').action, 'invoke_once')
        assert.deepEqual(request.payload, { projectId: scope.projectId, teamId: scope.teamId, deploymentId: id })
        state.promotions++; state.switched = true; result = { outcome: 'tool_returned' }; break
      default: throw new Error('unexpected_request')
    }
    input.write(response(request, result))
  })
  t.after(() => wire.peer.close())
  return { ...wire, reads, state, store, directory,
    run: extra => runSupervisedHost({ scope, store, reads, peer: wire.peer, handoffOptions: { maxObserveMs: 20, pollMs: 1 }, ...extra }) }
}

test('default read-only host prepares before candidate and never reserves/promotes', async t => {
  const f = fixture(t), result = await f.run()
  assert.equal(result.status, 'ready_read_only')
  assert.equal(f.state.promotions, 0)
  assert.equal(f.store.has('promote-intent.json'), false)
  assert.ok(f.state.events.indexOf('prepare_resources') < f.state.events.indexOf('snapshot'))
  assert.ok(f.state.events.indexOf('review_history') < f.state.events.indexOf('supply_candidate'))
  assert.equal(JSON.stringify(f.messages).includes('NEVER_OUTPUT'), false)
})

test('explicit execution bridges real modules and emits one fixed action after durable intent', async t => {
  const f = fixture(t), result = await f.run({ execute: true })
  assert.equal(result.status, 'verified')
  assert.equal(result.promotionAttempted, true)
  assert.equal(f.state.promotions, 1)
  assert.equal(f.store.has('verified.json'), true)
  assert.equal(f.messages.filter(m => m.kind === 'promote').length, 1)
  assert.equal(result.claimsAtomicCronHandoff, false)
  const captures = f.messages.filter(m => m.kind === 'capture_browser_identity')
  assert.equal(captures.length, 2)
  assert.notEqual(captures[0].payload.nonce, captures[1].payload.nonce)
  for (const capture of captures) assert.equal(capture.payload.requestedUrl, `${origin}/api/deployment-identity?nonce=${capture.payload.nonce}`)
})

test('durable intent restart reconciliation never asks resources or repeats promotion', async t => {
  const f = fixture(t)
  assert.equal((await f.run({ execute: true })).status, 'verified')
  f.messages.length = 0
  const result = await f.run({ reconcileDeploymentId: id })
  assert.equal(result.status, 'verified')
  assert.equal(result.runtimeOriginBaselineVerified, true)
  assert.equal(f.state.promotions, 1)
  assert.equal(f.messages.some(m => ['prepare_resources', 'supply_candidate', 'promote'].includes(m.kind)), false)
})

test('legacy intent readback preserves the missing origin baseline limitation in its terminal summary', async t => {
  const f = fixture(t)
  assert.equal((await f.run({ execute: true })).status, 'verified')
  const intent = f.store.read('promote-intent.json')
  delete intent.runtimeAppOrigin
  writeFileSync(join(f.directory, 'promote-intent.json'), JSON.stringify(intent))
  f.messages.length = 0
  const result = await f.run({ reconcileDeploymentId: id })
  assert.equal(result.status, 'verified')
  assert.equal(result.runtimeOriginBaselineVerified, false)
  assert.equal(f.messages.at(-1).result.runtimeOriginBaselineVerified, false)
  assert.equal(f.state.promotions, 1)
  assert.equal(f.messages.some(m => ['prepare_resources', 'supply_candidate', 'promote'].includes(m.kind)), false)
})

test('unknown connector response retains intent and never automatically repeats dispatch', async t => {
  const f = fixture(t, { intercept(request, input, state) {
    if (request.kind !== 'promote') return false
    state.promotions++; input.write(response(request, { outcome: 'unknown' })); return true
  } })
  const result = await f.run({ execute: true })
  assert.equal(result.status, 'unresolved')
  assert.equal(result.promotionAttempted, true)
  assert.equal(f.store.has('promote-intent.json'), true)
  assert.equal(f.state.promotions, 1)
  assert.equal((await f.run({ reconcileDeploymentId: id })).status, 'unresolved')
  assert.equal(f.state.promotions, 1)
})

test('EOF before resource approval blocks all metadata and mutation calls', async t => {
  const f = fixture(t, { intercept(request, input) { if (request.kind === 'prepare_resources') { input.end(); return true }; return false } })
  assert.equal((await f.run({ execute: true })).status, 'blocked')
  assert.equal(f.state.reads, 0)
  assert.equal(f.state.promotions, 0)
})

test('forged identity nonce cannot reach promotion', async t => {
  const f = fixture(t, { intercept(request, input) {
    if (request.kind !== 'capture_browser_identity') return false
    input.write(response(request, { captureMode: 'existing-session-screen-confirmation', requestedUrl: request.payload.requestedUrl,
      observedUrl: request.payload.requestedUrl, observedAt: Date.now(), evidenceRef: 'forged.png', identity: { schema: 1,
        environment: 'production', deploymentId: id, commit: scope.requestedSha, projectRef: 'lfhvgprfphyfvhidegum',
        appOrigin: 'https://illinimarket.com', nonce: '00000000-0000-4000-8000-000000000000' } })); return true
  } })
  assert.equal((await f.run({ execute: true })).status, 'blocked')
  assert.equal(f.store.has('promote-intent.json'), false)
})

test('duplicate response poisons session before any promotion continuation', async t => {
  const f = fixture(t, { intercept(request, input) {
    if (request.kind !== 'review_history' || request.payload.phase !== 'ready') return false
    const line = response(request, { reviewed: true, observedAt: Date.now(), evidenceRef: 'duplicate.json' })
    input.write(line + line); return true
  } })
  assert.equal((await f.run({ execute: true })).status, 'blocked')
  assert.equal(f.state.promotions, 0)
  assert.equal(f.store.has('promote-intent.json'), false)
})

test('scope is exact and rejects extra fields instead of printing their values', () => {
  assert.throws(() => validateHostScope({ ...scope, secret: 'DO_NOT_PRINT' }), /supervised_host_scope_invalid/)
  assert.equal(validateHostScope(scope).requestedSha, scope.requestedSha)
})

for (const [name, bytes] of [
  ['malformed JSON', '{"secret":"DO_NOT_PRINT"'],
  ['unsolicited response', response({ requestId: '00000000-0000-4000-8000-000000000000', kind: 'review_history' }, {})],
  ['oversized input', 'x'.repeat(100)],
  ['invalid UTF-8', Buffer.from([255, 10])],
]) test(`peer fails closed on ${name}`, async () => {
  const p = protocol(undefined, { maxLineBytes: 64 })
  const pending = p.peer.request('prepare_resources', {}, value => value)
  p.input.write(bytes)
  // No newline is also rejected at bounded EOF (or size limit).
  if (name === 'malformed JSON') p.input.end()
  await assert.rejects(pending, /supervised_host_/)
  assert.throws(() => p.peer.request('promote', {}, value => value), /supervised_host_/)
  assert.equal(JSON.stringify(p.messages).includes('DO_NOT_PRINT'), false)
  p.peer.close()
})

test('peer timeout denies later responses and all future requests', async () => {
  const p = protocol(undefined, { timeoutMs: 10 })
  await assert.rejects(p.peer.request('prepare_resources', {}, value => value), /response_timeout/)
  assert.throws(() => p.peer.assertOpen(), /response_timeout/)
  p.peer.close()
})

test('peer rejects a late response even before the delayed timer callback can run', async () => {
  const p = protocol(undefined, { timeoutMs: 5 })
  const pending = p.peer.request('prepare_resources', {}, value => value)
  const rejected = assert.rejects(pending, /response_timeout/)
  const startedAt = performance.now()
  while (performance.now() - startedAt < 15) { /* Deliberately delay the timer callback. */ }
  p.input.write(response(p.messages[0], {}))
  await rejected
  assert.throws(() => p.peer.request('promote', {}, value => value), /response_timeout/)
  p.peer.close()
})

test('peer rejects validation that blocks past the response deadline', async () => {
  const p = protocol(undefined, { timeoutMs: 20 })
  const pending = p.peer.request('prepare_resources', {}, value => {
    const startedAt = performance.now()
    while (performance.now() - startedAt < 30) { /* Deliberately block synchronous validation. */ }
    return value
  })
  const rejected = assert.rejects(pending, /response_timeout/)
  p.input.write(response(p.messages[0], {}))
  await rejected
  assert.throws(() => p.peer.assertOpen(), /response_timeout/)
  p.peer.close()
})

for (const channel of ['input', 'output']) test(`peer fails immediately on abrupt ${channel} close`, async () => {
  const p = protocol(undefined)
  const pending = p.peer.request('prepare_resources', {}, value => value)
  p[channel].destroy()
  await assert.rejects(pending, /closed/)
  assert.throws(() => p.peer.assertOpen(), /closed/)
  p.peer.close()
})

test('peer rejects response kind mismatch', async () => {
  const p = protocol((request, input) => input.write(response({ ...request, kind: 'promote' }, {})))
  await assert.rejects(p.peer.request('prepare_resources', {}, value => value), /response_unexpected/)
  p.peer.close()
})

test('unknown receipt fields fail closed without echoing their values', async t => {
  const f = fixture(t, { intercept(request, input) {
    if (request.kind !== 'prepare_resources') return false
    input.write(response(request, { ready: true, observedAt: Date.now(), evidenceRef: 'fixture.json', secret: 'DO_NOT_PRINT' })); return true
  } })
  assert.equal((await f.run({ execute: true })).status, 'blocked')
  assert.equal(f.state.reads, 0)
  assert.equal(JSON.stringify(f.messages).includes('DO_NOT_PRINT'), false)
})

test('CLI runs through /tmp symlink and rejects input before cloud reads', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'illini-host-cli-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const scopePath = join(directory, 'scope.json'); writeFileSync(scopePath, JSON.stringify(scope))
  const path = fileURLToPath(new URL('./ci-first-release-supervised-host.mjs', import.meta.url)).replace(/^\/private\/tmp\//, '/tmp/')
  const child = spawn(process.execPath, [path, '--scope', scopePath, '--journal', join(directory, 'journal')], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = '', sent = false
  child.stdout.on('data', bytes => {
    stdout += bytes
    if (!sent && stdout.includes('prepare_resources')) { sent = true; child.stdin.end('{"secret":"DO_NOT_PRINT"}\n') }
  })
  child.stderr.on('data', bytes => { stderr += bytes })
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
  assert.equal(code, 1)
  assert.ok(sent)
  assert.equal(stdout.includes('DO_NOT_PRINT'), false)
  assert.equal(stderr.includes('DO_NOT_PRINT'), false)
  assert.match(stdout, /"event":"finished"/)
  assert.equal(stdout.includes('"kind":"promote"'), false)
})

function documentedToolsHost(tools) {
  const markdown = readFileSync(new URL('../docs/SUPERVISED_HOST_BRIDGE.md', import.meta.url), 'utf8')
  const blocks = [...markdown.matchAll(/```js\n([\s\S]*?)\n```/g)].map(match => match[1])
  const source = ['function decodeCompleteMessages(', 'async function dispatchPromote('].map(prefix => blocks.find(block => block.startsWith(prefix))).join('\n')
  const values = new Map()
  const methods = new Function('load', 'store', 'tools', `${source}\nreturn {decodeCompleteMessages,dispatchPromote}`)(key => values.get(key), (key, value) => values.set(key, value), tools)
  return { ...methods, values }
}
const action = () => ({ schema: 1, type: 'request', requestId: '00000000-0000-4000-8000-000000000001',
  kind: 'promote', requestedAt: Date.now(), payload: { projectId: scope.projectId, teamId: scope.teamId, deploymentId: id } })

test('documented actual-host JSONL decoder handles fragmented PTY output and rejects replay', () => {
  const h = documentedToolsHost({}), request = action(), line = JSON.stringify(request) + '\r\n'
  assert.deepEqual(h.decodeCompleteMessages({ session_id: 1, output: line.slice(0, 30) }), [])
  assert.deepEqual(h.decodeCompleteMessages({ session_id: 1, output: line.slice(30) }), [request])
  assert.throws(() => h.decodeCompleteMessages({ session_id: 1, output: line }), /duplicate/)
  const other = documentedToolsHost({})
  assert.throws(() => other.decodeCompleteMessages({ output: '{"schema":1' }), /Incomplete/)
})

test('documented dispatcher validates expiry/scope, consumes before fixed tool, sends only marker', async () => {
  let calls = 0, reply
  const h = documentedToolsHost({
    async mcp__codex_apps__vercel_request_promote(args) {
      calls++
      assert.deepEqual(args, action().payload)
      assert.deepEqual(h.values.get('supervisedConsumedJournals'), ['fixture-journal'])
      return { isError: false, content: [{ type: 'text', text: 'DO_NOT_PRINT_PROVIDER_BODY' }] }
    },
    async write_stdin(args) { reply = JSON.parse(args.chars); return { output: '', session_id: args.session_id } },
  })
  const expired = { ...action(), requestedAt: Date.now() - 8001 }
  await assert.rejects(h.dispatchPromote(expired, action().payload, 'fixture-journal', 1), /expired/)
  await assert.rejects(h.dispatchPromote({ ...action(), payload: { ...action().payload, force: true } }, action().payload, 'fixture-journal', 1), /Invalid/)
  assert.equal(calls, 0)
  await h.dispatchPromote(action(), action().payload, 'fixture-journal', 1)
  assert.equal(calls, 1)
  assert.deepEqual(reply.result, { outcome: 'tool_returned' })
  assert.equal(JSON.stringify(reply).includes('PROVIDER_BODY'), false)
  await assert.rejects(h.dispatchPromote(action(), action().payload, 'fixture-journal', 1), /Already consumed/)
  assert.equal(calls, 1)
})
