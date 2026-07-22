// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { afterEach, test } from 'node:test'
import {
  deploymentBoundaryModuleUrl,
  inlineDeploymentBoundaryImport,
} from './_test-module-loader.mjs'

const { deploymentBoundaryInternals, evaluateDeploymentBoundary } = await import(deploymentBoundaryModuleUrl)

const API_ROOT = new URL('./', import.meta.url)
const PROJECT_REF = 'abcdefghijklmnopqrst'
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
const APP_ORIGIN = 'https://reviewed-preview.vercel.app'
const TRACKED_ENV = [
  'CAACI_ENFORCE_DEPLOYMENT_BOUNDARY', 'CAACI_LOCAL_DEV', 'NODE_ENV',
  'NODE_TEST_CONTEXT',
  'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'DEPLOYMENT_EXPECTED_VERCEL_ENV',
  'DEPLOYMENT_APP_ORIGIN', 'SUPABASE_EXPECTED_PROJECT_REF',
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY',
]
const originalEnv = new Map(TRACKED_ENV.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
let nonce = 0

afterEach(() => {
  for (const key of TRACKED_ENV) {
    const previous = originalEnv.get(key)
    if (previous == null) delete process.env[key]
    else process.env[key] = previous
  }
  globalThis.fetch = originalFetch
})

function setEnv(values) {
  for (const key of TRACKED_ENV) delete process.env[key]
  Object.assign(process.env, {
    CAACI_ENFORCE_DEPLOYMENT_BOUNDARY: 'true',
    NODE_ENV: 'production',
    ...values,
  })
}

function reviewedPreview(overrides = {}) {
  return {
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    VERCEL_URL: 'reviewed-preview.vercel.app',
    DEPLOYMENT_EXPECTED_VERCEL_ENV: 'preview',
    SUPABASE_EXPECTED_PROJECT_REF: PROJECT_REF,
    SUPABASE_URL: PROJECT_URL,
    VITE_SUPABASE_URL: PROJECT_URL,
    ...overrides,
  }
}

async function loadApi(relativePath, env) {
  setEnv(env)
  const source = inlineDeploymentBoundaryImport(await readFile(new URL(relativePath, API_ROOT), 'utf8'))
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#deployment-${nonce++}`)
}

async function runtimeSources(root = API_ROOT, relative = '') {
  const entries = await readdir(new URL(relative || './', root), { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory() && !entry.name.startsWith('_')) files.push(...await runtimeSources(root, child))
    else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.startsWith('_') && entry.name !== '404.js') files.push(child)
  }
  return files.sort()
}

test('strict project parser accepts only one exact Supabase project origin', () => {
  assert.deepEqual(deploymentBoundaryInternals.supabaseProject(PROJECT_URL), {
    origin: PROJECT_URL,
    projectRef: PROJECT_REF,
  })
  for (const value of [
    'https://attacker.example',
    `https://${PROJECT_REF}.supabase.co.attacker.example`,
    `https://${PROJECT_REF}.supabase.co/path`,
    `https://${PROJECT_REF}.supabase.co?next=attacker`,
    `http://${PROJECT_REF}.supabase.co`,
  ]) assert.equal(deploymentBoundaryInternals.supabaseProject(value), null)
})

test('every Supabase-backed runtime entrypoint applies the shared gate at handler entry', async () => {
  const files = await runtimeSources()
  assert.equal(files.length, 19)
  for (const file of files) {
    const source = await readFile(new URL(file, API_ROOT), 'utf8')
    assert.match(source, /from ['"](?:\.\.\/|\.\/)_deployment-boundary\.js['"]/, `${file} lacks shared deployment boundary`)
    assert.match(
      source,
      /export default async function handler\([^)]*\) \{\n\s+(?:const boundary = evaluateDeploymentBoundary|const deploymentError = deploymentBoundaryResponse\(evaluateDeploymentBoundary)/,
      `${file} does not gate at handler entry`,
    )
  }
})

test('admin refuses an attacker Supabase origin before secret or bearer egress', async () => {
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input, init })
    throw new Error('must not fetch')
  }
  const { default: handler } = await loadApi('admin/index.js', reviewedPreview({
    SUPABASE_URL: 'https://attacker.example',
    SUPABASE_SECRET_KEY: 'sb_secret_fake_value_for_boundary_test',
  }))
  const response = await handler(new Request('https://reviewed-preview.vercel.app/api/admin?resource=whoami', {
    headers: { Authorization: `Bearer iam_admin_${'a'.repeat(43)}` },
  }))
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'deployment_configuration_invalid' })
  assert.deepEqual(calls, [])
})

test('missing real deployment identity fails closed even when all resource values exist', () => {
  const result = evaluateDeploymentBoundary({
    supabaseUrl: PROJECT_URL,
    env: {
      NODE_ENV: 'production',
      CAACI_ENFORCE_DEPLOYMENT_BOUNDARY: 'true',
      DEPLOYMENT_EXPECTED_VERCEL_ENV: 'production',
      DEPLOYMENT_APP_ORIGIN: 'https://illinimarket.com',
      SUPABASE_EXPECTED_PROJECT_REF: PROJECT_REF,
    },
  })
  assert.deepEqual(result, { ok: false, code: 'vercel_environment_missing' })
})

test('a test-runner marker cannot bypass a real Vercel deployment identity', () => {
  const result = evaluateDeploymentBoundary({
    supabaseUrl: 'https://attacker.example',
    env: {
      NODE_TEST_CONTEXT: 'child-v8',
      NODE_ENV: 'production',
      VERCEL: '1',
      VERCEL_ENV: 'production',
      DEPLOYMENT_EXPECTED_VERCEL_ENV: 'production',
      DEPLOYMENT_APP_ORIGIN: 'https://illinimarket.com',
      SUPABASE_EXPECTED_PROJECT_REF: PROJECT_REF,
    },
  })
  assert.deepEqual(result, { ok: false, code: 'supabase_project_mismatch' })
})

test('Preview derives only the current Vercel origin while Production still requires an explicit origin', () => {
  const preview = evaluateDeploymentBoundary({
    supabaseUrl: PROJECT_URL,
    env: reviewedPreview(),
  })
  assert.equal(preview.ok, true)
  assert.equal(preview.appOrigin, APP_ORIGIN)

  const malformedPreview = evaluateDeploymentBoundary({
    supabaseUrl: PROJECT_URL,
    env: reviewedPreview({ VERCEL_URL: 'https://attacker.example/path' }),
  })
  assert.deepEqual(malformedPreview, { ok: false, code: 'app_origin_missing' })

  const invalidExplicitPreview = evaluateDeploymentBoundary({
    supabaseUrl: PROJECT_URL,
    env: reviewedPreview({ DEPLOYMENT_APP_ORIGIN: 'not-an-origin' }),
  })
  assert.deepEqual(invalidExplicitPreview, { ok: false, code: 'app_origin_missing' })

  const production = {
    ...reviewedPreview(),
    VERCEL_ENV: 'production',
    VERCEL_URL: 'caaci-production-build.vercel.app',
    DEPLOYMENT_EXPECTED_VERCEL_ENV: 'production',
  }
  const missingProductionOrigin = evaluateDeploymentBoundary({
    supabaseUrl: PROJECT_URL,
    env: production,
  })
  assert.deepEqual(missingProductionOrigin, { ok: false, code: 'app_origin_missing' })

  const reviewedProduction = evaluateDeploymentBoundary({
    supabaseUrl: PROJECT_URL,
    env: { ...production, DEPLOYMENT_APP_ORIGIN: 'https://illinimarket.com' },
  })
  assert.equal(reviewedProduction.ok, true)
  assert.equal(reviewedProduction.appOrigin, 'https://illinimarket.com')
})

test('reviewed Preview share stays in Preview and is explicitly non-indexable', async () => {
  globalThis.fetch = async () => { throw new Error('invalid id must not fetch') }
  const { default: handler } = await loadApi('share.js', reviewedPreview({
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  }))
  const response = await handler(new Request(`${APP_ORIGIN}/share?id=invalid`))
  const html = await response.text()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive')
  assert.match(html, new RegExp(`<link rel="canonical" href="${APP_ORIGIN}"`))
  assert.doesNotMatch(html, /https:\/\/illinimarket\.com/)
})

test('Preview share origin mismatch returns 503 before rendering or upstream work', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls += 1; throw new Error('must not fetch') }
  const { default: handler } = await loadApi('share-post.js', reviewedPreview({
    DEPLOYMENT_APP_ORIGIN: 'https://illinimarket.com',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  }))
  const url = `${APP_ORIGIN}/share-post?id=invalid`
  const response = await handler(new Request(url))
  const headResponse = await handler(new Request(url, { method: 'HEAD' }))
  assert.equal(response.status, 503)
  assert.equal(headResponse.status, response.status)
  assert.equal(headResponse.headers.get('content-type'), response.headers.get('content-type'))
  assert.equal(headResponse.headers.get('cache-control'), response.headers.get('cache-control'))
  assert.equal(await headResponse.text(), '')
  assert.equal(calls, 0)
})
