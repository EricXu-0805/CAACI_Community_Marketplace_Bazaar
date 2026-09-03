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
    src.slice(src.indexOf('const PRICE_BODY_RE ='), src.indexOf('\n', src.indexOf('const PRICE_BODY_RE ='))),
    extract(src, 'function priceText(', 'priceText'),
    extract(src, 'function bodyText(', 'bodyText'),
    extract(src, 'function rowHtml(', 'rowHtml'),
  ].join('\n')
  return new Function(`${js}\nreturn { rowHtml, BODY_SENTINELS }`)()
}

// null is a reader who has never picked a language; the template falls back to
// the bilingual form it used before per-user language existed.
const READERS = ['en', 'zh', null]

/*
 * The sold and price-drop triggers write '$' || price::text, and price is
 * DECIMAL(10,2) — so the row says '$25.00' and '$0.00' where the app says '$25'
 * and Free. Both readers of that column reformat it; these are the shapes.
 */
const PRICE_BODIES = [
  ['a whole amount loses its cents', '$25.00', { en: '$25', zh: '$25' }],
  ['thousands are grouped', '$1234.50', { en: '$1,234.50', zh: '$1,234.50' }],
  ['a free item is not zero dollars', '$0.00', { en: 'Free', zh: '免费' }],
  ['a price drop keeps both sides', '$40.00 → $25.00', { en: '$40 → $25', zh: '$40 → $25' }],
  ['a drop to free says so', '$40.00 → $0.00', { en: '$40 → Free', zh: '$40 → 免费' }],
]

test('an amount is rendered the way the app renders it, not the way the row stores it', async () => {
  const { rowHtml } = await loadRenderer()
  const wrong = []
  for (const [label, body, expected] of PRICE_BODIES) {
    for (const lang of ['en', 'zh']) {
      const html = rowHtml({ type: 'sold', title: 'IKEA desk', body }, lang)
      if (!html.includes(expected[lang])) wrong.push(`${lang} ${label}: ${body} did not become ${expected[lang]}`)
      if (html.includes('0.00')) wrong.push(`${lang} ${label}: the raw ${body} reached the mail`)
    }
  }
  assert.deepEqual(wrong, [], `the mail printed a stored amount:\n  ${wrong.join('\n  ')}`)
})

test('a body that is neither a sentinel nor an amount is still printed', async () => {
  // The control. Without it the reformatting above is satisfied by a renderer
  // that drops every body it does not recognise.
  const { rowHtml } = await loadRenderer()
  for (const lang of ['en', 'zh', null]) {
    assert.match(rowHtml({ type: 'system', title: 't', body: '你有 3 条未读消息' }, lang), /你有 3 条未读消息/)
  }
})

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

/*
 * The 20260903070000 activity keys carry their tap target as '<key>:<uuid>'
 * because the post or person they open fits neither item_id nor
 * conversation_id. The row id is routing data; printing it in the mail would
 * be the same bug as printing the dedup key.
 */
test('a keyed body prints its sentence and not the id it routes with', async () => {
  const { rowHtml, BODY_SENTINELS } = await loadRenderer()
  const target = '0f3e5c1a-2b4d-4e6f-8a9b-1c2d3e4f5a6b'
  for (const key of ['new_follower', 'post_comment', 'post_like', 'post_comment_like']) {
    assert.ok(BODY_SENTINELS[key], `${key} lost its copy`)
    for (const lang of READERS) {
      const html = rowHtml({ type: 'system', title: 'x', body: `${key}:${target}` }, lang)
      assert.ok(!html.includes(target), `${lang ?? 'no language'}: ${key} printed its row id`)
      assert.ok(!html.includes(key), `${lang ?? 'no language'}: ${key} printed the key itself`)
      assert.ok(
        html.includes(BODY_SENTINELS[key][lang ?? 'zh']),
        `${lang ?? 'no language'}: ${key} lost its sentence`,
      )
    }
  }
})

test('a colon in real copy is not mistaken for a key', async () => {
  // The control for the parser above. Meetup bodies are a place and a clock
  // time; nothing about them may be swallowed.
  const { rowHtml } = await loadRenderer()
  for (const lang of READERS) {
    const html = rowHtml({ type: 'meetup', title: 'x', body: 'Illini Union · 3/5 14:30 CT' }, lang)
    assert.match(html, /Illini Union/)
    assert.match(html, /14:30 CT/)
  }
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
  const KEY_FOR = {
    saved_search_match: 'notif.savedSearchMatch',
    new_listing_from_followee: 'notif.followeeListing',
    transaction_rating_received: 'notif.ratingReceived',
    deal_marked_sold: 'notif.dealMarkedSold',
    new_follower: 'notif.newFollower',
    post_comment: 'notif.postComment',
    post_like: 'notif.postLike',
    post_comment_like: 'notif.commentLike',
  }
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
