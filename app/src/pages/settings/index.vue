<template>
  <view class="page" :class="mpThemeClass" :style="mpChrome">
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack"><UIcon name="chevron-left" size="xs" color="brand" /></view>
      <text class="header-title">{{ t('settings.title') }}</text>
    </view>

    <view class="section">
      <view class="menu-item" @click="onPickLanguage">
        <text class="mi-label">{{ t('settings.language') }}</text>
        <text class="mi-value">{{ currentLangLabel }}</text>
        <view class="mi-arrow"></view>
      </view>
      <!-- Appearance picker (auto / light / dark) — both platforms. Default
           'auto' follows the system theme; a manual pick overrides it and
           persists. mp flips via the .theme-dark class on the page root
           (see App.vue + useTheme mpThemeClass); H5 via html[data-theme].
           The home-page quick toggle stays H5-only (Eric's call). -->
      <view class="menu-item" @click="onPickTheme">
        <text class="mi-label">{{ t('settings.appearance') }}</text>
        <text class="mi-value">{{ currentThemeLabel }}</text>
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
        <text class="mi-value">{{ appVersionLabel }}</text>
      </view>
    </view>

    <view class="section">
      <!--
        Consolidated entry: the legal page is already a 3-tab document
        (terms / privacy / guidelines). Surfacing three separate rows here
        was redundant noise — the destination is the same file either way.
        Landing on 'terms' matches what the former top row did.
      -->
      <view class="menu-item" @click="goLegal('terms')">
        <text class="mi-label">{{ t('settings.legalCombined') }}</text>
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
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
import { computed, ref } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import { useSupabase, platformFetch } from '../../composables/useSupabase'
import { useTheme, type ThemePref } from '../../composables/useTheme'
import { friendlyErrorMessage } from '../../utils'
import { captureException } from '../../utils/sentry'
import { DIALOG_DANGER } from '../../utils/dialogColors'
import { BASE_URL, APP_VERSION, BUILD_REF } from '../../config/runtime'
import UIcon from '../../components/UIcon.vue'

const { t, lang, setLang } = useI18n()
const { isLoggedIn, signOut } = useAuth()
const { supabase } = useSupabase()
const { pref: themePref, setPref: setThemePref } = useTheme()
const cacheSize = ref('--')
const appVersionLabel = `${APP_VERSION} · ${BUILD_REF}`

/*
 * Language picker.
 *
 * Source of truth for the list of supported locales. Adding a new one
 * (say 'ja', 'ko', 'zh-Hant') is: (1) add an entry here, (2) fill in
 * the matching Record<string, string> block in useI18n.ts. Nothing
 * else in the app hard-codes 'zh' or 'en' for UI, because the useI18n
 * API hands out the current lang via a computed ref and every page
 * pulls labels through t(). For item/post content bilingualism see
 * the Wave 3b notes — that still needs a DB column.
 */
type SupportedLang = 'zh' | 'en'
const LANGUAGES: Array<{ code: SupportedLang; label: string }> = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
]

const currentLangLabel = computed(
  () => LANGUAGES.find(l => l.code === lang.value)?.label || 'English'
)

function onPickLanguage() {
  uni.showActionSheet({
    itemList: LANGUAGES.map(l => l.label),
    success: (res) => {
      const pick = LANGUAGES[res.tapIndex]
      if (pick && pick.code !== lang.value) setLang(pick.code)
    },
  })
}

/*
 * Appearance (light / dark / auto) picker. Default is 'auto' — follows
 * system preference via prefers-color-scheme media query. Manual choices
 * override the system and persist via uni.setStorageSync(). See
 * useTheme.ts for the storage + DOM flip mechanism.
 */
const THEMES: Array<{ code: ThemePref; label: () => string }> = [
  { code: 'auto',  label: () => t('settings.themeAuto') },
  { code: 'light', label: () => t('settings.themeLight') },
  { code: 'dark',  label: () => t('settings.themeDark') },
]
const currentThemeLabel = computed(
  () => THEMES.find(x => x.code === themePref.value)?.label() || t('settings.themeAuto'),
)
function onPickTheme() {
  uni.showActionSheet({
    itemList: THEMES.map(x => x.label()),
    success: (res) => {
      const pick = THEMES[res.tapIndex]
      if (pick && pick.code !== themePref.value) {
        setThemePref(pick.code)
        uni.showToast({
          title: pick.label(),
          icon: 'none',
          duration: 1200,
        })
      }
    },
  })
}

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
      } catch {
        uni.showToast({ title: t('error.actionFailed'), icon: 'none' })
      }
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
      // QA6 #1: emails a 6-digit code (no link — links were pre-fetched and
      // expired), then opens the reset page pre-filled with this account's
      // email so the user just types the code + new password.
      const targetEmail = session.user!.email!
      const { error } = await supabase.auth.resetPasswordForEmail(targetEmail)
      if (error) {
        uni.showModal({
          title: t('login.resetFailTitle'),
          content: friendlyErrorMessage(error, lang.value as 'en' | 'zh') || error.message,
          showCancel: false,
        })
        return
      }
      uni.navigateTo({ url: `/pages/reset-password/index?email=${encodeURIComponent(targetEmail)}` })
    },
  })
}

function onDeleteAccount() {
  uni.showModal({
    title: t('settings.deleteAccountConfirm'),
    content: t('settings.deleteAccountHint'),
    confirmColor: DIALOG_DANGER,
    success: async (res) => {
      if (!res.confirm) return
      uni.showLoading({ title: '...' })
      try {
        // Hard delete (B15): a service-role edge function permanently removes
        // auth.users (cascading all owned rows) + sweeps storage — matching the
        // "cannot be undone" promise. The endpoint derives the target uid ONLY
        // from this access token, never from the body.
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('not_authenticated')
        let endpoint = '/api/auth/delete-account'
        // #ifdef H5
        if (typeof window !== 'undefined' && window.location?.origin) {
          endpoint = window.location.origin + '/api/auth/delete-account'
        }
        // #endif
        // #ifndef H5
        endpoint = `${BASE_URL}/api/auth/delete-account`
        // #endif
        const r = await platformFetch(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: '{}',
        })
        if (!r.ok) throw new Error('delete_failed')
        await signOut()
        uni.hideLoading()
        uni.showToast({
          title: t('settings.deleteAccountDone'),
          icon: 'success',
          duration: 2000,
        })
        setTimeout(() => uni.reLaunch({ url: '/pages/welcome/index' }), 1500)
      } catch (err: any) {
        captureException(err, { tags: { source: 'settings.deleteAccount' } })
        uni.hideLoading()
        uni.showToast({
          title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('settings.deleteAccountFailed'),
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
/*
 * Settings page — refinement settings-row pattern:
 *   · Outer bg = canvas (cream), sections = white cards floating on top
 *   · Rows 48px tall (was 15px padding = ~46px)
 *   · Section gap = 10px for rhythm between groups
 *   · Danger actions get an explicit alert-bg on press for weight
 */
.page {
  min-height: 100vh;
  background: var(--canvas);
  max-width: 480px;
  margin: 0 auto;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.header {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px;
  padding-top: calc(12px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
  background: var(--canvas);
  border-bottom: 0.5px solid var(--border);
}
.back-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.header-title {
  font-family: var(--font-serif);
  font-size: 17px; font-weight: 500;
  color: var(--ink);
  letter-spacing: 0.02em;
}

.section {
  background: var(--surface);
  margin: 10px 12px 0;
  border: 0.5px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-soft);
}
.menu-item {
  display: flex; align-items: center;
  padding: 14px 16px;
  border-bottom: 0.5px solid var(--border-hair);
  cursor: pointer;
  transition: background var(--dur-1, 120ms) var(--ease-std, ease);
  &:last-child { border-bottom: none; }
  &:active { background: var(--paper-2); }
  &.danger { justify-content: center; }
}
.mi-label {
  font-size: 15px;
  color: var(--ink);
  flex: 1;
  letter-spacing: 0.02em;
}
.mi-value {
  font-size: 14px;
  color: var(--ink-quiet);
  margin-right: 8px;
  letter-spacing: 0.02em;
}
.mi-arrow {
  width: 7px; height: 7px; flex-shrink: 0;
  border-top: 1.5px solid var(--ink-faint);
  border-right: 1.5px solid var(--ink-faint);
  transform: rotate(45deg);
}
.danger-text {
  color: var(--danger);
  text-align: center;
  font-weight: 500;
}
</style>
