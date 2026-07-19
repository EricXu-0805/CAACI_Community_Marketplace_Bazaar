import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiRoot = path.join(projectRoot, 'api')
const outputFunctionsRoot = path.join(projectRoot, '.vercel', 'output', 'functions')
const outputConfigPath = path.join(projectRoot, '.vercel', 'output', 'config.json')
const require = createRequire(import.meta.url)

async function walkFiles(root, relative = '') {
  const current = path.join(root, relative)
  const entries = await readdir(current, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const child = path.join(relative, entry.name)
    if (entry.isDirectory()) files.push(...await walkFiles(root, child))
    else if (entry.isFile()) files.push(child.split(path.sep).join('/'))
  }
  return files
}

async function walkFunctionDirectories(root, relative = '') {
  let entries
  try {
    entries = await readdir(path.join(root, relative), { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const directories = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const child = path.join(relative, entry.name)
    if (entry.name.endsWith('.func')) directories.push(child.split(path.sep).join('/'))
    else directories.push(...await walkFunctionDirectories(root, child))
  }
  return directories
}

test('API tests use Vercel private filenames and cannot become zero-config Functions', async () => {
  const files = await walkFiles(apiRoot)
  const tests = files.filter(file => file.endsWith('.test.mjs'))
  const candidates = files.filter(file => /\.(?:js|mjs|ts|tsx)$/.test(file))
  const publicEntrypoints = candidates.filter(file => (
    !file.split('/').some(segment => segment.startsWith('_') || segment.startsWith('.'))
    && !file.endsWith('.d.ts')
  ))

  assert.ok(tests.length > 0, 'expected colocated API tests')
  assert.deepEqual(
    tests.filter(file => !path.posix.basename(file).startsWith('_')),
    [],
    'Vercel treats every public .mjs file under api/ as a Function',
  )
  assert.ok(publicEntrypoints.length > 0, 'expected runtime API entrypoints')
  assert.deepEqual(
    publicEntrypoints.filter(file => !file.endsWith('.js')),
    [],
    'only runtime .js entrypoints may remain public under api/',
  )
})

test('.vercelignore keeps tests and local private context out of uploaded deployments', async () => {
  const ignore = await readFile(path.join(projectRoot, '.vercelignore'), 'utf8')
  const requiredRules = [
    'api/**/*.test.mjs',
    'api/_test-module-loader.mjs',
    'app/smoke/**',
    'app/test-results/**',
    'app/playwright-report/**',
    'app/blob-report/**',
    'app/coverage/**',
    'coverage/**',
    'scripts/**/*.test.mjs',
    'tests/**',
    '.env',
    '.env*',
    'app/.env',
    'app/.env*',
    'project.private.config.json',
    'supabase/.temp/**',
    'output/**',
    'app/output/**',
    '_ai_notes/**',
    '.gstack/**',
    '.remember/**',
    'backups/**',
    '*_AUDIT.md',
    '*_REPORT.md',
    'AUDIT_*.md',
    'docs/**',
    'supabase/**',
    'scripts/**',
  ]
  for (const rule of requiredRules) {
    assert.match(ignore, new RegExp(`^${rule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'))
  }
})

test('unknown API paths use a stable JSON 404 before the SPA fallback', async () => {
  const vercelConfig = JSON.parse(await readFile(path.join(projectRoot, 'vercel.json'), 'utf8'))
  const apiFallbackIndex = vercelConfig.rewrites.findIndex(rule => (
    rule.source === '/api/:path*' && rule.destination === '/api/404.js'
  ))
  const spaFallbackIndex = vercelConfig.rewrites.findIndex(rule => (
    rule.source === '/(.*)' && rule.destination === '/index.html'
  ))

  assert.ok(apiFallbackIndex >= 0, 'missing the custom API 404 rewrite')
  assert.ok(spaFallbackIndex >= 0, 'missing the SPA history fallback')
  assert.ok(apiFallbackIndex < spaFallbackIndex, 'SPA fallback would swallow unknown API paths')

  const source = await readFile(path.join(apiRoot, '404.js'), 'utf8')
  const encoded = Buffer.from(source).toString('base64')
  const { default: handler } = await import(`data:text/javascript;base64,${encoded}#api-404`)
  for (const method of ['GET', 'POST']) {
    const response = await handler(new Request('https://app.test/api/does-not-exist', { method }))
    assert.equal(response.status, 404)
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
    assert.deepEqual(await response.json(), { error: 'not_found' })
  }
})

test('an existing local Vercel Build Output exactly matches runtime API sources', async (t) => {
  const functions = await walkFunctionDirectories(outputFunctionsRoot)
  if (functions.length === 0) {
    t.skip('no local .vercel/output function inventory')
    return
  }

  const sourceFiles = await walkFiles(apiRoot)
  const expectedFunctions = sourceFiles
    .filter(file => file.endsWith('.js'))
    .filter(file => !file.split('/').some(segment => segment.startsWith('_') || segment.startsWith('.')))
    .map(file => `api/${file.slice(0, -3)}.func`)
    .sort()

  assert.deepEqual(
    functions.filter(name => name.includes('.test.func')),
    [],
    'local prebuilt output would deploy test files as callable Functions',
  )
  assert.deepEqual(functions.sort(), expectedFunctions, 'runtime source and Function artifact inventory drifted')

  const outputConfig = JSON.parse(await readFile(outputConfigPath, 'utf8'))
  const apiFallbackIndex = outputConfig.routes.findIndex(route => (
    route.dest?.startsWith('/api/404.js') && route.check === true
  ))
  const spaFallbackIndex = outputConfig.routes.findIndex(route => (
    route.dest === '/index.html' && route.check === true
  ))
  assert.ok(apiFallbackIndex >= 0, 'built artifact is missing the custom API 404 route')
  assert.ok(spaFallbackIndex >= 0, 'built artifact is missing the SPA fallback route')
  assert.ok(apiFallbackIndex < spaFallbackIndex, 'built SPA fallback would swallow unknown API paths')

  const apiFallbackRoute = outputConfig.routes[apiFallbackIndex]
  const apiFallbackPattern = new RegExp(apiFallbackRoute.src)
  assert.equal(apiFallbackPattern.test('/api'), true, 'built fallback must cover the /api root')
  assert.equal(apiFallbackPattern.test('/api/does-not-exist'), true, 'built fallback must cover nested API paths')

  const builtModulePath = path.join(outputFunctionsRoot, 'api', '404.func', 'api', '404.js')
  const builtResponse = await require(builtModulePath).default()
  assert.equal(builtResponse.status, 404)
  assert.deepEqual(await builtResponse.json(), { error: 'not_found' })
})
