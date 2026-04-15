<template>
  <view class="page">
    <view class="header">
      <text class="logo">🏪</text>
      <text class="app-name">CAACI Bazaar</text>
      <text class="app-desc">UIUC Community Marketplace</text>
    </view>

    <view class="form">
      <view class="tab-bar">
        <text :class="['tab', { active: mode === 'login' }]" @click="mode = 'login'">Sign In</text>
        <text :class="['tab', { active: mode === 'signup' }]" @click="mode = 'signup'">Sign Up</text>
      </view>

      <view v-if="mode === 'signup'" class="form-group">
        <input v-model="nickname" placeholder="Nickname" class="form-input" />
      </view>

      <view class="form-group">
        <input v-model="email" placeholder="Email" type="text" class="form-input" />
      </view>

      <view class="form-group">
        <input v-model="password" placeholder="Password" password class="form-input" />
      </view>

      <button class="submit-btn" :disabled="loading" @click="onSubmit">
        {{ loading ? 'Please wait...' : (mode === 'login' ? 'Sign In' : 'Create Account') }}
      </button>

      <text class="agreement" v-if="mode === 'signup'">
        By signing up you agree to our Terms and Privacy Policy
      </text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '../../composables/useAuth'

const { signIn, signUp, loading } = useAuth()

const mode = ref<'login' | 'signup'>('login')
const email = ref('')
const password = ref('')
const nickname = ref('')

async function onSubmit() {
  if (!email.value.trim()) {
    uni.showToast({ title: 'Enter your email', icon: 'none' })
    return
  }
  if (!password.value || password.value.length < 6) {
    uni.showToast({ title: 'Password must be 6+ chars', icon: 'none' })
    return
  }

  if (mode.value === 'signup') {
    if (!nickname.value.trim()) {
      uni.showToast({ title: 'Enter a nickname', icon: 'none' })
      return
    }
    const { error } = await signUp(email.value.trim(), password.value, nickname.value.trim())
    if (error) {
      uni.showToast({ title: error.message || 'Sign up failed', icon: 'none' })
    } else {
      uni.showToast({ title: 'Account created!', icon: 'success' })
      setTimeout(() => uni.navigateBack(), 1500)
    }
  } else {
    const { error } = await signIn(email.value.trim(), password.value)
    if (error) {
      uni.showToast({ title: error.message || 'Sign in failed', icon: 'none' })
    } else {
      uni.showToast({ title: 'Welcome back!', icon: 'success' })
      setTimeout(() => uni.navigateBack(), 1000)
    }
  }
}
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: #fff; padding: 16px; max-width: 420px; margin: 0 auto; }
.header { display: flex; flex-direction: column; align-items: center; padding: 56px 0 36px; }
.logo { font-size: 48px; }
.app-name { font-size: 24px; font-weight: 800; color: #FF6B35; margin-top: 12px; letter-spacing: 0.5px; }
.app-desc { font-size: 14px; color: #999; margin-top: 4px; }
.form { padding: 0 8px; }
.tab-bar { display: flex; justify-content: center; gap: 32px; margin-bottom: 24px; }
.tab { font-size: 17px; color: #bbb; padding-bottom: 8px; cursor: pointer;
  &.active { color: #FF6B35; font-weight: 700; border-bottom: 2px solid #FF6B35; }
}
.form-group { margin-bottom: 12px; }
.form-input { width: 100%; height: 48px; background: #f5f5f5; border-radius: 12px; padding: 0 16px; font-size: 15px; }
.submit-btn {
  width: 100%; height: 48px; background: #FF6B35; color: #fff;
  border-radius: 24px; font-size: 16px; font-weight: 600;
  margin-top: 20px; border: none;
  display: flex; align-items: center; justify-content: center;
  &[disabled] { opacity: 0.5; }
  &:active { opacity: 0.85; }
}
.agreement { display: block; text-align: center; font-size: 12px; color: #bbb; margin-top: 20px; }
</style>
