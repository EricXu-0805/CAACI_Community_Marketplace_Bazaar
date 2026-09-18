import { pathToFileURL } from 'node:url'

export const REQUIRED_RELEASE_JOBS = Object.freeze([
  'typecheck', 'boundary-tests', 'build-h5', 'build-mp-weixin',
  'public-smoke', 'authenticated-smoke',
])

export function releaseFailures(results) {
  if (!results || typeof results !== 'object' || Array.isArray(results)) return ['invalid results']
  const failures = REQUIRED_RELEASE_JOBS.filter(name => results[name]?.result !== 'success')
  if (Object.keys(results).some(name => !REQUIRED_RELEASE_JOBS.includes(name))) {
    failures.push('unexpected check set')
  }
  return failures
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failures
  try { failures = releaseFailures(JSON.parse(process.env.RESULTS || 'null')) }
  catch { failures = ['invalid results'] }
  if (failures.length) {
    console.error(`Release blocked: ${failures.join(', ')}`)
    process.exitCode = 1
  } else {
    console.log('All six checks passed for this production commit.')
  }
}
