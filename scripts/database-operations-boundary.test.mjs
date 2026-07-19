import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'

const OPS_DIR = new URL('../supabase/_ops/', import.meta.url)
const RUNBOOK = new URL('../RUNBOOK.md', import.meta.url)
const RELEASE_INDEX_MIGRATION = new URL(
  '../supabase/migrations/20260719030000_release_tail_indexes.sql',
  import.meta.url,
)
const ADMIN_PAGINATION_MIGRATION = new URL(
  '../supabase/migrations/20260719082600_deterministic_admin_pagination_order.sql',
  import.meta.url,
)
const FULL_FK_INDEX_MIGRATION = new URL(
  '../supabase/migrations/20260719083511_release_tail_full_fk_indexes.sql',
  import.meta.url,
)

async function operationFiles(prefix) {
  return (await readdir(OPS_DIR))
    .filter(file => {
      if (!file.endsWith('.sql')) return false
      if (file.startsWith(prefix)) return true
      if (prefix === 'PRECHECK_') return file.endsWith('_precheck.sql')
      if (prefix === 'VERIFY_') return file.endsWith('_verify.sql')
      return false
    })
    .sort()
}

function occurrenceCount(source, pattern) {
  return [...source.matchAll(pattern)].length
}

function lastExecutableLine(source) {
  return source
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('--'))
    .at(-1)
}

test('every PRECHECK and VERIFY is database-enforced read-only and rollback-only', async () => {
  const files = [
    ...await operationFiles('PRECHECK_'),
    ...await operationFiles('VERIFY_'),
  ]
  assert.ok(files.length > 0)
  assert.ok(
    files.includes('20260717143200_fix_moderation_status_enum_guard_verify.sql'),
    'legacy-named moderation VERIFY must remain inside the read-only boundary',
  )

  for (const file of files) {
    const source = await readFile(new URL(file, OPS_DIR), 'utf8')
    assert.match(source, /^\\set ON_ERROR_STOP on$/m, `${file}: psql must fail fast`)
    assert.equal(
      occurrenceCount(source, /^BEGIN;$/gm),
      1,
      `${file}: expected one top-level BEGIN`,
    )
    assert.equal(
      occurrenceCount(source, /^SET TRANSACTION READ ONLY;$/gm),
      1,
      `${file}: expected one enforced READ ONLY transaction`,
    )
    assert.equal(
      occurrenceCount(source, /^ROLLBACK;$/gm),
      1,
      `${file}: expected one final ROLLBACK`,
    )
    assert.doesNotMatch(source, /^COMMIT;$/m, `${file}: inspection scripts cannot commit`)

    const begin = source.indexOf('\nBEGIN;')
    const readOnly = source.indexOf('\nSET TRANSACTION READ ONLY;')
    const rollback = source.lastIndexOf('\nROLLBACK;')
    assert.ok(
      begin >= 0 && begin < readOnly && readOnly < rollback,
      `${file}: read-only transaction statements are out of order`,
    )
    assert.equal(
      lastExecutableLine(source),
      'ROLLBACK;',
      `${file}: ROLLBACK must be the final executable statement`,
    )
  }
})

test('rollback-only REGRESSION scripts never commit their synthetic fixtures', async () => {
  const files = [
    ...await operationFiles('REGRESSION_'),
    ...(await readdir(OPS_DIR))
      .filter(file => file.endsWith('_regression.sql'))
      .sort(),
  ]
  assert.ok(files.length > 0)
  for (const file of files) {
    const source = await readFile(new URL(file, OPS_DIR), 'utf8')
    assert.match(source, /^BEGIN;$/m, `${file}: regression transaction missing`)
    assert.doesNotMatch(source, /^COMMIT;$/m, `${file}: regression must never commit`)
    assert.equal(
      lastExecutableLine(source),
      'ROLLBACK;',
      `${file}: regression must end in ROLLBACK`,
    )
  }
})

test('1902 has a distinct predecessor precheck and bounded same-session rollout contract', async () => {
  const [precheck, runbook] = await Promise.all([
    readFile(
      new URL(
        'PRECHECK_20260719020000_admin_owner_recovery_concurrency.sql',
        OPS_DIR,
      ),
      'utf8',
    ),
    readFile(RUNBOOK, 'utf8'),
  ])
  assert.match(precheck, /pg_try_advisory_xact_lock\(20260718180000/)
  assert.match(precheck, /pg_try_advisory_xact_lock\(20260718190000/)
  assert.match(precheck, /public\.admin_tokens.*writers must drain first/s)
  assert.match(runbook, /PRECHECK_20260719020000_admin_owner_recovery_concurrency\.sql/)
  assert.match(runbook, /PGOPTIONS='-c lock_timeout=5s -c statement_timeout=2min'/)
  assert.match(runbook, /same database session/)
  assert.match(runbook, /ledger-aware migration executor/)
})

test('release indexes and deterministic admin pagination stay version ordered', async () => {
  const [
    runbook,
    indexMigration,
    indexPrecheck,
    indexVerify,
    paginationMigration,
    paginationPrecheck,
    paginationVerify,
    fullFkMigration,
    fullFkPrecheck,
    fullFkVerify,
  ] = await Promise.all([
    readFile(RUNBOOK, 'utf8'),
    readFile(RELEASE_INDEX_MIGRATION, 'utf8'),
    readFile(
      new URL('PRECHECK_20260719030000_release_tail_indexes.sql', OPS_DIR),
      'utf8',
    ),
    readFile(
      new URL('VERIFY_20260719030000_release_tail_indexes.sql', OPS_DIR),
      'utf8',
    ),
    readFile(ADMIN_PAGINATION_MIGRATION, 'utf8'),
    readFile(
      new URL(
        'PRECHECK_20260719082600_deterministic_admin_pagination_order.sql',
        OPS_DIR,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        'VERIFY_20260719082600_deterministic_admin_pagination_order.sql',
        OPS_DIR,
      ),
      'utf8',
    ),
    readFile(FULL_FK_INDEX_MIGRATION, 'utf8'),
    readFile(
      new URL(
        'PRECHECK_20260719083511_release_tail_full_fk_indexes.sql',
        OPS_DIR,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        'VERIFY_20260719083511_release_tail_full_fk_indexes.sql',
        OPS_DIR,
      ),
      'utf8',
    ),
  ])
  const start = runbook.indexOf('## 2026-07 candidate release sequence')
  const end = runbook.indexOf('\n---', start)
  const release = runbook.slice(start, end)
  const orderedVersions = [
    '20260718200000',
    '20260718210000',
    '20260718280000',
    '20260719010000',
    '20260719020000',
    '20260719030000',
    '20260719082600',
    '20260719083511',
  ]
  let previous = -1
  for (const version of orderedVersions) {
    const current = release.indexOf(version, previous + 1)
    assert.ok(current > previous, `release sequence is not version ordered at ${version}`)
    previous = current
  }
  assert.match(release, /current 31-migration audit/)
  assert.match(release, /90\s+historical \+ 31 candidate migrations/)
  assert.match(
    release,
    /\(cd supabase\/migrations && shasum -a 256 -c manifest\.sha256\)/,
  )

  assert.match(indexMigration, /SET LOCAL lock_timeout = '5s'/)
  assert.match(indexMigration, /SET LOCAL statement_timeout = '2min'/)
  assert.match(
    indexMigration,
    /admin_idempotency_reconciliation_fences_reconciled_by_idx/,
  )
  assert.match(indexMigration, /ON public\.meetups \(meet_at, id\)/)
  assert.match(
    indexMigration,
    /WHERE status = 'accepted' AND reminded_at IS NULL/,
  )
  assert.match(indexPrecheck, /exceeds 64 MiB/)
  assert.match(indexVerify, /foreign keys lack a valid leading btree index at release tail/)

  assert.match(
    paginationMigration,
    /ORDER BY suspension\.created_at DESC, suspension\.id DESC/,
  )
  assert.match(
    paginationMigration,
    /ORDER BY p\.is_pinned DESC, p\.created_at DESC, p\.id DESC/,
  )
  assert.match(paginationPrecheck, /20260719030000 release-tail indexes are missing/)
  assert.match(paginationVerify, /deterministic order missing/)
  assert.match(paginationVerify, /function ACL drifted/)

  assert.match(fullFkMigration, /SET LOCAL lock_timeout = '5s'/)
  assert.match(fullFkMigration, /SET LOCAL statement_timeout = '2min'/)
  assert.match(
    fullFkMigration,
    /CREATE INDEX IF NOT EXISTS reports_reporter_id_idx\s+ON public\.reports \(reporter_id\);/,
  )
  assert.match(
    fullFkMigration,
    /CREATE INDEX IF NOT EXISTS admin_tokens_admin_id_full_idx\s+ON public\.admin_tokens \(admin_id\);/,
  )
  assert.match(
    fullFkMigration,
    /CREATE INDEX IF NOT EXISTS suspensions_profile_id_full_idx\s+ON public\.suspensions \(profile_id\);/,
  )
  assert.match(fullFkPrecheck, /exceeds 64 MiB/)
  assert.match(fullFkPrecheck, /prepared-transaction:/)
  assert.match(fullFkPrecheck, /target writers must drain first/)
  assert.match(fullFkPrecheck, /required_target record;/)
  assert.doesNotMatch(fullFkPrecheck, /\btarget record;/)
  assert.match(fullFkVerify, /index_row\.indpred IS NULL/)
  assert.match(fullFkVerify, /single_column_name/)
  assert.match(fullFkVerify, /%I is not null/)
  assert.match(fullFkVerify, /lack a safe leading btree index at the real release tail/)
})
