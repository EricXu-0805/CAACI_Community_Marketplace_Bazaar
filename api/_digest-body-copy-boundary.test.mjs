import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

/**
 * The digest must not print the database's dedup keys at the reader.
 *
 * Two triggers write an identifier into notifications.body and match on it so
 * the same alert is not queued twice — 016_follows.sql for a followed seller's
 * new listing, and 017/066/20260717143223 for a saved-search hit. It is a key,
 * not copy. The app translates it (BODY_SENTINEL_KEYS in
 * app/src/composables/useNotifications.ts); this email template did not, so
 * the line under the item title read "saved_search_match".
 *
 * These are the two most retention-critical rows in the digest — both say
 * "something you asked to hear about just appeared" — so they are also the
 * two a reader is most likely to act on.
 */

const DIGEST_URL = new URL('./notification-digest.js', import.meta.url)
const APP_I18N = ['en', 'zh'].map(lang =>
  new URL(`../app/src/composables/i18n/messages/${lang}.ts`, import.meta.url))

function extract(src, signature, what) {
  const start = src.indexOf(signature)
  assert.ok(start !== -1, `${what} no longer declared as \`${signature}\``)
  const end = src.indexOf('\n}\n', start)
  assert.ok(end > start, `${what} has no closing brace at column 0`)
  return src.slice(start, end + 3)
}

async function loadRenderer() {
  const src = await readFile(DIGEST_URL, 'utf8')
  const js = [
    extract(src, 'function esc(', 'esc'),
    src.slice(src.indexOf('const TYPE_ICON ='), src.indexOf('\n', src.indexOf('const TYPE_ICON ='))),
    extract(src, 'const BODY_SENTINELS = {', 'BODY_SENTINELS').replace(/\n\}\n$/, '\n}\n'),
    extract(src, 'function bodyText(', 'bodyText'),
    extract(src, 'function rowHtml(', 'rowHtml'),
  ].join('\n')
  return new Function(`${js}\nreturn { rowHtml, BODY_SENTINELS }`)()
}

// null is a reader who has never picked a language; the template falls back to
// the bilingual form it used before per-user language existed.
const READERS = ['en', 'zh', null]

test('a dedup key never reaches the reader', async () => {
  const { rowHtml, BODY_SENTINELS } = await loadRenderer()
  const leaked = []
  for (const sentinel of Object.keys(BODY_SENTINELS)) {
    for (const lang of READERS) {
      const html = rowHtml({ type: 'system', title: 'IKEA desk', body: sentinel }, lang)
      if (html.includes(sentinel)) leaked.push(`${lang ?? 'no language'}: ${sentinel}`)
    }
  }
  assert.deepEqual(leaked, [], `printed verbatim in the mail:\n  ${leaked.join('\n  ')}`)
})

test('each reader gets the sentence in their own language', async () => {
  const { rowHtml, BODY_SENTINELS } = await loadRenderer()
  for (const [sentinel, forms] of Object.entries(BODY_SENTINELS)) {
    const en = rowHtml({ type: 'system', title: 'x', body: sentinel }, 'en')
    const zh = rowHtml({ type: 'system', title: 'x', body: sentinel }, 'zh')
    const both = rowHtml({ type: 'system', title: 'x', body: sentinel }, null)
    assert.ok(en.includes(forms.en) && !en.includes(forms.zh), `${sentinel}: an English reader got the wrong form`)
    assert.ok(zh.includes(forms.zh) && !zh.includes(forms.en), `${sentinel}: a Chinese reader got the wrong form`)
    assert.ok(both.includes(forms.zh) && both.includes(forms.en), `${sentinel}: an unknown reader lost a language`)
  }
})

/*
 * The mail and the notification list describe the same event, so they must
 * describe it the same way. Reading the app's strings here is what keeps them
 * from drifting apart once someone edits one side.
 */
test('the wording matches what the notification list says', async () => {
  const { BODY_SENTINELS } = await loadRenderer()
  const KEY_FOR = { saved_search_match: 'notif.savedSearchMatch', new_listing_from_followee: 'notif.followeeListing' }
  for (const [file, lang] of APP_I18N.map((u, i) => [u, ['en', 'zh'][i]])) {
    const messages = await readFile(file, 'utf8')
    for (const [sentinel, forms] of Object.entries(BODY_SENTINELS)) {
      const key = KEY_FOR[sentinel]
      const line = new RegExp(`'${key}':\\s*'([^']*)'`).exec(messages)
      assert.ok(line, `${key} is missing from the ${lang} messages`)
      assert.equal(forms[lang], line[1], `${sentinel} (${lang}) says something different in the mail than in the app`)
    }
  }
})

/*
 * Control. Everything above is satisfied by a template that drops the body
 * line entirely, which would be a worse email with a green suite.
 */
test('bodies that are already copy are still printed', async () => {
  const { rowHtml } = await loadRenderer()
  for (const lang of READERS) {
    const html = rowHtml(
      { type: 'price_drop', title: 'Price drop', body: '你收藏的「IKEA 书桌」降到 $30' },
      lang,
    )
    assert.ok(html.includes('IKEA'), `${lang ?? 'no language'}: a plain body was dropped`)
    assert.ok(html.includes('$30'), `${lang ?? 'no language'}: a plain body lost its price`)
  }
})
