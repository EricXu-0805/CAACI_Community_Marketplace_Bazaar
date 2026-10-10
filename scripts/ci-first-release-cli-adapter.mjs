// Read-only CLI transport for the release runner. No command runs on import.
// Vercel CLI implicitly retries mutations, so promotion is deliberately
// unavailable, including with execute:true or an injected CLI command runner.
import { execFile } from 'node:child_process'
import { RELEASE_PROJECT, RELEASE_REPOSITORY } from './check-ci-first-release.mjs'

const SHA = /^[0-9a-f]{40}$/
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{1,128}$/
const NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DOMAINS = ['illinimarket.com', 'www.illinimarket.com']
const STATES = new Set(['QUEUED', 'INITIALIZING', 'BUILDING', 'BLOCKED', 'READY', 'ERROR', 'CANCELED'])
const MAX_BUFFER = 4 * 1024 * 1024
const MAX_PAGES = 100
const PROMOTE_PATH = '/v10/projects/{projectId}/promote/{deploymentId}'
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const positive = value => Number.isSafeInteger(value) && value > 0
const numericId = value => (typeof value === 'string' && /^[1-9][0-9]{0,15}$/.test(value)
  && positive(Number(value))) || positive(value)

class AdapterError extends Error {
  constructor(code) { super(code); this.code = code }
}
function requireValue(condition, code = 'release_adapter_invalid_response') {
  if (!condition) throw new AdapterError(code)
}
function parseJson(text) {
  try { return JSON.parse(text) } catch { throw new AdapterError('release_adapter_invalid_json') }
}
function defaultRunCommand(command, args, { timeoutMs, maxBuffer }) {
  return new Promise(resolve => {
    execFile(command, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer, killSignal: 'SIGKILL',
      windowsHide: true, shell: false }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, exitCode: error ? (Number.isInteger(error.code) ? error.code : -1) : 0 })
    })
  })
}

export function createCliAdapter({ teamId, repositoryId, execute = false,
  runCommand = defaultRunCommand, fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  requireValue(typeof teamId === 'string' && /^team_[A-Za-z0-9]{1,128}$/.test(teamId)
    && numericId(repositoryId) && typeof execute === 'boolean'
    && typeof runCommand === 'function' && typeof fetchImpl === 'function'
    && positive(timeoutMs) && timeoutMs <= 60_000, 'release_adapter_invalid_options')
  const repoId = Number(repositoryId)
  const candidateOrigins = new Set()
  const sameRepo = value => numericId(value) && Number(value) === repoId
  const scopedPath = (path, params = {}) => `${path}?${new URLSearchParams({ ...params, teamId })}`

  async function command(name, args, help = false) {
    let timer
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => runCommand(name, args, { timeoutMs, maxBuffer: MAX_BUFFER })),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new AdapterError('release_adapter_command_timeout')), timeoutMs) }),
      ])
      requireValue(object(result) && typeof result.stdout === 'string' && typeof result.stderr === 'string'
        && Buffer.byteLength(result.stdout) <= MAX_BUFFER && Buffer.byteLength(result.stderr) <= MAX_BUFFER,
      'release_adapter_command_failed')
      requireValue(result.exitCode === 0 || (help && result.exitCode === 2), 'release_adapter_command_failed')
      return help ? `${result.stdout}\n${result.stderr}` : result.stdout
    } catch (error) {
      if (error instanceof AdapterError) throw error
      throw new AdapterError('release_adapter_command_failed')
    } finally { clearTimeout(timer) }
  }
  async function gh(path) {
    return parseJson(await command('gh', ['api', path, '--hostname', 'github.com', '--method', 'GET',
      '--header', 'Accept: application/vnd.github+json', '--header', 'Cache-Control: no-cache']))
  }
  async function vercel(path) {
    return parseJson(await command('vercel', ['api', path, '--method', 'GET', '--raw', '--non-interactive', '--scope', teamId]))
  }
  async function verifyProject() {
    const project = await vercel(scopedPath(`/v9/projects/${RELEASE_PROJECT}`))
    const [org, repo] = RELEASE_REPOSITORY.split('/')
    requireValue(project?.id === RELEASE_PROJECT && project.accountId === teamId
      && project.link?.type === 'github' && sameRepo(project.link.repoId)
      && project.link.org === org && project.link.repo === repo && project.link.productionBranch === 'main',
    'release_adapter_project_mismatch')
    return project
  }
  function deployment(raw, deploymentId) {
    requireValue(object(raw) && raw.id === deploymentId && DEPLOYMENT_ID.test(raw.id)
      && raw.projectId === RELEASE_PROJECT && raw.ownerId === teamId
      && (raw.team === undefined || raw.team?.id === teamId)
      && (raw.project === undefined || raw.project?.id === RELEASE_PROJECT)
      && (raw.teamId === undefined || raw.teamId === teamId)
      && raw.target === 'production' && STATES.has(raw.readyState) && positive(raw.createdAt)
      && raw.gitSource?.type === 'github' && sameRepo(raw.gitSource.repoId)
      && typeof raw.gitSource.ref === 'string' && raw.gitSource.ref.length > 0
      && typeof raw.gitSource.sha === 'string' && SHA.test(raw.gitSource.sha), 'release_adapter_deployment_mismatch')
    const missingUrl = raw.url === null && raw.readyState !== 'READY'
    requireValue(missingUrl || (typeof raw.url === 'string'
      && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(raw.url)),
      'release_adapter_deployment_url_invalid')
    const url = missingUrl ? null : `https://${raw.url}`
    if (url !== null) candidateOrigins.add(url)
    return { id: raw.id, projectId: RELEASE_PROJECT, teamId, target: raw.target,
      readyState: raw.readyState, createdAt: raw.createdAt, url,
      gitSource: { type: 'github', repoId, ref: raw.gitSource.ref, sha: raw.gitSource.sha } }
  }
  async function readDeployment({ deploymentId } = {}) {
    requireValue(typeof deploymentId === 'string' && DEPLOYMENT_ID.test(deploymentId), 'release_adapter_invalid_deployment')
    await verifyProject()
    return deployment(await vercel(scopedPath(`/v13/deployments/${deploymentId}`, { withGitRepoInfo: 'true' })), deploymentId)
  }
  async function readCandidates() {
    await verifyProject()
    const seen = new Set(), items = []
    let until
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await vercel(scopedPath('/v7/deployments', {
        projectId: RELEASE_PROJECT, target: 'production', limit: '100', ...(until === undefined ? {} : { until: String(until) }),
      }))
      requireValue(object(data) && Array.isArray(data.deployments) && object(data.pagination)
        && Number.isSafeInteger(data.pagination.count) && data.pagination.count === data.deployments.length
        && data.deployments.length <= 100, 'release_adapter_inventory_incomplete')
      for (const item of data.deployments) {
        requireValue(object(item) && typeof item.uid === 'string' && DEPLOYMENT_ID.test(item.uid)
          && !seen.has(item.uid) && item.projectId === RELEASE_PROJECT && item.target === 'production'
          && (item.teamId === undefined || item.teamId === teamId)
          && STATES.has(item.readyState) && (item.state === undefined || item.state === item.readyState),
        'release_adapter_inventory_invalid')
        seen.add(item.uid)
        // OpenAPI defines PROMOTED as having seen production traffic, STAGED as
        // never having seen it, and ROLLING as a transition. Historical READY
        // records are excluded only with affirmative promotion evidence.
        requireValue(item.readySubstate === undefined || ['PROMOTED', 'STAGED', 'ROLLING'].includes(item.readySubstate),
          'release_adapter_inventory_unknown_state')
        if (['ERROR', 'CANCELED'].includes(item.readyState)) continue
        // aliasAssigned alone can describe default/staging aliases and does
        // not prove production traffic, including for legacy READY records.
        const historical = item.readyState === 'READY' && item.readySubstate === 'PROMOTED'
        if (!historical) items.push({ id: item.uid, projectId: RELEASE_PROJECT, teamId, target: 'production', readyState: item.readyState })
      }
      const next = data.pagination.next
      if (next === null) return { projectId: RELEASE_PROJECT, teamId, complete: true, items }
      requireValue(positive(next) && (until === undefined || next < until) && data.deployments.length > 0,
        'release_adapter_inventory_incomplete')
      until = next
    }
    throw new AdapterError('release_adapter_inventory_limit')
  }
  async function readRun(runId, runAttempt, requestedSha) {
    const run = await gh(`/repos/${RELEASE_REPOSITORY}/actions/runs/${runId}`)
    requireValue(run?.id === runId && run.run_attempt === runAttempt && run.head_sha === requestedSha
      && run.repository?.full_name === RELEASE_REPOSITORY && sameRepo(run.repository.id), 'release_adapter_ci_binding_mismatch')
    return run
  }
  async function readMain() {
    const ref = await gh(`/repos/${RELEASE_REPOSITORY}/git/ref/heads/main`)
    requireValue(ref?.ref === 'refs/heads/main' && ref.object?.type === 'commit'
      && typeof ref.object.sha === 'string' && SHA.test(ref.object.sha), 'release_adapter_main_invalid')
    return ref.object.sha
  }
  async function readConfig(requestedSha) {
    const config = await gh(`/repos/${RELEASE_REPOSITORY}/contents/vercel.json?ref=${requestedSha}`)
    requireValue(config?.type === 'file' && config.path === 'vercel.json' && config.encoding === 'base64'
      && typeof config.content === 'string' && Number.isSafeInteger(config.size) && config.size > 0 && config.size <= 256 * 1024,
    'release_adapter_config_invalid')
    const encoded = config.content.replace(/\n/g, '')
    const bytes = Buffer.from(encoded, 'base64')
    requireValue(bytes.toString('base64') === encoded && bytes.length === config.size, 'release_adapter_config_invalid')
    const configJson = parseJson(bytes.toString('utf8'))
    requireValue(object(configJson), 'release_adapter_config_invalid')
    return configJson
  }
  async function readSnapshot({ requestedSha, runId, runAttempt, candidateId } = {}) {
    requireValue(typeof requestedSha === 'string' && SHA.test(requestedSha) && positive(runId) && positive(runAttempt)
      && (candidateId === undefined || (typeof candidateId === 'string' && DEPLOYMENT_ID.test(candidateId))),
    'release_adapter_invalid_snapshot_request')
    const [mainSha, run, vercelConfig, productionCandidates] = await Promise.all([
      readMain(), readRun(runId, runAttempt, requestedSha), readConfig(requestedSha), readCandidates(),
    ])
    const jobs = [], jobIds = new Set()
    let expectedCount
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await gh(`/repos/${RELEASE_REPOSITORY}/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100&page=${page}`)
      requireValue(object(data) && Number.isSafeInteger(data.total_count) && data.total_count >= 0
        && data.total_count <= MAX_PAGES * 100 && Array.isArray(data.jobs) && data.jobs.length <= 100
        && (expectedCount === undefined || data.total_count === expectedCount), 'release_adapter_jobs_incomplete')
      expectedCount = data.total_count
      for (const job of data.jobs) {
        requireValue(object(job) && positive(job.id) && !jobIds.has(job.id) && job.run_id === runId
          && job.head_sha === requestedSha && (job.run_attempt === undefined || job.run_attempt === runAttempt)
          && typeof job.name === 'string' && typeof job.status === 'string'
          && (job.conclusion === null || typeof job.conclusion === 'string'), 'release_adapter_job_mismatch')
        jobIds.add(job.id)
        // The attempt-specific endpoint binds jobs lacking the optional
        // run_attempt response field; a conflicting field is never rewritten.
        jobs.push({ id: job.id, name: job.name, status: job.status, conclusion: job.conclusion,
          run_id: job.run_id, run_attempt: runAttempt, head_sha: job.head_sha })
      }
      requireValue(jobs.length <= expectedCount, 'release_adapter_jobs_incomplete')
      if (jobs.length === expectedCount) break
      requireValue(data.jobs.length === 100 && page < MAX_PAGES, 'release_adapter_jobs_incomplete')
    }
    const [latestRun, latestMain] = await Promise.all([readRun(runId, runAttempt, requestedSha), readMain()])
    requireValue(latestRun.status === run.status && latestRun.conclusion === run.conclusion
      && latestMain === mainSha, 'release_adapter_snapshot_changed')
    return { requestedSha, mainSha, projectId: RELEASE_PROJECT, teamId, repositoryId: repoId,
      vercelConfig, productionCandidates,
      run: { id: run.id, run_attempt: run.run_attempt, repository: { id: repoId, full_name: run.repository.full_name },
        path: run.path, name: run.name, head_branch: run.head_branch, head_sha: run.head_sha,
        event: run.event, status: run.status, conclusion: run.conclusion },
      jobs: { run_id: runId, run_attempt: runAttempt, complete: true, items: jobs } }
  }
  async function readAliases() {
    await verifyProject()
    const items = []
    for (const alias of DOMAINS) {
      const data = await vercel(scopedPath(`/v4/aliases/${alias}`, { projectId: RELEASE_PROJECT }))
      requireValue(data?.alias === alias && data.projectId === RELEASE_PROJECT
        && typeof data.deploymentId === 'string' && DEPLOYMENT_ID.test(data.deploymentId)
        && (data.teamId === undefined || data.teamId === teamId)
        && (data.deployment === undefined || data.deployment?.id === data.deploymentId)
        && data.deletedAt == null && data.microfrontends == null, 'release_adapter_alias_mismatch')
      items.push({ alias, deploymentId: data.deploymentId, projectId: RELEASE_PROJECT })
    }
    return { projectId: RELEASE_PROJECT, teamId, complete: true, items }
  }
  async function publicGet(url, json) {
    const controller = new AbortController()
    let reader, timer
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', credentials: 'omit',
            cache: 'no-store', headers: { Accept: json ? 'application/json' : 'text/html', 'Cache-Control': 'no-cache, no-store' },
            signal: controller.signal })
          requireValue(response && typeof response.status === 'number' && !response.redirected, 'release_adapter_http_invalid')
          if (!json) {
            requireValue([307, 308].includes(response.status)
              && response.headers.get('location') === 'https://www.illinimarket.com/', 'release_adapter_root_redirect_invalid')
            void response.body?.cancel().catch(() => {})
            return { status: response.status, location: response.headers.get('location') }
          }
          requireValue(response.status === 200 && /^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || ''),
            'release_adapter_identity_http_invalid')
          const length = response.headers.get('content-length')
          requireValue(length === null || (/^[0-9]+$/.test(length) && Number(length) <= 4096), 'release_adapter_identity_too_large')
          requireValue(response.body && typeof response.body.getReader === 'function', 'release_adapter_identity_invalid')
          reader = response.body.getReader()
          const chunks = []; let size = 0
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            requireValue(size <= 4096, 'release_adapter_identity_too_large')
            chunks.push(value)
          }
          return parseJson(Buffer.concat(chunks).toString('utf8'))
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new AdapterError('release_adapter_http_timeout'))
        }, Math.min(timeoutMs, 3000)) }),
      ])
    } catch (error) {
      if (error instanceof AdapterError) throw error
      throw new AdapterError('release_adapter_http_failed')
    } finally {
      clearTimeout(timer)
      controller.abort()
      if (reader) void reader.cancel().catch(() => {})
    }
  }
  async function readIdentity({ origin, nonce } = {}) {
    requireValue(typeof origin === 'string' && (origin === 'https://www.illinimarket.com' || candidateOrigins.has(origin))
      && typeof nonce === 'string' && NONCE.test(nonce), 'release_adapter_identity_target_invalid')
    const data = await publicGet(`${origin}/api/deployment-identity?nonce=${nonce}`, true)
    requireValue(data?.schema === 1 && data.environment === 'production' && data.nonce === nonce
      && typeof data.deploymentId === 'string' && DEPLOYMENT_ID.test(data.deploymentId)
      && typeof data.commit === 'string' && SHA.test(data.commit)
      && typeof data.projectRef === 'string' && /^[a-z0-9]{20}$/.test(data.projectRef)
      && ['https://illinimarket.com', 'https://www.illinimarket.com'].includes(data.appOrigin), 'release_adapter_identity_invalid')
    return { schema: data.schema, environment: data.environment, deploymentId: data.deploymentId,
      commit: data.commit, projectRef: data.projectRef, appOrigin: data.appOrigin, nonce: data.nonce }
  }
  async function verifyPromotionSupport() {
    const ghHelp = await command('gh', ['api', '--help'], true)
    const vercelHelp = await command('vercel', ['api', '--help'], true)
    requireValue(/--method\b/.test(ghHelp) && /--hostname\b/.test(ghHelp)
      && /--method\b/.test(vercelHelp) && /\bPOST\b/.test(vercelHelp)
      && /--raw\b/.test(vercelHelp) && /--non-interactive\b/.test(vercelHelp)
      && /--scope\b/.test(vercelHelp), 'release_adapter_promote_unsupported')
    // Installed CLI client.fetch() retries failed requests by default, including
    // POST; neither api nor promote exposes a supported no-retry control.
    // One subprocess cannot establish one HTTP attempt. An injected runCommand
    // does not change this capability or authorize bypassing this boundary.
    return { method: 'POST', pathTemplate: PROMOTE_PATH, force: false,
      singleAttempt: false, reason: 'vercel_cli_implicit_mutation_retries' }
  }
  async function promote({ deploymentId } = {}) {
    requireValue(execute === true, 'release_adapter_execute_required')
    requireValue(typeof deploymentId === 'string' && DEPLOYMENT_ID.test(deploymentId), 'release_adapter_invalid_deployment')
    throw new AdapterError('release_adapter_promotion_transport_unavailable')
  }
  const safe = fn => async (...args) => {
    try { return await fn(...args) } catch (error) {
      if (error instanceof AdapterError) throw error
      throw new AdapterError('release_adapter_operation_failed')
    }
  }
  return Object.freeze({ verifyPromotionSupport: safe(verifyPromotionSupport), readSnapshot: safe(readSnapshot),
    readCandidates: safe(readCandidates), readDeployment: safe(readDeployment), readAliases: safe(readAliases),
    readIdentity: safe(readIdentity), readRootRedirect: safe(() => publicGet('https://illinimarket.com/', false)),
    promote: safe(promote) })
}
