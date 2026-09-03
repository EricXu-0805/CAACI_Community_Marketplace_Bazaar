import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import ts from '../node_modules/typescript/lib/typescript.js'

/**
 * A notification's fixed copy is written by a trigger, in both languages at
 * once, because the trigger cannot know who will read it. The screen is where
 * that gets resolved — so every such literal needs an entry in one of the two
 * lookups the screen uses, and one that is added later needs one too.
 *
 * This reads the literals out of the migrations rather than listing them, so
 * a trigger added tomorrow with a new bilingual sentence fails here instead of
 * shipping a row that says everything twice.
 */

const ROOT = new URL('../../', import.meta.url)
const MIGRATIONS = new URL('supabase/migrations/', ROOT)
const API = new URL('app/src/api/notifications.ts', ROOT)
const COMPOSABLE = new URL('app/src/composables/useNotifications.ts', ROOT)
const MESSAGES = ['en', 'zh'].map(lang =>
  new URL(`app/src/composables/i18n/messages/${lang}.ts`, ROOT))

/*
 * 'CJK · Latin' inside one SQL string literal. Comments are stripped first:
 * every migration in this repo explains itself above the code, and those
 * paragraphs quote the very literals being described.
 */
const BILINGUAL = /'([^'\n]*[一-鿿][^'\n]*·[^'\n]*[A-Za-z][^'\n]*)'/g

/*
 * 010 seeds the plaza's own welcome POST — a body of user-facing content that
 * is rendered as a post, not as a notification, and is bilingual on purpose.
 * It is named rather than pattern-excluded so that it stays a decision.
 */
const NOT_A_NOTIFICATION = new Set(['欢迎来到 Illini 集市广场'])

function isExcluded(literal) {
  for (const prefix of NOT_A_NOTIFICATION) if (literal.startsWith(prefix)) return true
  return false
}

function extract(source, signature, what) {
  const start = source.indexOf(signature)
  assert.ok(start !== -1, `${what} is no longer declared as \`${signature}\``)
  const end = source.indexOf('\n}\n', start)
  assert.ok(end > start, `${what} has no closing brace at column 0`)
  return source.slice(start, end + 3)
}

async function loadLookups() {
  const [api, composable] = await Promise.all([
    readFile(API, 'utf8'),
    readFile(COMPOSABLE, 'utf8'),
  ])
  const javascript = ts.transpileModule([
    extract(api, 'export const NOTIFICATION_TITLE_KEYS', 'NOTIFICATION_TITLE_KEYS'),
    extract(api, 'export function notificationTitleText(', 'notificationTitleText'),
    extract(composable, 'const BODY_SENTINEL_KEYS', 'BODY_SENTINEL_KEYS'),
  ].join('\n').replace(/^export /gm, ''), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return Function(
    `${javascript}; return { NOTIFICATION_TITLE_KEYS, notificationTitleText, BODY_SENTINEL_KEYS }`,
  )()
}

async function bilingualLiterals() {
  const names = (await readdir(MIGRATIONS)).filter(name => name.endsWith('.sql'))
  const found = new Map()
  for (const name of names) {
    const sql = (await readFile(new URL(name, MIGRATIONS), 'utf8'))
      .split('\n').map(line => line.replace(/--.*$/, '')).join('\n')
    for (const match of sql.matchAll(BILINGUAL)) {
      if (isExcluded(match[1])) continue
      if (!found.has(match[1])) found.set(match[1], name)
    }
  }
  return found
}

test('the migrations still write bilingual copy, so there is something to resolve', async () => {
  const found = await bilingualLiterals()
  assert.ok(
    found.size >= 15,
    `parsed ${found.size} bilingual literals out of the migrations — the scan has stopped seeing them`,
  )
})

test('every bilingual literal a trigger writes has a translation on the screen', async () => {
  const { NOTIFICATION_TITLE_KEYS, BODY_SENTINEL_KEYS } = await loadLookups()
  const found = await bilingualLiterals()
  const untranslated = []
  for (const [literal, migration] of found) {
    if (NOTIFICATION_TITLE_KEYS[literal] || BODY_SENTINEL_KEYS[literal]) continue
    untranslated.push(`${literal}   (${migration})`)
  }
  assert.deepEqual(
    untranslated, [],
    'these reach the reader in both languages at once. Add each one to '
    + 'NOTIFICATION_TITLE_KEYS (app/src/api/notifications.ts) or to '
    + 'BODY_SENTINEL_KEYS (app/src/composables/useNotifications.ts) with an '
    + 'en/zh pair in both message catalogs:\n  ' + untranslated.join('\n  '),
  )
})

test('every key the lookups name exists in both catalogs', async () => {
  const { NOTIFICATION_TITLE_KEYS, BODY_SENTINEL_KEYS } = await loadLookups()
  const keys = [
    ...Object.values(NOTIFICATION_TITLE_KEYS),
    ...Object.values(BODY_SENTINEL_KEYS),
  ]
  assert.ok(keys.length >= 20, `parsed ${keys.length} message keys`)
  for (const [index, url] of MESSAGES.entries()) {
    const source = await readFile(url, 'utf8')
    for (const key of keys) {
      assert.match(
        source, new RegExp(`'${key.replace('.', '\\.')}':`),
        `${key} is missing from the ${['en', 'zh'][index]} catalog, so it renders as its own name`,
      )
    }
  }
})

test('a headline that is user content is left alone', async () => {
  // The control. notify_item_sold (065) writes the item's own title into this
  // column, so a resolver that rewrote every title would erase real listings —
  // and every assertion above would still pass.
  const { notificationTitleText } = await loadLookups()
  const translate = key => `translated(${key})`
  for (const title of ['IKEA 书桌', 'Offer accepted for my 书桌 · desk', '']) {
    assert.equal(
      notificationTitleText({ title }, translate), title,
      `a title nothing knows about was rewritten: ${title}`,
    )
  }
  assert.equal(
    notificationTitleText({ title: '报价被接受 · Offer accepted' }, translate),
    'translated(notif.titleOfferAccepted)',
    'a known headline was not resolved',
  )
})
