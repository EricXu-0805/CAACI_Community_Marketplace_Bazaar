import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { createBrowserIdentityReader, BrowserIdentityError } from './ci-first-release-browser-identity.mjs'

const ORIGIN = 'https://candidate-123.vercel.app'
const NONCE = '632d0cc4-54b7-42ba-a013-6c08f09a4048'
const OTHER_NONCE = '11111111-2222-4333-8444-555555555555'
const requestedUrl = nonce => `${ORIGIN}/api/deployment-identity?nonce=${nonce}`
const identity = nonce => ({ schema: 1, environment: 'production', deploymentId: 'dpl_candidate123',
  commit: 'a'.repeat(40), projectRef: 'lfhvgprfphyfvhidegum', appOrigin: 'https://illinimarket.com', nonce })
const receipt = (input, overrides = {}) => ({ requestedUrl: input.requestedUrl, observedUrl: input.requestedUrl,
  observedAt: input.requestedAt + 1, evidenceRef: `screen:${input.nonce}`, captureMode: 'existing-session-screen-confirmation',
  identity: identity(input.nonce), ...overrides })
function setup({ capture = input => receipt(input), times = [1000, 1010], ...options } = {}) {
  let callCount = 0, clockIndex = 0
  const read = createBrowserIdentityReader({ allowedOrigins: [ORIGIN], now: () => times[clockIndex++],
    ...options, capture: async input => { callCount++; return capture(input) } })
  return { read, count: () => callCount }
}
const fails = (promise, code) => assert.rejects(promise, error => error instanceof BrowserIdentityError
  && error.code === `release_browser_${code}` && error.message === error.code && !('cause' in error))

test('validates a fresh fully bound screen observation without claiming HTTP status or DOM automation', async () => {
  let supplied
  const { read, count } = setup({ capture: input => {
    supplied = input
    return receipt(input, { rawPage: 'secret-do-not-return', identity: { ...identity(input.nonce), extra: 'secret' } })
  } })
  const result = await read({ origin: ORIGIN, nonce: NONCE })
  assert.deepEqual(supplied, { origin: ORIGIN, nonce: NONCE, requestedAt: 1000, requestedUrl: requestedUrl(NONCE) })
  assert.equal(count(), 1)
  assert.deepEqual(result, { ...identity(NONCE), browserEvidence: { requestedUrl: requestedUrl(NONCE),
    observedUrl: requestedUrl(NONCE), requestedAt: 1000, observedAt: 1001, completedAt: 1010,
    evidenceRef: `screen:${NONCE}`, captureMode: 'existing-session-screen-confirmation' } })
  assert.equal(Object.isFrozen(supplied), true)
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.browserEvidence), true)
  assert.equal(JSON.stringify(result).includes('secret'), false)
  assert.equal('status' in result.browserEvidence, false)
})

test('construction does not capture; missing capability fails explicitly at read time', async () => {
  let calls = 0
  createBrowserIdentityReader({ allowedOrigins: [ORIGIN], capture: () => { calls++ } })
  assert.equal(calls, 0)
  const read = createBrowserIdentityReader({ allowedOrigins: [ORIGIN] })
  await fails(read({ origin: ORIGIN, nonce: NONCE }), 'capture_unavailable')
})

test('requires a nonempty fixed canonical HTTPS allowlist and bounded time options', () => {
  for (const options of [null, [], {}, { allowedOrigins: [] }, { allowedOrigins: [ORIGIN, ORIGIN] },
    { allowedOrigins: [`${ORIGIN}/`] }, { allowedOrigins: ['http://candidate-123.vercel.app'] },
    { allowedOrigins: ['https://candidate-123.vercel.app:443'] },
    { allowedOrigins: ['https://user@candidate-123.vercel.app'] },
    { allowedOrigins: [ORIGIN], capture: false }, { allowedOrigins: [ORIGIN], now: false },
    { allowedOrigins: [ORIGIN], maxAgeMs: 0 }, { allowedOrigins: [ORIGIN], timeoutMs: Infinity },
    { allowedOrigins: [ORIGIN], maxAgeMs: 300001 }]) {
    assert.throws(() => createBrowserIdentityReader(options), { code: 'release_browser_invalid_options' })
  }
})

test('rejects alternate origins, URL normalization, and malformed nonces before capture', async () => {
  const { read, count } = setup()
  for (const origin of ['http://candidate-123.vercel.app', `${ORIGIN}/`, `${ORIGIN}:443`,
    'https://user:password@candidate-123.vercel.app', 'https://CANDIDATE-123.vercel.app',
    'https://other.vercel.app', `${ORIGIN}/api/deployment-identity`, `${ORIGIN}?x=1`, `${ORIGIN}#fragment`, `${ORIGIN}\n`]) {
    await fails(read({ origin, nonce: NONCE }), 'invalid_target')
  }
  for (const nonce of ['', `${NONCE}\n`, `${NONCE}\r`, `${NONCE}\r\n`, NONCE.toUpperCase(),
    NONCE.replace('-42ba-', '-52ba-'), `${NONCE}&other=1`, null]) {
    await fails(read({ origin: ORIGIN, nonce }), 'invalid_target')
  }
  await fails(read(null), 'invalid_target')
  assert.equal(count(), 0)
})

test('later caller mutations cannot expand the copied origin allowlist', async () => {
  const allowedOrigins = [ORIGIN]
  const { read, count } = setup({ allowedOrigins })
  allowedOrigins.push('https://other.vercel.app')
  await fails(read({ origin: 'https://other.vercel.app', nonce: NONCE }), 'invalid_target')
  assert.equal(count(), 0)
  assert.equal((await read({ origin: ORIGIN, nonce: NONCE })).deploymentId, 'dpl_candidate123')
})

test('requires both complete requested URL and observed URL to match the challenge', async () => {
  for (const field of ['requestedUrl', 'observedUrl']) {
    for (const value of [undefined, ORIGIN, requestedUrl(OTHER_NONCE), `${requestedUrl(NONCE)}&extra=1`,
      `${requestedUrl(NONCE)}#fragment`, requestedUrl(NONCE).replace('/api/', '/other/'),
      requestedUrl(NONCE).replace(ORIGIN, 'https://www.illinimarket.com'),
      requestedUrl(NONCE).replace('nonce=6', 'nonce=%36')]) {
      const { read } = setup({ capture: input => receipt(input, { [field]: value }) })
      await fails(read({ origin: ORIGIN, nonce: NONCE }), 'url_mismatch')
    }
  }
})

test('rejects missing evidence, unrecognized capture mode, and invalid receipt timestamps', async () => {
  for (const change of [{ captureMode: undefined }, { captureMode: 'automatic-dom' }, { evidenceRef: '' },
    { evidenceRef: 'screen:secret\n' }, { evidenceRef: 'x'.repeat(257) }, { observedAt: NaN },
    { observedAt: 1001.5 }, { observedAt: '1001' }, { observedAt: -1 }]) {
    const { read } = setup({ capture: input => receipt(input, change) })
    await fails(read({ origin: ORIGIN, nonce: NONCE }), 'invalid_receipt')
  }
  for (const value of [undefined, null, false, 'JSON', []]) {
    const { read } = setup({ capture: () => value })
    await fails(read({ origin: ORIGIN, nonce: NONCE }), 'invalid_receipt')
  }
})

test('enforces request-relative freshness, future rejection, and the inclusive age boundary', async () => {
  for (const [observedAt, times, expected] of [
    [999, [1000, 1010], 'observation_predates_request'],
    [1011, [1000, 1010], 'future_observation'],
    [1001, [1000, 1062], 'stale_observation'],
  ]) {
    const { read } = setup({ times, maxAgeMs: 60, capture: input => receipt(input, { observedAt }) })
    await fails(read({ origin: ORIGIN, nonce: NONCE }), expected)
  }
  const { read } = setup({ times: [1000, 1061], maxAgeMs: 60 })
  assert.equal((await read({ origin: ORIGIN, nonce: NONCE })).browserEvidence.observedAt, 1001)
})

test('rejects an invalid or backwards clock without leaking thrown clock errors', async () => {
  for (const times of [[NaN], [1.5], [1000, 999], [1000, Infinity]]) {
    const { read } = setup({ times })
    await fails(read({ origin: ORIGIN, nonce: NONCE }), 'invalid_clock')
  }
  const { read } = setup({ now: () => { throw new Error('sensitive clock failure') } })
  await fails(read({ origin: ORIGIN, nonce: NONCE }), 'capture_failed')
})

test('rejects malformed identity and wrong nonce while retaining runner responsibility for exact release equality', async () => {
  for (const change of [{ schema: 2 }, { environment: 'preview' }, { deploymentId: 'dpl_a\n' },
    { deploymentId: 'dpl_' }, { commit: 'a'.repeat(39) }, { commit: `${'a'.repeat(40)}\r` },
    { projectRef: 'short' }, { appOrigin: 'https://unrelated.example' }, { nonce: OTHER_NONCE }]) {
    const { read } = setup({ capture: input => receipt(input, { identity: { ...identity(input.nonce), ...change } }) })
    await fails(read({ origin: ORIGIN, nonce: NONCE }), 'identity_invalid')
  }
  const { read } = setup({ capture: input => receipt(input, { identity: { ...identity(input.nonce),
    deploymentId: 'dpl_differentValidDeployment', commit: 'b'.repeat(40) } }) })
  assert.equal((await read({ origin: ORIGIN, nonce: NONCE })).deploymentId, 'dpl_differentValidDeployment')
})

test('consumes the nonce before await and rejects concurrent replay without another capture', async () => {
  let finish, supplied
  const { read, count } = setup({ capture: input => { supplied = input; return new Promise(resolve => { finish = resolve }) } })
  const first = read({ origin: ORIGIN, nonce: NONCE })
  await Promise.resolve()
  await fails(read({ origin: ORIGIN, nonce: NONCE }), 'nonce_reused')
  assert.equal(count(), 1)
  finish(receipt(supplied))
  await first
  await fails(read({ origin: ORIGIN, nonce: NONCE }), 'nonce_reused')
})

test('rejects reusing a prior evidence reference for a new nonce', async () => {
  const { read, count } = setup({ times: [1000, 1010, 1020, 1030],
    capture: input => receipt(input, { evidenceRef: 'screen:one-observation' }) })
  await read({ origin: ORIGIN, nonce: NONCE })
  await fails(read({ origin: ORIGIN, nonce: OTHER_NONCE }), 'evidence_reused')
  assert.equal(count(), 2)
})

test('raw capture errors and accessor exceptions are sanitized and consume the nonce', async () => {
  for (const capture of [() => { throw new Error('raw credential or browser page contents') },
    () => Promise.reject('raw secret'), () => ({ get captureMode() { throw new Error('secret getter') } })]) {
    const { read, count } = setup({ capture })
    await fails(read({ origin: ORIGIN, nonce: NONCE }), 'capture_failed')
    await fails(read({ origin: ORIGIN, nonce: NONCE }), 'nonce_reused')
    assert.equal(count(), 1)
  }
})

test('bounds a stalled capture, ignores its late result, and never reuses the timed-out nonce', async () => {
  let finish, supplied
  const { read, count } = setup({ timeoutMs: 20, capture: input => {
    supplied = input
    return new Promise(resolve => { finish = resolve })
  } })
  await fails(read({ origin: ORIGIN, nonce: NONCE }), 'capture_timeout')
  finish(receipt(supplied))
  await fails(read({ origin: ORIGIN, nonce: NONCE }), 'nonce_reused')
  assert.equal(count(), 1)
})

test('a blocking host callback cannot return success after the monotonic capture deadline', async () => {
  const { read, count } = setup({ timeoutMs: 100, capture: input => {
    const end = performance.now() + 110
    while (performance.now() < end) { /* Isolated synchronous host stall. */ }
    return receipt(input)
  } })
  await fails(read({ origin: ORIGIN, nonce: NONCE }), 'capture_timeout')
  assert.equal(count(), 1)
})

test('an expired queued observation does not start the host callback', async () => {
  const { read, count } = setup({ timeoutMs: 10 })
  const pending = read({ origin: ORIGIN, nonce: NONCE })
  const end = performance.now() + 20
  while (performance.now() < end) { /* Delay the capture microtask past deadline. */ }
  await fails(pending, 'capture_timeout')
  assert.equal(count(), 0)
})
