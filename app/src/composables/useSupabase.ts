// #ifdef MP-WEIXIN || MP-QQ || MP-BAIDU || MP-ALIPAY || MP-TOUTIAO
import { installUrlShim } from '../utils/urlShim'
installUrlShim()
// #endif

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { makeMpFetch } from '../utils/mpFetch'
import {
  createFailClosedAuthStorage,
  executeFailClosedAuthSignOut,
  type FailClosedSignOutResult,
} from '../api/authPersistence'
import { withTransportDeadlines } from '../api/transportBoundary'
import {
  preferredSupabasePublicKey,
  withSupabaseApiKeySemantics,
} from '../utils/supabaseKeys'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_PUBLIC_KEY = preferredSupabasePublicKey(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
  console.warn('Missing VITE_SUPABASE_URL or a Supabase publishable/anon key in .env')
}

let supabase: SupabaseClient | null = null

function authStorageKeyForUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname
    const namespace = hostname.split('.')[0]
    if (namespace) return `sb-${namespace}-auth-token`
  } catch {
  }
  // createClient will independently reject an invalid/missing Supabase URL;
  // this fallback only keeps module initialization deterministic.
  return 'sb-invalid-project-auth-token'
}

const AUTH_STORAGE_KEY = authStorageKeyForUrl(SUPABASE_URL)
const authStorage = createFailClosedAuthStorage({
  getItem(key: string) {
    // Let the controller distinguish an absent marker from an unreadable
    // storage engine. An unreadable logout marker must fail closed.
    const value = uni.getStorageSync(key)
    return typeof value === 'string' && value ? value : null
  },
  setItem(key: string, value: string) {
    uni.setStorageSync(key, value)
  },
  removeItem(key: string) {
    uni.removeStorageSync(key)
  },
}, AUTH_STORAGE_KEY)

let authSignOutTask: Promise<FailClosedSignOutResult> | null = null

/*
 * `platformFetch` — the app-wide adaptive fetch.
 *
 * Exported so every module that needs to call our Vercel edge routes
 * (/api/translate, /api/moderate, /api/realtime-poll, /api/admin, etc.)
 * can go through the SAME code path Supabase does. On mp-weixin /
 * mp-qq / mp-baidu / mp-alipay / mp-toutiao this routes through
 * uni.request via `mpFetch`; on H5 it's native fetch. Both then receive
 * deterministic header + response-body deadlines. Structured JSON/text uses
 * a short window while media uploads/downloads keep a longer bounded window.
 *
 * Rule of thumb inside this repo: **never call globalThis.fetch
 * directly**. Import `platformFetch` from here instead — otherwise
 * your call site WILL crash on mp because `fetch` is undefined in
 * the WeChat runtime.
 */
let rawPlatformFetch: typeof fetch
// #ifdef MP-WEIXIN || MP-QQ || MP-BAIDU || MP-ALIPAY || MP-TOUTIAO
rawPlatformFetch = makeMpFetch()
// #endif
// #ifndef MP-WEIXIN || MP-QQ || MP-BAIDU || MP-ALIPAY || MP-TOUTIAO
rawPlatformFetch = globalThis.fetch.bind(globalThis)
// #endif

const platformFetch = withSupabaseApiKeySemantics(withTransportDeadlines(rawPlatformFetch))

export { platformFetch }

/**
 * Create a one-operation auth client whose session never touches the shared
 * app auth storage or a browser BroadcastChannel. Recovery password updates
 * use this client so they stay bound to the OTP-returned tokens even if a
 * different tab signs another account into the normal persisted client.
 *
 * Always create a fresh instance for each operation; do not cache or expose
 * it as the application's ambient auth client.
 */
export function createEphemeralSupabaseClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
    global: {
      fetch: platformFetch,
    },
  })
}

/**
 * Re-enable persistence only at an explicit new-session boundary.  Logout
 * keeps the storage adapter blocked, so an auth refresh already in flight
 * cannot write the old account back after local cleanup.
 */
export async function prepareSupabaseAuthPersistence(): Promise<void> {
  while (authSignOutTask) await authSignOutTask
  // A fresh process starts without an adopted generation, so inspect the
  // durable boundary first. Every explicit session-producing action then
  // rotates through a blocked generation and purges the previous generation's
  // Auth values before publishing/adopting a new allowed generation. Dormant
  // tabs remain bound to their old generation and cannot write into the new
  // one even after they wake later.
  await authStorage.syncPersistedBlock()
  await authStorage.blockWrites()
  // A prior storage-engine failure must be healed before the new generation is
  // allowed. purge() retries exact-key remove -> empty overwrite. The app
  // deliberately does not wire the controller's generic full-storage fallback:
  // no synchronous check can make a broad clear atomic with a different tab's
  // privileged admin journal write. If exact Auth-key cleanup cannot be
  // verified, persistence stays blocked for explicit recovery.
  await authStorage.purge()
  await authStorage.allowWrites()
  const client = useSupabase().supabase
  let interruptedBySignOut = false
  try {
    await client.auth.startAutoRefresh()
  } finally {
    // If a sign-out began while startAutoRefresh was resolving, do not let the
    // old refresher survive the newly-established write block.
    if (authStorage.isWriteBlocked()) {
      interruptedBySignOut = true
      try { await client.auth.stopAutoRefresh() } catch {}
    }
  }
  if (interruptedBySignOut) {
    // The later sign-out wins. Do not let the caller create a session that is
    // usable only in memory but intentionally forbidden from persistence.
    throw new Error('auth_session_boundary_superseded_by_signout')
  }
}

/**
 * Local-first logout.  The returned diagnostics never contain the token and
 * let useAuth report a failed best-effort server revoke without weakening the
 * authoritative local privacy boundary.
 */
export function failClosedSupabaseSignOut(): Promise<FailClosedSignOutResult> {
  if (authSignOutTask) return authSignOutTask
  const client = useSupabase().supabase
  const execution = executeFailClosedAuthSignOut(client.auth, authStorage)
  const trackedTask = execution.finally(() => {
    if (authSignOutTask === trackedTask) authSignOutTask = null
  })
  authSignOutTask = trackedTask
  return trackedTask
}

export function useSupabase() {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: AUTH_STORAGE_KEY,
        storage: authStorage.storage,
      },
      global: {
        fetch: platformFetch,
      },
    })
  }

  return { supabase }
}
