import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(resolve(appRoot, 'src/composables/useAppToast.ts'), 'utf8')

test('account transitions dismiss private notification banners on both renderers', () => {
  assert.match(source, /import \{ onAccountTransition \} from '\.\/accountScope'/)
  const start = source.indexOf('export function clearToasts()')
  const end = source.indexOf('\n}\n\nonAccountTransition(clearToasts)', start)
  assert.ok(start >= 0 && end > start)
  const clear = source.slice(start, end)
  assert.match(clear, /toasts\.value = \[\]/)
  assert.match(clear, /uni\.hideToast\(\)/)
})
