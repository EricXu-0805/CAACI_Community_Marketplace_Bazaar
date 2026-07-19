import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const ROOT = new URL('../', import.meta.url)

test('local, CI, app, and Vercel runtime declarations stay on supported Node 22', async () => {
  const [rootPackage, appPackage, nvmrc, workflow] = await Promise.all([
    readFile(new URL('package.json', ROOT), 'utf8').then(JSON.parse),
    readFile(new URL('app/package.json', ROOT), 'utf8').then(JSON.parse),
    readFile(new URL('.nvmrc', ROOT), 'utf8'),
    readFile(new URL('.github/workflows/ci.yml', ROOT), 'utf8'),
  ])

  assert.equal(rootPackage.engines?.node, '22.x')
  assert.equal(appPackage.engines?.node, '22.x')
  assert.equal(nvmrc.trim(), '22')
  assert.match(workflow, /NODE_VERSION:\s*'22'/)
  assert.doesNotMatch(workflow, /NODE_VERSION:\s*'20'/)
})
