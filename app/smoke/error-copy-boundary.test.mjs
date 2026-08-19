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

/*
 * The database writes sentences too, and the corpus above cannot see them: it
 * reads throw sites out of src/, and 'a meetup proposal is already pending' is
 * raised by propose_meetup, not by any TypeScript. Those messages contain
 * spaces, so MACHINE_SENTINEL never matched, and they fell through to the last
 * line of friendlyErrorMessage and were shown word for word — lowercase, in
 * English, to whoever was reading. Two students racing each other over one
 * listing is enough to produce all four of the meetup ones.
 *
 * Postgres tags every error with a five-character SQLSTATE that PostgREST
 * passes through as `code`, and the data layer rethrows the PostgrestError
 * whole (`if (error) throw error`), so `code` is still there at the toast site
 * and is what separates a database sentence from anything the app wrote.
 */
const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url)

/* Every SQLSTATE the migrations actually raise with, minus the two that
   friendlyErrorMessage already branches on by code (42501, 23514). */
const DB_ERRCODES = ['P0001', '55000', '22023', 'P0002', '28000', '40001', '55P03']

/*
 * Messages raised from inside a function body — the ones a request can reach.
 * `DO $$ ... $$` blocks run once while the migration is being applied and can
 * never surface to anybody, so they are cut out first; leaving them in buries
 * the twenty-one that matter under a hundred more operator assertions.
 */
async function databaseSentences() {
  const found = new Set()
  for (const entry of await readdir(MIGRATIONS)) {
    if (!entry.endsWith('.sql')) continue
    const text = await readFile(new URL(entry, MIGRATIONS), 'utf8')
    const runtime = text.replace(/\bDO\s+\$([a-zA-Z_]*)\$[\s\S]*?\$\1\$/g, '')
    for (const m of runtime.matchAll(/RAISE\s+EXCEPTION\s+'((?:[^']|'')*)'/gi)) {
      const message = m[1].replace(/''/g, "'")
      // A '%' is a format placeholder, so the string is a diagnostic being
      // assembled for an operator, never a finished sentence for a reader.
      if (message.includes('%') || !message.includes(' ')) continue
      found.add(message)
    }
  }
  return [...found].sort()
}

test('a sentence raised by the database is never shown word for word', async () => {
  const { friendlyErrorMessage } = await loadFriendlyErrorMessage()
  const sentences = await databaseSentences()
  assert.ok(sentences.length > 10, 'the migration scan found nothing — it stopped reading the corpus')
  assert.ok(
    sentences.includes('a meetup proposal is already pending'),
    'the scan no longer sees the message this test was written for. Either the '
    + 'migrations reworded it — in which case the OFFER_MEETUP_MESSAGES entry for '
    + 'it is dead too and both need the new wording — or the scan is broken.',
  )

  const leaked = []
  for (const message of sentences) {
    for (const code of DB_ERRCODES) {
      for (const lang of ['en', 'zh']) {
        const out = friendlyErrorMessage({ message, code }, lang)
        if (out === message) leaked.push(`${lang} ${code}: ${message}`)
        else if (lang === 'zh' && !HAS_CJK.test(out)) leaked.push(`zh ${code}: ${message} -> ${out}`)
      }
    }
  }
  assert.deepEqual(leaked, [], `shown to the user as the database wrote it:\n  ${leaked.join('\n  ')}`)
})

test('an unmapped database sentence is reported rather than guessed at', async () => {
  const { friendlyErrorMessage, reported } = await loadFriendlyErrorMessage()
  assert.equal(friendlyErrorMessage({ message: 'the widget is out of alignment', code: '55000' }, 'en'), 'Something went wrong')
  assert.deepEqual(reported, ['error_copy.db.the.widget.is.out.of.alignment'])
})

/* The shape check has to hold both ways: an app code that happens to look
   close to a SQLSTATE must not have its message swallowed. */
test('only a SQLSTATE-shaped code counts as coming from the database', async () => {
  const { friendlyErrorMessage, reported } = await loadFriendlyErrorMessage()
  assert.equal(friendlyErrorMessage({ message: 'Upload stalled at 40%', code: 'PGRST202' }, 'en'), 'Upload stalled at 40%')
  assert.equal(friendlyErrorMessage({ message: 'Upload stalled at 40%' }, 'en'), 'Upload stalled at 40%')
  assert.deepEqual(reported, [])
})

/*
 * Control for the corpus test above, which the generic fallback satisfies for
 * free: these four are races between two real people and have to say which one
 * happened, or the student is told "操作失败" for arranging a meetup that had
 * already been arranged.
 */
test('the meetup races two students can hit say what happened', async () => {
  const { friendlyErrorMessage } = await loadFriendlyErrorMessage()
  const cases = [
    ['a meetup proposal is already pending', 'zh', /等回复/],
    ['a meetup proposal is already pending', 'en', /waiting for a reply/],
    ['a meetup is already confirmed; reschedule it instead', 'zh', /改约/],
    ['another meetup is already confirmed', 'zh', /另一次面交/],
    ['only an accepted meetup can be rescheduled', 'zh', /已确认/],
  ]
  for (const [message, lang, expected] of cases) {
    assert.match(friendlyErrorMessage({ message, code: '55000' }, lang), expected,
      `${message} (${lang}) fell back to the generic message`)
  }
})
