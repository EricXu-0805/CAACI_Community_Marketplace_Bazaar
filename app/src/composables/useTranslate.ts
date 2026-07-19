import { ref } from 'vue'
import { quickTranslate } from '../utils'
import { platformFetch, useSupabase } from './useSupabase'
import { addBreadcrumb } from '../utils/sentry'
import { SUPPORTED_LANGS, type Lang as AppLang } from './useI18n'
import { clearAutoLocalizeCache, fullTextCacheKey } from './i18n/translate'
import { BASE_URL } from '../config/runtime'
import {
  captureAccountRequest,
  getActiveAccountId,
  isAccountRequestCurrent,
} from './accountScope'
import {
  readAccountPrivateStorage,
  registerAccountPrivateStateHydrate,
  registerAccountPrivateStateReset,
  removeAccountPrivateStorage,
  writeAccountPrivateStorage,
} from '../api/accountLocalPrivacy'
import { readBoundedJson } from '../api/responseBody'

/*
 * Target-language type for this composable's translation API.
 *
 * We currently hit an OpenAI translation endpoint that's optimized for
 * bidirectional zh↔en, so the request payload is still typed as
 * 'zh' | 'en'. The source argument on the item-level helper below,
 * however, accepts the full app Lang union (zh | en | ja | ko | zh-Hant)
 * so callers don't have to do the narrowing themselves — unsupported
 * targets just resolve to an empty translation, preserving the
 * "show the original" contract in localize().
 */
type Lang = 'en' | 'zh'
const TRANSLATABLE: Lang[] = ['zh', 'en']

interface CachedEntry {
  translated: string
  target: Lang
  at: number
  lastUsedAt?: number
}

interface TranslationResult {
  text: string
  verified: boolean
}

export const TRANSLATE_CACHE_STORAGE_KEY = 'translate_cache_v2'
const LEGACY_TRANSLATE_CACHE_STORAGE_KEYS = ['translate_cache_v1'] as const
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 500
const MAX_TRANSLATION_RESPONSE_BYTES = 64 * 1024

let endpoint = '/api/translate'
try {
  // #ifdef H5
  if (typeof window !== 'undefined' && window.location?.origin) {
    endpoint = window.location.origin + '/api/translate'
  }
  // #endif
} catch {}
// #ifndef H5
endpoint = `${BASE_URL}/api/translate`
// #endif

const mem = new Map<string, CachedEntry>()
let loadedFromDisk = false
let translateCacheGeneration = 0
const activeTranslateControllers = new Set<AbortController>()

function setLru(key: string, value: CachedEntry) {
  mem.delete(key)
  mem.set(key, value)
  while (mem.size > CACHE_MAX_ENTRIES) {
    const oldest = mem.keys().next().value as string | undefined
    if (!oldest) break
    mem.delete(oldest)
  }
}

function loadDisk() {
  if (loadedFromDisk) return
  const stored = readAccountPrivateStorage<unknown>(TRANSLATE_CACHE_STORAGE_KEY, '')
  // Owner reconciliation has not completed (or cleanup is unresolved). Keep
  // this retryable so the post-reconciliation hydrator can safely load it.
  if (!stored.allowed) return
  loadedFromDisk = true
  try {
    const raw = stored.value
    if (typeof raw !== 'string' || !raw) return
    const parsed = JSON.parse(raw) as Record<string, CachedEntry>
    const now = Date.now()
    Object.entries(parsed)
      .filter(([, v]) => v && typeof v.translated === 'string' && now - v.at < CACHE_TTL_MS)
      .sort((a, b) => (a[1].lastUsedAt || a[1].at) - (b[1].lastUsedAt || b[1].at))
      .forEach(([k, v]) => setLru(k, v))
  } catch {}
}

function persistDisk() {
  const obj: Record<string, CachedEntry> = {}
  mem.forEach((v, k) => { obj[k] = v })
  writeAccountPrivateStorage(TRANSLATE_CACHE_STORAGE_KEY, JSON.stringify(obj))
}

function cacheKey(text: string, target: Lang): string {
  return fullTextCacheKey(text, target)
}

/* One authoritative clear entrypoint for settings/logout tooling. It removes
   both persistent publish-time translations and the reactive auto-localize
   cache, including in-flight requests, so stale in-memory values cannot
   immediately repopulate UI after storage alone was cleared. */
function resetTranslationMemory() {
  translateCacheGeneration++
  for (const ctrl of activeTranslateControllers) ctrl.abort()
  activeTranslateControllers.clear()
  mem.clear()
  loadedFromDisk = false
  clearAutoLocalizeCache()
}

export function clearTranslationCache() {
  resetTranslationMemory()
  let removed = removeAccountPrivateStorage(TRANSLATE_CACHE_STORAGE_KEY)
  for (const key of LEGACY_TRANSLATE_CACHE_STORAGE_KEYS) {
    removed = removeAccountPrivateStorage(key) && removed
  }
  // A verified removal means the empty disk state is already hydrated. If the
  // owner gate denied it, leave loading retryable for the next reconciliation.
  loadedFromDisk = removed
}

// Translation results can contain unpublished listing/post copy and are stored
// in a process-wide singleton plus device storage.  Clear them on every
// authoritative identity transition (including a direct A -> B setSession)
// rather than relying only on the explicit sign-out path. Persistent values
// are erased by accountLocalPrivacy only when ownership actually changes;
// same-owner cold starts retain and safely rehydrate their cache.
registerAccountPrivateStateReset(resetTranslationMemory)
registerAccountPrivateStateHydrate(loadDisk)

export function useTranslate() {
  loadDisk()
  const pending = ref(false)
  let pendingRequests = 0

  function getCached(text: string, target: Lang): string | null {
    // Disk entries are account-owned. During cold-start authority is still
    // null even if the backing storage contains a prior user's cache; callers
    // must not render a hit until useAuth has reconciled that owner.
    if (!getActiveAccountId()) return null
    loadDisk()
    const key = cacheKey(text, target)
    const hit = mem.get(key)
    if (!hit) return null
    if (Date.now() - hit.at > CACHE_TTL_MS) {
      mem.delete(key)
      return null
    }
    hit.lastUsedAt = Date.now()
    setLru(key, hit)
    return hit.translated
  }

  async function translateResult(text: string, target: Lang): Promise<TranslationResult> {
    if (!text || !text.trim()) return { text, verified: true }
    const entryUserId = getActiveAccountId()
    if (!entryUserId) return { text: quickTranslate(text, target), verified: false }
    const accountToken = captureAccountRequest(entryUserId)
    if (!isAccountRequestCurrent(accountToken)) {
      return { text: quickTranslate(text, target), verified: false }
    }

    pendingRequests += 1
    pending.value = true
    try {
      /* /api/translate requires a Supabase JWT (abuse control — the
         endpoint fronts paid OpenAI calls). Logged-out users skip the
         round trip entirely and get the static dictionary. */
      const { supabase } = useSupabase()
      const { data: sess } = await supabase.auth.getSession()
      const session = sess.session
      const jwt = session?.access_token
      if (!jwt || !session?.user) return { text: quickTranslate(text, target), verified: false }
      if (
        session.user.id !== accountToken.userId
        || !isAccountRequestCurrent(accountToken)
      ) {
        return { text: quickTranslate(text, target), verified: false }
      }

      // Translation cache entries can contain unpublished copy and are owned
      // by the authenticated storage owner. Never expose a disk/memory hit
      // before the session has been bound to the active account generation.
      const cached = getCached(text, target)
      if (cached) return { text: cached, verified: true }

      const ctrl = new AbortController()
      const cacheGeneration = translateCacheGeneration
      activeTranslateControllers.add(ctrl)
      const timer = setTimeout(() => ctrl.abort(), 8000)
      let json: any
      try {
        const r = await platformFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ text, target }),
          signal: ctrl.signal,
        })

        if (!isAccountRequestCurrent(accountToken)) {
          return { text: quickTranslate(text, target), verified: false }
        }
        if (!r.ok) return { text: quickTranslate(text, target), verified: false }
        json = await readBoundedJson(r, {
          maxBytes: MAX_TRANSLATION_RESPONSE_BYTES,
          timeoutMs: 8000,
        })
        if (!isAccountRequestCurrent(accountToken)) {
          return { text: quickTranslate(text, target), verified: false }
        }
      } finally {
        // Keep both the caller signal and its total 8 s budget active until
        // the JSON body has been consumed, not merely until headers arrive.
        clearTimeout(timer)
        activeTranslateControllers.delete(ctrl)
      }

      /*
       * Surface server-side skip reasons in Sentry as breadcrumbs (NOT
       * exceptions — skipped: true is a 200 OK, not a failure).
       * api/translate.js returns { skipped: true, reason: 'no_key' |
       * 'empty' | 'upstream_<status>' } when the OpenAI proxy can't
       * fulfil the request. Without this trail, "translations stopped
       * working" reports require a server-log audit; with it the
       * reason is visible in the user's Sentry session within seconds.
       * Per Fix 5 audit recommendation 6d. Text content is NOT
       * included to avoid PII / oversized payloads.
       */
      if (json && json.skipped === true) {
        addBreadcrumb({
          category: 'api.translate',
          level: 'info',
          message: 'translate skipped',
          data: {
            reason: typeof json.reason === 'string' ? json.reason : 'unknown',
            target,
            text_len: text.length,
          },
        })
      }

      const translated = typeof json?.translated === 'string' ? json.translated.trim() : ''
      if (!translated) return { text: quickTranslate(text, target), verified: false }

      // A settings-triggered clear may abort this request after the upstream
      // already responded. Return the useful result to its caller, but never
      // let the stale completion repopulate the just-cleared cache.
      if (
        cacheGeneration === translateCacheGeneration
        && isAccountRequestCurrent(accountToken)
      ) {
        const now = Date.now()
        setLru(cacheKey(text, target), { translated, target, at: now, lastUsedAt: now })
        persistDisk()
      }
      return isAccountRequestCurrent(accountToken)
        ? { text: translated, verified: true }
        : { text: quickTranslate(text, target), verified: false }
    } catch {
      return { text: quickTranslate(text, target), verified: false }
    } finally {
      pendingRequests = Math.max(0, pendingRequests - 1)
      pending.value = pendingRequests > 0
    }
  }

  async function translate(text: string, target: Lang): Promise<string> {
    return (await translateResult(text, target)).text
  }

  /*
   * Publish-time content translation.
   *
   * Given the text the author typed and the language they typed it in,
   * produce the complementary translations for every OTHER supported
   * locale and return a map ready to drop into jsonb columns like
   * items.title_i18n / description_i18n / posts.content_i18n.
   *
   * Guarantees the source lang is always present in the returned map so
   * the frontend's `map[lang] ?? original` fallback never re-translates
   * the author's words. Individual target-lang failures fall through
   * silently — we prefer a partial i18n map over blocking the publish.
   *
   * Caller is expected to run this async after the insert has already
   * returned, then upsert the result back onto the row. Blocking the
   * publish UI on translation would feel laggy and the endpoint can be
   * cold.
   */
  async function translateContentToAll(
    text: string,
    sourceLang: AppLang,
  ): Promise<Record<string, string>> {
    const map: Record<string, string> = {}
    if (!text || !text.trim()) return map
    map[sourceLang] = text

    const targets = TRANSLATABLE.filter(l => l !== sourceLang)
    await Promise.all(
      targets.map(async (target) => {
        try {
          // Publish-time persistence is stricter than the on-screen helper:
          // dictionary fallback is useful for immediate display, but it is not
          // a verified full translation and must never become durable i18n data.
          const result = await translateResult(text, target)
          if (result.verified && result.text && result.text !== text) map[target] = result.text
        } catch { /* swallow: partial map is fine */ }
      }),
    )
    return map
  }

  /*
   * Translate both title and description (or content) in one call so a
   * publish flow that wants bilingual storage can just:
   *   const { title_i18n, description_i18n } = await translateItemContent({ … })
   *   await updateItem(id, { title_i18n, description_i18n })
   */
  async function translateItemContent(input: {
    title: string
    description?: string
    sourceLang: AppLang
  }): Promise<{
    title_i18n: Record<string, string>
    description_i18n: Record<string, string>
  }> {
    const [title_i18n, description_i18n] = await Promise.all([
      translateContentToAll(input.title, input.sourceLang),
      translateContentToAll(input.description || '', input.sourceLang),
    ])
    return { title_i18n, description_i18n }
  }

  return {
    translate,
    getCached,
    pending,
    translateContentToAll,
    translateItemContent,
    clearCache: clearTranslationCache,
    SUPPORTED_LANGS,
  }
}
