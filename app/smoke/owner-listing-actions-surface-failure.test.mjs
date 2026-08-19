import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

/**
 * Marking an item sold is the write that creates the deal row every rating
 * hangs off, and it can fail ten distinct ways — the offer was withdrawn, the
 * buyer deleted their account, the listing sold in another tab. It is reachable
 * from three screens, and two of them wrote `catch { showToast(markFail) }`:
 * the error was thrown away, so all ten became one fixed sentence ('Failed to
 * update'), and nothing was reported. `private.item_deals` has never had a row
 * in production, so the first real sale that fails would have failed with no
 * trace anywhere.
 *
 * The same shape sat on unreserve and delete, where 'Failed to update' is also
 * the wrong sentence — a delete that fails did not update anything.
 *
 * This pins the two halves that are easy to lose independently: the reader is
 * told what happened, and somebody is told at all.
 */

const SOURCES = {
  detail: new URL('../src/pages/detail/index.vue', import.meta.url),
  profile: new URL('../src/pages/profile/index.vue', import.meta.url),
  chat: new URL('../src/components/ChatThread.vue', import.meta.url),
}

// utils/sentry.ts keeps only these; anything else is dropped on the way out,
// and stableToken rejects a value with whitespace.
const ALLOWED_TAGS = new Set([
  'source', 'error_name', 'error_code', 'orphan_risk', 'cleanup_attempted', 'reason',
])
const STABLE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

async function read(which) {
  return readFile(SOURCES[which], 'utf8')
}

/*
 * A catch that binds nothing cannot pass the error on, whatever it does next —
 * so the shape is the defect, independent of which sentence follows it.
 */
function bareCatches(source) {
  return [...source.matchAll(/\}\s*catch\s*\{([^}]*)\}/g)].map(m => m[1].trim())
}

test('no owner action throws its error away before deciding what to say', async () => {
  const offenders = []
  for (const which of ['detail', 'profile']) {
    const source = await read(which)
    for (const body of bareCatches(source)) {
      if (body.includes('showToast')) offenders.push(`${which}: catch { ${body.slice(0, 60)}… }`)
    }
  }
  assert.deepEqual(offenders, [],
    `these decide what to tell the user without looking at the error:\n  ${offenders.join('\n  ')}`)
})

test('all three entry points to marking sold report the failure', async () => {
  const expected = [
    ['detail', 'detail.mark_item_sold'],
    ['profile', 'profile.mark_item_sold'],
    ['chat', 'chat.mark_item_sold'],
  ]
  for (const [which, source] of expected) {
    const text = await read(which)
    assert.ok(text.includes(source), `${which} does not report a failed sale under '${source}'`)
  }
})

/*
 * Stated as a property rather than as a shape, so extracting a helper stays
 * legal: the fixed sentence may be a fallback, never the whole answer.
 */
test('all three say what went wrong rather than one fixed sentence', async () => {
  const fixedOnly = []
  for (const which of ['detail', 'profile', 'chat']) {
    const text = await read(which)
    assert.ok(text.includes('friendlyErrorMessage('),
      `${which} never asks what the error was`)
    for (const [, title] of text.matchAll(/title:\s*([^,\n]+)/g)) {
      if (/^t\('profile\.(markFail|deleteFailed)'\)$/.test(title.trim())) {
        fixedOnly.push(`${which}: ${title.trim()}`)
      }
    }
  }
  assert.deepEqual(fixedOnly, [],
    `these tell the reader one fixed sentence whatever happened:\n  ${fixedOnly.join('\n  ')}`)
})

/*
 * Control. A tag outside the allowlist is dropped on the way out and a source
 * with a space is rejected by stableToken, so a reporter can look completely
 * correct at the call site and arrive carrying nothing.
 */
test('the reported tags survive the sentry pipeline', async () => {
  const sources = []
  for (const which of ['detail', 'profile', 'chat']) {
    const text = await read(which)
    for (const [, block] of text.matchAll(/captureException\([^]*?tags:\s*\{([^}]*)\}/g)) {
      for (const [, key] of block.matchAll(/([a-z_]+)\s*:/g)) {
        assert.ok(ALLOWED_TAGS.has(key), `${which} tags with '${key}', which sentry.ts drops`)
      }
      for (const [, value] of block.matchAll(/source:\s*['"`]([^'"`]+)['"`]/g)) sources.push([which, value])
    }
  }
  assert.ok(sources.length >= 3, 'the scan found no literal source tags to check')
  for (const [which, value] of sources) {
    assert.match(value, STABLE_TOKEN, `${which} source '${value}' is rejected by stableToken`)
    assert.ok(value.length <= 96, `${which} source '${value}' is over the 96-character cap`)
  }
})

/*
 * Control for the copy, which the generic fallback satisfies for free: a failed
 * delete must not be reported to the reader as a failed update.
 */
test('a failed delete does not call itself a failed update', async () => {
  const [en, zh] = await Promise.all([
    readFile(new URL('../src/composables/i18n/messages/en.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/composables/i18n/messages/zh.ts', import.meta.url), 'utf8'),
  ])
  const profile = await read('profile')
  const start = profile.indexOf('function onDeleteItem(')
  assert.ok(start !== -1, 'profile/index.vue no longer has onDeleteItem')
  const handler = profile.slice(start, profile.indexOf('\n}\n', start))
  assert.ok(handler.includes("t('profile.deleteFailed')"),
    'the delete handler does not name a delete-specific fallback')
  assert.ok(!handler.includes("t('profile.markFail')"),
    'the delete handler still falls back to the mark-sold sentence')
  assert.match(en, /'profile\.deleteFailed':\s*'[^']*[Dd]elete/)
  assert.match(zh, /'profile\.deleteFailed':\s*'[^']*删除/)
})
