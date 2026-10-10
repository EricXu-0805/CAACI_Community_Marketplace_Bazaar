import assert from 'node:assert/strict'
import { createServer, request as nativeRequest } from 'node:https'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import { createHttpsPromotionTransport } from './ci-first-release-https-transport.mjs'
import { RELEASE_PROJECT, RELEASE_REPOSITORY, REQUIRED_RELEASE_CHECKS } from './check-ci-first-release.mjs'
import { createReleaseStore, runCiFirstRelease } from './run-ci-first-release.mjs'

const TEAM = 'team_Test123', DEPLOYMENT = 'dpl_Test123'
const TOKEN = 'unit-test-secret-only'
const PATH = `/v10/projects/${RELEASE_PROJECT}/promote/${DEPLOYMENT}?teamId=${TEAM}`
const tick = () => new Promise(resolve => setImmediate(resolve))

// Public, test-only key and certificate. Generated offline for api.vercel.com;
// trusted solely by the injected localhost request wrapper, never installed.
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgufwJUzzC0aD87Oxu
JitqcICmxpOfdOOq52HI9O6QpeyhRANCAASjAKMC7YhoMUMIgT3lWxqKzrdXweGs
4FFEETdbooM3b9iud5OjW+sp2RrIAigVPNFrocwMJgbyfvMXHCkj+BHs
-----END PRIVATE KEY-----`
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBpDCCAUqgAwIBAgIUYHvA4B4UsoriMvkNKMHJ9YsTkBUwCgYIKoZIzj0EAwIw
GTEXMBUGA1UEAwwOYXBpLnZlcmNlbC5jb20wIBcNMjYxMDEwMDUzMTA0WhgPMjEy
NjA5MTYwNTMxMDRaMBkxFzAVBgNVBAMMDmFwaS52ZXJjZWwuY29tMFkwEwYHKoZI
zj0CAQYIKoZIzj0DAQcDQgAEowCjAu2IaDFDCIE95Vsais63V8HhrOBRRBE3W6KD
N2/YrneTo1vrKdkayAIoFTzRa6HMDCYG8n7zFxwpI/gR7KNuMGwwHQYDVR0OBBYE
FA85ehWPxSemQzZCpzyWqJgIWUdxMB8GA1UdIwQYMBaAFA85ehWPxSemQzZCpzyW
qJgIWUdxMA8GA1UdEwEB/wQFMAMBAf8wGQYDVR0RBBIwEIIOYXBpLnZlcmNlbC5j
b20wCgYIKoZIzj0EAwIDSAAwRQIgXhDGzRhy98Z6LgAyLPpxQIWOaHOPZnUARw7r
FWLpQrICIQDx4+3Vfiafu0apiSbf4GgPbOUD0Ploicl+Un3f7XEAUw==
-----END CERTIFICATE-----`

function sanitized(error) {
  assert.ok(error instanceof Error)
  assert.match(error.code, /^release_https_[a-z0-9_]+$/)
  assert.equal(error.message, error.code)
  assert.equal(error.cause, undefined)
  assert.ok(!JSON.stringify(error).includes(TOKEN))
  return true
}

function fixedProductionOptions(options) {
  assert.equal(options.protocol, 'https:')
  assert.equal(options.hostname, 'api.vercel.com')
  assert.equal(options.port, 443)
  assert.equal(options.servername, 'api.vercel.com')
  assert.equal(options.path, PATH)
  assert.equal(options.method, 'POST')
  assert.equal(options.agent, false)
  assert.equal(options.rejectUnauthorized, true)
  assert.equal(options.maxHeaderSize, 16_384)
  assert.equal(options.auth, undefined)
  assert.equal(options.socketPath, undefined)
  const headers = Object.fromEntries(Object.entries(options.headers)
    .map(([key, value]) => [key.toLowerCase(), String(value)]))
  assert.deepEqual(headers, { authorization: `Bearer ${TOKEN}`, accept: 'application/json',
    'content-length': '0', connection: 'close' })
}

async function localServer(t, handler) {
  const received = [], sockets = new Set(), handlerErrors = []
  const server = createServer({ key: TEST_KEY, cert: TEST_CERT }, (req, res) => {
    const record = { method: req.method, url: req.url, headers: req.headers, bodyBytes: 0, ended: false }
    received.push(record)
    req.on('data', chunk => { record.bodyBytes += chunk.length })
    req.on('end', () => {
      record.ended = true
      try { handler(req, res, record) } catch (error) {
        handlerErrors.push(error)
        req.socket.destroy()
      }
    })
    req.on('error', () => {})
    res.on('error', () => {})
  })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  server.on('tlsClientError', () => {})
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  t.after(async () => {
    const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    for (const socket of sockets) socket.destroy()
    await closed
    assert.deepEqual(handlerErrors, [])
  })
  return { port, received, sockets }
}

async function harness(t, handler, options = {}) {
  const local = await localServer(t, handler)
  const counts = { token: 0, factory: 0, end: 0, outgoingBodyBytes: 0 }
  const clientRequests = [], optionErrors = []
  const adapter = createHttpsPromotionTransport({ teamId: TEAM, execute: true, timeoutMs: 1_000,
    ...options,
    getToken: () => {
      counts.token++
      return options.getToken ? options.getToken() : TOKEN
    },
    requestImpl: (productionOptions, callback) => {
      counts.factory++
      try { fixedProductionOptions(productionOptions) } catch (error) {
        optionErrors.push(error)
        throw error
      }
      // This is the only endpoint remapping. The production transport still
      // constructs the fixed Vercel destination and uses strict TLS options.
      const request = nativeRequest({ ...productionOptions, hostname: '127.0.0.1',
        port: local.port, ca: TEST_CERT }, callback)
      clientRequests.push(request)
      const end = request.end
      request.end = function (...args) {
        counts.end++
        if (typeof args[0] === 'string' || Buffer.isBuffer(args[0])) {
          counts.outgoingBodyBytes += Buffer.byteLength(args[0])
        }
        return end.apply(this, args)
      }
      return request
    },
  })
  t.after(() => {
    for (const request of clientRequests) request.destroy()
    assert.deepEqual(optionErrors, [])
  })
  function assertOnce() {
    assert.deepEqual(counts, { token: 1, factory: 1, end: 1, outgoingBodyBytes: 0 })
    assert.equal(local.received.length, 1)
    assert.equal(local.received[0].method, 'POST')
    assert.equal(local.received[0].url, PATH)
    assert.equal(local.received[0].headers.authorization, `Bearer ${TOKEN}`)
    assert.equal(local.received[0].headers['content-length'], '0')
    assert.equal(local.received[0].bodyBytes, 0)
    assert.equal(local.received[0].ended, true)
  }
  return { ...local, adapter, counts, clientRequests, assertOnce }
}

function noNetwork(options = {}) {
  const counts = { token: 0, factory: 0 }
  const adapter = createHttpsPromotionTransport({ teamId: TEAM, execute: true,
    ...options,
    getToken: () => {
      counts.token++
      return options.getToken ? options.getToken() : TOKEN
    },
    requestImpl: () => {
      counts.factory++
      throw new Error(`Unexpected test request ${TOKEN}`)
    },
  })
  return { adapter, counts }
}

test('construction and capability inspection do not obtain credentials or create requests', async () => {
  const h = noNetwork()
  assert.deepEqual(h.counts, { token: 0, factory: 0 })
  assert.deepEqual(await h.adapter.verifyPromotionSupport(), { method: 'POST',
    pathTemplate: '/v10/projects/{projectId}/promote/{deploymentId}', force: false,
    singleAttempt: true, transport: 'native-https', credentialsVerified: false,
    permissionsVerified: false })
  assert.deepEqual(h.counts, { token: 0, factory: 0 })
})

test('execute gate, invalid deployment and pre-abort fail before token access', async () => {
  let defaultTokenCalls = 0, defaultRequestCalls = 0
  const defaultAdapter = createHttpsPromotionTransport({ teamId: TEAM,
    getToken: () => { defaultTokenCalls++; return TOKEN },
    requestImpl: () => { defaultRequestCalls++; throw new Error(TOKEN) },
  })
  await assert.rejects(defaultAdapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
  assert.equal(defaultTokenCalls, 0)
  assert.equal(defaultRequestCalls, 0)
  const disabled = noNetwork({ execute: false })
  await assert.rejects(disabled.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
  assert.deepEqual(disabled.counts, { token: 0, factory: 0 })
  for (const deploymentId of [undefined, '', 'dpl_', '../dpl_Test123', `${DEPLOYMENT}?force=true`, 'dpl_hello\r\n']) {
    const h = noNetwork()
    await assert.rejects(h.adapter.promote({ deploymentId }), sanitized)
    assert.deepEqual(h.counts, { token: 0, factory: 0 })
  }
  const controller = new AbortController()
  controller.abort(new Error(TOKEN))
  const aborted = noNetwork({ signal: controller.signal })
  await assert.rejects(aborted.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
  assert.deepEqual(aborted.counts, { token: 0, factory: 0 })
})

test('line terminators appended to otherwise valid team and deployment IDs fail before credential access', async () => {
  let tokenCalls = 0, requestCalls = 0
  for (const suffix of ['\n', '\r', '\r\n']) {
    assert.throws(() => createHttpsPromotionTransport({ teamId: TEAM + suffix, execute: true,
      getToken: () => { tokenCalls++; return TOKEN },
      requestImpl: () => { requestCalls++; throw new Error('must-not-send') },
    }), sanitized)
    const h = noNetwork()
    await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT + suffix }), sanitized)
    assert.deepEqual(h.counts, { token: 0, factory: 0 })
  }
  assert.equal(tokenCalls, 0)
  assert.equal(requestCalls, 0)
})

test('unsafe debug and TLS tracing environments block before token access', async () => {
  for (const [name, value] of [['NODE_DEBUG', 'http'], ['NODE_DEBUG', 'HTTPS'],
    ['NODE_DEBUG', 'net,tls'], ['NODE_DEBUG', '*'], ['NODE_OPTIONS', '--trace-tls']]) {
    const previous = process.env[name]
    const h = noNetwork()
    try {
      process.env[name] = value
      await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
      assert.deepEqual(h.counts, { token: 0, factory: 0 }, `${name}=${value}`)
    } finally {
      if (previous === undefined) delete process.env[name]
      else process.env[name] = previous
    }
  }
})

test('startup HTTP debugging remains blocked after NODE_DEBUG is cleared without reading inherited environment values', () => {
  const program = `
    delete process.env.NODE_DEBUG;
    const { createHttpsPromotionTransport } = await import('./ci-first-release-https-transport.mjs');
    let tokens = 0, requests = 0;
    const adapter = createHttpsPromotionTransport({ teamId: '${TEAM}', execute: true,
      getToken() { tokens++; return 'dummy-startup-test'; },
      requestImpl() { requests++; throw new Error('must-not-send'); } });
    try { await adapter.promote({ deploymentId: '${DEPLOYMENT}' }); process.exitCode = 2; }
    catch (error) { console.log(JSON.stringify({ code: error.code, tokens, requests })); }
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    cwd: dirname(fileURLToPath(import.meta.url)), env: { NODE_DEBUG: 'http' }, encoding: 'utf8', timeout: 5000,
  })
  assert.equal(child.status, 0)
  assert.deepEqual(JSON.parse(child.stdout), { code: 'release_https_unsafe_debug_configuration', tokens: 0, requests: 0 })
  assert.doesNotMatch(child.stdout + child.stderr, /dummy-startup-test/)
})

test('201 and 202 require complete bodies and return only acceptance', async t => {
  for (const status of [201, 202]) {
    await t.test(String(status), async t => {
      const h = await harness(t, (_req, res) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(status === 201 ? '{"accepted":true}' : '')
      })
      assert.deepEqual(await h.adapter.promote({ deploymentId: DEPLOYMENT }), { accepted: true })
      h.assertOnce()
      await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
      h.assertOnce()
    })
  }
})

test('a complete response body of exactly 4096 bytes is accepted', async t => {
  const h = await harness(t, (_req, res) => {
    res.writeHead(201)
    res.end('x'.repeat(4_096))
  })
  assert.deepEqual(await h.adapter.promote({ deploymentId: DEPLOYMENT }), { accepted: true })
  h.assertOnce()
})

test('non-acceptance statuses including 429 and 500 never retry', async t => {
  for (const status of [200, 204, 400, 429, 500]) {
    await t.test(String(status), async t => {
      const h = await harness(t, (_req, res) => {
        res.writeHead(status, { 'retry-after': '0' })
        res.end(TOKEN)
      })
      await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
      await tick()
      h.assertOnce()
      await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
      h.assertOnce()
    })
  }
})

test('307 and 308 do not follow Location or send credentials to a second server', async t => {
  for (const status of [307, 308]) {
    await t.test(String(status), async t => {
      const sink = await localServer(t, (_req, res) => res.end('must not receive this request'))
      const h = await harness(t, (_req, res) => {
        res.writeHead(status, { location: `https://127.0.0.1:${sink.port}/credential-sink` })
        res.end()
      })
      await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
      await tick()
      h.assertOnce()
      assert.equal(sink.received.length, 0)
      assert.equal(sink.sockets.size, 0)
    })
  }
})

test('a socket reset after the server receives the POST never retries', async t => {
  const h = await harness(t, req => req.socket.destroy())
  await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
  await tick()
  h.assertOnce()
  assert.equal(h.clientRequests[0].destroyed, true)
  await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
  h.assertOnce()
})

test('a 201 with an incomplete body is not accepted', async t => {
  const h = await harness(t, (_req, res) => {
    res.writeHead(201, { 'content-length': '20' })
    res.write('partial')
    setImmediate(() => res.socket?.destroy())
  })
  await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
  h.assertOnce()
})

test('201 headers followed by a stalled response body hit the total deadline', async t => {
  const h = await harness(t, (_req, res) => {
    res.writeHead(201, { 'content-length': '20' })
    res.flushHeaders()
    res.write('partial')
  }, { timeoutMs: 250 })
  await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
  h.assertOnce()
  assert.equal(h.clientRequests[0].destroyed, true)
})

test('a response body exceeding 4096 bytes is rejected and the request is destroyed', async t => {
  for (const declaredLength of [false, true]) {
    await t.test(declaredLength ? 'content length' : 'chunked', async t => {
      const h = await harness(t, (_req, res) => {
        res.writeHead(201, declaredLength ? { 'content-length': '4097' } : {})
        res.end('x'.repeat(4_097))
      })
      await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
      h.assertOnce()
      assert.equal(h.clientRequests[0].destroyed, true)
    })
  }
})

test('a server that receives the POST without sending headers times out once', async t => {
  const h = await harness(t, () => {}, { timeoutMs: 250 })
  await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
  h.assertOnce()
  assert.equal(h.clientRequests[0].destroyed, true)
  await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
  h.assertOnce()
})

test('aborting after server receipt destroys the request without retrying', async t => {
  const controller = new AbortController()
  const h = await harness(t, () => controller.abort(new Error(TOKEN)), { signal: controller.signal })
  await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
  h.assertOnce()
  assert.equal(h.clientRequests[0].destroyed, true)
})

test('token accessor timeout consumes the latch and late resolution cannot create a request', async () => {
  let resolveToken
  const token = new Promise(resolve => { resolveToken = resolve })
  const h = noNetwork({ timeoutMs: 15, getToken: () => token })
  await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
  assert.deepEqual(h.counts, { token: 1, factory: 0 })
  resolveToken(TOKEN)
  await tick()
  await tick()
  assert.deepEqual(h.counts, { token: 1, factory: 0 })
  await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
  assert.deepEqual(h.counts, { token: 1, factory: 0 })
})

test('a blocking accessor that outruns the deadline cannot send before the timer callback runs', async () => {
  const h = noNetwork({ timeoutMs: 10, getToken: () => {
    const until = performance.now() + 35
    while (performance.now() < until) { /* Deliberately delay timers in this one regression. */ }
    return TOKEN
  } })
  await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), error => {
    sanitized(error)
    assert.equal(error.code, 'release_https_deadline_exceeded')
    return true
  })
  assert.deepEqual(h.counts, { token: 1, factory: 0 })
})

test('a late accessor rejection after the deadline is consumed without an unhandled rejection or request', async () => {
  let rejectToken
  const h = noNetwork({ timeoutMs: 15, getToken: () => new Promise((_, reject) => { rejectToken = reject }) })
  await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
  rejectToken(new Error(TOKEN))
  await tick()
  await tick()
  assert.deepEqual(h.counts, { token: 1, factory: 0 })
})

test('abort while token accessor is pending cannot create a request after late resolution', async () => {
  let resolveToken, markEntered
  const entered = new Promise(resolve => { markEntered = resolve })
  const controller = new AbortController()
  const h = noNetwork({ signal: controller.signal, getToken: () => {
    markEntered()
    return new Promise(resolve => { resolveToken = resolve })
  } })
  const result = h.adapter.promote({ deploymentId: DEPLOYMENT })
  const rejected = assert.rejects(result, sanitized)
  await entered
  controller.abort(new Error(TOKEN))
  await rejected
  resolveToken(TOKEN)
  await tick()
  assert.deepEqual(h.counts, { token: 1, factory: 0 })
})

test('concurrent promote calls share one latch even before the token resolves', async t => {
  let resolveToken, markEntered
  const entered = new Promise(resolve => { markEntered = resolve })
  const h = await harness(t, (_req, res) => { res.writeHead(201); res.end() }, {
    getToken: () => {
      markEntered()
      return new Promise(resolve => { resolveToken = resolve })
    },
  })
  const first = h.adapter.promote({ deploymentId: DEPLOYMENT })
  await entered
  await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
  assert.equal(h.counts.token, 1)
  assert.equal(h.counts.factory, 0)
  resolveToken(TOKEN)
  assert.deepEqual(await first, { accepted: true })
  h.assertOnce()
})

test('token accessor failures, invalid tokens and request construction failures are sanitized and latched', async () => {
  for (const getToken of [() => { throw new Error(TOKEN) }, () => Promise.reject(new Error(TOKEN)),
    () => '', () => null, () => `${TOKEN}\r\nInjected: bad`]) {
    const h = noNetwork({ getToken })
    await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
    assert.deepEqual(h.counts, { token: 1, factory: 0 })
    await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
    assert.deepEqual(h.counts, { token: 1, factory: 0 })
  }
  const h = noNetwork()
  await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
  assert.deepEqual(h.counts, { token: 1, factory: 1 })
  await assert.rejects(h.adapter.promote({ deploymentId: DEPLOYMENT }), sanitized)
  assert.deepEqual(h.counts, { token: 1, factory: 1 })
})

test('real runner writes intent before dummy credentials and one local POST; a lost response permits only read-only recovery', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'illini-native-promote-integration-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const store = createReleaseStore(directory)
  const events = []
  const write = store.write
  store.write = (name, value) => { write(name, value); events.push(`persisted:${name}`) }
  const SHA = 'a'.repeat(40), REPO = 12345, RUN = 731, ATTEMPT = 2, START = 1_800_000_000_000
  let time = START, promoted = false
  const local = await harness(t, req => {
    assert.equal(store.has('promote-intent.json'), true)
    events.push('server:POST')
    promoted = true
    req.socket.destroy() // The request arrived, but its response is lost.
  }, { getToken: () => {
    assert.equal(store.has('promote-intent.json'), true)
    events.push('token')
    return TOKEN
  } })
  const adapter = {
    ...local.adapter,
    async readSnapshot({ candidateId }) {
      return { requestedSha: SHA, mainSha: SHA, projectId: RELEASE_PROJECT, teamId: TEAM, repositoryId: REPO,
        vercelConfig: { git: { deploymentEnabled: false } },
        productionCandidates: { projectId: RELEASE_PROJECT, complete: true, items: candidateId ? [{ id: DEPLOYMENT }] : [] },
        run: { id: RUN, run_attempt: ATTEMPT, repository: { full_name: RELEASE_REPOSITORY },
          path: '.github/workflows/ci.yml', name: 'CI', head_branch: 'main', head_sha: SHA,
          event: 'push', status: 'completed', conclusion: 'success' },
        jobs: { run_id: RUN, run_attempt: ATTEMPT, complete: true, items: REQUIRED_RELEASE_CHECKS.map(name => ({ name,
          status: 'completed', conclusion: 'success', run_id: RUN, run_attempt: ATTEMPT, head_sha: SHA })) } }
    },
    async readDeployment() {
      return { id: DEPLOYMENT, projectId: RELEASE_PROJECT, teamId: TEAM, target: 'production', readyState: 'READY',
        createdAt: START + 1000, url: 'https://candidate-example.vercel.app',
        gitSource: { type: 'github', repoId: REPO, ref: 'main', sha: SHA } }
    },
    async readAliases() {
      return { projectId: RELEASE_PROJECT, teamId: TEAM, complete: true,
        items: ['illinimarket.com', 'www.illinimarket.com'].map(alias => ({ alias,
          projectId: RELEASE_PROJECT, deploymentId: promoted ? DEPLOYMENT : 'dpl_Previous' })) }
    },
    async readIdentity({ nonce }) {
      return { schema: 1, environment: 'production', deploymentId: DEPLOYMENT, commit: SHA,
        projectRef: 'lfhvgprfphyfvhidegum', appOrigin: 'https://illinimarket.com', nonce }
    },
    async readRootRedirect() { return { status: 308, location: 'https://www.illinimarket.com/' } },
  }
  const nativeScope = { transport: 'native-https', tokenEnv: 'ILLINI_TEST_DUMMY_TOKEN' }
  const run = options => runCiFirstRelease({ store, adapter, now: () => time, wait: async ms => { time += ms },
    pollMs: 1, maxReadyMs: 50, maxObserveMs: 5, ...options })
  const preparation = await run({ mode: 'prepare', ...nativeScope, requestedSha: SHA,
    teamId: TEAM, repositoryId: REPO, runId: RUN, runAttempt: ATTEMPT })
  assert.equal(preparation.status, 'prepared')
  assert.equal(preparation.credentialsVerified, false)
  assert.equal(preparation.permissionsVerified, false)
  assert.equal(local.counts.token, 0)
  const outcome = await run({ mode: 'watch', ...nativeScope, deploymentId: DEPLOYMENT, execute: true })
  assert.equal(outcome.status, 'verified')
  assert.equal(outcome.receiptOrJournalUnknown, true)
  assert.equal(outcome.readOnlyReconciliation, true)
  assert.ok(events.indexOf('persisted:promote-intent.json') < events.indexOf('token'))
  assert.ok(events.indexOf('token') < events.indexOf('server:POST'))
  local.assertOnce()
  const restartedStore = createReleaseStore(directory)
  let restartedTokenCalls = 0, restartedRequestCalls = 0
  const restartedWriter = createHttpsPromotionTransport({ teamId: TEAM, execute: true,
    getToken: () => { restartedTokenCalls++; throw new Error('restart must remain read-only') },
    requestImpl: () => { restartedRequestCalls++; throw new Error('restart must not send') },
  })
  const restartedAdapter = { ...adapter, ...restartedWriter }
  const runRestarted = options => runCiFirstRelease({ store: restartedStore, adapter: restartedAdapter,
    now: () => time, wait: async ms => { time += ms }, pollMs: 1, maxReadyMs: 50, maxObserveMs: 5, ...options })
  const second = await runRestarted({ mode: 'watch', ...nativeScope, deploymentId: DEPLOYMENT, execute: true })
  assert.equal(second.readOnly, true)
  assert.equal(second.status, 'verified')
  const reconciled = await runRestarted({ mode: 'reconcile', deploymentId: DEPLOYMENT })
  assert.equal(reconciled.readOnly, true)
  assert.equal(reconciled.status, 'verified')
  assert.equal(restartedTokenCalls, 0)
  assert.equal(restartedRequestCalls, 0)
  local.assertOnce()
})
