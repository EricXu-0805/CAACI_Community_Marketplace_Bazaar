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
 * Which language the author actually wrote in.
 *
 * The UI toggle is not the answer, and taking it as the answer is how a
 * Chinese listing ended up stored as English on production 2026-08-31:
 * title_i18n was {"en": "宠物航空箱 XL"} with no zh entry at all.
 *
 * The label decides what gets translated. translateContentToAll targets every
 * language except the source, so calling that listing English asked for a
 * Chinese rendering of text that was already Chinese; the same string came
 * back, and nothing was stored. English — the one rendering that listing
 * actually needed — was never requested.
 *
 * Deferring to `detectsAsForeign` was not enough. That predicate answers a
 * narrower question — is a fetch worth firing? — and for an English UI it
 * demands CJK with no Latin run at all, so one brand name kept the wrong
 * label: 'AirPods Pro 2 全新未拆封' and '求购二手自行车，ISR 附近交易' were both
 * still filed 'en' after that fix shipped. Titles shaped like those are the
 * norm on this site, not the exception.
 *
 * So decide on script presence, and let CJK win outright: a title carrying any
 * Chinese was typed by someone writing Chinese, whatever Latin the product
 * name drags in with it. Text with neither script — a bare price, an empty
 * description — carries no signal and keeps the UI language.
 */
export function authoredLang(text: string, uiLang: Lang): Lang {
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(text)) return 'zh'
  if (/[A-Za-z]/.test(text)) return 'en'
  return uiLang
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
