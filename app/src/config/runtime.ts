/**
 * Runtime config — single source of truth for environment URLs.
 *
 * BASE_URL is the explicit app origin used by non-H5 builds where
 * `window.location` is unavailable. H5 code reads `window.location.origin`
 * directly, so preview / staging / localhost stay same-origin. It flows into
 * share-link generation,
 * password-reset redirect URLs, and direct calls to our Vercel edge API
 * routes (/api/translate, /api/moderate, /api/admin, /api/auth/wechat-login,
 * /api/realtime-poll) inside mp-weixin builds.
 *
 * Resolved from `VITE_BASE_URL` at Vite build time — `import.meta.env.VITE_*`
 * references are string-replaced into the bundle before the code reaches
 * any runtime, so this works on every build target the same way
 * `VITE_SUPABASE_URL` does (see app/src/composables/useSupabase.ts).
 *
 * Missing or malformed configuration deliberately resolves to the empty
 * string. That makes non-H5 requests fail locally instead of silently calling
 * production from a preview, CI artifact, contributor checkout, or test mini
 * program. Production and every non-H5 preview/staging build must set its own
 * HTTPS origin explicitly. Loopback HTTP remains available for local emulators.
 */
export function normalizeBaseUrl(raw: unknown): string {
  // Do not depend on the browser URL constructor here. This module is loaded
  // while mp-weixin boots, before its Web API compatibility shim is guaranteed
  // to be installed. The narrow grammar accepts an origin only, never a path,
  // query, fragment or credentials.
  const value = String(raw || '').trim()
  const match = /^(https?):\/\/(localhost|127\.0\.0\.1|\[::1\]|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?::([0-9]{1,5}))?\/?$/i.exec(value)
  if (!match) return ''

  const protocol = match[1].toLowerCase()
  const hostname = match[2].toLowerCase()
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
  if (protocol !== 'https' && !(protocol === 'http' && loopback)) return ''

  const port = match[3] || ''
  if (port && (Number(port) < 1 || Number(port) > 65535)) return ''
  const defaultPort = (protocol === 'https' && port === '443')
    || (protocol === 'http' && port === '80')
  return `${protocol}://${hostname}${port && !defaultPort ? `:${Number(port)}` : ''}`
}

export const BASE_URL = normalizeBaseUrl(import.meta.env.VITE_BASE_URL)

/**
 * Displayed app version — single source of truth for the settings page.
 * Human-readable semver (bump on release); the build ref (git SHA or
 * 'dev', from VITE_RELEASE — see vite.config.ts) is appended at runtime
 * so a screenshot ties to an exact deploy.
 */
export const APP_VERSION = '0.1.0'
export const BUILD_REF = (import.meta.env.VITE_RELEASE as string | undefined) || 'dev'

/** Public support contact — shown on the legal page (mailto + copy). */
export const SUPPORT_EMAIL =
  (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) || 'help@illinimarket.com'
