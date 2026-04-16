<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" @click="goBack"><view class="back-arrow"></view></view>
      <text class="header-title">{{ t('settings.title') }}</text>
    </view>

    <view class="section">
      <view class="menu-item" @click="toggleLang">
        <text class="mi-label">{{ t('settings.language') }}</text>
        <text class="mi-value">{{ lang === 'zh' ? '中文' : 'English' }}</text>
        <view class="mi-arrow"></view>
      </view>
    </view>

    <view class="section">
      <view class="menu-item" @click="clearCache">
        <text class="mi-label">{{ t('settings.clearCache') }}</text>
        <text class="mi-value">{{ cacheSize }}</text>
        <view class="mi-arrow"></view>
      </view>
    </view>

    <view class="section">
      <view class="menu-item">
        <text class="mi-label">{{ t('settings.version') }}</text>
        <text class="mi-value">0.1.0</text>
      </view>
    </view>

    <view class="section">
      <view class="menu-item" @click="goLegal('terms')">
        <text class="mi-label">{{ t('legal.terms') }}</text>
        <view class="mi-arrow"></view>
      </view>
      <view class="menu-item" @click="goLegal('privacy')">
        <text class="mi-label">{{ t('legal.privacy') }}</text>
        <view class="mi-arrow"></view>
      </view>
    </view>

    <view v-if="isLoggedIn" class="section">
      <view class="menu-item danger" @click="onSignOut">
        <text class="mi-label danger-text">{{ t('profile.signOut') }}</text>
      </view>
    </view>

    <view v-if="isLoggedIn" class="section">
      <view class="menu-item danger" @click="onDeleteAccount">
        <text class="mi-label danger-text">{{ t('settings.deleteAccount') }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'

const { t, lang, toggleLang } = useI18n()
const { isLoggedIn, signOut } = useAuth()
const cacheSize = ref('--')

try {
  const info = uni.getStorageInfoSync()
  cacheSize.value = `${Math.round(info.currentSize / 1024 * 10) / 10} MB`
} catch {}

function goBack() { uni.navigateBack() }
function goLegal(type: string) {
  uni.navigateTo({ url: `/pages/legal/index${type === 'privacy' ? '?type=privacy' : ''}` })
}

function clearCache() {
  uni.showModal({
    title: t('settings.clearTitle'),
    content: t('settings.clearHint'),
    success: (res) => {
      if (!res.confirm) return
      try {
        uni.clearStorageSync()
        cacheSize.value = '0 MB'
        uni.showToast({ title: t('settings.cleared'), icon: 'success' })
      } catch {}
    },
  })
}

function onDeleteAccount() {
  uni.showModal({
    title: t('settings.deleteTitle'),
    content: t('settings.deleteHint'),
    confirmColor: '#FF3B30',
    success: (res) => {
      if (res.confirm) {
        uni.showModal({
          title: t('settings.deleteConfirm'),
          content: t('settings.deleteConfirmHint'),
          confirmColor: '#FF3B30',
          success: async (r) => {
            if (r.confirm) {
              signOut()
              uni.showToast({ title: t('settings.deleteRequested'), icon: 'none', duration: 3000 })
            }
          },
        })
      }
    },
  })
}

function onSignOut() {
  uni.showModal({
    title: t('settings.signOutTitle'),
    content: t('settings.signOutHint'),
    success: (res) => {
      if (res.confirm) signOut()
    },
  })
}
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: #f2f2f7; max-width: 480px; margin: 0 auto; }
.header {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  padding-top: calc(12px + env(safe-area-inset-top, 0px));
  background: #fff; border-bottom: 0.5px solid rgba(0,0,0,0.06);
}
.back-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.back-arrow { width: 9px; height: 9px; border-left: 2px solid #1a1a1a; border-bottom: 2px solid #1a1a1a; transform: rotate(45deg); margin-left: 4px; }
.header-title { font-size: 17px; font-weight: 600; color: #1a1a1a; }

.section { background: #fff; margin-top: 7px; }
.menu-item {
  display: flex; align-items: center; padding: 15px 16px;
  border-bottom: 0.5px solid rgba(0,0,0,0.06); cursor: pointer;
  &:last-child { border-bottom: none; }
  &:active { background: #f7f7f8; }
  &.danger { justify-content: center; }
}
.mi-label { font-size: 15px; color: #1a1a1a; flex: 1; }
.mi-value { font-size: 14px; color: #8e8e93; margin-right: 8px; }
.mi-arrow {
  width: 7px; height: 7px; flex-shrink: 0;
  border-top: 1.5px solid #c7c7cc; border-right: 1.5px solid #c7c7cc;
  transform: rotate(45deg);
}
.danger-text { color: #FF3B30; text-align: center; }
</style>
