<template>
  <!--
    Tab bar — UIUC Fusion refinement pass.

    Three refinements from the design doc explicitly fixing 塑料感:
      1. Paper-parchment bg (#F6F0DF), not white blur — echoes canvas.
      2. Active indicator = orange dot above the icon, NOT a color
         shift on the icon itself. The icon stays --ink-quiet when
         inactive and --ink when active; the dot carries the state.
      3. FAB sits on -14px margin with a 3px parchment-colored ring
         so it reads as embedded IN the paper, not glued on top.
  -->
  <view class="tabbar">
    <view :class="['tab', { active: current === 'index' }]" @click="go('/pages/index/index')">
      <view v-if="current === 'index'" class="tab-dot"></view>
      <view :class="['ico', 'ico-home', { active: current === 'index' }]"></view>
      <text :class="['lbl', { active: current === 'index' }]">{{ t('nav.home') }}</text>
    </view>
    <view :class="['tab', { active: current === 'plaza' }]" @click="go('/pages/plaza/index')">
      <view v-if="current === 'plaza'" class="tab-dot"></view>
      <view :class="['ico', 'ico-plaza', { active: current === 'plaza' }]"></view>
      <text :class="['lbl', { active: current === 'plaza' }]">{{ t('nav.plaza') }}</text>
    </view>
    <!--
      FAB tab — aligned into the same icon + label rhythm as the
      other 4 tabs. The + button lifts ~8px above (smaller overshoot
      than the old -14px) and has a label underneath so the whole
      bar reads as one horizontal row instead of "4 tabs + a stray
      orange button sticking out".
    -->
    <view class="tab fab-slot" @click="go('/pages/publish/index')">
      <view class="fab"><view class="fab-plus"></view></view>
      <text class="lbl fab-lbl">{{ t('nav.post') }}</text>
    </view>
    <view :class="['tab', { active: current === 'messages' }]" @click="go('/pages/messages/index')">
      <view v-if="current === 'messages'" class="tab-dot"></view>
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
    <view :class="['tab', { active: current === 'profile' }]" @click="go('/pages/profile/index')">
      <view v-if="current === 'profile'" class="tab-dot"></view>
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
 * Bottom tab bar — UIUC Fusion refinement pass.
 *
 * Flat parchment bg (#F6F0DF via --parchment). No blur — blur was
 * part of the "plastic" feel. Icons stay inky in both states; the
 * 4×4 orange dot above the active tab is the state indicator.
 * Labels use 0.06em letter-spacing to breathe.
 */
.tabbar {
  display: none; position: fixed; bottom: 0; left: 50%;
  transform: translateX(-50%);
  width: 100%; max-width: 480px;
  height: calc(62px + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: var(--parchment);
  border-top: 0.5px solid var(--border);
  z-index: 999; align-items: flex-start; justify-content: space-around;
  box-sizing: border-box;
}
.tab {
  position: relative;
  flex: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
  padding: 10px 0 6px;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
  height: 62px;
  transition: transform var(--dur-1, 120ms) var(--ease-std, ease);
  &:active { transform: scale(0.94); }
}
.tab-dot {
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  width: 4px; height: 4px;
  border-radius: 50%;
  background: var(--brand);
  animation: dot-pulse var(--dur-3, 360ms) var(--ease-warm, ease-out);
}
@keyframes dot-pulse {
  from { transform: translateX(-50%) scale(0); opacity: 0; }
  to   { transform: translateX(-50%) scale(1); opacity: 1; }
}
.lbl {
  font-size: 10px;
  color: var(--ink-quiet);
  margin-top: 4px;
  font-weight: 400;
  letter-spacing: 0.06em;
  transition: color var(--dur-1, 120ms) var(--ease-std, ease);
}
.lbl.active { color: var(--ink); font-weight: 500; }

.ico { width: 24px; height: 24px; position: relative; }
.ico-wrap { position: relative; width: 24px; height: 24px; }

/*
 * Icons — 20px line weight 1.6, lean and restrained. Active state
 * shifts stroke from ink-faint → ink (navy), NOT to brand — the
 * orange is carried by the .tab-dot above. Keeps the bar from
 * looking "lit up" in 3 places when only 1 tab is selected.
 */
.ico { width: 20px; height: 20px; }
.ico-wrap { width: 20px; height: 20px; }

.ico-home::before {
  content: ''; position: absolute; bottom: 0; left: 2px; right: 2px; height: 10px;
  border: 1.6px solid var(--ink-faint); border-top: none; border-radius: 0 0 3px 3px;
}
.ico-home::after {
  content: ''; position: absolute; top: 2px; left: 50%; transform: translateX(-50%);
  width: 0; height: 0;
  border-left: 7px solid transparent; border-right: 7px solid transparent;
  border-bottom: 7px solid var(--ink-faint);
}
.ico-home.active::before { border-color: var(--ink); }
.ico-home.active::after { border-bottom-color: var(--ink); }

.ico-plaza::before {
  content: ''; position: absolute; top: 3px; left: 1px;
  width: 18px; height: 14px; border: 1.6px solid var(--ink-faint); border-radius: 3px;
}
.ico-plaza::after {
  content: ''; position: absolute; bottom: 5px; left: 6px;
  width: 8px; height: 1.5px; background: var(--ink-faint); border-radius: 1px;
  box-shadow: 0 -4px 0 -0.5px var(--ink-faint);
}
.ico-plaza.active::before { border-color: var(--ink); }
.ico-plaza.active::after { background: var(--ink); box-shadow: 0 -4px 0 -0.5px var(--ink); }

.ico-msg::before {
  content: ''; position: absolute; top: 2px; left: 1px;
  width: 18px; height: 14px;
  border: 1.6px solid var(--ink-faint); border-radius: 8px 8px 8px 2px;
}
.ico-msg.active::before { border-color: var(--ink); }

.ico-me::before {
  content: ''; position: absolute; top: 1px; left: 6px;
  width: 8px; height: 8px; border: 1.6px solid var(--ink-faint); border-radius: 50%;
}
.ico-me::after {
  content: ''; position: absolute; bottom: 0; left: 1px;
  width: 18px; height: 8px;
  border: 1.6px solid var(--ink-faint); border-radius: 9px 9px 0 0; border-bottom: none;
}
.ico-me.active::before, .ico-me.active::after { border-color: var(--ink); }

.badge-dot {
  position: absolute; top: -4px; right: -8px;
  min-width: 15px; height: 15px; border-radius: 999px;
  background: var(--brand); padding: 0 4px;
  display: flex; align-items: center; justify-content: center;
  border: 1.5px solid var(--parchment);
}
.badge-dot text {
  font-size: 9px; color: #fff; font-weight: 700; line-height: 1;
  font-family: var(--font-mono, 'SF Mono', Menlo, monospace);
}
.badge-dot-only {
  position: absolute; top: -2px; right: -2px;
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--brand);
  border: 1.5px solid var(--parchment);
}

/*
 * FAB — Illini orange rounded square with a 3px parchment ring
 * (same color as tab bar, so it reads as pressed INTO the paper).
 *
 * Sized + positioned to MATCH the other 4 tabs' visual rhythm:
 *   · 40×40px (was 46, shrunk to match the 20px line icon footprint
 *     plus ring padding — same total footprint as a regular tab icon)
 *   · margin-top -6px (was -14, now protrudes a gentle 6px instead
 *     of dominating the bar like a logo button)
 *   · Label "发布 / Post" sits below the FAB at the same y-axis as
 *     the other 4 tab labels, so all 5 read as one horizontal row.
 */
.fab-slot {
  position: relative;
  display: flex; flex-direction: column; align-items: center;
  padding: 10px 0 6px;
}
.fab {
  width: 40px; height: 40px; border-radius: 12px;
  background: var(--brand);
  display: flex; align-items: center; justify-content: center;
  margin-top: -6px;
  border: 3px solid var(--parchment);
  box-shadow: var(--shadow-cta);
  transition: transform var(--dur-1, 120ms) var(--ease-std, ease),
              background var(--dur-1, 120ms) var(--ease-std, ease);
}
.fab-slot:active .fab { transform: scale(0.92); background: var(--brand-deep); }
.fab-plus { width: 14px; height: 14px; position: relative; }
.fab-plus::before, .fab-plus::after {
  content: ''; position: absolute; background: #fff; border-radius: 1px;
}
.fab-plus::before { width: 14px; height: 2px; top: 6px; left: 0; }
.fab-plus::after  { width: 2px; height: 14px; top: 0; left: 6px; }
.fab-lbl {
  margin-top: 4px;
  font-size: 10px;
  color: var(--ink-quiet);
  letter-spacing: 0.06em;
  line-height: 1;
}

@media (max-width: 767px) { .tabbar { display: flex; } }
</style>
