import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Whatever friendlyErrorMessage returns is what the user reads.
 *
 * It is the app's single error path — 100+ call sites hand it a rejection and
 * put the result straight into a toast — and its last line was
 * `err?.message || (lang === 'zh' ? '操作失败' : ...)`. Any Error with a
 * message therefore bypassed the Chinese fallback entirely, so the branch was
 * dead for everything except errors with no message at all.
 *
 * Measured over every string the app throws plus the browsers' transport
 * errors: of 89 messages, 13 were localized. 49 were machine sentinels shown
 * verbatim ('realtime_poll_non_monotonic_cursor'), and 27 were English shown
 * to a Chinese UI — including 'Load failed', which is what WebKit says when
 * campus wifi drops.
 *
 * The corpus is read out of src/ rather than written down here, so a newly
 * thrown string is covered the day it is added. Underscored sentinels satisfy
 * the language check through the guard's generic message, so plumbing code
 * costs nothing; a new user-facing English sentence has to be translated.
 */

const SRC = new URL('../src/', import.meta.url)
const UTILS = new URL('../src/utils/index.ts', import.meta.url)

const MACHINE_SENTINEL = /^[a-z0-9]+(_[a-z0-9]+)+(:[a-z0-9_]+)?$/
const HAS_CJK = /[一-鿿]/

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = resolve(dir.pathname ?? dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(new URL(`${entry.name}/`, dir)))
    else if (/\.(ts|vue)$/.test(entry.name)) out.push(child)
  }
  return out
}

async function thrownStrings() {
  const found = new Set()
  for (const file of await walk(SRC)) {
    const text = await readFile(file, 'utf8')
    for (const m of text.matchAll(/throw new Error\('([^']+)'\)/g)) found.add(m[1])
  }
  return [...found].sort()
}

async function loadFriendlyErrorMessage() {
  const src = await readFile(UTILS, 'utf8')
  const start = src.indexOf('const RATE_LIMIT_MESSAGES')
  const fnStart = src.indexOf('export function friendlyErrorMessage')
  assert.ok(start !== -1 && fnStart > start, 'utils/index.ts no longer lays out the message tables above friendlyErrorMessage')
  const js = src.slice(start, src.indexOf('\n}\n', fnStart) + 3)
    .replace(/const (\w+): Record<string, \{ en: string; zh: string \}> =/g, 'const $1 =')
    .replace(
      "export function friendlyErrorMessage(err: any, lang: 'en' | 'zh' = 'en'): string {",
      'function friendlyErrorMessage(err, lang = "en") {',
    )
    .replace(/ as keyof typeof MODERATION_MESSAGES/g, '')
  const reported = []
  const fn = new Function('captureException', `${js}\nreturn friendlyErrorMessage`)(
    (_err, ctx) => reported.push(ctx?.tags?.source),
  )
  return { friendlyErrorMessage: fn, reported }
}

/* What the three engines call a dropped connection. None is a sentence, and
   none of them has a Chinese form. */
const TRANSPORT = [
  'Load failed',
  'TypeError: Load failed',
  'Failed to fetch',
  'NetworkError when attempting to fetch resource.',
  'Network request failed',
  'The network connection was lost.',
]

/*
 * Deliberate exceptions to the language check.
 *
 * AbortError covers user-initiated cancellation as well as timeouts, and no
 * traced path turns one into a toast, so inventing copy for it would be
 * guessing at a message nobody has been shown.
 */
const NOT_LOCALIZED = new Set(['The operation was aborted.'])

test('no error message reaches the user as a machine sentinel', async () => {
  const { friendlyErrorMessage } = await loadFriendlyErrorMessage()
  const leaked = []
  for (const message of [...await thrownStrings(), ...TRANSPORT]) {
    for (const lang of ['en', 'zh']) {
      const out = friendlyErrorMessage(new Error(message), lang)
      if (MACHINE_SENTINEL.test(out)) leaked.push(`${lang}: ${message} -> ${out}`)
    }
  }
  assert.deepEqual(leaked, [], `these were shown to the user as-is:\n  ${leaked.join('\n  ')}`)
})

test('a Chinese reader gets Chinese', async () => {
  const { friendlyErrorMessage } = await loadFriendlyErrorMessage()
  const english = []
  for (const message of [...await thrownStrings(), ...TRANSPORT]) {
    if (NOT_LOCALIZED.has(message)) continue
    const zh = friendlyErrorMessage(new Error(message), 'zh')
    if (!HAS_CJK.test(zh)) english.push(`${message} -> ${zh}`)
  }
  assert.deepEqual(english, [], `English shown to a Chinese UI — add a zh form, or a mapping:\n  ${english.join('\n  ')}`)
})

test('a dropped connection says so, in both languages', async () => {
  const { friendlyErrorMessage } = await loadFriendlyErrorMessage()
  for (const message of TRANSPORT) {
    assert.match(
      friendlyErrorMessage(new Error(message), 'en'),
      /network/i,
      `${message} should read as a connection problem in English`,
    )
    assert.match(
      friendlyErrorMessage(new Error(message), 'zh'),
      /网络/,
      `${message} should read as a connection problem in Chinese`,
    )
  }
})

test('an unmapped sentinel is reported rather than guessed at', async () => {
  const { friendlyErrorMessage, reported } = await loadFriendlyErrorMessage()
  const out = friendlyErrorMessage(new Error('some_brand_new_sentinel'), 'en')
  assert.equal(out, 'Something went wrong')
  assert.deepEqual(reported, ['error_copy.unmapped.some.brand.new.sentinel'])
})

/*
 * Control. Messages that were already localized must stay that way, and the
 * generic fallback must not swallow copy that was written for a reader —
 * without this, returning the generic string unconditionally passes
 * everything above while making the app less useful.
 */
test('specific messages are not flattened into the generic one', async () => {
  const { friendlyErrorMessage } = await loadFriendlyErrorMessage()
  const cases = [
    ['moderation_block:contact_info', 'zh', /站内私信/],
    ['content_too_long', 'zh', /内容太长/],
    ['rate_limit_items_hour', 'en', /Too many items/],
    ['File too large (max 5MB)', 'en', /5MB/],
    ['File too large (max 5MB)', 'zh', /5MB/],
    ['offer has expired', 'zh', /报价已过期/],
  ]
  for (const [message, lang, expected] of cases) {
    assert.match(friendlyErrorMessage(new Error(message), lang), expected,
      `${message} (${lang}) lost its specific copy`)
  }
})
