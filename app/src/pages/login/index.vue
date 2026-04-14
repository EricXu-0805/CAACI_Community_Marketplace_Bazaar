<template>
  <view class="page">
    <view class="header">
      <text class="logo">🏪</text>
      <text class="app-name">CAACI 集市</text>
      <text class="app-desc">华协社区二手交易平台</text>
    </view>

    <view class="form">
      <view class="tab-bar">
        <text :class="['tab', { active: mode === 'login' }]" @click="mode = 'login'">登录</text>
        <text :class="['tab', { active: mode === 'signup' }]" @click="mode = 'signup'">注册</text>
      </view>

      <view v-if="mode === 'signup'" class="form-group">
        <input v-model="nickname" placeholder="昵称" class="form-input" />
      </view>

      <view class="form-group">
        <input v-model="email" placeholder="邮箱" type="text" class="form-input" />
      </view>

      <view class="form-group">
        <input v-model="password" placeholder="密码" password class="form-input" />
      </view>

      <button class="submit-btn" :disabled="loading" @click="onSubmit">
        {{ loading ? '请稍候...' : (mode === 'login' ? '登录' : '注册') }}
      </button>

      <text class="agreement" v-if="mode === 'signup'">
        注册即表示同意《用户协议》和《隐私政策》
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
    uni.showToast({ title: '请输入邮箱', icon: 'none' })
    return
  }
  if (!password.value || password.value.length < 6) {
    uni.showToast({ title: '密码至少6位', icon: 'none' })
    return
  }

  if (mode.value === 'signup') {
    if (!nickname.value.trim()) {
      uni.showToast({ title: '请输入昵称', icon: 'none' })
      return
    }
    const { error } = await signUp(email.value.trim(), password.value, nickname.value.trim())
    if (error) {
      uni.showToast({ title: error.message || '注册失败', icon: 'none' })
    } else {
      uni.showToast({ title: '注册成功！', icon: 'success' })
      setTimeout(() => uni.navigateBack(), 1500)
    }
  } else {
    const { error } = await signIn(email.value.trim(), password.value)
    if (error) {
      uni.showToast({ title: error.message || '登录失败', icon: 'none' })
    } else {
      uni.showToast({ title: '登录成功！', icon: 'success' })
      setTimeout(() => uni.navigateBack(), 1000)
    }
  }
}
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: #fff; padding: 16px; max-width: 480px; margin: 0 auto; }
.header { display: flex; flex-direction: column; align-items: center; padding: 56px 0 36px; }
.logo { font-size: 48px; }
.app-name { font-size: 24px; font-weight: 700; color: #1d1d1f; margin-top: 12px; }
.app-desc { font-size: 14px; color: #aeaeb2; margin-top: 4px; }
.form { padding: 0 8px; }
.tab-bar { display: flex; justify-content: center; gap: 32px; margin-bottom: 24px; }
.tab { font-size: 17px; color: #aeaeb2; padding-bottom: 8px;
  &.active { color: #FF6B35; font-weight: 700; border-bottom: 2px solid #FF6B35; }
}
.form-group { margin-bottom: 12px; }
.form-input { width: 100%; height: 48px; background: #f5f5f7; border-radius: 12px; padding: 0 16px; font-size: 15px; }
.submit-btn {
  width: 100%; height: 48px; background: #FF6B35; color: #fff;
  border-radius: 24px; font-size: 16px; font-weight: 600;
  margin-top: 20px; border: none;
  display: flex; align-items: center; justify-content: center;
  &[disabled] { opacity: 0.5; }
}
.agreement { display: block; text-align: center; font-size: 12px; color: #aeaeb2; margin-top: 20px; }
</style>
