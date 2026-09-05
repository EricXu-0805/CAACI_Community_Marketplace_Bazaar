<template>
  <view v-if="hasCategoryDetails(category)" class="category-fields">
    <text class="category-heading">{{ t('listingDetails.' + category) }}</text>
    <text v-if="legacyOptional" class="category-note">{{ t('listingDetails.legacyHint') }}</text>
    <template v-if="category === 'housing'">
      <view class="category-row">
        <text class="category-row-label">{{ t('listingDetails.fromDate') }}</text>
        <picker :aria-label="t('listingDetails.fromDate')" mode="date" :value="modelValue.available_from" :disabled="disabled" start="2000-01-01" end="2099-12-31" @change="set('available_from', $event.detail.value)">
          <view class="category-control" role="button" :aria-disabled="disabled ? 'true' : 'false'" :aria-label="t('listingDetails.fromDate')">{{ modelValue.available_from || t('listingDetails.chooseDate') }}</view>
        </picker>
      </view>
      <view class="category-row">
        <text class="category-row-label">{{ t('listingDetails.toDate') }}</text>
        <picker :aria-label="t('listingDetails.toDate')" mode="date" :value="modelValue.available_to" :disabled="disabled" :start="modelValue.available_from || '2000-01-01'" end="2099-12-31" @change="set('available_to', $event.detail.value)">
          <view class="category-control" role="button" :aria-disabled="disabled ? 'true' : 'false'" :aria-label="t('listingDetails.toDate')">{{ modelValue.available_to || t('listingDetails.chooseDate') }}</view>
        </picker>
      </view>
      <text class="category-label">{{ t('listingDetails.priceUnit') }}</text>
      <view class="category-options">
        <view v-for="unit in ['month', 'week', 'total']" :key="unit" :class="['category-choice', { active: modelValue.price_unit === unit }]" role="button" :aria-disabled="disabled ? 'true' : 'false'" :aria-pressed="modelValue.price_unit === unit ? 'true' : 'false'" :aria-label="t('listingDetails.unit.' + unit)" @click="set('price_unit', unit)">{{ t('listingDetails.unit.' + unit) }}</view>
      </view>
      <text class="category-label">{{ t('listingDetails.roomType') }}</text>
      <view class="category-options">
        <view v-for="room in ['private', 'shared', 'entire']" :key="room" :class="['category-choice', { active: modelValue.room_type === room }]" role="button" :aria-disabled="disabled ? 'true' : 'false'" :aria-pressed="modelValue.room_type === room ? 'true' : 'false'" :aria-label="t('listingDetails.room.' + room)" @click="set('room_type', room)">{{ t('listingDetails.room.' + room) }}</view>
      </view>
    </template>
    <template v-else>
      <view v-for="field in (['origin', 'destination'] as const)" :key="field" class="category-row">
        <text class="category-row-label">{{ t('listingDetails.' + field) }}</text>
        <input class="category-input" :value="modelValue[field]" :disabled="disabled" maxlength="80" :aria-label="t('listingDetails.' + field)" :placeholder="t('listingDetails.' + field + 'Hint')" @input="setInput(field, $event)" @focus="$emit('focus')" @blur="commitBlur(field, $event)" />
      </view>
      <view class="category-row">
        <text class="category-row-label">{{ t('listingDetails.departureDate') }}</text>
        <picker :aria-label="t('listingDetails.departureDate')" mode="date" :value="modelValue.departure_date" :disabled="disabled" start="2000-01-01" end="2099-12-31" @change="set('departure_date', $event.detail.value)">
          <view class="category-control" role="button" :aria-disabled="disabled ? 'true' : 'false'" :aria-label="t('listingDetails.departureDate')">{{ modelValue.departure_date || t('listingDetails.chooseDate') }}</view>
        </picker>
      </view>
      <view class="category-row">
        <text class="category-row-label">{{ t('listingDetails.departureTime') }}</text>
        <picker :aria-label="t('listingDetails.departureTime')" mode="time" :value="modelValue.departure_time" :disabled="disabled" @change="set('departure_time', $event.detail.value)">
          <view class="category-control" role="button" :aria-disabled="disabled ? 'true' : 'false'" :aria-label="t('listingDetails.departureTime')">{{ modelValue.departure_time || t('listingDetails.chooseTime') }}</view>
        </picker>
      </view>
      <view class="category-row">
        <text class="category-row-label">{{ t(listingType === 'wanted' ? 'listingDetails.seatsWanted' : 'listingDetails.seats') }}</text>
        <input class="category-input" type="number" :value="modelValue.seats" :disabled="disabled" maxlength="1" :aria-label="t(listingType === 'wanted' ? 'listingDetails.seatsWanted' : 'listingDetails.seats')" placeholder="1–8" @input="setInput('seats', $event)" @focus="$emit('focus')" @blur="commitBlur('seats', $event)" />
      </view>
      <text class="category-note">{{ t('listingDetails.tripHint') }}</text>
    </template>
  </view>
</template>
<script setup lang="ts">
import { useI18n } from '../composables/useI18n'
import { hasCategoryDetails, type ListingDetailForm } from '../utils/listingDetails'
const props = defineProps<{ modelValue: ListingDetailForm; category: string; listingType: string; disabled?: boolean; legacyOptional?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [ListingDetailForm]; focus: []; blur: [] }>()
const { t } = useI18n()
function setInput(field: keyof ListingDetailForm, event: Event) {
  set(field, (event as CustomEvent<{ value: string }>).detail?.value ?? (event.target as HTMLInputElement | null)?.value ?? '')
}
// uni-app throttles input events by 100 ms. Commit the final blur value so
// correcting a field and immediately saving cannot validate the previous value.
function commitBlur(field: keyof ListingDetailForm, event: Event) {
  setInput(field, event)
  emit('blur')
}
function set(field: keyof ListingDetailForm, value: string) {
  if (!props.disabled) emit('update:modelValue', { ...props.modelValue, [field]: value })
}
</script>
<style scoped lang="scss">
.category-fields { margin: 12px 16px; padding: 16px; border: 1px solid var(--line-hair); border-radius: var(--radius-md); background: var(--bg-subtle); }
.category-heading { display: block; font-size: 15px; font-weight: 600; margin-bottom: 8px; }
.category-label { display: block; margin-top: 12px; font-size: 13px; }
.category-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; font-size: 13px; min-width: 0; }
.category-row-label { flex: 1 0 110px; }
.category-input { flex: 1 1 160px; min-width: 0; min-height: 44px; font-size: 14px; }
.category-control { min-height: 44px; display: flex; align-items: center; color: var(--text-secondary); }
.category-options { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.category-choice { padding: 0 12px; min-height: 44px; display: flex; align-items: center; border: 1px solid var(--line-hair); border-radius: var(--radius-pill); font-size: 13px; cursor: pointer; }
.category-choice.active { color: var(--accent-primary); border-color: var(--accent-primary); background: var(--surface); }
.category-note { display: block; margin-top: 8px; font-size: 12px; line-height: 1.6; color: var(--text-subtle); }
</style>
