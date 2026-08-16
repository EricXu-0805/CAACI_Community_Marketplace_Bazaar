/*
 * api/translate.js screens the model's output for contact channels, mirroring
 * the three contact_info branches of public.content_moderation_check. The
 * source of a translation was written through that trigger; the translation is
 * generated text that has passed nothing, and it renders on a second member's
 * screen as their counterparty's words.
 *
 * The verdicts below are not hand-written. Each one is what PostgreSQL 17.10
 * returned when 089's own content_moderation_normalize + content_moderation_check
 * were installed in an empty database (empty moderation_keywords, so the only
 * reachable verdicts are contact_info and NULL) and handed this corpus. That
 * makes this a mirror test rather than a change detector: it fails when the JS
 * screen stops agreeing with what the database actually does, not merely when
 * someone edits a regex.
 *
 * If a later migration redefines content_moderation_check, the last assertion
 * here fails on purpose — regenerate these verdicts against the new definition
 * before updating it. The focused English regression below is the deliberate
 * output-only precision exception: generated "we chat" must not be withheld.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)

// contactSignals is a pure function over strings with no imports, so lifting it
// out of the handler exercises the shipped source rather than a copy of it.
async function loadContactSignals() {
  const source = await readFile(new URL('api/translate.js', root), 'utf8')
  const start = source.indexOf('const INVISIBLE_RE')
  const end = source.indexOf('export default async function handler')
  assert.ok(start !== -1 && end > start, 'api/translate.js no longer exposes the contact screen')
  return new Function(`${source.slice(start, end)}\nreturn contactSignals`)()
}

// [input, verdict PostgreSQL 17.10 returned for it]
const CORPUS = [
  ["台灯，九成新，15 刀，Grainger 面交。", ""],
  ["Desk lamp, barely used. $15, pickup at Grainger.", ""],
  ["IKEA MARKUS chair, model 802.611.50, $60 obo", ""],
  ["analysis method", ""],
  ["btw is this available", ""],
  ["v good condition", ""],
  ["Volvo XC90 parts", ""],
  ["这本书 2019 年版，7.5 折出", ""],
  ["打我电话 13812345678", "contact_info"],
  ["13812345678", "contact_info"],
  ["138 1234 5678", "contact_info"],
  ["1 3 8 1 2 3 4 5 6 7 8", "contact_info"],
  ["138-1234-5678", "contact_info"],
  ["138.1234.5678", "contact_info"],
  ["联系我：１３８１２３４５６７８", "contact_info"],
  ["12812345678", ""],
  ["138123456789012", ""],
  ["order 13812345678901234", ""],
  ["call 1381234567", ""],
  ["2381234567 8", ""],
  ["reach me at eric@example.com", "contact_info"],
  ["ERIC@EXAMPLE.COM", "contact_info"],
  ["eric＠example．com", "contact_info"],
  ["eric at example dot com", ""],
  ["e.ric+tag@sub.example.co.uk", "contact_info"],
  ["not.an.email@x", ""],
  ["@illinois", ""],
  ["a@b.co", "contact_info"],
  ["加微信详聊", "contact_info"],
  ["加\u00AD微\u00AD信 nickxu", "contact_info"],
  ["微\u200B信", "contact_info"],
  ["WeChat me", "contact_info"],
  ["weixin: abc", "contact_info"],
  ["加v聊", "contact_info"],
  ["vx: hello", "contact_info"],
  ["v我50", "contact_info"],
  ["v信 abc", "contact_info"],
  ["vxworks developer", "contact_info"],
  ["ＷｅＣｈａｔ", "contact_info"],
  ["微信", "contact_info"],
  ["微 信", "contact_info"],
  ["lamp $15, wechat abc, call 13812345678", "contact_info"],
  ["面交 or 邮寄，微信同号", "contact_info"],
  ["", ""],
  ["   ", ""],
  ["普通描述没有联系方式", ""],
]

test('the output screen reproduces what content_moderation_check does to the same strings', async () => {
  const contactSignals = await loadContactSignals()

  for (const [text, verdict] of CORPUS) {
    const signals = contactSignals(text)
    assert.equal(
      signals.length > 0,
      verdict === 'contact_info',
      `the screen and the database disagree about ${JSON.stringify(text)}: `
        + `postgres said ${verdict || 'null'}, the screen said [${signals}]`,
    )
  }

  // A corpus of only-positives or only-negatives would pass against a screen
  // that answers the same way every time.
  const positives = CORPUS.filter(([, verdict]) => verdict === 'contact_info').length
  assert.ok(positives >= 20 && CORPUS.length - positives >= 15, 'the corpus lost its balance')
})

test('the output screen does not join ordinary English words into WeChat', async () => {
  const contactSignals = await loadContactSignals()

  for (const ordinary of [
    'Can we chat tomorrow?',
    'Maybe we... chat later.',
    'Can we, chat tomorrow?',
    'Should we\nchat tomorrow?',
    'We chatted yesterday.',
  ]) {
    assert.deepEqual(contactSignals(ordinary), [], `ordinary phrase blocked: ${JSON.stringify(ordinary)}`)
  }
  for (const disguised of [
    'WeChat me',
    'We-Chat me',
    'We - Chat me',
    'We.Chat me',
    'We\u200BChat me',
    'We\uFE0FChat me',
    'w e c h a t me',
    'w echat me',
    'we c h a t me',
    'w\ne\nc\nh\na\nt me',
  ]) {
    assert.deepEqual(
      contactSignals(disguised),
      ['im'],
      `the screen missed ${JSON.stringify(disguised)}`,
    )
  }
})

test('the contact_info branches still live where these verdicts came from', async () => {
  const entries = await readdir(new URL('supabase/migrations/', root))
  const definitions = []
  for (const name of entries.filter(entry => entry.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(`supabase/migrations/${name}`, root), 'utf8')
    if (sql.includes('FUNCTION public.content_moderation_check')) definitions.push(name)
  }

  assert.equal(
    definitions.at(-1),
    '089_moderation_nfkc_normalize.sql',
    'content_moderation_check was redefined after 089 — regenerate the corpus verdicts in '
      + 'this file against the new definition, then update the JS screen in api/translate.js '
      + 'to match before changing this assertion',
  )
})
