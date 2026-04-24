import { ref, computed } from 'vue'
import { useSupabase, platformFetch } from './useSupabase'
import { useModeration } from './useModeration'
import { deviceFingerprintHash, deviceUASnippet } from '../utils/fingerprint'
import type { Profile } from '../types'

const currentUser = ref<Profile | null>(null)
const isLoggedIn = computed(() => !!currentUser.value)
const loading = ref(false)

let authSubscription: { unsubscribe: () => void } | null = null

const ALLOWED_PROFILE_FIELDS = ['nickname', 'avatar_url', 'bio', 'location', 'status_text', 'status_emoji'] as const
type AllowedProfileUpdate = Partial<Pick<Profile, typeof ALLOWED_PROFILE_FIELDS[number]>>

function sanitizeStatus(raw: string, maxLen: number): string {
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen)
}

export function useAuth() {
  const { supabase } = useSupabase()

  async function init() {
    authSubscription?.unsubscribe()

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        fetchProfile(session.user.id).catch(err => console.warn('fetchProfile failed:', err))
      }
    } catch (err) {
      console.warn('getSession failed:', err)
    }

    const { loadBlockedIds, clearBlocked } = useModeration()

    try {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          fetchProfile(session.user.id).catch(err => console.warn('fetchProfile failed:', err))
          loadBlockedIds()
          recordFingerprint().catch(() => {})
        } else {
          currentUser.value = null
          clearBlocked()
        }
      })
      authSubscription = data.subscription
    } catch (err) {
      console.warn('onAuthStateChange failed:', err)
    }

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) recordFingerprint().catch(() => {})
    } catch {}
  }

  async function recordFingerprint() {
    try {
      const hash = await deviceFingerprintHash()
      const ua   = deviceUASnippet()
      if (!hash || hash.length < 8) return
      await supabase.rpc('record_fingerprint', { fp_hash_in: hash, ua_snippet_in: ua })
    } catch (err) {
      console.warn('record_fingerprint failed (non-fatal):', err)
    }
  }

  async function fetchProfile(userId: string) {
    const { data, error } = await supabase.rpc('get_my_profile')

    if (data && data.id && !error) {
      currentUser.value = data as Profile
      return
    }

    const { data: fallback, error: fbErr } = await supabase
      .from('profiles')
      .select('id, nickname, avatar_url, bio, location, is_illini_verified, created_at')
      .eq('id', userId)
      .single()

    if (fallback && fallback.id) {
      currentUser.value = fallback as Profile
    } else {
      console.warn('fetchProfile: no profile found for', userId, fbErr?.message)
      currentUser.value = null
    }
  }

  async function signUp(email: string, password: string, nickname: string) {
    loading.value = true
    try {
      if (password.length < 8) throw new Error('Password must be at least 8 characters')

      let emailRedirectTo: string | undefined
      // #ifdef H5
      if (typeof window !== 'undefined') {
        emailRedirectTo = `${window.location.origin}/#/pages/index/index`
      }
      // #endif
      // #ifndef H5
      emailRedirectTo = 'https://caaci-community-marketplace-bazaar.vercel.app/#/pages/index/index'
      // #endif
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { nickname },
          emailRedirectTo,
        },
      })
      if (error) throw error
      return { data, error: null }
    } catch (error: any) {
      return { data: null, error }
    } finally {
      loading.value = false
    }
  }

  async function signIn(email: string, password: string) {
    loading.value = true
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) throw error
      return { data, error: null }
    } catch (error: any) {
      return { data: null, error }
    } finally {
      loading.value = false
    }
  }

  async function signInWithWeChat(): Promise<{ data: any; error: any }> {
    // #ifndef MP-WEIXIN
    return { data: null, error: new Error('wechat_login_only_available_on_mp_weixin') }
    // #endif
    // #ifdef MP-WEIXIN
    loading.value = true
    try {
      const code: string = await new Promise((resolve, reject) => {
        uni.login({
          provider: 'weixin',
          success: (res: any) => res?.code ? resolve(res.code) : reject(new Error('no_code')),
          fail: (err: any) => reject(new Error(err?.errMsg || 'wx_login_failed')),
        })
      })

      const endpoint = 'https://caaci-community-marketplace-bazaar.vercel.app/api/auth/wechat-login'
      const res = await platformFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ js_code: code }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail?.error || `http_${res.status}`)
      }
      const payload = await res.json()
      if (!payload?.access_token) throw new Error('no_access_token')

      const { error } = await supabase.auth.setSession({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token || payload.access_token,
      })
      if (error) throw error
      return { data: payload, error: null }
    } catch (error: any) {
      return { data: null, error }
    } finally {
      loading.value = false
    }
    // #endif
  }

  async function signOut() {
    const { clearBlocked } = useModeration()
    await supabase.auth.signOut()
    supabase.removeAllChannels()
    currentUser.value = null
    clearBlocked()
    try {
      const followMod = await import('./useFollow')
      followMod.useFollow().reset()
      const savedMod = await import('./useSavedSearch')
      savedMod.useSavedSearch().reset()
      const favMod = await import('./useFavorites')
      favMod.useFavorites().reset()
    } catch {
    }
    uni.reLaunch({ url: '/pages/index/index' })
  }

  async function updateProfile(updates: AllowedProfileUpdate) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      return { error: new Error('Not authenticated') }
    }

    const sanitized: Record<string, any> = Object.fromEntries(
      Object.entries(updates).filter(([k]) =>
        (ALLOWED_PROFILE_FIELDS as readonly string[]).includes(k)
      )
    )
    if (typeof sanitized.status_text === 'string') {
      sanitized.status_text = sanitizeStatus(sanitized.status_text, 60)
      if (!sanitized.status_text) sanitized.status_text = null
    }
    if (typeof sanitized.status_emoji === 'string') {
      sanitized.status_emoji = sanitizeStatus(sanitized.status_emoji, 8)
      if (!sanitized.status_emoji) sanitized.status_emoji = null
    }

    let { error } = await supabase
      .from('profiles')
      .update(sanitized)
      .eq('id', session.user.id)

    if (error?.code === '42703' && /status_/.test(String(error.message || ''))) {
      console.warn('[useAuth] profiles.status_* missing — retrying without (run migration 021)')
      delete sanitized.status_text
      delete sanitized.status_emoji
      ;({ error } = await supabase
        .from('profiles')
        .update(sanitized)
        .eq('id', session.user.id))
    }

    if (!error && currentUser.value) {
      currentUser.value = { ...currentUser.value, ...sanitized } as Profile
    }
    return { error }
  }

  function requireAuth() {
    if (!isLoggedIn.value) {
      uni.navigateTo({ url: '/pages/login/index' })
      return false
    }
    return true
  }

  return {
    currentUser,
    isLoggedIn,
    loading,
    init,
    signUp,
    signIn,
    signInWithWeChat,
    signOut,
    updateProfile,
    requireAuth,
  }
}
