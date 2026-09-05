<template>
  <view class="listing-preview">
    <view class="preview-toggle" role="button" :aria-label="t('publish.preview')" :aria-expanded="open ? 'true' : 'false'" @click="open = !open">
      <UIcon name="image" size="xs" color="text-subtle" />
      <text>{{ t('publish.preview') }}</text>
      <UIcon name="chevron-right" :style="{ transform: open ? 'rotate(90deg)' : 'none' }" size="xs" color="text-subtle" />
    </view>
    <view v-if="open" class="preview-content">
      <text class="preview-note">{{ t('publish.previewHint') }}</text>
      <view class="preview-card">
        <image v-if="images[0]" :src="images[0]" :alt="form.title || t('publish.cover')" mode="aspectFit" class="preview-cover" />
        <view class="preview-copy">
          <text class="preview-title">{{ form.title.trim() || t('publish.previewUntitled') }}</text>
          <text class="preview-price">{{ priceLabel }}</text>
          <text v-if="form.category || (form.condition && form.listingType !== 'wanted' && !hasCategoryDetails(form.category))" class="preview-meta">{{ [form.category && t('cat.' + form.category), form.listingType !== 'wanted' && !hasCategoryDetails(form.category) && form.condition && t('condition.' + form.condition)].filter(Boolean).join(' · ') }}</text>
          <text class="preview-meta">{{ previewLocation }}</text>
        </view>
      </view>
      <ListingDetailsSummary :item="{ category: form.category, listing_type: form.listingType, listing_details: form.details ? listingDetailsFromForm(form.category, form.details) : null }" />
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '../composables/useI18n'
import { listingPriceLabel } from '../utils'
import { localizeLocation } from '../composables/useCampusSpots'
import UIcon from './UIcon.vue'
import ListingDetailsSummary from './ListingDetailsSummary.vue'
import { hasCategoryDetails, listingDetailsFromForm, type ListingDetailForm } from '../utils/listingDetails'
const props = defineProps<{ form: { title: string; price: string; category: string; condition: string; location: string; listingType: string; details?: ListingDetailForm }; images: string[] }>()
const { t, lang } = useI18n()
const open = ref(false)
const previewLocation = computed(() => localizeLocation(props.form.location.trim(), lang.value as 'en' | 'zh') || t('publish.previewLocation'))
const priceLabel = computed(() => {
  const raw = props.form.price.trim()
  if (!raw && props.form.listingType !== 'wanted') return t('publish.previewPrice')
  if (raw && !/^\d+(?:\.\d{1,2})?$/.test(raw)) return t('publish.needPrice')
  return listingPriceLabel({ price: Number(raw), listing_type: props.form.listingType, category: props.form.category, listing_details: props.form.details ? listingDetailsFromForm(props.form.category, props.form.details) : null }, t)
})
</script>
<style scoped lang="scss">
.listing-preview { margin: 0 16px 12px; }
.preview-toggle { display: flex; align-items: center; gap: 8px; min-height: 44px; color: var(--text-secondary); font-size: 13px; cursor: pointer; }
.preview-content { padding-bottom: 6px; }
.preview-note { display: block; font-size: 12px; line-height: 1.5; color: var(--text-subtle); margin-bottom: 8px; }
.preview-card { display: flex; gap: 12px; padding: 12px; border: 1px solid var(--line-hair); border-radius: var(--radius-md); background: var(--surface); }
.preview-cover { width: 96px; height: 108px; flex-shrink: 0; background: var(--bg-subtle); border-radius: 8px; }
.preview-copy { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.preview-title { font-size: 15px; font-weight: 600; line-height: 1.5; overflow-wrap: anywhere; }
.preview-price { font-size: 17px; font-weight: 700; color: var(--accent-primary); }
.preview-meta { font-size: 12px; color: var(--text-subtle); line-height: 1.5; overflow-wrap: anywhere; }
</style>
