#!/usr/bin/env node
/**
 * Destructive only inside a fresh temporary PostgreSQL cluster created by this
 * process. Proves the reviewed Supabase CLI transaction/lock behavior without
 * accepting any hosted or operator-supplied database target.
 */

import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import {
  historicalExecutionGuard,
  productionGuardedRetirementMigration,
  productionLedgerProjection,
} from './wechat-retirement-migration-executor.mjs'

const execFileAsync = promisify(execFile)
const ROOT = new URL('../', import.meta.url)
const CLI = '/opt/homebrew/Cellar/supabase/2.95.4/bin/supabase'
const CLI_DIGEST = '6d0f911ff159fd1e8fa125df475acfeadfc76bd7431f60904ab6ceaca95020c8'
const REVIEWED_PG17_VERSION = '17.10'
const REVIEWED_PG17_DIRECTORY =
  `/opt/homebrew/Cellar/postgresql@17/${REVIEWED_PG17_VERSION}/bin`
const INITDB = `${REVIEWED_PG17_DIRECTORY}/initdb`
const PG_CTL = `${REVIEWED_PG17_DIRECTORY}/pg_ctl`
const PSQL = `${REVIEWED_PG17_DIRECTORY}/psql`
const POSTGRES = `${REVIEWED_PG17_DIRECTORY}/postgres`
// Fill these only after the exact Homebrew 17.10 bottle is installed and each
// regular binary is independently reviewed. Empty values intentionally keep
// the rehearsal fail-closed; PostgreSQL 16 receipts are never acceptable.
const REVIEWED_PG17_DIGESTS = Object.freeze({
  initdb: '',
  pg_ctl: '',
  psql: '',
  postgres: '',
})
const TARGET_VERSION = '20260718140000'
const TARGET_FILE = `${TARGET_VERSION}_retire_wechat_password_credentials.sql`
const CONFIRMATION = 'LOCAL_DISPOSABLE_POSTGRES_ONLY'
const PROCESS_TIMEOUT_MS = 60_000

const sha256 = value => createHash('sha256').update(value).digest('hex')

export function boundedRehearsalEnvironment(temporaryDirectory = tmpdir()) {
  return {
    LANG: 'C',
    LC_ALL: 'C',
    NO_COLOR: '1',
    TERM: 'dumb',
    TMPDIR: temporaryDirectory,
  }
}

async function run(command, args, options = {}) {
  const { env = boundedRehearsalEnvironment(), ...boundedOptions } = options
  try {
    return await execFileAsync(command, args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: PROCESS_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      env,
      ...boundedOptions,
    })
  } catch (error) {
    error.stdout = error.stdout || ''
    error.stderr = error.stderr || ''
    throw error
  }
}

export async function reviewedPg17BinaryReceipt() {
  const binaries = [
    ['initdb', INITDB],
    ['pg_ctl', PG_CTL],
    ['psql', PSQL],
    ['postgres', POSTGRES],
  ]
  const receipt = {}
  for (const [name, path] of binaries) {
    const expectedDigest = REVIEWED_PG17_DIGESTS[name]
    if (!/^[0-9a-f]{64}$/.test(expectedDigest || '')) {
      throw new Error('reviewed_pg17_binary_digest_missing')
    }
    const metadata = await lstat(path)
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('reviewed_pg17_binary_not_regular')
    }
    const digest = sha256(await readFile(path))
    if (digest !== expectedDigest) {
      throw new Error('reviewed_pg17_binary_digest_mismatch')
    }
    const version = (await run(path, ['--version'])).stdout.trim()
    if (!version.includes(`(PostgreSQL) ${REVIEWED_PG17_VERSION}`)) {
      throw new Error('reviewed_pg17_binary_version_mismatch')
    }
    receipt[name] = { digest, path, version }
  }
  return receipt
}

async function unusedLoopbackPort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      server.close(error => {
        if (error) reject(error)
        else resolvePort(address.port)
      })
    })
  })
}

function parseManifest(manifest) {
  return manifest.split(/\r?\n/)
    .map(line => line.match(/^([0-9a-f]{64})  ([A-Za-z0-9_.-]+\.sql)$/))
    .filter(Boolean)
    .map(match => [match[2], match[1]])
}

async function createMigrationWorkspace(baseDirectory) {
  const [manifest, target] = await Promise.all([
    readFile(new URL('supabase/migrations/manifest.sha256', ROOT), 'utf8'),
    readFile(new URL(`supabase/migrations/${TARGET_FILE}`, ROOT)),
  ])
  const projection = productionLedgerProjection(parseManifest(manifest))
  const supabaseDirectory = join(baseDirectory, 'workspace', 'supabase')
  const migrationsDirectory = join(supabaseDirectory, 'migrations')
  await mkdir(migrationsDirectory, { recursive: true, mode: 0o700 })
  await writeFile(join(supabaseDirectory, 'config.toml'), `project_id = "caaci-retirement-rehearsal"

[db]
major_version = 17

[db.migrations]
enabled = true
schema_paths = []

[db.seed]
enabled = false
sql_paths = []
`, { mode: 0o400, flag: 'wx' })
  let targetBody
  let targetPath
  for (const entry of projection) {
    const body = entry.canonicalName === TARGET_FILE
      ? productionGuardedRetirementMigration(target, projection)
      : historicalExecutionGuard(entry.name)
    const destination = join(migrationsDirectory, entry.name)
    await writeFile(destination, body, { mode: 0o400, flag: 'wx' })
    await chmod(destination, 0o400)
    if (entry.canonicalName === TARGET_FILE) {
      targetBody = body
      targetPath = destination
    }
  }
  if (!targetBody || !targetPath) throw new Error('rehearsal_target_missing')
  return {
    projection,
    targetBody,
    targetPath,
    workdir: join(baseDirectory, 'workspace'),
  }
}

function sqlLiteral(value) {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error('unsafe_rehearsal_identity')
  return `'${value}'`
}

function predecessorSql(projection) {
  const identities = projection
    .filter(entry => entry.canonicalName !== TARGET_FILE)
    .map(entry => `  (${sqlLiteral(entry.remoteVersion)}, ${sqlLiteral(entry.remoteName)}, ARRAY['reviewed rehearsal baseline']::text[])`)
    .join(',\n')
  return `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  name text,
  statements text[]
);
INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
VALUES
${identities};

CREATE TABLE public.wechat_password_map (
  openid text PRIMARY KEY CHECK (length(openid) BETWEEN 4 AND 128),
  password text NOT NULL CHECK (length(password) BETWEEN 32 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  rotated_at timestamptz
);
ALTER TABLE public.wechat_password_map ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wechat_password_map TO service_role;

CREATE FUNCTION public.wechat_password_lookup(openid_in text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public
AS 'SELECT NULL::text';
CREATE FUNCTION public.wechat_password_store(openid_in text, password_in text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS 'SELECT NULL::void';
REVOKE ALL ON FUNCTION public.wechat_password_lookup(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wechat_password_store(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wechat_password_lookup(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wechat_password_store(text, text) TO service_role;
`
}

async function psql(dbUrl, sql) {
  return run(PSQL, [
    '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align',
    '--dbname', dbUrl, '--command', sql,
  ])
}

async function cliPush(workdir, dbUrl) {
  return run(CLI, [
    'db', 'push', '--db-url', dbUrl, '--include-all', '--yes',
  ], {
    cwd: workdir,
    env: boundedRehearsalEnvironment(workdir),
  })
}

async function assertUnapplied(dbUrl, label) {
  const result = await psql(dbUrl, `
SELECT pg_catalog.concat_ws('|',
  (SELECT pg_catalog.count(*) FROM supabase_migrations.schema_migrations WHERE version = '${TARGET_VERSION}'),
  (pg_catalog.to_regprocedure('public.delete_wechat_password_credential(text)') IS NULL)::text,
  COALESCE(pg_catalog.obj_description('public.wechat_password_map'::regclass, 'pg_class'), '<null>'),
  (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint
    WHERE conname = 'reject_retirement_ledger_insert'
      AND conrelid = 'supabase_migrations.schema_migrations'::regclass)
);`)
  const receipt = result.stdout.trim()
  if (receipt !== '0|true|<null>|0') {
    throw new Error(`${label}_was_not_atomic:${receipt}`)
  }
}

async function assertPredecessorDriftRejected(
  dbUrl,
  workdir,
  { label, setup, marker, teardown },
) {
  await psql(dbUrl, setup)
  let failure
  try {
    await cliPush(workdir, dbUrl)
  } catch (error) {
    failure = error
  }
  const transcript = `${failure?.stdout || ''}\n${failure?.stderr || ''}`
  if (!failure || !transcript.includes(marker)) {
    throw new Error(`${label}_guard_failure_not_observed`)
  }
  await assertUnapplied(dbUrl, label)
  await psql(dbUrl, teardown)
}

async function waitForMarker(child, marker, timeoutMs = 10_000) {
  return new Promise((resolveMarker, reject) => {
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      reject(new Error(`lock_holder_marker_timeout:${stderr}`))
    }, timeoutMs)
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
      if (stdout.includes(marker)) {
        clearTimeout(timer)
        resolveMarker()
      }
    })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.once('exit', code => {
      clearTimeout(timer)
      reject(new Error(`lock_holder_exited:${code}:${stderr}`))
    })
  })
}

async function stopChild(child) {
  if (child.exitCode != null || child.signalCode != null) return
  child.kill('SIGTERM')
  await new Promise(resolveExit => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolveExit()
    }, 3_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolveExit()
    })
  })
}

export async function runRehearsal() {
  const pg17Binaries = await reviewedPg17BinaryReceipt()
  if (sha256(await readFile(CLI)) !== CLI_DIGEST) {
    throw new Error('reviewed_supabase_cli_digest_mismatch')
  }
  const baseDirectory = await mkdtemp(join(tmpdir(), 'caaci-retirement-pg-rehearsal-'))
  const dataDirectory = join(baseDirectory, 'postgres')
  const socketDirectory = join(baseDirectory, 'socket')
  const resolvedBase = resolve(baseDirectory)
  if (!resolvedBase.startsWith(resolve(tmpdir()) + '/')) {
    throw new Error('unsafe_rehearsal_directory')
  }
  let postgresStarted = false
  let lockHolder
  try {
    const {
      projection,
      targetBody,
      targetPath,
      workdir,
    } = await createMigrationWorkspace(baseDirectory)
    await mkdir(socketDirectory, { mode: 0o700 })
    await run(INITDB, [
      '--pgdata', dataDirectory,
      '--username', 'postgres',
      '--auth', 'trust',
      '--no-locale',
      '--encoding', 'UTF8',
    ])
    const port = await unusedLoopbackPort()
    await run(PG_CTL, [
      '--pgdata', dataDirectory,
      '--options', `-h 127.0.0.1 -p ${port} -k ${socketDirectory}`,
      '--wait', 'start',
    ])
    postgresStarted = true
    const dbUrl = `postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`
    await psql(dbUrl, predecessorSql(projection))

    // Every security-relevant predecessor drift must fail before the target
    // DDL or ledger row. These are sequential and restored inside this fresh
    // disposable cluster only.
    for (const drift of [
      {
        label: 'unexpected_table_grantee',
        setup: 'GRANT SELECT ON public.wechat_password_map TO authenticated;',
        marker: 'credential_predecessor_relation_acl_mismatch',
        teardown: 'REVOKE SELECT ON public.wechat_password_map FROM authenticated;',
      },
      {
        label: 'unexpected_column_grantee',
        setup: 'GRANT SELECT (openid) ON public.wechat_password_map TO service_role;',
        marker: 'credential_predecessor_relation_acl_mismatch',
        teardown: 'REVOKE SELECT (openid) ON public.wechat_password_map FROM service_role;',
      },
      {
        label: 'unexpected_map_trigger',
        setup: `
CREATE FUNCTION public.injected_map_trigger()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RETURN OLD;
END
$fn$;
CREATE TRIGGER injected_map_trigger
BEFORE DELETE ON public.wechat_password_map
FOR EACH ROW EXECUTE FUNCTION public.injected_map_trigger();`,
        marker: 'credential_predecessor_dependency_or_hook_mismatch',
        teardown: `
DROP TRIGGER injected_map_trigger ON public.wechat_password_map;
DROP FUNCTION public.injected_map_trigger();`,
      },
      {
        label: 'unexpected_map_policy',
        setup: `CREATE POLICY injected_map_policy
ON public.wechat_password_map FOR SELECT TO authenticated USING (false);`,
        marker: 'credential_predecessor_relation_shape_mismatch',
        teardown: 'DROP POLICY injected_map_policy ON public.wechat_password_map;',
      },
      {
        label: 'unexpected_column_shape',
        setup: 'ALTER TABLE public.wechat_password_map ALTER COLUMN password DROP NOT NULL;',
        marker: 'credential_predecessor_column_shape_mismatch',
        teardown: 'ALTER TABLE public.wechat_password_map ALTER COLUMN password SET NOT NULL;',
      },
      {
        label: 'unexpected_inheritance',
        setup: 'CREATE TABLE public.injected_map_child () INHERITS (public.wechat_password_map);',
        marker: 'credential_predecessor_relation_shape_mismatch',
        teardown: 'DROP TABLE public.injected_map_child;',
      },
      {
        label: 'unexpected_delete_rpc_overload',
        setup: `CREATE FUNCTION public.delete_wechat_password_credential(jsonb)
RETURNS boolean LANGUAGE sql AS 'SELECT false';`,
        marker: 'credential_predecessor_rpc_namespace_mismatch',
        teardown: 'DROP FUNCTION public.delete_wechat_password_credential(jsonb);',
      },
      {
        label: 'unexpected_legacy_rpc_overload',
        setup: `CREATE FUNCTION public.wechat_password_lookup(jsonb)
RETURNS text LANGUAGE sql AS 'SELECT NULL::text';`,
        marker: 'credential_predecessor_rpc_namespace_mismatch',
        teardown: 'DROP FUNCTION public.wechat_password_lookup(jsonb);',
      },
    ]) {
      await assertPredecessorDriftRejected(dbUrl, workdir, drift)
    }

    // 1. Force the final CLI ledger INSERT to fail. Every target DDL statement
    // must roll back with it.
    const forcedLedgerFailure = Buffer.concat([
      targetBody,
      Buffer.from(`
-- Disposable-only late failpoint. It is appended after the reviewed terminal
-- postcondition so the CLI's own final ledger INSERT must roll back all target
-- DDL together with this temporary constraint.
ALTER TABLE supabase_migrations.schema_migrations
  ADD CONSTRAINT reject_retirement_ledger_insert
  CHECK (version <> '${TARGET_VERSION}');
`),
    ])
    await chmod(targetPath, 0o600)
    await writeFile(targetPath, forcedLedgerFailure, { mode: 0o600 })
    await chmod(targetPath, 0o400)
    let forcedFailure
    try {
      await cliPush(workdir, dbUrl)
    } catch (error) {
      forcedFailure = error
    }
    await chmod(targetPath, 0o600)
    await writeFile(targetPath, targetBody, { mode: 0o600 })
    await chmod(targetPath, 0o400)
    if (
      !forcedFailure ||
      !`${forcedFailure.stdout}\n${forcedFailure.stderr}`
        .includes('reject_retirement_ledger_insert')
    ) {
      throw new Error('forced_ledger_insert_failure_not_observed')
    }
    await assertUnapplied(dbUrl, 'forced_ledger_insert_failure')

    // 2. Hold a conflicting lock on the retired map. The target-local
    // lock_timeout must stop the exact CLI run in roughly five seconds.
    lockHolder = spawn(PSQL, [
      '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align',
      '--dbname', dbUrl,
      '--command', "BEGIN; LOCK TABLE public.wechat_password_map IN ACCESS SHARE MODE; SELECT 'CAACI_LOCK_READY'; SELECT pg_sleep(30); ROLLBACK;",
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: boundedRehearsalEnvironment(baseDirectory),
    })
    await waitForMarker(lockHolder, 'CAACI_LOCK_READY')
    const lockStarted = Date.now()
    let lockFailure
    try {
      await cliPush(workdir, dbUrl)
    } catch (error) {
      lockFailure = error
    }
    const lockElapsedMs = Date.now() - lockStarted
    if (
      !lockFailure ||
      !`${lockFailure.stdout}\n${lockFailure.stderr}`.toLowerCase().includes('lock timeout') ||
      lockElapsedMs < 4_000 ||
      lockElapsedMs > 12_000
    ) {
      throw new Error(`target_lock_timeout_not_proven:${lockElapsedMs}`)
    }
    await assertUnapplied(dbUrl, 'lock_timeout_failure')
    await stopChild(lockHolder)
    lockHolder = null

    // 3. With no injected fault, the same guarded target and its ledger row
    // commit together, including the exact 19-statement receipt.
    const applied = await cliPush(workdir, dbUrl)
    if (!`${applied.stdout}\n${applied.stderr}`.includes(`Applying migration ${TARGET_FILE}`)) {
      throw new Error('successful_apply_marker_missing')
    }
    const receipt = await psql(dbUrl, `
SELECT pg_catalog.concat_ws('|',
  version,
  name,
  pg_catalog.cardinality(statements),
  (pg_catalog.to_regprocedure('public.delete_wechat_password_credential(text)') IS NOT NULL)::text,
  (pg_catalog.obj_description('public.wechat_password_map'::regclass, 'pg_class') LIKE 'RETIRED credential map.%')::text
)
FROM supabase_migrations.schema_migrations
WHERE version = '${TARGET_VERSION}';`)
    if (receipt.stdout.trim() !== `${TARGET_VERSION}|retire_wechat_password_credentials|19|true|true`) {
      throw new Error(`successful_apply_receipt_mismatch:${receipt.stdout.trim()}`)
    }
    console.log(JSON.stringify({
      cliSha256: CLI_DIGEST,
      pg17Binaries,
      forcedLedgerInsertRollback: true,
      lockTimeoutElapsedMs: lockElapsedMs,
      exactLedgerReceipt: receipt.stdout.trim(),
    }, null, 2))
  } finally {
    if (lockHolder) await stopChild(lockHolder).catch(() => {})
    if (postgresStarted) {
      await run(PG_CTL, [
        '--pgdata', dataDirectory, '--mode', 'fast', '--wait', 'stop',
      ]).catch(() => {})
    }
    await rm(baseDirectory, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  if (argv.length !== 2 || argv[0] !== '--confirm' || argv[1] !== CONFIRMATION) {
    console.error(`Refusing to run. Required: --confirm ${CONFIRMATION}`)
    process.exitCode = 2
  } else {
    runRehearsal().catch(error => {
      console.error(`Disposable PostgreSQL rehearsal failed: ${error?.message || 'unknown_error'}`)
      process.exitCode = 1
    })
  }
}
