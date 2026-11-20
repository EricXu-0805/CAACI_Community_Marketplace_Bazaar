import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { postgresBinDir } from './_postgres-bin.mjs'

const pgBin = postgresBinDir()

test('support email ledger enforces real PostgreSQL authorization, audit, replay, rate, and race boundaries', {
  skip: !pgBin && !process.env.CI ? 'PostgreSQL 16/17 unavailable locally; set PG_BIN' : false,
  timeout: 60_000,
}, context => {
  assert.ok(pgBin, 'CI requires PostgreSQL 16/17; set PG_BIN to its binaries')
  const output = execFileSync('python3', [
    fileURLToPath(new URL('../supabase/_ops/run_support_email_ledger_local.py', import.meta.url)),
  ], {
    // Prove inherited libpq routing hints cannot divert the disposable fixture.
    env: {
      ...process.env,
      PG_BIN: pgBin,
      PGHOSTADDR: '192.0.2.1',
      PGSSLMODE: 'verify-full',
      PGTARGETSESSIONATTRS: 'standby',
    },
    encoding: 'utf8',
    timeout: 55_000,
    maxBuffer: 1024 * 1024,
  })
  context.diagnostic(output.trim())
})
