import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

/**
 * What the contact-info detector refuses, and what it must not.
 *
 * This is a marketplace for textbooks, so ISBNs are ordinary listing text.
 * `normalize()` strips every separator before the regexes run, which left
 * US_MOBILE as an effective /\d{10}/ — it refused every ISBN-10 and most
 * 10-digit serials with "Please use in-app chat — no phone, WeChat, or email
 * allowed here", a message about contact info on copy that had none. The same
 * stripping deleted the dots and @ that EMAIL depends on, so that rule matched
 * nothing at all.
 *
 * Migration 089 draws the line the server uses: keyword lexicon against the
 * stripped copy, email and phone against a folded-but-unstripped one. These
 * cases pin the client to the same split, and to the NANP constraint that an
 * area code and an exchange code cannot begin with 0 or 1.
 *
 * Executed rather than pattern-matched: a regex test that reads the source
 * would keep passing against a rule that no longer fires.
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
    .replace(/\((s|raw): string\)/g, '($1)')
    .replace(/\): string \{/g, ') {')
    .replace(/\): \{ hit: boolean; matched: string\[\] \} \{/g, ') {')
  return new Function(`${js}\nreturn hasContactInfo`)()
}

// [label, text, must be refused]
const CASES = [
  ['ISBN-10, English group', '0134093410', false],
  ['ISBN-10, hyphenated', '0-13-409341-0', false],
  ['ISBN-10, classic', '0306406152', false],
  ['ISBN-13', '978-0-134-09341-3', false],
  ['ISBN-10, Chinese group', '7040395738', false],
  ['calculator serial', 'TI-84 Plus CE serial 1234567890', false],
  ['price list', 'was 129.99 now 99.00 for 2 items', false],
  ['dates', 'bought 2024 08 15, barely used', false],
  ['dorm and year', 'PAR 314 pickup, 2026 grad', false],
  ['course numbers', 'ECE 220 CS 225 MATH 241 textbooks', false],
  ['digit run longer than a phone number', 'model 12345678901234', false],

  ['US phone, no separators', 'call me 2175550123', true],
  ['US phone, dashed', 'text 217-555-0123', true],
  ['US phone, spaced', '217 555 0123', true],
  ['US phone, dotted', '217.555.0123', true],
  ['CN mobile', '13812345678', true],
  ['email', 'reach me at a@b.edu', true],
  ['email, full width', 'reach me at ａ＠ｂ．ｅｄｕ', true],
  ['WeChat', '加微信详聊', true],
]

test('a listing may carry an ISBN without being refused as contact info', async () => {
  const hasContactInfo = await loadHasContactInfo()
  const wrong = []
  for (const [label, text, shouldRefuse] of CASES) {
    const { hit, matched } = hasContactInfo(text)
    if (hit !== shouldRefuse) {
      wrong.push(`${shouldRefuse ? 'should refuse' : 'should allow'}: ${label} -> ${hit ? `refused [${matched}]` : 'allowed'}`)
    }
  }
  assert.deepEqual(wrong, [], `contact detection disagrees on:\n${wrong.join('\n')}`)
})

test('the corpus keeps both kinds of case, so it cannot be satisfied by a constant answer', () => {
  const refused = CASES.filter(([, , shouldRefuse]) => shouldRefuse).length
  assert.ok(refused >= 8, 'lost the must-refuse half')
  assert.ok(CASES.length - refused >= 8, 'lost the must-allow half')
})

test('the structure-sensitive rules read the unstripped copy', async () => {
  const src = await readFile(SOURCE_URL, 'utf8')
  // The bug was not the regexes; it was which string they were handed.
  assert.match(src, /if \(US_MOBILE\.test\(f\)\)/, 'US_MOBILE must read the folded copy')
  assert.match(src, /if \(EMAIL\.test\(f\)\)/, 'EMAIL must read the folded copy')
  assert.match(src, /if \(CN_MOBILE\.test\(n\)\)/, 'CN_MOBILE stays on the stripped copy')
})
