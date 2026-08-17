import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

/**
 * An offer has to print the same way the listing above it does.
 *
 * The chat thread shows the item's asking price through formatPrice and the
 * offer card, the deal pill and the mark-sold confirmation through
 * fmtOfferPrice. Those were two different formatters, so the same view could
 * read "$1,500" at the top and "$1500" underneath, and a $40.50 offer came
 * out as "$40.5" — a price no student typed, in the one place where the number
 * is the whole point of the message.
 *
 * The corpus is chosen so the old formatter fails it: it carries cents that
 * end in zero, values above a thousand, and a bare zero.
 */

const UTILS_URL = new URL('../src/utils/index.ts', import.meta.url)
const THREAD_URL = new URL('../src/components/ChatThread.vue', import.meta.url)

function extract(src, signature, what) {
  const start = src.indexOf(signature)
  assert.ok(start !== -1, `${what} no longer declared as \`${signature}\``)
  const end = src.indexOf('\n}\n', start)
  assert.ok(end > start, `${what} has no closing brace at column 0`)
  return src.slice(start, end + 3)
}

async function loadFormatters() {
  const utils = await readFile(UTILS_URL, 'utf8')
  const thread = await readFile(THREAD_URL, 'utf8')

  const formatPrice = extract(utils, 'export function formatPrice(', 'formatPrice')
    .replace('export function', 'function')
    .replace('price: number', 'price')
  const fmtOfferPrice = extract(thread, 'function fmtOfferPrice(', 'fmtOfferPrice')
    .replace('p: number', 'p')

  const js = `${formatPrice}\n${fmtOfferPrice}`.replace(/\): string \{/g, ') {')
  return new Function(`${js}\nreturn { formatPrice, fmtOfferPrice }`)()
}

// [price, what the offer card must show]
const CASES = [
  [40.5, '$40.50'],
  [40.55, '$40.55'],
  [25, '$25'],
  [0.5, '$0.50'],
  [1500, '$1,500'],
  [1234.5, '$1,234.50'],
  [999999.99, '$999,999.99'],
  [1000000, '$1,000,000'],
  // make_offer (migration 051) accepts price >= 0. A zero-dollar offer is a
  // real offer of nothing, not a free listing, so it must not borrow the
  // listing's "Free" label.
  [0, '$0'],
]

test('an offer prints as a price a person would write', async () => {
  const { fmtOfferPrice } = await loadFormatters()
  const wrong = []
  for (const [price, expected] of CASES) {
    const actual = fmtOfferPrice(price)
    if (actual !== expected) wrong.push(`${price} -> ${actual} (want ${expected})`)
  }
  assert.deepEqual(wrong, [], `offer prices formatted wrongly:\n  ${wrong.join('\n  ')}`)
})

test('an offer and the listing it is made on agree', async () => {
  const { formatPrice, fmtOfferPrice } = await loadFormatters()
  const disagreeing = []
  for (const [price] of CASES) {
    if (price === 0) continue // the two surfaces label zero differently, by design
    const listing = formatPrice(price, 'Free')
    if (fmtOfferPrice(price) !== listing) {
      disagreeing.push(`${price}: offer ${fmtOfferPrice(price)} vs listing ${listing}`)
    }
  }
  assert.deepEqual(disagreeing, [], `the same price rendered two ways in one view:\n  ${disagreeing.join('\n  ')}`)
})

/*
 * fmtOfferPrice returns the currency symbol itself. The call sites used to
 * prepend their own, so restoring one produces "$$40.50" — which neither test
 * above can see, because both call the function directly.
 */
test('no call site prepends a second currency symbol', async () => {
  const thread = await readFile(THREAD_URL, 'utf8')
  const doubled = thread.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /\$\s*(\+\s*)?fmtOfferPrice|['"]\$['"]\s*\+\s*fmtOfferPrice/.test(line))
  assert.deepEqual(doubled.map(([n]) => n), [], `these lines add a second "$":\n  ${doubled.map(([n, l]) => `${n}: ${l.trim()}`).join('\n  ')}`)
})
