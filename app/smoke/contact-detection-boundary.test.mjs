import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

/**
 * What the contact-info detector refuses, and what it must not.
 *
 * This is the only NANP phone rule in the repository. The database trigger
 * (supabase/migrations/089_moderation_nfkc_normalize.sql:64-72) checks a CN
 * mobile, an email and WeChat keywords, and /api/moderate is an OpenAI
 * category classifier that does not look at phone numbers — so if a US number
 * gets past this function, it gets published.
 *
 * Two properties are in tension and both have been broken here:
 *
 *   Separator collapse. normalize() strips nine separators before matching,
 *   which is what catches `217、555、0123` and `2 1 7 5 5 5 0 1 2 3`. Matching
 *   against the unstripped copy instead lets 13 of the 17 spellings below
 *   through, because the pattern tolerates one `[-.\s]` where stripping
 *   tolerated everything. Phone rules stay on the stripped copy.
 *
 *   Not refusing books. On the stripped copy the old pattern's separators were
 *   dead, leaving /\d{10}/, so every ISBN-10 was refused as a phone number in
 *   a marketplace built for textbooks. North American numbering — no area or
 *   exchange code begins with 0 or 1 — separates most of them, and the ISBN-10
 *   check digit separates the rest.
 *
 * The corpus therefore has to hold both halves at once. An earlier version of
 * this file carried only the four canonical phone spellings and was green
 * against a change that leaked the other thirteen.
 */

const SOURCE_URL = new URL('../src/utils/contentSafety.ts', import.meta.url)

async function loadHasContactInfo() {
  const src = await readFile(SOURCE_URL, 'utf8')
  const start = src.indexOf('function normalize(s: string): string {')
  const end = src.indexOf('function hasContactInfo')
  assert.ok(start !== -1 && end > start, 'contentSafety.ts no longer exposes normalize/hasContactInfo')
  const tail = src.slice(end, src.indexOf('\n}\n', end) + 3)
  const js = (src.slice(start, end) + tail)
    .replace(/const matched: string\[\] = \[\]/, 'const matched = []')
    .replace(/\((s|raw|stripped): string\)/g, '($1)')
    .replace(/\): string \{/g, ') {')
    .replace(/\): boolean \{/g, ') {')
    .replace(/\): \{ hit: boolean; matched: string\[\] \} \{/g, ') {')
  return new Function(`${js}\nreturn hasContactInfo`)()
}

// Every ISBN-10 here satisfies its own mod-11 check digit; a ten-digit string
// that does not is not an ISBN and is not treated as one.
const MUST_ALLOW = [
  ['ISBN-10, group 0', '0134093410'],
  ['ISBN-10, group 0, hyphenated', '0-13-409341-0'],
  ['ISBN-10, group 0, classic', '0306406152'],
  ['ISBN-10, group 7, Chinese publisher', '7302224463'],
  ['ISBN-10, group 7, second publisher', '7115234566'],
  ['ISBN-10, group 7, third publisher', '7506236788'],
  ['ISBN-10, group 7, in a real title', 'ISBN 7302224463 谭浩强 C程序设计 九成新'],
  ['ISBN-13', '978-0-134-09341-3'],
  ['bookshelf dimensions in mm', '书架 800 300 2000，5 层'],
  ['dimensions, English', 'Bookshelf 800 300 2000, 5 shelves'],
  ['prices', 'was 129.99 now 99.00 for 2 items'],
  ['dates', 'bought 2024 08 15, barely used'],
  ['dorm and year', 'PAR 314 pickup, 2026 grad'],
  ['course numbers', 'ECE 220 CS 225 MATH 241 textbooks'],
  ['digit run longer than a phone number', 'model 12345678901234'],
  ['calculator serial', 'TI-84 Plus CE serial 1234567890'],
  // Two WeChat keywords are ordinary English once the spaces come out.
  ['a console, after the comma', 'TV, Xbox'],
  ['a console, in a sentence', 'Selling my TV, Xbox and a desk'],
  ['a console, plus separated', '55 inch TV + Xbox'],
  ['a console, no separator', 'TV,Xbox bundle $200'],
  ['chat as a verb', 'text me and we chat about pickup'],
  ['chat as a verb, comma', 'DM me, we chat later'],
  ['chat in the past tense', 'we chatted yesterday about the price'],
  ['a month and a letter', 'Nov X meetup at the Union'],
  ['v before x inside a word', 'Nintendo Switch, Xbox Series X'],
]

const MUST_REFUSE = [
  ['US phone, no separators', 'call me 2175550123'],
  ['US phone, dashed', 'text 217-555-0123'],
  ['US phone, spaced', '217 555 0123'],
  ['US phone, dotted', '217.555.0123'],
  ['US phone, ideographic comma', '我的电话 217、555、0123 打给我'],
  ['US phone, full-width comma', '217，555，0123'],
  ['US phone, ideographic period', '217。555。0123'],
  ['US phone, underscored', '217_555_0123'],
  ['US phone, plus separated', '217+555+0123'],
  ['US phone, comma separated', '217,555,0123'],
  ['US phone, doubled dashes', '217--555--0123'],
  ['US phone, dash then space', '217- 555- 0123'],
  ['US phone, spaced dots', '217 . 555 . 0123'],
  ['US phone, double spaces', 'call 217  555  0123'],
  ['US phone, digit by digit', 'call me 2 1 7 5 5 5 0 1 2 3'],
  ['US phone, dashed digit by digit', '2-1-7-5-5-5-0-1-2-3'],
  ['ten digits that are not an ISBN', 'Trek frame no. 5027183946'],
  ['CN mobile', '13812345678'],
  ['email', 'reach me at a@b.edu'],
  ['email, full width', 'reach me at ａ＠ｂ．ｅｄｕ'],
  ['WeChat', '加微信详聊'],
  ['WeChat, latin', 'add me on wechat'],
  ['WeChat, latin, capitalized', 'WeChat me for pickup'],
  ['WeChat, latin, hyphen wedged in', 'add me on we-chat'],
  ['WeChat, latin, letter by letter', 'w.e.c.h.a.t me'],
  ['WeChat, pinyin', '加weixin聊'],
  ['WeChat, pinyin spaced', 'wei xin 详聊'],
  ['vx, the shorthand', 'vx: illinimarket'],
  ['vx, with a Chinese suffix', 'vx号私聊'],
  ['vx, dotted', 'v.x. 12345'],
  ['vx, capitalized', 'VX 12345'],
  ['加v', '加v详聊'],
  ['加 微 信, spaced out', '加 微 信 详 聊'],
  ['v信', 'v信联系'],
]

test('ordinary listing copy is not refused as contact info', async () => {
  const hasContactInfo = await loadHasContactInfo()
  const wrong = []
  for (const [label, text] of MUST_ALLOW) {
    const { hit, matched } = hasContactInfo(text)
    if (hit) wrong.push(`${label}: refused as [${matched}] — ${JSON.stringify(text)}`)
  }
  assert.deepEqual(wrong, [], `refused copy that carries no contact channel:\n${wrong.join('\n')}`)
})

test('a phone number is refused however it is punctuated', async () => {
  const hasContactInfo = await loadHasContactInfo()
  const wrong = []
  for (const [label, text] of MUST_REFUSE) {
    if (!hasContactInfo(text).hit) wrong.push(`${label}: allowed — ${JSON.stringify(text)}`)
  }
  assert.deepEqual(wrong, [], `contact info published unrefused:\n${wrong.join('\n')}`)
})

test('the corpus keeps both halves, so no constant answer can satisfy it', () => {
  assert.ok(MUST_ALLOW.length >= 12, 'lost the must-allow half')
  assert.ok(MUST_REFUSE.length >= 16, 'lost the must-refuse half')
  // Both halves have to carry WeChat, or moving a keyword between the copies
  // can be green while it stops catching anything, or while it refuses
  // ordinary English.
  const wechatAllowed = MUST_ALLOW.filter(([, t]) => /xbox|we chat|we chatted|nov x/i.test(t)).length
  const wechatRefused = MUST_REFUSE.filter(([, t]) => /wechat|we-chat|w\.e\.c|vx|v\.x|微信|weixin|wei xin|加v|v信|微 信/i.test(t)).length
  assert.ok(wechatAllowed >= 6, 'lost the English that collapses into a WeChat keyword')
  assert.ok(wechatRefused >= 10, 'lost the WeChat spellings')
  // The separator spellings are the ones a corpus loses first, and losing them
  // is what let a leak ship green.
  const punctuated = MUST_REFUSE.filter(([, text]) => /[、，。_+,]|\s\s|\d\s\d\s\d/.test(text)).length
  assert.ok(punctuated >= 8, 'lost the punctuated phone spellings')
})
