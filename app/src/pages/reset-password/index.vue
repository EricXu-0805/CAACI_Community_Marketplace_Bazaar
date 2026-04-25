<template>
  <view class="page">
    <view class="header">
      <view class="logo-mark"><view class="logo-letter">I</view></view>
      <text class="app-name">{{ t('resetPw.title') }}</text>
      <text class="app-desc">{{ t('resetPw.hint') }}</text>
    </view>

    <view v-if="!ready" class="loading">
      <view class="spinner"></view>
      <text>{{ t('resetPw.verifying') }}</text>
    </view>

    <view v-else-if="ready && !errorMsg" class="form">
      <view class="form-group">
        <text class="form-label">{{ t('resetPw.newPassword') }}</text>
        <input v-model="newPassword" :placeholder="t('resetPw.newPassword')" password class="form-input" />
      </view>
      <view class="form-group">
        <text class="form-label">{{ t('resetPw.confirm') }}</text>
        <input v-model="confirmPw" :placeholder="t('resetPw.confirm')" password class="form-input" />
      </view>

      <button class="submit-btn" :disabled="saving" @click="onSave">
        {{ saving ? t('login.wait') : t('resetPw.save') }}
      </button>
    </view>

    <view v-else class="error">
      <text class="error-text">{{ errorMsg }}</text>
      <view class="back-btn" @click="goLogin">{{ t('resetPw.backLogin') }}</view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSupabase } from '../../composables/useSupabase'
import { useI18n } from '../../composables/useI18n'

const { t } = useI18n()
const { supabase } = useSupabase()

const ready = ref(false)
const errorMsg = ref('')
const newPassword = ref('')
const confirmPw = ref('')
const saving = ref(false)

onMounted(async () => {
  console.log('[reset-pw-debug] reset-password page mounted')
  try {
    // #ifdef H5
    /*
     * Two recovery shapes to consume, mirroring what App.vue detected:
     *
     *   PKCE  — ?code=<uuid> in window.location.search
     *           exchange via supabase.auth.exchangeCodeForSession(code)
     *   IMPL  — #access_token=&refresh_token=&type=recovery in hash
     *           exchange via supabase.auth.setSession({...})
     *
     * App.vue stashes the original search + hash on window because its
     * reLaunch rewrites both. We read the stash first, fall back to
     * whatever is still on window.location, then clean up so back/
     * forward can't replay the tokens.
     *
     * detectSessionInUrl=true on the supabase client may have ALREADY
     * consumed the recovery params before we get here (see Type-A in
     * the quick-getSession check below). That's fine — getSession()
     * will return the recovery session and we'll skip the manual
     * exchange.
     */
    const stashedSearch: string =
      typeof window !== 'undefined' ? ((window as any).__authRecoverySearch || '') : ''
    const stashedHash: string =
      typeof window !== 'undefined' ? ((window as any).__authRecoveryHash || '') : ''

    let search = typeof window !== 'undefined' ? (window.location.search || '') : ''
    let hash = typeof window !== 'undefined' ? (window.location.hash || '') : ''
    if (stashedSearch && !/[?&]code=/.test(search)) search = stashedSearch
    if (stashedHash && !hash.includes('access_token=') && !hash.includes('error=')) hash = stashedHash
    console.log('[reset-pw-debug] stashed?', { stashedSearch: !!stashedSearch, stashedHash: !!stashedHash })

    try {
      delete (window as any).__authRecoverySearch
      delete (window as any).__authRecoveryHash
    } catch {}

    if (hash.includes('error=')) {
      const params = new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
      const desc = params.get('error_description') || params.get('error')
      console.warn('[reset-pw-debug] link error param:', desc)
      errorMsg.value = desc || t('resetPw.linkInvalid')
      ready.value = true
      return
    }

    /*
     * Fast-path: maybe detectSessionInUrl already turned the recovery
     * params into a live session. Check first to avoid double-exchange
     * (which produces "code already used" errors on PKCE).
     */
    const earlyCheck = await supabase.auth.getSession()
    if (earlyCheck.data.session) {
      console.log('[reset-pw-debug] session already established (detectSessionInUrl)')
    } else {
      const codeMatch = search.match(/[?&]code=([^&]+)/)
      if (codeMatch && codeMatch[1]) {
        console.log('[reset-pw-debug] exchanging PKCE code')
        try {
          await supabase.auth.exchangeCodeForSession(decodeURIComponent(codeMatch[1]))
        } catch (err: any) {
          console.warn('[reset-pw-debug] exchangeCodeForSession failed:', err)
          errorMsg.value = err?.message || t('resetPw.linkInvalid')
          ready.value = true
          return
        }
      } else if (hash.includes('access_token=')) {
        console.log('[reset-pw-debug] consuming implicit-flow tokens from hash')
        const qIdx = hash.indexOf('?')
        const raw = qIdx >= 0 ? hash.slice(qIdx + 1) : hash.replace(/^#/, '')
        const params = new URLSearchParams(raw)
        const access_token = params.get('access_token') || ''
        const refresh_token = params.get('refresh_token') || ''
        if (access_token && refresh_token) {
          try {
            await supabase.auth.setSession({ access_token, refresh_token })
          } catch (err: any) {
            console.warn('[reset-pw-debug] setSession failed:', err)
            errorMsg.value = err?.message || t('resetPw.linkInvalid')
            ready.value = true
            return
          }
        }
      } else {
        console.warn('[reset-pw-debug] no recovery params found anywhere')
      }
    }

    try {
      const clean = window.location.pathname + '#/pages/reset-password/index'
      window.history.replaceState(null, '', clean)
    } catch {}
    // #endif

    await new Promise((r) => setTimeout(r, 150))

    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session) {
      console.warn('[reset-pw-debug] no session after exchange:', error)
      errorMsg.value = t('resetPw.linkInvalid')
    } else {
      console.log('[reset-pw-debug] session ready, user:', data.session.user.id)
    }
    ready.value = true
  } catch (err: any) {
    console.warn('[reset-pw-debug] outer catch:', err)
    errorMsg.value = err?.message || t('resetPw.linkInvalid')
    ready.value = true
  }
})

async function onSave() {
  if (newPassword.value.length < 8) {
    uni.showToast({ title: t('login.needPassword'), icon: 'none' })
    return
  }
  if (newPassword.value !== confirmPw.value) {
    uni.showToast({ title: t('resetPw.mismatch'), icon: 'none' })
    return
  }
  saving.value = true
  try {
    console.log('[reset-pw-debug] calling updateUser')
    const { error } = await supabase.auth.updateUser({ password: newPassword.value })
    if (error) throw error
    console.log('[reset-pw-debug] password updated, signing out and redirecting to login')
    /*
     * Sign out the recovery session before redirecting. Two reasons:
     *   1. The session created from the recovery token is short-lived
     *      and tied to the recovery flow — leaving it active can lead
     *      to "I changed my password but I'm still logged in with the
     *      old one" confusion (the OLD session token, not the new
     *      password, is what's authenticating subsequent calls).
     *   2. Redirecting to login forces the user to actually exercise
     *      the new password, which catches "I typed it wrong" before
     *      they discover it 5 minutes later.
     */
    try {
      await supabase.auth.signOut()
    } catch (signOutErr) {
      console.warn('[reset-pw-debug] signOut after updateUser failed (continuing):', signOutErr)
    }
    uni.showToast({ title: t('resetPw.success'), icon: 'success', duration: 2000 })
    setTimeout(() => uni.reLaunch({ url: '/pages/login/index' }), 1500)
  } catch (err: any) {
    console.warn('[reset-pw-debug] updateUser failed:', err)
    uni.showToast({ title: err?.message || t('resetPw.fail'), icon: 'none', duration: 3000 })
  } finally {
    saving.value = false
  }
}

function goLogin() {
  uni.reLaunch({ url: '/pages/login/index' })
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh; background: var(--bg-elev-1);
  padding: 0 24px; max-width: 400px; margin: 0 auto;
  display: flex; flex-direction: column;
}

.header {
  display: flex; flex-direction: column; align-items: center;
  padding: 72px 0 40px;
  padding-top: calc(72px + var(--status-bar-height, env(safe-area-inset-top, 0px)));
}
.logo-mark {
  width: 56px; height: 56px; border-radius: 14px;
  background: var(--accent-primary);
  display: flex; align-items: center; justify-content: center;
}
.logo-letter { font-size: 28px; font-weight: 800; color: #fff; letter-spacing: -1px; }
.app-name { font-size: 22px; font-weight: 700; color: var(--text-primary); margin-top: 16px; }
.app-desc { font-size: 13px; color: var(--text-faint); margin-top: 5px; text-align: center; line-height: 1.5; padding: 0 20px; }

.loading {
  display: flex; flex-direction: column; align-items: center;
  gap: 14px; padding: 60px 0;
  text { font-size: 13px; color: var(--text-muted); }
}
.spinner {
  width: 24px; height: 24px;
  border: 2.5px solid var(--bg-inset); border-top-color: var(--text-primary);
  border-radius: 50%; animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.form { flex: 1; }
.form-group { margin-bottom: 18px; }
.form-label { display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 7px; font-weight: 500; }
.form-input {
  width: 100%; height: 48px;
  background: var(--bg-elev-2); border-radius: 12px;
  padding: 0 16px; font-size: 15px; color: var(--text-primary);
  border: 1px solid transparent;
  &:focus { border-color: rgba(0,0,0,0.12); background: var(--bg-elev-1); }
}
.submit-btn {
  width: 100%; height: 48px;
  background: var(--accent-primary); color: #fff;
  border-radius: 24px; font-size: 15px; font-weight: 600;
  margin-top: 24px; border: none;
  &[disabled] { opacity: 0.35; }
  &:active { opacity: 0.8; }
}

.error {
  display: flex; flex-direction: column; align-items: center;
  padding: 40px 0; gap: 20px;
}
.error-text { font-size: 14px; color: var(--accent-danger); text-align: center; line-height: 1.5; }
.back-btn {
  padding: 12px 28px; background: var(--accent-primary); color: #fff;
  border-radius: 22px; font-size: 14px; font-weight: 600; cursor: pointer;
  &:active { opacity: 0.8; }
}
</style>
