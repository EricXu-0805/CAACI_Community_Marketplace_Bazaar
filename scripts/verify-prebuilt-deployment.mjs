#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyBuildArtifact } from './verify-build-artifact.mjs'

const PROJECT_REF_RE = /^[a-z0-9]{20}$/
const COMMIT_RE = /^[0-9a-f]{40,64}$/i

function exactOrigin(raw) {
  try {
    const url = new URL(String(raw || '').trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return ''
    if (url.pathname !== '/' && url.pathname !== '') return ''
    return url.origin
  } catch {
    return ''
  }
}

function fail(message) {
  throw new Error(`prebuilt_deployment_invalid: ${message}`)
}

export async function verifyPrebuiltDeployment({
  outputRoot,
  expectedEnvironment,
  expectedProjectRef,
  expectedAppOrigin,
  expectedCommit,
}) {
  if (!['production', 'preview'].includes(expectedEnvironment)) fail('expected environment')
  if (!PROJECT_REF_RE.test(expectedProjectRef || '')) fail('expected project ref')
  const appOrigin = exactOrigin(expectedAppOrigin)
  if (!appOrigin) fail('expected app origin')
  if (!COMMIT_RE.test(expectedCommit || '')) fail('expected commit')

  let builds
  let manifest
  try {
    builds = JSON.parse(await readFile(path.join(outputRoot, 'builds.json'), 'utf8'))
    manifest = JSON.parse(await readFile(path.join(outputRoot, 'static', 'deployment-manifest.json'), 'utf8'))
  } catch {
    fail('missing or malformed manifest')
  }

  if (builds?.target !== expectedEnvironment) fail('Vercel build target mismatch')
  if (manifest?.schema !== 1 || manifest.deployable !== true) fail('artifact is not deployable')
  if (manifest.environment !== expectedEnvironment) fail('artifact environment mismatch')
  if (manifest.projectRef !== expectedProjectRef) fail('artifact project mismatch')
  if (manifest.appOrigin !== appOrigin) fail('artifact app origin mismatch')
  if (manifest.commit !== expectedCommit) fail('artifact commit mismatch')
  if (manifest.release !== expectedCommit.slice(0, 7)) fail('artifact release mismatch')

  let artifact
  try {
    artifact = await verifyBuildArtifact(path.join(outputRoot, 'static'), expectedEnvironment)
  } catch (error) {
    fail(error instanceof Error ? error.message : 'static artifact invalid')
  }

  return Object.freeze({
    environment: manifest.environment,
    projectRef: manifest.projectRef,
    appOrigin: manifest.appOrigin,
    commit: manifest.commit,
    staticFiles: artifact.files,
  })
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  try {
    const result = await verifyPrebuiltDeployment({
      outputRoot: path.join(projectRoot, '.vercel', 'output'),
      expectedEnvironment: String(process.env.PREBUILT_EXPECTED_VERCEL_ENV || '').trim().toLowerCase(),
      expectedProjectRef: String(process.env.SUPABASE_EXPECTED_PROJECT_REF || '').trim().toLowerCase(),
      expectedAppOrigin: String(process.env.DEPLOYMENT_APP_ORIGIN || '').trim(),
      expectedCommit: String(process.env.PREBUILT_EXPECTED_GIT_SHA || '').trim().toLowerCase(),
    })
    console.log(`prebuilt deployment verified: ${result.environment} ${result.commit.slice(0, 7)} ${result.staticFiles} static files`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'prebuilt_deployment_invalid')
    process.exitCode = 1
  }
}
