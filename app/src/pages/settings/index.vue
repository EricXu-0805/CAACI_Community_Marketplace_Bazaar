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
      <view class="menu-item" @click="goLegal('guidelines')">
        <text class="mi-label">{{ t('legal.guidelines') }}</text>
        <view class="mi-arrow"></view>
      </view>
    </view>

    <view v-if="isLoggedIn" class="section">
      <view class="menu-item" @click="goBlocked">
        <text class="mi-label">{{ t('settings.blockedUsers') }}</text>
        <view class="mi-arrow"></view>
      </view>
      <view class="menu-item" @click="onChangePassword">
        <text class="mi-label">{{ t('settings.changePassword') }}</text>
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
import { useSupabase } from '../../composables/useSupabase'

const { t, lang, toggleLang } = useI18n()
const { isLoggedIn, signOut } = useAuth()
const { supabase } = useSupabase()
const cacheSize = ref('--')

try {
  const info = uni.getStorageInfoSync()
  cacheSize.value = `${Math.round(info.currentSize / 1024 * 10) / 10} MB`
} catch {}

function goBack() { uni.navigateBack() }
function goLegal(type: string) {
  uni.navigateTo({ url: `/pages/legal/index?type=${type}` })
}
function goBlocked() { uni.navigateTo({ url: '/pages/blocked/index' }) }

const CACHE_KEYS_TO_CLEAR = ['search_history', 'browse_history', 'home_items_cache']

function clearCache() {
  uni.showModal({
    title: t('settings.clearTitle'),
    content: t('settings.clearHint'),
    success: (res) => {
      if (!res.confirm) return
      try {
        for (const key of CACHE_KEYS_TO_CLEAR) uni.removeStorageSync(key)
        const info = uni.getStorageInfoSync()
        cacheSize.value = `${Math.round(info.currentSize / 1024 * 10) / 10} MB`
        uni.showToast({ title: t('settings.cleared'), icon: 'success' })
      } catch {}
    },
  })
}

async function onChangePassword() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user?.email) return

  uni.showModal({
    title: t('settings.changePasswordTitle'),
    content: t('settings.changePasswordHint'),
    success: async (res) => {
      if (!res.confirm) return
      const redirectTo = typeof window !== 'undefined'
        ? `${window.location.origin}/`
        : undefined
      const { error } = await supabase.auth.resetPasswordForEmail(session.user!.email!, { redirectTo })
      if (error) {
        uni.showToast({ title: error.message, icon: 'none' })
      } else {
        uni.showToast({ title: t('settings.changePasswordSent'), icon: 'success', duration: 3000 })
      }
    },
  })
}

function onDeleteAccount() {
  uni.showModal({
    title: t('settings.deleteAccountConfirm'),
    content: t('settings.deleteAccountHint'),
    confirmColor: 'var(--accent-danger)',
    success: async (res) => {
      if (!res.confirm) return
      uni.showLoading({ title: '...' })
      try {
        const { error } = await supabase.rpc('delete_my_account')
        if (error) throw error
        await signOut()
        uni.hideLoading()
        uni.showToast({
          title: t('settings.deleteAccountDone'),
          icon: 'success',
          duration: 2000,
        })
        setTimeout(() => uni.reLaunch({ url: '/pages/welcome/index' }), 1500)
      } catch (err: any) {
        uni.hideLoading()
        uni.showToast({
          title: err?.message || t('settings.deleteAccountFailed'),
          icon: 'none',
          duration: 3000,
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
.page { min-height: 100vh; background: var(--bg-subtle); max-width: 480px; margin: 0 auto; }
.header {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  padding-top: calc(12px + env(safe-area-inset-top, 0px));
  background: var(--bg-elev-1); border-bottom: 0.5px solid var(--line-hair);
}
.back-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.back-arrow { width: 9px; height: 9px; border-left: 2px solid var(--accent-primary); border-bottom: 2px solid var(--accent-primary); transform: rotate(45deg); margin-left: 4px; }
.header-title { font-size: 17px; font-weight: 600; color: var(--text-primary); }

.section { background: var(--bg-elev-1); margin-top: 7px; }
.menu-item {
  display: flex; align-items: center; padding: 15px 16px;
  border-bottom: 0.5px solid var(--line-hair); cursor: pointer;
  &:last-child { border-bottom: none; }
  &:active { background: var(--bg-elev-2); }
  &.danger { justify-content: center; }
}
.mi-label { font-size: 15px; color: var(--text-primary); flex: 1; }
.mi-value { font-size: 14px; color: var(--text-muted); margin-right: 8px; }
.mi-arrow {
  width: 7px; height: 7px; flex-shrink: 0;
  border-top: 1.5px solid var(--text-faint); border-right: 1.5px solid var(--text-faint);
  transform: rotate(45deg);
}
.danger-text { color: var(--accent-danger); text-align: center; }
</style>
