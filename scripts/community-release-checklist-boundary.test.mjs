import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const sha256 = value => createHash('sha256').update(value).digest('hex')
// A NOTICE cell escapes its pipe; split only on unescaped pipes.
const cells = line => line.trim().split(/(?<!\\)\|/).slice(1, -1)
  .map(cell => cell.trim().replace(/^`(.*)`$/, '$1').replaceAll('\\|', '|'))
// Applied to staging and production on 2026-11-26 (D-61 item 0). A later
// release section takes every migration after this one.
const RELEASED_THROUGH = '20261125004742'
const RELEASED = [
  '20261120100354_community_watch_save_activity.sql',
  '20261120122054_community_events.sql',
  '20261122035253_community_member_events.sql',
  '20261123201501_community_event_sync.sql',
  '20261125004742_community_event_sync_cap.sql',
]
const MEMBER = 'VERIFY_20261122035253_community_member_events.sql'
const REPLY = 'VERIFY_reply_notice_switch.sql'

function sectionOf(source, heading) {
  const start = source.indexOf(heading + '\n')
  return start < 0 ? null : source.slice(start + heading.length + 1).split(/\n#{2,3} /)[0]
}

async function migrationFiles() {
  return (await readdir(new URL('supabase/migrations/', root))).filter(file => /^\d{14}_.+\.sql$/.test(file)).sort()
}

// One release section: its bytes, directive and step tables, the stated order
// and the first errors of the VERIFY files it supersedes.
async function checkRelease(source, { heading, files, rechecks, suffix, firstErrors, deep = true }) {
  const section = sectionOf(source, heading)
  assert.ok(section !== null, heading + ' must exist and list ' + files.join(', '))
  const tables = section.split(/\n\s*\n/).filter(block => block.startsWith('|'))
  assert.ok(tables.length >= (deep ? 3 : 2), heading + ': bytes, directives and steps must be tabulated')
  const migrationLines = tables[0].split('\n')
  assert.deepEqual(cells(migrationLines[0]),
    ['Migration file', 'File SHA-256', 'BEGIN line', 'COMMIT line', 'Sent SQL SHA-256'])
  const migrations = migrationLines.slice(2).map(cells)
  assert.deepEqual(migrations.map(row => row[0]), files, heading + ': every migration, once, in timestamp order')
  for (let index = 1; index < files.length; index++) {
    assert.ok(files[index - 1].slice(0, 14) < files[index].slice(0, 14), heading + ': migration timestamps must increase strictly')
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
  const own = files.flatMap(file => ['PRECHECK_' + file, 'VERIFY_' + file])
  assert.deepEqual(operations.map(row => row[0]), own.concat(rechecks.filter(file => !own.includes(file))),
    heading + ': every migration needs its own PRECHECK and VERIFY, followed by the rechecks')
  for (const row of operations) {
    assert.equal(row.length, 2)
    const [file, position] = row
    const lines = (await readFile(new URL('supabase/_ops/' + file, root), 'utf8')).split('\n')
    const directives = lines.flatMap((line, index) => line === '\\set ON_ERROR_STOP on' ? [index + 1] : [])
    assert.equal(directives.length, 1, file + ': exactly one client directive')
    assert.equal(String(directives[0]), position, file + ': directive line')
    assert.equal(lines[Number(position) - 1], '\\set ON_ERROR_STOP on', file)
  }
  if (!deep) return

  const stepLines = tables[2].split('\n')
  assert.deepEqual(cells(stepLines[0]), ['Step', 'Operation', 'File', 'Expected NOTICE'])
  const steps = stepLines.slice(2).map(cells)
  assert.deepEqual(steps.map(row => row[0]), steps.map((_, index) => String(index + 1)), heading + ': steps are numbered 1..N')
  assert.deepEqual(steps.map(row => [row[1], row[2]]), files
    .flatMap(file => [['PRECHECK', 'PRECHECK_' + file], ['APPLY', file], ['VERIFY', 'VERIFY_' + file]])
    .concat(rechecks.map(file => ['VERIFY', file])),
  heading + ': each migration is prechecked, applied and verified in timestamp order, then the rechecks run')
  for (const [, operation, file, notice] of steps) {
    if (operation === 'APPLY') { assert.equal(notice, 'none', file); continue }
    const sql = await readFile(new URL('supabase/_ops/' + file, root), 'utf8')
    const raised = [...sql.matchAll(/RAISE NOTICE '([^']+)'/g)].map(match => match[1].replace('%', 'f'))
    assert.deepEqual(raised, notice === 'none' ? [] : [notice], file + ': expected NOTICE')
  }
  assert.ok(section.replace(/\s+/g, ' ').includes('The order is ' + files.map(file => '`' + file.slice(0, 14) + '`').join(' → ') + suffix),
    heading + ': the prose order names every migration in timestamp order')

  const found = [...section.matchAll(/^- After `?(\d{14}|B)`?, VERIFY_(\d{14}):\n {2}`([^`]+)`\.$/gm)]
  assert.deepEqual(found.map(match => [match[1], match[2]]), firstErrors, heading + ': superseded VERIFY first errors')
  for (const [, after, verified, error] of found) {
    const replacing = after === 'B' ? files.at(-1) : files.find(file => file.startsWith(after))
    const run = files.find(file => file.startsWith(verified))
    const [prefix, signature, md5] = error.split(':')
    const runSql = await readFile(new URL('supabase/_ops/VERIFY_' + run, root), 'utf8')
    const replacingSql = await readFile(new URL('supabase/_ops/VERIFY_' + replacing, root), 'utf8')
    assert.ok(runSql.includes(`RAISE EXCEPTION '${prefix}:`), error + ': prefix raised by the superseded VERIFY')
    assert.ok(runSql.includes(`'${signature}'`), error + ': signature checked by the superseded VERIFY')
    assert.match(md5, /^[0-9a-f]{32}$/)
    assert.ok(replacingSql.includes(`'${md5}'`), error + ': md5 is what the replacing VERIFY pins')
  }
}

test('the applied P3+P4 release keeps its five migrations and its hosted SQL bytes', async () => {
  const files = await migrationFiles()
  assert.deepEqual(files.filter(file => file.slice(0, 14) > '20261114015420' && file.slice(0, 14) <= RELEASED_THROUGH), RELEASED,
    'the applied release section is closed; a new migration belongs to a later section')
  await checkRelease(await readFile(new URL('RUNBOOK.md', root), 'utf8'), {
    heading: '### Community P3+P4 release', files: RELEASED, rechecks: [MEMBER, REPLY], suffix: ' (B).',
    firstErrors: [['20261120122054', '20261120100354'], ['20261122035253', '20261120122054'], ['B', '20261123201501']],
  })
})

test('every migration after the applied release is in the campus checks release', async () => {
  const pending = (await migrationFiles()).filter(file => file.slice(0, 14) > RELEASED_THROUGH)
  const source = await readFile(new URL('RUNBOOK.md', root), 'utf8')
  if (!pending.length) {
    assert.equal(sectionOf(source, '### Community campus checks release'), null, 'no pending migration, no release section')
    return
  }
  await checkRelease(source, {
    heading: '### Community campus checks release', files: pending,
    rechecks: ['VERIFY_20261125004742_community_event_sync_cap.sql', MEMBER, REPLY], suffix: ' (C).', firstErrors: [],
  })
})
