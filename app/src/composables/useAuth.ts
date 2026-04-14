import { ref, computed } from 'vue'
import { useSupabase } from './useSupabase'
import type { Profile } from '../types'

const currentUser = ref<Profile | null>(null)
const isLoggedIn = computed(() => !!currentUser.value)
const loading = ref(false)

export function useAuth() {
  const { supabase } = useSupabase()

  // Initialize auth state
  async function init() {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      await fetchProfile(session.user.id)
    }

    // Listen for auth changes
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        await fetchProfile(session.user.id)
      } else {
        currentUser.value = null
      }
    })
  }

  // Fetch user profile
  async function fetchProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (data && !error) {
      currentUser.value = data as Profile
    }
  }

  // Email/password signup
  async function signUp(email: string, password: string, nickname: string) {
    loading.value = true
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { nickname },
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

  // Email/password login
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

  // Logout
  async function signOut() {
    await supabase.auth.signOut()
    currentUser.value = null
    uni.reLaunch({ url: '/pages/index/index' })
  }

  // Update profile
  async function updateProfile(updates: Partial<Profile>) {
    if (!currentUser.value) return
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', currentUser.value.id)
      .select()
      .single()

    if (data && !error) {
      currentUser.value = data as Profile
    }
    return { data, error }
  }

  // Check if logged in, redirect to login if not
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
