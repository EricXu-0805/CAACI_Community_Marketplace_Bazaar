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
    /*
     * uni.getSystemInfoSync is deprecated since WeChat base library
     * 2.20.1 — the runtime nags on every call. Replacement is the
     * trio getDeviceInfo / getWindowInfo / getAppBaseInfo, with
     * locale living on getAppBaseInfo. Try the new one first; fall
     * back to the deprecated call so we still work on older platforms
     * (mp-baidu/mp-alipay/mp-toutiao haven't all caught up).
     */
    const getAppBaseInfo = (uni as any).getAppBaseInfo
    if (typeof getAppBaseInfo === 'function') {
      const info = getAppBaseInfo()
      raw = (info?.language || info?.host?.language || '') as string
    }
    if (!raw) {
      const info = uni.getSystemInfoSync()
      raw = (info as { language?: string }).language || ''
    }
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
