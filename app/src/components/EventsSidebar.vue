<template>
  <view :class="['events-sidebar', { 'with-create': creationOpen }]">
    <view class="ev-side ev-sources" data-block="event-sources">
      <text class="ev-side-h" role="heading" aria-level="2">{{ t('events.sourcesTitle') }}</text>
      <view v-for="source in sources" :key="source" class="ev-side-row">
        <text class="ev-side-tag">{{ t(`events.filter.${source}`) }}</text>
        <text class="ev-side-t">{{ t(`events.side.${source}`) }}</text>
      </view>
    </view>
    <view v-if="creationOpen" class="ev-side ev-create">
      <text class="ev-create-h" role="heading" aria-level="2">{{ t('events.creationTitle') }}</text>
      <view role="list" class="ev-create-rules">
        <text v-for="rule in rules" :key="rule" role="listitem" class="ev-side-t">{{ t(`events.creationRules.${rule}`) }}</text>
      </view>
      <MemberEventStart outline />
    </view>
  </view>
</template>

<script setup lang="ts">
import MemberEventStart from './MemberEventStart.vue'
import { useI18n } from '../composables/useI18n'
defineProps<{ readonly creationOpen: boolean }>()
const { t } = useI18n()
const sources = ['caaci', 'partner', 'campus', 'member'] as const
const rules = ['eligibility', 'active', 'time'] as const
</script>

<style scoped>
.events-sidebar { display: none; flex: 0 0 240px; min-width: 0; }
.ev-side { box-sizing: border-box; padding: var(--space-4); border-radius: var(--radius-sm); background: var(--surface); box-shadow: inset 0 0 0 1px var(--line-soft); }
.ev-sources { display: none; }
.ev-side-h { display: block; margin-bottom: var(--space-2); font-size: 15px; line-height: 24px; font-weight: 600; color: var(--ink); }
.ev-side-row { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) 0; }
.ev-side-tag { align-self: flex-start; font-size: 12px; line-height: 18px; padding: 0 var(--space-2); border-radius: var(--radius-xs); color: var(--ink-soft); box-shadow: inset 0 0 0 1px var(--line-soft); }
.ev-side-t { font-size: 13px; line-height: 20px; color: var(--ink-soft); overflow-wrap: anywhere; }
.ev-create-h { display: block; font-size: 17px; line-height: 24px; font-weight: 600; color: var(--ink); }
.ev-create-rules { display: flex; flex-direction: column; gap: var(--space-3); margin: var(--space-4) 0; }
@media (min-width: 768px) {
  .events-sidebar.with-create { display: flex; flex-direction: column; gap: var(--space-4); }
}
@media (min-width: 1024px) {
  .events-sidebar { display: flex; flex-direction: column; gap: var(--space-4); flex-basis: 300px; }
  .ev-sources { display: block; }
}
</style>
