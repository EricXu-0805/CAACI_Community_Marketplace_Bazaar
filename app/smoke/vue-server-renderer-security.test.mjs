import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const appRequire = createRequire(new URL('../package.json', import.meta.url))
// The real Uni CLI installs this global alias before any renderer import.
// It must not redirect the renderer to an older unsafe shared implementation.
appRequire('./build-compat/compiler/bootstrap.cjs')
appRequire('@dcloudio/uni-cli-shared/dist/alias')
appRequire('@dcloudio/uni-cli-shared/dist/polyfill')
const consumers = [
  'vue',
  '@dcloudio/uni-cli-shared',
  '@dcloudio/uni-h5',
  '@dcloudio/uni-h5-vite',
  '@dcloudio/uni-h5-vue',
]

test('every Vue renderer consumer rejects carriage returns in SSR attribute names', () => {
  const checked = new Set()
  for (const consumer of consumers) {
    const requireFromConsumer = createRequire(appRequire.resolve(`${consumer}/package.json`))
    const rendererPath = requireFromConsumer.resolve('@vue/server-renderer')
    if (checked.has(rendererPath)) continue
    checked.add(rendererPath)
    const renderer = requireFromConsumer('@vue/server-renderer')
    // A carriage return becomes an HTML attribute separator. Rejection must
    // come from the resolved renderer, including any nested DCloud copy.
    const originalWarn = console.warn
    const originalError = console.error
    let result
    try {
      console.warn = () => {}
      console.error = () => {}
      result = renderer.ssrRenderAttrs({
        'data-safe': 'kept',
        'data-rejected\rname': 'discarded',
      })
    } finally {
      console.warn = originalWarn
      console.error = originalError
    }
    assert.equal(result, ' data-safe="kept"', consumer)
  }
  assert.ok(checked.size > 0)
})

test('DCloud slot metadata stays mutable across updates', () => {
  const shared = appRequire('@vue/shared')
  const slots = { _: 1 }
  // The DCloud runtime uses def() for an existing internal slot flag and then
  // Object.assign() when children update. A global shared3.5 alias breaks it.
  shared.def(slots, '_', 1)
  Object.assign(slots, { _: 2 })
  assert.equal(slots._, 2)
})
