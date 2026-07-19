import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const appDirectory = new URL('../', import.meta.url)
const PROJECT_REF = 'abcdefghijklmnopqrst'
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const TRACKED = [
  'CI', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_GIT_COMMIT_SHA',
  'DEPLOYMENT_EXPECTED_VERCEL_ENV', 'DEPLOYMENT_APP_ORIGIN',
  'SUPABASE_EXPECTED_PROJECT_REF', 'VITE_SUPABASE_URL',
]

async function probe(overrides = {}) {
  const env = { ...process.env }
  for (const name of TRACKED) delete env[name]
  Object.assign(env, overrides)
  const script = `
    import { loadConfigFromFile } from 'vite'
    import { fileURLToPath } from 'node:url'
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
    )
    const plugin = loaded.config.plugins.flat(Infinity).find(value => value?.name === 'deployment-configuration-boundary')
    try {
      const result = await plugin.config({}, { command: 'build', mode: 'production' })
      let asset
      await plugin.generateBundle.call({ emitFile(value) { asset = value } })
      console.log('__DEPLOYMENT_BOUNDARY__' + JSON.stringify({
        ok: true,
        environment: JSON.parse(result.define['import.meta.env.VITE_DEPLOY_ENV']),
        manifest: JSON.parse(asset.source),
      }))
    } catch (error) {
      console.log('__DEPLOYMENT_BOUNDARY__' + JSON.stringify({ ok: false, error: error.message }))
    }
  `
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: appDirectory,
    env,
    maxBuffer: 1024 * 1024,
  })
  const marker = stdout.split('\n').find(line => line.startsWith('__DEPLOYMENT_BOUNDARY__'))
  assert.ok(marker, `missing boundary probe output: ${stdout}`)
  return JSON.parse(marker.slice('__DEPLOYMENT_BOUNDARY__'.length))
}

const reviewedPreview = {
  VERCEL: '1',
  VERCEL_ENV: 'preview',
  VERCEL_URL: 'reviewed-preview.vercel.app',
  VERCEL_GIT_COMMIT_SHA: COMMIT,
  DEPLOYMENT_EXPECTED_VERCEL_ENV: 'preview',
  DEPLOYMENT_APP_ORIGIN: 'https://reviewed-preview.vercel.app',
  SUPABASE_EXPECTED_PROJECT_REF: PROJECT_REF,
  VITE_SUPABASE_URL: PROJECT_URL,
}

test('local and CI builds are explicitly marked non-deployable', async () => {
  const [local, ci] = await Promise.all([probe(), probe({ CI: 'true' })])
  assert.equal(local.ok, true)
  assert.equal(local.environment, 'local')
  assert.equal(local.manifest.deployable, false)
  assert.equal(ci.ok, true)
  assert.equal(ci.environment, 'ci')
  assert.equal(ci.manifest.deployable, false)
})

test('reviewed Preview configuration emits an attested deployable manifest', async () => {
  const result = await probe(reviewedPreview)
  assert.equal(result.ok, true)
  assert.equal(result.environment, 'preview')
  assert.deepEqual(result.manifest, {
    schema: 1,
    environment: 'preview',
    deployable: true,
    projectRef: PROJECT_REF,
    appOrigin: 'https://reviewed-preview.vercel.app',
    release: COMMIT.slice(0, 7),
    commit: COMMIT,
  })
})

for (const [label, env] of [
  ['missing expected tier', { ...reviewedPreview, DEPLOYMENT_EXPECTED_VERCEL_ENV: '' }],
  ['attacker Supabase origin', { ...reviewedPreview, VITE_SUPABASE_URL: 'https://attacker.example' }],
  ['wrong Supabase project', { ...reviewedPreview, VITE_SUPABASE_URL: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co' }],
  ['production app origin in Preview', { ...reviewedPreview, DEPLOYMENT_APP_ORIGIN: 'https://illinimarket.com' }],
  ['missing Vercel identity', { ...reviewedPreview, VERCEL: '', VERCEL_ENV: '' }],
]) {
  test(`deployment build fails closed for ${label}`, async () => {
    const result = await probe(env)
    assert.equal(result.ok, false)
    assert.match(result.error, /^\[deployment-boundary\]/)
  })
}

test('Sentry reads the deployment tag rather than Vite production mode', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../src/utils/sentry.ts', import.meta.url), 'utf8')
  assert.match(source, /import\.meta\.env\.VITE_DEPLOY_ENV/)
  assert.doesNotMatch(source, /import\.meta\.env\.MODE/)
})
