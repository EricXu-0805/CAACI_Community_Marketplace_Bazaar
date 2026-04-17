import { ref, computed } from 'vue'
import { useSupabase } from './useSupabase'
import { useModeration } from './useModeration'
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

    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      await fetchProfile(session.user.id)
    }

    const { loadBlockedIds, clearBlocked } = useModeration()

    const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        await fetchProfile(session.user.id)
        loadBlockedIds()
      } else {
        currentUser.value = null
        clearBlocked()
      }
    })
    authSubscription = data.subscription
  }

  async function fetchProfile(userId: string) {
    const { data, error } = await supabase.rpc('get_my_profile')

    if (data && !error) {
      currentUser.value = data as Profile
    } else {
      const { data: fallback } = await supabase
        .from('profiles')
        .select('id, nickname, avatar_url, bio, location, is_illini_verified, created_at')
        .eq('id', userId)
        .single()
      if (fallback) currentUser.value = fallback as Profile
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
    await supabase.auth.signOut()
    supabase.removeAllChannels()
    currentUser.value = null
    clearBlocked()
    uni.reLaunch({ url: '/pages/index/index' })
  }

  async function updateProfile(updates: AllowedProfileUpdate) {
    if (!currentUser.value) return

    const sanitized = Object.fromEntries(
      Object.entries(updates).filter(([k]) =>
        (ALLOWED_PROFILE_FIELDS as readonly string[]).includes(k)
      )
    )

    const { error } = await supabase
      .from('profiles')
      .update(sanitized)
      .eq('id', currentUser.value.id)

    if (!error) {
      const { data: fresh } = await supabase.rpc('get_my_profile')
      if (fresh) currentUser.value = fresh as Profile
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
