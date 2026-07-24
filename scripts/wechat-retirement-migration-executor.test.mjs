import assert from 'node:assert/strict'
import { createHash, X509Certificate } from 'node:crypto'
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rootCertificates } from 'node:tls'
import test from 'node:test'
import {
  assertExactApply,
  assertExactDryRun,
  boundedChildEnv,
  boundedDatabaseUrl,
  executeRelease,
  historicalExecutionGuard,
  parseArguments,
  pendingMigrationNames,
  productionGuardedRetirementMigration,
  productionLedgerGuardSql,
  productionLedgerProjection,
  redactCliOutput,
  transactionNormalizedRetirementMigration,
} from './wechat-retirement-migration-executor.mjs'
import {
  boundedRehearsalEnvironment,
} from './wechat-retirement-postgres-rehearsal.mjs'

const MIGRATION =
  '20260718140000_retire_wechat_password_credentials'
const REVIEWED_URL =
  'postgresql://postgres.lfhvgprfphyfvhidegum@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
const TARGET_FILE = `${MIGRATION}.sql`

const sha256 = value => createHash('sha256').update(value).digest('hex')
const md5 = value => createHash('md5').update(value).digest('hex')

test('disposable rehearsal children inherit no ambient PG or Node controls', () => {
  const env = boundedRehearsalEnvironment('/tmp/reviewed-rehearsal')
  assert.deepEqual(Object.keys(env).sort(), [
    'LANG',
    'LC_ALL',
    'NO_COLOR',
    'TERM',
    'TMPDIR',
  ])
  assert.equal(env.TMPDIR, '/tmp/reviewed-rehearsal')
  for (const forbidden of [
    'PGHOST', 'PGHOSTADDR', 'PGOPTIONS', 'PGPASSFILE', 'PGSERVICE',
    'PGSERVICEFILE', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'PATH', 'HOME',
  ]) {
    assert.equal(env[forbidden], undefined)
  }
})

async function reviewedMigrationInputs() {
  const [manifest, target] = await Promise.all([
    readFile(new URL('../supabase/migrations/manifest.sha256', import.meta.url), 'utf8'),
    readFile(new URL(`../supabase/migrations/${TARGET_FILE}`, import.meta.url)),
  ])
  const entries = manifest.split(/\r?\n/)
    .map(line => line.match(/^([0-9a-f]{64})  ([A-Za-z0-9_.-]+\.sql)$/))
    .filter(Boolean)
    .map(match => [match[2], match[1]])
  return { manifest, target, entries }
}

test('bounded child environment is a minimal allowlist and never sends the DB secret to version', () => {
  const base = {
    SAFE_MARKER: 'must-not-leak',
    PGHOSTADDR: '203.0.113.7',
    PGPASSFILE: '/tmp/attacker',
    PGOPTIONS: '-c lock_timeout=0',
    SUPABASE_DB_PASSWORD: 'operator-secret',
  }
  const env = boundedChildEnv(base, { temporaryDirectory: '/tmp/reviewed' })
  assert.deepEqual(Object.keys(env).sort(), [
    'LANG',
    'LC_ALL',
    'NO_COLOR',
    'PGOPTIONS',
    'SUPABASE_DB_PASSWORD',
    'TERM',
    'TMPDIR',
  ])
  assert.equal(env.SUPABASE_DB_PASSWORD, 'operator-secret')
  assert.equal(env.PGOPTIONS, '-c lock_timeout=5s -c statement_timeout=2min')
  assert.equal(env.PGHOSTADDR, undefined)
  assert.equal(env.SAFE_MARKER, undefined)

  const versionEnv = boundedChildEnv(base, { includePassword: false })
  assert.equal(versionEnv.SUPABASE_DB_PASSWORD, undefined)
})

test('bounded database URL pins exact authority and adds only reviewed startup parameters', () => {
  const bounded = new URL(boundedDatabaseUrl(REVIEWED_URL, '/tmp/reviewed-ca.crt'))
  assert.equal(bounded.password, '')
  assert.equal(bounded.hostname, 'aws-1-us-east-1.pooler.supabase.com')
  assert.equal(bounded.port, '5432')
  assert.equal(bounded.searchParams.get('sslmode'), 'verify-full')
  assert.equal(bounded.searchParams.get('sslrootcert'), '/tmp/reviewed-ca.crt')
  assert.equal(bounded.searchParams.get('connect_timeout'), '10')
  assert.equal(
    bounded.searchParams.get('options'),
    '-c lock_timeout=5s -c statement_timeout=2min',
  )

  const hostileInputs = [
    'postgresql://postgres.lfhvgprfphyfvhidegum:secret@aws-1-us-east-1.pooler.supabase.com:5432/postgres',
    'postgresql://postgres.other@aws-1-us-east-1.pooler.supabase.com:5432/postgres',
    'postgresql://postgres.lfhvgprfphyfvhidegum@attacker.pooler.supabase.com:5432/postgres',
    'postgresql://postgres.lfhvgprfphyfvhidegum@aws-1-us-east-1.pooler.supabase.com:6543/postgres',
    `${REVIEWED_URL}?host=127.0.0.1`,
    `${REVIEWED_URL}?hostaddr=203.0.113.7`,
    `${REVIEWED_URL}?service=evil`,
    `${REVIEWED_URL}?password=AUDIT_SENTINEL`,
    `${REVIEWED_URL}?user=other`,
    `${REVIEWED_URL}?dbname=other`,
    `${REVIEWED_URL}?sslrootcert=/tmp/evil`,
    `${REVIEWED_URL}#fragment`,
  ]
  for (const input of hostileInputs) {
    assert.throws(
      () => boundedDatabaseUrl(input, '/tmp/reviewed-ca.crt'),
      /invalid_reviewed_pooler_url/,
    )
  }
  assert.throws(
    () => boundedDatabaseUrl(REVIEWED_URL, 'relative-ca.crt'),
    /invalid_reviewed_pooler_url/,
  )
})

test('dry-run parser accepts only the official v2.95.4 one-migration plan block', () => {
  const valid = {
    stderr: [
      'DRY RUN: migrations will *not* be pushed to the database.',
      'Would push these migrations:',
      ` • \u001b[1m${MIGRATION}.sql\u001b[0m`,
      '',
    ].join('\n'),
    stdout: 'Finished supabase db push.\n',
  }
  assert.deepEqual(pendingMigrationNames(valid), [MIGRATION])
  assert.deepEqual(assertExactDryRun(valid), [MIGRATION])

  assert.throws(
    () => assertExactDryRun({
      stderr: `warning mentions ${MIGRATION}.sql but has no plan block`,
      stdout: 'Finished supabase db push.\n',
    }),
    /dry_run_marker_missing/,
  )
  assert.throws(
    () => assertExactDryRun({
      stderr: valid.stderr.replace(
        `${MIGRATION}.sql`,
        `${MIGRATION}.sql\n • 089_unreviewed_extra.sql`,
      ),
      stdout: valid.stdout,
    }),
    /dry_run_not_exactly_retirement/,
  )
  assert.throws(
    () => assertExactDryRun({
      stderr: 'DRY RUN: migrations will *not* be pushed to the database.\n',
      stdout: 'Remote database is up to date.\n',
    }),
    /dry_run_did_not_plan_retirement/,
  )
})

test('apply parser requires the exact target and completion markers', () => {
  assert.doesNotThrow(() => assertExactApply({
    stderr: `Applying migration ${MIGRATION}.sql...\n`,
    stdout: 'Finished supabase db push.\n',
  }))
  assert.throws(() => assertExactApply({
    stderr: 'Applying migration 20260723120000_unreviewed.sql...\n',
    stdout: 'Finished supabase db push.\n',
  }), /apply_marker_not_exactly_retirement/)
  assert.throws(() => assertExactApply({
    stderr: [
      `Applying migration ${MIGRATION}.sql...`,
      'Applying migration 20260723120000_unreviewed.sql...',
      '',
    ].join('\n'),
    stdout: 'Finished supabase db push.\n',
  }), /apply_marker_not_exactly_retirement/)
})

test('Production ledger projection and guarded target are exact, atomic, and digest pinned', async () => {
  const { target, entries } = await reviewedMigrationInputs()
  const normalized = transactionNormalizedRetirementMigration(target)
  assert.equal(sha256(target), 'f2e3653df0be6e83b3d7d904696c2c4e088ae2df061332fb5108ad21ce4a2a32')
  assert.equal(sha256(normalized), 'b5f07a4b98b4ca5df4bd32cfbc10c7e005ee969066f0d94f2bb4c8eae0558044')
  assert.equal((target.toString().match(/^BEGIN;$/gm) || []).length, 1)
  assert.equal((target.toString().match(/^COMMIT;$/gm) || []).length, 1)
  assert.doesNotMatch(normalized.toString(), /^(?:BEGIN|COMMIT);$/m)

  const projection = productionLedgerProjection(entries)
  assert.equal(projection.length, 109)
  assert.equal(new Set(projection.map(entry => entry.name)).size, 109)
  assert.equal(new Set(projection.map(entry => entry.name.split('_')[0])).size, 109)
  assert.equal(projection.filter(entry => entry.canonicalName === TARGET_FILE).length, 1)
  assert.equal(projection.filter(entry => entry.canonicalName !== TARGET_FILE).length, 108)
  for (const canonical of [
    '046_currency_exchange_daily_cap.sql',
    '20260722145042_harden_last_active_owner_revoke.sql',
    '20260722152000_harden_admin_invalid_auth_amplification.sql',
    '20260722161200_protect_admin_owner_presentation_signal.sql',
  ]) {
    assert.equal(projection.some(entry => entry.name === canonical), false)
  }
  for (const alias of [
    '20260610051549_currency_exchange_daily_cap.sql',
    '20260611074306_meetups_revoke_anon_exec.sql',
    '20260722163412_20260722145042_harden_last_active_owner_revoke.sql',
    '20260722163454_20260722152000_harden_admin_invalid_auth_amplification.sql',
    '20260722163545_20260722161200_protect_admin_owner_presentation_signal.sql',
  ]) {
    assert.equal(projection.some(entry => entry.name === alias), true)
  }

  const guard = productionLedgerGuardSql(projection).toString()
  const guarded = productionGuardedRetirementMigration(target, projection)
  assert.equal(sha256(guarded), '49bb04be3bc12a84a5cd45babc5d9b617c668a13d9feb1e56609964e1bbc7d54')
  assert.ok(guarded.subarray(guarded.length - normalized.length).equals(normalized))
  assert.match(guard, /SET LOCAL lock_timeout = '5s'/)
  assert.match(guard, /SET LOCAL statement_timeout = '2min'/)
  assert.ok(guard.indexOf('SET LOCAL lock_timeout') < guard.indexOf('LOCK TABLE'))
  assert.match(guard, /IN SHARE ROW EXCLUSIVE MODE/)
  assert.match(guard, /FULL OUTER JOIN supabase_migrations\.schema_migrations/)
  assert.match(guard, /unique_version_count <> 108/)
  assert.match(guard, /unique_identity_count <> 108/)
  const guardIdentityPairs = [...guard.matchAll(
    /\('([0-9]{3}|[0-9]{14})', '([A-Za-z0-9_.-]+)'\)/g,
  )]
  assert.equal(guardIdentityPairs.length, 108)
  assert.equal(
    new Set(guardIdentityPairs.map(match => `${match[1]}|${match[2]}`)).size,
    108,
  )
  assert.equal(
    md5(guardIdentityPairs
      .map(match => `${match[1]}|${match[2]}\n`)
      .sort()
      .join('')),
    'ec5c0180e406d6ee92bebfaf85e8b2f3',
  )
  assert.match(guard, /\('001', 'initial_schema'\)/)
  assert.match(guard, /\('20260722163545', '20260722161200_protect_admin_owner_presentation_signal'\)/)
  assert.doesNotMatch(guard, /20260718140000.*retire_wechat_password_credentials/)
  assert.doesNotMatch(guarded.toString(), /^(?:BEGIN|COMMIT);$/m)

  const executionEntries = projection.map(entry => [
    entry.name,
    entry.canonicalName === TARGET_FILE
      ? sha256(guarded)
      : sha256(historicalExecutionGuard(entry.name)),
  ])
  assert.equal(
    sha256(executionEntries.map(([name, digest]) => `${digest}  ${name}\n`).join('')),
    '9719ea3b5527f0371b6dd08bb0144a356c5c1451193cbc29cdf5c2db60de3b52',
  )
})

test('production target, flags, and destructive confirmation are exact and unique', () => {
  const ref = 'lfhvgprfphyfvhidegum'
  assert.deepEqual(parseArguments(['--project-ref', ref]), {
    apply: false,
    projectRef: ref,
  })
  assert.deepEqual(parseArguments([
    '--project-ref', ref,
    '--apply',
    '--confirm', 'APPLY_WECHAT_RETIREMENT_20260718140000',
  ]), {
    apply: true,
    projectRef: ref,
  })
  assert.throws(() => parseArguments([]), /exact_production_project_ref_required/)
  assert.throws(
    () => parseArguments(['--project-ref', ref, '--apply']),
    /apply_requires_confirmation/,
  )
  assert.throws(
    () => parseArguments(['--project-ref', ref, '--project-ref', ref]),
    /duplicate_argument/,
  )
  assert.throws(
    () => parseArguments(['--project-ref', ref, '--shell', 'bash']),
    /unknown_argument/,
  )
})

test('CLI transcript redaction removes raw, encoded, URI, and query secrets', () => {
  const secret = 's3cr et/@?'
  const output = redactCliOutput(
    `raw=${secret} encoded=${encodeURIComponent(secret)} ` +
      'postgresql://postgres.project:leaked@db.example/postgres ' +
      'postgresql://db.example/postgres?password=leaked&sslmode=require',
    secret,
  )
  assert.equal(output.includes(secret), false)
  assert.equal(output.includes(encodeURIComponent(secret)), false)
  assert.equal(output.includes(':leaked@'), false)
  assert.equal(output.includes('password=leaked'), false)
})

test('fake CLI dry run proves the exact guarded Production ledger projection, minimal env, redaction, and cleanup', async () => {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), 'caaci-fake-supabase-'))
  const fakeCli = join(fixtureDirectory, 'supabase')
  const fakeCa = join(fixtureDirectory, 'supabase-ca.crt')
  const sentinel = 'AUDIT_DB_PASSWORD_SENTINEL'
  const ambient = 'AUDIT_AMBIENT_SECRET_SENTINEL'
  const fakeSource = `#!${process.execPath}
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const dbUrl = new URL(args[3] || 'https://invalid.example')
if (args.length !== 6 || args[0] !== 'db' || args[1] !== 'push' ||
    args[2] !== '--db-url' || args[4] !== '--include-all' || args[5] !== '--dry-run' ||
    dbUrl.hostname !== 'aws-1-us-east-1.pooler.supabase.com' ||
    dbUrl.searchParams.get('sslmode') !== 'verify-full' ||
    dbUrl.searchParams.get('options') !== '-c lock_timeout=5s -c statement_timeout=2min' ||
    dbUrl.password) process.exit(91)
const config = fs.readFileSync(path.join(process.cwd(), 'supabase/config.toml'), 'utf8')
const migrations = fs.readdirSync(path.join(process.cwd(), 'supabase/migrations'))
  .filter(name => name.endsWith('.sql'))
const target = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/${TARGET_FILE}'), 'utf8')
const historical = migrations.filter(name => name !== '${TARGET_FILE}')
if (migrations.length !== 109 || historical.length !== 108 ||
    config.includes('[db.vault]') || !config.includes('enabled = false') ||
    !target.includes('IN SHARE ROW EXCLUSIVE MODE') ||
    !target.includes(\"SET LOCAL lock_timeout = '5s'\") ||
    /^BEGIN;$/m.test(target) || /^COMMIT;$/m.test(target) ||
    migrations.includes('046_currency_exchange_daily_cap.sql') ||
    !migrations.includes('20260610051549_currency_exchange_daily_cap.sql') ||
    !historical.every(name => fs.readFileSync(path.join(process.cwd(), 'supabase/migrations', name), 'utf8')
      .includes('unexpected_non_target_migration_execution'))) {
  process.exit(92)
}
if (process.env.AWS_SECRET_ACCESS_KEY) process.exit(93)
console.error('SECRET=' + process.env.SUPABASE_DB_PASSWORD)
console.error('WORKDIR=' + process.cwd())
console.error('DRY RUN: migrations will *not* be pushed to the database.')
console.error('Would push these migrations:')
console.error(' • ${MIGRATION}.sql')
console.log('Finished supabase db push.')
`
  await writeFile(fakeCli, fakeSource, { mode: 0o700 })
  await chmod(fakeCli, 0o700)
  const fakeCaPem = `${rootCertificates[0]}\n`
  await writeFile(fakeCa, fakeCaPem, { mode: 0o400 })
  await chmod(fakeCa, 0o400)
  const fakeDigest = createHash('sha256').update(await readFile(fakeCli)).digest('hex')
  const stdout = []
  const stderr = []
  try {
    const result = await executeRelease(
      ['--project-ref', 'lfhvgprfphyfvhidegum'],
      {
        baseEnv: {
          SUPABASE_DB_PASSWORD: sentinel,
          SUPABASE_DB_SSLROOTCERT: fakeCa,
          AWS_SECRET_ACCESS_KEY: ambient,
        },
        cliPath: fakeCli,
        expectedCliDigest: fakeDigest,
        expectedCaFingerprint256: new X509Certificate(fakeCaPem).fingerprint256,
        io: {
          stdout: value => stdout.push(value),
          stderr: value => stderr.push(value),
        },
      },
    )
    assert.equal(result.applied, false)
    const transcript = `${stdout.join('')}\n${stderr.join('')}`
    assert.equal(transcript.includes(sentinel), false)
    assert.equal(transcript.includes(ambient), false)
    assert.match(transcript, /SECRET=\[REDACTED\]/)
    const workdir = /WORKDIR=([^\n]+)/.exec(transcript)?.[1]
    assert.ok(workdir)
    await assert.rejects(() => access(workdir))
  } finally {
    await rm(fixtureDirectory, { recursive: true, force: true })
  }
})

test('fake CLI apply path is exactly two dry runs followed by one confirmed apply', async () => {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), 'caaci-fake-supabase-apply-'))
  const fakeCli = join(fixtureDirectory, 'supabase')
  const fakeCa = join(fixtureDirectory, 'supabase-ca.crt')
  const fakeSource = `#!${process.execPath}
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const statePath = path.join(process.cwd(), '.fake-cli-invocation-count')
const invocation = fs.existsSync(statePath) ? Number(fs.readFileSync(statePath, 'utf8')) + 1 : 1
fs.writeFileSync(statePath, String(invocation), { mode: 0o600 })
const dbUrl = new URL(args[3] || 'https://invalid.example')
const common = args.length === 6 && args[0] === 'db' && args[1] === 'push' &&
  args[2] === '--db-url' && args[4] === '--include-all' &&
  dbUrl.hostname === 'aws-1-us-east-1.pooler.supabase.com' &&
  dbUrl.searchParams.get('sslmode') === 'verify-full' && !dbUrl.password
if (!common) process.exit(81)
console.error('CALL=' + invocation + ':' + args[5])
if (invocation === 1 || invocation === 2) {
  if (args[5] !== '--dry-run') process.exit(82)
  console.error('DRY RUN: migrations will *not* be pushed to the database.')
  console.error('Would push these migrations:')
  console.error(' • ${MIGRATION}.sql')
  console.log('Finished supabase db push.')
} else if (invocation === 3) {
  if (args[5] !== '--yes') process.exit(83)
  console.error('Applying migration ${MIGRATION}.sql...')
  console.log('Finished supabase db push.')
} else {
  process.exit(84)
}
`
  await writeFile(fakeCli, fakeSource, { mode: 0o700 })
  await chmod(fakeCli, 0o700)
  const fakeCaPem = `${rootCertificates[0]}\n`
  await writeFile(fakeCa, fakeCaPem, { mode: 0o400 })
  await chmod(fakeCa, 0o400)
  const stdout = []
  const stderr = []
  try {
    const result = await executeRelease([
      '--project-ref', 'lfhvgprfphyfvhidegum',
      '--apply', '--confirm', 'APPLY_WECHAT_RETIREMENT_20260718140000',
    ], {
      baseEnv: {
        SUPABASE_DB_PASSWORD: 'apply-test-secret',
        SUPABASE_DB_SSLROOTCERT: fakeCa,
      },
      cliPath: fakeCli,
      expectedCliDigest: sha256(await readFile(fakeCli)),
      expectedCaFingerprint256: new X509Certificate(fakeCaPem).fingerprint256,
      io: {
        stdout: value => stdout.push(value),
        stderr: value => stderr.push(value),
      },
    })
    assert.equal(result.applied, true)
    assert.equal(result.sourceDigest, 'f2e3653df0be6e83b3d7d904696c2c4e088ae2df061332fb5108ad21ce4a2a32')
    assert.equal(result.normalizedDigest, 'b5f07a4b98b4ca5df4bd32cfbc10c7e005ee969066f0d94f2bb4c8eae0558044')
    assert.equal(result.executionDigest, '49bb04be3bc12a84a5cd45babc5d9b617c668a13d9feb1e56609964e1bbc7d54')
    assert.equal(result.executionSetDigest, '9719ea3b5527f0371b6dd08bb0144a356c5c1451193cbc29cdf5c2db60de3b52')
    const transcript = `${stdout.join('')}\n${stderr.join('')}`
    assert.match(transcript, /CALL=1:--dry-run/)
    assert.match(transcript, /CALL=2:--dry-run/)
    assert.match(transcript, /CALL=3:--yes/)
    assert.ok(transcript.indexOf('CALL=1') < transcript.indexOf('CALL=2'))
    assert.ok(transcript.indexOf('CALL=2') < transcript.indexOf('CALL=3'))
  } finally {
    await rm(fixtureDirectory, { recursive: true, force: true })
  }
})

test('staging-applied retirement migration remains byte-for-byte manifest pinned', async () => {
  const [migration, manifest] = await Promise.all([
    readFile(new URL(
      '../supabase/migrations/20260718140000_retire_wechat_password_credentials.sql',
      import.meta.url,
    )),
    readFile(new URL('../supabase/migrations/manifest.sha256', import.meta.url), 'utf8'),
  ])
  const digest = createHash('sha256').update(migration).digest('hex')
  assert.equal(
    digest,
    'f2e3653df0be6e83b3d7d904696c2c4e088ae2df061332fb5108ad21ce4a2a32',
  )
  assert.match(
    manifest,
    new RegExp(`^${digest}  ${MIGRATION}\\.sql$`, 'm'),
  )
})
