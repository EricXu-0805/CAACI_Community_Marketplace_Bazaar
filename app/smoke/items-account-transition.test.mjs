import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(resolve(appRoot, 'src/composables/useItems.ts'), 'utf8')

test('account transitions invalidate personalized item snapshots and stale fetches', () => {
  assert.match(source, /onAccountTransition,/)
  const resetStart = source.indexOf('function resetItemState()')
  const resetEnd = source.indexOf('\n}\n\nonAccountTransition(resetItemState)', resetStart)
  assert.ok(resetStart >= 0 && resetEnd > resetStart)
  const reset = source.slice(resetStart, resetEnd)
  assert.match(reset, /latestRequestId \+= 1/)
  assert.match(reset, /items\.value = \[\]/)
  assert.match(reset, /loading\.value = false/)
  assert.match(reset, /hasMore\.value = true/)
  assert.match(reset, /fetchError\.value = ''/)
  assert.match(reset, /invalidateMyItems\(\)/)

  const clearStart = source.indexOf('function clearItems()')
  const clearEnd = source.indexOf('\n  }', clearStart)
  assert.ok(clearStart >= 0 && clearEnd > clearStart)
  assert.match(source.slice(clearStart, clearEnd), /resetItemState\(\)/)
})
