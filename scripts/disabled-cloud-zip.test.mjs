import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('../app/', import.meta.url))
const appRequire = createRequire(join(appRoot, 'package.json'))
const cliRequire = createRequire(appRequire.resolve('@dcloudio/uni-cli-shared/package.json'))

test('DCloud resolves the controlled ZIP denial package instead of the vulnerable archive library', () => {
  const expected = realpathSync(join(appRoot, 'vendor/disabled-cloud-zip/index.cjs'))
  assert.equal(realpathSync(cliRequire.resolve('adm-zip')), expected)
  assert.equal(realpathSync(appRequire.resolve('adm-zip')), expected)
  assert.equal(cliRequire('adm-zip/package.json').name, '@caaci/disabled-cloud-zip')
  const lock = JSON.parse(readFileSync(join(appRoot, 'package-lock.json'), 'utf8'))
  const rows = Object.entries(lock.packages).filter(([path]) => path.endsWith('/adm-zip'))
  assert.equal(rows.length, 1)
  assert.equal(rows[0][1].link, true)
  assert.equal(resolve(appRoot, rows[0][1].resolved), join(appRoot, 'vendor/disabled-cloud-zip'))
})

test('cloud ZIP packing and extraction fail before touching a destination symlink', () => {
  const dir = mkdtempSync(join(tmpdir(), 'disabled-cloud-zip-'))
  try {
    const outside = join(dir, 'outside.txt'), link = join(dir, 'destination-link')
    writeFileSync(outside, 'must remain unchanged')
    symlinkSync(outside, link)
    const Zip = cliRequire('adm-zip')
    assert.throws(() => new Zip().writeZip(link), /cloud compilation is disabled/)
    assert.throws(() => new Zip(Buffer.from('untrusted archive')).extractAllTo(dir, true), /cloud compilation is disabled/)
    assert.throws(() => new Zip(link).extractEntryTo('payload', dir, false, true), /cloud compilation is disabled/)
    assert.equal(readFileSync(outside, 'utf8'), 'must remain unchanged')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
