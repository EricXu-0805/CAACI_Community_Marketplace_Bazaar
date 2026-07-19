import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(resolve(appRoot, 'src/composables/useTranslate.ts'), 'utf8')

test('account transitions reset memory while the owner boundary controls durable translation data', () => {
  const resetStart = source.indexOf('function resetTranslationMemory()')
  const clearStart = source.indexOf('export function clearTranslationCache()', resetStart)
  assert.ok(resetStart >= 0 && clearStart > resetStart)
  const resetBlock = source.slice(resetStart, clearStart)

  assert.match(resetBlock, /translateCacheGeneration\+\+/)
  assert.match(resetBlock, /for \(const ctrl of activeTranslateControllers\) ctrl\.abort\(\)/)
  assert.match(resetBlock, /mem\.clear\(\)/)
  assert.match(resetBlock, /loadedFromDisk = false/)
  assert.match(resetBlock, /clearAutoLocalizeCache\(\)/)

  const registration = source.slice(clearStart)
  assert.match(registration, /removeAccountPrivateStorage\(TRANSLATE_CACHE_STORAGE_KEY\)/)
  assert.match(registration, /registerAccountPrivateStateReset\(resetTranslationMemory\)/)
  assert.match(registration, /registerAccountPrivateStateHydrate\(loadDisk\)/)
  assert.doesNotMatch(source, /uni\.(?:get|set|remove)StorageSync\(TRANSLATE_CACHE_STORAGE_KEY\)/)
})
