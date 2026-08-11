#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'

const DATABASE_URL_ENV = 'CAACI_FINGERPRINT_CHURN_DATABASE_URL'
const CONFIRM_ENV = 'CAACI_FINGERPRINT_CHURN_LOCAL_CONFIRM'
const MAX_CALL_MS_ENV = 'CAACI_FINGERPRINT_CHURN_MAX_CALL_MS'
const EXACT_CONFIRMATION = '20260811140018-disposable-pg16-or-pg17'
const DEFAULT_MAX_CALL_MS = 1_500
const MAX_CAPTURE_BYTES = 64 * 1024

const PROFILE_A = 'fc000000-0000-4000-8000-000000000001'
const PROFILE_B = 'fc000000-0000-4000-8000-000000000002'
const FIXTURE_PROFILES = [PROFILE_A, PROFILE_B]
const LOCK_CASES = [
  {
    name: 'advisory-lock',
    holdSql: `SELECT pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('${PROFILE_A}'::text, 0)
    );`,
  },
  {
    name: 'profile-lock',
    holdSql: `SELECT profile.id
      FROM public.profiles AS profile
     WHERE profile.id = '${PROFILE_A}'::uuid
       FOR NO KEY UPDATE;`,
  },
  {
    name: 'limiter-lock',
    holdSql: `SELECT limiter.profile_id
      FROM private.device_fingerprint_rate_limits AS limiter
     WHERE limiter.profile_id = '${PROFILE_A}'::uuid
       FOR UPDATE;`,
  },
]

const activeChildren = new Set()
const activeHolders = new Set()

function usage() {
  return `Usage:
  ${DATABASE_URL_ENV}=postgresql://postgres:<local-password>@127.0.0.1:<port>/<disposable-db> \\
  ${CONFIRM_ENV}=${EXACT_CONFIRMATION} \\
  node scripts/device-fingerprint-churn-concurrency.mjs

The target must be an already-bootstrapped, disposable PostgreSQL 16 or 17
database reached through literal loopback (127.0.0.1 or ::1). The runner uses
committed synthetic fixtures because multiple database sessions must see them,
then removes only its two fixed fixture users. Sequence increments are expected
to remain in the disposable database. No hosted Supabase URL is accepted.

Optional:
  ${MAX_CALL_MS_ENV}=1500   Maximum elapsed time for a fail-fast call (250-5000)
`
}

function configurationError(message) {
  const error = new Error(message)
  error.exitCode = 2
  return error
}

function parseMaxCallMs(rawValue) {
  if (rawValue === undefined || rawValue === '') return DEFAULT_MAX_CALL_MS
  if (!/^\d+$/.test(rawValue)) {
    throw configurationError(`${MAX_CALL_MS_ENV} must be an integer`)
  }
  const value = Number(rawValue)
  if (value < 250 || value > 5_000) {
    throw configurationError(`${MAX_CALL_MS_ENV} must be between 250 and 5000`)
  }
  return value
}

function decodeUrlPart(value, label) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw configurationError(`${DATABASE_URL_ENV} has invalid ${label} encoding`)
  }
}

function parseLocalConnection(rawValue) {
  if (!rawValue) {
    throw configurationError(`${DATABASE_URL_ENV} is required`)
  }

  let url
  try {
    url = new URL(rawValue)
  } catch {
    throw configurationError(`${DATABASE_URL_ENV} must be a PostgreSQL URL`)
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw configurationError(`${DATABASE_URL_ENV} must use postgres:// or postgresql://`)
  }
  if (url.hash) {
    throw configurationError(`${DATABASE_URL_ENV} must not contain a fragment`)
  }

  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!['127.0.0.1', '::1'].includes(host)) {
    throw configurationError(
      `${DATABASE_URL_ENV} must use literal loopback; localhost and hosted targets are refused`,
    )
  }

  const username = decodeUrlPart(url.username, 'username')
  if (username !== 'postgres') {
    throw configurationError(`${DATABASE_URL_ENV} must connect as local postgres`)
  }

  const database = decodeUrlPart(url.pathname.replace(/^\//, ''), 'database')
  if (!/^[A-Za-z0-9_-]+$/.test(database)) {
    throw configurationError(`${DATABASE_URL_ENV} must name one simple disposable database`)
  }

  const port = url.port || '5432'
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
    throw configurationError(`${DATABASE_URL_ENV} has an invalid port`)
  }

  const allowedQueryKeys = new Set(['sslmode'])
  for (const key of url.searchParams.keys()) {
    if (!allowedQueryKeys.has(key)) {
      throw configurationError(`${DATABASE_URL_ENV} query parameter ${key} is not allowed`)
    }
  }
  const sslmode = url.searchParams.get('sslmode') || 'disable'
  if (!['disable', 'prefer'].includes(sslmode)) {
    throw configurationError(`${DATABASE_URL_ENV} sslmode must be disable or prefer`)
  }

  return {
    host,
    port,
    username,
    password: decodeUrlPart(url.password, 'password'),
    database,
    sslmode,
  }
}

function psqlEnvironment(connection, label) {
  return {
    PATH: process.env.PATH || '/usr/bin:/bin',
    LANG: 'C',
    LC_ALL: 'C',
    PGHOST: connection.host,
    PGPORT: connection.port,
    PGUSER: connection.username,
    PGPASSWORD: connection.password,
    PGDATABASE: connection.database,
    PGSSLMODE: connection.sslmode,
    PGCONNECT_TIMEOUT: '3',
    PGAPPNAME: `caaci-fingerprint-churn-${label}`.slice(0, 63),
    PGSERVICEFILE: '/dev/null',
    PGPASSFILE: '/dev/null',
  }
}

function boundedAppend(current, chunk) {
  if (current.length >= MAX_CAPTURE_BYTES) return current
  return (current + chunk).slice(0, MAX_CAPTURE_BYTES)
}

function psqlArgs() {
  return [
    '-X',
    '--no-password',
    '--quiet',
    '--tuples-only',
    '--no-align',
    '--set=ON_ERROR_STOP=1',
    '--set=VERBOSITY=verbose',
  ]
}

function spawnPsql(connection, sql, { label, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now()
    const child = spawn('psql', psqlArgs(), {
      env: psqlEnvironment(connection, label),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    activeChildren.add(child)

    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.setEncoding('utf8').on('data', chunk => {
      stdout = boundedAppend(stdout, chunk)
    })
    child.stderr.setEncoding('utf8').on('data', chunk => {
      stderr = boundedAppend(stderr, chunk)
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.once('error', error => {
      clearTimeout(timer)
      activeChildren.delete(child)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      activeChildren.delete(child)
      resolve({
        code,
        signal,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
        elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
      })
    })

    child.stdin.end(`${sql.trim()}\n`)
  })
}

function safeDiagnostic(result) {
  const text = `${result.stdout}\n${result.stderr}`
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted-database-url]')
    .trim()
  return text.slice(0, 4_000)
}

async function query(connection, sql, label, timeoutMs = 5_000) {
  const result = await spawnPsql(connection, sql, { label, timeoutMs })
  if (result.timedOut || result.code !== 0) {
    throw new Error(
      `${label} failed (code=${result.code}, timeout=${result.timedOut}): ${safeDiagnostic(result)}`,
    )
  }
  return result.stdout
}

async function startHolder(connection, holdSql, label) {
  const marker = `__CAACI_LOCK_READY_${randomUUID()}__`
  const child = spawn('psql', psqlArgs(), {
    env: psqlEnvironment(connection, `${label}-holder`),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  activeChildren.add(child)

  let stdout = ''
  let stderr = ''
  let closed = false
  let closeCode = null
  let closeSignal = null
  let readySettled = false
  let resolveReady
  let rejectReady
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })

  const readyTimer = setTimeout(() => {
    if (!readySettled) {
      readySettled = true
      child.kill('SIGKILL')
      rejectReady(new Error(`${label} holder did not acquire its lock promptly`))
    }
  }, 3_000)

  child.stdout.setEncoding('utf8').on('data', chunk => {
    stdout = boundedAppend(stdout, chunk)
    if (!readySettled && stdout.includes(marker)) {
      readySettled = true
      clearTimeout(readyTimer)
      resolveReady()
    }
  })
  child.stderr.setEncoding('utf8').on('data', chunk => {
    stderr = boundedAppend(stderr, chunk)
  })
  child.once('error', error => {
    if (!readySettled) {
      readySettled = true
      clearTimeout(readyTimer)
      rejectReady(error)
    }
  })
  const closedPromise = new Promise(resolve => {
    child.once('close', (code, signal) => {
      closed = true
      closeCode = code
      closeSignal = signal
      clearTimeout(readyTimer)
      activeChildren.delete(child)
      if (!readySettled) {
        readySettled = true
        rejectReady(
          new Error(`${label} holder exited before ready: ${stderr.trim()}`),
        )
      }
      resolve()
    })
  })

  child.stdin.write(`BEGIN;\n${holdSql.trim()}\nSELECT '${marker}';\n`)
  await ready

  const holder = {
    async release() {
      if (!closed) {
        child.stdin.end('ROLLBACK;\n\\q\n')
        const releaseTimeout = setTimeout(() => child.kill('SIGKILL'), 2_000)
        await closedPromise
        clearTimeout(releaseTimeout)
      }
      activeHolders.delete(holder)
      if (closeCode !== 0) {
        throw new Error(
          `${label} holder exited unexpectedly (code=${closeCode}, signal=${closeSignal}): ${stderr.trim()}`,
        )
      }
    },
    kill() {
      if (!closed) child.kill('SIGKILL')
      activeHolders.delete(holder)
    },
  }
  activeHolders.add(holder)
  return holder
}

function fingerprintHash(label) {
  return createHash('sha256').update(label).digest('hex')
}

function invocationSql(profileId, hash) {
  assert.match(profileId, /^[0-9a-f-]{36}$/)
  assert.match(hash, /^[0-9a-f]{64}$/)
  return `
    SET statement_timeout = '2s';
    SET lock_timeout = '250ms';
    SET ROLE authenticated;
    SELECT pg_catalog.set_config(
      'request.jwt.claim.sub',
      '${profileId}',
      false
    );
    SELECT public.record_fingerprint('${hash}', 'local concurrency regression');
  `
}

async function invokeFingerprint(connection, profileId, hash, label, timeoutMs) {
  return spawnPsql(connection, invocationSql(profileId, hash), {
    label,
    timeoutMs,
  })
}

function assertFast(result, label, maxCallMs) {
  assert.equal(result.timedOut, false, `${label} queued until the runner timeout`)
  assert.ok(
    result.elapsedMs <= maxCallMs,
    `${label} took ${result.elapsedMs}ms (limit ${maxCallMs}ms)`,
  )
}

function pt429Message(result) {
  const combined = `${result.stdout}\n${result.stderr}`
  if (!/\bPT429\b/.test(combined)) return null
  const match = combined.match(
    /\b(fingerprint_busy|fingerprint_write_deferred|fingerprint_rate_limited)\b/,
  )
  return match?.[1] || null
}

function assertPt429(result, label, maxCallMs, expectedMessage = null) {
  assertFast(result, label, maxCallMs)
  assert.notEqual(result.code, 0, `${label} unexpectedly succeeded`)
  const message = pt429Message(result)
  assert.ok(message, `${label} did not return PT429: ${safeDiagnostic(result)}`)
  if (expectedMessage) {
    assert.equal(message, expectedMessage, `${label} returned the wrong PT429 reason`)
  }
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /statement timeout|canceling statement due to statement timeout/i,
    `${label} reached a timeout instead of failing fast`,
  )
  return message
}

function assertSuccess(result, label, maxCallMs) {
  assertFast(result, label, maxCallMs)
  assert.equal(result.code, 0, `${label} failed: ${safeDiagnostic(result)}`)
}

const cleanupSql = `
  SET statement_timeout = '5s';
  SET lock_timeout = '1s';
  DO $guard$
  BEGIN
    IF EXISTS (
      SELECT 1
        FROM auth.users AS auth_user
       WHERE auth_user.id IN (
         '${PROFILE_A}'::uuid,
         '${PROFILE_B}'::uuid
       )
         AND COALESCE(auth_user.raw_user_meta_data ->> 'synthetic', '') <> 'true'
    ) THEN
      RAISE EXCEPTION 'refusing to remove a non-synthetic fixed fixture';
    END IF;
  END;
  $guard$;
  DELETE FROM auth.users
   WHERE id IN ('${PROFILE_A}'::uuid, '${PROFILE_B}'::uuid);
  DELETE FROM public.profiles
   WHERE id IN ('${PROFILE_A}'::uuid, '${PROFILE_B}'::uuid);
`

const setupSql = `
  ${cleanupSql}
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (
      '${PROFILE_A}'::uuid,
      'fingerprint-concurrency-a@example.invalid',
      '{"synthetic":true,"fixture":"fingerprint-churn-concurrency"}'::jsonb
    ),
    (
      '${PROFILE_B}'::uuid,
      'fingerprint-concurrency-b@example.invalid',
      '{"synthetic":true,"fixture":"fingerprint-churn-concurrency"}'::jsonb
    );
  INSERT INTO public.profiles (id, nickname) VALUES
    ('${PROFILE_A}'::uuid, 'Fingerprint Concurrency A'),
    ('${PROFILE_B}'::uuid, 'Fingerprint Concurrency B')
  ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname;
  INSERT INTO private.device_fingerprint_rate_limits (
    profile_id,
    last_accepted_write_at,
    accepted_new_hash_at
  ) VALUES
    (
      '${PROFILE_A}'::uuid,
      pg_catalog.statement_timestamp() - interval '1 hour',
      ARRAY[]::timestamptz[]
    ),
    (
      '${PROFILE_B}'::uuid,
      pg_catalog.statement_timestamp() - interval '1 hour',
      ARRAY[]::timestamptz[]
    );
`

function resetProfileSql(profileId) {
  assert.ok(FIXTURE_PROFILES.includes(profileId))
  return `
    SET statement_timeout = '5s';
    SET lock_timeout = '1s';
    DELETE FROM public.device_fingerprints
     WHERE profile_id = '${profileId}'::uuid;
    UPDATE public.profiles
       SET last_fp_hash = NULL,
           last_fp_seen_at = NULL
     WHERE id = '${profileId}'::uuid;
    INSERT INTO private.device_fingerprint_rate_limits (
      profile_id,
      last_accepted_write_at,
      accepted_new_hash_at
    ) VALUES (
      '${profileId}'::uuid,
      pg_catalog.statement_timestamp() - interval '1 hour',
      ARRAY[]::timestamptz[]
    )
    ON CONFLICT (profile_id) DO UPDATE
      SET last_accepted_write_at = EXCLUDED.last_accepted_write_at,
          accepted_new_hash_at = EXCLUDED.accepted_new_hash_at;
  `
}

function profileStateSql(profileId) {
  assert.ok(FIXTURE_PROFILES.includes(profileId))
  return `
    SELECT pg_catalog.json_build_object(
      'fingerprints', COALESCE(
        (
          SELECT pg_catalog.json_agg(
            pg_catalog.json_build_array(
              fingerprint.id,
              fingerprint.fp_hash,
              fingerprint.first_seen,
              fingerprint.last_seen,
              fingerprint.seen_count,
              fingerprint.ua_snippet
            ) ORDER BY fingerprint.id
          )
            FROM public.device_fingerprints AS fingerprint
           WHERE fingerprint.profile_id = '${profileId}'::uuid
        ),
        '[]'::json
      ),
      'profile_last_hash', profile.last_fp_hash,
      'profile_last_seen_at', profile.last_fp_seen_at,
      'rate_rows', (
        SELECT pg_catalog.count(*)
          FROM private.device_fingerprint_rate_limits AS limiter
         WHERE limiter.profile_id = '${profileId}'::uuid
      ),
      'rate_last_write_at', (
        SELECT limiter.last_accepted_write_at
          FROM private.device_fingerprint_rate_limits AS limiter
         WHERE limiter.profile_id = '${profileId}'::uuid
      ),
      'accepted_new_hash_at', COALESCE(
        (
          SELECT pg_catalog.to_json(limiter.accepted_new_hash_at)
            FROM private.device_fingerprint_rate_limits AS limiter
           WHERE limiter.profile_id = '${profileId}'::uuid
        ),
        '[]'::json
      )
    )
      FROM public.profiles AS profile
     WHERE profile.id = '${profileId}'::uuid;
  `
}

async function profileState(connection, profileId, label) {
  const raw = await query(connection, profileStateSql(profileId), label)
  assert.ok(raw, `${label} returned no profile state`)
  return JSON.parse(raw)
}

async function resetFixtures(connection, label) {
  await query(
    connection,
    `${resetProfileSql(PROFILE_A)}\n${resetProfileSql(PROFILE_B)}`,
    label,
  )
}

async function preflight(connection) {
  const raw = await query(
    connection,
    `
      SELECT pg_catalog.concat_ws(
        '|',
        pg_catalog.current_setting('server_version_num'),
        current_user,
        current_database(),
        pg_catalog.pg_is_in_recovery(),
        pg_catalog.to_regprocedure('public.record_fingerprint(text,text)') IS NOT NULL,
        pg_catalog.to_regclass('private.device_fingerprint_rate_limits') IS NOT NULL,
        pg_catalog.to_regprocedure('auth.uid()') IS NOT NULL,
        COALESCE(
          (
            SELECT pg_catalog.strpos(routine.prosrc, 'pg_try_advisory_xact_lock') > 0
               AND pg_catalog.strpos(routine.prosrc, 'fingerprint_busy') > 0
               AND pg_catalog.strpos(routine.prosrc, 'PT429') > 0
              FROM pg_catalog.pg_proc AS routine
             WHERE routine.oid = pg_catalog.to_regprocedure(
               'public.record_fingerprint(text,text)'
             )
          ),
          false
        )
      );
    `,
    'preflight',
  )
  const [serverVersionNum, user, database, inRecovery, rpc, limiter, authUid, source] =
    raw.split('|')
  const major = Number(serverVersionNum.slice(0, -4))
  assert.ok([16, 17].includes(major), `expected PostgreSQL 16/17, got ${serverVersionNum}`)
  assert.equal(user, 'postgres', 'preflight must run as local postgres')
  assert.equal(database, connection.database, 'connected database identity drifted')
  assert.equal(inRecovery, 'f', 'read-replica/recovery target is refused')
  assert.deepEqual(
    [rpc, limiter, authUid, source],
    ['t', 't', 't', 't'],
    'bounded fingerprint migration or local bootstrap is missing',
  )
  return { major, serverVersionNum }
}

async function runLockCase(connection, lockCase, maxCallMs) {
  await resetFixtures(connection, `reset-${lockCase.name}`)
  const beforeA = await profileState(connection, PROFILE_A, `${lockCase.name}-before-a`)
  const holder = await startHolder(connection, lockCase.holdSql, lockCase.name)
  let contenderA
  let peerB
  try {
    ;[contenderA, peerB] = await Promise.all([
      invokeFingerprint(
        connection,
        PROFILE_A,
        fingerprintHash(`${lockCase.name}-same-profile`),
        `${lockCase.name}-same-profile`,
        maxCallMs + 750,
      ),
      invokeFingerprint(
        connection,
        PROFILE_B,
        fingerprintHash(`${lockCase.name}-other-profile`),
        `${lockCase.name}-other-profile`,
        maxCallMs + 750,
      ),
    ])
  } finally {
    await holder.release()
  }

  const message = assertPt429(
    contenderA,
    `${lockCase.name} same-profile contender`,
    maxCallMs,
    'fingerprint_busy',
  )
  assertSuccess(peerB, `${lockCase.name} different-profile call`, maxCallMs)

  const afterA = await profileState(connection, PROFILE_A, `${lockCase.name}-after-a`)
  const afterB = await profileState(connection, PROFILE_B, `${lockCase.name}-after-b`)
  assert.deepEqual(afterA, beforeA, `${lockCase.name} rejected contender mutated profile A`)
  assert.equal(afterB.fingerprints.length, 1, `${lockCase.name} profile B write missing`)
  assert.equal(afterB.rate_rows, 1, `${lockCase.name} profile B limiter row drifted`)
  assert.equal(
    afterB.accepted_new_hash_at.length,
    1,
    `${lockCase.name} profile B did not consume exactly one new-hash slot`,
  )

  return {
    case: lockCase.name,
    same_profile: { result: `PT429:${message}`, elapsed_ms: contenderA.elapsedMs },
    different_profile: { result: 'success', elapsed_ms: peerB.elapsedMs },
  }
}

async function sequenceState(connection, label) {
  const raw = await query(
    connection,
    `SELECT last_value::text || '|' || is_called::text
       FROM public.device_fingerprints_id_seq;`,
    label,
  )
  const [lastValue, isCalled] = raw.split('|')
  return { lastValue: BigInt(lastValue), isCalled: isCalled === 'true' || isCalled === 't' }
}

async function runParallelDistinctCase(connection, maxCallMs) {
  await resetFixtures(connection, 'reset-parallel-distinct')
  const sequenceBefore = await sequenceState(connection, 'parallel-sequence-before')
  assert.equal(sequenceBefore.isCalled, true, 'fixture sequence should already be called')

  const hashes = Array.from(
    { length: 16 },
    (_, index) => fingerprintHash(`parallel-distinct-${index}`),
  )
  const calls = await Promise.all(
    hashes.map((hash, index) => invokeFingerprint(
      connection,
      PROFILE_A,
      hash,
      `parallel-distinct-${index}`,
      maxCallMs + 750,
    )),
  )

  for (const [index, call] of calls.entries()) {
    assertFast(call, `parallel distinct call ${index}`, maxCallMs)
  }
  const successes = calls
    .map((call, index) => ({ call, index }))
    .filter(({ call }) => call.code === 0)
  assert.equal(successes.length, 1, 'parallel distinct calls must commit exactly one write')

  const pt429Reasons = {}
  for (const [index, call] of calls.entries()) {
    if (call.code === 0) continue
    const reason = assertPt429(call, `parallel distinct call ${index}`, maxCallMs)
    pt429Reasons[reason] = (pt429Reasons[reason] || 0) + 1
  }

  const state = await profileState(connection, PROFILE_A, 'parallel-distinct-state')
  assert.equal(state.fingerprints.length, 1, 'parallel distinct calls wrote more than one row')
  assert.equal(state.rate_rows, 1, 'parallel distinct calls changed limiter cardinality')
  assert.equal(
    state.accepted_new_hash_at.length,
    1,
    'parallel distinct calls consumed more than one new-hash slot',
  )
  assert.ok(
    hashes.includes(state.profile_last_hash),
    'profile pointer does not reference the one accepted parallel hash',
  )
  assert.deepEqual(
    state.fingerprints.map(row => row[1]),
    [state.profile_last_hash],
    'fingerprint row and profile pointer diverged',
  )

  const sequenceAfter = await sequenceState(connection, 'parallel-sequence-after')
  assert.equal(
    sequenceAfter.lastValue,
    sequenceBefore.lastValue + 1n,
    'parallel distinct calls advanced the sequence more than once',
  )

  const waiting = await query(
    connection,
    `SELECT pg_catalog.count(*)
       FROM pg_catalog.pg_stat_activity AS activity
      WHERE activity.application_name LIKE 'caaci-fingerprint-churn-%'
        AND activity.pid <> pg_catalog.pg_backend_pid()
        AND activity.wait_event_type = 'Lock';`,
    'parallel-lock-wait-census',
  )
  assert.equal(waiting, '0', 'parallel distinct calls left a database lock waiter')

  return {
    case: 'parallel-distinct-same-profile',
    callers: calls.length,
    committed_writes: successes.length,
    pt429: pt429Reasons,
    max_elapsed_ms: Math.max(...calls.map(call => call.elapsedMs)),
    sequence_delta: Number(sequenceAfter.lastValue - sequenceBefore.lastValue),
  }
}

async function assertFixtureCleanup(connection) {
  const raw = await query(
    connection,
    `SELECT pg_catalog.concat_ws(
       '|',
       (SELECT pg_catalog.count(*) FROM auth.users WHERE id IN (
         '${PROFILE_A}'::uuid, '${PROFILE_B}'::uuid
       )),
       (SELECT pg_catalog.count(*) FROM public.profiles WHERE id IN (
         '${PROFILE_A}'::uuid, '${PROFILE_B}'::uuid
       )),
       (SELECT pg_catalog.count(*) FROM public.device_fingerprints WHERE profile_id IN (
         '${PROFILE_A}'::uuid, '${PROFILE_B}'::uuid
       )),
       (SELECT pg_catalog.count(*) FROM private.device_fingerprint_rate_limits WHERE profile_id IN (
         '${PROFILE_A}'::uuid, '${PROFILE_B}'::uuid
       ))
     );`,
    'cleanup-census',
  )
  assert.equal(raw, '0|0|0|0', `synthetic fixture cleanup was incomplete: ${raw}`)
}

async function main() {
  if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) {
    process.stdout.write(usage())
    return
  }
  if (process.argv.length !== 2) {
    throw configurationError('this runner accepts only --help; configuration belongs in dedicated environment variables')
  }
  if (process.env[CONFIRM_ENV] !== EXACT_CONFIRMATION) {
    throw configurationError(`${CONFIRM_ENV} must exactly equal ${EXACT_CONFIRMATION}`)
  }

  const maxCallMs = parseMaxCallMs(process.env[MAX_CALL_MS_ENV])
  const connection = parseLocalConnection(process.env[DATABASE_URL_ENV])
  const preflightResult = await preflight(connection)

  let fixturesCreated = false
  let cleanupFailure = null
  let report
  try {
    await query(connection, setupSql, 'fixture-setup', 8_000)
    fixturesCreated = true

    const lockResults = []
    for (const lockCase of LOCK_CASES) {
      lockResults.push(await runLockCase(connection, lockCase, maxCallMs))
    }
    const parallelResult = await runParallelDistinctCase(connection, maxCallMs)

    report = {
      status: 'PASS',
      postgres_major: preflightResult.major,
      server_version_num: preflightResult.serverVersionNum,
      max_call_ms: maxCallMs,
      lock_cases: lockResults,
      parallel_case: parallelResult,
      hosted_target_used: false,
    }
  } finally {
    for (const holder of [...activeHolders]) holder.kill()
    if (fixturesCreated) {
      try {
        await query(connection, cleanupSql, 'fixture-cleanup', 8_000)
        await assertFixtureCleanup(connection)
      } catch (error) {
        cleanupFailure = error
      }
    }
    if (cleanupFailure) throw cleanupFailure
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    for (const holder of [...activeHolders]) holder.kill()
    for (const child of [...activeChildren]) child.kill('SIGKILL')
    process.exit(signal === 'SIGINT' ? 130 : 143)
  })
}

try {
  await main()
} catch (error) {
  const exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1
  process.stderr.write(`device fingerprint churn concurrency: FAIL: ${error?.message || error}\n`)
  if (exitCode === 2) process.stderr.write(`\n${usage()}`)
  process.exitCode = exitCode
}
