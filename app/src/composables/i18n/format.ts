import type { Lang } from './types'

/*
 * Heuristic to decide whether to bother firing a translation for
 * text that's nominally in the current UI lang. If the user viewing
 * in Chinese sees a piece of text full of ASCII words, it was likely
 * authored in English and is worth translating. Same the other way
 * round for CJK. Stops us from firing a pointless en→en fetch.
 */
export function detectsAsForeign(text: string, uiLang: Lang): boolean {
  const hasCjk = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text)
  const hasLatin = /[A-Za-z]{3,}/.test(text)
  if (uiLang === 'zh' && !hasCjk && hasLatin) return true
  if (uiLang === 'en' && hasCjk && !hasLatin) return true
  return false
}

/*
 * Apply {key} placeholder interpolation. Pulled out so t() in useI18n
 * has one fewer responsibility and we can unit-test it independently.
 * Missing keys render as empty strings (same as the old inline impl).
 */
export function interpolate(
  raw: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (_, k) => {
    const v = params[k]
    return v === undefined || v === null ? '' : String(v)
  })
}
