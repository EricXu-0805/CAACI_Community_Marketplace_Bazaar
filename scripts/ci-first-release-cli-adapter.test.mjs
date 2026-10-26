import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCliAdapter } from './ci-first-release-cli-adapter.mjs'
import { ciFirstReleasePlan, RELEASE_PROJECT, RELEASE_REPOSITORY, REQUIRED_RELEASE_CHECKS } from './check-ci-first-release.mjs'
import { createReleaseStore, runCiFirstRelease } from './run-ci-first-release.mjs'

const TEAM = 'team_Test123', REPOSITORY = 123456, SHA = 'a'.repeat(40)
const DEPLOYMENT = 'dpl_Test123', NONCE = '6ce80eda-5c87-4fad-b631-2925a562c068'
const ORIGIN = 'https://test-candidate.vercel.app'
const request = { requestedSha: SHA, runId: 123, runAttempt: 2 }
const clone = value => structuredClone(value)
const output = value => ({ stdout: JSON.stringify(value), stderr: '', exitCode: 0 })
const identity = () => ({ schema: 1, environment: 'production', deploymentId: DEPLOYMENT,
  commit: SHA, projectRef: 'abcdefghijklmnopqrst', appOrigin: 'https://illinimarket.com', nonce: NONCE })
const job = (id, name = 'Other') => ({ id, name, run_id: 123, head_sha: SHA, status: 'completed', conclusion: 'success' })
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

function harness(options = {}) {
  const calls = [], fetches = []
  const config = Buffer.from(JSON.stringify({ git: { deploymentEnabled: false } }))
  const data = {
    project: { id: RELEASE_PROJECT, accountId: TEAM,
      link: { type: 'github', repoId: REPOSITORY, org: RELEASE_REPOSITORY.split('/')[0], repo: RELEASE_REPOSITORY.split('/')[1], productionBranch: 'main' } },
    main: { ref: 'refs/heads/main', object: { type: 'commit', sha: SHA } },
    run: { id: 123, run_attempt: 2, repository: { id: REPOSITORY, full_name: RELEASE_REPOSITORY },
      path: '.github/workflows/ci.yml', name: 'CI', head_branch: 'main', head_sha: SHA,
      event: 'push', status: 'completed', conclusion: 'success' },
    jobPages: [{ total_count: 7, jobs: REQUIRED_RELEASE_CHECKS.map((name, i) => job(i + 1, name)) }],
    config: { type: 'file', path: 'vercel.json', encoding: 'base64', content: config.toString('base64'), size: config.length },
    inventory: [{ deployments: [], pagination: { count: 0, next: null, prev: null } }],
    deployment: { id: DEPLOYMENT, projectId: RELEASE_PROJECT, ownerId: TEAM,
      target: 'production', readyState: 'READY', createdAt: 1_700_000_000_000,
      url: 'test-candidate.vercel.app', gitSource: { type: 'github', repoId: String(REPOSITORY), ref: 'main', sha: SHA } },
    aliases: Object.fromEntries(['illinimarket.com', 'www.illinimarket.com'].map(alias => [alias,
      { alias, deploymentId: DEPLOYMENT, projectId: RELEASE_PROJECT }])),
  }
  let inventoryPage = 0, mainReads = 0, runReads = 0
  const runCommand = async (name, args, bounds) => {
    calls.push({ name, args, bounds })
    if (options.overrideCommand) {
      const value = await options.overrideCommand(name, args, bounds, data)
      if (value !== undefined) return value
    }
    if (args.includes('--help')) return { stdout: name === 'gh' ? '--method --hostname' : '',
      stderr: name === 'vercel' ? '--method GET POST --raw --non-interactive --scope' : '', exitCode: name === 'vercel' ? 2 : 0 }
    const url = new URL(args[1], 'https://unused.invalid')
    const path = url.pathname
    if (name === 'gh') {
      assert.equal(args[args.indexOf('--hostname') + 1], 'github.com')
      assert.equal(args[args.indexOf('--method') + 1], 'GET')
      if (path.endsWith('/git/ref/heads/main')) {
        mainReads++
        return output(options.mainReply?.(mainReads, data) ?? data.main)
      }
      if (path.endsWith('/actions/runs/123')) {
        runReads++
        return output(options.runReply?.(runReads, data) ?? data.run)
      }
      if (path.endsWith('/attempts/2/jobs')) return output(data.jobPages[Number(url.searchParams.get('page')) - 1])
      if (path.endsWith('/contents/vercel.json')) {
        assert.equal(url.searchParams.get('ref'), SHA)
        return output(data.config)
      }
    }
    if (name === 'vercel') {
      assert.equal(url.searchParams.get('teamId'), TEAM)
      assert.ok(args.includes('--raw') && args.includes('--non-interactive'))
      assert.equal(args[args.indexOf('--scope') + 1], TEAM)
      assert.equal(args[args.indexOf('--method') + 1], 'GET')
      if (path === `/v9/projects/${RELEASE_PROJECT}`) return output(data.project)
      if (path === '/v7/deployments') {
        assert.equal(url.searchParams.get('projectId'), RELEASE_PROJECT)
        assert.equal(url.searchParams.get('target'), 'production')
        assert.equal(url.searchParams.get('limit'), '100')
        return output(data.inventory[inventoryPage++])
      }
      if (path === `/v13/deployments/${DEPLOYMENT}`) {
        assert.equal(url.searchParams.get('withGitRepoInfo'), 'true')
        return output(data.deployment)
      }
      if (path.startsWith('/v4/aliases/')) {
        assert.equal(url.searchParams.get('projectId'), RELEASE_PROJECT)
        return output(data.aliases[path.slice('/v4/aliases/'.length)])
      }
    }
    throw new Error('Unexpected fake request; no real transport is available')
  }
  const fetchImpl = async (url, init) => {
    fetches.push({ url, init })
    if (options.fetchImpl) return options.fetchImpl(url, init)
    return new Response(JSON.stringify(identity()), { headers: { 'content-type': 'application/json' } })
  }
  return { data, calls, fetches, adapter: createCliAdapter({ teamId: TEAM, repositoryId: REPOSITORY,
    runCommand, fetchImpl, ...options.adapterOptions }) }
}

test('construction never calls a transport, default mutation is blocked, help exit 2 is accepted', async () => {
  const h = harness()
  assert.equal(h.calls.length, 0)
  await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), /release_adapter_execute_required/)
  assert.equal(h.calls.length, 0)
  assert.deepEqual(await h.adapter.verifyPromotionSupport(), { method: 'POST',
    pathTemplate: '/v10/projects/{projectId}/promote/{deploymentId}', force: false,
    singleAttempt: false, reason: 'vercel_cli_implicit_mutation_retries' })
  assert.deepEqual(h.calls.map(c => [c.name, c.args]), [['gh', ['api', '--help']], ['vercel', ['api', '--help']]])
})

test('fresh snapshot binds exact main/run/latest attempt and source config; absent optional job attempt is URL-bound', async () => {
  const h = harness()
  const snapshot = await h.adapter.readSnapshot(request)
  assert.equal(snapshot.teamId, TEAM)
  assert.equal(snapshot.repositoryId, REPOSITORY)
  assert.equal(ciFirstReleasePlan(snapshot).snapshotEligible, true)
  assert.ok(snapshot.jobs.items.every(item => item.run_attempt === 2))
  assert.equal(h.calls.filter(c => c.args[1].endsWith('/git/ref/heads/main')).length, 2)
  assert.equal(h.calls.filter(c => c.args[1].endsWith('/actions/runs/123')).length, 2)
  assert.ok(h.calls.every(c => c.bounds.timeoutMs === 10_000 && c.bounds.maxBuffer === 4 * 1024 * 1024))
  assert.ok(h.calls.every(c => !c.args.includes('POST') && !c.args.includes('--cache')))
})

test('snapshot starts attempt-specific jobs with independent reads and rechecks run/main only after all complete', async () => {
  const releaseJobs = deferred(), releaseConfig = deferred(), firstReads = new Set()
  const h = harness({ async overrideCommand(name, args) {
    const path = new URL(args[1], 'https://unused.invalid').pathname
    firstReads.add(path)
    if (name === 'gh' && path.endsWith('/attempts/2/jobs')) await releaseJobs.promise
    if (name === 'gh' && path.endsWith('/contents/vercel.json')) await releaseConfig.promise
  } })
  const pending = h.adapter.readSnapshot(request)
  try {
    await tick()
    for (const suffix of ['/git/ref/heads/main', '/actions/runs/123', '/contents/vercel.json', '/attempts/2/jobs']) {
      assert.ok([...firstReads].some(path => path.endsWith(suffix)), `independent read started: ${suffix}`)
    }
    assert.ok(firstReads.has('/v7/deployments'))
    releaseConfig.resolve()
    await tick()
    assert.equal(h.calls.filter(c => c.args[1].endsWith('/git/ref/heads/main')).length, 1)
    assert.equal(h.calls.filter(c => c.args[1].endsWith('/actions/runs/123')).length, 1)
  } finally { releaseConfig.resolve(); releaseJobs.resolve() }
  assert.equal((await pending).jobs.items.length, 7)
  assert.equal(h.calls.filter(c => c.args[1].endsWith('/git/ref/heads/main')).length, 2)
  assert.equal(h.calls.filter(c => c.args[1].endsWith('/actions/runs/123')).length, 2)
})

test('deployment and both aliases start alongside project verification without registering an unverified origin', async () => {
  for (const method of ['readDeployment', 'readAliases']) {
    const releaseProject = deferred(), started = new Set()
    const h = harness({ async overrideCommand(_name, args) {
      const path = new URL(args[1], 'https://unused.invalid').pathname
      started.add(path)
      if (path === `/v9/projects/${RELEASE_PROJECT}`) await releaseProject.promise
    } })
    let resolved = false
    const pending = (method === 'readDeployment' ? h.adapter.readDeployment({ deploymentId: DEPLOYMENT }) : h.adapter.readAliases())
      .then(result => { resolved = true; return result })
    try {
      await tick()
      const expected = method === 'readDeployment' ? [`/v13/deployments/${DEPLOYMENT}`]
        : ['/v4/aliases/illinimarket.com', '/v4/aliases/www.illinimarket.com']
      assert.deepEqual([...started].sort(), [`/v9/projects/${RELEASE_PROJECT}`, ...expected].sort())
      assert.equal(resolved, false, 'metadata is not usable before project validation')
      await assert.rejects(h.adapter.readIdentity({ origin: ORIGIN, nonce: NONCE }), /release_adapter_identity_target_invalid/)
      assert.equal(h.fetches.length, 0)
    } finally { releaseProject.resolve() }
    await pending
  }
})

test('a late project rejection discards concurrent snapshot, deployment and alias results', async () => {
  for (const method of ['readSnapshot', 'readDeployment', 'readAliases']) {
    const releaseProject = deferred()
    const h = harness({ async overrideCommand(_name, args) {
      if (args[1].startsWith(`/v9/projects/${RELEASE_PROJECT}?`)) await releaseProject.promise
    } })
    h.data.project.accountId = 'team_Other'
    const pending = method === 'readSnapshot' ? h.adapter.readSnapshot(request)
      : method === 'readDeployment' ? h.adapter.readDeployment({ deploymentId: DEPLOYMENT }) : h.adapter.readAliases()
    const rejected = assert.rejects(pending, /release_adapter_project_mismatch/)
    try {
      await tick()
      await assert.rejects(h.adapter.readIdentity({ origin: ORIGIN, nonce: NONCE }), /release_adapter_identity_target_invalid/)
      assert.equal(h.fetches.length, 0)
    } finally { releaseProject.resolve() }
    await rejected
    await assert.rejects(h.adapter.readIdentity({ origin: ORIGIN, nonce: NONCE }), /release_adapter_identity_target_invalid/)
    assert.ok(h.calls.every(call => !call.args.includes('POST')))
  }
})

test('job pagination reads every page and rejects duplicate, incomplete and changing totals', async () => {
  const h = harness()
  h.data.jobPages = [
    { total_count: 101, jobs: Array.from({ length: 100 }, (_, i) => job(i + 1)) },
    { total_count: 101, jobs: [job(101)] },
  ]
  assert.equal((await h.adapter.readSnapshot(request)).jobs.items.length, 101)
  for (const mutate of [
    data => { data.jobPages[0].total_count = 8 },
    data => { data.jobPages[0].jobs[1].id = 1 },
    data => { data.jobPages[0].jobs[0].run_attempt = 1 },
    data => { data.jobPages[0].jobs[0].head_sha = 'b'.repeat(40) },
    data => { data.jobPages[0].jobs[0].run_id = 122 },
    data => { data.jobPages = [{ total_count: 101, jobs: Array.from({ length: 100 }, (_, i) => job(i + 1)) }, { total_count: 100, jobs: [job(101)] }] },
  ]) {
    const bad = harness(); mutate(bad.data)
    await assert.rejects(bad.adapter.readSnapshot(request), /release_adapter_(job_mismatch|jobs_incomplete)/)
  }
})

test('repository, latest attempt, project and source-config mismatches block snapshots', async () => {
  for (const mutate of [
    data => { data.run.repository.id++ }, data => { data.run.repository.full_name = 'other/repo' },
    data => { data.run.run_attempt++ }, data => { data.project.accountId = 'team_Other' },
    data => { data.project.link.repoId++ }, data => { data.project.link.org = 'other' },
    data => { data.project.link.productionBranch = 'feature' },
    data => { data.config.path = 'other.json' }, data => { data.config.content = 'bad base64 data' },
    data => { data.config.size++ },
  ]) {
    const h = harness(); mutate(h.data)
    await assert.rejects(h.adapter.readSnapshot(request), /release_adapter_/)
  }
  const moved = harness({ mainReply: (n, data) => n === 1 ? data.main : { ...data.main, object: { type: 'commit', sha: 'b'.repeat(40) } } })
  await assert.rejects(moved.adapter.readSnapshot(request), /release_adapter_snapshot_changed/)
  const rerun = harness({ runReply: (n, data) => ({ ...data.run, run_attempt: n === 1 ? 2 : 3 }) })
  await assert.rejects(rerun.adapter.readSnapshot(request), /release_adapter_ci_binding_mismatch/)
})

const listed = (uid, readyState, rest = {}) => ({ uid, readyState, state: readyState,
  projectId: RELEASE_PROJECT, target: 'production', ...rest })
const inventoryPage = (deployments, next = null) => ({ deployments, pagination: { count: deployments.length, next, prev: null } })

test('complete production inventory excludes proven history and keeps all staged/rolling/building/unknown READY candidates', async () => {
  const h = harness()
  h.data.inventory = [inventoryPage([
    listed('dpl_Old', 'READY', { readySubstate: 'PROMOTED' }),
    listed('dpl_Legacy', 'READY', { aliasAssigned: 1234 }),
    listed('dpl_Staged', 'READY', { readySubstate: 'STAGED' }),
    listed('dpl_Rolling', 'READY', { readySubstate: 'ROLLING' }),
  ], 100), inventoryPage([
    listed('dpl_Building', 'BUILDING'), listed('dpl_Unknown', 'READY'), listed('dpl_Error', 'ERROR'), listed('dpl_Canceled', 'CANCELED'),
  ])]
  const result = await h.adapter.readCandidates()
  assert.equal(result.complete, true)
  assert.deepEqual(result.items.map(item => item.id), ['dpl_Legacy', 'dpl_Staged', 'dpl_Rolling', 'dpl_Building', 'dpl_Unknown'])
  assert.deepEqual(result.items.map(item => item.readySubstate), [undefined, 'STAGED', 'ROLLING', undefined, undefined])
  assert.ok(h.calls.find(c => c.args[1].includes('until=100')))
})

test('successive inventories preserve STAGED to ROLLING changes without inventing a missing substate', async () => {
  const h = harness()
  h.data.inventory = [
    inventoryPage([listed(DEPLOYMENT, 'READY', { readySubstate: 'STAGED' })]),
    inventoryPage([listed(DEPLOYMENT, 'READY', { readySubstate: 'ROLLING' })]),
    inventoryPage([listed(DEPLOYMENT, 'READY')]),
  ]
  const staged = await h.adapter.readCandidates()
  const rolling = await h.adapter.readCandidates()
  const unknown = await h.adapter.readCandidates()
  assert.equal(staged.items[0].readySubstate, 'STAGED')
  assert.equal(rolling.items[0].readySubstate, 'ROLLING')
  assert.equal(Object.hasOwn(unknown.items[0], 'readySubstate'), false)
  assert.deepEqual(staged.items.map(item => item.id), rolling.items.map(item => item.id))
  assert.ok(h.calls.every(call => !call.args.includes('POST')))
})

test('candidateId never hides another deployment and malformed/looped pagination never reports complete', async () => {
  const h = harness()
  h.data.inventory = [inventoryPage([listed(DEPLOYMENT, 'READY'), listed('dpl_Competitor', 'QUEUED')])]
  assert.equal((await h.adapter.readSnapshot({ ...request, candidateId: DEPLOYMENT })).productionCandidates.items.length, 2)
  for (const pages of [
    [{ deployments: [], pagination: { count: 0 } }],
    [{ deployments: [], pagination: { count: 1, next: null } }],
    [inventoryPage([listed('dpl_A', 'READY', { readySubstate: 'FUTURE' })])],
    [inventoryPage([listed('dpl_A', 'READY', { projectId: 'prj_wrong' })])],
    [inventoryPage([listed('dpl_A', 'READY')], 100), inventoryPage([listed('dpl_A', 'READY')])],
    [inventoryPage([listed('dpl_A', 'READY')], 100), inventoryPage([listed('dpl_B', 'READY')], 100)],
  ]) {
    const bad = harness(); bad.data.inventory = clone(pages)
    await assert.rejects(bad.adapter.readCandidates(), /release_adapter_inventory_/)
  }
})

test('deployment details require owner/project/repository source identities and a genuine deployment hostname', async () => {
  const h = harness()
  assert.deepEqual(await h.adapter.readDeployment({ deploymentId: DEPLOYMENT }), {
    id: DEPLOYMENT, projectId: RELEASE_PROJECT, teamId: TEAM, target: 'production', readyState: 'READY',
    createdAt: h.data.deployment.createdAt, url: ORIGIN,
    gitSource: { type: 'github', repoId: REPOSITORY, ref: 'main', sha: SHA },
  })
  for (const mutate of [
    d => { d.ownerId = 'team_Other' }, d => { d.team = { id: 'team_Other' } }, d => { d.projectId = 'prj_other' },
    d => { d.gitSource.repoId++ }, d => { delete d.gitSource.sha }, d => { d.target = 'preview' },
    d => { d.url = 'https://evil.example/' }, d => { d.url = 'candidate.vercel.app.evil.example' },
    d => { d.url = 'user@candidate.vercel.app' }, d => { d.url = 'candidate.vercel.app/path' },
  ]) {
    const bad = harness(); mutate(bad.data.deployment)
    await assert.rejects(bad.adapter.readDeployment({ deploymentId: DEPLOYMENT }), /release_adapter_deployment_/)
    assert.equal(bad.fetches.length, 0)
  }
})

test('incomplete non-READY deployments may lack a URL but never register an identity origin', async () => {
  const h = harness()
  h.data.deployment.url = null
  h.data.deployment.readyState = 'INITIALIZING'
  assert.equal((await h.adapter.readDeployment({ deploymentId: DEPLOYMENT })).url, null)
  await assert.rejects(h.adapter.readIdentity({ origin: ORIGIN, nonce: NONCE }), /release_adapter_identity_target_invalid/)
  h.data.deployment.readyState = 'READY'
  await assert.rejects(h.adapter.readDeployment({ deploymentId: DEPLOYMENT }), /release_adapter_deployment_url_invalid/)
})

test('aliases require both official domains and a bound, nondeleted, single-project deployment', async () => {
  const h = harness()
  const result = await h.adapter.readAliases()
  assert.deepEqual(result, { projectId: RELEASE_PROJECT, teamId: TEAM, complete: true, items: [
    { alias: 'illinimarket.com', deploymentId: DEPLOYMENT, projectId: RELEASE_PROJECT },
    { alias: 'www.illinimarket.com', deploymentId: DEPLOYMENT, projectId: RELEASE_PROJECT },
  ] })
  for (const override of [{ deploymentId: null }, { projectId: null }, { alias: 'evil.example' },
    { deployment: { id: 'dpl_other' } }, { deletedAt: 1 }, { microfrontends: {} }, { teamId: 'team_Other' }]) {
    const bad = harness(); Object.assign(bad.data.aliases['www.illinimarket.com'], override)
    await assert.rejects(bad.adapter.readAliases(), /release_adapter_alias_mismatch/)
  }
})

test('anonymous identity permits only official www or a platform-validated candidate origin and fresh nonce', async () => {
  const h = harness()
  for (const origin of ['https://illinimarket.com', ORIGIN, 'https://other.vercel.app', 'https://www.illinimarket.com:444', 'https://www.illinimarket.com/path']) {
    await assert.rejects(h.adapter.readIdentity({ origin, nonce: NONCE }), /release_adapter_identity_target_invalid/)
  }
  await h.adapter.readDeployment({ deploymentId: DEPLOYMENT })
  assert.deepEqual(await h.adapter.readIdentity({ origin: ORIGIN, nonce: NONCE }), identity())
  const sent = h.fetches[0]
  assert.equal(sent.url, `${ORIGIN}/api/deployment-identity?nonce=${NONCE}`)
  assert.equal(sent.init.redirect, 'manual')
  assert.equal(sent.init.credentials, 'omit')
  assert.deepEqual(Object.keys(sent.init.headers).sort(), ['Accept', 'Cache-Control'])
  assert.equal(sent.init.cache, 'no-store')
})

test('identity rejects redirects, auth gates, stale nonce, oversized and malformed bodies', async () => {
  for (const response of [
    () => new Response('', { status: 307, headers: { location: 'https://evil.example' } }),
    () => new Response('', { status: 403 }),
    () => new Response(JSON.stringify({ ...identity(), nonce: 'stale' }), { headers: { 'content-type': 'application/json' } }),
    () => new Response('sensitive-marker', { headers: { 'content-type': 'application/json' } }),
    () => new Response('x'.repeat(4097), { headers: { 'content-type': 'application/json' } }),
    () => new Response(JSON.stringify(identity()), { headers: { 'content-type': 'application/json', 'content-length': '9999' } }),
  ]) {
    const h = harness({ fetchImpl: response })
    await assert.rejects(h.adapter.readIdentity({ origin: 'https://www.illinimarket.com', nonce: NONCE }), error => {
      assert.match(error.message, /^release_adapter_/); assert.doesNotMatch(error.message, /sensitive-marker/); return true
    })
  }
})

test('fetch and body consumption share a bounded deadline even if an injected transport ignores abort', async () => {
  for (const fetchImpl of [
    () => new Promise(() => {}),
    () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } }),
  ]) {
    const h = harness({ adapterOptions: { timeoutMs: 15 }, fetchImpl })
    await assert.rejects(h.adapter.readIdentity({ origin: 'https://www.illinimarket.com', nonce: NONCE }), /release_adapter_http_timeout/)
    assert.equal(h.fetches[0].init.signal.aborted, true)
  }
})

test('root redirect is read without following it and must be exactly the canonical HTTPS destination', async () => {
  const good = harness({ fetchImpl: () => new Response(null, { status: 308, headers: { location: 'https://www.illinimarket.com/' } }) })
  assert.deepEqual(await good.adapter.readRootRedirect(), { status: 308, location: 'https://www.illinimarket.com/' })
  assert.equal(good.fetches[0].url, 'https://illinimarket.com/')
  for (const [status, location] of [[302, 'https://www.illinimarket.com/'], [307, 'https://evil.example/'], [308, 'http://www.illinimarket.com/']]) {
    const bad = harness({ fetchImpl: () => new Response(null, { status, headers: { location } }) })
    await assert.rejects(bad.adapter.readRootRedirect(), /release_adapter_root_redirect_invalid/)
  }
})

test('explicit execution and injected command runners cannot bypass the unavailable mutation transport', async () => {
  const h = harness({ adapterOptions: { execute: true } })
  await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), /release_adapter_promotion_transport_unavailable/)
  assert.equal(h.calls.length, 0)
  assert.equal((await h.adapter.verifyPromotionSupport()).singleAttempt, false)
  const before = h.calls.length
  await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), /release_adapter_promotion_transport_unavailable/)
  assert.equal(h.calls.length, before)
  assert.ok(h.calls.every(call => !call.args.includes('POST')))
})

test('transport errors, nonzero exits, malformed output, oversized output and stalled commands never expose command output or retry', async () => {
  for (const overrideCommand of [
    () => { throw new Error('sensitive-marker') },
    () => ({ stdout: 'sensitive-marker', stderr: 'sensitive-marker', exitCode: 1 }),
    () => ({ stdout: 'sensitive-marker', stderr: '', exitCode: 0 }),
    () => ({ stdout: 'x'.repeat(4 * 1024 * 1024 + 1), stderr: '', exitCode: 0 }),
    () => new Promise(() => {}),
  ]) {
    const h = harness({ overrideCommand, adapterOptions: { timeoutMs: 15 } })
    await assert.rejects(h.adapter.readCandidates(), error => {
      assert.match(error.message, /^release_adapter_/); assert.doesNotMatch(error.message, /sensitive-marker/); return true
    })
    assert.equal(h.calls.length, 1)
  }
})

test('invalid input IDs cannot escape endpoint/argument positions or trigger a transport', async () => {
  for (const teamId of ['--help', 'team_a?x=y', 'team_a/other', null]) {
    assert.throws(() => createCliAdapter({ teamId, repositoryId: REPOSITORY }), /release_adapter_invalid_options/)
  }
  const h = harness({ adapterOptions: { execute: true } })
  for (const deploymentId of ['--force', 'dpl_a?force=true', 'dpl_a/../other']) {
    await assert.rejects(h.adapter.readDeployment({ deploymentId }), /release_adapter_invalid_deployment/)
    await assert.rejects(h.adapter.promote({ deploymentId }), /release_adapter_invalid_deployment/)
  }
  assert.equal(h.calls.length, 0)
})

test('real runner and CLI adapter prepare/watch/reconcile through fake transports without any mutating subprocess', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'illini-cli-adapter-integration-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const store = createReleaseStore(directory)
  const events = []
  let deploymentReads = 0
  const h = harness({
    adapterOptions: { execute: true },
    overrideCommand(name, args, _bounds, data) {
      events.push(`${name}:${args[1]}`)
      if (args[1]?.startsWith(`/v13/deployments/${DEPLOYMENT}?`)) {
        const initializing = ++deploymentReads === 1
        events.push(initializing ? 'deployment:INITIALIZING' : 'deployment:READY')
        return output({ ...data.deployment, readyState: initializing ? 'INITIALIZING' : 'READY',
          url: initializing ? null : data.deployment.url })
      }
    },
    fetchImpl(url, init) {
      assert.equal(init.credentials, 'omit')
      const parsed = new URL(url)
      events.push(`public:${parsed.origin}`)
      if (url === 'https://illinimarket.com/') {
        return new Response(null, { status: 308, headers: { location: 'https://www.illinimarket.com/' } })
      }
      return new Response(JSON.stringify({ ...identity(), projectRef: 'lfhvgprfphyfvhidegum',
        nonce: parsed.searchParams.get('nonce') }), { headers: { 'content-type': 'application/json' } })
    },
  })
  for (const alias of Object.values(h.data.aliases)) alias.deploymentId = 'dpl_Previous'
  h.data.inventory = [inventoryPage([]), inventoryPage([listed(DEPLOYMENT, 'READY', { readySubstate: 'STAGED' })])]
  let time = h.data.deployment.createdAt - 1000
  const run = options => runCiFirstRelease({ store, adapter: h.adapter, now: () => time,
    wait: async ms => { events.push('wait'); time += ms }, pollMs: 1, maxReadyMs: 50, maxObserveMs: 5, ...options })
  const prepared = await run({ mode: 'prepare', ...request, teamId: TEAM, repositoryId: REPOSITORY })
  assert.equal(prepared.status, 'prepared')
  assert.equal(prepared.executionAvailable, false)
  assert.equal(prepared.doNotCreateForThisHandoff, true)
  assert.equal(store.read('preparation.json').promotion.singleAttempt, false)

  events.length = 0
  const watched = await run({ mode: 'watch', deploymentId: DEPLOYMENT })
  assert.equal(watched.status, 'ready_read_only')
  assert.equal(watched.executionAvailable, false)
  const ready = events.indexOf('deployment:READY')
  assert.ok(ready > events.indexOf('deployment:INITIALIZING'))
  assert.ok(events.indexOf('wait') < ready)
  assert.ok(events.findIndex(event => event.includes('/git/ref/heads/main')) > ready)
  assert.ok(events.findIndex(event => event.includes('/attempts/2/jobs')) > ready)
  assert.ok(events.findIndex(event => event.includes('/v4/aliases/www.illinimarket.com')) > ready)
  assert.ok(events.indexOf(`public:${ORIGIN}`) > ready)
  assert.equal(store.has('promote-intent.json'), false)

  const beforeExecute = h.calls.length
  const execution = await run({ mode: 'watch', deploymentId: DEPLOYMENT, execute: true })
  assert.equal(execution.status, 'blocked')
  assert.equal(execution.reason, 'single_attempt_promotion_transport_unavailable')
  assert.equal(h.calls.length, beforeExecute, 'unavailable execution is blocked before any CLI invocation')
  assert.equal(store.has('promote-intent.json'), false)

  // Model an independently completed domain transition. Reconcile remains
  // read-only and must verify both alias records, both runtimes and root URL.
  for (const alias of Object.values(h.data.aliases)) alias.deploymentId = DEPLOYMENT
  const reconciled = await run({ mode: 'reconcile', deploymentId: DEPLOYMENT })
  assert.equal(reconciled.status, 'verified')
  assert.equal(reconciled.readOnly, true)
  assert.ok(events.includes('public:https://www.illinimarket.com'))
  assert.ok(events.includes('public:https://illinimarket.com'))
  assert.ok(h.calls.every(call => !call.args.includes('POST')))
  assert.equal(store.has('promote-intent.json'), false)
})
