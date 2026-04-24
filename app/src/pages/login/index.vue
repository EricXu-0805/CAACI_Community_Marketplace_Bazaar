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
      <button class="wx-btn" :disabled="loading" open-type="getUserInfo" @click="onWeChatLogin">
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
            <text>{{ showPw ? '◉' : '○' }}</text>
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

const { t } = useI18n()
const { signIn, signUp, signInWithWeChat, loading } = useAuth()

const mode = ref<'login' | 'signup'>('login')
const email = ref('')
const password = ref('')
const nickname = ref('')
const showPw = ref(false)
const agreed = ref(false)

const { supabase } = useSupabase()

async function onForgotPassword() {
  if (!email.value.trim()) {
    uni.showToast({ title: t('login.needEmail'), icon: 'none' })
    return
  }
  let redirectTo: string | undefined
  // #ifdef H5
  if (typeof window !== 'undefined') redirectTo = `${window.location.origin}/`
  // #endif
  // #ifndef H5
  redirectTo = 'https://caaci-community-marketplace-bazaar.vercel.app/'
  // #endif
  const { error } = await supabase.auth.resetPasswordForEmail(email.value.trim(), { redirectTo })
  if (error) {
    uni.showToast({ title: error.message, icon: 'none' })
  } else {
    uni.showModal({ title: t('login.resetSent'), content: t('login.resetHint'), showCancel: false })
  }
}

function goLegal(type: string) {
  uni.navigateTo({ url: `/pages/legal/index?type=${type}` })
}

function goBack() {
  uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/index/index' }) })
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
      setTimeout(() => {
        uni.reLaunch({ url: '/pages/onboarding/index' })
      }, 1200)
    }
  } else {
    const { error } = await signIn(email.value.trim(), password.value)
    if (error) {
      uni.showToast({ title: error.message || t('login.loginFail'), icon: 'none' })
    } else {
      uni.showToast({ title: t('login.loginOk'), icon: 'success' })
      setTimeout(() => uni.navigateBack(), 1000)
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
  position: absolute; top: calc(14px + env(safe-area-inset-top, 0px)); left: 16px;
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
  padding-top: calc(72px + env(safe-area-inset-top, 0px));
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
    border-color: rgba(0,0,0,0.12);
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
