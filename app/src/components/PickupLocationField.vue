<template>
  <view class="pickup-section">
    <view class="pickup-heading">
      <text class="pickup-title">{{ t('publish.pickupHeading') }}</text>
      <text v-if="modelValue && !feedback && !detecting" :class="['pickup-badge', { checked: verified }]">
        {{ t(verified ? 'publish.streetCheckedBadge' : detected ? 'publish.deviceAreaBadge' : 'publish.manualAreaBadge') }}
      </text>
    </view>
    <!-- #ifdef H5 -->
    <view class="locate-actions">
    <button class="locate-btn" :class="{ 'locate-btn--disabled': disabled || detecting }" :disabled="disabled || detecting" :aria-label="t('a11y.detectLocation')" :aria-busy="detecting ? 'true' : 'false'" @click="$emit('detect')">
      <view v-if="detecting" class="locate-spinner" />
      <UIcon v-else name="location-pin" size="sm" />
      <text>{{ t(detecting ? (phase === 'address' ? 'publish.findingStreet' : 'publish.detectingLocation') : 'publish.useCurrentLocation') }}</text>
    </button>
    <button v-if="detecting" class="locate-cancel" :disabled="disabled" @click="$emit('cancel')">{{ t('publish.cancelLocation') }}</button>
    </view>
    <text v-if="!modelValue && !feedback && !detecting" class="pickup-help">{{ t('publish.locationPermissionHint') }}</text>
    <!-- #endif -->
    <view class="pickup-input-row">
      <UIcon name="location-pin" size="sm" color="text-muted" />
      <input v-model="locationValue" :disabled="disabled" maxlength="80" class="pickup-input" :placeholder="t('publish.locationManualPlaceholder')" :aria-label="t('publish.location')" @focus="$emit('focus')" @blur="$emit('blur')" />
    </view>
    <view v-if="modelValue || feedback || detecting" :class="['location-result', { 'location-error': !!feedback }]" role="status" aria-live="polite">
      <text>{{ feedback || t(detecting ? (phase === 'address' ? 'publish.findingStreet' : 'publish.locationWaiting') : verified ? (previouslyChecked ? 'publish.locationPreviouslyChecked' : 'publish.locationChecked') : detected ? 'publish.locationDetected' : 'publish.locationManual') }}</text>
    </view>
    <text class="pickup-help">{{ t('publish.pickupPrivacy') }}</text>
    <text class="spot-label">{{ t('publish.campusSpotHeading') }}</text>
    <scroll-view scroll-x class="spot-row">
      <view v-for="spot in CAMPUS_SPOTS" :key="spot.id" :class="['spot-chip', { active: modelValue === spotLabel(spot) }]" role="button" :aria-label="spotLabel(spot)" :aria-pressed="modelValue === spotLabel(spot) ? 'true' : 'false'" :aria-disabled="disabled ? 'true' : 'false'" @click="!disabled && $emit('update:modelValue', spotLabel(spot))">{{ spotLabel(spot) }}</view>
    </scroll-view>
    <!-- #ifdef H5 -->
    <OsmAttribution />
    <!-- #endif -->
  </view>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../composables/useI18n'
import { useCampusSpots } from '../composables/useCampusSpots'
import UIcon from './UIcon.vue'
import OsmAttribution from './OsmAttribution.vue'
const { t, lang } = useI18n()
const { CAMPUS_SPOTS } = useCampusSpots()
const spotLabel = (spot: { en: string; zh: string }) => lang.value === 'zh' ? spot.zh : spot.en
const props = defineProps<{ modelValue: string; disabled?: boolean; detecting?: boolean; phase?: string; verified?: boolean; previouslyChecked?: boolean; detected?: boolean; feedback?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; detect: []; cancel: []; focus: []; blur: [] }>()
const locationValue = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
</script>
<style scoped>
.pickup-section { padding: 24px 20px; background: var(--surface); }
.pickup-heading { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.pickup-title { font-size: 17px; font-weight: 650; color: var(--ink); }
.pickup-badge { font-size: 11px; font-weight: 600; color: var(--text-secondary); background: var(--bg-subtle); padding: 4px 8px; border-radius: 6px; }
.pickup-badge.checked { background: var(--success-soft, var(--bg-subtle)); color: var(--success); }
.locate-actions { display: flex; align-items: stretch; gap: 8px; }
.locate-actions .locate-btn { flex: 1; min-width: 0; width: auto; }
.locate-cancel { flex: none; margin: 0 0 10px; padding: 10px 12px; min-height: 44px; border: 0; border-radius: 12px; background: var(--bg-subtle); color: var(--ink); font-size: 14px; line-height: 1.4; }
.locate-cancel::after { border: 0; }
.locate-btn { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 10px 16px; margin: 0 0 10px; width: 100%; border: 0; border-radius: 12px; background: var(--bg-subtle); color: var(--ink); font-size: 14px; font-weight: 600; line-height: 1.4; transition: background 160ms ease; }
.locate-btn::after { border: 0; }.locate-btn:active { background: var(--bg-inset); }
.locate-btn[disabled] { color: var(--text-secondary); opacity: 1; }
.locate-spinner { width: 16px; height: 16px; border: 2px solid var(--line-soft); border-top-color: var(--ink); border-radius: 50%; animation: pickup-spin .8s linear infinite; }
.pickup-input-row { display: flex; gap: 8px; align-items: center; min-height: 48px; margin: 14px 0 0; padding: 0 12px; border-radius: 10px; background: var(--bg-subtle); }
.pickup-input { flex: 1; min-width: 0; font-size: 16px; color: var(--ink); }
.location-result { margin-top: 10px; font-size: 13px; line-height: 1.55; color: var(--text-secondary); }
.location-error { color: var(--text-primary); }
.pickup-help { display: block; margin-top: 8px; font-size: 12px; line-height: 1.6; color: var(--text-muted); }
.spot-label { display: block; margin: 18px 0 10px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.spot-row { box-sizing: border-box; width: 100%; white-space: nowrap; }
.spot-chip { display: inline-block; margin-right: 8px; padding: 9px 12px; border-radius: 10px; background: var(--bg-subtle); color: var(--ink); font-size: 13px; cursor: pointer; }
.spot-chip.active { background: var(--brand-soft); color: var(--brand-on-soft); }
@keyframes pickup-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .locate-btn { transition: none; } }
</style>
