import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

/**
 * A seller's history is read alongside the listing and every one of those reads
 * is allowed to fail quietly, because the listing is still worth showing. That
 * is right for one buyer and wrong for us: each element of the proof strip is
 * gated on `> 0`, so a broken grant on `ratings` would strip every seller's
 * sales and rating at once and nothing on screen would look amiss.
 *
 * This pins the reporting contract, which is easy to break silently:
 * sentry.ts drops any tag outside its allowlist, so a mistyped key reports
 * nothing while the call still looks correct, and Sentry groups by message, so
 * a message that varies per seller buries the repeat count that is the signal.
 */

const SOURCE_URL = new URL('../src/pages/detail/index.vue', import.meta.url)
// utils/sentry.ts keeps only these; anything else is dropped on the way out.
const ALLOWED_TAGS = new Set([
  'source', 'error_name', 'error_code', 'orphan_risk', 'cleanup_attempted', 'reason',
])

async function loadReporter() {
  const src = await readFile(SOURCE_URL, 'utf8')
  const start = src.indexOf('function reportSellerProofFailure(')
  assert.ok(start !== -1, 'detail/index.vue no longer has reportSellerProofFailure')
  const js = src.slice(start, src.indexOf('\n}\n', start) + 3)
    .replace('function reportSellerProofFailure(source: string, readError: unknown): void {',
      'function reportSellerProofFailure(source, readError) {')
    .replace(/\(readError as any\)/g, 'readError')
  const reported = []
  const fn = new Function('captureException', `${js}\nreturn reportSellerProofFailure`)(
    (error, ctx) => reported.push({ message: error.message, ...ctx }),
  )
  return { report: fn, reported }
}

test('a failed seller-proof read is reported with a groupable message and a surviving tag', async () => {
  const { report, reported } = await loadReporter()

  report('detail.seller_reviews', { code: '42501', name: 'PostgrestError' })
  report('detail.seller_sold_count', new TypeError('Load failed'))

  assert.equal(reported.length, 2, 'the read failure went nowhere')
  // One message for every seller and every read, so the repeat count is what
  // tells us this is systematic rather than one flaky phone.
  assert.equal(reported[0].message, reported[1].message)
  assert.match(reported[0].message, /seller-proof read failed/)
  assert.doesNotMatch(reported[0].message, /42501|Load failed|seller_reviews/)

  for (const event of reported) {
    assert.equal(event.level, 'warning')
    for (const key of Object.keys(event.tags)) {
      assert.ok(ALLOWED_TAGS.has(key), `tag ${key} is dropped by safeEventTags — it reports nothing`)
    }
  }
  // Which read failed has to be distinguishable, or "ratings is broken for
  // everyone" and "one profile row 404'd" look the same in the issue.
  assert.notEqual(reported[0].tags.source, reported[1].tags.source)
  assert.equal(reported[0].tags.error_name, '42501')
  assert.equal(reported[1].tags.error_name, 'TypeError')
})

test('every seller-proof read that can fail quietly is wired to the reporter', async () => {
  const src = await readFile(SOURCE_URL, 'utf8')
  const sources = [...src.matchAll(/reportSellerProofFailure\('([a-z_.]+)'/g)].map(m => m[1])

  assert.deepEqual([...new Set(sources)].sort(), [
    'detail.seller_response_rate',
    'detail.seller_reviews',
    'detail.seller_sold_count',
  ], 'a seller-proof read was added or removed without its reporting')
})
