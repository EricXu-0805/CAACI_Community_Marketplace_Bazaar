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
        <view class="pw-wrap">
          <input v-model="newPassword" :placeholder="t('resetPw.newPassword')" :password="!showNewPw" autocomplete="new-password" class="form-input pw-input" />
          <view class="pw-toggle" role="button" :aria-label="t('a11y.passwordToggle')" @click="showNewPw = !showNewPw">
            <image :src="showNewPw ? '/static/eye-off.svg' : '/static/eye.svg'" alt="" class="pw-toggle-icon" mode="aspectFit" />
          </view>
        </view>
      </view>
      <view class="form-group">
        <text class="form-label">{{ t('resetPw.confirm') }}</text>
        <view class="pw-wrap">
          <input v-model="confirmPw" :placeholder="t('resetPw.confirm')" :password="!showConfirmPw" autocomplete="new-password" class="form-input pw-input" />
          <view class="pw-toggle" role="button" :aria-label="t('a11y.passwordToggle')" @click="showConfirmPw = !showConfirmPw">
            <image :src="showConfirmPw ? '/static/eye-off.svg' : '/static/eye.svg'" alt="" class="pw-toggle-icon" mode="aspectFit" />
          </view>
        </view>
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
import { ref, onMounted, onUnmounted } from 'vue'
import { useSupabase } from '../../composables/useSupabase'
import { useI18n } from '../../composables/useI18n'

const { t } = useI18n()
const { supabase } = useSupabase()

const ready = ref(false)
const errorMsg = ref('')
const newPassword = ref('')
const confirmPw = ref('')
const showNewPw = ref(false)
const showConfirmPw = ref(false)
const saving = ref(false)
/*
 * isRecovery is the gate that lets onSave call updateUser({password})
 * without Supabase rejecting with "Current password required when
 * setting new password.". That error comes from gotrue's
 * secure_password_change check on a non-recovery session.
 *
 * Two ways to flip this true:
 *   (a) Canonical: supabase.auth.onAuthStateChange fires
 *       'PASSWORD_RECOVERY' (subscribed below). This happens when
 *       supabase-js's internal detectSessionInUrl pipeline consumes
 *       the recovery URL and marks the session as recovery-scoped.
 *   (b) Page-arrival inference fallback: any user landing on
 *       /pages/reset-password/index got here because App.vue's
 *       detectAuthRecoveryAndRoute() routed them — there's no other
 *       entry. So once we have a session AND we're on this page,
 *       it's safe to treat it as recovery even if the event didn't
 *       fire (e.g., supabase-js consumed the URL before our listener
 *       subscribed, since onMounted runs after createClient init).
 *
 * The combination handles both the canonical case (client.detectSessionInUrl
 * worked) and the racy case (we processed the URL ourselves in
 * onMounted's manual exchange path).
 */
const isRecovery = ref(false)

let unsubscribeAuth: (() => void) | null = null

onMounted(async () => {
  console.log('[reset-pw-debug] reset-password page mounted')

  /*
   * Subscribe FIRST, before any URL processing or session inspection.
   * If supabase-js's internal detectSessionInUrl pipeline is still
   * processing the recovery URL when this listener attaches, we'll
   * catch its PASSWORD_RECOVERY event. If it already fired (race),
   * we fall through to the page-arrival inference below.
   *
   * The PASSWORD_RECOVERY event is the canonical signal that the
   * established session was authenticated via a recovery token —
   * supabase-js guarantees updateUser({password}) called against
   * this session will not be rejected by gotrue's secure-password-
   * change check.
   */
  try {
    const sub = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[reset-pw-debug] auth event:', event, 'session?', !!session)
      if (event === 'PASSWORD_RECOVERY') {
        console.log('[reset-pw-debug] PASSWORD_RECOVERY received — recovery flow confirmed')
        isRecovery.value = true
      }
    })
    unsubscribeAuth = () => {
      try { sub.data.subscription.unsubscribe() } catch {}
    }
  } catch (err) {
    console.warn('[reset-pw-debug] onAuthStateChange wire failed:', err)
  }

  try {
    // #ifdef H5
    /*
     * URL-extracted PKCE rescue. App.vue's onLaunch
     * extractAuthCodeFromUrl() runs synchronously before any supabase
     * code and stashes the PKCE code from EITHER location.search or
     * location.hash onto window.__pendingAuthCode (search-side is the
     * common case for hash-routed redirectTo — verified in r3 evidence;
     * hash-side is the fallback path predicted in r2). Consume that
     * stash here NOW — after the PASSWORD_RECOVERY listener subscribed
     * above, so the synchronous event from exchangeCodeForSession's
     * resolve isn't lost — and exchange the code for a recovery session.
     *
     * The existing search/hash manual-exchange paths below are preserved
     * as fallbacks for shapes the entry extractor doesn't catch (e.g.,
     * implicit-flow tokens in hash, or anything App.vue's older
     * detectAuthRecoveryAndRoute stashed).
     */
    const pendingCode: string | null =
      typeof window !== 'undefined' ? ((window as any).__pendingAuthCode || null) : null
    if (pendingCode) {
      try { delete (window as any).__pendingAuthCode } catch {}
      console.log('[reset-pw-debug] entry: consuming __pendingAuthCode (from URL extraction)')
      try {
        const { data, error } = await supabase.auth.exchangeCodeForSession(pendingCode)
        if (error) {
          console.warn('[reset-pw-debug] entry: exchange failed:', error)
          errorMsg.value = error.message || t('resetPw.linkInvalid')
          ready.value = true
          return
        }
        console.log('[reset-pw-debug] entry: exchange OK, session user=', data.session?.user?.id)
        /*
         * R4 fix: PKCE flow exchangeCodeForSession() in supabase-js v2
         * fires SIGNED_IN, never PASSWORD_RECOVERY. PASSWORD_RECOVERY
         * only fires from supabase-js's own implicit-flow URL parsing
         * (#access_token=...&type=recovery shape). Our hash-routed
         * site is forced to PKCE, so the listener-based path that r1
         * built will NEVER receive the canonical event no matter how
         * we tune timing — verified empirically across r1, r2, r3.
         *
         * URL evidence is sufficient here:
         *   1. App.vue's entry hook stashed __pendingAuthCode by
         *      extracting ?code= from window.location.search/hash —
         *      this code only appears in the URL when Supabase
         *      bounces a user from a recovery email link.
         *   2. exchangeCodeForSession just succeeded with that code,
         *      producing a recovery-scoped session (server-side
         *      enforced — the code itself is recovery-scoped).
         *   3. There is no legitimate non-recovery scenario that puts
         *      a Supabase PKCE code in the URL of this page.
         *
         * Therefore: set isRecovery=true and short-circuit. The
         * legacy fallback paths below (manual search/hash exchange,
         * getSession check, !isRecovery → linkInvalid) only need to
         * cover the case where there was NO pending code to begin
         * with (i.e. a logged-in user navigated here directly, no
         * recovery URL involved).
         *
         * The PASSWORD_RECOVERY event listener above is retained as
         * a no-op safety net — if Supabase changes behavior in a
         * future version, or if implicit flow is enabled somewhere,
         * the listener will set isRecovery from that signal too.
         * Until then it's a free observability source (logs the
         * event type for every auth state change).
         */
        console.log('[reset-pw-debug] URL evidence + exchange success → treating as recovery flow')
        isRecovery.value = true
        ready.value = true
        return
      } catch (err: any) {
        console.warn('[reset-pw-debug] entry: exchange threw:', err)
        errorMsg.value = err?.message || t('resetPw.linkInvalid')
        ready.value = true
        return
      }
    }
    // #endif

    // #ifdef H5
    /*
     * Two LEGACY recovery shapes to consume, mirroring what App.vue's
     * detectAuthRecoveryAndRoute stashed:
     *
     *   PKCE  — ?code=<uuid> in window.location.search
     *           exchange via supabase.auth.exchangeCodeForSession(code)
     *   IMPL  — #access_token=&refresh_token=&type=recovery in hash
     *           exchange via supabase.auth.setSession({...})
     *
     * Note: as of hotfix r2 the typical PKCE path is the
     * __pendingAuthCode block above (extracted from hash before
     * supabase init). The blocks below remain as defense for the
     * less-common shapes — code in search (clean redirectTo URLs),
     * implicit-flow tokens, or anything App.vue's older logic stashed.
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
      /*
       * The earlier page-arrival inference fallback (commit a0b8983) is
       * REMOVED. Reasoning from the user's verification of P0-3:
       *
       *   1. With redirectTo now pointing at /pages/reset-password/index
       *      directly (login + settings updated in this hotfix), the user
       *      lands on this page WITH the recovery URL still intact.
       *      supabase-js's detectSessionInUrl auto-detects, fires
       *      PASSWORD_RECOVERY, our listener (subscribed in this onMounted
       *      above) catches it, isRecovery flips true. That is the path
       *      we trust to set isRecovery — only the canonical event.
       *
       *   2. The previous fallback ('session OK + on this page → infer
       *      recovery') falsely triggered for an already-logged-in user
       *      who happened to navigate here without a recovery URL. They
       *      had a regular SIGNED_IN session from localStorage, the
       *      fallback flipped isRecovery=true, onSave called updateUser,
       *      and gotrue's secure_password_change check rejected with
       *      400 'Current password required'. The user saw a confusing
       *      error and was stuck.
       *
       * If PASSWORD_RECOVERY never fires by the time we get here (the
       * session WAS established but not as recovery), surface a clear
       * "link invalid / expired" error and the back-to-login button
       * (rendered by the .error block below). DO NOT call updateUser —
       * we know it would 400.
       */
      if (!isRecovery.value) {
        console.warn('[reset-pw-debug] session exists but PASSWORD_RECOVERY did not fire — treating as invalid recovery context')
        errorMsg.value = t('resetPw.linkInvalid')
      }
    }
    ready.value = true
  } catch (err: any) {
    console.warn('[reset-pw-debug] outer catch:', err)
    errorMsg.value = err?.message || t('resetPw.linkInvalid')
    ready.value = true
  }
})

onUnmounted(() => {
  if (unsubscribeAuth) unsubscribeAuth()
})

async function onSave() {
  if (!isRecovery.value) {
    /*
     * Hard gate. With the inference fallback removed (see onMounted
     * above), reaching this branch means either the recovery URL
     * never arrived or PASSWORD_RECOVERY never fired — calling
     * updateUser({password}) would 400 with 'Current password
     * required'. Tell the user to start over from the email link
     * and short-circuit.
     */
    console.warn('[reset-pw-debug] onSave called outside recovery flow — refusing')
    uni.showToast({
          title: t('resetPw.notRecovery'),
      icon: 'none',
      duration: 3000,
    })
    return
  }
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
    console.log('[reset-pw-debug] calling updateUser (recovery flow)')
    const { error } = await supabase.auth.updateUser({ password: newPassword.value })
    if (error) throw error
    console.log('[reset-pw-debug] password updated, redirecting to home')
    /*
     * Previously: signed out the recovery session and bounced the user
     * to /pages/login/index to make them re-authenticate with the new
     * password. That was rejected during user acceptance as redundant —
     * by this point the user has already (a) proved they own the email
     * by clicking the recovery link, and (b) typed + confirmed the new
     * password. Forcing a third "type the password again at the login
     * page" step adds friction without adding security.
     *
     * The recovery session that exchangeCodeForSession built (in
     * onMounted above) is a fully-valid PKCE session — it's NOT a
     * short-lived recovery-only token, despite the name. The old
     * session's password field has been replaced by updateUser's
     * write, so subsequent server-side calls authenticated by this
     * session are authenticated against the NEW password, not the old
     * one. Leaving it active and dropping the user on the home page is
     * both safe and the canonical Supabase recommendation for the
     * password-recovery → continue-using-app flow.
     *
     * reLaunch (vs navigateTo / switchTab):
     *   · reLaunch flushes the back-stack so Back can't bounce the
     *     user back to the reset-password page (which would error out
     *     with linkInvalid because __pendingAuthCode was already
     *     consumed).
     *   · reLaunch supports tabBar destinations like /pages/index/index,
     *     while navigateTo would reject it.
     *   · Mirrors the post-login navigation in pages/login/index.vue —
     *     both auth-success terminals land on home the same way.
     */
    uni.showToast({ title: t('resetPw.success'), icon: 'success', duration: 2000 })
    setTimeout(() => uni.reLaunch({ url: '/pages/index/index' }), 1500)
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
  &:focus { border-color: var(--line-soft); background: var(--bg-elev-1); }
}
.pw-wrap { position: relative; }
.pw-input { padding-right: 44px; }
.pw-toggle {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  cursor: pointer; padding: 4px; color: var(--text-muted);
}
.pw-toggle-icon {
  width: 18px; height: 18px; display: block;
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
