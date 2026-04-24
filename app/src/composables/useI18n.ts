import { ref, computed } from 'vue'
import type { Lang } from './i18n/types'
import { DEFAULT_LANG, SUPPORTED_LANGS, coerceLang } from './i18n/types'
import { detectSystemLang } from './i18n/detect'
import { messages } from './i18n/messages'
import { autoKey, autoLocalizeCache, scheduleAutoTranslate } from './i18n/translate'
import { detectsAsForeign, interpolate } from './i18n/format'

export type { Lang } from './i18n/types'
export { SUPPORTED_LANGS, DEFAULT_LANG } from './i18n/types'

const currentLang = ref<Lang>(DEFAULT_LANG)

try {
  const saved = coerceLang(uni.getStorageSync('lang'))
  if (saved) {
    currentLang.value = saved
  } else {
    currentLang.value = detectSystemLang()
  }
} catch {}

export function useI18n() {
  function t(key: string, params?: Record<string, string | number>): string {
    const primary = messages[currentLang.value]?.[key]
    const fallback = messages[DEFAULT_LANG]?.[key]
    const raw = primary ?? fallback ?? key
    return interpolate(raw, params)
  }

  function setLang(next: Lang) {
    if (!SUPPORTED_LANGS.some((l) => l.code === next)) return
    currentLang.value = next
    try { uni.setStorageSync('lang', next) } catch {}
  }

  function toggleLang() {
    setLang(currentLang.value === 'zh' ? 'en' : 'zh')
  }

  /*
   * Pick the best localized string out of a jsonb map like
   *   { zh: '小米手机', en: 'Xiaomi phone' }
   *
   * Fallback chain: current UI lang → default lang → first available
   * value in the map → the `original` argument → empty string. This is
   * the canonical read helper every page should use to show
   * item.title / item.description / post.content so that an empty i18n
   * map or a missing language never ends up rendering as blank text.
   */
  function localize(
    map: Record<string, string> | null | undefined,
    original?: string | null,
  ): string {
    if (map) {
      const hit = map[currentLang.value]
      if (hit && hit.trim()) return hit
      const fb = map[DEFAULT_LANG]
      if (fb && fb.trim()) return fb
      const anyVal = Object.values(map).find((v) => typeof v === 'string' && v.trim())
      if (anyVal) return anyVal
    }
    const text = original || ''
    if (!text) return ''
    /*
     * Auto-translate escape hatch: when the DB row has no i18n map (yet
     * — async publish translation still in flight, or a legacy pre-015
     * row), check the session cache. If a background fetch has
     * completed, render its result; otherwise schedule the fetch and
     * show the original in the meantime. Because `autoLocalizeCache`
     * is a ref, the template re-renders the instant the fetch lands.
     */
    const cached = autoLocalizeCache.value[autoKey(text, currentLang.value)]
    if (cached) return cached
    if (currentLang.value !== DEFAULT_LANG || detectsAsForeign(text, currentLang.value)) {
      scheduleAutoTranslate(text, currentLang.value)
    }
    return text
  }

  /*
   * Reactive auto-translating localizer, for rows that don't yet have
   * a title_i18n / content_i18n map (legacy rows published before the
   * 015 migration, or brand-new rows whose async translation hasn't
   * upserted back yet).
   *
   * Given an `original` string, returns a computed that:
   *   1. Tries localize(map, original) first (instant if pre-translated)
   *   2. If that returns `original` AND the current UI lang is not the
   *      detected source lang, kicks off a background fetch to the
   *      translator and updates reactively once resolved
   *   3. Caches per-text in module scope so repeated renders across
   *      many cards only hit the endpoint once
   *
   * While translating, the caller still sees the original (no blank
   * flash). On failure silently continues to show original — that's
   * the "author's original language" fallback, same as localize().
   */
  function useAutoLocalize(
    mapGetter: () => Record<string, string> | null | undefined,
    originalGetter: () => string | null | undefined,
  ) {
    const pendingFetch = ref(false)
    const result = computed(() => {
      const map = mapGetter()
      const original = originalGetter() || ''
      const target = currentLang.value
      if (map) {
        const hit = map[target]
        if (hit && hit.trim()) return hit
      }
      if (!original) return ''
      const cached = autoLocalizeCache.value[autoKey(original, target)]
      if (cached) return cached
      scheduleAutoTranslate(original, target)
      return original
    })
    return { result, pendingFetch }
  }

  const lang = computed(() => currentLang.value)

  return { t, lang, setLang, toggleLang, localize, useAutoLocalize }
}
