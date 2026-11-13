import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/utils/region.ts', import.meta.url), 'utf8')
const moduleUrl = `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString('base64')}`
const { REGIONS, ACTIVE_REGION, showRegionSwitcher, regionLabel } = await import(moduleUrl)

test('one active region, Champaign-Urbana, and no switcher while it is the only one', () => {
  assert.deepEqual(REGIONS, [{ slug: 'cu', zh: '香槟', en: 'Champaign-Urbana' }])
  assert.equal(ACTIVE_REGION, 'cu')
  assert.equal(showRegionSwitcher(), false)
  assert.equal(regionLabel('zh'), '香槟')
  assert.equal(regionLabel('en'), 'Champaign-Urbana')
})

test('a second region brings the switcher and its own label', () => {
  const regions = [...REGIONS, { slug: 'chi', zh: '芝加哥', en: 'Chicago' }]
  assert.equal(showRegionSwitcher(regions), true)
  assert.equal(regionLabel('zh', 'chi', regions), '芝加哥')
  assert.equal(regionLabel('en', 'missing', regions), '')
})
