import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ciFirstReleasePlan, REQUIRED_RELEASE_CHECKS, RELEASE_REPOSITORY, RELEASE_PROJECT } from './check-ci-first-release.mjs'

const SHA = 'a'.repeat(40)
function fixture() {
  return {
    requestedSha: SHA, mainSha: SHA, projectId: RELEASE_PROJECT,
    vercelConfig: JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url))),
    productionCandidates: { projectId: RELEASE_PROJECT, complete: true, items: [] },
    run: { id: 731, run_attempt: 2, repository: { full_name: RELEASE_REPOSITORY },
      path: '.github/workflows/ci.yml', name: 'CI', head_branch: 'main', head_sha: SHA,
      event: 'push', status: 'completed', conclusion: 'success' },
    jobs: { run_id: 731, run_attempt: 2, complete: true,
      items: REQUIRED_RELEASE_CHECKS.map(name => ({ name, status: 'completed', conclusion: 'success', run_id: 731, run_attempt: 2, head_sha: SHA })) },
  }
}
const blocked = input => assert.equal(ciFirstReleasePlan(input).snapshotEligible, false)

test('exact successful main CI permits only a local plan, never deployment or an atomic-handoff claim', () => {
  const plan = ciFirstReleasePlan(fixture())
  assert.equal(plan.snapshotEligible, true)
  assert.equal(plan.commit, SHA)
  assert.equal(plan.deploymentPerformed, false)
  assert.equal(plan.claimsAtomicCronHandoff, false)
  assert.equal(plan.strictHandoffStillRequiresDurableDrainAndEffectFencing, true)
})

for (const name of REQUIRED_RELEASE_CHECKS) {
  test(`${name}: failure, skip, cancellation, incomplete, missing and duplicate results block candidate creation`, () => {
    for (const conclusion of ['failure', 'skipped', 'cancelled', 'timed_out', null]) {
      const f = fixture(); f.jobs.items.find(j => j.name === name).conclusion = conclusion; blocked(f)
    }
    const running = fixture(); running.jobs.items.find(j => j.name === name).status = 'in_progress'; blocked(running)
    const missing = fixture(); missing.jobs.items = missing.jobs.items.filter(j => j.name !== name); blocked(missing)
    const duplicate = fixture(); duplicate.jobs.items.push({ ...duplicate.jobs.items.find(j => j.name === name) }); blocked(duplicate)
    for (const [key, value] of [['run_id', 730], ['run_attempt', 1], ['head_sha', 'b'.repeat(40)], ['run_id', undefined], ['run_attempt', undefined], ['head_sha', undefined]]) {
      const mixed = fixture(); mixed.jobs.items.find(j => j.name === name)[key] = value; blocked(mixed)
    }
  })
}

test('a green PR, stale SHA, scheduled audit, wrong project/repo/workflow or previous run attempt cannot release', () => {
  const mutations = [
    f => { f.run.event = 'pull_request' }, f => { f.run.event = 'schedule' },
    f => { f.mainSha = 'b'.repeat(40) }, f => { f.run.head_sha = 'b'.repeat(40) },
    f => { f.requestedSha = 'a'.repeat(7) }, f => { f.projectId = 'prj_other' },
    f => { f.run.repository.full_name = 'other/repository' },
    f => { f.run.path = '.github/workflows/other.yml' }, f => { f.run.name = 'Other' },
    f => { f.run.head_branch = 'feature' }, f => { f.run.status = 'in_progress' },
    f => { f.run.conclusion = 'failure' }, f => { f.run.id = 0 },
    f => { f.jobs.run_attempt = 1 }, f => { f.jobs.run_id = 730 },
    f => { f.jobs.complete = false }, f => { f.jobs.items.push({ name: 'Unexpected', conclusion: 'success' }) },
  ]
  for (const mutate of mutations) { const f = fixture(); mutate(f); blocked(f) }
  const manual = fixture(); manual.run.event = 'workflow_dispatch'; assert.equal(ciFirstReleasePlan(manual).snapshotEligible, true)
})

test('automatic creation, existing READY/staged candidates and missing inventory block the CI-first path', () => {
  for (const deploymentEnabled of [true, { '**': false, main: true }, { '**': false, main: false }, undefined]) {
    const f = fixture(); f.vercelConfig.git.deploymentEnabled = deploymentEnabled; blocked(f)
  }
  for (const productionCandidates of [undefined, null, [],
    { projectId: 'prj_other', complete: true, items: [] },
    { projectId: RELEASE_PROJECT, complete: false, items: [] },
    { projectId: RELEASE_PROJECT, complete: true, items: ['dpl_Staged'] },
    { projectId: RELEASE_PROJECT, complete: true, items: [{ id: 'dpl_Ready', state: 'READY' }] }]) {
    const f = fixture(); f.productionCandidates = productionCandidates; blocked(f)
  }
})

test('the release plan remains blocked until the entire CI run completes', () => {
  const f = fixture(); f.run.status = 'in_progress'; f.run.conclusion = null
  blocked(f)
  f.run.status = 'completed'; f.run.conclusion = 'success'
  assert.equal(ciFirstReleasePlan(f).snapshotEligible, true)
  // Residual alias/tick races are exercised by the actual _cron-release tests
  // and the separate handoff-reference model. Do not turn this plan into a
  // scheduler simulator or claim that creating the candidate switches alias.
})

test('CLI malformed and oversized snapshots fail without echoing inputs or executing deployment commands', () => {
  const dir = mkdtempSync(join(tmpdir(), 'illini-release-plan-'))
  const input = join(dir, 'snapshot.json')
  const script = new URL('./check-ci-first-release.mjs', import.meta.url).pathname
  try {
    for (const body of ['{ sensitive-marker', JSON.stringify(null), JSON.stringify({ padding: 'x'.repeat(256 * 1024) })]) {
      writeFileSync(input, body)
      const r = spawnSync(process.execPath, [script, input], { encoding: 'utf8' })
      assert.equal(r.status, 1)
      assert.doesNotMatch(r.stdout + r.stderr, /sensitive-marker/)
    }
    writeFileSync(input, JSON.stringify(fixture()))
    const r = spawnSync(process.execPath, [script, input], { encoding: 'utf8' })
    assert.equal(r.status, 0)
    assert.equal(JSON.parse(r.stdout).deploymentPerformed, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
