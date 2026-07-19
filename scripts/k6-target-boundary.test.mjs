import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const SHARED = new URL('../tests/k6/_shared.js', import.meta.url)
const README = new URL('../tests/k6/README.md', import.meta.url)

test('destructive k6 suites have no implicit production target and require an environment acknowledgement', async () => {
  const [source, docs] = await Promise.all([
    readFile(SHARED, 'utf8'),
    readFile(README, 'utf8'),
  ])

  assert.match(source, /SUPABASE_URL \|\| ''/)
  assert.match(source, /APP_ORIGIN \|\| ''/)
  assert.match(source, /K6_TARGET_ENV/)
  assert.match(source, /I_UNDERSTAND_THIS_WILL_LOAD_PRODUCTION/)
  assert.doesNotMatch(source, /https:\/\/[a-z]{20}\.supabase\.co/i)
  assert.doesNotMatch(source, /https:\/\/illinimarket\.com/i)
  assert.match(docs, /K6_TARGET_ENV="staging"/)
  assert.match(docs, /There are deliberately no production URL defaults/)
})
