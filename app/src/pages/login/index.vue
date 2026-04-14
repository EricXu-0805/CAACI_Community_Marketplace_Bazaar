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
.page {
  min-height: 100vh;
  background: $bg-primary;
  padding: $spacing-md;
}

.header {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 100rpx 0 60rpx;
}

.logo {
  font-size: 80rpx;
}

.app-name {
  font-size: 40rpx;
  font-weight: bold;
  color: $text-primary;
  margin-top: $spacing-md;
}

.app-desc {
  font-size: 24rpx;
  color: $text-hint;
  margin-top: $spacing-xs;
}

.form {
  padding: 0 $spacing-md;
}

.tab-bar {
  display: flex;
  justify-content: center;
  gap: $spacing-xl;
  margin-bottom: $spacing-lg;
}

.tab {
  font-size: 32rpx;
  color: $text-hint;
  padding-bottom: $spacing-sm;

  &.active {
    color: $brand-color;
    font-weight: bold;
    border-bottom: 4rpx solid $brand-color;
  }
}

.form-group {
  margin-bottom: $spacing-md;
}

.form-input {
  width: 100%;
  height: 88rpx;
  background: $bg-secondary;
  border-radius: $radius-md;
  padding: 0 $spacing-md;
  font-size: 28rpx;
}

.submit-btn {
  width: 100%;
  height: 88rpx;
  background: $brand-color;
  color: white;
  border-radius: 44rpx;
  font-size: 32rpx;
  font-weight: bold;
  margin-top: $spacing-lg;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;

  &[disabled] {
    opacity: 0.6;
  }
}

.agreement {
  display: block;
  text-align: center;
  font-size: 22rpx;
  color: $text-hint;
  margin-top: $spacing-lg;
}
</style>
