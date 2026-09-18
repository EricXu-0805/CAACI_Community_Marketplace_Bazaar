import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { REQUIRED_RELEASE_JOBS, releaseFailures } from './check-release-readiness.mjs'

const good = () => Object.fromEntries(REQUIRED_RELEASE_JOBS.map(name => [name, { result: 'success' }]))

test('a release requires successful public and protected-account verification as well as builds', () => {
  assert.deepEqual(releaseFailures(good()), [])
  for (const name of REQUIRED_RELEASE_JOBS) {
    for (const result of ['failure', 'skipped', 'cancelled', null, '']) {
      const data = good(); data[name] = { result }
      assert.deepEqual(releaseFailures(data), [name])
    }
    const missing = good(); delete missing[name]
    assert.deepEqual(releaseFailures(missing), [name])
  }
  for (const data of [null, [], 'success', {}]) assert.ok(releaseFailures(data).length)
  assert.ok(releaseFailures({ ...good(), unrelated: { result: 'success' } }).length)
})

test('CLI fails closed on malformed input and missing checks', () => {
  const script = new URL('./check-release-readiness.mjs', import.meta.url)
  for (const [results, status] of [['{', 1], ['', 1], ['{}', 1], [JSON.stringify(good()), 0]]) {
    const run = spawnSync(process.execPath, [script.pathname], { env: { ...process.env, RESULTS: results }, encoding: 'utf8' })
    assert.equal(run.status, status)
  }
})

test('workflow gate depends on real jobs and runs even when one fails', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const job = ci.slice(ci.indexOf('\n  production-release-readiness:'))
  const needs = job.match(/needs: \[([^\]]+)\]/)[1].split(',').map(s => s.trim())
  assert.deepEqual(needs, [...REQUIRED_RELEASE_JOBS])
  for (const name of needs) assert.ok(ci.includes(`\n  ${name}:`))
  assert.match(job, /always\(\) && github.ref == 'refs\/heads\/main'/)
  assert.match(job, /RESULTS: \$\{\{ toJSON\(needs\) \}\}/)
  assert.match(job, /run: node scripts\/check-release-readiness.mjs/)
})
