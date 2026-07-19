import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(resolve(appRoot, 'src/composables/usePlaza.ts'), 'utf8')

test('account transitions invalidate plaza membership cache and stale like completions', () => {
  assert.match(source, /const likeInFlight = new Map<string, AccountRequestToken>\(\)/)
  const resetStart = source.indexOf('function resetPlazaState()')
  const resetEnd = source.indexOf('\n}\n\nonAccountTransition(resetPlazaState)', resetStart)
  assert.ok(resetStart >= 0 && resetEnd > resetStart)
  const reset = source.slice(resetStart, resetEnd)
  assert.match(reset, /latestRequestId \+= 1/)
  assert.match(reset, /posts\.value = \[\]/)
  assert.match(reset, /loading\.value = false/)
  assert.match(reset, /likeInFlight\.clear\(\)/)

  for (const [startMarker, endMarker] of [
    ['async function toggleLike(', '\n  async function toggleCommentLike('],
    ['async function toggleCommentLike(', '\n  async function fetchComments('],
  ]) {
    const start = source.indexOf(startMarker)
    const end = source.indexOf(endMarker, start)
    assert.ok(start >= 0 && end > start)
    const block = source.slice(start, end)
    assert.match(block, /const accountToken = captureAccountRequest\(uid\)/)
    assert.match(block, /likeInFlight\.set\((?:post|comment)\.id, accountToken\)/)
    assert.equal(
      (block.match(/if \(!isAccountRequestCurrent\(accountToken\)\) return/g) || []).length,
      2,
      `${startMarker} must revalidate both insert and delete completions`,
    )
    assert.match(
      block,
      /if \(likeInFlight\.get\((?:post|comment)\.id\) === accountToken\) likeInFlight\.delete\((?:post|comment)\.id\)/,
      `${startMarker} lets an old account completion release the new account's lock`,
    )
  }
})
