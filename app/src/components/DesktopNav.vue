<template>
  <view class="desktop-nav">
    <view class="desktop-nav-inner">
      <text class="desktop-logo" @click="go('/pages/index/index')">🏪 {{ t('app.name') }}</text>
      <view class="desktop-nav-links">
        <text :class="['nav-link', { active: current === 'index' }]" @click="go('/pages/index/index')">{{ t('nav.home') }}</text>
        <text :class="['nav-link', { active: current === 'publish' }]" @click="go('/pages/publish/index')">{{ t('nav.post') }}</text>
        <text :class="['nav-link', { active: current === 'messages' }]" @click="go('/pages/messages/index')">{{ t('nav.messages') }}</text>
        <text :class="['nav-link', { active: current === 'profile' }]" @click="go('/pages/profile/index')">{{ t('nav.profile') }}</text>
      </view>
      <view class="desktop-right">
        <text class="lang-btn" @click="toggleLang">{{ t('lang.switch') }}</text>
        <text class="nav-location">📍 {{ t('loc.uiuc') }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { useI18n } from '../composables/useI18n'
defineProps<{ current: string }>()
const { t, toggleLang } = useI18n()
function go(url: string) { uni.switchTab({ url }) }
</script>

<style scoped>
.desktop-nav { display: block; position: sticky; top: 0; z-index: 200; background: #fff; border-bottom: 1px solid #f0f0f0; }
.desktop-nav-inner { max-width: 1120px; margin: 0 auto; display: flex; align-items: center; padding: 0 24px; height: 56px; gap: 24px; }
.desktop-logo { font-size: 18px; font-weight: 800; color: #FF6B35; white-space: nowrap; cursor: pointer; }
.desktop-nav-links { display: flex; gap: 4px; }
.nav-link { font-size: 15px; color: #86868b; padding: 8px 16px; border-radius: 8px; cursor: pointer; transition: all 0.15s; font-weight: 500; }
.nav-link:hover { background: #f5f5f7; color: #1d1d1f; }
.nav-link.active { color: #FF6B35; font-weight: 600; background: #FFF0E8; }
.desktop-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.nav-location { font-size: 13px; color: #86868b; }
.lang-btn { font-size: 12px; color: #FF6B35; padding: 4px 10px; border: 1px solid #FF6B35; border-radius: 10px; cursor: pointer; font-weight: 600; }
.lang-btn:active { background: #FFF0E8; }
@media (max-width: 767px) { .desktop-nav { display: none; } }
</style>
