<template>
  <view class="desktop-nav">
    <view class="desktop-nav-inner">
      <text class="desktop-logo" @click="go('/pages/index/index')">{{ t('app.name') }}</text>
      <view class="desktop-nav-links">
        <text :class="['nav-link', { active: current === 'index' }]" @click="go('/pages/index/index')">{{ t('nav.home') }}</text>
        <text :class="['nav-link', { active: current === 'plaza' }]" @click="go('/pages/plaza/index')">{{ t('nav.plaza') }}</text>
        <text :class="['nav-link', { active: current === 'publish' }]" @click="go('/pages/publish/index')">{{ t('nav.post') }}</text>
        <view class="nav-link-wrap" @click="go('/pages/messages/index')">
          <text :class="['nav-link', { active: current === 'messages' }]">{{ t('nav.messages') }}</text>
          <view v-if="unreadCount > 0" class="nav-badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</view>
        </view>
        <text :class="['nav-link', { active: current === 'profile' }]" @click="go('/pages/profile/index')">{{ t('nav.profile') }}</text>
      </view>
      <view class="desktop-right">
        <text class="lang-btn" @click="toggleLang">{{ t('lang.switch') }}</text>
        <view class="nav-loc-wrap">
          <view class="nav-loc-dot"></view>
          <text class="nav-location">{{ t('loc.uiuc') }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { useI18n } from '../composables/useI18n'
import { useUnread } from '../composables/useUnread'
defineProps<{ current: string }>()
const { t, toggleLang } = useI18n()
const { unreadCount } = useUnread()
function go(url: string) { uni.switchTab({ url }) }
</script>

<style scoped>
.desktop-nav { display: block; position: sticky; top: 0; z-index: 200; background: var(--bg-elev-1); border-bottom: 1px solid #f0f0f0; }
.desktop-nav-inner { max-width: 1120px; margin: 0 auto; display: flex; align-items: center; padding: 0 24px; height: 56px; gap: 24px; }
.desktop-logo { font-size: 17px; font-weight: 700; color: var(--text-primary); white-space: nowrap; cursor: pointer; letter-spacing: -0.02em; }
.desktop-nav-links { display: flex; gap: 4px; }
.nav-link { font-size: 15px; color: var(--ink-quiet); padding: 8px 16px; border-radius: 8px; cursor: pointer; transition: all 0.15s; font-weight: 500; }
.nav-link:hover { background: var(--bg-subtle); color: var(--ink); }
.nav-link.active { color: var(--text-primary); font-weight: 600; background: var(--bg-subtle); }
.desktop-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.nav-loc-wrap { display: flex; align-items: center; gap: 5px; }
.nav-loc-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent-action); flex-shrink: 0; }
.nav-location { font-size: 13px; color: var(--ink-quiet); }
.lang-btn { font-size: 11px; color: var(--text-muted); padding: 3px 9px; border: 1px solid var(--border-strong); border-radius: 6px; cursor: pointer; font-weight: 500; }
.lang-btn:active { background: var(--bg-subtle); }
.nav-link-wrap { position: relative; display: inline-flex; align-items: center; cursor: pointer; }
.nav-badge {
  position: absolute; top: -2px; right: -10px;
  min-width: 16px; height: 16px; border-radius: 8px;
  background: var(--accent-danger); color: #fff; font-size: 10px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; padding: 0 4px;
}
@media (max-width: 767px) { .desktop-nav { display: none; } }
</style>
