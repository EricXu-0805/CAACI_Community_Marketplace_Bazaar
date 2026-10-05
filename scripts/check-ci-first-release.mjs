// Supplementary, offline release preflight. This never deploys or changes a
// platform setting. Snapshots must come from authorized, fresh read-only calls;
// JSON supplied to this program is not authenticated or a distributed lock.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const RELEASE_REPOSITORY = 'EricXu-0805/CAACI_Community_Marketplace_Bazaar'
export const RELEASE_PROJECT = 'prj_IDIIOZ155y2b8H6Ky0m0tGpZ2Jae'
export const REQUIRED_RELEASE_CHECKS = Object.freeze([
  'Type-check', 'Boundary regressions', 'Build H5', 'Build mp-weixin',
  'Smoke (public page sweep)', 'Smoke (protected staging account)',
  'Production release readiness',
])
const SHA = /^[0-9a-f]{40}$/

export function ciFirstReleaseFailures(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['invalid snapshot']
  const failures = []
  if (typeof input.requestedSha !== 'string' || !SHA.test(input.requestedSha)) failures.push('full requested commit required')
  if (input.mainSha !== input.requestedSha) failures.push('main moved or differs from requested commit')
  if (input.projectId !== RELEASE_PROJECT) failures.push('wrong deployment project')
  if (input.vercelConfig?.git?.deploymentEnabled !== false) failures.push('automatic Git deployment must be disabled for every branch')
  // An absent snapshot is not evidence that there is no competing candidate.
  const inventory = input.productionCandidates
  if (inventory?.projectId !== RELEASE_PROJECT || inventory?.complete !== true
      || !Array.isArray(inventory?.items) || inventory.items.length) {
    failures.push('unresolved production candidate or missing candidate inventory')
  }
  const run = input.run
  if (!run || run.repository?.full_name !== RELEASE_REPOSITORY
      || run.path !== '.github/workflows/ci.yml' || run.name !== 'CI'
      || run.head_branch !== 'main' || run.head_sha !== input.requestedSha
      || !['push', 'workflow_dispatch'].includes(run.event)
      || run.status !== 'completed' || run.conclusion !== 'success'
      || !Number.isSafeInteger(run.id) || run.id <= 0
      || !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0) {
    failures.push('exact main workflow run has not succeeded')
  }
  const jobs = input.jobs
  if (!jobs || jobs.run_id !== run?.id || jobs.run_attempt !== run?.run_attempt
      || jobs.complete !== true || !Array.isArray(jobs.items)) {
    failures.push('complete job inventory for this run attempt required')
  } else {
    for (const name of REQUIRED_RELEASE_CHECKS) {
      const matching = jobs.items.filter(job => job?.name === name)
      if (matching.length !== 1 || matching[0].status !== 'completed' || matching[0].conclusion !== 'success'
          || matching[0].run_id !== run?.id || matching[0].run_attempt !== run?.run_attempt
          || matching[0].head_sha !== input.requestedSha) {
        failures.push(`release check not successful exactly once: ${name}`)
      }
    }
    if (jobs.items.some(job => !REQUIRED_RELEASE_CHECKS.includes(job?.name))) failures.push('unexpected workflow job set')
  }
  return failures
}

export function ciFirstReleasePlan(input) {
  const failures = ciFirstReleaseFailures(input)
  return {
    mode: 'offline-preflight-only',
    snapshotEligible: failures.length === 0,
    failures,
    ...(failures.length ? {} : {
      commit: input.requestedSha,
      projectId: RELEASE_PROJECT,
      ciRun: input.run.id,
      ciAttempt: input.run.run_attempt,
      nextAction: 'After authorization and a fresh live recheck, create this exact SHA once in the existing project using main/Production configuration.',
    }),
    deploymentPerformed: false,
    claimsAtomicCronHandoff: false,
    requiresLiveRecheckAndSerializedRelease: true,
    requiresExistingIdentityGate: true,
    strictHandoffStillRequiresDurableDrainAndEffectFencing: true,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('one snapshot file is required')
    const raw = readFileSync(process.argv[2], 'utf8')
    if (Buffer.byteLength(raw) > 256 * 1024) throw new Error('snapshot exceeds 256 KiB')
    const plan = ciFirstReleasePlan(JSON.parse(raw))
    console.log(JSON.stringify(plan, null, 2))
    if (!plan.snapshotEligible) process.exitCode = 1
  } catch {
    // Do not echo arbitrary snapshot contents, paths or parser diagnostics.
    console.error('Release preflight blocked: invalid or unreadable snapshot.')
    process.exitCode = 1
  }
}
