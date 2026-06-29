<template>
  <view v-if="visible" class="pdm-mask" @click="onMaskClick">
    <view
      class="pdm-panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="bodyId"
      @click.stop
    >
      <text :id="titleId" class="pdm-title t-h2">{{ t('publish.permissionModalTitle') }}</text>
      <text :id="bodyId" class="pdm-body t-body">{{ t('publish.permissionModalBody') }}</text>

      <view class="pdm-actions">
        <!-- "Open Settings" only where it can actually deep-link: mp-weixin's
             uni.openSetting(). On H5 there is NO API to open browser/OS
             permission settings, so the button would just dismiss — a
             "clicked it, nothing happened" trust hit. The body text already
             gives the manual iOS path, so H5 shows a single honest "Got it". -->
        <!-- #ifdef MP-WEIXIN -->
        <UButton variant="primary" block class="pdm-btn" @click="onOpenSettings">
          {{ t('publish.permissionModalOpenSettings') }}
        </UButton>
        <UButton variant="ghost" block class="pdm-btn" @click="onDismiss">
          {{ t('publish.permissionModalDismiss') }}
        </UButton>
        <!-- #endif -->
        <!-- #ifndef MP-WEIXIN -->
        <UButton variant="primary" block class="pdm-btn" @click="onDismiss">
          {{ t('publish.permissionModalDismiss') }}
        </UButton>
        <!-- #endif -->
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, watch, onUnmounted } from 'vue'
import { useI18n } from '../composables/useI18n'
import UButton from './UButton.vue'

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

/*
 * Stable IDs for aria-labelledby / aria-describedby. Math.random
 * keeps them unique if multiple modal instances ever co-exist on
 * a page (not a current use case, but cheap insurance). The IDs
 * read like `pdm-title-x9k2` — short enough to read in devtools.
 */
const uid = Math.random().toString(36).slice(2, 6)
const titleId = computed(() => `pdm-title-${uid}`)
const bodyId = computed(() => `pdm-body-${uid}`)

function onMaskClick() {
  emit('close')
}

function onDismiss() {
  emit('close')
}

/*
 * "Open Settings" handler — platform-conditional.
 *
 *   mp-weixin: uni.openSetting() opens WeChat's native settings
 *     scope page. After return, the user can retry the location
 *     button and the next getLocation call sees the new permission
 *     state.
 *
 *   H5 (iOS Safari / Android Chrome / desktop): there is no public
 *     API to deep-link into browser permission settings. The CTA
 *     here is honest: we emit close, and the body text told the
 *     user the manual Settings path (Safari → Settings → Websites
 *     → Location). Not pretending to open settings prevents the
 *     "I clicked it but nothing happened" trust hit.
 */
function onOpenSettings() {
  // #ifdef MP-WEIXIN
  if (typeof uni !== 'undefined' && typeof uni.openSetting === 'function') {
    uni.openSetting({
      complete: () => emit('close'),
    })
    return
  }
  // #endif
  emit('close')
}

/*
 * H5 ESC-to-close. mp-weixin has no document keyboard model so
 * this is wrapped in a typeof-document guard and a runtime check
 * — same defensive pattern as useLocation's navigator.permissions
 * preflight (added in PR #23 Phase 1a).
 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
  }
}

watch(
  () => props.visible,
  (next) => {
    if (typeof document === 'undefined') return
    if (next) {
      document.addEventListener('keydown', onKeydown)
    } else {
      document.removeEventListener('keydown', onKeydown)
    }
  },
)

onUnmounted(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('keydown', onKeydown)
  }
})
</script>

<style lang="scss" scoped>
/*
  Mask backdrop: SKILL.md rule 5 carve-out — modal masks are an
  explicit exception to the M2 warm-ink sweep. rgba(0,0,0,0.35) is
  the canonical mask alpha used in detail/index.vue:1124, saved-
  searches:239, index/index.vue:925 (all aligned by M2 audit).
  Slightly lighter than the bottom-sheet 0.4 because a centered
  modal floats over content with explicit anchoring; the lower alpha
  reduces visual weight without sacrificing the "I am blocking" cue.

  Mount strategy: v-if + pure CSS @keyframes (no Vue <Transition>
  wrapper). uni-app's Vue 3 build does polyfill Transition for
  mp-weixin but descendant-selector transition classes are flaky on
  WXSS. Plain animation: works identically on both targets and
  needs no polyfill — see @keyframes pdmMaskIn / pdmPanelIn below.
*/
.pdm-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  animation: pdmMaskIn var(--dur-3, 360ms) var(--ease-warm, cubic-bezier(0.2, 0.8, 0.2, 1)) both;
}

/*
  Panel sits at z-1001 (above mask, below plaza composer at 1100
  per project z-index convention). Surface uses the v5 token chain
  so dark mode + prefers-color-scheme both flip via App.vue's
  [data-theme] and @media block without any duplicate rules here.
  --shadow-float is the M1-installed heavy float used for elevated
  surfaces (vs --shadow-soft for resting cards).
*/
.pdm-panel {
  position: relative;
  z-index: 1001;
  background: var(--surface);
  border-radius: 16px;
  padding: 28px 24px 20px;
  max-width: 320px;
  width: 100%;
  box-shadow: var(--shadow-float);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  animation: pdmPanelIn var(--dur-3, 360ms) var(--ease-warm, cubic-bezier(0.2, 0.8, 0.2, 1)) both;
}

.pdm-title {
  display: block;
  color: var(--ink);
  margin-bottom: 12px;
}

.pdm-body {
  display: block;
  color: var(--ink-soft);
  line-height: 1.55;
  margin-bottom: 22px;
}

.pdm-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/*
  Action buttons are <UButton variant=primary/ghost block> — the
  component owns fill, text, radius, font, sizing (md = 44px, the
  iOS 44pt target), and flex centering. The modal adds only layout:
  the .pdm-btn class lands on the component root, so the desktop
  `flex: 1` row split below applies to it directly.
*/

/*
  Enter animations — pdmMaskIn fades the backdrop, pdmPanelIn fades
  + scales the panel from 0.96 so it materializes with a subtle
  "settle in" gesture. --dur-3 (360ms) + --ease-warm match the M1-
  standardized motion language. No exit animation (v-if removes the
  DOM cleanly) — modal close is intentionally crisper than open per
  iOS HIG modal dismissal feel.
*/
@keyframes pdmMaskIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes pdmPanelIn {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

@media (min-width: 768px) {
  .pdm-panel {
    max-width: 360px;
    padding: 32px 28px 24px;
  }
  .pdm-actions {
    flex-direction: row;
    gap: 12px;
  }
  .pdm-btn {
    flex: 1;
  }
}
</style>
