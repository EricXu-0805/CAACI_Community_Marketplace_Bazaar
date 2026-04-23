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
/* Height = 56px row + bottom safe-area chin. Bumped from 50→56 because
   on short-viewport devices the 24px icon + 2px gap + 12px label stack
   (~38px content) was visually crowding the top edge — users reported
   the icon's upper half appearing to bleed into the page canvas above.
   The extra 6px is split: 2px more top breathing room, 4px more bottom
   chin before the safe-area. The FAB's margin-top: -10px still lifts it
   above the bar, as before. */
/*
 * Bottom tab bar — 米白书院 paper-tone chrome.
 *
 * Background moves from cool white blur (rgba(252,252,253,0.88)) to
 * warm paper blur so the bar blends into the ivory canvas instead of
 * reading as a contrasting surface. Active tab color is brand
 * (terracotta) — ivory_academy's tab-bar.active pattern.
 */
.tabbar {
  display: none; position: fixed; bottom: 0; left: 50%;
  transform: translateX(-50%);
  width: 100%; max-width: 480px;
  height: calc(56px + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: rgba(251, 248, 242, 0.92);
  backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-top: 0.5px solid var(--border);
  z-index: 999; align-items: flex-start; justify-content: space-around;
  box-sizing: border-box;
}
.tab {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 7px 0 4px; cursor: pointer; -webkit-tap-highlight-color: transparent;
  height: 56px;
}
.lbl {
  font-size: 10px;
  color: var(--ink-quiet);
  margin-top: 2px;
  font-weight: 500;
  letter-spacing: 0.04em;
}
.lbl.active { color: var(--brand); font-weight: 600; }

.ico { width: 24px; height: 24px; position: relative; }
.ico-wrap { position: relative; width: 24px; height: 24px; }

/* Icon active tint goes to brand (terracotta) — ivory_academy keeps
   the inactive tone at ink-quiet for the paper feel, and lights up
   active state with brand. */
.ico-home::before {
  content: ''; position: absolute; bottom: 0; left: 2px; right: 2px; height: 12px;
  border: 1.8px solid var(--ink-quiet); border-top: none; border-radius: 0 0 3px 3px;
}
.ico-home::after {
  content: ''; position: absolute; top: 2px; left: 50%; transform: translateX(-50%);
  width: 0; height: 0;
  border-left: 9px solid transparent; border-right: 9px solid transparent;
  border-bottom: 8px solid var(--ink-quiet);
}
.ico-home.active::before { border-color: var(--brand); }
.ico-home.active::after { border-bottom-color: var(--brand); }

.ico-plaza::before {
  content: ''; position: absolute; top: 3px; left: 2px;
  width: 20px; height: 14px; border: 1.8px solid var(--ink-quiet); border-radius: 3px;
}
.ico-plaza::after {
  content: ''; position: absolute; bottom: 3px; left: 7px;
  width: 10px; height: 2px; background: var(--ink-quiet); border-radius: 1px;
  box-shadow: 0 -4px 0 -1px var(--ink-quiet);
}
.ico-plaza.active::before { border-color: var(--brand); }
.ico-plaza.active::after { background: var(--brand); box-shadow: 0 -4px 0 -1px var(--brand); }

.ico-msg::before {
  content: ''; position: absolute; top: 2px; left: 1px;
  width: 20px; height: 15px;
  border: 1.8px solid var(--ink-quiet); border-radius: 10px 10px 10px 2px;
}
.ico-msg.active::before { border-color: var(--brand); }

.ico-me::before {
  content: ''; position: absolute; top: 1px; left: 7px;
  width: 10px; height: 10px; border: 1.8px solid var(--ink-quiet); border-radius: 50%;
}
.ico-me::after {
  content: ''; position: absolute; bottom: 0; left: 2px;
  width: 20px; height: 9px;
  border: 1.8px solid var(--ink-quiet); border-radius: 10px 10px 0 0; border-bottom: none;
}
.ico-me.active::before, .ico-me.active::after { border-color: var(--brand); }

.badge-dot {
  position: absolute; top: -4px; right: -8px;
  min-width: 16px; height: 16px; border-radius: 8px;
  background: var(--danger); padding: 0 4px;
  display: flex; align-items: center; justify-content: center;
  border: 1.5px solid rgba(251, 248, 242, 0.95);
}
.badge-dot text {
  font-size: 9px; color: #fff; font-weight: 700; line-height: 1;
}
.badge-dot-only {
  position: absolute; top: -2px; right: -2px;
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--danger);
  border: 1.5px solid rgba(251, 248, 242, 0.95);
}

/* FAB — terracotta rounded-rect, ivory ring, brand shadow.
   ivory_academy SKILL.md says "rounded rect border-radius: 14px"
   (not a circle — pill-shape FABs read too toy-like in the
   scholarly palette). */
.fab-slot { position: relative; }
.fab {
  width: 40px; height: 40px; border-radius: 14px;
  background: var(--brand);
  display: flex; align-items: center; justify-content: center;
  margin-top: -10px;
  border: 3px solid rgba(251, 248, 242, 0.95);
  box-shadow: var(--shadow-cta);
  transition: transform 0.12s, background 0.15s;
}
.fab:active { transform: scale(0.9); background: var(--brand-deep); }
.fab:active { transform: scale(0.9); }
.fab-plus { width: 16px; height: 16px; position: relative; }
.fab-plus::before, .fab-plus::after {
  content: ''; position: absolute; background: var(--bg-elev-1); border-radius: 1px;
}
.fab-plus::before { width: 16px; height: 2px; top: 7px; left: 0; }
.fab-plus::after { width: 2px; height: 16px; top: 0; left: 7px; }

@media (max-width: 767px) { .tabbar { display: flex; } }
</style>
