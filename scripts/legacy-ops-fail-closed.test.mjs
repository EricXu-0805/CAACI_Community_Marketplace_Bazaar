import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'

const OPS = new URL('../supabase/_ops/', import.meta.url)

test('historical RUN_ dashboard bundles fail before any obsolete mutation', async () => {
  const names = (await readdir(OPS)).filter(name => /^RUN.*\.sql$/.test(name)).sort()
  assert.ok(names.length > 0)

  for (const name of names) {
    const source = await readFile(new URL(name, OPS), 'utf8')
    const guard = source.indexOf('DO $deprecated_operator_bundle$')
    const rejection = source.indexOf('deprecated_operator_bundle: use the reviewed timestamped migration chain')
    assert.ok(guard >= 0, `${name} has no fail-closed guard`)
    assert.ok(rejection > guard, `${name} has no explicit deprecation error`)

    const firstLegacyMutation = source.search(/\n(?:BEGIN;|CREATE\s|ALTER\s|INSERT\s|UPDATE\s|DELETE\s)/i)
    assert.ok(firstLegacyMutation < 0 || guard < firstLegacyMutation, `${name} mutates before its guard`)
    assert.match(source.slice(0, guard), /\\set ON_ERROR_STOP on/)
  }
})
