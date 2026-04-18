import { ref, computed } from 'vue'
import { useSupabase } from './useSupabase'
import { useModeration } from './useModeration'
import { useFollow } from './useFollow'
import { useSavedSearch } from './useSavedSearch'
import { useFavorites } from './useFavorites'
import type { Profile } from '../types'

const currentUser = ref<Profile | null>(null)
const isLoggedIn = computed(() => !!currentUser.value)
const loading = ref(false)

let authSubscription: { unsubscribe: () => void } | null = null

const ALLOWED_PROFILE_FIELDS = ['nickname', 'avatar_url', 'bio', 'location'] as const
type AllowedProfileUpdate = Partial<Pick<Profile, typeof ALLOWED_PROFILE_FIELDS[number]>>

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
        } else {
          currentUser.value = null
          clearBlocked()
        }
      })
      authSubscription = data.subscription
    } catch (err) {
      console.warn('onAuthStateChange failed:', err)
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

      const emailRedirectTo = typeof window !== 'undefined'
        ? `${window.location.origin}/#/pages/index/index`
        : undefined
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

  async function signOut() {
    const { clearBlocked } = useModeration()
    const { reset: resetFollow } = useFollow()
    const { reset: resetSaved } = useSavedSearch()
    const { reset: resetFavs } = useFavorites()
    await supabase.auth.signOut()
    supabase.removeAllChannels()
    currentUser.value = null
    clearBlocked()
    resetFollow()
    resetSaved()
    resetFavs()
    uni.reLaunch({ url: '/pages/index/index' })
  }

  async function updateProfile(updates: AllowedProfileUpdate) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      return { error: new Error('Not authenticated') }
    }

    const sanitized = Object.fromEntries(
      Object.entries(updates).filter(([k]) =>
        (ALLOWED_PROFILE_FIELDS as readonly string[]).includes(k)
      )
    )

    const { error } = await supabase
      .from('profiles')
      .update(sanitized)
      .eq('id', session.user.id)

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
    signOut,
    updateProfile,
    requireAuth,
  }
}
