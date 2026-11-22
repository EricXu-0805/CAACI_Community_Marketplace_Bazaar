<template>
  <view class="page secondary-page secondary-page--catalog has-sidebar ev" :class="mpThemeClass" :style="mpChrome">
    <!-- #ifdef H5 -->
    <AppSidebar current="plaza" />
    <!-- #endif -->
    <view class="secondary-content">
    <!-- #ifndef H5 -->
    <AppToast />
    <!-- #endif -->
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack">
        <UIcon name="chevron-left" size="xs" color="accent-primary" />
      </view>
      <text class="header-title" role="heading" aria-level="1">{{ t(past ? 'events.pastTitle' : 'nav.events') }}</text>
      <MemberEventStart v-if="creationOpen" responsive />
    </view>

    <!-- SPEC 6.7.4 item 2: the source filter; the last choice is remembered on this device. -->
    <scroll-view v-if="!past" class="ev-chips" scroll-x :show-scrollbar="false">
      <view class="ev-chips-row" role="tablist" :aria-label="t('nav.events')">
        <view v-for="item in EVENT_FILTERS" :key="item" :class="['ev-chip', { on: filter === item }]" role="tab" tabindex="0"
          :aria-selected="filter === item ? 'true' : 'false'" :data-filter="item"
          @click="setFilter(item)" @keydown.enter.prevent="setFilter(item)" @keydown.space.prevent="setFilter(item)">
          <text class="ev-chip-t">{{ t(`events.filter.${item}`) }}</text>
        </view>
      </view>
    </scroll-view>

    <view class="ev-cols">
      <view class="ev-main">
        <view v-if="loading" class="ev-state" aria-busy="true">
          <text class="ev-state-t">{{ t('home.loading') }}</text>
        </view>
        <!-- A failed load is not an empty calendar (SPEC 6.7.12, last row). -->
        <view v-else-if="loadError" class="ev-state" role="alert" aria-live="assertive" data-test="events-failed">
          <text class="ev-state-t">{{ t('events.loadFailed') }}</text>
          <view class="ev-btn" role="button" tabindex="0" @click="load" @keydown.enter.prevent="load" @keydown.space.prevent="load">{{ t('home.retry') }}</view>
        </view>

        <template v-else-if="past">
          <view v-if="pastRows.length === 0" class="ev-state" data-test="events-empty">
            <text class="ev-state-t">{{ t('events.empty.past') }}</text>
          </view>
          <view v-else class="ev-list" data-test="events-past">
            <EventCard v-for="row in pastRows" :key="row.id" :event="row" :now="now" @open="openEvent" />
          </view>
          <view class="ev-foot">
            <text class="ev-link" role="button" tabindex="0" data-test="events-upcoming-link"
              @click="showPast(false)" @keydown.enter.prevent="showPast(false)">{{ t('events.upcomingLink') }}</text>
          </view>
        </template>

        <template v-else>
          <view v-if="view.total === 0" class="ev-state" data-test="events-empty">
            <text class="ev-state-t">{{ t(`events.empty.${filter}`) }}</text>
            <text v-for="link in emptyLinks" :key="link.key" class="ev-link" role="button" tabindex="0" :data-link="link.key"
              @click="openLink(link.url)" @keydown.enter.prevent="openLink(link.url)">{{ t(link.key) }}</text>
            <MemberEventStart v-if="creationOpen && (filter === 'all' || filter === 'member')" />
          </view>
          <template v-else>
            <view v-if="view.live.length" class="ev-group" data-group="live">
              <text class="ev-group-h" role="heading" aria-level="2">{{ t('events.status.live') }}</text>
              <view class="ev-list">
                <EventCard v-for="row in view.live" :key="row.id" :event="row" :now="now" @open="openEvent" />
              </view>
              <text v-if="view.liveMore" class="ev-more" role="button" tabindex="0" data-test="events-more-live"
                @click="allLive = true" @keydown.enter.prevent="allLive = true">{{ t('events.moreLive', { n: view.liveMore }) }}</text>
            </view>
            <view v-for="group in view.groups" :key="group.key" class="ev-group" :data-group="group.key">
              <text class="ev-group-h" role="heading" aria-level="2">{{ groupHead(group.head) }}</text>
              <view class="ev-list">
                <EventCard v-for="row in group.rows" :key="row.id" :event="row" :now="now" @open="openEvent" />
              </view>
              <!-- SPEC 6.7.1 rules 5 and 6: what the "all" view folds away is one tap from its own filter. -->
              <text v-if="group.memberMore" class="ev-more" role="button" tabindex="0" data-test="events-more-members"
                @click="setFilter('member')" @keydown.enter.prevent="setFilter('member')">{{ tc('events.moreMembers', group.memberMore, { n: group.memberMore }) }}</text>
              <text v-if="group.campusMore" class="ev-more" role="button" tabindex="0" data-test="events-more-campus"
                @click="setFilter('campus')" @keydown.enter.prevent="setFilter('campus')">{{ group.head.kind === 'month' ? tc('events.moreCampus', group.campusMore, { n: group.campusMore }) : tc('events.moreCampusWeek', group.campusMore, { n: group.campusMore }) }}</text>
            </view>
          </template>
          <view class="ev-foot">
            <text class="ev-link" role="button" tabindex="0" data-test="events-past-link"
              @click="showPast(true)" @keydown.enter.prevent="showPast(true)">{{ t('events.pastLink') }}</text>
          </view>
        </template>
      </view>

      <!-- #ifdef H5 -->
      <EventsSidebar :creation-open="creationOpen" />
      <!-- #endif -->
    </view>
    </view>
  </view>
</template>

<script setup lang="ts">
/*
 * P4.8 (SPEC 6.7.4): the events list. One read, list_community_events; the
 * page groups by Champaign date, folds what the "all" view caps, and never
 * renders an image or opens a web view. Registration happens with the
 * organizer: outbound links go through openExternalLink.
 */
// #ifdef H5
import AppSidebar from '../../components/AppSidebar.vue'
import EventsSidebar from '../../components/EventsSidebar.vue'
// #endif
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
// #ifndef H5
import AppToast from '../../components/AppToast.vue'
// #endif
import { computed, ref, onUnmounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import EventCard from '../../components/EventCard.vue'
import UIcon from '../../components/UIcon.vue'
import MemberEventStart from '../../components/MemberEventStart.vue'
import { useCommunityEvents } from '../../composables/useCommunityEvents'
import { useI18n } from '../../composables/useI18n'
import { navigateBackOr } from '../../utils'
import {
  EVENT_FILTERS, buildEventList, eventEmptyLinks, formatEventGroupHead,
  type CommunityEvent, type EventDateHead, type EventFilter,
} from '../../utils/communityEvents'
import { openExternalLink } from '../../utils/eventLinks'

const FILTER_KEY = 'community_events_filter'
// SPEC 6.7.9: the mini program opens no web page; a link there copies its address, and its label says so.
let copiesLinks = true
// #ifdef H5
copiesLinks = false
// #endif

const { t, tc, lang } = useI18n()
const { listEvents, memberEventsOpen } = useCommunityEvents()
const language = computed(() => (lang.value === 'zh' ? 'zh' : 'en'))

function readFilter(): EventFilter {
  try {
    const saved = uni.getStorageSync(FILTER_KEY)
    return EVENT_FILTERS.includes(saved) ? saved : 'all'
  } catch { return 'all' }
}
const filter = ref<EventFilter>(readFilter())
const past = ref(false)
const rows = ref<CommunityEvent[]>([])
const pastRows = ref<CommunityEvent[]>([])
const loading = ref(true)
const loadError = ref(false)
const creationOpen = ref(false)
const allLive = ref(false)
// The instant the list was read at: states and "today" are judged against it.
const now = ref(Date.now())
let epoch = 0

const view = computed(() => buildEventList(rows.value, filter.value, now.value, { allLive: allLive.value }))
const groupHead = (head: EventDateHead) => formatEventGroupHead(head, language.value,
  { today: t('events.today'), tomorrow: t('events.tomorrow') }, now.value)
// SPEC 6.7.12: where to look when a source has nothing listed here.
const emptyLinks = computed(() => eventEmptyLinks(filter.value, copiesLinks))

async function load() {
  const mine = ++epoch
  loading.value = (past.value ? pastRows.value : rows.value).length === 0
  loadError.value = false
  creationOpen.value = false
  void memberEventsOpen().then(open => {
    if (mine === epoch) creationOpen.value = open
  })
  try {
    const next = await listEvents(past.value ? 'past' : 'upcoming')
    if (mine !== epoch) return
    now.value = Date.now()
    if (past.value) pastRows.value = next
    else rows.value = next
  } catch {
    if (mine !== epoch) return
    loadError.value = true
  } finally {
    if (mine === epoch) loading.value = false
  }
}
onShow(() => { void load() })
onUnmounted(() => { epoch += 1 })

function setFilter(next: EventFilter) {
  filter.value = next
  allLive.value = false
  try { uni.setStorageSync(FILTER_KEY, next) } catch { /* storage unavailable: the choice lasts for this visit */ }
}
function showPast(value: boolean) {
  past.value = value
  void load()
}
function openEvent(id: string) { uni.navigateTo({ url: `/pages/event/detail/index?id=${encodeURIComponent(id)}` }) }
function openLink(url: string) { openExternalLink(url, [], language.value, t('events.linkCopied')) }
function goBack() { navigateBackOr(() => uni.switchTab({ url: '/pages/plaza/index' })) }
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: var(--canvas); max-width: 480px; margin: 0 auto; color: var(--ink); }
.header {
  display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4);
  padding-top: calc(var(--space-3) + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
  /* #ifdef MP-WEIXIN */
  padding-right: var(--mp-navbar-right-pad, 0px);
  /* #endif */
  background: var(--surface); box-shadow: inset 0 -1px 0 var(--line-hair);
}
.back-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.header-title { flex: 1; font-size: 17px; font-weight: 600; color: var(--ink); }
/* SPEC 6.7.4 item 2: the source filter stays at the top while the list scrolls under it. */
.ev-chips {
  height: 44px; background: var(--surface); box-shadow: inset 0 -1px 0 var(--line-hair); white-space: nowrap;
  position: sticky; top: 0; z-index: 5;
}
/* #ifndef H5 */
/* The mini program draws its status bar and capsule over the page, so there the top bar stays as well and the filter sits under it. */
.header { position: sticky; top: 0; z-index: 6; }
.ev-chips { top: calc(var(--space-3) * 2 + 32px + var(--mp-status-bar, 0px)); }
/* #endif */
.ev-chips-row { display: flex; align-items: center; gap: var(--space-2); height: 44px; padding: 0 var(--space-4); }
.ev-chip {
  flex: none; display: flex; align-items: center; height: 30px; padding: 0 var(--space-3); border-radius: var(--radius-pill);
  box-shadow: inset 0 0 0 1px var(--line-soft); cursor: pointer;
  &.on { background: var(--ink); box-shadow: none; }
}
.ev-chip-t { font-size: 14px; line-height: 20px; color: var(--ink-soft); }
.ev-chip.on .ev-chip-t { color: var(--surface); }
.ev-cols { display: flex; align-items: flex-start; gap: var(--space-6); }
.ev-main { flex: 1; min-width: 0; }
.ev-group-h {
  display: flex; align-items: center; height: 36px; padding: 0 var(--space-4);
  font-size: 13px; font-weight: 600; color: var(--ink-soft);
}
.ev-more, .ev-link { display: flex; align-items: center; min-height: 44px; padding: 0 var(--space-4); font-size: 13px; color: var(--ink-soft); cursor: pointer; }
.ev-more { background: var(--surface); box-shadow: inset 0 -1px 0 var(--line-hair); }
.ev-foot { display: flex; justify-content: center; padding: var(--space-4) 0 var(--space-8); }
.ev-state { display: flex; flex-direction: column; align-items: center; gap: var(--space-3); padding: var(--space-8) var(--space-4); }
.ev-state-t { font-size: 14px; line-height: 22px; color: var(--ink-soft); text-align: center; }
.ev-btn {
  min-height: 44px; padding: 0 var(--space-5); border-radius: var(--radius-pill); display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 600; color: var(--ink); box-shadow: inset 0 0 0 1px var(--line-bold); cursor: pointer;
}
/* #ifdef H5 */
/* SPEC 6.7.4, desktop: the title row is 22px, where the shared desktop layout of secondary pages begins. */
@media (min-width: 768px) {
  .header-title { font-size: 22px; line-height: 1.4; }
}
@media (min-width: 1024px) {
  .ev-cols { max-width: 1200px; margin: var(--space-5) auto 0; padding: 0 var(--space-6); box-sizing: border-box; }
  .ev-main { max-width: 876px; }
  .ev-list { border-radius: var(--radius-sm); overflow: hidden; box-shadow: inset 0 0 0 1px var(--line-soft); }
}
/* #endif */
</style>
