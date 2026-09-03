import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

/**
 * Sharing contact details is allowed as of 2026-09-03: a phone number, an
 * email address, a WeChat or QQ ID, a Telegram or 小红书 handle all publish.
 * content_moderation_check drops its contact_info branches in the same
 * release, and this file's job is to keep the client from disagreeing with it.
 *
 * The direction matters. A client rule the database does not have refuses text
 * the server would accept, and the person typing has no way out — the screen
 * says no, and no edit makes it yes. That was PR #290. The old corpus lived
 * here and asserted the opposite; re-adding any one of CN_MOBILE, US_MOBILE,
 * EMAIL, WECHAT_HINT, WECHAT_LATIN or QQ_HINT reds the first test below.
 *
 * The must-refuse half is not decoration: without it a checkContent that
 * returned OK for everything would pass, and the sensitive-word lexicon and
 * the link rules are still live.
 */

const SOURCE_URL = new URL('../src/utils/contentSafety.ts', import.meta.url)

/*
 * checkContent and everything it calls are pure functions over strings, but
 * the module's imports (BASE_URL, the account scope) cannot resolve outside a
 * bundler. Lift the pure region out and strip its type annotations, so this
 * exercises the shipped source rather than a copy of it.
 */
async function loadCheckContent() {
  const src = await readFile(SOURCE_URL, 'utf8')
  const start = src.indexOf('const OK: SafetyResult')
  const end = src.indexOf('/* ---------- Remote AI moderation')
  assert.ok(start !== -1 && end > start, 'contentSafety.ts no longer exposes checkContent')

  const js = src.slice(start, end)
    .replace(/export interface CheckOptions \{[\s\S]*?\n\}\n/, '')
    .replace(/^export /gm, '')
    .replace(/\(text: string, opts: CheckOptions\): SafetyResult \{/, '(text, opts) {')
    .replace(/const OK: SafetyResult =/, 'const OK =')
    .replace(/\((\w+): string\): string \{/g, '($1) {')
    .replace(/\((\w+): string\): \{ hit: boolean; matched: string\[\] \} \{/g, '($1) {')
    .replace(/const matched: string\[\] = \[\]/g, 'const matched = []')

  // If a future annotation survives the strip, `new Function` throws something
  // unhelpful about an unexpected token. Say what actually happened instead.
  assert.equal(/:\s*(string|boolean|SafetyResult|CheckOptions)\b/.test(js), false,
    'a type annotation survived the strip — teach this loader about it')
  return new Function(`${js}\nreturn checkContent`)()
}

/** Every surface that runs the client checker before a write. */
const KINDS = ['post', 'comment', 'message', 'item_title', 'item_desc']

const MUST_PUBLISH = [
  ['WeChat, Chinese', '加微信 lisa2024'],
  ['WeChat, latin', 'add me on wechat'],
  ['WeChat, the shorthand', 'vx: illinimarket'],
  ['WeChat, pinyin', '加weixin聊'],
  ['US phone, dashed', '217-555-0199'],
  ['US phone, no separators', 'call me 2175550123'],
  ['US phone, digit by digit', 'call me 2 1 7 5 5 5 0 1 2 3'],
  ['CN mobile', '13812345678'],
  ['CN mobile, full width', '１３８１２３４５６７８'],
  ['email', 'eric@illinois.edu'],
  ['email, in a sentence', 'reach me at a@b.edu'],
  ['QQ', 'QQ 12345678'],
  ['telegram', 'telegram @lisa'],
  ['小红书', '小红书 lisa_uiuc'],
  // Ordinary copy that a contact rule used to refuse by accident. It has to go
  // on publishing for the same reason as everything above it.
  ['ISBN-10', 'ISBN 7302224463 谭浩强 C程序设计 九成新'],
  ['a console, after the comma', 'Selling my TV, Xbox and a desk'],
  ['chat as a verb', 'text me and we chat about pickup'],
]

const MUST_REFUSE = [
  ['blocklisted term, Chinese', '代写论文 100 一篇', 'sensitive_word'],
  ['blocklisted term, English', 'escort service downtown', 'sensitive_word'],
  ['blocklisted term, obfuscated', '代­写论文', 'sensitive_word'],
  ['URL shortener', 'details at bit.ly/abc123', 'suspicious_link'],
  ['bare URL', 'see https://example.com/listing', 'suspicious_link'],
]

test('contact details publish on every surface that checks content', async () => {
  const checkContent = await loadCheckContent()
  const refused = []
  for (const [label, text] of MUST_PUBLISH) {
    for (const kind of KINDS) {
      const result = checkContent(text, { kind })
      if (!result.ok) {
        refused.push(`${label} (${kind}): ${result.category} [${result.matched}] — ${JSON.stringify(text)}`)
      }
    }
  }
  assert.deepEqual(refused, [],
    `the client refused what the database now accepts:\n${refused.join('\n')}`)
})

test('the lexicon and the link rules still refuse', async () => {
  const checkContent = await loadCheckContent()
  const leaked = []
  for (const [label, text, category] of MUST_REFUSE) {
    const result = checkContent(text, { kind: 'post' })
    if (result.ok || result.category !== category) {
      leaked.push(`${label}: expected ${category}, got ${result.category} — ${JSON.stringify(text)}`)
    }
  }
  assert.deepEqual(leaked, [], `the checker stopped refusing:\n${leaked.join('\n')}`)
})

test('a link is allowed where the caller says links are allowed', async () => {
  const checkContent = await loadCheckContent()
  // Control for the test above: it must be reacting to the link rule rather
  // than refusing everything that carries a dot.
  assert.equal(checkContent('see https://example.com/listing', { kind: 'post', allowLinks: true }).ok, true)
})

test('the corpus keeps both halves, so no constant answer satisfies it', () => {
  assert.ok(MUST_PUBLISH.length >= 14, 'lost the contact-channel half')
  assert.ok(MUST_REFUSE.length >= 4, 'lost the still-refused half')
  // One entry per removed rule, or a rule can come back with nothing to catch
  // it. Phone (both numbering plans), email, WeChat and QQ.
  for (const [what, pattern] of [
    ['a US phone number', /\d{3}[- ]?\d{3}[- ]?\d{4}|\d \d \d \d/],
    ['a CN mobile number', /1[3-9]\d{9}|１３８/],
    ['an email address', /@[a-z]/],
    ['a WeChat spelling', /wechat|weixin|微信|vx/i],
    ['a QQ number', /QQ \d/],
  ]) {
    assert.ok(MUST_PUBLISH.some(([, text]) => pattern.test(text)),
      `the corpus no longer carries ${what}`)
  }
})
