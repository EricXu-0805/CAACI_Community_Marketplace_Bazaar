import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { readMigration } from './fixtures/community-p3-database.mjs'
import { MIGRATION, VERIFY, readOps } from './fixtures/community-member-events-database.mjs'

const INVISIBLE = String.raw`[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069]`
const INVISIBLE_CODES = [173,6158,8203,8204,8205,8206,8207,8234,8235,8236,8237,8238,8288,8289,8290,8291,8292,8294,8295,8296,8297]

test('SQL and client share the printable invisible-character policy', () => {
  const migration = readMigration(MIGRATION)
  const clientSource = readFileSync(new URL('../app/src/utils/communityEvents.ts', import.meta.url), 'utf8')
  const classes = [...migration.matchAll(/pg_catalog\.regexp_replace\((?!pg_catalog\.regexp_replace\()([^\n]*?), '(\[[^']+\])', '', 'g'\)/g)].map(match => match[2])
  assert.deepEqual([...new Set(classes)], [INVISIBLE])
  assert.equal(Buffer.byteLength(INVISIBLE), 66)
  assert.match(INVISIBLE, /^[\x20-\x7E]+$/)
  const client = /EVENT_INVISIBLE\s*=\s*\/(\[[^\n]+?\])\/g/.exec(clientSource)
  assert.ok(client)
  assert.equal(client[1], INVISIBLE)
  for (const source of [migration, readOps(VERIFY), clientSource]) {
    for (const code of INVISIBLE_CODES) {
      assert.ok(!source.includes(String.fromCodePoint(code)), `raw invisible U+${code.toString(16).toUpperCase()}`)
    }
  }
})
