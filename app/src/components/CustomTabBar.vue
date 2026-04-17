<template>
  <view class="tabbar">
    <view class="tab" @click="go('/pages/index/index')">
      <view :class="['ico', 'ico-home', { active: current === 'index' }]"></view>
      <text :class="['lbl', { active: current === 'index' }]">{{ t('nav.home') }}</text>
    </view>
    <view class="tab" @click="go('/pages/plaza/index')">
      <view :class="['ico', 'ico-plaza', { active: current === 'plaza' }]"></view>
      <text :class="['lbl', { active: current === 'plaza' }]">{{ t('nav.plaza') }}</text>
    </view>
    <view class="tab fab-slot" @click="go('/pages/publish/index')">
      <view class="fab"><view class="fab-plus"></view></view>
    </view>
    <view class="tab" @click="go('/pages/messages/index')">
      <view class="ico-wrap">
        <view :class="['ico', 'ico-msg', { active: current === 'messages' }]"></view>
        <view v-if="unreadCount > 0" class="badge-dot">
          <text v-if="unreadCount <= 99">{{ unreadCount }}</text>
          <text v-else>99+</text>
        </view>
        <view v-else-if="hasMutedUnread" class="badge-dot-only"></view>
      </view>
      <text :class="['lbl', { active: current === 'messages' }]">{{ t('nav.messages') }}</text>
    </view>
    <view class="tab" @click="go('/pages/profile/index')">
      <view :class="['ico', 'ico-me', { active: current === 'profile' }]"></view>
      <text :class="['lbl', { active: current === 'profile' }]">{{ t('nav.profile') }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { useI18n } from '../composables/useI18n'
import { useUnread } from '../composables/useUnread'

defineProps<{ current: string }>()
const { t } = useI18n()
const { unreadCount, hasMutedUnread } = useUnread()

function go(url: string) { uni.switchTab({ url }) }
</script>

<style scoped>
.tabbar {
  display: none; position: fixed; bottom: 0; left: 0; right: 0;
  height: 50px; padding-bottom: env(safe-area-inset-bottom, 0px);
  background: rgba(252,252,253,0.88);
  backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-top: 0.5px solid rgba(0,0,0,0.08);
  z-index: 999; align-items: flex-end; justify-content: space-around;
}
.tab {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 4px 0 2px; cursor: pointer; -webkit-tap-highlight-color: transparent;
  height: 50px;
}
.lbl { font-size: 10px; color: #8e8e93; margin-top: 2px; font-weight: 500; }
.lbl.active { color: #1a1a1a; }

.ico { width: 24px; height: 24px; position: relative; }
.ico-wrap { position: relative; width: 24px; height: 24px; }

.ico-home::before {
  content: ''; position: absolute; bottom: 0; left: 2px; right: 2px; height: 12px;
  border: 1.8px solid #8e8e93; border-top: none; border-radius: 0 0 3px 3px;
}
.ico-home::after {
  content: ''; position: absolute; top: 2px; left: 50%; transform: translateX(-50%);
  width: 0; height: 0;
  border-left: 9px solid transparent; border-right: 9px solid transparent;
  border-bottom: 8px solid #8e8e93;
}
.ico-home.active::before { border-color: #1a1a1a; }
.ico-home.active::after { border-bottom-color: #1a1a1a; }

.ico-plaza::before {
  content: ''; position: absolute; top: 3px; left: 2px;
  width: 20px; height: 14px; border: 1.8px solid #8e8e93; border-radius: 3px;
}
.ico-plaza::after {
  content: ''; position: absolute; bottom: 3px; left: 7px;
  width: 10px; height: 2px; background: #8e8e93; border-radius: 1px;
  box-shadow: 0 -4px 0 -1px #8e8e93;
}
.ico-plaza.active::before { border-color: #1a1a1a; }
.ico-plaza.active::after { background: #1a1a1a; box-shadow: 0 -4px 0 -1px #1a1a1a; }

.ico-msg::before {
  content: ''; position: absolute; top: 2px; left: 1px;
  width: 20px; height: 15px;
  border: 1.8px solid #8e8e93; border-radius: 10px 10px 10px 2px;
}
.ico-msg.active::before { border-color: #1a1a1a; }

.ico-me::before {
  content: ''; position: absolute; top: 1px; left: 7px;
  width: 10px; height: 10px; border: 1.8px solid #8e8e93; border-radius: 50%;
}
.ico-me::after {
  content: ''; position: absolute; bottom: 0; left: 2px;
  width: 20px; height: 9px;
  border: 1.8px solid #8e8e93; border-radius: 10px 10px 0 0; border-bottom: none;
}
.ico-me.active::before, .ico-me.active::after { border-color: #1a1a1a; }

.badge-dot {
  position: absolute; top: -4px; right: -8px;
  min-width: 16px; height: 16px; border-radius: 8px;
  background: #FF3B30; padding: 0 4px;
  display: flex; align-items: center; justify-content: center;
  border: 1.5px solid rgba(252,252,253,0.88);
}
.badge-dot text {
  font-size: 9px; color: #fff; font-weight: 700; line-height: 1;
}
.badge-dot-only {
  position: absolute; top: -2px; right: -2px;
  width: 8px; height: 8px; border-radius: 50%;
  background: #FF3B30;
  border: 1.5px solid rgba(252,252,253,0.88);
}

.fab-slot { position: relative; }
.fab {
  width: 40px; height: 40px; border-radius: 13px;
  background: #1a1a1a;
  display: flex; align-items: center; justify-content: center;
  margin-top: -10px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  transition: transform 0.12s;
}
.fab:active { transform: scale(0.9); }
.fab-plus { width: 16px; height: 16px; position: relative; }
.fab-plus::before, .fab-plus::after {
  content: ''; position: absolute; background: #fff; border-radius: 1px;
}
.fab-plus::before { width: 16px; height: 2px; top: 7px; left: 0; }
.fab-plus::after { width: 2px; height: 16px; top: 0; left: 7px; }

@media (max-width: 767px) { .tabbar { display: flex; } }
</style>
