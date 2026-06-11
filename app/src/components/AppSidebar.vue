<template>
  <!--
    AppSidebar — desktop / iPad left rail (≥768px). Replaces the old top
    DesktopNav with the kit's `ima-sidebar` shell (adaptive.css). Hidden
    on phones via CSS (`display:none` until the 768px breakpoint), where
    CustomTabBar owns navigation. position:fixed so it's independent of
    each page's scroll/DOM — pages just reserve `padding-left:var(--sidebar-w)`
    on desktop via the global .has-sidebar contract in App.vue.

    Carries brand + primary nav (with unread badge) + Post CTA + me-card +
    theme/lang toggles, so on desktop every tab page can switch theme/lang
    (most page headers have no toggle of their own).
  -->
  <view class="app-sidebar">
    <view class="asb-inner">
      <view class="asb-brand u-press" role="button" :aria-label="t('app.name')" @click="go('/pages/index/index')">
        <image class="asb-logo" :src="logoSrc" mode="aspectFit" :alt="t('app.name')" />
        <view class="asb-word">
          <text class="asb-name">{{ t('app.name') }}</text>
          <text class="asb-eyebrow">{{ brandEyebrow }}</text>
        </view>
      </view>

      <view class="asb-nav">
        <view :class="['asb-item', { on: current === 'index' }]" role="button" :aria-current="current === 'index' ? 'page' : undefined" @click="go('/pages/index/index')">
          <UIcon name="home" size="sm" :weight="current === 'index' ? 'filled' : 'regular'" :color="current === 'index' ? 'brand' : 'ink-soft'" />
          <text class="asb-label">{{ t('nav.home') }}</text>
        </view>
        <view :class="['asb-item', { on: current === 'plaza' }]" role="button" :aria-current="current === 'plaza' ? 'page' : undefined" @click="go('/pages/plaza/index')">
          <UIcon name="plaza" size="sm" :weight="current === 'plaza' ? 'filled' : 'regular'" :color="current === 'plaza' ? 'brand' : 'ink-soft'" />
          <text class="asb-label">{{ t('nav.plaza') }}</text>
        </view>
        <view :class="['asb-item', { on: current === 'messages' }]" role="button" :aria-current="current === 'messages' ? 'page' : undefined" @click="go('/pages/messages/index')">
          <UIcon name="messages" size="sm" :weight="current === 'messages' ? 'filled' : 'regular'" :color="current === 'messages' ? 'brand' : 'ink-soft'" />
          <text class="asb-label">{{ t('nav.messages') }}</text>
          <view v-if="unreadCount > 0" class="asb-badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</view>
        </view>
        <view :class="['asb-item', { on: current === 'profile' }]" role="button" :aria-current="current === 'profile' ? 'page' : undefined" @click="go('/pages/profile/index')">
          <UIcon name="profile" size="sm" :weight="current === 'profile' ? 'filled' : 'regular'" :color="current === 'profile' ? 'brand' : 'ink-soft'" />
          <text class="asb-label">{{ t('nav.profile') }}</text>
        </view>
      </view>

      <view class="asb-foot">
        <view class="asb-post u-press" role="button" :aria-label="t('nav.post')" @click="go('/pages/publish/index')">
          <UIcon name="plus" size="sm" color="#fff" />
          <text class="asb-post-label">{{ t('nav.post') }}</text>
        </view>

        <view class="asb-me u-press" role="button" :aria-label="t('nav.profile')" @click="go('/pages/profile/index')">
          <image class="asb-ava" :src="avatarSrc" mode="aspectFill" :alt="meName" />
          <text class="asb-me-nm">{{ meName }}</text>
        </view>

        <view class="asb-pills">
          <view class="asb-pill u-press" role="button" :aria-label="isDark ? t('a11y.themeLight') : t('a11y.themeDark')" @click="toggleTheme">
            <UIcon :name="isDark ? 'moon' : 'sun'" size="xs" color="ink-soft" />
            <text class="asb-pill-tx">{{ themeLabel }}</text>
          </view>
          <view class="asb-pill u-press" role="button" :aria-label="t('a11y.langToggle')" @click="toggleLang">
            <text :class="['asb-lang', { on: lang === 'zh' }]">中</text>
            <text class="asb-lang-sep">|</text>
            <text :class="['asb-lang', { on: lang === 'en' }]">EN</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import UIcon from './UIcon.vue'
import { useI18n } from '../composables/useI18n'
import { useUnread } from '../composables/useUnread'
import { useTheme } from '../composables/useTheme'
import { useAuth } from '../composables/useAuth'

defineProps<{ current: string }>()

const { t, lang, toggleLang } = useI18n()
const { unreadCount } = useUnread()
const { isDark, setPref } = useTheme()
const { currentUser } = useAuth()

const logoSrc = computed(() => (isDark.value ? '/static/logo-mark-dark.svg' : '/static/logo-mark.svg'))
const brandEyebrow = computed(() => (lang.value === 'zh' ? 'ILLINI MARKET' : '香槟集市 · CAACI'))
const themeLabel = computed(() =>
  isDark.value ? (lang.value === 'zh' ? '暗' : 'Dark') : (lang.value === 'zh' ? '亮' : 'Light'),
)
const avatarSrc = computed(() =>
  currentUser.value?.avatar_url || (isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'),
)
const meName = computed(() => currentUser.value?.nickname || t('nav.profile'))

function go(url: string) {
  // The 5 shell destinations are all tabBar pages.
  uni.switchTab({ url })
}
function toggleTheme() {
  setPref(isDark.value ? 'light' : 'dark')
}
</script>

<style scoped>
/* Phone-first: hidden until the iPad/Mac breakpoint. */
.app-sidebar { display: none; }

@media (min-width: 768px) {
  .app-sidebar {
    display: block;
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: var(--sidebar-w, 240px);
    background: var(--surface);
    border-right: 1px solid var(--border);
    z-index: 300;
    box-sizing: border-box;
  }
  .asb-inner {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 18px 12px 16px;
    box-sizing: border-box;
    overflow-y: auto;  /* short viewports (iPad landscape): rail scrolls, foot never clips */
  }

  .asb-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 10px 18px;
    cursor: pointer;
  }
  .asb-logo { width: 34px; height: 34px; border-radius: 9px; flex: none; }
  .asb-word { display: flex; flex-direction: column; min-width: 0; }
  .asb-name {
    font-family: var(--font-serif);
    font-size: 17px; font-weight: 600; color: var(--ink);
    letter-spacing: -0.01em; line-height: 1.15;
  }
  .asb-eyebrow {
    font-family: var(--font-mono);
    font-size: 9.5px; color: var(--ink-quiet);
    letter-spacing: 0.18em; margin-top: 2px;
  }

  .asb-nav { display: flex; flex-direction: column; gap: 2px; }
  .asb-item {
    display: flex; align-items: center; gap: 11px;
    height: 42px; padding: 0 12px; border-radius: 10px;
    background: transparent; color: var(--ink-soft); cursor: pointer;
    font-family: var(--font-hei); font-size: 14px; font-weight: 500;
    box-sizing: border-box;
  }
  .asb-item:hover:not(.on) { background: var(--surface-alt); }
  .asb-item.on { background: var(--brand-soft); color: var(--brand); font-weight: 600; }
  .asb-label { flex: 1; min-width: 0; }
  .asb-badge {
    margin-left: auto; min-width: 18px; height: 18px; border-radius: 999px;
    background: var(--brand); color: #fff;
    font-family: var(--font-mono); font-size: 11px; font-weight: 600;
    display: flex; align-items: center; justify-content: center; padding: 0 5px;
  }

  .asb-foot { margin-top: auto; display: flex; flex-direction: column; gap: 10px; padding-top: 14px; }
  .asb-post {
    display: flex; align-items: center; justify-content: center;
    height: 44px; border-radius: 12px; cursor: pointer;
    background: var(--brand); color: var(--ink-inverse);
    font-family: var(--font-hei); font-size: 14px; font-weight: 600;
    box-shadow: var(--shadow-cta);
  }
  /* Optically center the LABEL, not the icon+label group. A negative left
     margin equal to (icon width + gap) cancels the icon's contribution to the
     flex centering, so "发布 / Post" sits dead-center and the + reads as a
     left adornment. Group-centering left the label visibly right-of-center
     (the icon's left weight is what read as "not centered"). Width-independent. */
  .asb-post :deep(.u-icon) { margin-left: -26px; margin-right: 6px; }
  .asb-post-label { color: #fff; }
  .asb-me {
    display: flex; align-items: center; gap: 10px; padding: 4px;
    border-radius: 10px; cursor: pointer;
  }
  .asb-me:hover { background: var(--surface-alt); }
  .asb-ava {
    width: 32px; height: 32px; border-radius: 50%; flex: none;
    background: var(--surface-alt); overflow: hidden;
  }
  .asb-me-nm {
    font-family: var(--font-hei); font-size: 13px; font-weight: 600;
    color: var(--ink); flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .asb-pills { display: flex; gap: 8px; }
  .asb-pill {
    flex: 1; height: 32px; border: 1px solid var(--border-strong); border-radius: 999px;
    background: var(--surface-alt); color: var(--ink-soft); cursor: pointer;
    font-family: var(--font-hei); font-size: 12px; font-weight: 500;
    display: flex; align-items: center; justify-content: center; gap: 6px;
  }
  .asb-pill:hover { background: var(--bg-inset); }
  .asb-pill-tx { color: var(--ink-soft); }
  .asb-lang { color: var(--ink-faint); }
  .asb-lang.on { color: var(--ink); font-weight: 600; }
  .asb-lang-sep { color: var(--ink-faint); }

  /* Mac (wide) — tighten the rail a touch to match the kit's 232px. */
  @media (min-width: 1180px) {
    .asb-item { height: 38px; }
  }
}
</style>
