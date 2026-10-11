import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import { createConnectorPromotionTransport, ConnectorPromotionError } from './ci-first-release-connector-transport.mjs'
import { RELEASE_PROJECT } from './check-ci-first-release.mjs'

const TEAM = 'team_TestConnectorScope'
const DEPLOYMENT = 'dpl_TestCandidate123'
const INPUT = { deploymentId: DEPLOYMENT }
const SECRET = 'never-expose-provider-credential-or-body'
const returned = () => ({ isError: false, content: [] })
const create = (requestPromote, options = {}) => createConnectorPromotionTransport({
  teamId: TEAM, execute: true, requestPromote, timeoutMs: 1_000, ...options,
})
const code = name => `release_connector_${name}`
function expectedError(name, invoked = false) {
  return err => {
    assert.ok(err instanceof ConnectorPromotionError)
    assert.equal(err.code, code(name))
    assert.equal(err.message, code(name))
    assert.equal(err.cause, undefined)
    assert.ok(!String(err.stack).includes(SECRET))
    assert.ok(!JSON.stringify(err).includes(SECRET))
    if (invoked) { assert.equal(err.invoked, true); assert.equal(err.outcome, 'unknown') }
    return true
  }
}

test('construction and capability inspection do not invoke the host and describe only the actual guarantee', async () => {
  let calls = 0
  const transport = create(() => { calls++; throw new Error(SECRET) })
  assert.equal(calls, 0)
  assert.deepEqual(await transport.verifyPromotionSupport(), {
    method: 'POST', pathTemplate: '/v10/projects/{projectId}/promote/{deploymentId}', force: false,
    singleAttempt: false, singleToolInvocation: true, transport: 'connector', internalHttpAttempts: 'unknown',
    credentialsVerified: false, permissionsVerified: false,
  })
  await transport.verifyPromotionSupport()
  assert.equal(calls, 0)
  assert.ok(Object.isFrozen(transport))
})

test('execute defaults to false and a disabled transport never invokes the host', async () => {
  let calls = 0
  const requestPromote = () => { calls++; return returned() }
  const transports = [createConnectorPromotionTransport({ teamId: TEAM, requestPromote }),
    create(requestPromote, { execute: false })]
  for (const transport of transports) await assert.rejects(transport.promote(INPUT), expectedError('execute_required'))
  assert.equal(calls, 0)
})

test('constructor rejects invalid and unexpected options without invoking data accessors', () => {
  let calls = 0
  const requestPromote = () => { calls++; return returned() }
  const invalid = [null, [], true, 'options', {}, { teamId: TEAM },
    { teamId: TEAM, requestPromote: {} },
    ...['', 'team_bad/slash', 'team_bad\n', 'team_bad?force=true', 'other_team'].map(teamId => ({ teamId, requestPromote })),
    ...[null, -1, 0, 1.5, 60_001, NaN, Infinity, '1000'].map(timeoutMs => ({ teamId: TEAM, requestPromote, timeoutMs })),
    ...[null, 0, 1, 'true'].map(execute => ({ teamId: TEAM, requestPromote, execute })),
    { teamId: TEAM, requestPromote, endpoint: 'https://example.invalid' },
    { teamId: TEAM, requestPromote, getToken: () => { throw new Error(SECRET) } },
    { get teamId() { calls++; throw new Error(SECRET) }, requestPromote },
    new Proxy({}, { ownKeys() { throw new Error(SECRET) } }),
  ]
  for (const options of invalid) assert.throws(() => createConnectorPromotionTransport(options), expectedError('invalid_options'))
  assert.equal(calls, 0)
})

test('a single host invocation receives only the fixed project, configured team, and validated deployment', async () => {
  const args = []
  const transport = create(input => { args.push(input); return returned() })
  assert.deepEqual(await transport.promote(INPUT), { invoked: true, receipt: 'tool_returned' })
  assert.deepEqual(args, [{ projectId: RELEASE_PROJECT, teamId: TEAM, deploymentId: DEPLOYMENT }])
  assert.ok(Object.isFrozen(args[0]))
  await assert.rejects(transport.promote(INPUT), expectedError('attempt_already_consumed'))
  assert.equal(args.length, 1)
})

test('invalid input cannot redirect or customize the tool invocation and does not consume a valid future call', async () => {
  let calls = 0
  const transport = create(() => { calls++; return returned() })
  const invalid = [null, [], true, {}, undefined,
    ...['', 'dpl_bad/slash', 'dpl_bad\n', 'dpl_bad?force=true', 'notDeployment', `dpl_${'a'.repeat(129)}`]
      .map(deploymentId => ({ deploymentId })),
    ...['projectId', 'teamId', 'requestBody', 'force', 'slug', 'endpoint'].map(key => ({ ...INPUT, [key]: SECRET })),
    { ...INPUT, [Symbol('extra')]: true },
    { get deploymentId() { calls++; throw new Error(SECRET) } },
    new Proxy({}, { ownKeys() { throw new Error(SECRET) } }),
  ]
  for (const input of invalid) await assert.rejects(transport.promote(input), expectedError('invalid_deployment'))
  assert.equal(calls, 0)
  await transport.promote(INPUT)
  assert.equal(calls, 1)
})

test('concurrent calls are latched before the callback settles', async () => {
  let calls = 0, finish
  const transport = create(() => { calls++; return new Promise(resolve => { finish = resolve }) })
  const first = transport.promote(INPUT)
  await assert.rejects(transport.promote(INPUT), expectedError('attempt_already_consumed'))
  assert.equal(calls, 1)
  finish(returned())
  assert.deepEqual(await first, { invoked: true, receipt: 'tool_returned' })
})

for (const [name, callback] of [
  ['synchronous exception', () => { throw new Error(SECRET) }],
  ['asynchronous rejection', async () => { throw new Error(SECRET) }],
  ['throwing thenable', () => ({ get then() { throw new Error(SECRET) } })],
]) {
  test(`${name} is sanitized, unknown, and consumes the single invocation`, async () => {
    let calls = 0
    const transport = create(() => { calls++; return callback() })
    await assert.rejects(transport.promote(INPUT), expectedError('tool_failed', true))
    await assert.rejects(transport.promote(INPUT), expectedError('attempt_already_consumed'))
    assert.equal(calls, 1)
  })
}

for (const [name, receipt] of [
  ['missing', undefined], ['null', null], ['array', []], ['bare string', SECRET],
  ['unidentified object', {}], ['invented accepted field', { accepted: true }],
  ['missing explicit success and structured content', { content: [] }],
  ['tool error', { isError: true, content: [{ type: 'text', text: SECRET }] }],
  ['invalid isError flag', { isError: 0, content: [] }],
  ['top error field', { isError: false, content: [], error: SECRET }],
  ['invalid content', { isError: false, content: SECRET }],
  ['null structured content', { structuredContent: null }],
  ['structured array', { structuredContent: [] }],
  ['structured error', { structuredContent: { error: SECRET } }],
  ['wrapped structured error', { structuredContent: { result: { error: SECRET } } }],
  ['throwing receipt accessor', { get isError() { throw new Error(SECRET) }, content: [] }],
  ['throwing envelope proxy', new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(SECRET) } })],
]) {
  test(`${name} receipt is unknown without exposing provider content or allowing another invocation`, async () => {
    let calls = 0
    const transport = create(() => { calls++; return receipt })
    await assert.rejects(transport.promote(INPUT), expectedError('receipt_unknown', true))
    await assert.rejects(transport.promote(INPUT), expectedError('attempt_already_consumed'))
    assert.equal(calls, 1)
  })
}

test('structured MCP envelopes can establish only tool return and opaque body content is never accessed', async () => {
  let reads = 0
  const payload = { get credential() { reads++; throw new Error(SECRET) } }
  for (const receipt of [
    { structuredContent: payload },
    { structuredContent: { result: payload } },
    { isError: false, content: [{ get text() { reads++; throw new Error(SECRET) } }] },
  ]) {
    assert.deepEqual(await create(() => receipt).promote(INPUT), { invoked: true, receipt: 'tool_returned' })
  }
  assert.equal(reads, 0)
})

for (const outcome of ['resolve', 'reject']) {
  test(`timeout consumes the invocation and a late ${outcome} cannot change the outcome or trigger a resend`, async () => {
    let calls = 0, finish
    const transport = create(() => {
      calls++
      return new Promise((resolve, reject) => { finish = outcome === 'resolve' ? () => resolve(returned()) : () => reject(new Error(SECRET)) })
    }, { timeoutMs: 10 })
    await assert.rejects(transport.promote(INPUT), expectedError('deadline_exceeded', true))
    finish()
    await delay(0)
    await assert.rejects(transport.promote(INPUT), expectedError('attempt_already_consumed'))
    assert.equal(calls, 1)
  })
}

test('a blocking callback cannot turn a result past the deadline into a successful receipt', async () => {
  let calls = 0
  const transport = create(() => {
    calls++
    const deadline = performance.now() + 20
    while (performance.now() < deadline) { /* Simulate a host blocking the event loop. */ }
    return returned()
  }, { timeoutMs: 5 })
  await assert.rejects(transport.promote(INPUT), expectedError('deadline_exceeded', true))
  await assert.rejects(transport.promote(INPUT), expectedError('attempt_already_consumed'))
  assert.equal(calls, 1)
})

test('separate instances deliberately do not claim cross-process or remote idempotency', async () => {
  let calls = 0
  const requestPromote = () => { calls++; return returned() }
  await create(requestPromote).promote(INPUT)
  await create(requestPromote).promote(INPUT)
  assert.equal(calls, 2)
})
