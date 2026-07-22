import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'

const MIGRATIONS_DIR = new URL('../supabase/migrations/', import.meta.url)
const MIGRATION_MANIFEST = new URL(
  '../supabase/migrations/manifest.sha256',
  import.meta.url,
)
const FROZEN_THROUGH_VERSION = '20260719174928'
const FROZEN_LEGACY_FILENAME_DIGEST =
  '6a0f6cafca3534c99c5298b0e972b2f032240220b731916133c700096d0ea515'
const FROZEN_TIMESTAMP_FILENAME_DIGEST =
  '8a72fed57c6814f1bba6b0219e3379e369843afe79fe8f3fd7985945bc48bec2'
const FROZEN_MIGRATION_ENTRY_DIGEST =
  'df743ae34921941ad7d9ec61854c50eebf34c3956ac628637f1dab4c75a90d58'
// These two historical-byte repairs are exceptional and independently pinned:
// 014 removes an impossible migration-version collision for clean branches;
// 19151729 accepts the equivalent PG17 composite-row deparser order discovered
// by the official clean replay. Forward migrations converge hosted databases.
const REVIEWED_FROZEN_REPAIRS = new Map([
  [
    '014_condition_defective.sql',
    '687e51a5cf4785e515a6cc5b099b47623092123e97b6a7790490e6b82165d0aa',
  ],
  [
    '20260719151729_reconcile_plaza_base_table_acl.sql',
    '38b6d8f5591723bb5bb39d0c19827e0cc7c87d3b6ebc6cc09726734e75a3a583',
  ],
])
// These five already-frozen filenames used tranche numbers 24-28 in the hour
// slot before the repository adopted real UTC timestamps. Their exact names
// and bytes remain immutable; every later migration must pass the UTC parser.
const FROZEN_NON_UTC_VERSION_ALLOWLIST = new Set([
  '20260718240000',
  '20260718250000',
  '20260718260000',
  '20260718270000',
  '20260718280000',
])
const FORENSIC_ARCHIVES = new Map([
  [
    '014_image_dimensions.sql.frozen',
    'e9ca084686661d2842981e66298a6cb3dab9c4bc2e0a7947a4fc896526ff3002',
  ],
  [
    '015_plaza_item_tag.sql.frozen',
    'fca3f3941ee49f3041fb0a50a1a564199326b41caffbb8681d9bacea0c4df114',
  ],
])
const FORENSIC_DIR = new URL(
  '../supabase/_ops/forensics/legacy-version-collisions/',
  import.meta.url,
)
const REVIEWED_HISTORY_ARCHIVES = new Map([
  [
    '014_condition_defective.sql.pre-collision-repair.frozen',
    '3786a03b60787aa1b3a8642f6656d4b6971a174a7afa3339c5f009a631595a29',
  ],
  [
    '20260719151729_reconcile_plaza_base_table_acl.sql.pre-pg17-replay-repair.frozen',
    '2232d8b5c9739974db2a667e175880f59dde89d301c4a7a58362d83b1dd96620',
  ],
])
const REVIEWED_HISTORY_DIR = new URL(
  '../supabase/_ops/forensics/reviewed-history-repairs/',
  import.meta.url,
)
const CANONICAL_014 = new URL(
  '../supabase/migrations/014_condition_defective.sql',
  import.meta.url,
)
const CANONICAL_015 = new URL(
  '../supabase/migrations/015_content_i18n.sql',
  import.meta.url,
)
const LEGACY_RECONCILIATION = new URL(
  '../supabase/migrations/20260722033904_reconcile_legacy_migration_versions.sql',
  import.meta.url,
)
const LEGACY_NAME = /^(\d{3})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/
const TIMESTAMP_NAME = /^(\d{14})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function migrationFiles() {
  return (await readdir(MIGRATIONS_DIR))
    .filter(name => name.endsWith('.sql'))
    .sort()
}

function validUtcVersion(version) {
  const year = Number(version.slice(0, 4))
  const month = Number(version.slice(4, 6))
  const day = Number(version.slice(6, 8))
  const hour = Number(version.slice(8, 10))
  const minute = Number(version.slice(10, 12))
  const second = Number(version.slice(12, 14))
  if (year < 2000) return false
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  const roundTrip = [
    parsed.getUTCFullYear().toString().padStart(4, '0'),
    (parsed.getUTCMonth() + 1).toString().padStart(2, '0'),
    parsed.getUTCDate().toString().padStart(2, '0'),
    parsed.getUTCHours().toString().padStart(2, '0'),
    parsed.getUTCMinutes().toString().padStart(2, '0'),
    parsed.getUTCSeconds().toString().padStart(2, '0'),
  ].join('')
  return roundTrip === version
}

async function parseManifest() {
  const source = await readFile(MIGRATION_MANIFEST, 'utf8')
  assert.match(
    source,
    new RegExp(`^# frozen-through-version: ${FROZEN_THROUGH_VERSION}$`, 'm'),
    'migration manifest frozen-through marker drifted',
  )
  const entries = []
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^([0-9a-f]{64})  ([^/\\]+\.sql)$/.exec(line)
    assert.ok(match, `malformed migration manifest line ${index + 1}`)
    entries.push({ hash: match[1], file: match[2] })
  }
  assert.equal(
    new Set(entries.map(entry => entry.file)).size,
    entries.length,
    'duplicate migration filename in byte manifest',
  )
  return entries
}

test('every migration version is unique', async () => {
  const files = await migrationFiles()

  const byVersion = new Map()
  for (const file of files) {
    const match = /^(\d+)_/.exec(file)
    assert.ok(match, `migration filename has no numeric version: ${file}`)
    const list = byVersion.get(match[1]) || []
    list.push(file)
    byVersion.set(match[1], list)
  }

  const collisions = [...byVersion]
    .filter(([, names]) => names.length > 1)
    .map(([version, names]) => [version, names.sort()])

  assert.deepEqual(collisions, [],
    'a duplicate migration version was introduced; use a unique 14-digit UTC timestamp')
})

test('legacy names are frozen and every forward migration uses a real 14-digit UTC version', async () => {
  const files = await migrationFiles()
  const legacyFiles = []
  const frozenTimestampFiles = []

  for (const file of files) {
    const legacy = LEGACY_NAME.exec(file)
    if (legacy) {
      assert.ok(
        legacy[1] <= '089',
        `new three-digit migration is forbidden; use a 14-digit UTC version: ${file}`,
      )
      legacyFiles.push(file)
      continue
    }

    const timestamp = TIMESTAMP_NAME.exec(file)
    assert.ok(timestamp, `invalid forward migration filename: ${file}`)
    if (!validUtcVersion(timestamp[1])) {
      assert.ok(
        timestamp[1] <= FROZEN_THROUGH_VERSION
          && FROZEN_NON_UTC_VERSION_ALLOWLIST.has(timestamp[1]),
        `migration version is not a real UTC timestamp: ${file}`,
      )
    }
    if (timestamp[1] <= FROZEN_THROUGH_VERSION) frozenTimestampFiles.push(file)
  }

  assert.equal(
    sha256(legacyFiles.join('\n')),
    FROZEN_LEGACY_FILENAME_DIGEST,
    'legacy migration names are immutable; reconcile the remote ledger instead of adding/renaming legacy files',
  )
  assert.equal(
    sha256(frozenTimestampFiles.join('\n')),
    FROZEN_TIMESTAMP_FILENAME_DIGEST,
    `a migration was inserted at or before the frozen ${FROZEN_THROUGH_VERSION} boundary; add a later forward migration`,
  )
})

test('migration SHA-256 manifest exactly guards every current SQL byte sequence', async () => {
  const [files, entries] = await Promise.all([
    migrationFiles(),
    parseManifest(),
  ])
  const manifestFiles = entries.map(entry => entry.file)
  assert.deepEqual(
    manifestFiles,
    [...manifestFiles].sort(),
    'migration byte manifest must stay filename-sorted',
  )
  assert.deepEqual(
    manifestFiles,
    files,
    'migration byte manifest must contain every and only migration SQL file',
  )

  const frozenEntries = entries.filter(entry => {
    const version = /^(\d+)_/.exec(entry.file)?.[1]
    assert.ok(version, `manifest migration has no numeric version: ${entry.file}`)
    return version.length === 3 || version <= FROZEN_THROUGH_VERSION
  })
  assert.equal(
    sha256(
      frozenEntries
        .map(entry => `${entry.hash}  ${entry.file}`)
        .join('\n'),
    ),
    FROZEN_MIGRATION_ENTRY_DIGEST,
    `migration bytes at or before ${FROZEN_THROUGH_VERSION} are frozen; restore them and add a later forward migration`,
  )

  for (const [file, expectedHash] of REVIEWED_FROZEN_REPAIRS) {
    const entry = entries.find(candidate => candidate.file === file)
    assert.equal(entry?.hash, expectedHash, `${file}: reviewed repair hash drifted`)
  }

  for (const entry of entries) {
    const bytes = await readFile(new URL(entry.file, MIGRATIONS_DIR))
    assert.equal(
      sha256(bytes),
      entry.hash,
      `immutable migration bytes changed: ${entry.file}; add a later forward migration instead`,
    )
  }
})

test('repaired legacy collisions preserve forensic bytes and require guarded forward convergence', async () => {
  const [operationsReadme, canonical014, canonical015, reconciliation] =
    await Promise.all([
      readFile(new URL('../supabase/_ops/README.md', import.meta.url), 'utf8'),
      readFile(CANONICAL_014, 'utf8'),
      readFile(CANONICAL_015, 'utf8'),
      readFile(LEGACY_RECONCILIATION, 'utf8'),
    ])

  for (const [archive, expectedHash] of FORENSIC_ARCHIVES) {
    const bytes = await readFile(new URL(archive, FORENSIC_DIR))
    assert.equal(sha256(bytes), expectedHash, `${archive}: forensic bytes drifted`)
    assert.match(operationsReadme, new RegExp(archive.replace('.', '\\.')))
  }

  assert.match(canonical014, /ADD COLUMN IF NOT EXISTS image_dimensions jsonb/)
  assert.match(canonical015, /ADD COLUMN IF NOT EXISTS title_i18n jsonb/)
  assert.match(reconciliation, /^BEGIN;$/m)
  assert.match(reconciliation, /^SET LOCAL lock_timeout = '5s';$/m)
  assert.equal(reconciliation.trimEnd().endsWith('COMMIT;'), true)
  assert.match(reconciliation, /ALTER TYPE public\.item_condition ADD VALUE IF NOT EXISTS 'defective'/)
  assert.match(reconciliation, /ADD COLUMN IF NOT EXISTS image_dimensions jsonb/)
  assert.match(reconciliation, /ADD COLUMN IF NOT EXISTS title_i18n jsonb/)
  assert.match(reconciliation, /post_items_oid oid := pg_catalog\.to_regclass\('public\.post_items'\)/)
  assert.match(reconciliation, /IF post_items_oid IS NULL THEN/)
  assert.match(reconciliation, /INSERT INTO public\.post_items \(post_id, item_id, display_order\)/)
  assert.match(reconciliation, /inserted_count IS DISTINCT FROM missing_before_count/)
  assert.match(reconciliation, /legacy attachment equivalence proof failed/)
  assert.match(reconciliation, /DROP COLUMN IF EXISTS attached_item_id/)
  assert.match(operationsReadme, /唯一的 14 位时间戳迁移/)
  assert.match(operationsReadme, /不要把取证副本移回 `migrations\/`/)
})

test('reviewed historical repairs retain the prior bytes and document ledger byte divergence', async () => {
  const [operationsReadme, runbook] = await Promise.all([
    readFile(new URL('../supabase/_ops/README.md', import.meta.url), 'utf8'),
    readFile(new URL('../RUNBOOK.md', import.meta.url), 'utf8'),
  ])

  for (const [archive, expectedHash] of REVIEWED_HISTORY_ARCHIVES) {
    const bytes = await readFile(new URL(archive, REVIEWED_HISTORY_DIR))
    assert.equal(sha256(bytes), expectedHash, `${archive}: reviewed history bytes drifted`)
    assert.match(operationsReadme, new RegExp(archive.replaceAll('.', '\\.')))
  }

  for (const source of [operationsReadme, runbook]) {
    assert.match(source, /schema-convergent but byte-divergent/)
    assert.match(source, /ledger does not\s+store SQL content hashes/i)
    assert.match(source, /manifest[^\n]*current replay bytes/i)
  }
})
