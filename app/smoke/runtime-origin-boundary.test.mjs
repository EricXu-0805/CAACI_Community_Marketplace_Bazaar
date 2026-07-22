import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const ROOT = new URL('../', import.meta.url)

async function loadRuntime(baseUrl) {
  const source = await readFile(new URL('src/config/runtime.ts', ROOT), 'utf8')
  const instrumented = source
    .replaceAll('import.meta.env.VITE_BASE_URL', 'globalThis.__TEST_VITE_BASE_URL__')
    .replaceAll('import.meta.env.VITE_RELEASE', 'globalThis.__TEST_VITE_RELEASE__')
    .replaceAll('import.meta.env.VITE_SUPPORT_EMAIL', 'globalThis.__TEST_VITE_SUPPORT_EMAIL__')
  const compiled = ts.transpileModule(instrumented, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText

  globalThis.__TEST_VITE_BASE_URL__ = baseUrl
  globalThis.__TEST_VITE_RELEASE__ = undefined
  globalThis.__TEST_VITE_SUPPORT_EMAIL__ = undefined
  try {
    return await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${Math.random()}`)
  } finally {
    delete globalThis.__TEST_VITE_BASE_URL__
    delete globalThis.__TEST_VITE_RELEASE__
    delete globalThis.__TEST_VITE_SUPPORT_EMAIL__
  }
}

test('missing app origin fails closed instead of selecting production', async () => {
  for (const value of [undefined, '', '   ', 'not-a-url']) {
    const runtime = await loadRuntime(value)
    assert.equal(runtime.BASE_URL, '')
  }
})

test('app origin accepts exact HTTPS and loopback HTTP origins only', async () => {
  const runtime = await loadRuntime('https://preview.example.test/')
  assert.equal(runtime.BASE_URL, 'https://preview.example.test')

  for (const value of [
    'https://preview.example.test/api',
    'https://preview.example.test/?target=prod',
    'https://preview.example.test/#fragment',
    'https://user:pass@preview.example.test',
    'http://preview.example.test',
    'ftp://preview.example.test',
    'https://preview.example.test:70000',
  ]) {
    assert.equal(runtime.normalizeBaseUrl(value), '', value)
  }

  assert.equal(runtime.normalizeBaseUrl('http://localhost:5173/'), 'http://localhost:5173')
  assert.equal(runtime.normalizeBaseUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000')
  assert.equal(runtime.normalizeBaseUrl('http://[::1]:5173'), 'http://[::1]:5173')
  assert.equal(runtime.normalizeBaseUrl('HTTPS://PREVIEW.EXAMPLE.TEST:443/'), 'https://preview.example.test')
})

test('environment contract documents explicit non-H5 configuration', async () => {
  const [example, checklist, runtime, viteConfig] = await Promise.all([
    readFile(new URL('.env.example', ROOT), 'utf8'),
    readFile(new URL('../ENV_CHECKLIST.md', ROOT), 'utf8'),
    readFile(new URL('src/config/runtime.ts', ROOT), 'utf8'),
    readFile(new URL('vite.config.ts', ROOT), 'utf8'),
  ])

  assert.match(example, /^VITE_BASE_URL=https:\/\/your-app\.example\.com$/m)
  assert.match(checklist, /Missing\/malformed values stop the mp build before an artifact is emitted and never fall back to production/)
  assert.match(example, /stop mp builds before an artifact is emitted/)
  assert.doesNotMatch(runtime, /\|\|\s*['"]https:\/\/illinimarket\.com/)
  assert.doesNotMatch(runtime, /new URL\(/, 'mp boot must not depend on a URL shim being installed first')
  assert.match(viteConfig, /function requireMpAppOrigin\(\): Plugin/)
  assert.match(viteConfig, /if \(!isMpBuild\) return;/)
  assert.match(viteConfig, /normalizeBuildAppOrigin\(loaded\.VITE_BASE_URL\)/)
  assert.match(viteConfig, /\[app-origin-guard\] VITE_BASE_URL must be an exact HTTPS origin/)
  assert.match(viteConfig, /requireMpAppOrigin\(\)/)
})
