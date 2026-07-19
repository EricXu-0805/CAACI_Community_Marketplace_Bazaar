import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { verifyBuildArtifact } from './verify-build-artifact.mjs'

async function artifact({ manifest = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'caaci-artifact-'))
  await mkdir(path.join(root, 'assets'), { recursive: true })
  await writeFile(path.join(root, 'assets', 'app.js'), 'const publicKey="sb_publishable_example"')
  if (manifest) {
    await writeFile(path.join(root, 'deployment-manifest.json'), JSON.stringify({
      schema: 1,
      environment: 'ci',
      deployable: false,
    }))
  }
  return root
}

test('H5 CI and mini-program artifacts pass only their matching manifest contract', async () => {
  const h5 = await artifact()
  const mp = await artifact({ manifest: false })
  assert.deepEqual(await verifyBuildArtifact(h5, 'ci'), { files: 2, environment: 'ci' })
  assert.deepEqual(await verifyBuildArtifact(mp, 'none'), { files: 1, environment: 'none' })
  await assert.rejects(verifyBuildArtifact(h5, 'none'), /unexpected deployment manifest/)
  await assert.rejects(verifyBuildArtifact(mp, 'ci'), /missing deployment manifest/)
})

for (const [label, relative, content] of [
  ['source map', 'assets/app.js.map', '{}'],
  ['environment file', '.env.production', 'VALUE=secret'],
  ['private key', 'assets/recovery.pem', '-----BEGIN PRIVATE KEY-----'],
  ['opaque Supabase secret', 'assets/app.js', `const value="sb_secret_${'a'.repeat(32)}"`],
]) {
  test(`artifact verifier rejects ${label}`, async () => {
    const root = await artifact()
    await writeFile(path.join(root, relative), content)
    await assert.rejects(verifyBuildArtifact(root, 'ci'), /build_artifact_invalid/)
  })
}
