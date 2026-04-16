import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

let supabase: SupabaseClient | null = null

export function useSupabase() {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // uni-app storage adapter
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
    })
  }

  return { supabase }
}
