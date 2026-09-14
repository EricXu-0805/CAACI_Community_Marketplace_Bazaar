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
  ['removed HEIC decoder filename', 'assets/heic-to.js', 'const decoder=true'],
  ['removed HEIC decoder material', 'assets/app.js', 'const decoder="libheif"'],
  ['CSP-blocked remote UI asset', 'assets/uni.css', 'body:after{background:url(https://cdn.dcloud.net.cn/img/shadow-grey.png)}'],
]) {
  test(`artifact verifier rejects ${label}`, async () => {
    const root = await artifact()
    await writeFile(path.join(root, relative), content)
    await assert.rejects(verifyBuildArtifact(root, 'ci'), /build_artifact_invalid/)
  })
}

async function miniArtifact() {
  const root = await artifact({ manifest: false })
  await mkdir(path.join(root, 'pages/home'), { recursive: true })
  await writeFile(path.join(root, 'app.json'), JSON.stringify({ pages: ['pages/home/index'] }))
  await writeFile(path.join(root, 'project.config.json'), JSON.stringify({ appid: 'wx1234567890abcdef', setting: { urlCheck: true } }))
  for (const suffix of ['js', 'wxml', 'json']) await writeFile(path.join(root, `pages/home/index.${suffix}`), '')
  return root
}

test('mini-program validation rejects WXSS universal selectors even in desktop media queries', async () => {
  const root = await miniArtifact()
  await writeFile(path.join(root, 'app.wxss'), '@media(min-width:1100px){.page>*.scope{grid-column:2}}')
  await assert.rejects(verifyBuildArtifact(root), /WXSS does not support universal selectors/)
})

test('mini-program validation rejects packages beyond the upload limit', async () => {
  const root = await miniArtifact()
  await writeFile(path.join(root, 'large.bin'), Buffer.alloc(2 * 1024 * 1024))
  await assert.rejects(verifyBuildArtifact(root), /exceeds 2 MiB/)
})

test('mini-program validation refuses a domain-check bypass', async () => {
  const root = await miniArtifact()
  await writeFile(path.join(root, 'project.config.json'), JSON.stringify({ appid: 'wx1234567890abcdef', setting: { urlCheck: false } }))
  await assert.rejects(verifyBuildArtifact(root), /domain validation enabled/)
})

test('mini-program validation catches renamed or absent page entries', async () => {
  const root = await miniArtifact()
  await writeFile(path.join(root, 'app.json'), JSON.stringify({ pages: ['pages/missing/index'] }))
  await assert.rejects(verifyBuildArtifact(root), /missing mini-program page entry/)
})
