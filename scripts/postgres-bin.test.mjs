import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { postgresBinDir } from './_postgres-bin.mjs'

function binDir(root, name) {
  const dir = join(root, name)
  mkdirSync(dir)
  writeFileSync(join(dir, 'initdb'), '')
  return dir
}

test('postgresBinDir resolves PG_BIN_DIR, fails in CI, skips locally, and falls back in order', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pg-bin-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const missing = join(root, 'missing')
  const first = binDir(root, 'first')
  const second = binDir(root, 'second')

  await t.test('an invalid pinned directory throws under CI instead of searching further', () => {
    assert.throws(() => postgresBinDir({ CI: 'true', PG_BIN_DIR: missing }, [first]), /postgresql_17_required_in_ci/)
  })

  await t.test('an invalid pinned directory returns null outside CI', () => {
    assert.equal(postgresBinDir({ PG_BIN_DIR: missing }, [first]), null)
  })

  await t.test('a valid PG_BIN_DIR is returned as is', () => {
    assert.equal(postgresBinDir({ CI: 'true', PG_BIN_DIR: second }, [first]), second)
  })

  await t.test('with neither variable set the defaults are tried in order', () => {
    assert.equal(postgresBinDir({}, [missing, second, first]), second)
    assert.equal(postgresBinDir({}, [first, second]), first)
    assert.equal(postgresBinDir({}, [missing]), null)
  })
})
