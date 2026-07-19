import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { verifyPrebuiltDeployment } from './verify-prebuilt-deployment.mjs'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const PROJECT_REF = 'abcdefghijklmnopqrst'
const APP_ORIGIN = 'https://reviewed-preview.vercel.app'

async function fixture(overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'caaci-prebuilt-'))
  await mkdir(path.join(root, 'static', 'assets'), { recursive: true })
  await writeFile(path.join(root, 'builds.json'), JSON.stringify({
    target: overrides.target || 'preview',
  }))
  await writeFile(path.join(root, 'static', 'deployment-manifest.json'), JSON.stringify({
    schema: 1,
    environment: 'preview',
    deployable: true,
    projectRef: PROJECT_REF,
    appOrigin: APP_ORIGIN,
    release: COMMIT.slice(0, 7),
    commit: COMMIT,
    ...overrides.manifest,
  }))
  await writeFile(path.join(root, 'static', 'assets', 'app.js'), 'export{}')
  return root
}

function verify(outputRoot, overrides = {}) {
  return verifyPrebuiltDeployment({
    outputRoot,
    expectedEnvironment: 'preview',
    expectedProjectRef: PROJECT_REF,
    expectedAppOrigin: APP_ORIGIN,
    expectedCommit: COMMIT,
    ...overrides,
  })
}

test('prebuilt verifier accepts one fully attested candidate', async () => {
  const result = await verify(await fixture())
  assert.deepEqual(result, {
    environment: 'preview',
    projectRef: PROJECT_REF,
    appOrigin: APP_ORIGIN,
    commit: COMMIT,
    staticFiles: 2,
  })
})

for (const [label, overrides] of [
  ['CI/local artifact', { manifest: { deployable: false } }],
  ['Vercel target drift', { target: 'production' }],
  ['environment drift', { manifest: { environment: 'production' } }],
  ['Supabase project drift', { manifest: { projectRef: 'zzzzzzzzzzzzzzzzzzzz' } }],
  ['app origin drift', { manifest: { appOrigin: 'https://attacker.example' } }],
  ['commit drift', { manifest: { commit: 'f'.repeat(40) } }],
  ['release drift', { manifest: { release: 'stale00' } }],
]) {
  test(`prebuilt verifier rejects ${label}`, async () => {
    await assert.rejects(verify(await fixture(overrides)), /prebuilt_deployment_invalid/)
  })
}

test('prebuilt verifier rejects public source maps even when identity matches', async () => {
  const root = await fixture()
  await writeFile(path.join(root, 'static', 'assets', 'app.js.map'), '{}')
  await assert.rejects(verify(root), /prebuilt_deployment_invalid: build_artifact_invalid/)
})

test('prebuilt verifier rejects embedded privileged material even when identity matches', async () => {
  const root = await fixture()
  await writeFile(
    path.join(root, 'static', 'assets', 'app.js'),
    `const leaked="sb_secret_${'a'.repeat(32)}"`,
  )
  await assert.rejects(verify(root), /prebuilt_deployment_invalid: build_artifact_invalid/)
})

test('prebuilt verifier rejects symbolic links in the public artifact', async () => {
  const root = await fixture()
  await symlink(
    path.join(root, 'static', 'assets', 'app.js'),
    path.join(root, 'static', 'assets', 'alias.js'),
  )
  await assert.rejects(verify(root), /prebuilt_deployment_invalid: build_artifact_invalid/)
})
