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
 * The hardcoded fallback is the current prod Vercel deploy: a missing env
 * var never breaks the app — local dev, CI, fresh contributor checkouts
 * all default to prod-equivalent behavior. Override per environment via
 * the Vercel dashboard, or locally via `app/.env.local`.
 *
 * Future caaciorg.com switch: set `VITE_BASE_URL` in Vercel env (Production
 * + Preview), update `app/.env.example` for parity, and optionally update
 * the fallback below once the migration is permanent.
 */
export const BASE_URL =
  (import.meta.env.VITE_BASE_URL as string | undefined)
  || 'https://caaci-community-marketplace-bazaar.vercel.app'
