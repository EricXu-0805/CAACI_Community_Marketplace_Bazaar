import { ref } from 'vue'
import { platformFetch } from '../useSupabase'
import type { Lang } from './types'
import { BASE_URL } from '../../config/runtime'

/*
 * Shared auto-localize cache.
 *
 * Keyed by `${target}:${truncated text}`, reactive so any component
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

export const autoLocalizeCache = ref<Record<string, string>>({})
const autoLocalizeOrder: string[] = []
const inflightAutoTranslate = new Set<string>()

export function autoKey(text: string, target: Lang): string {
  return `${target}:${text.length}:${text.slice(0, 200)}`
}

function rememberAutoLocalize(key: string, value: string): void {
  if (!(key in autoLocalizeCache.value)) {
    autoLocalizeOrder.push(key)
    if (autoLocalizeOrder.length > AUTO_LOCALIZE_CACHE_MAX) {
      const evicted = autoLocalizeOrder.shift()
      if (evicted) {
        const { [evicted]: _, ...rest } = autoLocalizeCache.value
        autoLocalizeCache.value = { ...rest, [key]: value }
        return
      }
    }
  }
  autoLocalizeCache.value = { ...autoLocalizeCache.value, [key]: value }
}

export function scheduleAutoTranslate(text: string, target: Lang) {
  if (!text || !text.trim()) return
  const key = autoKey(text, target)
  if (autoLocalizeCache.value[key]) return
  if (inflightAutoTranslate.has(key)) return
  // Only two targets supported by the translation endpoint today.
  if (target !== 'zh' && target !== 'en') return
  inflightAutoTranslate.add(key)

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

  platformFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, target }),
    signal: ctrl.signal,
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      const translated = typeof json?.translated === 'string' ? json.translated.trim() : ''
      /*
       * Always cache something so a subsequent render doesn't schedule
       * another fetch. If the endpoint returned an empty / identical
       * string (API misconfigured, no key, CORS failure, …), we cache
       * the original text itself as a "tried and gave up" marker. The
       * template then reads original from the cache on next render and
       * localize()'s `if (cached) return cached` short-circuit stops
       * the scheduler from firing again — without this, every render
       * on every card triggers another round-trip.
       */
      if (translated && translated !== text) {
        rememberAutoLocalize(key, translated)
      } else {
        rememberAutoLocalize(key, text)
      }
    })
    .catch(() => {
      // Same idea as above: cache the original so subsequent renders
      // don't refire the fetch in a tight loop.
      rememberAutoLocalize(key, text)
    })
    .finally(() => {
      clearTimeout(timer)
      inflightAutoTranslate.delete(key)
    })
}
