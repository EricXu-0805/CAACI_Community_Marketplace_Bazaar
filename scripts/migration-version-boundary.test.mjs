import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'

const MIGRATIONS_DIR = new URL('../supabase/migrations/', import.meta.url)
const MIGRATION_MANIFEST = new URL(
  '../supabase/migrations/manifest.sha256',
  import.meta.url,
)
const FROZEN_THROUGH_VERSION = '20260719083511'
const FROZEN_LEGACY_FILENAME_DIGEST =
  '5fce4fe8af5334f8a39a8aacc9cd7a5198ea97f4e946d826da66250aebd456bc'
const FROZEN_TIMESTAMP_FILENAME_DIGEST =
  '646afe15e791b73b4d2145f6d00d4545e3373edfd692b8b0eb42da45304fd3c7'
const FROZEN_MIGRATION_ENTRY_DIGEST =
  '23da2ce7d2784cbc87a7900e84948e42c26956c008a1f563e8cd4e8ef4ac09b6'
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
const LEGACY_DUPLICATE_ALLOWLIST = new Map([
  ['014', ['014_condition_defective.sql', '014_image_dimensions.sql']],
  ['015', ['015_content_i18n.sql', '015_plaza_item_tag.sql']],
])
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

test('migration versions are unique except for the two documented legacy collisions', async () => {
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

  assert.deepEqual(
    collisions,
    [...LEGACY_DUPLICATE_ALLOWLIST],
    'a new duplicate migration version was introduced; use a unique 14-digit UTC timestamp',
  )
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

  for (const entry of entries) {
    const bytes = await readFile(new URL(entry.file, MIGRATIONS_DIR))
    assert.equal(
      sha256(bytes),
      entry.hash,
      `immutable migration bytes changed: ${entry.file}; add a later forward migration instead`,
    )
  }
})

test('legacy duplicate versions stay explicitly documented without rewriting history', async () => {
  const operationsReadme = await readFile(
    new URL('../supabase/_ops/README.md', import.meta.url),
    'utf8',
  )
  for (const [version, names] of LEGACY_DUPLICATE_ALLOWLIST) {
    assert.match(operationsReadme, new RegExp(`DB-01[^]*${version}`, 'i'))
    for (const name of names) {
      assert.match(operationsReadme, new RegExp(name.replace('.', '\\.')))
    }
  }
  assert.match(operationsReadme, /不要直接重命名已经上线的文件/)
  assert.match(operationsReadme, /唯一的 14 位时间戳迁移/)
})
