/**
 * Runtime config — single source of truth for environment URLs.
 *
 * BASE_URL is the origin every mp-weixin code path falls back to when
 * `window.location` isn't available. H5 code reads `window.location.origin`
 * directly and never imports this constant — that path keeps preview /
 * staging / localhost auto-adapting. It flows into share-link generation,
 * password-reset redirect URLs, and direct calls to our Vercel edge API
 * routes (/api/translate, /api/moderate, /api/admin, /api/auth/wechat-login,
 * /api/realtime-poll) inside mp-weixin builds.
 *
 * Resolved from `VITE_BASE_URL` at Vite build time — `import.meta.env.VITE_*`
 * references are string-replaced into the bundle before the code reaches
 * any runtime, so this works on every build target the same way
 * `VITE_SUPABASE_URL` does (see app/src/composables/useSupabase.ts).
 *
 * The hardcoded fallback is the prod domain (illinimarket.com): a missing
 * env var never breaks the app — local dev, CI, fresh contributor checkouts
 * all default to prod-equivalent behavior. Override per environment via
 * the Vercel dashboard, or locally via `app/.env.local`.
 *
 * Prod sets `VITE_BASE_URL=https://illinimarket.com` in the Vercel env
 * (Production + Preview); the old `*.vercel.app` host still resolves during
 * the transition. The fallback below is the canonical domain.
 */
export const BASE_URL =
  (import.meta.env.VITE_BASE_URL as string | undefined)
  || 'https://illinimarket.com'

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
  (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) || 'illini.market.help@gmail.com'
