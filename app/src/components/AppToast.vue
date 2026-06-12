<!--
  AppToast — the in-app notification banner.

  H5-only by construction: useAppToast mounts this onto a body-level <div>
  through a standalone createApp() (see useAppToast.ts for why App.vue can't
  host it). Because the mount is a separate Vue app instance, uni-app's global
  <view>/<text> components are NOT registered here — so this template uses raw
  HTML elements, which is correct and renders identically on H5.

  Styling rides the theme tokens on <html data-theme>, so the banner flips
  light/dark with the rest of the app for free.
-->
<template>
  <div class="at-wrap" aria-live="polite">
    <transition-group name="at">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="at-card"
        role="button"
        tabindex="0"
        @click="onTap(t)"
        @keydown.enter="onTap(t)"
        @mouseenter="pause(t.id)"
        @mouseleave="resume(t.id)"
      >
        <div class="at-icon" :class="'k-' + t.kind"><span>{{ glyph(t.kind) }}</span></div>
        <div class="at-text">
          <span class="at-title">{{ t.title }}</span>
          <span v-if="t.body" class="at-sub">{{ t.body }}</span>
        </div>
        <div class="at-close" role="button" :aria-label="i18nT('a11y.close')" @click.stop="dismissToast(t.id)">
          <span class="at-x"></span>
          <span class="at-x at-x2"></span>
        </div>
      </div>
    </transition-group>
  </div>
</template>

<script setup lang="ts">
import { watch, onUnmounted } from 'vue'
import { useAppToast, type ToastItem, type ToastKind } from '../composables/useAppToast'
import { useI18n } from '../composables/useI18n'

const { toasts, dismissToast } = useAppToast()
/* Named i18nT because the v-for loop variable is `t` — the usual name would
   be shadowed inside the template. */
const { t: i18nT } = useI18n()

const DURATION = 5200
const GLYPHS: Record<ToastKind, string> = {
  offer: '$',
  meetup: '\u{1F4CD}',
  sold: '✓',
  price_drop: '↓',
  system: '\u{1F514}',
  message: '\u{1F4AC}',
}
function glyph(k: ToastKind) { return GLYPHS[k] || GLYPHS.system }

/*
 * Per-toast auto-dismiss. The store can prepend a new toast at any time, so we
 * reconcile timers off a watcher: schedule any id we haven't seen, and drop
 * timers for ids that have left the array. Hovering a card pauses its timer
 * (desktop), leaving resumes it with a fresh full duration.
 */
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function schedule(id: string) {
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(() => { timers.delete(id); dismissToast(id) }, DURATION))
}
function pause(id: string) {
  const h = timers.get(id)
  if (h) { clearTimeout(h); timers.set(id, undefined as any) }
}
function resume(id: string) { schedule(id) }

watch(
  toasts,
  (list) => {
    const live = new Set(list.map(t => t.id))
    for (const id of timers.keys()) {
      if (!live.has(id)) { clearTimeout(timers.get(id)); timers.delete(id) }
    }
    for (const t of list) {
      if (!timers.has(t.id)) schedule(t.id)
    }
  },
  { deep: true, immediate: true },
)

onUnmounted(() => {
  for (const h of timers.values()) clearTimeout(h)
  timers.clear()
})

function onTap(t: ToastItem) {
  try { t.onTap?.() } catch { /* side effect is best-effort */ }
  if (t.route) {
    const url = t.route
    if (t.switchTab) {
      uni.switchTab({ url })
    } else {
      // navigateTo fails silently once the page stack hits uni-app's depth cap
      // (e.g. tapping several detail toasts in a row); fall back to redirectTo
      // so the tap always lands somewhere instead of vanishing into a no-op.
      uni.navigateTo({ url, fail: () => { uni.redirectTo({ url }) } })
    }
  }
  dismissToast(t.id)
}
</script>

<style scoped>
.at-wrap {
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + 10px);
  left: 50%;
  transform: translateX(-50%);
  width: min(440px, calc(100vw - 24px));
  z-index: 5000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.at-card {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 12px 12px 12px;
  background: var(--bg-elev-1, #fff);
  border: 0.5px solid var(--line-hair, rgba(0, 0, 0, 0.06));
  border-radius: var(--radius-lg, 16px);
  box-shadow: var(--shadow-float, 0 12px 32px rgba(40, 30, 20, 0.18));
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform var(--dur-2, 200ms) var(--ease-warm, cubic-bezier(0.2, 0.8, 0.2, 1));
}
.at-card:active { transform: scale(0.98); }

.at-icon {
  flex: none;
  width: 38px; height: 38px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 17px; font-weight: 700; line-height: 1;
  background: #EDE5D8; color: var(--ink, #2A2521);
}
.at-icon.k-offer  { background: #DCEBE0; color: #2F6B4F; }
.at-icon.k-sold   { background: #DCEBE0; color: #2F6B4F; }
.at-icon.k-meetup { background: #DCE4F3; color: #2A4D8B; }
.at-icon.k-price_drop { background: #F5D9CE; color: #A03A24; }
.at-icon.k-message { background: #DCE4F3; color: #2A4D8B; }

.at-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.at-title {
  font-size: 14px; font-weight: 600; color: var(--ink, #2A2521);
  line-height: 1.3;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.at-sub {
  font-size: 12.5px; color: var(--text-muted, #8B8478);
  line-height: 1.35;
  overflow: hidden; text-overflow: ellipsis;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  white-space: normal;
}

.at-close {
  flex: none;
  width: 26px; height: 26px;
  border-radius: 50%;
  position: relative;
  display: flex; align-items: center; justify-content: center;
  margin-right: 2px;
}
.at-close:active { background: var(--bg-subtle, rgba(0, 0, 0, 0.05)); }
.at-x {
  position: absolute;
  width: 12px; height: 1.6px; border-radius: 1px;
  background: var(--ink-quiet, #8B8478);
  transform: rotate(45deg);
}
.at-x2 { transform: rotate(-45deg); }

/* Spring entrance from the top; leave fades up. */
.at-enter-active { transition: transform var(--dur-3, 360ms) var(--ease-warm, cubic-bezier(0.2, 0.8, 0.2, 1)), opacity var(--dur-3, 360ms) ease; }
.at-leave-active { transition: transform var(--dur-2, 200ms) ease, opacity var(--dur-2, 200ms) ease; position: absolute; left: 0; right: 0; }
.at-enter-from { opacity: 0; transform: translateY(-14px) scale(0.97); }
.at-leave-to { opacity: 0; transform: translateY(-10px); }
.at-move { transition: transform var(--dur-3, 360ms) var(--ease-warm, cubic-bezier(0.2, 0.8, 0.2, 1)); }

@media (prefers-reduced-motion: reduce) {
  .at-enter-active, .at-leave-active, .at-move, .at-card { transition: none; }
  .at-enter-from { transform: none; }
}
</style>
