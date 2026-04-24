import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { makeMpFetch } from '../utils/mpFetch'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

let supabase: SupabaseClient | null = null

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const timeoutMs = 25000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(input, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer))
}

/*
 * `platformFetch` — the app-wide adaptive fetch.
 *
 * Exported so every module that needs to call our Vercel edge routes
 * (/api/translate, /api/moderate, /api/realtime-poll, /api/admin, etc.)
 * can go through the SAME code path Supabase does. On mp-weixin /
 * mp-qq / mp-baidu / mp-alipay / mp-toutiao this routes through
 * uni.request via `mpFetch`; on H5 it's the native fetch wrapped in
 * a 25 s AbortController.
 *
 * Rule of thumb inside this repo: **never call globalThis.fetch
 * directly**. Import `platformFetch` from here instead — otherwise
 * your call site WILL crash on mp because `fetch` is undefined in
 * the WeChat runtime.
 */
let platformFetch: typeof fetch
// #ifdef MP-WEIXIN || MP-QQ || MP-BAIDU || MP-ALIPAY || MP-TOUTIAO
platformFetch = makeMpFetch()
// #endif
// #ifndef MP-WEIXIN || MP-QQ || MP-BAIDU || MP-ALIPAY || MP-TOUTIAO
platformFetch = fetchWithTimeout as typeof fetch
// #endif

export { platformFetch }

export function useSupabase() {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storage: {
          getItem: (key: string) => {
            try {
              return uni.getStorageSync(key) || null
            } catch {
              return null
            }
          },
          setItem: (key: string, value: string) => {
            try {
              uni.setStorageSync(key, value)
            } catch {}
          },
          removeItem: (key: string) => {
            try {
              uni.removeStorageSync(key)
            } catch {}
          },
        },
      },
      global: {
        fetch: platformFetch,
      },
    })
  }

  return { supabase }
}
