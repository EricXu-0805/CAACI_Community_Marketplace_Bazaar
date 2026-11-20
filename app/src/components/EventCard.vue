<template>
  <!--
    One event, the same card for every source (SPEC 6.7.5): a date block, the
    title, when and where, then the source in words and the state. No picture:
    v1 renders no image of any source. The home block uses the compact form.
  -->
  <view :class="['evc', { 'evc-off': state === 'cancelled', 'evc-compact': compact }]" role="button" tabindex="0"
    :data-event-id="event.id" :data-source="event.source_type" :data-state="state" :aria-label="label"
    @click="emit('open', event.id)" @keydown.enter.prevent="emit('open', event.id)" @keydown.space.prevent="emit('open', event.id)">
    <view class="evc-date" aria-hidden="true">
      <text class="evc-mo">{{ block.month }}</text>
      <text class="evc-day">{{ block.day }}</text>
      <text v-if="block.runsOn" class="evc-on">{{ t('events.runsOn') }}</text>
    </view>
    <view class="evc-body">
      <text class="evc-title">{{ title }}</text>
      <text class="evc-when">{{ when }}</text>
      <view class="evc-tags">
        <text class="evc-tag" data-test="event-source">{{ source }}</text>
        <text v-if="event.source_type === 'member' && event.organizer_nickname" class="evc-who">{{ event.organizer_nickname }}</text>
        <text v-if="stateKey" class="evc-tag evc-tag-st" data-test="event-state">{{ t(stateKey) }}</text>
      </view>
    </view>
    <text v-if="!compact && event.discussion_count" class="evc-replies">{{ tc('events.replies', event.discussion_count, { n: event.discussion_count }) }}</text>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../composables/useI18n'
import { eventDateBlock, eventSourceLabel, eventState, eventTitle, type CommunityEvent, type EventState } from '../utils/communityEvents'
import { formatEventListTime } from '../utils/eventTime'

const props = defineProps<{ event: CommunityEvent; now: number; compact?: boolean }>()
const emit = defineEmits<{ (event: 'open', id: string): void }>()
const { t, tc, lang } = useI18n()

const language = computed(() => (lang.value === 'zh' ? 'zh' : 'en'))
const state = computed(() => eventState(props.event, props.now))
const STATE_KEY: Partial<Record<EventState, string>> = {
  live: 'events.status.live', rescheduled: 'events.status.rescheduled', cancelled: 'events.status.cancelledByOrganizer',
}
const stateKey = computed(() => STATE_KEY[state.value])
const block = computed(() => eventDateBlock(props.event, language.value))
const title = computed(() => eventTitle(props.event, language.value))
const source = computed(() => {
  const message = eventSourceLabel(props.event, language.value)
  return t(message.key, message.params)
})
// "周六 14:00 · ARC"; the group head above the card gives the date.
const when = computed(() => {
  const time = formatEventListTime(props.event.starts_at, language.value)
  const clock = props.event.all_day ? `${time.split(' ')[0]} ${t('events.allDay')}` : time
  return props.event.location ? `${clock} · ${props.event.location}` : clock
})
// The card is one button, so its name carries what it shows; the date is worded the way it is read aloud.
const label = computed(() => [title.value,
  language.value === 'zh' ? `${block.value.month}${block.value.day}日` : `${block.value.month} ${block.value.day}`,
  when.value, source.value, stateKey.value ? t(stateKey.value) : ''].filter(Boolean).join(' · '))
</script>

<style lang="scss" scoped>
.evc {
  display: flex; align-items: flex-start; gap: var(--space-3); min-height: 76px; box-sizing: border-box;
  padding: var(--space-3) var(--space-4); background: var(--surface); cursor: pointer;
  box-shadow: inset 0 -1px 0 var(--line-hair);
}
.evc-date {
  flex: none; width: 44px; height: 48px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  border-radius: var(--radius-sm); box-shadow: inset 0 0 0 1px var(--line-soft); position: relative;
}
.evc-mo { font-size: 12px; line-height: 16px; color: var(--ink-soft); }
.evc-day { font-size: 20px; line-height: 24px; font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
.evc-on { position: absolute; right: 2px; bottom: 0; font-size: 12px; line-height: 14px; color: var(--ink-quiet); }
.evc-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.evc-title {
  font-size: 15px; line-height: 21px; font-weight: 500; color: var(--ink);
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
}
.evc-when { font-size: 13px; line-height: 18px; color: var(--ink-quiet); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evc-tags { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
/* SPEC 6.7.1 rule 2: until D-35 every source label is neutral; the words tell the sources apart. */
.evc-tag {
  font-size: 12px; line-height: 18px; padding: 0 var(--space-2); border-radius: var(--radius-xs);
  color: var(--ink-soft); box-shadow: inset 0 0 0 1px var(--line-soft); white-space: nowrap;
}
.evc-tag-st { color: var(--ink); box-shadow: inset 0 0 0 1px var(--line-bold); }
.evc-who { font-size: 12px; line-height: 18px; color: var(--ink-quiet); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; }
.evc-replies { flex: none; align-self: center; font-size: 12px; line-height: 18px; color: var(--ink-soft); white-space: nowrap; font-variant-numeric: tabular-nums; }
.evc-off .evc-title { text-decoration: line-through; color: var(--ink-quiet); }
/* The home block: 84px rows with a 14px title and 12px second line (SPEC 5.2 S2, 5.3 ⑤). */
.evc-compact { min-height: 84px; padding: var(--space-2) 0; background: transparent; }
.evc-compact .evc-title { font-size: 14px; line-height: 20px; }
.evc-compact .evc-when { font-size: 12px; line-height: 16px; }
</style>
