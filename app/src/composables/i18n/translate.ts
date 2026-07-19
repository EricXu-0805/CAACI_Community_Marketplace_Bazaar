import { ref } from 'vue'
import { platformFetch, useSupabase } from '../useSupabase'
import type { Lang } from './types'
import { BASE_URL } from '../../config/runtime'
import { readBoundedJson } from '../../api/responseBody'
import {
  captureAccountRequest,
  getActiveAccountId,
  isAccountRequestCurrent,
} from '../accountScope'

/*
 * Shared auto-localize cache.
 *
 * Keyed from the complete source text, reactive so any component
 * currently rendering an entry will re-render the moment a value
 * lands (via the returned ref's .value = ...).
 *
 * Stored OUTSIDE any useI18n() closure so every page that asks for
 * the same translation reuses the same in-memory result — e.g. the
 * home list, detail page, and chat header all share the cache for
 * the same item title. Resets when the tab closes. We don't persist
 * this to storage because successful translations should land back
 * into the DB via publish-time upsert; this cache only fills the
 * interim window.
 */
const AUTO_LOCALIZE_CACHE_MAX = 500
const AUTO_RETRY_COOLDOWN_MS = 30_000
const MAX_TRANSLATION_RESPONSE_BYTES = 64 * 1024

export const autoLocalizeCache = ref<Record<string, string>>({})
const autoLocalizeOrder: string[] = []
const inflightAutoTranslate = new Map<string, AbortController>()
const autoRetryAfter = new Map<string, number>()
let autoCacheGeneration = 0

/* A deterministic, synchronous 128-bit full-text hash that works in H5 and
   every mini-program runtime (WebCrypto is not uniformly available there).
   Unlike the old length + first-200-chars key, every UTF-16 code unit affects
   all four lanes, making wrong cross-text cache hits practically impossible. */
export function stableTextHash(text: string): string {
  let h1 = 0x6a09e667
  let h2 = 0xbb67ae85
  let h3 = 0x3c6ef372
  let h4 = 0xa54ff53a
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x9e3779b1) ^ h4
    h2 = Math.imul(h2 ^ code, 0x85ebca77) ^ h1
    h3 = Math.imul(h3 ^ code, 0xc2b2ae3d) ^ h2
    h4 = Math.imul(h4 ^ code, 0x27d4eb2f) ^ h3
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 0x85ebca6b)
  h2 = Math.imul(h2 ^ (h2 >>> 13), 0xc2b2ae35)
  h3 = Math.imul(h3 ^ (h3 >>> 16), 0x85ebca6b)
  h4 = Math.imul(h4 ^ (h4 >>> 13), 0xc2b2ae35)
  return [h1, h2, h3, h4]
    .map(h => (h >>> 0).toString(16).padStart(8, '0'))
    .join('')
}

export function fullTextCacheKey(text: string, target: Lang): string {
  return `${target}:${text.length}:${stableTextHash(text)}`
}

export function autoKey(text: string, target: Lang): string {
  return fullTextCacheKey(text, target)
}

function touchAutoKey(key: string) {
  const idx = autoLocalizeOrder.indexOf(key)
  if (idx >= 0) autoLocalizeOrder.splice(idx, 1)
  autoLocalizeOrder.push(key)
}

export function getAutoLocalized(text: string, target: Lang): string | undefined {
  const key = autoKey(text, target)
  const hit = autoLocalizeCache.value[key]
  if (hit !== undefined) touchAutoKey(key)
  return hit
}

function rememberAutoLocalize(key: string, value: string): void {
  touchAutoKey(key)
  let next = { ...autoLocalizeCache.value, [key]: value }
  while (autoLocalizeOrder.length > AUTO_LOCALIZE_CACHE_MAX) {
    const evicted = autoLocalizeOrder.shift()
    if (evicted) {
      const { [evicted]: _, ...rest } = next
      next = rest
    }
  }
  autoLocalizeCache.value = next
  autoRetryAfter.delete(key)
}

function deferAutoRetry(key: string) {
  autoRetryAfter.delete(key)
  autoRetryAfter.set(key, Date.now() + AUTO_RETRY_COOLDOWN_MS)
  while (autoRetryAfter.size > AUTO_LOCALIZE_CACHE_MAX) {
    const oldest = autoRetryAfter.keys().next().value as string | undefined
    if (!oldest) break
    autoRetryAfter.delete(oldest)
  }
}

export function clearAutoLocalizeCache() {
  autoCacheGeneration++
  for (const ctrl of inflightAutoTranslate.values()) ctrl.abort()
  inflightAutoTranslate.clear()
  autoRetryAfter.clear()
  autoLocalizeOrder.splice(0, autoLocalizeOrder.length)
  autoLocalizeCache.value = {}
}

export function scheduleAutoTranslate(text: string, target: Lang) {
  if (!text || !text.trim()) return
  const key = autoKey(text, target)
  if (getAutoLocalized(text, target) !== undefined) return
  if (inflightAutoTranslate.has(key)) return
  const retryAt = autoRetryAfter.get(key) || 0
  if (retryAt > Date.now()) return
  if (retryAt) autoRetryAfter.delete(key)
  // Only two targets supported by the translation endpoint today.
  if (target !== 'zh' && target !== 'en') return
  const entryUserId = getActiveAccountId()
  if (!entryUserId) return
  const accountToken = captureAccountRequest(entryUserId)
  if (!isAccountRequestCurrent(accountToken)) return

  let endpoint = '/api/translate'
  // #ifdef H5
  try {
    if (typeof window !== 'undefined' && window.location?.origin) {
      endpoint = window.location.origin + '/api/translate'
    }
  } catch {}
  // #endif
  // #ifndef H5
  endpoint = `${BASE_URL}/api/translate`
  // #endif

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  const generation = autoCacheGeneration
  inflightAutoTranslate.set(key, ctrl)

  const { supabase } = useSupabase()
  void supabase.auth.getSession()
    .then(({ data, error }) => {
      const jwt = data.session?.access_token
      if (
        error
        || !jwt
        || generation !== autoCacheGeneration
        || !isAccountRequestCurrent(accountToken)
        || data.session?.user.id !== accountToken.userId
      ) return null
      return platformFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ text, target }),
        signal: ctrl.signal,
      })
    })
    .then((r) => {
      if (generation !== autoCacheGeneration || !isAccountRequestCurrent(accountToken)) return null
      // 401, rate limits and transient server errors stay retryable. Never put
      // the original text in the successful cache for a failed request.
      if (!r?.ok) return null
      return readBoundedJson<any>(r, {
        maxBytes: MAX_TRANSLATION_RESPONSE_BYTES,
        timeoutMs: 10_000,
      })
    })
    .then((json) => {
      if (generation !== autoCacheGeneration || !isAccountRequestCurrent(accountToken)) return
      const translated = typeof json?.translated === 'string' ? json.translated.trim() : ''
      // An identical non-empty translation is still a successful response
      // (brand/model names often remain unchanged), so it is safe to cache.
      if (translated) rememberAutoLocalize(key, translated)
      else deferAutoRetry(key)
    })
    .catch(() => {
      if (generation !== autoCacheGeneration || !isAccountRequestCurrent(accountToken)) return
      // Network/abort failures get a short bounded cooldown, not a permanent
      // original-text cache entry. A later render/session can retry.
      deferAutoRetry(key)
    })
    .finally(() => {
      clearTimeout(timer)
      if (inflightAutoTranslate.get(key) === ctrl) inflightAutoTranslate.delete(key)
    })
}
