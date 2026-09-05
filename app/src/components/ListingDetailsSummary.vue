<template>
  <view v-if="details" :class="['listing-details-summary', { compact }]">
    <template v-if="details.kind === 'housing'">
      <text>{{ details.available_from }} – {{ details.available_to }}</text>
      <text>{{ t('listingDetails.room.' + details.room_type) }} · {{ t('listingDetails.unit.' + details.price_unit) }}</text>
    </template>
    <template v-else>
      <text class="route">{{ details.origin }} → {{ details.destination }}</text>
      <text>{{ details.departure_date }} {{ details.departure_time }} {{ t('listingDetails.campusTime') }}</text>
      <text v-if="!compact">{{ t(item.listing_type === 'wanted' ? 'listingDetails.seatsWanted' : 'listingDetails.seats') }}: {{ details.seats }} · {{ t('listingDetails.unit.person') }}</text>
    </template>
  </view>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../composables/useI18n'
import { readListingDetails } from '../utils/listingDetails'
const props = defineProps<{ item: { category?: string; listing_type?: string; listing_details?: unknown }; compact?: boolean }>()
const { t } = useI18n()
const details = computed(() => readListingDetails(props.item.category, props.item.listing_details))
</script>
<style scoped lang="scss">
.listing-details-summary { display: flex; flex-direction: column; gap: 6px; margin: 12px 0; line-height: 1.6; font-size: 14px; color: var(--text-secondary); overflow-wrap: anywhere; }
.compact { font-size: 12px; gap: 3px; margin: 7px 0; }
.route { font-weight: 600; }
</style>
