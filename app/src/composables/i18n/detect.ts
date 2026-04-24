import type { Lang } from './types'
import { DEFAULT_LANG } from './types'

/*
 * System-locale auto-detect — runs once on first load when the user
 * has no saved 'lang' preference yet. Matches the new-user-onboarding
 * flow: a Japanese browser should open the app in English (our safer
 * international fallback) rather than Chinese; a zh-CN / zh-SG browser
 * opens in Simplified Chinese. The user can still override via
 * Settings → Language, and the override persists from then on.
 *
 * zh-Hant / Traditional Chinese falls back to English for now because
 * we don't ship a zh-Hant dictionary yet — showing Simplified Chinese
 * to a Traditional reader is worse than showing English.
 */
export function detectSystemLang(): Lang {
  let raw = ''
  try {
    // #ifdef H5
    if (typeof navigator !== 'undefined') {
      raw = (navigator.language || (navigator as unknown as { userLanguage?: string }).userLanguage || '')
    }
    // #endif
    // #ifndef H5
    const info = uni.getSystemInfoSync()
    raw = (info as { language?: string }).language || ''
    // #endif
  } catch {}

  const lower = String(raw).toLowerCase()
  if (!lower) return DEFAULT_LANG

  if (lower.startsWith('zh')) {
    if (lower.includes('hant') || lower.includes('tw') || lower.includes('hk') || lower.includes('mo')) {
      return 'en'
    }
    return 'zh'
  }

  if (lower.startsWith('en')) return 'en'

  return 'en'
}
