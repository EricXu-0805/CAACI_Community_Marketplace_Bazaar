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

// #ifdef MP-WEIXIN || MP-QQ || MP-BAIDU || MP-ALIPAY || MP-TOUTIAO
const platformFetch = makeMpFetch()
// #endif
// #ifndef MP-WEIXIN || MP-QQ || MP-BAIDU || MP-ALIPAY || MP-TOUTIAO
const platformFetch = fetchWithTimeout as typeof fetch
// #endif

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
