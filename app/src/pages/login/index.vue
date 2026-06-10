<template>
  <view class="page">
    <view class="nav-back" role="button" :aria-label="t('a11y.back')" @click="goBack">
      <view class="back-arrow"></view>
    </view>
    <view class="header">
      <view class="logo-mark">
        <view class="logo-letter">I</view>
      </view>
      <text class="app-name">{{ t('app.name') }}</text>
      <text class="app-desc">{{ t('app.desc') }}</text>
    </view>

    <view class="form">
      <!-- #ifdef MP-WEIXIN -->
      <button class="wx-btn" :disabled="loading" @click="onWeChatLogin">
        <text class="wx-icon">✦</text>
        <text>{{ loading ? t('login.wait') : t('login.wechatQuick') }}</text>
      </button>
      <view class="or-divider">
        <view class="or-line"></view>
        <text class="or-text">{{ t('login.orEmail') }}</text>
        <view class="or-line"></view>
      </view>
      <!-- #endif -->

      <view class="tab-bar">
        <view :class="['tab', { active: mode === 'login' }]" @click="mode = 'login'">
          <text>{{ t('login.signIn') }}</text>
          <view v-if="mode === 'login'" class="tab-line"></view>
        </view>
        <view :class="['tab', { active: mode === 'signup' }]" @click="mode = 'signup'">
          <text>{{ t('login.signUp') }}</text>
          <view v-if="mode === 'signup'" class="tab-line"></view>
        </view>
      </view>

      <view v-if="mode === 'signup'" class="form-group">
        <text class="form-label">{{ t('login.nickname') }}</text>
        <input
          v-model="nickname"
          :placeholder="t('login.nickname')"
          class="form-input"
          autocomplete="nickname"
          maxlength="40"
        />
      </view>

      <view class="form-group">
        <text class="form-label">{{ t('login.email') }}</text>
        <input
          v-model="email"
          :placeholder="t('login.email')"
          type="email"
          inputmode="email"
          autocomplete="email"
          spellcheck="false"
          class="form-input"
        />
      </view>

      <view class="form-group">
        <text class="form-label">{{ t('login.password') }}</text>
        <view class="pw-wrap">
          <input
            v-model="password"
            :placeholder="t('login.password')"
            :password="!showPw"
            :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'"
            class="form-input pw-input"
            maxlength="72"
          />
          <view class="pw-toggle" role="button" :aria-label="t('a11y.passwordToggle')" @click="showPw = !showPw">
            <image :src="showPw ? '/static/eye-off.svg' : '/static/eye.svg'" alt="" class="pw-toggle-icon" mode="aspectFit" />
          </view>
        </view>
      </view>

      <text v-if="mode === 'login'" class="forgot-link" @click="onForgotPassword">{{ t('login.forgot') }}</text>

      <view class="agreement-row" v-if="mode === 'signup'" @click="agreed = !agreed">
        <view :class="['agree-check', { on: agreed }]">
          <view v-if="agreed" class="check-mark"></view>
        </view>
        <text class="agree-text">
          <text>{{ t('login.agreePrefix') }}</text>
          <text class="link" @click.stop="goLegal('terms')">{{ t('legal.terms') }}</text>
          <text>, </text>
          <text class="link" @click.stop="goLegal('privacy')">{{ t('legal.privacy') }}</text>
          <text>{{ t('login.agreeAnd') }}</text>
          <text class="link" @click.stop="goLegal('guidelines')">{{ t('legal.guidelines') }}</text>
        </text>
      </view>

      <button class="submit-btn" :disabled="loading" @click="onSubmit">
        {{ loading ? t('login.wait') : (mode === 'login' ? t('login.submitLogin') : t('login.submitSignup')) }}
      </button>

      <!-- #ifdef H5 -->
      <!--
        Google OAuth — H5-only secondary auth path. Placed BELOW the
        email form (per spec) with an 'or' divider so the email/password
        path stays primary. Same button works for both 'login' and
        'signup' tab modes — Supabase signInWithOAuth creates a profile
        on first sign-in, so the user doesn't need to think about which
        tab they're on. mp-weixin gets the WeChat button at the top of
        the form instead; Google OAuth has no sane mp flow and would be
        decorative noise there.

        Until the dashboard configuration in the commit message is done,
        clicking this button surfaces a 'provider is not enabled' error
        from Supabase — that's the expected pre-config state.
      -->
      <view class="or-divider google-divider">
        <view class="or-line"></view>
        <text class="or-text">{{ t('login.orContinue') }}</text>
        <view class="or-line"></view>
      </view>
      <button class="google-btn" :disabled="loading || googleLoading" @click="onSignInWithGoogle">
        <view class="g-icon-circle">
          <text class="g-icon-letter">G</text>
        </view>
        <text>{{ googleLoading ? t('login.connectingGoogle') : t('login.googleSignIn') }}</text>
      </button>
      <!-- #endif -->
    </view>

    <view class="footer">
      <text class="footer-text">Illini Market</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { useSupabase } from '../../composables/useSupabase'
import { useI18n } from '../../composables/useI18n'
import { BASE_URL } from '../../config/runtime'

const { t } = useI18n()
const { signIn, signUp, signInWithWeChat, loading } = useAuth()

const mode = ref<'login' | 'signup'>('login')
const email = ref('')
const password = ref('')
const nickname = ref('')
const showPw = ref(false)
const agreed = ref(false)
const googleLoading = ref(false)

const { supabase } = useSupabase()

async function onForgotPassword() {
  const trimmedEmail = email.value.trim().toLowerCase()
  if (!trimmedEmail) {
    uni.showToast({ title: t('login.needEmail'), icon: 'none' })
    return
  }
  /*
   * Basic shape check before hitting the API. Supabase's own validation
   * is fine, but a syntactically broken email returns a generic 400
   * with no localized message — easier to catch here.
   */
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    uni.showToast({ title: t('login.needEmail'), icon: 'none' })
    return
  }
  /*
   * redirectTo MUST point at the actual reset-password page, not at the
   * site root. Supabase appends ?code=<pkce> to redirectTo and bounces
   * the user there after token verify; if the bounce lands on '/' the
   * user is silently logged in, supabase-js fires PASSWORD_RECOVERY
   * during that intermediate root-page load (where no recovery
   * listener is attached yet), and by the time the user manually
   * navigates to /pages/reset-password the recovery context is gone
   * — updateUser({password}) then 400s with 'Current password
   * required'. See evidence in _ai_notes/HOTFIX_2026-04-25.md.
   *
   * The hash-route target (/#/pages/reset-password/index) is in the
   * Supabase Redirect URL allow-list (user-confirmed via dashboard).
   */
  let redirectTo: string | undefined
  // #ifdef H5
  if (typeof window !== 'undefined') redirectTo = `${window.location.origin}/#/pages/reset-password/index`
  // #endif
  // #ifndef H5
  redirectTo = `${BASE_URL}/#/pages/reset-password/index`
  // #endif
  console.log('[reset-pw-debug] sending reset email to:', trimmedEmail, 'redirectTo:', redirectTo)
  const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, { redirectTo })
  if (error) {
    console.warn('[reset-pw-debug] resetPasswordForEmail error:', error)
    uni.showModal({
      title: t('login.resetFailTitle'),
      content: error.message,
      showCancel: false,
    })
  } else {
    console.log('[reset-pw-debug] reset email request OK (delivery is async)')
    /*
     * Supabase's resetPasswordForEmail returns success even if the email
     * is queued (or rate-limited internally). The user should be told
     * explicitly that this can take a moment AND to check their spam
     * folder, since we can't see whether the email actually arrived.
     */
    uni.showModal({
      title: t('login.resetSent'),
      content: t('login.resetHint'),
      showCancel: false,
    })
  }
}

function goLegal(type: string) {
  uni.navigateTo({ url: `/pages/legal/index?type=${type}` })
}

function goBack() {
  uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/index/index' }) })
}

/*
 * Google OAuth — H5-only entry point.
 *
 * Calls supabase.auth.signInWithOAuth with provider=google. Supabase
 * generates the Google authorize URL (with PKCE state + code_challenge
 * baked in) and the H5 supabase-js implementation calls
 * window.location.assign(...) to navigate the page there. The user
 * authenticates with Google, Google bounces back to Supabase's
 * /auth/v1/callback (the URL configured in Google Cloud Console),
 * Supabase verifies and bounces to our redirectTo with `?code=<pkce>`
 * appended.
 *
 * On return the app boots fresh:
 *   1. App.vue's extractAuthCodeFromUrl runs synchronously, sees the
 *      ?code= but ALSO sees the hash route is NOT /pages/reset-password
 *      → leaves the URL alone (post r3a-Fix6 update to the entry hook).
 *   2. setTimeout(0) fires init() which creates the supabase client
 *      with detectSessionInUrl: true.
 *   3. supabase-js detectSessionInUrl pipeline finds the search-side
 *      ?code=, exchanges it via exchangeCodeForSession, fires SIGNED_IN.
 *   4. useAuth's auth subscriber catches SIGNED_IN, sets currentUser,
 *      and the consent gate watcher (also in App.vue) decides whether
 *      to send the user to onboarding (first-time) or just let them
 *      enter the home page.
 *
 * No code path in this file owns the post-redirect handling — that's
 * all delegated to the existing init() + auth subscriber chain. Means
 * Google OAuth is wired in by adding ONLY this handler + the button
 * + the entry-hook discrimination, no chat with the home page or
 * the index lifecycle.
 *
 * IMPORTANT — dashboard config required before this works end-to-end.
 * See the commit message for the full Google Cloud Console + Supabase
 * Dashboard steps. Without that config, signInWithOAuth returns an
 * error like 'Unsupported provider: provider is not enabled', which
 * is what the catch+toast below surfaces.
 *
 * Mp-weixin / other mp targets fall through to a single toast and
 * exit — there's no Google in those environments.
 */
async function onSignInWithGoogle() {
  if (loading.value || googleLoading.value) return
  // #ifdef H5
  if (typeof window === 'undefined') return
  googleLoading.value = true
  const redirectTo = `${window.location.origin}/`
  console.log('[oauth-debug] starting Google sign-in, redirectTo:', redirectTo)
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (error) {
      console.warn('[oauth-debug] signInWithOAuth error:', error)
      googleLoading.value = false
      uni.showToast({
        title: error.message ? `${t('login.googleFail')}: ${error.message}` : t('login.googleFail'),
        icon: 'none',
        duration: 3000,
      })
      return
    }
    /*
     * Success path is silent: signInWithOAuth has already issued the
     * window.location.assign() to Google. Any code after this would
     * be racing with the page navigation. The success "toast" is the
     * Google sign-in screen the user is about to see.
     *
     * googleLoading.value stays true on success — the page navigates
     * away to Google before any reset matters; on return the page
     * re-mounts fresh with googleLoading reset to its initial false.
     */
    console.log('[oauth-debug] OAuth flow initiated, awaiting Google redirect')
  } catch (err: any) {
    console.warn('[oauth-debug] signInWithOAuth threw:', err)
    googleLoading.value = false
    uni.showToast({
      title: err?.message ? `${t('login.googleFail')}: ${err.message}` : t('login.googleFail'),
      icon: 'none',
      duration: 3000,
    })
  }
  // #endif
  // #ifndef H5
  uni.showToast({ title: t('login.oauthUnsupported'), icon: 'none', duration: 2500 })
  // #endif
}

async function onWeChatLogin() {
  if (loading.value) return
  const { error } = await signInWithWeChat()
  if (error) {
    uni.showToast({
      title: error?.message ? `${t('login.wechatFail')}: ${error.message}` : t('login.wechatFail'),
      icon: 'none',
      duration: 3000,
    })
    return
  }
  uni.showToast({ title: t('login.loginOk'), icon: 'success' })
  setTimeout(() => uni.reLaunch({ url: '/pages/index/index' }), 800)
}

async function onSubmit() {
  if (!email.value.trim()) {
    uni.showToast({ title: t('login.needEmail'), icon: 'none' })
    return
  }
  if (!password.value) {
    uni.showToast({ title: t('login.needPassword'), icon: 'none' })
    return
  }
  if (mode.value === 'signup' && password.value.length < 8) {
    uni.showToast({ title: t('login.needPassword'), icon: 'none' })
    return
  }

  if (mode.value === 'signup') {
    if (!nickname.value.trim()) {
      uni.showToast({ title: t('login.needNickname'), icon: 'none' })
      return
    }
    if (!agreed.value) {
      uni.showToast({ title: t('login.agreeRequired'), icon: 'none', duration: 2500 })
      return
    }
    const { data, error } = await signUp(email.value.trim(), password.value, nickname.value.trim())
    if (error) {
      uni.showToast({ title: error.message || t('login.signupFail'), icon: 'none' })
    } else if (data?.user?.identities?.length === 0) {
      uni.showToast({ title: t('login.emailExists'), icon: 'none' })
    } else if (data?.user && !data.session) {
      uni.showModal({
        title: t('login.confirmTitle'),
        content: t('login.confirmHint'),
        showCancel: false,
      })
    } else {
      uni.showToast({ title: t('login.signupOk'), icon: 'success' })
      /*
       * O1 (2026-05-20): onboarding flow removed. New users with default
       * tos_version='0' will hit the App.vue gate's reconsent branch on
       * first profile load and get redirected to /pages/reconsent/index
       * (the canonical consent surface). The legal acceptance step is
       * preserved; the wizard's nickname/campus/avatar collection is
       * gone (redundant / dead-data / editable post-signup). See
       * docs/memory/o1_onboarding_removed.md.
       */
      setTimeout(() => {
        uni.reLaunch({ url: '/pages/index/index' })
      }, 1200)
    }
  } else {
    const { error } = await signIn(email.value.trim(), password.value)
    if (error) {
      uni.showToast({ title: error.message || t('login.loginFail'), icon: 'none' })
    } else {
      uni.showToast({ title: t('login.loginOk'), icon: 'success' })
      /*
       * Replaced uni.navigateBack() with reLaunch to /pages/index/index.
       *
       * Why navigateBack failed: when users land on the login page from
       * /pages/welcome/index.vue (the very first launch path) OR from a
       * direct deep-link (recovery email, OAuth callback, share URL),
       * the navigation stack is just [login] — there is nothing to go
       * back to. uni.navigateBack silently no-ops in that case (no
       * fail callback to fall through), so the user sees the success
       * toast and stays parked on the login page. They had to manually
       * refresh / re-tap a tab to actually enter the app.
       *
       * reLaunch is the right primitive here because:
       *   1. After login, "go back" is semantically wrong — the user
       *      is now authenticated, the back stack should be flushed
       *      (no hitting Back to return to a logged-out page).
       *   2. /pages/index/index is a tabBar page, so we can't use
       *      navigateTo (uni-app rejects tabBar destinations from
       *      navigateTo). reLaunch handles tabBar pages cleanly.
       *   3. WeChat-login success above (line ~205) already does
       *      reLaunch to the same destination — bringing email-login
       *      in line keeps both auth paths consistent.
       *
       * 800ms (matched to the WeChat-login path) lets the success
       * toast register visually before the page swap.
       */
      setTimeout(() => uni.reLaunch({ url: '/pages/index/index' }), 800)
    }
  }
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh; background: var(--bg-elev-1);
  padding: 0 24px;
  max-width: 400px; margin: 0 auto;
  display: flex; flex-direction: column;
}

.nav-back {
  position: absolute; top: calc(14px + var(--status-bar-height, env(safe-area-inset-top, 0px))); left: 16px;
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; z-index: 10;
  &:active { background: var(--bg-subtle); }
}
.back-arrow {
  width: 10px; height: 10px;
  border-left: 2px solid var(--accent-primary); border-bottom: 2px solid var(--accent-primary);
  transform: rotate(45deg); margin-left: 3px;
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
.logo-letter {
  font-size: 28px; font-weight: 800; color: #fff;
  letter-spacing: -1px;
}
.app-name {
  font-size: 22px; font-weight: 700; color: var(--text-primary);
  margin-top: 16px; letter-spacing: -0.02em;
}
.app-desc {
  font-size: 13px; color: var(--text-faint); margin-top: 5px;
  letter-spacing: 0.01em;
}

.form { flex: 1; }

.tab-bar {
  display: flex; gap: 28px; margin-bottom: 28px;
  border-bottom: 1px solid var(--line-hair);
}
.tab {
  position: relative; padding-bottom: 12px; cursor: pointer;
  text { font-size: 16px; color: var(--text-faint); font-weight: 500; }
  &.active text { color: var(--text-primary); font-weight: 600; }
}
.tab-line {
  position: absolute; bottom: -1px; left: 0; right: 0;
  height: 2px; background: var(--accent-primary); border-radius: 1px;
}

.form-group { margin-bottom: 18px; }
.form-label {
  display: block; font-size: 13px; color: var(--text-muted);
  margin-bottom: 7px; font-weight: 500;
}
.form-input {
  width: 100%; height: 48px;
  background: var(--bg-elev-2); border-radius: 12px;
  padding: 0 16px; font-size: 15px; color: var(--text-primary);
  border: 1px solid transparent;
  transition: border-color 0.15s, background 0.15s;
  &:focus {
    border-color: var(--line-soft);
    background: var(--bg-elev-1);
  }
}
.pw-wrap { position: relative; }
.pw-input { padding-right: 44px; }
.pw-toggle {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  cursor: pointer; font-size: 18px; color: var(--text-muted);
  padding: 4px;
}
.pw-toggle-icon {
  width: 18px;
  height: 18px;
  display: block;
}

.forgot-link {
  display: block; text-align: right; font-size: 13px;
  color: var(--text-muted); margin-top: 8px; cursor: pointer;
  &:active { color: var(--text-primary); }
}
.submit-btn {
  width: 100%; height: 48px;
  background: var(--accent-primary); color: #fff;
  border-radius: 24px; font-size: 15px; font-weight: 600;
  margin-top: 24px; border: none;
  display: flex; align-items: center; justify-content: center;
  letter-spacing: 0.01em;
  &[disabled] { opacity: 0.35; }
  &:active { opacity: 0.8; }
}

.wx-btn {
  width: 100%; height: 48px;
  background: #07C160; color: #fff;
  border-radius: 24px; font-size: 15px; font-weight: 600;
  margin-top: 8px; border: none;
  display: flex; align-items: center; justify-content: center;
  gap: 8px; letter-spacing: 0.01em;
  &[disabled] { opacity: 0.45; }
  &:active { opacity: 0.85; }
}
.wx-icon {
  font-size: 18px; line-height: 1;
}

/*
 * Google OAuth button — white surface + warm-charcoal text, secondary
 * to the brand-colored email submit button above. Uses a stylized 'G'
 * monogram in a brand-soft circle instead of Google's official 'G'
 * mark — Google's brand guidelines (https://about.google/brand-resource-center/)
 * forbid placing the official mark on a button without their approval
 * pipeline, and an unbranded 'G' is industry-standard for "OAuth via
 * Google" affordances. The circle background uses --bg-subtle so the
 * button visually pairs with --bg-elev-2 form inputs above.
 */
.google-divider { margin-top: 18px; margin-bottom: 12px; }
.google-btn {
  width: 100%; height: 48px;
  background: var(--surface); color: var(--ink);
  border: 0.5px solid var(--border-strong);
  border-radius: 24px; font-size: 15px; font-weight: 500;
  display: flex; align-items: center; justify-content: center;
  gap: 10px; letter-spacing: 0.01em;
  padding: 0 16px;
  &[disabled] { opacity: 0.45; }
  &:active { background: var(--bg-subtle); transform: translateY(1px); }
}
.g-icon-circle {
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--bg-subtle);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.g-icon-letter {
  font-family: var(--font-serif);
  font-size: 14px; font-weight: 700;
  color: var(--ink);
  line-height: 1;
}

.or-divider {
  display: flex; align-items: center; gap: 12px;
  margin: 22px 0 6px;
}
.or-line {
  flex: 1; height: 1px; background: var(--border);
}
.or-text {
  font-size: 12px; color: var(--ink-quiet);
  letter-spacing: 0.04em;
}

.agreement-row {
  display: flex; align-items: flex-start; gap: 9px;
  margin-top: 18px; padding: 4px 2px; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.agree-check {
  width: 18px; height: 18px; border: 1.5px solid var(--text-faint);
  border-radius: 4px; flex-shrink: 0; margin-top: 1px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
  &.on { background: var(--accent-primary); border-color: var(--text-primary); }
}
.check-mark {
  width: 10px; height: 6px;
  border-left: 1.5px solid #fff; border-bottom: 1.5px solid #fff;
  transform: rotate(-45deg); margin-top: -2px;
}
.agree-text {
  font-size: 12px; color: var(--text-secondary); line-height: 1.5; flex: 1;
  .link { color: var(--text-primary); text-decoration: underline; cursor: pointer; }
}

.footer {
  padding: 24px 0; text-align: center;
}
.footer-text {
  font-size: 11px; color: var(--ink-faint);
  letter-spacing: 0.05em; font-weight: 500;
}
</style>
