<template>
  <view v-if="visible" class="sim-mask" @click="onMaskClick">
    <view
      class="sim-panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="introId"
      @click.stop
    >
      <!-- University-identity accent header (campus-orange moment). -->
      <view class="sim-header">
        <view class="sim-badge">
          <view class="sim-badge-excl"></view>
        </view>
        <text :id="titleId" class="sim-title t-h2">{{ t('scam.modal.title') }}</text>
      </view>

      <view class="sim-body">
        <text :id="introId" class="sim-intro t-body">{{ t('scam.modal.intro') }}</text>

        <view class="sim-rules">
          <view v-for="rule in rules" :key="rule.n" class="sim-rule">
            <view class="sim-rule-dot">
              <text class="sim-rule-num">{{ rule.n }}</text>
            </view>
            <text class="sim-rule-text t-body">{{ t(rule.key) }}</text>
          </view>
        </view>

        <view class="sim-actions">
          <view class="u-btn-ink sim-btn" role="button" @click="onUnderstand">
            <text>{{ t('scam.modal.understand') }}</text>
          </view>
          <view class="sim-link" role="button" @click="onLearnMore">
            <text class="t-caption">{{ t('scam.modal.learnMore') }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, watch, onUnmounted } from 'vue'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'understand'): void
  (e: 'close'): void
  (e: 'learnMore'): void
}>()

const rules = [
  { n: 1, key: 'scam.modal.rule1' },
  { n: 2, key: 'scam.modal.rule2' },
  { n: 3, key: 'scam.modal.rule3' },
  { n: 4, key: 'scam.modal.rule4' },
] as const

/*
 * Stable IDs for aria-labelledby / aria-describedby — same pattern as
 * PermissionDeniedModal. Math.random keeps them unique if two modal
 * instances ever co-exist on a page.
 */
const uid = Math.random().toString(36).slice(2, 6)
const titleId = computed(() => `sim-title-${uid}`)
const introId = computed(() => `sim-intro-${uid}`)

function onMaskClick() {
  emit('close')
}

function onUnderstand() {
  emit('understand')
}

function onLearnMore() {
  emit('learnMore')
}

/*
 * H5 ESC-to-close. mp-weixin has no document keyboard model so this is
 * wrapped in a typeof-document guard — same defensive pattern as
 * PermissionDeniedModal.
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
  Mask backdrop: SKILL §6 / HARD RULES carve-out — modal backdrops are
  the explicit exception to the warm-ink no-raw-rgba sweep. 0.5 alpha
  matches the spec ("backdrop rgba(0,0,0,0.5)") and reads as a blocking
  university-safety moment (heavier than the 0.35 used for the lighter
  PermissionDeniedModal).

  Mount strategy mirrors PermissionDeniedModal: v-if + pure CSS
  @keyframes (no Vue <Transition>). uni-app's mp-weixin Transition
  polyfill is flaky on descendant transition classes; plain animation:
  works identically on both H5 and mp and only animates transform +
  opacity (mp-safe — no layout props).
*/
.sim-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  box-sizing: border-box;
  animation: simMaskIn var(--dur-3, 360ms) var(--ease-warm, cubic-bezier(0.2, 0.8, 0.2, 1)) both;
}

.sim-panel {
  position: relative;
  z-index: 1001;
  background: var(--paper);
  border-radius: var(--radius-lg);
  max-width: 340px;
  width: 100%;
  overflow: hidden;
  box-shadow: var(--shadow-float);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  animation: simPanelIn var(--dur-3, 360ms) var(--ease-warm, cubic-bezier(0.2, 0.8, 0.2, 1)) both;
}

/* Campus-orange accent header — the university-identity moment. */
.sim-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-5) var(--space-5) var(--space-4);
  background: var(--campus-orange-soft);
  border-bottom: 0.5px solid var(--campus-orange);
}
.sim-badge {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-pill);
  background: var(--campus-orange);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.sim-badge-excl {
  width: 2px;
  height: 11px;
  background: var(--ink-inverse);
  border-radius: 1px;
  position: relative;
}
.sim-badge-excl::after {
  content: '';
  position: absolute;
  bottom: -6px;
  left: -1px;
  width: 4px;
  height: 3px;
  background: var(--ink-inverse);
  border-radius: 2px;
}
.sim-title {
  flex: 1;
  color: var(--ink);
}

.sim-body {
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
}
.sim-intro {
  display: block;
  color: var(--ink-soft);
  line-height: 1.6;
  margin-bottom: var(--space-4);
}

.sim-rules {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
}
.sim-rule {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}
.sim-rule-dot {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-pill);
  background: var(--campus-orange-soft);
  border: 0.5px solid var(--campus-orange);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}
.sim-rule-num {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  color: var(--campus-orange-deep);
}
.sim-rule-text {
  flex: 1;
  color: var(--ink);
  line-height: 1.55;
}

.sim-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}
.sim-btn {
  width: 100%;
  height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sim-link {
  padding: var(--space-1) var(--space-2);
  cursor: pointer;
  &:active { opacity: 0.6; }
  text { color: var(--ink-quiet); }
}

@keyframes simMaskIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes simPanelIn {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

@media (min-width: 768px) {
  .sim-panel {
    max-width: 380px;
  }
}
</style>
