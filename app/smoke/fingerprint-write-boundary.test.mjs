import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const authSource = readFileSync(resolve(appRoot, 'src/composables/useAuth.ts'), 'utf8')
const fingerprintSource = readFileSync(resolve(appRoot, 'src/utils/fingerprint.ts'), 'utf8')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`)
  return source.slice(start, end)
}

const applySessionSource = sourceBetween(
  authSource,
  '  async function applySession(',
  '\n  async function initializeAuth()',
)
const recordFingerprintSource = sourceBetween(
  authSource,
  '  async function recordFingerprint()',
  '\n  async function fetchProfile(',
)

async function loadFingerprintModule() {
  const compiled = ts.transpileModule(fingerprintSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#write-boundary`)
}

function makeRecordFingerprint({
  response,
  thrown,
  hash = 'a'.repeat(64),
  ua = 'test-agent',
  classifier,
}) {
  const calls = {
    rpc: [],
    retry: [],
    breadcrumbs: [],
    captures: [],
    warnings: [],
  }
  const supabase = {
    rpc(name, args) {
      calls.rpc.push({ name, args })
      return {
        retry(enabled) {
          calls.retry.push(enabled)
          return thrown ? Promise.reject(thrown) : Promise.resolve(response)
        },
      }
    },
  }
  const fakeConsole = {
    warn: (...args) => calls.warnings.push(args),
  }
  const factory = new Function(
    'deviceFingerprintHash',
    'deviceUASnippet',
    'supabase',
    'isExpectedFingerprintDeferral',
    'addBreadcrumb',
    'captureException',
    'console',
    `${recordFingerprintSource}\nreturn recordFingerprint`,
  )
  const recordFingerprint = factory(
    async () => hash,
    () => ua,
    supabase,
    classifier,
    breadcrumb => calls.breadcrumbs.push(breadcrumb),
    (error, context) => calls.captures.push({ error, context }),
    fakeConsole,
  )
  return { recordFingerprint, calls }
}

function assertSingleRpc(calls) {
  assert.deepEqual(calls.retry, [false])
  assert.equal(calls.rpc.length, 1)
  assert.equal(calls.rpc[0].name, 'record_fingerprint')
  assert.deepEqual(calls.rpc[0].args, {
    fp_hash_in: 'a'.repeat(64),
    ua_snippet_in: 'test-agent',
  })
}

test('fingerprint write remains fire-and-forget after authenticated state settles', () => {
  const settleIndex = applySessionSource.indexOf("settleAuthState('authenticated')")
  const fingerprintIndex = applySessionSource.indexOf('recordFingerprint().catch(() => {})')
  assert.ok(settleIndex >= 0, 'authenticated state must settle explicitly')
  assert.ok(fingerprintIndex > settleIndex, 'fingerprint write must start only after auth settles')
  assert.doesNotMatch(applySessionSource, /await\s+recordFingerprint\s*\(/)
  assert.match(recordFingerprintSource, /\.retry\(false\)/)
})

test('successful fingerprint write is one-shot and silent', async () => {
  const { isExpectedFingerprintDeferral } = await loadFingerprintModule()
  const { recordFingerprint, calls } = makeRecordFingerprint({
    response: { status: 204, error: null },
    classifier: isExpectedFingerprintDeferral,
  })

  await recordFingerprint()

  assertSingleRpc(calls)
  assert.equal(calls.breadcrumbs.length, 0)
  assert.equal(calls.captures.length, 0)
  assert.equal(calls.warnings.length, 0)
})

test('exact PT429 fingerprint deferrals are one-shot and downgraded from errors', async () => {
  const { isExpectedFingerprintDeferral } = await loadFingerprintModule()
  for (const message of [
    'fingerprint_busy',
    'fingerprint_write_deferred',
    'fingerprint_rate_limited',
  ]) {
    const { recordFingerprint, calls } = makeRecordFingerprint({
      response: {
        status: 429,
        error: { code: 'PT429', message, details: null, hint: null },
      },
      classifier: isExpectedFingerprintDeferral,
    })

    await recordFingerprint()

    assertSingleRpc(calls)
    assert.equal(calls.breadcrumbs.length, 1)
    assert.equal(calls.captures.length, 0)
    assert.equal(calls.warnings.length, 0)
  }
})

test('unexpected resolved RPC failures remain observable without retry', async () => {
  const { isExpectedFingerprintDeferral } = await loadFingerprintModule()
  for (const response of [
    { status: 429, error: { code: 'PT429', message: 'unknown_reason' } },
    { status: 500, error: { code: 'XX000', message: 'server_failure' } },
    { status: 0, error: { code: '', message: 'TypeError: network failure' } },
  ]) {
    const { recordFingerprint, calls } = makeRecordFingerprint({
      response,
      classifier: isExpectedFingerprintDeferral,
    })

    await recordFingerprint()

    assertSingleRpc(calls)
    assert.equal(calls.breadcrumbs.length, 0)
    assert.equal(calls.captures.length, 1)
    assert.equal(calls.captures[0].error, response.error)
    assert.deepEqual(calls.captures[0].context, {
      tags: { source: 'auth-record-fingerprint' },
    })
    assert.equal(calls.warnings.length, 1)
  }
})

test('thrown fingerprint transport failures remain observable without retry', async () => {
  const { isExpectedFingerprintDeferral } = await loadFingerprintModule()
  const failure = new TypeError('network failure')
  const { recordFingerprint, calls } = makeRecordFingerprint({
    thrown: failure,
    classifier: isExpectedFingerprintDeferral,
  })

  await recordFingerprint()

  assertSingleRpc(calls)
  assert.equal(calls.breadcrumbs.length, 0)
  assert.equal(calls.captures.length, 1)
  assert.equal(calls.captures[0].error, failure)
  assert.deepEqual(calls.captures[0].context, {
    tags: { source: 'auth-record-fingerprint' },
  })
  assert.equal(calls.warnings.length, 1)
})

test('missing or malformed fingerprint hashes issue no RPC', async () => {
  const { isExpectedFingerprintDeferral } = await loadFingerprintModule()
  for (const hash of [null, '', 'a'.repeat(63), 'g'.repeat(64)]) {
    const { recordFingerprint, calls } = makeRecordFingerprint({
      response: { status: 204, error: null },
      hash,
      classifier: isExpectedFingerprintDeferral,
    })

    await recordFingerprint()

    assert.equal(calls.rpc.length, 0)
    assert.equal(calls.retry.length, 0)
    assert.equal(calls.breadcrumbs.length, 0)
    assert.equal(calls.captures.length, 0)
    assert.equal(calls.warnings.length, 0)
  }
})
