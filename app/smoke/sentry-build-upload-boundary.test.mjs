import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const appDirectory = new URL('../', import.meta.url)
const sentryEnvNames = [
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'SENTRY_UPLOAD_SOURCEMAPS',
  'UNI_PLATFORM',
  'VERCEL_GIT_COMMIT_SHA',
  'VITE_RELEASE',
]

async function probeResolvedSentryConfig(overrides = {}) {
  const env = { ...process.env }
  for (const name of sentryEnvNames) delete env[name]
  Object.assign(env, overrides)

  const probe = `
    import { loadConfigFromFile } from 'vite'
    import { fileURLToPath } from 'node:url'
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
    )
    const pluginNames = (loaded?.config?.plugins || [])
      .flat(Infinity)
      .filter(Boolean)
      .map(plugin => plugin.name)
    console.log('__SENTRY_CONFIG__' + JSON.stringify({
      enabled: pluginNames.includes('sentry-vite-plugin'),
      release: JSON.parse(loaded.config.define['import.meta.env.VITE_RELEASE']),
      sourcemap: loaded.config.build?.sourcemap || false,
    }))
  `
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', probe], {
    cwd: appDirectory,
    env,
    maxBuffer: 1024 * 1024,
  })
  const marker = stdout.split('\n').find(line => line.startsWith('__SENTRY_CONFIG__'))
  assert.ok(marker, `missing config probe output: ${stdout}`)
  return JSON.parse(marker.slice('__SENTRY_CONFIG__'.length))
}

const [viteConfig, envExample, envChecklist, runbook] = await Promise.all([
  readFile(new URL('../vite.config.ts', import.meta.url), 'utf8'),
  readFile(new URL('../.env.example', import.meta.url), 'utf8'),
  readFile(new URL('../../ENV_CHECKLIST.md', import.meta.url), 'utf8'),
  readFile(new URL('../../RUNBOOK.md', import.meta.url), 'utf8'),
])

test('source-map uploads require a deploy identity in addition to credentials', () => {
  assert.match(viteConfig, /const hasManualSentryUploadIdentity\s*=/)
  assert.match(viteConfig, /const hasSentryUploadIdentity\s*=/)
  assert.match(viteConfig, /!!process\.env\.VERCEL_GIT_COMMIT_SHA/)
  assert.match(viteConfig, /process\.env\.SENTRY_UPLOAD_SOURCEMAPS === "true"/)
  assert.match(viteConfig, /!!process\.env\.VITE_RELEASE\?\.trim\(\)/)
  assert.match(viteConfig, /\|\| hasManualSentryUploadIdentity/)
  assert.match(viteConfig, /const sentryEnabled\s*=\s*!isMpBuild\s*&& hasSentryUploadIdentity/)
})

test('manual source-map upload remains explicit and documented as one-command scope', () => {
  for (const source of [envExample, envChecklist, runbook]) {
    assert.match(source, /SENTRY_UPLOAD_SOURCEMAPS/)
    assert.match(source, /VITE_RELEASE/)
  }
  assert.match(envExample, /local `vercel build` deliberately does not upload/)
  assert.match(envChecklist, /local\s+`vercel build`\s+will not upload/)
})

test('resolved Vite config enables uploads only for a deployment or an explicitly named manual release', async () => {
  const credentials = {
    SENTRY_AUTH_TOKEN: 'test-token-not-a-secret',
    SENTRY_ORG: 'test-org',
    SENTRY_PROJECT: 'test-project',
  }
  const [credentialsOnly, unnamedManual, namedManual, vercelDeploy, miniProgram] = await Promise.all([
    probeResolvedSentryConfig(credentials),
    probeResolvedSentryConfig({ ...credentials, SENTRY_UPLOAD_SOURCEMAPS: 'true' }),
    probeResolvedSentryConfig({
      ...credentials,
      SENTRY_UPLOAD_SOURCEMAPS: 'true',
      VITE_RELEASE: 'manual-regression',
    }),
    probeResolvedSentryConfig({ ...credentials, VERCEL_GIT_COMMIT_SHA: '0123456789abcdef' }),
    probeResolvedSentryConfig({
      ...credentials,
      VERCEL_GIT_COMMIT_SHA: '0123456789abcdef',
      UNI_PLATFORM: 'mp-weixin',
    }),
  ])

  assert.deepEqual(credentialsOnly, { enabled: false, release: 'dev', sourcemap: false })
  assert.deepEqual(unnamedManual, { enabled: false, release: 'dev', sourcemap: false })
  assert.deepEqual(namedManual, { enabled: true, release: 'manual-regression', sourcemap: 'hidden' })
  assert.deepEqual(vercelDeploy, { enabled: true, release: '0123456', sourcemap: 'hidden' })
  assert.deepEqual(miniProgram, { enabled: false, release: '0123456', sourcemap: false })
})
