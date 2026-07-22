/*
 * Client-side pre-publish content safety.
 *
 * This is the FIRST of multiple layers. It blocks obvious garbage before
 * it hits the network, gives users actionable feedback ("contains a
 * suspected WeChat ID"), and keeps Supabase rate-limit counters from
 * burning on abuse attempts.
 *
 * It is NOT a trust boundary — every check here is replayed server-side
 * by the moderation hook. Never rely on this alone for safety.
 *
 * Layers (cheapest first):
 *   1. Length & whitespace sanity
 *   2. Contact-info regex (phone, WeChat/QQ ID, email, bare URL)
 *   3. Sensitive-word trie (Chinese + English, homoglyph-normalized)
 *   4. URL shortener / suspicious-TLD heuristics
 *
 * All checks return a `SafetyResult` — never throw — so callers can
 * decide whether to hard-block or just warn.
 */

import { BASE_URL } from '../config/runtime'
import { readBoundedJson } from '../api/responseBody'
import {
  captureAccountRequest,
  getActiveAccountId,
  isAccountRequestCurrent,
  type AccountRequestToken,
} from '../composables/accountScope'

export type SafetyCategory =
  | 'ok'
  | 'too_short'
  | 'too_long'
  | 'contact_info'
  | 'sensitive_word'
  | 'suspicious_link'
  | 'qr_image'
  | 'spam_pattern'

export interface SafetyResult {
  ok: boolean
  category: SafetyCategory
  reason?: string
  matched?: string[]
  action: 'allow' | 'warn' | 'block'
}

const OK: SafetyResult = { ok: true, category: 'ok', action: 'allow' }

/* ---------- 1. Length ---------- */

const MIN_POST_LEN = 1
const MAX_POST_LEN = 2000
const MAX_ITEM_TITLE = 120
const MAX_ITEM_DESC = 3000
const MAX_COMMENT = 1000
const MAX_MESSAGE = 4000

/* ---------- 2. Contact-info regex ---------- */

/* Homoglyph / obfuscation folding — collapse common evasion tricks into
   canonical ASCII. Kept in lockstep with the DB content_moderation_normalize
   (migration 089): NFKC folds full-width digits/letters/＠/． to ASCII in
   one step, then a wide invisible-formatting set (soft hyphen, word joiner,
   variation selectors, …) that would otherwise split keywords invisibly is
   stripped, then whitespace/punct, then lowercase. */
function normalize(s: string): string {
  if (!s) return ''
  return s
    .normalize('NFKC')
    .replace(/[\u00AD\u034F\u061C\u180E\u200B-\u200F\u2060-\u2064\u206A-\u206F\uFEFF\uFE00-\uFE0F]/g, '')
    .replace(/[　\s\-_.+,。，、]/g, '')
    .toLowerCase()
}

const CN_MOBILE = /(?<![0-9])1[3-9]\d{9}(?![0-9])/
const US_MOBILE = /(?<![0-9])\d{3}[-.\s]?\d{3}[-.\s]?\d{4}(?![0-9])/
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/
const WECHAT_HINT = /(微信|wechat|weixin|加v|加\s*微|v信|v我|威信|vx|私信扣)/
const QQ_HINT = /(?:qq|扣扣|企鹅)[号:：\s]*\d{5,11}/
const URL_ANY = /\b(?:https?:\/\/|www\.)[^\s]+/
const URL_SHORTENER = /\b(?:bit\.ly|t\.cn|dwz\.cn|sina\.lt|tinyurl\.com|goo\.gl|ow\.ly|tb\.cn|m\.tb\.cn)[/\w]+/

function hasContactInfo(raw: string): { hit: boolean; matched: string[] } {
  const n = normalize(raw)
  const matched: string[] = []
  if (CN_MOBILE.test(n)) matched.push('CN phone')
  if (US_MOBILE.test(n)) matched.push('US phone')
  if (EMAIL.test(n)) matched.push('email')
  if (WECHAT_HINT.test(n)) matched.push('WeChat')
  if (QQ_HINT.test(n)) matched.push('QQ')
  return { hit: matched.length > 0, matched }
}

/* ---------- 3. Sensitive-word seed list ----------
   Compact baseline — political buckets intentionally small; extend via
   Supabase `moderation_keywords` table in Security-B. All entries
   normalized through `normalize()` to match obfuscated variants. */

const SENSITIVE_WORDS_ZH = [
  '代写', '代考', '代课', '代发', '刷单', '刷赞', '刷粉',
  '招嫖', '援交', '一夜情', '约炮',
  '赌博', '博彩', '私彩', '菠菜',
  '办证', '发票', '假证', '假币',
  '贷款', '套现', '黑户',
  // Currency exchange (compliance: unlicensed money transmission / laundering).
  // Conservative multi-char phrases only — never bare 美元/人民币/dollar, which
  // would block legit price mentions. Mirror of migration 071's seed.
  '换汇', '外汇', '汇率', '套汇', '炒汇', '换美元', '换美金', '换美刀', '换人民币', '换rmb', '换软妹币',
  '兑换美元', '兑换美金', '兑换人民币', '兑换外汇', '美元换人民币', '人民币换美元', '美金换人民币', '人民币换美金',
  '买美元', '卖美元', '买人民币', '卖人民币', '兑美元', '兑美金', '兑人民币',
  '大麻', '冰毒', '摇头丸', '毒品',
  '枪支', '弹药',
  '办签', '偷渡', '假婚',
  '杀马特',
  '傻逼', '傻b', 'sb货', '垃圾货', '狗东西', '去死', '操你', '操妈', '妈死',
]

const SENSITIVE_WORDS_EN = [
  'escort', 'onlyfans', 'porn',
  'drugs', 'cocaine', 'meth', 'weed',
  'gun sale', 'ammo',
  'fake id', 'ghostwriter', 'contract cheating', 'assignment for you',
  'loan shark', 'cash advance',
  'currency exchange', 'exchange currency', 'money exchange', 'foreign exchange', 'forex',
  'buy usd', 'sell usd', 'buy rmb', 'sell rmb',
  'casino', 'betting',
  'fuck you', 'fuck off', 'bitch', 'asshole', 'kill yourself', 'kys',
]

const SENSITIVE_WORDS_NORMALIZED = [
  ...SENSITIVE_WORDS_ZH,
  ...SENSITIVE_WORDS_EN,
].map(normalize).filter(Boolean)

/*
 * Two-tier matching (mirrors DB content_moderation_check, migration 049):
 * short pure-ASCII words substring-matched against the space-stripped
 * normalization false-positive everywhere ('meth' ⊂ "method", 'anal' ⊂
 * "analysis"), so they require word boundaries against the raw text
 * instead. CJK + longer words keep the obfuscation-resistant substring.
 */
const SHORT_LATIN = /^[a-z0-9]{1,4}$/

function hasSensitiveWord(raw: string): { hit: boolean; matched: string[] } {
  const n = normalize(raw)
  const lower = raw.toLowerCase()
  const matched: string[] = []
  for (const w of SENSITIVE_WORDS_NORMALIZED) {
    if (SHORT_LATIN.test(w)) {
      if (new RegExp(`\\b${w}\\b`).test(lower)) matched.push(w)
    } else if (n.includes(w)) {
      matched.push(w)
    }
  }
  return { hit: matched.length > 0, matched }
}

/* ---------- 4. URL / suspicious-TLD ---------- */

function hasSuspiciousLink(raw: string): { hit: boolean; matched: string[] } {
  const matched: string[] = []
  if (URL_SHORTENER.test(raw)) matched.push('shortener')
  const urlHit = URL_ANY.exec(raw)
  if (urlHit) matched.push(urlHit[0])
  return { hit: matched.length > 0, matched }
}

/* ---------- Public checks ---------- */

export interface CheckOptions {
  kind: 'post' | 'comment' | 'message' | 'item_title' | 'item_desc'
  allowLinks?: boolean
}

export function checkContent(text: string, opts: CheckOptions): SafetyResult {
  const s = (text || '').trim()
  const len = s.length

  const min = opts.kind === 'item_title' ? 2 : MIN_POST_LEN
  const max =
    opts.kind === 'item_title' ? MAX_ITEM_TITLE
    : opts.kind === 'item_desc'  ? MAX_ITEM_DESC
    : opts.kind === 'comment'    ? MAX_COMMENT
    : opts.kind === 'message'    ? MAX_MESSAGE
    : MAX_POST_LEN

  if (len < min) return { ok: false, category: 'too_short', action: 'block', reason: 'too short' }
  if (len > max) return { ok: false, category: 'too_long', action: 'block', reason: `too long (>${max})` }

  const sw = hasSensitiveWord(s)
  if (sw.hit) return { ok: false, category: 'sensitive_word', action: 'block', matched: sw.matched, reason: 'contains disallowed terms' }

  const contact = hasContactInfo(s)
  if (contact.hit) {
    return {
      ok: false,
      category: 'contact_info',
      action: 'block',
      matched: contact.matched,
      reason: 'avoid sharing contact info here — use in-app chat',
    }
  }

  if (!opts.allowLinks) {
    const link = hasSuspiciousLink(s)
    if (link.hit) {
      return { ok: false, category: 'suspicious_link', action: 'block', matched: link.matched, reason: 'links are not allowed here' }
    }
  }

  return OK
}

/* ---------- Remote AI moderation (OpenAI omni-moderation via /api/moderate) ----------
   Called AFTER local checks pass, as a second-tier gate for nuanced
   violations (harassment, self-harm, sexual, etc) the keyword list
   can't catch. A deployment with no provider key explicitly disables this
   optional layer and relies on the server-side keyword triggers. Once the
   provider is configured, a network/provider/malformed-response failure is a
   failed prerequisite and blocks the write rather than reporting a false
   clean result. */

let MODERATE_ENDPOINT = '/api/moderate'
const MAX_MODERATION_RESPONSE_BYTES = 64 * 1024
// #ifdef H5
try {
  if (typeof window !== 'undefined' && window.location?.origin) {
    MODERATE_ENDPOINT = window.location.origin + '/api/moderate'
  }
} catch {}
// #endif
// #ifndef H5
MODERATE_ENDPOINT = `${BASE_URL}/api/moderate`
// #endif

export async function remoteModerate(
  text: string,
  expectedAccountToken?: AccountRequestToken,
): Promise<{ flagged: boolean; categories: string[] }> {
  if (!text || text.length < 1) return { flagged: false, categories: [] }
  /* /api/moderate requires a Supabase JWT. Every caller invokes this directly
     before an authenticated mutation, so a missing session is an auth-boundary
     failure, not a reason to skip moderation. */
  const entryUserId = getActiveAccountId()
  const accountToken = expectedAccountToken
    || (entryUserId ? captureAccountRequest(entryUserId) : null)
  if (!accountToken || !isAccountRequestCurrent(accountToken)) throw new Error('moderation_unavailable')
  const { platformFetch, useSupabase } = await import('../composables/useSupabase')
  if (!isAccountRequestCurrent(accountToken)) throw new Error('moderation_unavailable')
  const { supabase } = useSupabase()
  const { data: sess, error: sessionError } = await supabase.auth.getSession()
  const jwt = sess.session?.access_token
  if (
    sessionError
    || !jwt
    || sess.session?.user.id !== accountToken.userId
    || !isAccountRequestCurrent(accountToken)
  ) throw new Error('moderation_unavailable')

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 3500)
  let j: any
  try {
    if (!isAccountRequestCurrent(accountToken)) throw new Error('moderation_unavailable')
    const r = await platformFetch(MODERATE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    })
    if (!isAccountRequestCurrent(accountToken)) throw new Error('moderation_unavailable')
    if (!r.ok) throw new Error('moderation_unavailable')
    j = await readBoundedJson(r, {
      maxBytes: MAX_MODERATION_RESPONSE_BYTES,
      // The caller's 3.5 s controller remains active through this read; this
      // secondary bound also covers injected/non-platform fetch responses.
      timeoutMs: 3500,
    })
    if (!isAccountRequestCurrent(accountToken)) throw new Error('moderation_unavailable')
  } catch { throw new Error('moderation_unavailable') } finally {
    clearTimeout(timer)
  }
  if (j?.skipped === true && j?.reason === 'no_key') {
    return { flagged: false, categories: [] }
  }
  if (
    typeof j?.flagged !== 'boolean'
    || !Array.isArray(j?.categories)
    || j.categories.some((category: unknown) => typeof category !== 'string')
  ) {
    throw new Error('moderation_unavailable')
  }
  return { flagged: j.flagged, categories: j.categories }
}

/* ---------- Duplicate-within-session detection ---------- */

const recentSubmissions = new Map<string, number>()
const DUP_WINDOW_MS = 30_000

function dupKey(kind: string, text: string): string {
  return `${kind}::${normalize(text).slice(0, 256)}`
}

export function isLocalDuplicate(kind: string, text: string): boolean {
  const key = dupKey(kind, text)
  const now = Date.now()
  for (const [k, ts] of recentSubmissions) {
    if (now - ts > DUP_WINDOW_MS) recentSubmissions.delete(k)
  }
  if (recentSubmissions.has(key)) return true
  recentSubmissions.set(key, now)
  return false
}

// Release a hold taken by isLocalDuplicate when the submission it guarded
// never actually went through (network failure, server rejection). The guard
// records on attempt to stop an accidental rapid double-tap, but a message
// that failed to send must stay retryable — otherwise tapping "retry" within
// the 30s window is wrongly blocked as a duplicate even though nothing landed.
export function clearLocalDuplicate(kind: string, text: string): void {
  recentSubmissions.delete(dupKey(kind, text))
}
