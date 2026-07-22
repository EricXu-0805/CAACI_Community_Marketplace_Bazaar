import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = readFileSync(resolve(appRoot, 'src/pages/index/index.vue'), 'utf8')

test('home scroll restoration cannot mutate an unmounted scroll-view', () => {
  assert.match(home, /import \{ onShow, onHide, onShareAppMessage, onShareTimeline, onUnload \}/)
  assert.match(home, /function clearScrollTimers\(\)/)
  assert.match(home, /onShow\(async \(\) => \{\s*homeVisible = true\s*const showEpoch = \+\+homeShowEpoch\s*clearScrollTimers\(\)/)
  assert.match(home, /await awaitAuthReady\(\)\s*if \(!homeVisible \|\| showEpoch !== homeShowEpoch\) return/)
  assert.match(home, /onHide\(\(\) => \{\s*homeVisible = false\s*homeShowEpoch \+= 1\s*clearScrollTimers\(\)/)
  assert.match(home, /onUnload\(\(\) => \{\s*homeVisible = false\s*homeShowEpoch \+= 1\s*clearScrollTimers\(\)/)

  const directTimers = [...home.matchAll(/setTimeout\(/g)]
  assert.ok(directTimers.length >= 3, 'expected guarded home timers to remain present')
  assert.match(home, /scrollResetTimer = setTimeout\(/)
  assert.match(home, /scrollRestoreTimer = setTimeout\(/)
  assert.match(home, /scrollRestoreResetTimer = setTimeout\(/)
})
