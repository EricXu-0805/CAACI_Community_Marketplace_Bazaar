/*
 * App-wide supported locales.
 *
 * Kept as a union of BCP-47-ish codes so we can drop new ones in without
 * rewriting downstream types. If you add a locale here you MUST also:
 *   1. add a matching key block to messages (even partial is OK —
 *      t() falls back to the default locale and then to the key itself)
 *   2. add a label entry to SUPPORTED_LANGS
 *   3. update the DB check constraint in migration 015 (source_lang list)
 *
 * 'zh' and 'en' are the only fully-populated locales today; stubs for
 * ja/ko/zh-Hant are intentionally not shipped yet — we hold that until
 * the user-facing plan expands.
 */
export type Lang = 'zh' | 'en' | 'ja' | 'ko' | 'zh-Hant'

export const SUPPORTED_LANGS: Array<{ code: Lang; label: string }> = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
]

export const DEFAULT_LANG: Lang = 'zh'

export function coerceLang(v: unknown): Lang | null {
  return SUPPORTED_LANGS.some((l) => l.code === v) ? (v as Lang) : null
}
