/*
 * api/translate.js screens the model's output for contact channels, mirroring
 * the three contact_info branches of public.content_moderation_check. The
 * source of a translation was written through that trigger; the translation is
 * generated text that has passed nothing, and it renders on a second member's
 * screen as their counterparty's words.
 *
 * The verdicts below are not hand-written. Each one is what PostgreSQL returned
 * when content_moderation_normalize + content_moderation_check were installed in
 * an empty database (empty moderation_keywords, so the only reachable verdicts
 * are contact_info and NULL) and handed this corpus. That makes this a mirror
 * test rather than a change detector: it fails when the JS screen stops agreeing
 * with what the database actually does, not merely when someone edits a regex.
 * Regenerated on 17.11 against 089 + 20260818162716, which moved 'vx' onto a
 * copy that keeps the whitespace and reads it with latin word boundaries. Every
 * verdict here is unchanged except "vxworks developer", which the old rule
 * refused as contact info.
 *
 * If a later migration redefines content_moderation_check, the last assertion
 * here fails on purpose — regenerate these verdicts against the new definition
 * before updating it.
 *
 * 20260903060000 ended the mirror: sharing contact info is allowed everywhere
 * a member types, so content_moderation_check has no contact_info branch left
 * and every verdict below is now the historical one. The screen keeps them on
 * purpose. What a member chooses to publish about themselves and what a
 * machine translator emits into somebody else's chat window are different
 * questions, and only the second one is unattributed. Whether the screen stays
 * at all is a decision about api/translate.js, not about the trigger.
 *
 * Two deliberate divergences, both toward withholding more than the trigger
 * does, because this screens generated text rather than what a member typed:
 * a translator that renders 微信 as "we chat" is the risk the trigger never
 * sees. The focused English regression below keeps ordinary "we chat" flowing;
 * the contextual cases after it ("contact me on we chat") stay withheld even
 * though the trigger now allows them.
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
  ["vxworks developer", ""],
  ["VxWorks dev board, $40", ""],
  ["ＷｅＣｈａｔ", "contact_info"],
  ["微信", "contact_info"],
  ["微 信", "contact_info"],
  ["lamp $15, wechat abc, call 13812345678", "contact_info"],
  ["面交 or 邮寄，微信同号", "contact_info"],
  ["TV, Xbox", ""],
  ["Selling my TV, Xbox and a desk", ""],
  ["TV,Xbox bundle $200", ""],
  ["55 inch TV + Xbox", ""],
  ["Nintendo Switch, Xbox Series X", ""],
  ["Nov X meetup at the Union", ""],
  ["text me and we chat about pickup", ""],
  ["DM me, we chat later", ""],
  ["we chatted yesterday about the price", ""],
  ["add me on wechat", "contact_info"],
  ["add me on we-chat", "contact_info"],
  ["w.e.c.h.a.t me", "contact_info"],
  ["vx号私聊", "contact_info"],
  ["VX 12345", "contact_info"],
  ["v.x. 12345", "contact_info"],
  ["加 微 信 详 聊", "contact_info"],
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

  // The English that collapses into a WeChat keyword once the spaces come out
  // is the half a corpus loses first, and losing it is what let the trigger
  // refuse "TV, Xbox" for months.
  const collisions = CORPUS.filter(([text, verdict]) =>
    verdict === '' && /xbox|we chat|we chatted|nov x|vxworks/i.test(text)).length
  assert.ok(collisions >= 8, 'lost the English that collapses into a WeChat keyword')
})

test('the output screen does not join ordinary English words into WeChat', async () => {
  const contactSignals = await loadContactSignals()

  for (const ordinary of [
    'Can we chat tomorrow?',
    'Maybe we... chat later.',
    'Can we, chat tomorrow?',
    'Should we\nchat tomorrow?',
    'We chat about class every Friday.',
    'Message me when we chat tomorrow.',
    'My friend and I, we chat daily.',
    'We chat 2 times a week.',
    'We chat 24/7.',
    'We chat, mostly after class.',
    'We chat—often after class.',
    'We chat - usually after class.',
    'We chat: sometimes for hours.',
    'We chat, later.',
    'We chat: tomorrow.',
    'We chat - daily.',
    'I find we chat less now.',
    'The message we chat about was helpful.',
    'In this message we chat about class.',
    'We chat, privately.',
    'We chat—quietly.',
    'We chat: rarely.',
    'We chat GPT4.',
    'We chat web3.',
    'We chat code every Friday.',
    'We chat number theory after class.',
    'We chat on CS_225.',
    'We chat (mostly) after class.',
    'We chat / talk after class.',
    'We chat = communicate informally.',
    'Add we chat to the glossary.',
    'The way we chat is fun.',
    'How we chat is private.',
    'We chat as friends.',
    'We chat number theory.',
    'We chat code examples.',
    'We chat (privately).',
    'We chat [briefly].',
    "This is my 'we chat' example.",
    'We chat as usual.',
    'We chat under pressure.',
    'We chat (often).',
    'We chat / talk.',
    'We chat = communicate.',
    'We chat code review.',
    'We chat: GPT4.',
    'We chat @ home.',
    'This is our code we chat about.',
    'That is my alias we chat about in class.',
    'We chat @5pm.',
    'We chat @ 5pm.',
    'We chat @school.',
    'We chat @ gate2.',
    'We chat - web3.',
    'We chat, CS225.',
    'We chat (GPT4).',
    'We chat [i18n].',
    'We chat with John Doe.',
    'We chat at noon.',
    'We chat over lunch.',
    'We chat by video.',
    'We chat for fun.',
    'We chat to learn.',
    'We chat using emojis.',
    'We chat as a group.',
    'We chat while walking.',
    'We chat after class.',
    'We chat before dinner.',
    'We chat because we are friends.',
    'We chat if we have time.',
    'We chat when we meet.',
    'We chat where it is quiet.',
    'We chat until noon.',
    'We chat without sharing contacts.',
    'We chat in class.',
    "Search for 'we chat' in the transcript.",
    "Compare 'we talk' with 'we chat'.",
    "Translate 'we talk' to 'we chat'.",
    "Replace it with 'we chat'.",
    "Use italics for 'we chat'.",
    "The example with 'we chat' is correct.",
    'Look for “we chat” in the document.',
    "Use 'we chat' in a sentence.",
    "Search for ('we chat') in the transcript.",
    'Compare [“we chat”] with [“we talk”].',
    "Use the phrase 'we chat' in a sentence.",
    'The literal 「we chat」 appears in the document.',
    'Replace {we chat} with {we talk}.',
    'We meet at school when we chat.',
    "Search for the official 'we chat' phrase in the transcript.",
    'Look for a private “we chat” example in the document.',
    'Compare x with our new «we chat» literal.',
    'Replace x with the official 【we chat】 term.',
    'Translate x to your private <we chat> example.',
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
    'we chat me on abc_123',
    'my we chat ID is abc',
    'contact me via we chat',
    'we chat @abc_123',
    'we chat @ abc_123',
    'reach me on we chat',
    'find me on we chat',
    'my ID on we chat is abc',
    'talk to me on we chat',
    'connect with me on we chat',
    'ping me on we chat',
    'hit me up on we chat',
    'catch me on we chat',
    'look me up on we chat',
    'we chat = abc123',
    'we chat -> abc123',
    'we chat / abc_123',
    'we chat (abc_123)',
    'we chat alias abc123',
    'we chat is abc123',
    'we chat: @abc_123',
    'we chat: @ abc_123',
    'we chat = @ abc_123',
    'we chat (@ abc_123)',
    'we chat @\u200Babc_123',
    'Contact me on "we chat" as eric123',
    'Find me through we chat under eric123',
    'message me at we chat',
    'reach me using we chat',
    'add me to we chat',
    '联系我 we chat',
    'we chat 账号 abc123',
    'we chat username eric',
    'we chat id @ eric',
    'we chat as @eric',
    'we chat (@eric)',
    'we chat - @eric',
    'we chat 号 abc123',
    'reach Eric on we chat',
    'contact me on (“we chat”) as eric123',
    'w:e:c:h:a:t me',
    'w/e/c/h/a/t me',
    'w·e·c·h·a·t me',
    'ping me\u200Bon we chat',
    'my handle for we chat',
    'our account for we chat',
    'my username with we chat',
    'contact me over we chat',
    'reach me by we chat',
    'we chat 联系我',
    'we chat 加我',
    'contact me o\u200Bn we chat',
    'my i\u200Bd for we chat',
    '联\u200B系我 we chat',
    '联系\u200B我 we chat',
    '加\u{E0100}我 we chat',
    'we chat 联\u200B系我',
    'we chat 加\u200B我',
    'we chat i\u200Bd: eric',
    'we chat user\u200Bname=eric',
    'contact John Doe on we chat',
    'message my roommate on we chat',
    'add Eric on we chat',
    'ping Eric on we chat',
    'connect with Eric on we chat',
    'talk to Eric on we chat',
    'contact @eric on we chat',
    'contact me on «we chat»',
    '联系张三 on we chat',
    '加 Eric on we chat',
    "contact O'Connor on we chat",
    'connect with Dr. Li on we chat',
    'ping @eric.x over we chat',
    'contact the owner of this listing on we chat',
    "contact John O'Connor on we chat",
    'contact Dr. Smith on we chat',
    'contact John & Jane on we chat',
    'contact @eric.xu on we chat',
    'DM Eric on we chat',
    'send Eric a message on we chat',
    'send the address through we chat',
    "let's move this to we chat",
    'move this to we chat',
    'switch to we chat',
    'please switch this chat to we chat',
    'can we move the conversation to we chat',
    'use we chat to contact Eric',
    'use we chat to send Eric a message',
    'we chat to send the address',
    'text Eric on we chat',
    'follow Eric on we chat',
    'look up Eric on we chat',
    'hit Eric up on we chat',
    'we should switch to we chat',
    "let's continue on we chat",
    'take this to we chat',
    'use we chat to text Eric',
    'use we chat to talk to Eric',
    'use we chat to connect with Eric',
    'contact John, Jane, and Eric on we chat',
    '联系张三用 we chat',
    '在 we chat 上找张三',
    'we chat 上找 Eric',
    'send it in we chat',
    'DM Eric in we chat',
    'message me in we chat',
    'my handle in we chat',
    'continue in we chat',
    'move this into we chat',
    'switch onto we chat',
    'contact Eric through the we chat app',
    'use the we chat app to contact Eric',
    'switch to the we chat app',
    'message Eric on our we chat account',
    'dm Eric using my we chat id',
    'send the address through a we chat message',
    'open we chat and message Eric',
    'use we chat and contact Eric',
    'move the conversation onto we chat',
    'contact Eric within we chat',
    '把消息发到 we chat',
    '转到 we chat',
    '移到 we chat',
    "continue on 'we chat'",
    "stay on 'we chat'",
    "meet on 'we chat'",
    "talk on 'we chat'",
    "take this to 'we chat'",
    "move over to 'we chat'",
    'open "we chat" and message Eric',
    'use «we chat» and contact Eric',
    'open 【we chat】 then DM Eric',
    'contact Eric through the official we chat app',
    'use the official we chat app to contact Eric',
    'switch to the official we chat app',
    'message Eric on our private we chat account',
    'dm Eric using my new we chat id',
    'send the address through a private we chat message',
    '把消息发到官方 we chat',
    "open 'we chat' app",
    "open the official 'we chat' app",
    "use our private 'we chat' account",
    "use the official 'we chat' app to contact Eric",
    "open 'we chat' and then message Eric",
    "open 'we chat', then message Eric",
    "use 'we chat', and contact Eric",
    'open 【we chat】，then DM Eric',
    'Search for "we chat" account, then contact Eric',
    'Search for "we chat" app, and then message Eric',
    'Compare x with "we chat" id, to contact Eric',
    'contact me on 「we chat」',
    'contact me on 【we chat】',
    'contact me on {we chat}',
    'contact me on <we chat>',
    '用 we chat 联系张三',
    'we chat 联系张三',
    '在 we chat 上联系我',
    'We\u2066Chat me',
    'We\u202EChat me',
    'We\u{E0100}Chat me',
    'We\u{E0061}Chat me',
    'contact me on\u200B we chat',
    'ping me\u2060 on we chat',
    '联系我\u200B we chat',
    'my id on\u{E0100} we chat',
    'us via\u202E we chat',
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
    '20260903060000_allow_contact_info_and_layer_ad_detection.sql',
    'content_moderation_check was redefined after 20260903060000 — regenerate the corpus verdicts in '
      + 'this file against the new definition, then update the JS screen in api/translate.js '
      + 'to match before changing this assertion',
  )
})
