import { ref } from 'vue'
import { quickTranslate } from '../utils'
import { platformFetch } from './useSupabase'
import { SUPPORTED_LANGS, type Lang as AppLang } from './useI18n'

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
}

const CACHE_STORAGE_KEY = 'translate_cache_v1'
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 500

let endpoint = '/api/translate'
try {
  // #ifdef H5
  if (typeof window !== 'undefined' && window.location?.origin) {
    endpoint = window.location.origin + '/api/translate'
  }
  // #endif
} catch {}
// #ifndef H5
endpoint = 'https://caaci-community-marketplace-bazaar.vercel.app/api/translate'
// #endif

const mem = new Map<string, CachedEntry>()
let loadedFromDisk = false

function loadDisk() {
  if (loadedFromDisk) return
  loadedFromDisk = true
  try {
    const raw = uni.getStorageSync(CACHE_STORAGE_KEY)
    if (typeof raw !== 'string' || !raw) return
    const parsed = JSON.parse(raw) as Record<string, CachedEntry>
    const now = Date.now()
    Object.entries(parsed).forEach(([k, v]) => {
      if (v && now - v.at < CACHE_TTL_MS) mem.set(k, v)
    })
  } catch {}
}

function persistDisk() {
  try {
    if (mem.size > CACHE_MAX_ENTRIES) {
      const entries = Array.from(mem.entries()).sort((a, b) => b[1].at - a[1].at)
      mem.clear()
      entries.slice(0, CACHE_MAX_ENTRIES).forEach(([k, v]) => mem.set(k, v))
    }
    const obj: Record<string, CachedEntry> = {}
    mem.forEach((v, k) => { obj[k] = v })
    uni.setStorageSync(CACHE_STORAGE_KEY, JSON.stringify(obj))
  } catch {}
}

function cacheKey(text: string, target: Lang): string {
  return `${target}:${text.length}:${text.slice(0, 200)}`
}

export function useTranslate() {
  loadDisk()
  const pending = ref(false)

  function getCached(text: string, target: Lang): string | null {
    const hit = mem.get(cacheKey(text, target))
    if (!hit) return null
    if (Date.now() - hit.at > CACHE_TTL_MS) {
      mem.delete(cacheKey(text, target))
      return null
    }
    return hit.translated
  }

  async function translate(text: string, target: Lang): Promise<string> {
    if (!text || !text.trim()) return text
    const cached = getCached(text, target)
    if (cached) return cached

    pending.value = true
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      const r = await platformFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, target }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer))

      if (!r.ok) return quickTranslate(text, target)
      const json = await r.json()
      const translated = typeof json?.translated === 'string' ? json.translated.trim() : ''
      if (!translated) return quickTranslate(text, target)

      mem.set(cacheKey(text, target), { translated, target, at: Date.now() })
      persistDisk()
      return translated
    } catch {
      return quickTranslate(text, target)
    } finally {
      pending.value = false
    }
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
          const translated = await translate(text, target)
          if (translated && translated !== text) map[target] = translated
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
    SUPPORTED_LANGS,
  }
}
