import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

// Eric decided on 2026-09-03 that sharing contact details to arrange a trade is
// allowed. Until then rule 4 forbade it outright, so the posted rules described
// a product that no longer exists — and a moderator quoting them would have been
// enforcing a policy the platform had dropped.
//
// The two halves of that decision are pinned separately because they can drift
// apart: dropping the ban is easy to do and easy to over-apply, and the reason
// the ban existed (contact boxes are how 代购/刷单/贷款 recruiters reach people)
// did not go away. The Chinese document is checked against the same properties
// rather than against a translation of the English one — the two are written,
// not mirrored, and a rule that survives only in English is a rule half of this
// community never reads.

const LEGAL = new URL('../app/src/legal/', import.meta.url)

async function readGuidelines() {
  const [en, zh] = await Promise.all([
    readFile(new URL('guidelines.en.ts', LEGAL), 'utf8'),
    readFile(new URL('guidelines.zh.ts', LEGAL), 'utf8'),
  ])
  return { en, zh }
}

// Control. Every assertion below is a `doesNotMatch` or a `match` against a file
// read off disk, and both fail open in the same way: a wrong path, an emptied
// export, or a document that got gutted would satisfy the whole "must be absent"
// half by accident. These three checks are what make a green run mean something.
test('the test is reading the real Community Guidelines', async () => {
  const { en, zh } = await readGuidelines()

  // Two floors, because the same 14 rules take roughly a third of the
  // characters in Chinese.
  for (const [name, source, floor] of [['en', en, 3000], ['zh', zh, 1200]]) {
    assert.ok(
      source.length > floor,
      `guidelines.${name}.ts is ${source.length} chars — too short to be the document`,
    )
    // The numbered spine, not just any prose: rule 14 is the last one.
    assert.match(source, /\n14\. /, `guidelines.${name}.ts lost its numbered rules`)
  }

  const version = en.match(/export const GUIDELINES_VERSION = '([^']+)'/)
  assert.ok(version, 'guidelines.en.ts must export GUIDELINES_VERSION')
  assert.equal(
    new Date(`${version[1]}T00:00:00Z`).toISOString().slice(0, 10),
    version[1],
    `GUIDELINES_VERSION '${version[1]}' does not parse as a calendar date`,
  )
  // guidelines.zh.ts states its version as a literal rather than interpolating
  // the constant, so the two can silently diverge.
  assert.match(
    zh,
    new RegExp(`版本号：${version[1]}`),
    `guidelines.zh.ts still states a version other than ${version[1]}`,
  )
})

test('neither document prohibits sharing contact details', async () => {
  const { en, zh } = await readGuidelines()

  const banned = {
    en: [
      /No contact info in public spaces/i,
      /may not include phone numbers/i,
      /click here for details on my WeChat/i,
      /Keep conversations on Illini Market/i,
    ],
    zh: [/公共区不留联系方式/, /不得出现手机号/, /加我微信看详情/, /对话留在站内/],
  }

  for (const [name, patterns] of Object.entries(banned)) {
    const source = name === 'en' ? en : zh
    for (const pattern of patterns) {
      assert.doesNotMatch(
        source,
        pattern,
        `guidelines.${name}.ts still forbids contact details (${pattern}). ` +
          'Sharing a handle to arrange a trade has been allowed since 2026-09-03.',
      )
    }
  }

  // The permission has to be stated, not merely left unstated: a reader who
  // remembers the old rule needs to see it withdrawn.
  assert.match(en, /contact details are allowed/i, 'guidelines.en.ts never grants the permission')
  assert.match(zh, /可以留联系方式/, 'guidelines.zh.ts never grants the permission')
})

test('both documents still prohibit soliciting off-platform services and schemes', async () => {
  const { en, zh } = await readGuidelines()

  // One entry per category Eric kept prohibited. The Chinese terms are the
  // categories' own names, so they are stable across rewrites of the sentence
  // around them; the English side names the same categories in English.
  const categories = [
    ['buying agents', /buying-agent/i, /代购/],
    ['academic fraud', /ghostwriting/i, /代写/],
    ['exam fraud', /exam-taking|exam-sitting/i, /代考|助考/],
    ['forged documents', /forged documents?/i, /办证/],
    ['click farming', /click-farming/i, /刷单/],
    ['job-ad recruiting', /part-time job/i, /兼职/],
    ['loans', /\bloans?\b/i, /贷款/],
    ['currency exchange', /currency exchange/i, /换汇/],
    ['referral and pyramid schemes', /pyramid schemes?/i, /传销/],
    ['bulk commercial resale', /bulk commercial resale/i, /批量商业倒卖/],
  ]

  for (const [category, enPattern, zhPattern] of categories) {
    assert.match(en, enPattern, `guidelines.en.ts no longer prohibits ${category}`)
    assert.match(zh, zhPattern, `guidelines.zh.ts no longer prohibits ${category}`)
  }
})
