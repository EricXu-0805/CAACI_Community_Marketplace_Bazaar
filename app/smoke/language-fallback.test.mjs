import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const read = name => readFileSync(new URL(`../src/composables/i18n/${name}.ts`, import.meta.url), 'utf8')
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const types = {}
new Function('exports', compile(read('types')))(types)
const detect = {}
new Function('exports', 'require', compile(read('detect')))(detect, () => types)

test('unknown locale falls back to English while Simplified Chinese remains available', () => {
  assert.equal(types.DEFAULT_LANG, 'en')
  for (const locale of ['', undefined, null, 'ja-JP', 'ko', 'en-US', 'zh-Hant', 'zh-TW', 'zh_HK']) {
    assert.equal(detect.resolveSystemLang(locale), 'en', String(locale))
  }
  for (const locale of ['zh', 'zh-CN', 'zh-SG', 'zh-Hans', 'zh_CN']) {
    assert.equal(detect.resolveSystemLang(locale), 'zh', locale)
  }
  assert.equal(types.coerceLang('zh'), 'zh')
  assert.equal(types.coerceLang('en'), 'en')
  assert.equal(types.coerceLang('ja'), null)
})
