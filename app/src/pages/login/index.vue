<template>
  <view class="page">
    <view class="nav-back" @click="goBack">
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
        <input v-model="nickname" :placeholder="t('login.nickname')" class="form-input" />
      </view>

      <view class="form-group">
        <text class="form-label">{{ t('login.email') }}</text>
        <input v-model="email" :placeholder="t('login.email')" type="text" class="form-input" />
      </view>

      <view class="form-group">
        <text class="form-label">{{ t('login.password') }}</text>
        <input v-model="password" :placeholder="t('login.password')" password class="form-input" />
      </view>

      <button class="submit-btn" :disabled="loading" @click="onSubmit">
        {{ loading ? t('login.wait') : (mode === 'login' ? t('login.submitLogin') : t('login.submitSignup')) }}
      </button>

      <text class="agreement" v-if="mode === 'signup'">
        {{ t('login.agreement') }}
      </text>
    </view>

    <view class="footer">
      <text class="footer-text">Illini Market</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'

const { t } = useI18n()
const { signIn, signUp, loading } = useAuth()

const mode = ref<'login' | 'signup'>('login')
const email = ref('')
const password = ref('')
const nickname = ref('')

function goBack() {
  uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/index/index' }) })
}

async function onSubmit() {
  if (!email.value.trim()) {
    uni.showToast({ title: t('login.needEmail'), icon: 'none' })
    return
  }
  if (!password.value || password.value.length < 8) {
    uni.showToast({ title: t('login.needPassword'), icon: 'none' })
    return
  }

  if (mode.value === 'signup') {
    if (!nickname.value.trim()) {
      uni.showToast({ title: t('login.needNickname'), icon: 'none' })
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
      setTimeout(() => uni.navigateBack(), 1500)
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
  min-height: 100vh; background: #fff;
  padding: 0 24px;
  max-width: 400px; margin: 0 auto;
  display: flex; flex-direction: column;
}

.nav-back {
  position: absolute; top: calc(14px + env(safe-area-inset-top, 0px)); left: 16px;
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; z-index: 10;
  &:active { background: #f2f2f7; }
}
.back-arrow {
  width: 10px; height: 10px;
  border-left: 2px solid #1a1a1a; border-bottom: 2px solid #1a1a1a;
  transform: rotate(45deg); margin-left: 3px;
}

.header {
  display: flex; flex-direction: column; align-items: center;
  padding: 72px 0 40px;
  padding-top: calc(72px + env(safe-area-inset-top, 0px));
}
.logo-mark {
  width: 56px; height: 56px; border-radius: 14px;
  background: #1a1a1a;
  display: flex; align-items: center; justify-content: center;
}
.logo-letter {
  font-size: 28px; font-weight: 800; color: #fff;
  letter-spacing: -1px;
}
.app-name {
  font-size: 22px; font-weight: 700; color: #1a1a1a;
  margin-top: 16px; letter-spacing: -0.02em;
}
.app-desc {
  font-size: 13px; color: #aeaeb2; margin-top: 5px;
  letter-spacing: 0.01em;
}

.form { flex: 1; }

.tab-bar {
  display: flex; gap: 28px; margin-bottom: 28px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}
.tab {
  position: relative; padding-bottom: 12px; cursor: pointer;
  text { font-size: 16px; color: #c7c7cc; font-weight: 500; }
  &.active text { color: #1a1a1a; font-weight: 600; }
}
.tab-line {
  position: absolute; bottom: -1px; left: 0; right: 0;
  height: 2px; background: #1a1a1a; border-radius: 1px;
}

.form-group { margin-bottom: 18px; }
.form-label {
  display: block; font-size: 13px; color: #8e8e93;
  margin-bottom: 7px; font-weight: 500;
}
.form-input {
  width: 100%; height: 48px;
  background: #f7f7f8; border-radius: 12px;
  padding: 0 16px; font-size: 15px; color: #1a1a1a;
  border: 1px solid transparent;
  transition: border-color 0.15s, background 0.15s;
  &:focus {
    border-color: rgba(0,0,0,0.12);
    background: #fff;
  }
}

.submit-btn {
  width: 100%; height: 48px;
  background: #1a1a1a; color: #fff;
  border-radius: 24px; font-size: 15px; font-weight: 600;
  margin-top: 24px; border: none;
  display: flex; align-items: center; justify-content: center;
  letter-spacing: 0.01em;
  &[disabled] { opacity: 0.35; }
  &:active { opacity: 0.8; }
}

.agreement {
  display: block; text-align: center;
  font-size: 12px; color: #c7c7cc; margin-top: 20px;
  line-height: 1.5;
}

.footer {
  padding: 24px 0; text-align: center;
}
.footer-text {
  font-size: 11px; color: #d1d1d6;
  letter-spacing: 0.05em; font-weight: 500;
}
</style>
