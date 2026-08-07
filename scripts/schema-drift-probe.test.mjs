import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const PROBE = new URL('./schema-drift-probe.mjs', import.meta.url)

function runProbe() {
  return execFileSync(process.execPath, [PROBE.pathname], { encoding: 'utf8' })
}

test('the probe emits one read-only SQL statement over the declared objects', () => {
  const sql = runProbe()
  const rows = [...sql.matchAll(/^ {2}\('([a-z]+)','([a-z_]+)','(.*)'\),?$/gm)]
  assert.ok(rows.length > 300, `expected the repo to declare hundreds of objects, got ${rows.length}`)

  // Read-only is the whole premise: this text gets pasted into a production
  // SQL editor by an operator who is trusting the filename. Object names
  // legitimately contain verbs (delete_my_account), so check statement starts,
  // not substrings, and check that there is exactly one statement.
  assert.match(sql, /^with declared\(kind, schema, name\) as \(values$/m)
  assert.doesNotMatch(sql, /^\s*(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/im)
  assert.equal(sql.split(';').length - 1, 1, 'the probe must be a single statement')

  // A separator that can appear inside an object name would silently merge or
  // split entries. Policy names contain spaces, so only commas are load-bearing.
  for (const [, , , name] of rows) assert.doesNotMatch(name, /,/)
})

test('comments never contribute objects', async () => {
  // Both of these are real lines from real migrations. Before comments were
  // stripped they produced a table called `must` and a trigger called `ON`,
  // each of which then reported as permanently missing from every database.
  const sql = runProbe()
  assert.doesNotMatch(sql, /'(table|view|index)','[a-z_]+','must'\)/)
  assert.doesNotMatch(sql, /'trigger','[a-z_]+','ON'\)/i)

  const withComments = await readFile(
    new URL('../supabase/migrations/047_storage_block_active_mime.sql', import.meta.url),
    'utf8',
  )
  assert.match(withComments, /--[^\n]*CREATE TRIGGER ON/i, 'the comment this guards has moved')
})

test('objects declared outside public keep their schema', () => {
  const sql = runProbe()
  // private.item_deals is a real production table. A public-only probe reports
  // it missing, which is how the schema bug in this script was found.
  assert.match(sql, /\('table','private','item_deals'\)/)
  assert.match(sql, /\('function','private','[a-z_]+'\)/)
})

test('every ignored object carries a reason and an exit condition', async () => {
  const source = await readFile(PROBE, 'utf8')
  const entries = [...source.matchAll(/JSON\.stringify\(\[[^\]]+\]\),/g)]
  assert.ok(entries.length > 0, 'IGNORED became empty — delete the mechanism instead')
  // One "Drop this entry once ..." per suppressed object: an exemption without
  // a stated exit condition is how a real gap becomes permanent.
  assert.equal(
    [...source.matchAll(/Drop this entry once/g)].length,
    entries.length,
    'each IGNORED entry needs its own exit condition',
  )
})
