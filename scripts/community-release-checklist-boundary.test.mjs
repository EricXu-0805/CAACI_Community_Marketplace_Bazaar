import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const sha256 = value => createHash('sha256').update(value).digest('hex')
const cells = line => line.trim().split('|').slice(1, -1)
  .map(cell => cell.trim().replace(/^`(.*)`$/, '$1'))

test('community release tables match every pending migration and its hosted SQL bytes', async () => {
  const source = await readFile(new URL('RUNBOOK.md', root), 'utf8')
  const heading = '### Community P3+P4 release\n'
  const start = source.indexOf(heading)
  assert.ok(start >= 0, 'the community release section must exist')
  const section = source.slice(start + heading.length).split(/\n### /)[0]
  const tables = section.split(/\n\s*\n/).filter(block => block.startsWith('|'))
  assert.ok(tables.length >= 2, 'migration bytes and SQL directives must both be tabulated')
  const migrationLines = tables[0].split('\n')
  assert.deepEqual(cells(migrationLines[0]),
    ['Migration file', 'File SHA-256', 'BEGIN line', 'COMMIT line', 'Sent SQL SHA-256'])
  const migrations = migrationLines.slice(2).map(cells)
  const files = (await readdir(new URL('supabase/migrations/', root)))
    .filter(file => /^\d{14}_.+\.sql$/.test(file) && file.slice(0, 14) > '20261114015420')
    .sort()
  assert.deepEqual(migrations.map(row => row[0]), files,
    'the table must contain every pending migration, once, in timestamp order')
  for (let index = 1; index < files.length; index++) {
    assert.ok(files[index - 1].slice(0, 14) < files[index].slice(0, 14),
      'migration timestamps must increase strictly')
  }
  for (const row of migrations) {
    assert.equal(row.length, 5)
    const [file, expectedHash, expectedBegin, expectedCommit, expectedPayloadHash] = row
    const bytes = await readFile(new URL('supabase/migrations/' + file, root))
    assert.equal(sha256(bytes), expectedHash, file + ': file hash')
    const lines = bytes.toString('utf8').split('\n')
    const begin = lines.flatMap((line, index) => line === 'BEGIN;' ? [index + 1] : [])
    const commit = lines.flatMap((line, index) => line === 'COMMIT;' ? [index + 1] : [])
    assert.equal(begin.length, 1, file + ': exactly one top-level BEGIN')
    assert.equal(commit.length, 1, file + ': exactly one top-level COMMIT')
    assert.equal(String(begin[0]), expectedBegin, file + ': BEGIN line')
    assert.equal(String(commit[0]), expectedCommit, file + ': COMMIT line')
    const payload = lines.filter((_, index) => index + 1 !== begin[0] && index + 1 !== commit[0]).join('\n')
    assert.equal(sha256(payload), expectedPayloadHash, file + ': sent SQL hash')
  }

  const operationLines = tables[1].split('\n')
  assert.deepEqual(cells(operationLines[0]), ['PRECHECK or VERIFY file', 'Remove line'])
  const operations = operationLines.slice(2).map(cells)
  const expectedOperations = files.flatMap(file => ['PRECHECK_' + file, 'VERIFY_' + file])
    .concat('VERIFY_reply_notice_switch.sql')
  assert.deepEqual(operations.map(row => row[0]), expectedOperations,
    'every migration needs its own PRECHECK and VERIFY, followed by the reply switch check')
  for (const row of operations) {
    assert.equal(row.length, 2)
    const [file, position] = row
    const lines = (await readFile(new URL('supabase/_ops/' + file, root), 'utf8')).split('\n')
    const directives = lines.flatMap((line, index) => line === '\\set ON_ERROR_STOP on' ? [index + 1] : [])
    assert.equal(directives.length, 1, file + ': exactly one client directive')
    assert.equal(String(directives[0]), position, file + ': directive line')
    assert.equal(lines[Number(position) - 1], '\\set ON_ERROR_STOP on', file)
  }
})
