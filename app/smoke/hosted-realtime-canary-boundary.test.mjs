import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const APP_ROOT = new URL('../', import.meta.url)
const CONTRACT_URL = new URL('../e2e/hosted/realtime-contract.ts', import.meta.url)
const NETWORK_URL = new URL('../e2e/hosted/network-boundary.ts', import.meta.url)
const SDK_BOUNDARY_URL = new URL('../e2e/hosted/sdk-boundary.ts', import.meta.url)
const REPORTER_URL = new URL('../e2e/hosted/privacy-reporter.ts', import.meta.url)
const LAUNCHER_URL = new URL('../e2e/hosted/safe-launcher.mjs', import.meta.url)

async function source(relativePath) {
  return readFile(new URL(relativePath, APP_ROOT), 'utf8')
}

async function compileTsDataUrl(url) {
  const moduleSource = await readFile(url, 'utf8')
  const compiled = ts.transpileModule(moduleSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${Math.random()}`
}

async function loadTsModule(url) {
  return import(await compileTsDataUrl(url))
}

async function loadSdkBoundaryModule() {
  const networkDataUrl = await compileTsDataUrl(NETWORK_URL)
  const moduleSource = (await readFile(SDK_BOUNDARY_URL, 'utf8'))
    .replace(
      "from './network-boundary'",
      `from '${networkDataUrl}'`,
    )
  const compiled = ts.transpileModule(moduleSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${Math.random()}`)
}

const loadContract = () => loadTsModule(CONTRACT_URL)

const PROJECT_REF = 'abcdefghijklmnopqrst'
const LINEAGE = 'caaci-hosted-realtime-fixture-v1'
const COMMIT = 'a'.repeat(40)
const APP_ORIGIN = 'https://reviewed-preview.vercel.app'
const ENTRY_DOCUMENT = '<!doctype html><title>reviewed preview</title>'
const ENTRY_DOCUMENT_SHA256 = createHash('sha256')
  .update(ENTRY_DOCUMENT)
  .digest('hex')
const APP_ASSET_BODIES = Object.freeze({
  '/assets/app.js': 'export const reviewed = true',
  '/static/app-icon.svg': '<svg viewBox="0 0 1 1"></svg>',
})
const APP_ASSETS = Object.freeze(
  Object.entries(APP_ASSET_BODIES).map(([path, body]) => Object.freeze({
    path,
    sha256: createHash('sha256').update(body).digest('hex'),
  })),
)
const IDS = Object.freeze({
  run: '77777777-7777-4777-8777-777777777777',
  a: '11111111-1111-4111-8111-111111111111',
  b: '22222222-2222-4222-8222-222222222222',
  c: '33333333-3333-4333-8333-333333333333',
  ab: '44444444-4444-4444-8444-444444444444',
  ac: '55555555-5555-4555-8555-555555555555',
  sentinel: '66666666-6666-4666-8666-666666666666',
})
const FIXTURE_MANIFEST_FIELDS = Object.freeze([
  'caaci-hosted-fixture-v1',
  PROJECT_REF,
  LINEAGE,
  IDS.sentinel,
  '1',
  'member-a',
  IDS.a,
  'member-b',
  IDS.b,
  'member-c',
  IDS.c,
  'ab',
  IDS.ab,
  'ac',
  IDS.ac,
])
const FIXTURE_MANIFEST_SHA256 = createHash('sha256')
  .update(FIXTURE_MANIFEST_FIELDS.join('\x1f'), 'utf8')
  .digest('hex')
const PROVIDER_PROOF_SHA256 = 'a'.repeat(64)
const PROVIDER_PROOF_EXPIRES_AT = '2026-07-31T03:00:00.000Z'

function approvedTargets() {
  return [{
    projectRef: PROJECT_REF,
    datasetLineage: LINEAGE,
    appOrigin: APP_ORIGIN,
    commit: COMMIT,
    entryDocumentSha256: ENTRY_DOCUMENT_SHA256,
    appAssets: APP_ASSETS,
    environmentSentinelId: IDS.sentinel,
    fixtureRevision: 1,
    fixtureManifestSha256: FIXTURE_MANIFEST_SHA256,
    providerDisableProofSha256: PROVIDER_PROOF_SHA256,
    providerProofExpiresAt: PROVIDER_PROOF_EXPIRES_AT,
  }]
}

function completeEnv(overrides = {}) {
  return {
    CAACI_HOSTED_CANARY_MODE: 'realtime-staging',
    CAACI_HOSTED_CANARY_LAUNCHER: 'v2',
    CAACI_HOSTED_CANARY_CONFIRM: 'WRITE DISPOSABLE SYNTHETIC STAGING DATA',
    CAACI_HOSTED_CANARY_WRITE_ENABLED: 'true',
    CAACI_HOSTED_CANARY_TARGET_IS_STAGING: 'true',
    CAACI_HOSTED_CANARY_ACCOUNTS_ARE_SYNTHETIC: 'true',
    CAACI_HOSTED_CANARY_DATASET_IS_DISPOSABLE: 'true',
    CAACI_HOSTED_CANARY_RUN_ID: IDS.run,
    CAACI_HOSTED_CANARY_APP_ORIGIN: APP_ORIGIN,
    CAACI_HOSTED_CANARY_PROJECT_REF: PROJECT_REF,
    CAACI_HOSTED_CANARY_COMMIT_SHA: COMMIT,
    CAACI_HOSTED_CANARY_DATASET_LINEAGE: LINEAGE,
    CAACI_HOSTED_CANARY_PUBLISHABLE_KEY: 'sb_publishable_hosted-test-key',
    CAACI_HOSTED_CANARY_AB_CONVERSATION_ID: IDS.ab,
    CAACI_HOSTED_CANARY_AC_CONVERSATION_ID: IDS.ac,
    CAACI_HOSTED_CANARY_A_EMAIL: 'actor-a@example.invalid',
    CAACI_HOSTED_CANARY_A_PASSWORD: 'not-a-real-password-a',
    CAACI_HOSTED_CANARY_A_USER_ID: IDS.a,
    CAACI_HOSTED_CANARY_B_EMAIL: 'actor-b@example.invalid',
    CAACI_HOSTED_CANARY_B_PASSWORD: 'not-a-real-password-b',
    CAACI_HOSTED_CANARY_B_USER_ID: IDS.b,
    CAACI_HOSTED_CANARY_C_EMAIL: 'actor-c@example.invalid',
    CAACI_HOSTED_CANARY_C_PASSWORD: 'not-a-real-password-c',
    CAACI_HOSTED_CANARY_C_USER_ID: IDS.c,
    ...overrides,
  }
}

function exactManifest(overrides = {}) {
  return {
    schema: 1,
    environment: 'preview',
    deployable: true,
    projectRef: PROJECT_REF,
    appOrigin: APP_ORIGIN,
    release: COMMIT.slice(0, 7),
    commit: COMMIT,
    ...overrides,
  }
}

test('hosted contract accepts only an approved, exact, synthetic disposable target', async () => {
  const { loadHostedRealtimeContract } = await loadContract()
  const contract = loadHostedRealtimeContract(completeEnv(), approvedTargets())

  assert.equal(contract.appOrigin, APP_ORIGIN)
  assert.equal(contract.protocolRevision, 2)
  assert.equal(contract.runId, IDS.run)
  assert.equal(contract.supabaseOrigin, `https://${PROJECT_REF}.supabase.co`)
  assert.equal(contract.commit, COMMIT)
  assert.equal(contract.entryDocumentSha256, ENTRY_DOCUMENT_SHA256)
  assert.deepEqual(contract.appAssets, APP_ASSETS)
  assert.equal(contract.datasetLineage, LINEAGE)
  assert.equal(contract.environmentSentinelId, IDS.sentinel)
  assert.equal(contract.fixtureRevision, 1)
  assert.equal(contract.fixtureManifestSha256, FIXTURE_MANIFEST_SHA256)
  assert.equal(contract.providerDisableProofSha256, PROVIDER_PROOF_SHA256)
  assert.equal(contract.providerProofExpiresAt, PROVIDER_PROOF_EXPIRES_AT)
  assert.deepEqual(contract.accounts.map(account => account.role), [
    'member-a',
    'member-b',
    'member-c',
  ])
  assert.deepEqual(contract.conversations, { ab: IDS.ab, ac: IDS.ac })
})

test('source-controlled fixture digest binds every canonical fixture identity field', async () => {
  const { loadHostedRealtimeContract } = await loadContract()
  const alternate = {
    projectRef: 'bcdefghijklmnopqrstu',
    datasetLineage: 'caaci-hosted-realtime-fixture-v2',
    sentinel: '88888888-8888-4888-8888-888888888888',
    a: '99999999-9999-4999-8999-999999999999',
    b: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    c: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ab: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    ac: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  }
  const exactTarget = approvedTargets()[0]
  const mismatches = [
    {
      env: { CAACI_HOSTED_CANARY_PROJECT_REF: alternate.projectRef },
      target: { projectRef: alternate.projectRef },
    },
    {
      env: { CAACI_HOSTED_CANARY_DATASET_LINEAGE: alternate.datasetLineage },
      target: { datasetLineage: alternate.datasetLineage },
    },
    { env: {}, target: { environmentSentinelId: alternate.sentinel } },
    { env: {}, target: { fixtureRevision: 2 } },
    { env: { CAACI_HOSTED_CANARY_A_USER_ID: alternate.a }, target: {} },
    { env: { CAACI_HOSTED_CANARY_B_USER_ID: alternate.b }, target: {} },
    { env: { CAACI_HOSTED_CANARY_C_USER_ID: alternate.c }, target: {} },
    { env: { CAACI_HOSTED_CANARY_AB_CONVERSATION_ID: alternate.ab }, target: {} },
    { env: { CAACI_HOSTED_CANARY_AC_CONVERSATION_ID: alternate.ac }, target: {} },
  ]

  for (const mismatch of mismatches) {
    assert.throws(
      () => loadHostedRealtimeContract(
        completeEnv(mismatch.env),
        [{ ...exactTarget, ...mismatch.target }],
      ),
      /hosted_realtime_contract_invalid: fixture manifest/,
    )
  }
  assert.throws(
    () => loadHostedRealtimeContract(
      completeEnv(),
      [{ ...exactTarget, fixtureManifestSha256: 'f'.repeat(64) }],
    ),
    /hosted_realtime_contract_invalid: fixture manifest/,
  )
  const { fixtureManifestSha256: _omitted, ...targetWithoutDigest } = exactTarget
  assert.throws(
    () => loadHostedRealtimeContract(completeEnv(), [targetWithoutDigest]),
    /hosted_realtime_contract_invalid: target is not source-controlled/,
  )
  for (const target of [
    { ...exactTarget, providerDisableProofSha256: 'not-a-digest' },
    { ...exactTarget, providerProofExpiresAt: 'not-an-iso-timestamp' },
  ]) {
    assert.throws(
      () => loadHostedRealtimeContract(completeEnv(), [target]),
      /hosted_realtime_contract_invalid: target is not source-controlled/,
    )
  }
})

test('every manual, staging, synthetic and write attestation fails closed', async () => {
  const { loadHostedRealtimeContract } = await loadContract()
  const gates = [
    'CAACI_HOSTED_CANARY_MODE',
    'CAACI_HOSTED_CANARY_LAUNCHER',
    'CAACI_HOSTED_CANARY_CONFIRM',
    'CAACI_HOSTED_CANARY_WRITE_ENABLED',
    'CAACI_HOSTED_CANARY_TARGET_IS_STAGING',
    'CAACI_HOSTED_CANARY_ACCOUNTS_ARE_SYNTHETIC',
    'CAACI_HOSTED_CANARY_DATASET_IS_DISPOSABLE',
  ]

  for (const key of gates) {
    assert.throws(
      () => loadHostedRealtimeContract(completeEnv({ [key]: '' }), approvedTargets()),
      /hosted_realtime_contract_invalid/,
      key,
    )
  }

  for (const [key, value] of [
    ['CI', '1'],
    ['CI', 'false'],
    ['GITHUB_ACTIONS', '1'],
    ['GITHUB_ACTIONS', 'false'],
    ['RUNNER_OS', 'macOS'],
    ['GITLAB_CI', 'true'],
    ['TF_BUILD', 'True'],
  ]) {
    assert.throws(
      () => loadHostedRealtimeContract(
        completeEnv({ [key]: value }),
        approvedTargets(),
      ),
      /hosted_realtime_contract_invalid/,
      `${key}=${value}`,
    )
  }
})

test('operator-controlled expected values cannot approve production or an unknown staging project', async () => {
  const { loadHostedRealtimeContract } = await loadContract()
  const productionRef = 'lfhvgprfphyfvhidegum'

  assert.throws(
    () => loadHostedRealtimeContract(completeEnv({
      CAACI_HOSTED_CANARY_APP_ORIGIN: 'https://illinimarket.com',
    }), [{
      projectRef: PROJECT_REF,
      datasetLineage: LINEAGE,
      appOrigin: 'https://illinimarket.com',
      commit: COMMIT,
      entryDocumentSha256: ENTRY_DOCUMENT_SHA256,
      appAssets: APP_ASSETS,
      environmentSentinelId: IDS.sentinel,
      fixtureRevision: 1,
      fixtureManifestSha256: FIXTURE_MANIFEST_SHA256,
      providerDisableProofSha256: PROVIDER_PROOF_SHA256,
      providerProofExpiresAt: PROVIDER_PROOF_EXPIRES_AT,
    }]),
    /hosted_realtime_contract_invalid/,
  )
  assert.throws(
    () => loadHostedRealtimeContract(completeEnv({
      CAACI_HOSTED_CANARY_PROJECT_REF: productionRef,
    }), [{
      projectRef: productionRef,
      datasetLineage: LINEAGE,
      appOrigin: APP_ORIGIN,
      commit: COMMIT,
      entryDocumentSha256: ENTRY_DOCUMENT_SHA256,
      appAssets: APP_ASSETS,
      environmentSentinelId: IDS.sentinel,
      fixtureRevision: 1,
      fixtureManifestSha256: FIXTURE_MANIFEST_SHA256,
      providerDisableProofSha256: PROVIDER_PROOF_SHA256,
      providerProofExpiresAt: PROVIDER_PROOF_EXPIRES_AT,
    }]),
    /hosted_realtime_contract_invalid/,
  )
  assert.throws(
    () => loadHostedRealtimeContract(completeEnv(), []),
    /hosted_realtime_contract_invalid/,
  )
  assert.throws(
    () => loadHostedRealtimeContract(completeEnv({
      CAACI_HOSTED_CANARY_APP_ORIGIN: 'https://other-preview.vercel.app',
    }), approvedTargets()),
    /hosted_realtime_contract_invalid/,
  )
  assert.throws(
    () => loadHostedRealtimeContract(completeEnv({
      CAACI_HOSTED_CANARY_COMMIT_SHA: 'b'.repeat(40),
    }), approvedTargets()),
    /hosted_realtime_contract_invalid/,
  )
})

test('target URL rejects local, ambiguous and suffix-confusion forms before network access', async () => {
  const { loadHostedRealtimeContract } = await loadContract()
  const invalidOrigins = [
    'http://reviewed-preview.vercel.app',
    'https://reviewed-preview.vercel.app/',
    'https://reviewed-preview.vercel.app/path',
    'https://reviewed-preview.vercel.app?target=preview',
    'https://reviewed-preview.vercel.app#preview',
    'https://user:pass@reviewed-preview.vercel.app',
    'https://reviewed-preview.vercel.app:444',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]',
    'https://reviewed-preview.vercel.app.evil.example',
    'https://xn--reviewed-preview-9k1h.vercel.app',
  ]

  for (const appOrigin of invalidOrigins) {
    assert.throws(
      () => loadHostedRealtimeContract(completeEnv({
        CAACI_HOSTED_CANARY_APP_ORIGIN: appOrigin,
      }), approvedTargets()),
      /hosted_realtime_contract_invalid/,
      appOrigin,
    )
  }
})

test('accounts, conversations and server-owned roles must be exact and distinct', async () => {
  const { loadHostedRealtimeContract, hostedActorMetadataMatches } = await loadContract()
  for (const [key, value] of [
    ['CAACI_HOSTED_CANARY_B_USER_ID', IDS.a],
    ['CAACI_HOSTED_CANARY_AC_CONVERSATION_ID', IDS.ab],
    ['CAACI_HOSTED_CANARY_A_EMAIL', ''],
    ['CAACI_HOSTED_CANARY_C_PASSWORD', ''],
    ['CAACI_HOSTED_CANARY_A_PASSWORD', 'too-short'],
    ['CAACI_HOSTED_CANARY_B_PASSWORD', 'sixteen-characters\n'],
  ]) {
    assert.throws(
      () => loadHostedRealtimeContract(completeEnv({ [key]: value }), approvedTargets()),
      /hosted_realtime_contract_invalid/,
    )
  }

  const contract = loadHostedRealtimeContract(completeEnv(), approvedTargets())
  const actor = contract.accounts[0]
  assert.equal(hostedActorMetadataMatches({
    id: actor.expectedUserId,
    app_metadata: {
      caaci_hosted_canary: true,
      caaci_dataset_lineage: LINEAGE,
      caaci_canary_role: 'member-a',
    },
    user_metadata: {
      caaci_hosted_canary: false,
    },
  }, actor, contract), true)
  assert.equal(hostedActorMetadataMatches({
    id: actor.expectedUserId,
    app_metadata: {},
    user_metadata: {
      caaci_hosted_canary: true,
      caaci_dataset_lineage: LINEAGE,
      caaci_canary_role: 'member-a',
    },
  }, actor, contract), false)
})

test('server-owned environment sentinel proves synthetic, side-effect-free, clean staging', async () => {
  const {
    assertHostedEnvironmentSentinel,
    loadHostedRealtimeContract,
  } = await loadContract()
  const contract = loadHostedRealtimeContract(completeEnv(), approvedTargets())
  const now = Date.parse('2026-07-31T00:00:00.000Z')
  const exact = {
    sentinel_id: IDS.sentinel,
    project_ref: PROJECT_REF,
    protocol_revision: 2,
    dataset_lineage: LINEAGE,
    fixture_revision: 1,
    fixture_manifest_sha256: FIXTURE_MANIFEST_SHA256,
    provider_disable_proof_sha256: PROVIDER_PROOF_SHA256,
    provider_proof_expires_at: PROVIDER_PROOF_EXPIRES_AT,
    lifecycle_state: 'ready',
    synthetic_only: true,
    disposable: true,
    provider_side_effects_disabled: true,
    write_cleanup_supported: true,
    residue_count: 0,
    expires_at: '2026-07-31T02:00:00.000Z',
  }

  assert.deepEqual(
    assertHostedEnvironmentSentinel(contract, exact, 'ready', now),
    exact,
  )
  assert.deepEqual(
    assertHostedEnvironmentSentinel(
      contract,
      { ...exact, lifecycle_state: 'cleaned' },
      'cleaned',
      now,
    ),
    { ...exact, lifecycle_state: 'cleaned' },
  )
  for (const sentinel of [
    { ...exact, sentinel_id: IDS.ab },
    { ...exact, project_ref: 'zzzzzzzzzzzzzzzzzzzz' },
    { ...exact, protocol_revision: 1 },
    { ...exact, dataset_lineage: 'wrong-lineage' },
    { ...exact, fixture_revision: 2 },
    { ...exact, fixture_manifest_sha256: 'f'.repeat(64) },
    { ...exact, provider_disable_proof_sha256: 'f'.repeat(64) },
    {
      ...exact,
      provider_proof_expires_at: '2026-07-31T00:30:00.000Z',
    },
    { ...exact, lifecycle_state: 'cleaned' },
    { ...exact, synthetic_only: false },
    { ...exact, disposable: false },
    { ...exact, provider_side_effects_disabled: false },
    { ...exact, write_cleanup_supported: false },
    { ...exact, residue_count: 1 },
    { ...exact, expires_at: '2026-07-31T00:30:00.000Z' },
    { ...exact, expires_at: '2026-08-08T00:00:00.000Z' },
    { ...exact, unexpected: true },
  ]) {
    assert.throws(
      () => assertHostedEnvironmentSentinel(
        contract,
        sentinel,
        'ready',
        now,
      ),
      /hosted_realtime_contract_invalid/,
    )
  }
})

test('privileged and debug credentials are rejected even when the target is otherwise valid', async () => {
  const { loadHostedRealtimeContract } = await loadContract()
  for (const key of [
    'SUPABASE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_ACCESS_TOKEN',
    'ADMIN_TOKEN',
    'OPENAI_API_KEY',
    'RESEND_API_KEY',
    'SENTRY_AUTH_TOKEN',
    'WECHAT_APPSECRET',
    'VERCEL_TOKEN',
    'GITHUB_TOKEN',
    'PWDEBUG',
    'DEBUG',
    'ACTIONS_STEP_DEBUG',
    'RUNNER_DEBUG',
  ]) {
    assert.throws(
      () => loadHostedRealtimeContract(completeEnv({ [key]: 'must-never-be-used' }), approvedTargets()),
      /hosted_realtime_contract_invalid/,
      key,
    )
  }
})

test('browser executable must be an absolute canonical executable file', async () => {
  const { assertHostedBrowserExecutable } = await loadContract()
  assert.equal(
    assertHostedBrowserExecutable(process.execPath),
    process.execPath,
  )
  for (const invalid of [
    '',
    './relative-browser',
    process.cwd(),
    '/definitely/missing/caaci-hosted-browser',
    `${process.execPath}\n`,
  ]) {
    assert.throws(
      () => assertHostedBrowserExecutable(invalid),
      /hosted_realtime_contract_invalid/,
      invalid,
    )
  }
})

test('deployment manifest binds Preview, deployability, origin, ref, release and full commit', async () => {
  const {
    assertHostedDeploymentManifest,
    loadHostedRealtimeContract,
  } = await loadContract()
  const contract = loadHostedRealtimeContract(completeEnv(), approvedTargets())

  assert.deepEqual(assertHostedDeploymentManifest(contract, exactManifest()), exactManifest())

  for (const manifest of [
    exactManifest({ schema: 2 }),
    exactManifest({ environment: 'production' }),
    exactManifest({ deployable: false }),
    exactManifest({ projectRef: 'zzzzzzzzzzzzzzzzzzzz' }),
    exactManifest({ appOrigin: 'https://other-preview.vercel.app' }),
    exactManifest({ release: 'bbbbbbb' }),
    exactManifest({ commit: 'b'.repeat(40) }),
  ]) {
    assert.throws(
      () => assertHostedDeploymentManifest(contract, manifest),
      /hosted_realtime_manifest_invalid/,
    )
  }
})

test('manifest fetch is credential-free, redirect-free, bounded and precedes any actor work', async () => {
  const {
    fetchAndVerifyHostedDeploymentManifest,
    loadHostedRealtimeContract,
  } = await loadContract()
  const contract = loadHostedRealtimeContract(completeEnv(), approvedTargets())
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      url: `${APP_ORIGIN}/deployment-manifest.json`,
      headers: new Headers({
        'content-type': 'application/json',
        'content-length': String(JSON.stringify(exactManifest()).length),
      }),
      text: async () => JSON.stringify(exactManifest()),
    }
  }

  const manifest = await fetchAndVerifyHostedDeploymentManifest(contract, fetchImpl)
  assert.equal(manifest.commit, COMMIT)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${APP_ORIGIN}/deployment-manifest.json`)
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(calls[0].init.credentials, 'omit')
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer')
  assert.deepEqual(Object.keys(calls[0].init.headers), ['accept'])
  assert.doesNotMatch(JSON.stringify(calls[0].init), /password|email|authorization|apikey/i)

  await assert.rejects(
    fetchAndVerifyHostedDeploymentManifest(contract, async () => ({
      ok: true,
      status: 200,
      url: `${APP_ORIGIN}/deployment-manifest.json`,
      headers: new Headers({
        'content-type': 'application/json',
        'content-length': '5000',
      }),
      text: async () => JSON.stringify(exactManifest()),
    })),
    /hosted_realtime_manifest_invalid/,
  )
})

test('source-reviewed entry hash independently binds the immutable Preview document', async () => {
  const {
    fetchAndVerifyHostedEntryDocument,
    loadHostedRealtimeContract,
  } = await loadContract()
  const contract = loadHostedRealtimeContract(completeEnv(), approvedTargets())
  const calls = []
  const exactFetch = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      url: `${APP_ORIGIN}/`,
      headers: new Headers({
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(Buffer.byteLength(ENTRY_DOCUMENT)),
      }),
      arrayBuffer: async () => Buffer.from(ENTRY_DOCUMENT),
    }
  }

  await fetchAndVerifyHostedEntryDocument(contract, exactFetch)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${APP_ORIGIN}/`)
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(calls[0].init.credentials, 'omit')
  assert.deepEqual(Object.keys(calls[0].init.headers), ['accept'])

  await assert.rejects(
    fetchAndVerifyHostedEntryDocument(contract, async () => ({
      ok: true,
      status: 200,
      url: `${APP_ORIGIN}/`,
      headers: new Headers({
        'content-type': 'text/html',
        'content-length': '20',
      }),
      arrayBuffer: async () => Buffer.from('<title>tampered</title>'),
    })),
    /hosted_realtime_manifest_invalid/,
  )
})

test('every same-origin browser asset is source-pinned, bounded and redirect-free', async () => {
  const {
    fetchAndVerifyHostedAssets,
    loadHostedRealtimeContract,
  } = await loadContract()
  const contract = loadHostedRealtimeContract(completeEnv(), approvedTargets())
  const calls = []
  await fetchAndVerifyHostedAssets(contract, async (url, init) => {
    calls.push({ url, init })
    const path = new URL(url).pathname
    const body = APP_ASSET_BODIES[path]
    return {
      ok: true,
      status: 200,
      url,
      headers: new Headers({
        'content-type': path.endsWith('.js')
          ? 'text/javascript'
          : 'image/svg+xml',
        'content-length': String(Buffer.byteLength(body)),
      }),
      arrayBuffer: async () => Buffer.from(body),
    }
  })
  assert.deepEqual(
    calls.map(call => call.url),
    APP_ASSETS.map(asset => `${APP_ORIGIN}${asset.path}`),
  )
  assert.equal(calls.every(call => call.init.redirect === 'error'), true)
  assert.equal(calls.every(call => call.init.credentials === 'omit'), true)

  await assert.rejects(
    fetchAndVerifyHostedAssets(contract, async (url) => ({
      ok: true,
      status: 200,
      url,
      headers: new Headers({
        'content-type': 'text/javascript',
        'content-length': '8',
      }),
      arrayBuffer: async () => Buffer.from('tampered'),
    })),
    /hosted_realtime_manifest_invalid/,
  )
})

test('browser network policy permits only reviewed read paths and exact read receipts', async () => {
  const { loadHostedRealtimeContract } = await loadContract()
  const {
    decodeHostedPhoenixBroadcastPush,
    decodeHostedPhoenixFrame,
    hostedBrowserRequestHeadersAllowed,
    hostedFingerprintRequestMockable,
    hostedHttpRequestAllowed,
    hostedDeniedRealtimeProbeTopic,
    hostedReadReceiptRequestMockable,
    hostedRealtimeBroadcastPushAllowed,
    hostedRealtimeJoinAllowed,
    hostedRealtimeOutboundTextFrameAllowed,
    hostedRealtimeSocketAllowed,
  } = await loadTsModule(NETWORK_URL)
  const contract = loadHostedRealtimeContract(completeEnv(), approvedTargets())
  const actor = contract.accounts[0]
  const actorJwt = [
    Buffer.from('{"alg":"none"}').toString('base64url'),
    Buffer.from(JSON.stringify({ sub: IDS.a })).toString('base64url'),
    'signature',
  ].join('.')
  const allowHttp = (url, method = 'GET', body) => (
    hostedHttpRequestAllowed(contract, actor, url, method, body)
  )

  assert.equal(allowHttp(`${APP_ORIGIN}/`), true)
  assert.equal(allowHttp(`${APP_ORIGIN}/assets/app.js`), true)
  assert.equal(allowHttp(`${APP_ORIGIN}/static/app-icon.svg`), true)
  assert.equal(allowHttp(`${APP_ORIGIN}/assets/unreviewed.js`), false)
  assert.equal(allowHttp(`${APP_ORIGIN}/share/not-a-real-id`), false)
  assert.equal(allowHttp(`${APP_ORIGIN}/api/realtime-poll`), false)
  assert.equal(allowHttp(`${APP_ORIGIN}/?leak=value`), false)
  assert.equal(allowHttp(`${APP_ORIGIN}/`, 'POST'), false)
  assert.equal(allowHttp('https://sentry.example/envelope'), false)

  const supabase = `https://${PROJECT_REF}.supabase.co`
  const loginBody = JSON.stringify({
    email: 'actor-a@example.invalid',
    password: 'not-a-real-password-a',
    gotrue_meta_security: {},
  })
  assert.equal(allowHttp(
    `${supabase}/auth/v1/token?grant_type=password`,
    'POST',
    loginBody,
  ), true)
  assert.equal(allowHttp(
    `${supabase}/auth/v1/token?grant_type=password`,
    'OPTIONS',
  ), true)
  assert.equal(allowHttp(
    `${supabase}/auth/v1/token?grant_type=password`,
    'POST',
    JSON.stringify({
      email: 'actor-b@example.invalid',
      password: 'not-a-real-password-a',
      gotrue_meta_security: {},
    }),
  ), false)
  assert.equal(allowHttp(`${supabase}/auth/v1/logout`, 'POST'), false)
  assert.equal(allowHttp(`${supabase}/auth/v1/logout?scope=local`, 'POST'), true)
  assert.equal(allowHttp(`${supabase}/auth/v1/logout?scope=local`, 'OPTIONS'), true)
  assert.equal(allowHttp(`${supabase}/auth/v1/logout?scope=global`, 'POST'), false)
  assert.equal(allowHttp(`${supabase}/auth/v1/admin/users`, 'GET'), false)
  assert.equal(allowHttp(`${supabase}/rest/v1/conversations?select=id`), true)
  assert.equal(allowHttp(`${supabase}/rest/v1/private_table?select=*`), false)
  assert.equal(allowHttp(`${supabase}/rest/v1/messages`, 'POST'), false)
  assert.equal(allowHttp(`${supabase}/rest/v1/messages`, 'DELETE'), false)
  assert.equal(allowHttp(`${supabase}/rest/v1/rpc/get_my_profile`, 'POST', '{}'), true)
  const fingerprintBody = JSON.stringify({
    fp_hash_in: 'a'.repeat(64),
    ua_snippet_in: 'hosted-canary',
  })
  assert.equal(allowHttp(
    `${supabase}/rest/v1/rpc/record_fingerprint`,
    'POST',
    fingerprintBody,
  ), false)
  assert.equal(hostedFingerprintRequestMockable(
    contract,
    `${supabase}/rest/v1/rpc/record_fingerprint`,
    'POST',
    fingerprintBody,
  ), true)
  assert.equal(hostedFingerprintRequestMockable(
    contract,
    `${supabase}/rest/v1/rpc/record_fingerprint`,
    'OPTIONS',
  ), true)
  assert.equal(allowHttp(`${supabase}/rest/v1/rpc/make_offer`, 'POST'), false)
  const exactItemPath =
    `/storage/v1/object/public/item-images/items/${IDS.a}/photo.webp`
  const exactRenderedItemPath =
    `/storage/v1/render/image/public/item-images/items/${IDS.a}/photo.webp`
  assert.equal(allowHttp(`${supabase}${exactItemPath}`), true)
  assert.equal(allowHttp(
    `${supabase}${exactRenderedItemPath}?width=480&quality=72&resize=contain`,
  ), true)
  assert.equal(allowHttp(
    `${supabase}${exactRenderedItemPath}?width=9999&quality=72&resize=contain`,
  ), false)
  assert.equal(allowHttp(
    `${supabase}/storage/v1/object/public/item-images/${actorJwt}`,
  ), false)
  assert.equal(allowHttp(
    `${supabase}/storage/v1/object/public/item-images/items/${IDS.a}/token.txt`,
  ), false)
  assert.equal(allowHttp(`${supabase}/storage/v1/object/item-images/x`, 'POST'), false)

  const appHeaders = new Headers({
    accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    referer: `${APP_ORIGIN}/`,
    'sec-fetch-mode': 'navigate',
    'user-agent': 'Mozilla/5.0',
  })
  assert.equal(hostedBrowserRequestHeadersAllowed(
    contract,
    actor,
    `${APP_ORIGIN}/`,
    'GET',
    appHeaders,
    [actorJwt],
  ), true)
  assert.equal(hostedBrowserRequestHeadersAllowed(
    contract,
    actor,
    `${APP_ORIGIN}/`,
    'GET',
    new Headers({
      ...Object.fromEntries(appHeaders),
      authorization: `Bearer ${actorJwt}`,
    }),
    [actorJwt],
  ), false)
  assert.equal(hostedBrowserRequestHeadersAllowed(
    contract,
    actor,
    `${APP_ORIGIN}/`,
    'GET',
    new Headers({
      accept: 'opaque/session-secret',
      'accept-language': 'en-US',
    }),
    [actorJwt],
  ), false)
  assert.equal(hostedBrowserRequestHeadersAllowed(
    contract,
    actor,
    `${APP_ORIGIN}/`,
    'GET',
    new Headers({
      accept: 'text/html',
      'accept-language': 'opaqueRefreshTokenValueThatIsNotALanguage',
    }),
    [actorJwt],
  ), false)
  assert.equal(hostedBrowserRequestHeadersAllowed(
    contract,
    actor,
    `${APP_ORIGIN}/`,
    'GET',
    new Headers({
      accept: 'text/html',
      'x-exfil': actorJwt,
    }),
    [actorJwt],
  ), false)

  const actorHeaders = new Headers({
    accept: 'application/json',
    apikey: contract.publishableKey,
    authorization: `Bearer ${actorJwt}`,
    origin: APP_ORIGIN,
    referer: `${APP_ORIGIN}/`,
    'x-client-info': 'supabase-js-web/2.57.4',
  })
  const realRefreshToken = 'v1.exact-refresh-token-held-only-by-boundary'
  assert.equal(hostedBrowserRequestHeadersAllowed(
    contract,
    actor,
    `${supabase}/rest/v1/conversations?select=${encodeURIComponent(realRefreshToken)}`,
    'GET',
    actorHeaders,
    [actorJwt],
    [actorJwt, realRefreshToken],
  ), false)
  assert.equal(hostedBrowserRequestHeadersAllowed(
    contract,
    actor,
    `${supabase}/rest/v1/conversations?select=id`,
    'GET',
    actorHeaders,
    [actorJwt],
  ), true)
  assert.equal(hostedBrowserRequestHeadersAllowed(
    contract,
    actor,
    `${supabase}/rest/v1/conversations?select=${encodeURIComponent(actorJwt)}`,
    'GET',
    actorHeaders,
    [actorJwt],
  ), false)
  assert.equal(hostedBrowserRequestHeadersAllowed(
    contract,
    actor,
    `${supabase}${exactItemPath}`,
    'GET',
    new Headers({
      accept: 'image/avif,image/webp,*/*;q=0.8',
      referer: `${APP_ORIGIN}/`,
    }),
    [actorJwt],
  ), true)
  assert.equal(hostedBrowserRequestHeadersAllowed(
    contract,
    actor,
    `${supabase}${exactItemPath}`,
    'GET',
    actorHeaders,
    [actorJwt],
  ), false)
  const loginHeaders = new Headers({
    accept: 'application/json',
    apikey: contract.publishableKey,
    authorization: `Bearer ${contract.publishableKey}`,
    'content-type': 'application/json;charset=UTF-8',
    origin: APP_ORIGIN,
    referer: `${APP_ORIGIN}/`,
    'x-client-info': 'supabase-js-web/2.57.4',
  })
  assert.equal(hostedBrowserRequestHeadersAllowed(
    contract,
    actor,
    `${supabase}/auth/v1/token?grant_type=password`,
    'POST',
    loginHeaders,
    [],
  ), true)
  assert.equal(hostedBrowserRequestHeadersAllowed(
    contract,
    actor,
    `${supabase}/auth/v1/token?grant_type=password`,
    'POST',
    new Headers({
      ...Object.fromEntries(loginHeaders),
      accept: actor.password,
    }),
    [],
  ), false)

  const exactReceipt = new URL(`${supabase}/rest/v1/messages`)
  exactReceipt.searchParams.set('conversation_id', `eq.${IDS.ab}`)
  exactReceipt.searchParams.set('sender_id', `neq.${IDS.a}`)
  exactReceipt.searchParams.set('is_read', 'eq.false')
  assert.equal(allowHttp(exactReceipt.href, 'PATCH', '{"is_read":true}'), false)
  assert.equal(hostedReadReceiptRequestMockable(
    contract,
    actor,
    exactReceipt.href,
    'PATCH',
    '{"is_read":true}',
  ), true)
  assert.equal(hostedReadReceiptRequestMockable(
    contract,
    actor,
    exactReceipt.href,
    'OPTIONS',
  ), true)
  assert.equal(allowHttp(exactReceipt.href, 'PATCH', '{"is_read":false}'), false)
  exactReceipt.searchParams.set('sender_id', `neq.${IDS.b}`)
  assert.equal(allowHttp(exactReceipt.href, 'PATCH', '{"is_read":true}'), false)
  exactReceipt.searchParams.set('sender_id', `neq.${IDS.a}`)
  exactReceipt.searchParams.set('or', '(is_read.eq.false)')
  assert.equal(allowHttp(exactReceipt.href, 'PATCH', '{"is_read":true}'), false)

  const websocketUrl = new URL(
    `wss://${PROJECT_REF}.supabase.co/realtime/v1/websocket`,
  )
  websocketUrl.searchParams.set(
    'apikey',
    completeEnv().CAACI_HOSTED_CANARY_PUBLISHABLE_KEY,
  )
  websocketUrl.searchParams.set('vsn', '2.0.0')
  const websocket = websocketUrl.href
  assert.equal(hostedRealtimeSocketAllowed(contract, websocket), true)
  assert.equal(hostedRealtimeSocketAllowed(
    contract,
    `wss://lfhvgprfphyfvhidegum.supabase.co/realtime/v1/websocket`,
  ), false)
  assert.equal(hostedRealtimeSocketAllowed(
    contract,
    `wss://${PROJECT_REF}.supabase.co.evil.example/realtime/v1/websocket`,
  ), false)
  assert.equal(hostedRealtimeSocketAllowed(
    contract,
    `https://${PROJECT_REF}.supabase.co/realtime/v1/websocket`,
  ), false)
  websocketUrl.searchParams.set('apikey', 'wrong-public-key')
  assert.equal(hostedRealtimeSocketAllowed(contract, websocketUrl.href), false)

  const joinFrame = {
    joinRef: '1',
    ref: '1',
    topic: `realtime:messages:${IDS.ab}`,
    event: 'phx_join',
    payload: {
      access_token: actorJwt,
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: '', enabled: false },
        private: false,
        postgres_changes: [{
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${IDS.ab}`,
        }],
      },
    },
  }
  assert.equal(hostedRealtimeJoinAllowed(contract, actor, joinFrame), true)
  assert.equal(hostedRealtimeOutboundTextFrameAllowed(
    contract,
    actor,
    joinFrame,
    new Set([actorJwt]),
  ), true)
  assert.equal(hostedRealtimeJoinAllowed(contract, actor, {
    ...joinFrame,
    joinRef: completeEnv().CAACI_HOSTED_CANARY_A_PASSWORD,
    ref: completeEnv().CAACI_HOSTED_CANARY_A_PASSWORD,
  }), false)
  assert.equal(hostedRealtimeJoinAllowed(contract, actor, {
    ...joinFrame,
    payload: {
      ...joinFrame.payload,
      leaked_password: completeEnv().CAACI_HOSTED_CANARY_A_PASSWORD,
    },
  }), false)
  assert.equal(hostedRealtimeJoinAllowed(contract, actor, {
    ...joinFrame,
    payload: {
      ...joinFrame.payload,
      config: {
        ...joinFrame.payload.config,
        leaked_password: completeEnv().CAACI_HOSTED_CANARY_A_PASSWORD,
      },
    },
  }), false)
  assert.equal(hostedRealtimeJoinAllowed(contract, actor, {
    ...joinFrame,
    payload: {
      ...joinFrame.payload,
      config: {
        ...joinFrame.payload.config,
        postgres_changes: [{
          ...joinFrame.payload.config.postgres_changes[0],
          leaked_password: completeEnv().CAACI_HOSTED_CANARY_A_PASSWORD,
        }],
      },
    },
  }), false)
  assert.equal(hostedRealtimeJoinAllowed(contract, actor, {
    ...joinFrame,
    topic: 'realtime:messages:not-approved',
  }), false)
  const notificationProbeJoin = {
    ...joinFrame,
    topic: `realtime:hosted-notification-${IDS.run}`,
    payload: {
      ...joinFrame.payload,
      config: {
        ...joinFrame.payload.config,
        postgres_changes: [{
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${IDS.a}`,
        }],
      },
    },
  }
  assert.equal(
    hostedRealtimeJoinAllowed(contract, actor, notificationProbeJoin),
    true,
  )
  assert.equal(hostedRealtimeJoinAllowed(contract, actor, {
    ...notificationProbeJoin,
    topic: 'realtime:hosted-notification-operator-chosen',
  }), false)
  const privateJoin = {
    ...joinFrame,
    topic: `realtime:conversation:${IDS.ab}`,
    payload: {
      access_token: actorJwt,
      config: {
        private: true,
        postgres_changes: [],
        presence: { key: IDS.a, enabled: true },
        broadcast: { self: false, ack: true },
      },
    },
  }
  assert.equal(hostedRealtimeJoinAllowed(contract, actor, privateJoin), true)
  const deniedProbeTopics = {
    random: `conversation:${IDS.run}`,
    global: 'online-users',
    user: `user:${IDS.a}`,
  }
  for (const [probe, expectedTopic] of Object.entries(deniedProbeTopics)) {
    assert.equal(
      hostedDeniedRealtimeProbeTopic(contract, actor, probe),
      expectedTopic,
    )
    const deniedProbeJoin = {
      ...privateJoin,
      topic: `realtime:${expectedTopic}`,
    }
    assert.equal(
      hostedRealtimeJoinAllowed(contract, actor, deniedProbeJoin),
      false,
    )
    assert.equal(
      hostedRealtimeJoinAllowed(
        contract,
        actor,
        deniedProbeJoin,
        { deniedProbe: probe },
      ),
      true,
    )
    assert.equal(
      hostedRealtimeJoinAllowed(
        contract,
        actor,
        { ...deniedProbeJoin, topic: 'realtime:operator-chosen' },
        { deniedProbe: probe },
      ),
      false,
    )
  }
  assert.throws(
    () => hostedDeniedRealtimeProbeTopic(contract, actor, 'operator-chosen'),
    /hosted_realtime_denied_probe_invalid/,
  )
  assert.equal(hostedRealtimeJoinAllowed(contract, actor, {
    ...privateJoin,
    payload: {
      access_token: actorJwt,
      config: {
        ...privateJoin.payload.config,
        presence: { key: IDS.c, enabled: true },
      },
    },
  }), false)
  assert.equal(hostedRealtimeJoinAllowed(contract, actor, {
    ...privateJoin,
    payload: {
      ...privateJoin.payload,
      access_token: contract.publishableKey,
    },
  }), false)
  assert.equal(hostedRealtimeJoinAllowed(
    contract,
    actor,
    {
      ...privateJoin,
      payload: {
        ...privateJoin.payload,
        access_token: contract.publishableKey,
        config: {
          ...privateJoin.payload.config,
          presence: { key: 'anonymous-canary', enabled: true },
        },
      },
    },
    { anonymous: true },
  ), true)

  assert.equal(decodeHostedPhoenixFrame(JSON.stringify([
    '1',
    '1',
    joinFrame.topic,
    'phx_join',
    joinFrame.payload,
    completeEnv().CAACI_HOSTED_CANARY_A_PASSWORD,
  ])), null)
  assert.equal(decodeHostedPhoenixFrame(JSON.stringify({
    join_ref: '1',
    ref: '2',
    topic: 'phoenix',
    event: 'heartbeat',
    payload: {},
    leaked_password: completeEnv().CAACI_HOSTED_CANARY_A_PASSWORD,
  })), null)
  const heartbeat = {
    joinRef: null,
    ref: '2',
    topic: 'phoenix',
    event: 'heartbeat',
    payload: {},
  }
  assert.equal(hostedRealtimeOutboundTextFrameAllowed(
    contract,
    actor,
    heartbeat,
    new Set([actorJwt]),
  ), true)
  assert.equal(hostedRealtimeOutboundTextFrameAllowed(
    contract,
    actor,
    {
      ...heartbeat,
      ref: completeEnv().CAACI_HOSTED_CANARY_A_PASSWORD,
    },
    new Set([actorJwt]),
  ), false)
  assert.equal(hostedRealtimeOutboundTextFrameAllowed(
    contract,
    actor,
    { ...heartbeat, ref: '1234567890123' },
    new Set([actorJwt]),
  ), false)
  assert.equal(hostedRealtimeOutboundTextFrameAllowed(
    contract,
    actor,
    {
      ...heartbeat,
      payload: {
        leaked_password: completeEnv().CAACI_HOSTED_CANARY_A_PASSWORD,
      },
    },
    new Set([actorJwt]),
  ), false)

  const presenceFrame = {
    joinRef: '1',
    ref: '3',
    topic: `realtime:conversation:${IDS.ab}`,
    event: 'presence',
    payload: {
      type: 'presence',
      event: 'track',
      payload: {
        user_id: IDS.a,
        online_at: Date.now(),
      },
    },
  }
  assert.equal(hostedRealtimeOutboundTextFrameAllowed(
    contract,
    actor,
    presenceFrame,
    new Set([actorJwt]),
  ), true)
  assert.equal(hostedRealtimeOutboundTextFrameAllowed(
    contract,
    actor,
    {
      ...presenceFrame,
      payload: {
        ...presenceFrame.payload,
        payload: {
          ...presenceFrame.payload.payload,
          password: completeEnv().CAACI_HOSTED_CANARY_A_PASSWORD,
        },
      },
    },
    new Set([actorJwt]),
  ), false)

  const encodeBroadcastPush = (payload) => {
    const joinRef = Buffer.from('1')
    const ref = Buffer.from('4')
    const topic = Buffer.from(`realtime:conversation:${IDS.ab}`)
    const event = Buffer.from('typing')
    const body = Buffer.from(JSON.stringify(payload))
    return Buffer.concat([
      Buffer.from([
        3,
        joinRef.length,
        ref.length,
        topic.length,
        event.length,
        0,
        1,
      ]),
      joinRef,
      ref,
      topic,
      event,
      body,
    ])
  }
  const exactBroadcast = decodeHostedPhoenixBroadcastPush(
    encodeBroadcastPush({
      conversation_id: IDS.ab,
      user_id: IDS.a,
    }),
  )
  assert.ok(exactBroadcast)
  assert.equal(hostedRealtimeBroadcastPushAllowed(
    contract,
    actor,
    exactBroadcast,
  ), true)
  const leakingBroadcast = decodeHostedPhoenixBroadcastPush(
    encodeBroadcastPush({
      conversation_id: IDS.ab,
      user_id: IDS.a,
      password: completeEnv().CAACI_HOSTED_CANARY_A_PASSWORD,
    }),
  )
  assert.ok(leakingBroadcast)
  assert.equal(hostedRealtimeBroadcastPushAllowed(
    contract,
    actor,
    leakingBroadcast,
  ), false)
  const opaqueBinary = encodeBroadcastPush({
    conversation_id: IDS.ab,
    user_id: IDS.a,
  })
  opaqueBinary[6] = 0
  assert.equal(decodeHostedPhoenixBroadcastPush(opaqueBinary), null)
})

test('Node SDK boundary permits only registered canary RPCs for the exact actor', async () => {
  const { loadHostedRealtimeContract } = await loadContract()
  const {
    HostedCanaryWriteRegistry,
    createHostedGuardedWebSocketTransport,
    hostedEnvironmentPreflightRequestAllowed,
    hostedSdkRequestAllowed,
    revokeExactHostedSession,
  } = await loadSdkBoundaryModule()
  const contract = loadHostedRealtimeContract(completeEnv(), approvedTargets())
  const actorA = contract.accounts[0]
  const actorB = contract.accounts[1]
  const actorC = contract.accounts[2]
  const registry = new HostedCanaryWriteRegistry()
  const messageId = '77777777-7777-4777-8777-777777777777'
  registry.registerAttempt(actorA, IDS.ab, messageId, contract)
  assert.throws(
    () => registry.registerAttempt(actorB, IDS.ab, IDS.sentinel, contract),
    /hosted_realtime_write_registry_failed/,
  )
  assert.throws(
    () => registry.registerAttempt(actorC, IDS.ab, IDS.sentinel, contract),
    /hosted_realtime_write_registry_failed/,
  )
  const websocketUrl = new URL(
    `wss://${PROJECT_REF}.supabase.co/realtime/v1/websocket`,
  )
  websocketUrl.searchParams.set(
    'apikey',
    completeEnv().CAACI_HOSTED_CANARY_PUBLISHABLE_KEY,
  )
  websocketUrl.searchParams.set('vsn', '2.0.0')
  const GuardedTransport = createHostedGuardedWebSocketTransport(
    contract,
    actorA,
  )
  for (const protocols of [
    ['stolen-token'],
    [],
    'stolen-token',
    '',
  ]) {
    assert.throws(
      () => new GuardedTransport(websocketUrl.href, protocols),
      /hosted_realtime_sdk_socket_boundary_failed/,
    )
  }

  const jwt = [
    Buffer.from('{"alg":"none"}').toString('base64url'),
    Buffer.from(JSON.stringify({ sub: IDS.a })).toString('base64url'),
    'signature',
  ].join('.')
  const headers = new Headers({
    apikey: completeEnv().CAACI_HOSTED_CANARY_PUBLISHABLE_KEY,
    authorization: `Bearer ${jwt}`,
    'content-type': 'application/json',
    'x-client-info': 'supabase-js/test',
  })
  const rpc = path => `https://${PROJECT_REF}.supabase.co/rest/v1/rpc/${path}`
  const insertBody = JSON.stringify({
    p_run_id: IDS.run,
    p_id: messageId,
    p_conversation_id: IDS.ab,
    p_content: `caaci-hosted-canary-${messageId}`,
  })

  assert.equal(hostedSdkRequestAllowed(
    contract,
    actorA,
    registry,
    rpc('hosted_realtime_canary_begin_run'),
    'POST',
    headers,
    JSON.stringify({ p_run_id: IDS.run }),
  ), true)
  assert.equal(hostedSdkRequestAllowed(
    contract,
    contract.accounts[1],
    registry,
    rpc('hosted_realtime_canary_begin_run'),
    'POST',
    headers,
    JSON.stringify({ p_run_id: IDS.run }),
  ), false)
  assert.equal(hostedSdkRequestAllowed(
    contract,
    actorA,
    registry,
    rpc('hosted_realtime_canary_environment'),
    'POST',
    headers,
    '{}',
  ), false)
  const preflightHeaders = new Headers({
    apikey: completeEnv().CAACI_HOSTED_CANARY_PUBLISHABLE_KEY,
    authorization:
      `Bearer ${completeEnv().CAACI_HOSTED_CANARY_PUBLISHABLE_KEY}`,
    'content-type': 'application/json',
  })
  assert.equal(hostedEnvironmentPreflightRequestAllowed(
    contract,
    rpc('hosted_realtime_canary_environment'),
    'POST',
    preflightHeaders,
    '{}',
  ), true)
  assert.equal(hostedEnvironmentPreflightRequestAllowed(
    contract,
    rpc('hosted_realtime_canary_insert_message'),
    'POST',
    preflightHeaders,
    '{}',
  ), false)
  assert.equal(hostedSdkRequestAllowed(
    contract,
    actorA,
    registry,
    rpc('hosted_realtime_canary_insert_message'),
    'POST',
    headers,
    insertBody,
  ), true)
  assert.equal(hostedSdkRequestAllowed(
    contract,
    actorA,
    registry,
    rpc('hosted_realtime_canary_insert_message'),
    'POST',
    headers,
    JSON.stringify({
      ...JSON.parse(insertBody),
      p_content: 'arbitrary message',
    }),
  ), false)
  assert.equal(hostedSdkRequestAllowed(
    contract,
    actorA,
    registry,
    `https://${PROJECT_REF}.supabase.co/rest/v1/messages`,
    'POST',
    headers,
    insertBody,
  ), false)
  assert.equal(hostedSdkRequestAllowed(
    contract,
    actorA,
    registry,
    rpc('hosted_realtime_canary_cleanup'),
    'POST',
    headers,
    JSON.stringify({
      p_run_id: IDS.run,
      p_message_ids: [messageId],
    }),
  ), false)
  assert.equal(hostedSdkRequestAllowed(
    contract,
    actorA,
    registry,
    rpc('unknown_admin_rpc'),
    'POST',
    headers,
    '{}',
  ), false)

  const completedRegistry = new HostedCanaryWriteRegistry()
  for (const id of [
    '80000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000003',
    '80000000-0000-4000-8000-000000000004',
    '80000000-0000-4000-8000-000000000005',
  ]) completedRegistry.registerAttempt(actorA, IDS.ab, id, contract)
  for (const id of [
    '80000000-0000-4000-8000-000000000006',
    '80000000-0000-4000-8000-000000000007',
  ]) completedRegistry.registerAttempt(actorA, IDS.ac, id, contract)
  completedRegistry.registerAttempt(
    actorC,
    IDS.ac,
    '80000000-0000-4000-8000-000000000008',
    contract,
  )
  assert.equal(completedRegistry.completedRunShapeMatches(contract), true)
  assert.equal(registry.completedRunShapeMatches(contract), false)

  const scaleIds = Object.freeze(Array.from({ length: 51 }, (_, index) => (
    `90000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
  )))
  const notificationId = 'a0000000-0000-4000-8000-000000000001'
  completedRegistry.registerScaleAttempt(actorA, scaleIds, contract)
  assert.deepEqual(completedRegistry.allIds(), [
    '80000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000003',
    '80000000-0000-4000-8000-000000000004',
    '80000000-0000-4000-8000-000000000005',
    '80000000-0000-4000-8000-000000000006',
    '80000000-0000-4000-8000-000000000007',
    '80000000-0000-4000-8000-000000000008',
  ])
  assert.deepEqual(completedRegistry.scaleIds(), scaleIds)
  completedRegistry.setScaleCreatedAt('2026-07-31T00:00:00.123456Z')
  completedRegistry.registerNotificationAttempt(actorA, notificationId)
  completedRegistry.recordBlockState(actorA, true)
  assert.equal(completedRegistry.expectedRestoredBlocks(), 1)
  completedRegistry.recordBlockState(actorA, false)
  assert.equal(completedRegistry.completedV2RunShapeMatches(contract), false)
  completedRegistry.recordBlockState(actorB, true)
  assert.equal(completedRegistry.expectedRestoredBlocks(), 1)
  completedRegistry.recordBlockState(actorB, false)
  assert.equal(completedRegistry.completedV2RunShapeMatches(contract), true)
  assert.equal(completedRegistry.allMessageIds().length, 59)
  assert.throws(
    () => new HostedCanaryWriteRegistry().registerScaleAttempt(
      actorA,
      [...scaleIds].reverse(),
      contract,
    ),
    /hosted_realtime_write_registry_failed/,
  )

  assert.equal(hostedSdkRequestAllowed(
    contract,
    actorA,
    completedRegistry,
    rpc('hosted_realtime_canary_insert_scale_batch'),
    'POST',
    headers,
    JSON.stringify({
      p_run_id: IDS.run,
      p_message_ids: scaleIds,
    }),
  ), true)
  assert.equal(hostedSdkRequestAllowed(
    contract,
    actorA,
    completedRegistry,
    rpc('hosted_realtime_canary_insert_scale_batch'),
    'POST',
    headers,
    JSON.stringify({
      p_run_id: IDS.run,
      p_message_ids: scaleIds.slice(0, 50),
    }),
  ), false)
  assert.equal(hostedSdkRequestAllowed(
    contract,
    actorA,
    completedRegistry,
    rpc('hosted_realtime_canary_insert_notification'),
    'POST',
    headers,
    JSON.stringify({
      p_run_id: IDS.run,
      p_id: notificationId,
    }),
  ), true)
  assert.equal(hostedSdkRequestAllowed(
    contract,
    actorA,
    completedRegistry,
    rpc('hosted_realtime_canary_set_block'),
    'POST',
    headers,
    JSON.stringify({
      p_run_id: IDS.run,
      p_blocked_id: IDS.b,
      p_state: true,
    }),
  ), true)
  assert.equal(hostedSdkRequestAllowed(
    contract,
    actorA,
    completedRegistry,
    rpc('hosted_realtime_canary_set_block'),
    'POST',
    headers,
    JSON.stringify({
      p_run_id: IDS.run,
      p_blocked_id: IDS.c,
      p_state: true,
    }),
  ), false)
  assert.equal(hostedSdkRequestAllowed(
    contract,
    actorA,
    completedRegistry,
    rpc('hosted_realtime_canary_cleanup_v2'),
    'POST',
    headers,
    JSON.stringify({
      p_run_id: IDS.run,
      p_message_ids: completedRegistry.allMessageIds(),
      p_notification_ids: [notificationId],
    }),
  ), true)
  assert.equal(hostedSdkRequestAllowed(
    contract,
    actorA,
    completedRegistry,
    rpc('hosted_realtime_canary_cleanup_v2'),
    'POST',
    headers,
    JSON.stringify({
      p_run_id: IDS.run,
      p_message_ids: completedRegistry.allMessageIds().slice(1),
      p_notification_ids: [notificationId],
    }),
  ), false)

  const scaleRead = new URL(
    `https://${PROJECT_REF}.supabase.co/rest/v1/messages`,
  )
  scaleRead.searchParams.set(
    'select',
    'id,conversation_id,sender_id,content,message_type,is_read,created_at',
  )
  scaleRead.searchParams.set('conversation_id', `eq.${IDS.ab}`)
  scaleRead.searchParams.set(
    'or',
    '(created_at.gt.2026-07-31T00:00:00.123456Z,and(created_at.eq.2026-07-31T00:00:00.123456Z,id.gt.00000000-0000-0000-0000-000000000000))',
  )
  scaleRead.searchParams.set('order', 'created_at.asc,id.asc')
  scaleRead.searchParams.set('limit', '50')
  assert.equal(hostedSdkRequestAllowed(
    contract,
    actorA,
    completedRegistry,
    scaleRead.href,
    'GET',
    headers,
    '',
  ), true)
  scaleRead.searchParams.set('limit', '500')
  assert.equal(hostedSdkRequestAllowed(
    contract,
    actorA,
    completedRegistry,
    scaleRead.href,
    'GET',
    headers,
    '',
  ), false)

  const revokeCalls = []
  await revokeExactHostedSession(contract, jwt, async (request, init) => {
    revokeCalls.push({ request, init })
    return {
      status: 204,
      url: `${contract.supabaseOrigin}/auth/v1/logout?scope=local`,
      headers: new Headers({ 'content-length': '0' }),
      arrayBuffer: async () => new ArrayBuffer(0),
    }
  })
  assert.equal(revokeCalls.length, 1)
  assert.equal(
    revokeCalls[0].request.url,
    `${contract.supabaseOrigin}/auth/v1/logout?scope=local`,
  )
  assert.equal(revokeCalls[0].request.method, 'POST')
  assert.equal(
    revokeCalls[0].request.headers.get('authorization'),
    `Bearer ${jwt}`,
  )
  assert.equal(revokeCalls[0].init.redirect, 'error')
  assert.equal(revokeCalls[0].init.credentials, 'omit')
  await assert.rejects(
    revokeExactHostedSession(contract, 'not-a-jwt', async () => {
      throw new Error('must-not-run')
    }),
    /hosted_realtime_exact_session_revoke_failed/,
  )
})

test('privacy reporter emits fixed scenario/status only and discards hostile values', async () => {
  const { default: Reporter } = await loadTsModule(REPORTER_URL)
  const reporter = new Reporter()
  const leakedValues = [
    'actor@example.invalid',
    'eyJhbGciOiJIUzI1NiJ9.sensitive.payload',
    IDS.a,
    'private message body',
    'https://example.invalid/path?token=sensitive',
  ]
  let output = ''
  const originalWrite = process.stdout.write
  process.stdout.write = ((chunk) => {
    output += String(chunk)
    return true
  })
  try {
    reporter.onTestEnd({
      titlePath: () => [
        leakedValues[0],
        'AUTH-01',
        leakedValues[2],
      ],
    }, {
      status: 'failed',
      error: { message: leakedValues.join(' ') },
      errors: leakedValues,
      attachments: leakedValues,
    })
    reporter.onError(new Error(leakedValues.join(' ')))
    reporter.onEnd({ status: 'failed' })
    new Reporter().onEnd({ status: 'timedout' })
  } finally {
    process.stdout.write = originalWrite
  }

  assert.match(output, /^\[HOSTED-CANARY\] AUTH-01 failed$/m)
  assert.match(output, /^\[HOSTED-CANARY\] HARNESS failed$/m)
  assert.match(output, /^\[HOSTED-CANARY\] SUMMARY failed pass=0 fail=1$/m)
  assert.match(output, /^\[HOSTED-CANARY\] SUMMARY timedout pass=0 fail=0$/m)
  for (const value of leakedValues) assert.doesNotMatch(output, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('safe launcher requires zero args, a complete ordered transcript and fixed reporter lines', async () => {
  const {
    buildHostedCanaryChildEnv,
    createChildLifecycle,
    hostedCanaryArgsAllowed,
    hostedCanaryAutomationEnvDetected,
    hostedCanaryUnsafeParentEnvDetected,
    hostedCanaryTranscriptIsComplete,
    sanitizeHostedCanaryLine,
  } = await import(`${LAUNCHER_URL.href}?test=${Math.random()}`)
  assert.equal(
    sanitizeHostedCanaryLine('[HOSTED-CANARY] DEDUPE-01 passed'),
    '[HOSTED-CANARY] DEDUPE-01 passed',
  )
  assert.equal(
    sanitizeHostedCanaryLine('[HOSTED-CANARY] SUMMARY failed pass=4 fail=1'),
    '[HOSTED-CANARY] SUMMARY failed pass=4 fail=1',
  )
  for (const unsafe of [
    'actor@example.invalid',
    `uuid=${IDS.a}`,
    'Error: private message body',
    'https://example.invalid/?token=sensitive',
    '[HOSTED-CANARY] UNKNOWN failed actor@example.invalid',
  ]) assert.equal(sanitizeHostedCanaryLine(unsafe), null)

  assert.equal(hostedCanaryArgsAllowed([]), true)
  assert.equal(hostedCanaryArgsAllowed(['--list']), false)
  assert.equal(hostedCanaryArgsAllowed(['-g', 'FAIL-01']), false)
  assert.equal(hostedCanaryArgsAllowed(['FAIL-01']), false)
  assert.equal(hostedCanaryArgsAllowed(['--reporter=line']), false)
  assert.equal(hostedCanaryArgsAllowed(['--output', '/tmp/leak']), false)
  assert.equal(hostedCanaryArgsAllowed(['--trace=on']), false)
  assert.equal(hostedCanaryArgsAllowed(['--workers=4']), false)
  assert.equal(hostedCanaryAutomationEnvDetected({}), false)
  for (const automationEnv of [
    { CI: '1' },
    { CI: 'false' },
    { GITHUB_ACTIONS: '1' },
    { GITHUB_ACTIONS: 'false' },
    { RUNNER_OS: 'macOS' },
    { GITLAB_JOB_ID: '123' },
    { TF_BUILD: 'True' },
  ]) assert.equal(hostedCanaryAutomationEnvDetected(automationEnv), true)
  assert.equal(hostedCanaryUnsafeParentEnvDetected({}), false)
  for (const unsafeParentEnv of [
    { PLAYWRIGHT_BROWSERS_PATH: '/tmp/hostile-browser-cache' },
    { PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: 'ubuntu22.04-x64' },
    { PLAYWRIGHT_MCP_EXECUTABLE_PATH: '/tmp/hostile-browser' },
    { NODE_OPTIONS: '--require=/tmp/hostile.cjs' },
    { NODE_PATH: '/tmp/hostile-modules' },
    { NODE_EXTRA_CA_CERTS: '/tmp/hostile.pem' },
    { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { PWDEBUG: '1' },
  ]) assert.equal(
    hostedCanaryUnsafeParentEnvDetected(unsafeParentEnv),
    true,
  )
  class GracefulFakeChild extends EventEmitter {
    pid = 987_654_321
    signals = []

    kill(signal) {
      this.signals.push(signal)
      queueMicrotask(() => this.emit('close', 130, 'SIGINT'))
      return true
    }
  }
  const gracefulChild = new GracefulFakeChild()
  const gracefulLifecycle = createChildLifecycle(gracefulChild)
  await gracefulLifecycle.stop()
  assert.deepEqual(gracefulChild.signals, ['SIGINT'])

  const exactTranscript = [
    '[HOSTED-CANARY] AUTH-01 passed',
    '[HOSTED-CANARY] AUTH-02 passed',
    '[HOSTED-CANARY] RLS-01 passed',
    '[HOSTED-CANARY] FAIL-01 passed',
    '[HOSTED-CANARY] DEDUPE-01 passed',
    '[HOSTED-CANARY] SWITCH-01 passed',
    '[HOSTED-CANARY] BLOCK-01 passed',
    '[HOSTED-CANARY] NOTIFY-01 passed',
    '[HOSTED-CANARY] SCALE-01 passed',
    '[HOSTED-CANARY] LIFE-01 passed',
    '[HOSTED-CANARY] SUMMARY passed pass=10 fail=0',
  ]
  assert.equal(hostedCanaryTranscriptIsComplete(exactTranscript), true)
  for (const invalidTranscript of [
    exactTranscript.slice(0, -1),
    [...exactTranscript, '[HOSTED-CANARY] HARNESS failed'],
    [exactTranscript[1], exactTranscript[0], ...exactTranscript.slice(2)],
    [...exactTranscript.slice(0, 2), exactTranscript[1], ...exactTranscript.slice(3)],
    exactTranscript.map(line => line.replace('RLS-01 passed', 'RLS-01 failed')),
    exactTranscript.map(line => line.replace('pass=10 fail=0', 'pass=9 fail=0')),
  ]) assert.equal(hostedCanaryTranscriptIsComplete(invalidTranscript), false)

  const childEnv = buildHostedCanaryChildEnv({
    PATH: '/usr/bin:/bin',
    HOME: '/safe-home',
    LANG: 'en_US.UTF-8',
    CAACI_HOSTED_CANARY_MODE: 'realtime-staging',
    CAACI_HOSTED_CANARY_PROJECT_REF: PROJECT_REF,
    CAACI_HOSTED_CANARY_MANIFEST_PROOF: 'operator-must-not-forward',
    CAACI_HOSTED_CANARY_UNKNOWN: 'operator-must-not-forward',
    CAACI_HOSTED_CANARY_BROWSER_EXECUTABLE: '/tmp/hostile-browser',
    NODE_OPTIONS: '--require=/tmp/hostile.cjs',
    NODE_EXTRA_CA_CERTS: '/tmp/hostile.pem',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    HTTPS_PROXY: 'http://proxy.invalid',
    DEBUG: '*',
    PWDEBUG: '1',
    AWS_ACCESS_KEY_ID: 'must-not-forward',
    GOOGLE_APPLICATION_CREDENTIALS: '/tmp/cloud-key.json',
    VERCEL_TOKEN: 'must-not-forward',
    PLAYWRIGHT_BROWSERS_PATH: '/tmp/hostile-playwright-cache',
  }, '/private/run-root', '/private/run-root/output', '/trusted/chromium', IDS.run)

  assert.equal(childEnv.PATH, '/usr/bin:/bin')
  assert.equal(childEnv.HOME, '/private/run-root')
  assert.equal(childEnv.USERPROFILE, '/private/run-root')
  assert.equal(childEnv.XDG_CONFIG_HOME, '/private/run-root/config')
  assert.equal(childEnv.CAACI_HOSTED_CANARY_MODE, 'realtime-staging')
  assert.equal(childEnv.CAACI_HOSTED_CANARY_PROJECT_REF, PROJECT_REF)
  assert.equal(childEnv.CAACI_HOSTED_CANARY_LAUNCHER, 'v2')
  assert.equal(childEnv.CAACI_HOSTED_CANARY_RUN_ID, IDS.run)
  assert.equal(
    childEnv.CAACI_HOSTED_CANARY_BROWSER_EXECUTABLE,
    '/trusted/chromium',
  )
  assert.equal(
    childEnv.CAACI_HOSTED_CANARY_OUTPUT_DIR,
    '/private/run-root/output',
  )
  assert.equal(childEnv.TMPDIR, '/private/run-root')
  assert.equal(childEnv.TMP, '/private/run-root')
  assert.equal(childEnv.TEMP, '/private/run-root')
  for (const forbidden of [
    'CAACI_HOSTED_CANARY_MANIFEST_PROOF',
    'CAACI_HOSTED_CANARY_UNKNOWN',
    'NODE_OPTIONS',
    'NODE_EXTRA_CA_CERTS',
    'NODE_TLS_REJECT_UNAUTHORIZED',
    'HTTPS_PROXY',
    'DEBUG',
    'PWDEBUG',
    'AWS_ACCESS_KEY_ID',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'VERCEL_TOKEN',
    'PLAYWRIGHT_BROWSERS_PATH',
  ]) assert.equal(Object.hasOwn(childEnv, forbidden), false, forbidden)

  for (const [key, value] of [
    ['CI', '1'],
    ['RUNNER_OS', 'macOS'],
    ['PLAYWRIGHT_BROWSERS_PATH', '/tmp/hostile-browser-cache'],
    ['PLAYWRIGHT_HOST_PLATFORM_OVERRIDE', 'ubuntu22.04-x64'],
  ]) {
    const launched = spawnSync(
      process.execPath,
      [fileURLToPath(LAUNCHER_URL)],
      {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH || '',
          [key]: value,
        },
        timeout: 5_000,
      },
    )
    assert.equal(launched.status, 1, key)
    assert.equal(launched.signal, null, key)
    assert.equal(
      launched.stdout,
      '[HOSTED-CANARY] HARNESS failed\n',
      key,
    )
    assert.equal(launched.stderr, '', key)
  }
})

test('hosted Playwright surface is separate, manual, no-artifact and deny-by-default', async () => {
  const [
    config,
    targets,
    globalSetup,
    network,
    sdkBoundary,
    launcher,
    fixtures,
    spec,
    reporter,
    pkg,
    workflow,
    defaultConfig,
    vercelIgnore,
  ] = await Promise.all([
    source('playwright.hosted-realtime.config.ts'),
    source('e2e/hosted/approved-targets.ts'),
    source('e2e/hosted/global-setup.ts'),
    source('e2e/hosted/network-boundary.ts'),
    source('e2e/hosted/sdk-boundary.ts'),
    source('e2e/hosted/safe-launcher.mjs'),
    source('e2e/hosted/fixtures.ts'),
    source('e2e/hosted/realtime-reliability.spec.ts'),
    source('e2e/hosted/privacy-reporter.ts'),
    source('package.json'),
    source('../.github/workflows/ci.yml'),
    source('playwright.config.ts'),
    source('../.vercelignore'),
  ])

  assert.match(targets, /APPROVED_HOSTED_REALTIME_TARGETS[\s\S]*Object\.freeze\(\[\]\)/)
  assert.match(config, /testDir:\s*['"]\.\/e2e\/hosted['"]/)
  assert.match(config, /testMatch:\s*['"]realtime-reliability\.spec\.ts['"]/)
  assert.match(config, /globalSetup:/)
  assert.match(config, /globalTimeout:\s*20\s*\*\s*60\s*\*\s*1_000/)
  assert.match(config, /workers:\s*1/)
  assert.match(config, /retries:\s*0/)
  assert.match(config, /fullyParallel:\s*false/)
  assert.match(config, /forbidOnly:\s*true/)
  assert.match(config, /preserveOutput:\s*['"]never['"]/)
  assert.match(config, /screenshot:\s*['"]off['"]/)
  assert.match(config, /trace:\s*['"]off['"]/)
  assert.match(config, /video:\s*['"]off['"]/)
  assert.match(config, /serviceWorkers:\s*['"]block['"]/)
  assert.doesNotMatch(config, /webServer\s*:/)
  assert.doesNotMatch(config, /recordHar|storageState|html|blob|junit/)
  assert.match(config, /CAACI_HOSTED_CANARY_OUTPUT_DIR/)
  assert.match(config, /caaci-hosted-realtime-run-/)
  assert.match(config, /dirname\(outputDir\)\s*!==\s*isolatedRunRoot/)
  assert.match(config, /CAACI_HOSTED_CANARY_BROWSER_EXECUTABLE/)
  assert.match(config, /assertHostedBrowserExecutable/)
  assert.match(
    config,
    /launchOptions:\s*\{\s*executablePath:\s*browserExecutable,\s*args:\s*\[['"]--no-proxy-server['"]\],\s*\}/,
  )

  assert.match(globalSetup, /fetchAndVerifyHostedDeploymentManifest/)
  assert.match(globalSetup, /fetchAndVerifyHostedEntryDocument/)
  assert.match(globalSetup, /fetchAndVerifyHostedAssets/)
  assert.doesNotMatch(globalSetup, /createClient|signInWithPassword|password|email/)
  assert.match(fixtures, /context\.route\(/)
  assert.match(fixtures, /context\.routeWebSocket\(/)
  assert.match(fixtures, /websocketRoute\.protocols\(\)\.length\s*!==\s*0/)
  assert.match(
    fixtures,
    /serverRoute\.close\(\{\s*code:\s*1000,\s*reason:\s*['"]client-close['"]\s*\}\)/,
  )
  assert.match(fixtures, /route\.abort\(['"]blockedbyclient['"]\)/)
  assert.match(fixtures, /hostedActorMetadataMatches/)
  assert.match(fixtures, /assertHostedEnvironmentSentinel/)
  assert.match(fixtures, /fetchHostedEnvironmentSentinel/)
  assert.match(fixtures, /createHostedGuardedFetch/)
  assert.match(fixtures, /hosted_realtime_canary_cleanup_v2/)
  assert.match(fixtures, /hosted_realtime_canary_insert_scale_batch/)
  assert.match(fixtures, /hosted_realtime_canary_insert_notification/)
  assert.match(fixtures, /hosted_realtime_canary_set_block/)
  assert.match(fixtures, /createHostedDeniedProbeClient/)
  assert.match(fixtures, /createHostedRunnerIds/)
  assert.match(fixtures, /hostedReadReceiptRequestMockable/)
  assert.match(fixtures, /hostedBrowserRequestHeadersAllowed/)
  assert.match(fixtures, /issuedAccessTokens/)
  assert.match(fixtures, /issuedRefreshTokenByAccessToken/)
  assert.match(fixtures, /HOSTED_DISABLED_REFRESH_TOKEN/)
  assert.match(fixtures, /activePasswordTokenRoutes/)
  assert.match(fixtures, /browserAuthClosed/)
  assert.match(fixtures, /attachedPages\s*=\s*new WeakSet<Page>\(\)/)
  assert.match(
    fixtures,
    /context\.on\(['"]page['"],\s*openedPage\s*=>\s*network\?\.attachPage\(openedPage\)\)/,
  )
  assert.match(fixtures, /decodeHostedPhoenixBroadcastPush/)
  assert.match(fixtures, /hostedRealtimeBroadcastPushAllowed/)
  assert.match(fixtures, /hostedRealtimeOutboundTextFrameAllowed/)
  assert.match(
    fixtures,
    /const revocationTargets = new Set\(issuedAccessTokens\)[\s\S]*revocationTargets\.add\(expectedAccessToken\)/,
  )
  assert.match(fixtures, /revokeIssuedSessions/)
  assert.match(fixtures, /approvedAsset\.sha256/)
  assert.match(fixtures, /closedPromise/)
  assert.match(fixtures, /browser\.newContext\(/)
  assert.match(
    sdkBoundary,
    /protocols\s*!==\s*undefined[\s\S]*super\(address\)/,
  )
  assert.match(
    sdkBoundary,
    /override close\(_code\?: number, _reason\?: string\): void \{\s*super\.close\(1000, ['"]client-close['"]\)/,
  )
  const activeTokenCaptureIndex = fixtures.indexOf(
    'issuedAccessTokens.add(accessToken)',
  )
  const sanitizedTokenFulfillIndex = fixtures.indexOf(
    'body: JSON.stringify(sanitizedPayload)',
  )
  assert.ok(
    activeTokenCaptureIndex >= 0
      && sanitizedTokenFulfillIndex >= 0
      && activeTokenCaptureIndex < sanitizedTokenFulfillIndex,
  )
  const teardownGateIndex = fixtures.lastIndexOf('boundary.beginTeardown()')
  const contextCloseIndex = fixtures.lastIndexOf(
    'await actor.context.close()',
  )
  const issuedSessionRevokeIndex = fixtures.lastIndexOf(
    'await boundary.revokeIssuedSessions(expectedAccessToken)',
  )
  assert.ok(
    teardownGateIndex >= 0
      && contextCloseIndex > teardownGateIndex
      && issuedSessionRevokeIndex > contextCloseIndex,
  )
  const sentinelCallIndex = fixtures.indexOf(
    'const sentinel = await fetchHostedEnvironmentSentinel',
  )
  const firstCredentialIndex = fixtures.indexOf(
    'sdkActors.push(await createSdkActor',
  )
  assert.ok(
    sentinelCallIndex >= 0
      && firstCredentialIndex >= 0
      && sentinelCallIndex < firstCredentialIndex,
  )
  assert.match(spec, /faultRealtimeTopic/)
  assert.match(spec, /directSeeds/)
  assert.match(spec, /directIncrements/)
  assert.match(spec, /conversationIncrementMessageMatches/)
  assert.match(spec, /conversationIncrementResponseTimes/)
  assert.match(spec, /conversationDirectIncrementAttempts/)
  assert.match(spec, /waitForConversationReadsIdle/)
  assert.match(
    spec,
    /deniedOutcomes\.some\(status\s*=>\s*status\s*!==\s*['"]CHANNEL_ERROR['"]\)/,
  )
  assert.match(
    spec,
    /deniedStatuses\.some\(statuses\s*=>\s*statuses\.includes\(['"]SUBSCRIBED['"]\)\)/,
  )
  assert.match(spec, /snapshotControl/)
  assert.match(
    spec,
    /setExpectedMessages\(\[snapshotControl\.id,\s*inserted\.id\]\)/,
  )
  assert.match(spec, /actorActiveSocketCount/)
  assert.match(spec, /positiveChannel/)
  assert.match(spec, /topicMessageCount/)
  assert.match(spec, /maxRedirects:\s*0/)
  assert.match(spec, /AUTH-01/)
  assert.match(spec, /AUTH-02/)
  assert.match(spec, /RLS-01/)
  assert.match(spec, /FAIL-01/)
  assert.match(spec, /DEDUPE-01/)
  assert.match(spec, /SWITCH-01/)
  assert.match(spec, /BLOCK-01/)
  assert.match(spec, /NOTIFY-01/)
  assert.match(spec, /SCALE-01/)
  assert.match(spec, /LIFE-01/)
  assert.match(spec, /runBlockDirection\(a\)[\s\S]*runBlockDirection\(b\)/)
  assert.match(
    spec,
    /waitForConversationReadsIdle\(conversationId\)[\s\S]{0,500}conversationReadObservation[\s\S]{0,500}delay\(3_500\)/,
  )
  assert.match(spec, /\['random', 'global', 'user'\]/)
  assert.match(spec, /JSON\.stringify\(conversation\.pageSizes\)[\s\S]*\[50, 1\]/)
  assert.match(spec, /JSON\.stringify\(inbox\.pageSizes\)[\s\S]*\[25, 5\]/)
  assert.match(sdkBoundary, /HostedCanaryWriteRegistry/)
  assert.match(sdkBoundary, /completedV2RunShapeMatches/)
  assert.match(sdkBoundary, /HOSTED_SCALE_MESSAGE_COUNT\s*=\s*51/)
  assert.match(sdkBoundary, /hostedScaleReadRequestAllowed/)
  assert.match(sdkBoundary, /hostedSdkRequestAllowed/)
  assert.match(sdkBoundary, /revokeExactHostedSession/)
  assert.match(sdkBoundary, /createHostedGuardedWebSocketTransport/)
  assert.match(launcher, /sanitizeHostedCanaryLine/)
  assert.match(launcher, /mkdtemp/)
  assert.match(launcher, /hostedCanaryTranscriptIsComplete/)
  assert.match(launcher, /createRequire/)
  assert.match(launcher, /chromium\.executablePath\(\)/)
  assert.match(launcher, /fsConstants\.X_OK/)
  assert.match(launcher, /CAACI_HOSTED_CANARY_BROWSER_EXECUTABLE/)
  assert.match(launcher, /open\(lockPath,\s*['"]wx['"]/)
  assert.match(launcher, /TMPDIR/)
  assert.match(launcher, /process\.on\(['"]SIGINT['"]/)
  assert.match(launcher, /process\.on\(['"]SIGTERM['"]/)
  assert.doesNotMatch(launcher, /process\.once\(['"]SIG(?:INT|TERM)['"]/)
  assert.doesNotMatch(launcher, /PLAYWRIGHT_BROWSERS_PATH/)
  assert.match(launcher, /CHILD_GRACEFUL_STOP_MS\s*=\s*150_000/)
  const gracefulSigintIndex = launcher.indexOf("signalCli('SIGINT')")
  const processGroupTermIndex = launcher.indexOf(
    "signalProcessTree('SIGTERM')",
  )
  assert.ok(
    gracefulSigintIndex >= 0
      && processGroupTermIndex > gracefulSigintIndex,
  )
  assert.match(launcher, /SIGTERM/)
  assert.match(launcher, /SIGKILL/)
  assert.match(launcher, /detached:\s*process\.platform\s*!==\s*['"]win32['"]/)
  assert.match(launcher, /XDG_CONFIG_HOME/)
  assert.match(launcher, /recursive:\s*true,\s*force:\s*true/)

  const hostedSources = [
    config,
    globalSetup,
    network,
    sdkBoundary,
    launcher,
    fixtures,
    spec,
    reporter,
  ].join('\n')
  assert.doesNotMatch(hostedSources, /console\.(?:log|error|warn|info)|page\.screenshot|tracing\.start|storageState\s*\(|launchPersistentContext|recordHar/)
  assert.doesNotMatch(hostedSources, /SUPABASE_(?:SECRET|SERVICE_ROLE)|ADMIN_TOKEN|OPENAI_API_KEY|RESEND_API_KEY|SENTRY_AUTH_TOKEN|WECHAT_APPSECRET/)
  assert.match(reporter, /HOSTED-CANARY/)
  for (const scenario of [
    'AUTH-01',
    'AUTH-02',
    'RLS-01',
    'FAIL-01',
    'DEDUPE-01',
    'SWITCH-01',
    'BLOCK-01',
    'NOTIFY-01',
    'SCALE-01',
    'LIFE-01',
  ]) assert.match(reporter, new RegExp(`['"]${scenario}['"]`))
  assert.doesNotMatch(reporter, /result\.error|result\.errors|test\.title\b/)

  const parsedPackage = JSON.parse(pkg)
  assert.equal(
    parsedPackage.scripts['smoke:hosted-realtime'],
    'node e2e/hosted/safe-launcher.mjs',
  )
  assert.doesNotMatch(workflow, /smoke:hosted-realtime|playwright\.hosted-realtime/)
  assert.doesNotMatch(defaultConfig, /e2e\/hosted|hosted-realtime/)
  assert.match(vercelIgnore, /^app\/e2e\/\*\*$/m)
  assert.match(vercelIgnore, /^app\/playwright\.hosted-realtime\.config\.ts$/m)
})
