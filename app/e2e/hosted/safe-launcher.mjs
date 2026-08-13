import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  access,
  chmod,
  mkdtemp,
  open,
  realpath,
  rm,
  stat,
} from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
  sep,
} from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

export const HOSTED_OUTPUT_PREFIX = 'caaci-hosted-realtime-'
export const HOSTED_RUN_PREFIX = 'caaci-hosted-realtime-run-'

const LOCK_NAME = '.caaci-hosted-realtime.lock'
const MAX_STREAM_BYTES = 16 * 1024
const CHILD_GRACEFUL_STOP_MS = 150_000
const CHILD_TERM_GRACE_MS = 5_000
const MAX_RUN_MS = 21 * 60 * 1_000
const EXPECTED_TRANSCRIPT = Object.freeze([
  '[HOSTED-CANARY] AUTH-01 passed',
  '[HOSTED-CANARY] AUTH-02 passed',
  '[HOSTED-CANARY] RLS-01 passed',
  '[HOSTED-CANARY] FAIL-01 passed',
  '[HOSTED-CANARY] DEDUPE-01 passed',
  '[HOSTED-CANARY] SWITCH-01 passed',
  '[HOSTED-CANARY] BLOCK-01 passed',
  '[HOSTED-CANARY] NOTIFY-01 passed',
  '[HOSTED-CANARY] SCALE-01 passed',
  '[HOSTED-CANARY] LIFE-01 passed',
  '[HOSTED-CANARY] SUMMARY passed pass=10 fail=0',
])
const SCENARIO_LINE =
  /^\[HOSTED-CANARY\] (?:AUTH-01|AUTH-02|RLS-01|FAIL-01|DEDUPE-01|SWITCH-01|BLOCK-01|NOTIFY-01|SCALE-01|LIFE-01) (?:passed|failed|timedOut|timedout|interrupted|skipped|unknown)$/
const SUMMARY_LINE =
  /^\[HOSTED-CANARY\] SUMMARY (?:passed|failed|timedOut|timedout|interrupted|skipped|unknown) pass=\d+ fail=\d+$/
const HARNESS_LINE = /^\[HOSTED-CANARY\] HARNESS failed$/

const AMBIENT_OS_ENV_KEYS = Object.freeze([
  'ComSpec',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'PATH',
  'PATHEXT',
  'SHELL',
  'SystemRoot',
  'TZ',
  'USER',
  'WINDIR',
])
const HOSTED_CANARY_INPUT_ENV_KEYS = Object.freeze([
  'CAACI_HOSTED_CANARY_MODE',
  'CAACI_HOSTED_CANARY_CONFIRM',
  'CAACI_HOSTED_CANARY_WRITE_ENABLED',
  'CAACI_HOSTED_CANARY_TARGET_IS_STAGING',
  'CAACI_HOSTED_CANARY_ACCOUNTS_ARE_SYNTHETIC',
  'CAACI_HOSTED_CANARY_DATASET_IS_DISPOSABLE',
  'CAACI_HOSTED_CANARY_APP_ORIGIN',
  'CAACI_HOSTED_CANARY_PROJECT_REF',
  'CAACI_HOSTED_CANARY_COMMIT_SHA',
  'CAACI_HOSTED_CANARY_DATASET_LINEAGE',
  'CAACI_HOSTED_CANARY_PUBLISHABLE_KEY',
  'CAACI_HOSTED_CANARY_AB_CONVERSATION_ID',
  'CAACI_HOSTED_CANARY_AC_CONVERSATION_ID',
  'CAACI_HOSTED_CANARY_A_EMAIL',
  'CAACI_HOSTED_CANARY_A_PASSWORD',
  'CAACI_HOSTED_CANARY_A_USER_ID',
  'CAACI_HOSTED_CANARY_B_EMAIL',
  'CAACI_HOSTED_CANARY_B_PASSWORD',
  'CAACI_HOSTED_CANARY_B_USER_ID',
  'CAACI_HOSTED_CANARY_C_EMAIL',
  'CAACI_HOSTED_CANARY_C_PASSWORD',
  'CAACI_HOSTED_CANARY_C_USER_ID',
])
const AUTOMATION_ENV_KEYS = Object.freeze([
  'BITBUCKET_BUILD_NUMBER',
  'BUILDKITE',
  'CIRCLECI',
  'CI',
  'CODEBUILD_BUILD_ID',
  'DRONE',
  'GITHUB_ACTIONS',
  'GITHUB_JOB',
  'GITHUB_RUN_ID',
  'GITHUB_WORKFLOW',
  'GITLAB_CI',
  'JENKINS_URL',
  'NETLIFY',
  'RENDER',
  'TEAMCITY_VERSION',
  'TF_BUILD',
  'TRAVIS',
  'VERCEL',
])
const AUTOMATION_ENV_PREFIXES = Object.freeze([
  'BUILDKITE_',
  'CIRCLE_',
  'CI_',
  'GITHUB_RUNNER_',
  'GITLAB_',
  'JENKINS_',
  'RUNNER_',
  'TEAMCITY_',
])
const UNSAFE_PARENT_ENV_KEYS = Object.freeze([
  'CAACI_HOSTED_CANARY_RUN_ID',
  'NODE_EXTRA_CA_CERTS',
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'OPENSSL_CONF',
  'PWDEBUG',
])
const UNSAFE_PARENT_ENV_PREFIXES = Object.freeze([
  'PLAYWRIGHT_',
])

export function sanitizeHostedCanaryLine(value) {
  const line = String(value).replace(/\r$/, '')
  return (
    SCENARIO_LINE.test(line)
    || SUMMARY_LINE.test(line)
    || HARNESS_LINE.test(line)
  ) ? line : null
}

export function hostedCanaryArgsAllowed(args) {
  return Array.isArray(args) && args.length === 0
}

export function hostedCanaryTranscriptIsComplete(lines) {
  return (
    Array.isArray(lines)
    && lines.length === EXPECTED_TRANSCRIPT.length
    && EXPECTED_TRANSCRIPT.every((line, index) => lines[index] === line)
  )
}

export function hostedCanaryAutomationEnvDetected(env) {
  return (
    AUTOMATION_ENV_KEYS.some(key => Boolean(env?.[key]))
    || Object.entries(env || {}).some(([key, value]) => (
      Boolean(value)
      && AUTOMATION_ENV_PREFIXES.some(prefix => key.startsWith(prefix))
    ))
  )
}

export function hostedCanaryUnsafeParentEnvDetected(env) {
  return (
    UNSAFE_PARENT_ENV_KEYS.some(key => Boolean(env?.[key]))
    || Object.entries(env || {}).some(([key, value]) => (
      Boolean(value)
      && UNSAFE_PARENT_ENV_PREFIXES.some(prefix => key.startsWith(prefix))
    ))
  )
}

export function buildHostedCanaryChildEnv(
  sourceEnv,
  runRoot,
  outputDir,
  browserExecutable,
  runId,
) {
  const childEnv = Object.create(null)
  for (const key of [...AMBIENT_OS_ENV_KEYS, ...HOSTED_CANARY_INPUT_ENV_KEYS]) {
    if (
      Object.prototype.hasOwnProperty.call(sourceEnv, key)
      && typeof sourceEnv[key] === 'string'
    ) {
      childEnv[key] = sourceEnv[key]
    }
  }
  childEnv.CAACI_HOSTED_CANARY_LAUNCHER = 'v2'
  childEnv.CAACI_HOSTED_CANARY_RUN_ID = runId
  childEnv.CAACI_HOSTED_CANARY_OUTPUT_DIR = outputDir
  childEnv.CAACI_HOSTED_CANARY_BROWSER_EXECUTABLE = browserExecutable
  childEnv.TMPDIR = runRoot
  childEnv.TMP = runRoot
  childEnv.TEMP = runRoot
  childEnv.HOME = runRoot
  childEnv.USERPROFILE = runRoot
  childEnv.XDG_CACHE_HOME = join(runRoot, 'cache')
  childEnv.XDG_CONFIG_HOME = join(runRoot, 'config')
  childEnv.XDG_DATA_HOME = join(runRoot, 'data')
  childEnv.APPDATA = join(runRoot, 'appdata')
  childEnv.LOCALAPPDATA = join(runRoot, 'localappdata')
  childEnv.FORCE_COLOR = '0'
  childEnv.NO_COLOR = '1'
  return childEnv
}

async function resolveLocalChromiumExecutable(appRoot) {
  const packageRoot = await realpath(
    resolve(appRoot, 'node_modules/@playwright/test'),
  )
  const requireFromApp = createRequire(join(appRoot, 'package.json'))
  const packageEntry = await realpath(requireFromApp.resolve('@playwright/test'))
  if (
    packageEntry !== packageRoot
    && !packageEntry.startsWith(`${packageRoot}${sep}`)
  ) throw new Error('hosted_canary_playwright_not_project_local')

  const localPlaywright = requireFromApp('@playwright/test')
  if (typeof localPlaywright?.chromium?.executablePath !== 'function') {
    throw new Error('hosted_canary_chromium_unavailable')
  }
  const reportedExecutable = localPlaywright.chromium.executablePath()
  if (
    typeof reportedExecutable !== 'string'
    || !isAbsolute(reportedExecutable)
    || resolve(reportedExecutable) !== reportedExecutable
  ) throw new Error('hosted_canary_browser_path_invalid')

  const browserExecutable = await realpath(reportedExecutable)
  const browserStat = await stat(browserExecutable)
  if (!browserStat.isFile()) {
    throw new Error('hosted_canary_browser_not_file')
  }
  await access(browserExecutable, fsConstants.X_OK)
  return browserExecutable
}

function emitFixed(line) {
  process.stdout.write(`${line}\n`)
}

function createBoundedLineCollector(onSafeLine) {
  let buffered = ''
  let consumedBytes = 0
  let overflowed = false

  const consume = chunk => {
    if (overflowed) return
    const chunkBytes = Buffer.isBuffer(chunk)
      ? chunk.length
      : Buffer.byteLength(String(chunk))
    if (chunkBytes > MAX_STREAM_BYTES - consumedBytes) {
      overflowed = true
      buffered = ''
      return
    }
    consumedBytes += chunkBytes
    buffered += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    while (buffered.includes('\n')) {
      const newline = buffered.indexOf('\n')
      const safe = sanitizeHostedCanaryLine(buffered.slice(0, newline))
      buffered = buffered.slice(newline + 1)
      if (safe) onSafeLine(safe)
    }
  }

  const finish = () => {
    if (!overflowed && buffered) {
      const safe = sanitizeHostedCanaryLine(buffered)
      if (safe) onSafeLine(safe)
    }
    buffered = ''
  }

  return {
    consume,
    finish,
    markFailed() {
      overflowed = true
      buffered = ''
    },
    get overflowed() {
      return overflowed
    },
  }
}

export function createChildLifecycle(child) {
  let closed = false
  let spawnFailed = false
  let closeResult = { code: null, signal: null }
  const closePromise = new Promise(resolveClose => {
    child.once('error', () => {
      spawnFailed = true
      if (!child.pid && !closed) {
        closed = true
        resolveClose(closeResult)
      }
    })
    child.once('close', (code, signal) => {
      if (closed) return
      closed = true
      closeResult = { code, signal }
      resolveClose(closeResult)
    })
  })

  let stopPromise
  const signalCli = signal => {
    if (!child.pid) return
    try {
      child.kill(signal)
    } catch {
    }
  }
  const signalProcessTree = signal => {
    if (!child.pid) return
    if (process.platform !== 'win32') {
      try {
        process.kill(-child.pid, signal)
        return
      } catch {
      }
    }
    try {
      child.kill(signal)
    } catch {
    }
  }
  const forceKill = () => {
    if (!closed) signalProcessTree('SIGKILL')
  }
  const stop = () => {
    if (stopPromise) return stopPromise
    stopPromise = (async () => {
      if (closed) return
      signalCli('SIGINT')
      const exitedGracefully = await Promise.race([
        closePromise.then(() => true),
        delay(CHILD_GRACEFUL_STOP_MS, false, { ref: false }),
      ])
      if (exitedGracefully || closed) return
      signalProcessTree('SIGTERM')
      const exitedDuringGrace = await Promise.race([
        closePromise.then(() => true),
        delay(CHILD_TERM_GRACE_MS, false, { ref: false }),
      ])
      if (!exitedDuringGrace && !closed) {
        forceKill()
        await closePromise
      }
    })()
    return stopPromise
  }

  return {
    closePromise,
    forceKill,
    stop,
    get closed() {
      return closed
    },
    get spawnFailed() {
      return spawnFailed
    },
  }
}

async function releaseLock(lockHandle, lockPath) {
  let releaseFailed = false
  try {
    await lockHandle.close()
  } catch {
    releaseFailed = true
  }
  try {
    await rm(lockPath, { force: true })
  } catch {
    releaseFailed = true
  }
  if (releaseFailed) throw new Error('hosted_canary_lock_release_failed')
}

async function main() {
  const forwardedArgs = process.argv.slice(2)
  if (
    !hostedCanaryArgsAllowed(forwardedArgs)
    || hostedCanaryAutomationEnvDetected(process.env)
    || hostedCanaryUnsafeParentEnvDetected(process.env)
  ) {
    return {
      exitCode: 1,
      lines: ['[HOSTED-CANARY] HARNESS failed'],
    }
  }

  const tempRoot = resolve(tmpdir())
  const lockPath = join(tempRoot, LOCK_NAME)
  let lockHandle
  let runRoot
  let child
  let lifecycle
  let runRootMayBeRemoved = false
  let signalExitCode = null
  let shutdownSignalCount = 0
  let signalHandlersInstalled = false
  let outcome
  const safeLines = []
  const stdout = createBoundedLineCollector(line => safeLines.push(line))
  const stderr = createBoundedLineCollector(line => safeLines.push(line))

  const handleShutdownSignal = exitCode => {
    shutdownSignalCount += 1
    if (signalExitCode === null) {
      signalExitCode = exitCode
      if (lifecycle) void lifecycle.stop().catch(() => {})
      return
    }
    if (shutdownSignalCount > 1 && lifecycle) lifecycle.forceKill()
  }
  const onSigint = () => handleShutdownSignal(130)
  const onSigterm = () => handleShutdownSignal(143)

  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)
  signalHandlersInstalled = true

  try {
    lockHandle = await open(lockPath, 'wx', 0o600)
    runRoot = await mkdtemp(join(tempRoot, HOSTED_RUN_PREFIX))
    await chmod(runRoot, 0o700)
    if (
      dirname(runRoot) !== tempRoot
      || !basename(runRoot).startsWith(HOSTED_RUN_PREFIX)
    ) throw new Error('hosted_canary_run_root_invalid')

    const outputDir = await mkdtemp(join(runRoot, HOSTED_OUTPUT_PREFIX))
    await chmod(outputDir, 0o700)
    if (
      dirname(outputDir) !== runRoot
      || !basename(outputDir).startsWith(HOSTED_OUTPUT_PREFIX)
    ) throw new Error('hosted_canary_output_root_invalid')

    const scriptPath = fileURLToPath(import.meta.url)
    const appRoot = resolve(dirname(scriptPath), '../..')
    const cli = resolve(appRoot, 'node_modules/@playwright/test/cli.js')
    const browserExecutable = await resolveLocalChromiumExecutable(appRoot)
    const runId = randomUUID()
    if (signalExitCode !== null) {
      outcome = {
        exitCode: signalExitCode,
        lines: ['[HOSTED-CANARY] HARNESS failed'],
      }
    } else {
      child = spawn(process.execPath, [
        cli,
        'test',
        '--config=playwright.hosted-realtime.config.ts',
      ], {
        cwd: appRoot,
        detached: process.platform !== 'win32',
        env: buildHostedCanaryChildEnv(
          process.env,
          runRoot,
          outputDir,
          browserExecutable,
          runId,
        ),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      lifecycle = createChildLifecycle(child)
      child.stdout.on('data', stdout.consume)
      child.stderr.on('data', stderr.consume)
      child.stdout.once('error', stdout.markFailed)
      child.stderr.once('error', stderr.markFailed)

      const completion = await Promise.race([
        lifecycle.closePromise.then(result => ({
          result,
          timedOut: false,
        })),
        delay(MAX_RUN_MS, undefined, { ref: false }).then(() => ({
          result: null,
          timedOut: true,
        })),
      ])
      if (completion.timedOut) await lifecycle.stop()
      const result = completion.result
        || (lifecycle.closed ? await lifecycle.closePromise : {
          code: null,
          signal: null,
        })
      runRootMayBeRemoved = lifecycle.closed
      stdout.finish()
      stderr.finish()

      const success = (
        signalExitCode === null
        && !completion.timedOut
        && !lifecycle.spawnFailed
        && result.code === 0
        && result.signal === null
        && !stdout.overflowed
        && !stderr.overflowed
        && hostedCanaryTranscriptIsComplete(safeLines)
      )

      if (success) {
        outcome = {
          exitCode: 0,
          lines: [...safeLines],
        }
      } else {
        const diagnosticLines = (
          signalExitCode === null
          && !stdout.overflowed
          && !stderr.overflowed
          && !lifecycle.spawnFailed
        )
          ? safeLines.filter(line => line !== '[HOSTED-CANARY] HARNESS failed')
          : []
        outcome = {
          exitCode: signalExitCode ?? 1,
          lines: [...diagnosticLines, '[HOSTED-CANARY] HARNESS failed'],
        }
      }
    }
  } finally {
    try {
      if (lifecycle && !lifecycle.closed) {
        await lifecycle.stop()
        runRootMayBeRemoved = lifecycle.closed
      }
      if (runRoot && (!child || runRootMayBeRemoved)) {
        await rm(runRoot, { recursive: true, force: true })
      }
      if (lockHandle) {
        if (!lifecycle || lifecycle.closed) {
          await releaseLock(lockHandle, lockPath)
        } else {
          await lockHandle.close()
        }
      }
    } finally {
      if (signalHandlersInstalled) {
        process.removeListener('SIGINT', onSigint)
        process.removeListener('SIGTERM', onSigterm)
      }
    }
  }

  if (signalExitCode !== null) {
    return {
      exitCode: signalExitCode,
      lines: ['[HOSTED-CANARY] HARNESS failed'],
    }
  }
  return outcome
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await main()
    for (const line of result.lines) emitFixed(line)
    process.exitCode = result.exitCode
  } catch {
    emitFixed('[HOSTED-CANARY] HARNESS failed')
    process.exitCode = 1
  }
}
