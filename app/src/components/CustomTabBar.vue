<template>
  <view class="tabbar">
    <view class="tab" @click="go('/pages/index/index')">
      <text :class="['tab-icon', { active: current === 'index' }]">🏠</text>
      <text :class="['tab-label', { active: current === 'index' }]">Home</text>
    </view>
    <view class="tab" @click="go('/pages/messages/index')">
      <text :class="['tab-icon', { active: current === 'messages' }]">💬</text>
      <text :class="['tab-label', { active: current === 'messages' }]">Messages</text>
    </view>
    <view class="tab publish-tab" @click="go('/pages/publish/index')">
      <view class="publish-btn">
        <text class="publish-icon">+</text>
      </view>
    </view>
    <view class="tab" @click="go('/pages/profile/index')">
      <text :class="['tab-icon', { active: current === 'profile' }]">👤</text>
      <text :class="['tab-label', { active: current === 'profile' }]">Profile</text>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{ current: string }>()

function go(url: string) {
  uni.switchTab({ url })
}
</script>

<style scoped>
.tabbar {
  display: none;
  position: fixed;
  bottom: 0; left: 0; right: 0;
  height: 56px;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: rgba(255,255,255,0.95);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-top: 1px solid rgba(0,0,0,0.06);
  z-index: 999;
  align-items: flex-end;
  justify-content: space-around;
}
.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 6px 0 4px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.tab-icon { font-size: 22px; }
.tab-label { font-size: 10px; color: #999; margin-top: 1px; }
.tab-label.active { color: #FF6B35; font-weight: 600; }

.publish-tab { position: relative; }
.publish-btn {
  width: 48px; height: 48px; border-radius: 50%;
  background: linear-gradient(135deg, #FF6B35, #FF8F65);
  display: flex; align-items: center; justify-content: center;
  margin-top: -20px;
  box-shadow: 0 4px 12px rgba(255,107,53,0.35);
  transition: transform 0.15s;
}
.publish-btn:active { transform: scale(0.92); }
.publish-icon { font-size: 28px; color: #fff; font-weight: 300; }

@media (max-width: 767px) {
  .tabbar { display: flex; }
}
</style>
