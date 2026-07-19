#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

async function walk(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const child = path.join(relative, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`build_artifact_invalid: symbolic link ${child}`)
    if (entry.isDirectory()) files.push(...await walk(root, child))
    else if (entry.isFile()) files.push(child.split(path.sep).join('/'))
  }
  return files
}

function forbiddenName(file) {
  return file.endsWith('.map')
    || /(?:^|\/)\.env(?:\.|$)/.test(file)
    || /\.(?:pem|key)$/i.test(file)
    || /(?:^|\/)(?:id_rsa|id_ed25519)(?:$|\.)/i.test(file)
    || /(?:heic-to|libheif)/i.test(file)
}

function containsPrivilegedMaterial(text) {
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) return true
  if (/sb_secret_[A-Za-z0-9_-]{20,}/.test(text)) return true
  for (const match of text.matchAll(/(?:^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{16,})\.([A-Za-z0-9_-]{16,})\.[A-Za-z0-9_-]{16,}(?:$|[^A-Za-z0-9_-])/g)) {
    try {
      const payload = JSON.parse(Buffer.from(match[2], 'base64url').toString('utf8'))
      if (payload?.role === 'service_role') return true
    } catch { /* not a JWT payload */ }
  }
  return false
}

function containsRemovedDecoderMaterial(text) {
  return /(?:heic-to|libheif)/i.test(text)
}

export async function verifyBuildArtifact(root, expectedEnvironment = 'none') {
  const files = await walk(root)
  const forbidden = files.find(forbiddenName)
  if (forbidden) throw new Error(`build_artifact_invalid: forbidden file ${forbidden}`)

  for (const file of files) {
    const bytes = await readFile(path.join(root, file))
    if (bytes.includes(0)) continue
    if (containsPrivilegedMaterial(bytes.toString('utf8'))) {
      throw new Error(`build_artifact_invalid: privileged material in ${file}`)
    }
    if (containsRemovedDecoderMaterial(bytes.toString('utf8'))) {
      throw new Error(`build_artifact_invalid: removed HEIC decoder material in ${file}`)
    }
  }

  const manifestPath = path.join(root, 'deployment-manifest.json')
  if (expectedEnvironment === 'none') {
    if (files.includes('deployment-manifest.json')) {
      throw new Error('build_artifact_invalid: unexpected deployment manifest')
    }
  } else {
    let manifest
    try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch {
      throw new Error('build_artifact_invalid: missing deployment manifest')
    }
    if (manifest?.schema !== 1 || manifest.environment !== expectedEnvironment) {
      throw new Error('build_artifact_invalid: manifest environment mismatch')
    }
    if (['ci', 'local'].includes(expectedEnvironment) && manifest.deployable !== false) {
      throw new Error('build_artifact_invalid: non-deployment artifact marked deployable')
    }
  }

  return Object.freeze({ files: files.length, environment: expectedEnvironment })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || '')
  const expectedEnvironment = String(process.argv[3] || 'none').trim().toLowerCase()
  try {
    const result = await verifyBuildArtifact(root, expectedEnvironment)
    console.log(`build artifact verified: ${result.environment} ${result.files} files`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'build_artifact_invalid')
    process.exitCode = 1
  }
}
