import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const appSource = fs.readFileSync(path.join(here, '../src/App.vue'), 'utf8')
const customTabBarSource = fs.readFileSync(
  path.join(here, '../src/components/CustomTabBar.vue'),
  'utf8',
)

test('mini-program tab-bar hiding absorbs expected non-tab cold-start failures', () => {
  const guardedHide = /uni\.hideTabBar\(\{\s*animation:\s*false,\s*fail:\s*\(\)\s*=>\s*\{\}\s*\}\)/

  assert.match(appSource, guardedHide)
  assert.match(customTabBarSource, guardedHide)
})
