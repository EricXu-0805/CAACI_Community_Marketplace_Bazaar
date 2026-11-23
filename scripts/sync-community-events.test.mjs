import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const originalFetch = globalThis.fetch
let realFetchCalls = 0
globalThis.fetch = () => { realFetchCalls++; throw new Error('Real network is forbidden') }
const { runDryRun } = await import('./sync-community-events.mjs')
after(() => { globalThis.fetch = originalFetch; assert.equal(realFetchCalls, 0) })
const script = new URL('./sync-community-events.mjs', import.meta.url)
const fixture = readFileSync(new URL('../api/__fixtures__/community-events/caaci-v1-complete.json', import.meta.url), 'utf8')

test('dry-run accepts only its documented argument sequence before requesting anything', async t => {
  const errors = [], output = []
  t.mock.method(console, 'error', (...args) => errors.push(args))
  t.mock.method(console, 'log', (...args) => output.push(args))
  let requests = 0
  const fetch = async () => { requests++; return new Response(fixture) }
  for (const args of [[], ['--dry-run'], ['--dry-run', '--source', 'campus'],
    ['--source', 'caaci', '--dry-run'], ['--dry-run', '--source', 'caaci', '--write']]) {
    assert.equal(await runDryRun(args, fetch), 2)
  }
  assert.equal(requests, 0)
  assert.equal(errors.length, 5)
  assert.deepEqual(output, [])
})

test('valid dry-run makes one mocked GET and prints the normalized projection', async t => {
  const output = [], calls = []
  t.mock.method(console, 'log', value => output.push(value))
  const code = await runDryRun(['--dry-run', '--source', 'caaci'], async (url, init) => {
    calls.push({ url, init })
    return new Response(fixture)
  })
  assert.equal(code, 0)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://caaciorg.com/api/public-events?window=recent')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(output.length, 1)
  const parsed = JSON.parse(output[0])
  assert.equal(parsed.complete, true)
  assert.equal(parsed.rows[0].source_type, 'caaci')
  assert.equal(parsed.rows[0].title, '示例活动')
})

test('failed dry-run prints a fixed error code without the upstream body', async t => {
  const output = []
  t.mock.method(console, 'log', value => output.push(value))
  let calls = 0
  const code = await runDryRun(['--dry-run', '--source', 'caaci'], async () => {
    calls++
    return new Response('Synthetic upstream failure. Synthetic description.', { status: 500 })
  })
  assert.equal(code, 1)
  assert.equal(calls, 1)
  assert.deepEqual(JSON.parse(output[0]), { error: 'http_5xx' })
})

test('the real CLI exits2 for invalid arguments under a network-denying preload', async () => {
  const preload = 'data:text/javascript,' + encodeURIComponent('globalThis.fetch = () => { throw new Error("network forbidden") }')
  await assert.rejects(promisify(execFile)(process.execPath, ['--import', preload, fileURLToPath(script), '--write']), error => {
    assert.equal(error.code, 2)
    assert.match(error.stderr, /Usage:/)
    assert.equal(error.stdout, '')
    return true
  })
})

test('the dry-run executable contains no database environment-variable identifiers', () => {
  assert.doesNotMatch(readFileSync(script, 'utf8'), /SUPABASE_/)
})
