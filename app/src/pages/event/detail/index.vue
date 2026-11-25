<template>
  <view class="page secondary-page secondary-page--reading has-sidebar" :class="mpThemeClass" :style="mpChrome">
    <!-- #ifdef H5 -->
    <AppSidebar current="plaza" />
    <view v-if="desktop" class="ev-desktop-header">
      <CommunityHeader v-model:search="headerSearch" view="home" :board="null" desktop current-item="events"
        :is-logged-in="headerLoggedIn" @home="headerHome" @all="headerAll" @board="headerBoard"
        @compose="headerHome" @login="headerLogin" @search-submit="headerSubmit" />
    </view>
    <!-- #endif -->
    <view class="secondary-content">
    <!-- #ifndef H5 -->
    <AppToast />
    <!-- #endif -->
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goList">
        <UIcon name="chevron-left" size="xs" color="accent-primary" />
      </view>
      <text class="header-title">{{ t('nav.events') }}</text>
      <EventMenu v-if="event && !loading" :event="event" @cancelled="onCancelled" />
    </view>

    <view v-if="loading" class="ed-state" aria-busy="true">
      <text class="ed-state-t">{{ t('home.loading') }}</text>
    </view>
    <view v-else-if="loadError" class="ed-state" role="alert" aria-live="assertive">
      <text class="ed-state-t">{{ t('events.loadFailed') }}</text>
      <view class="ed-btn" role="button" tabindex="0" @click="load" @keydown.enter.prevent="load" @keydown.space.prevent="load">{{ t('home.retry') }}</view>
    </view>
    <!-- Hidden, withdrawn by its source, or its partner's consent is gone: readers get no row, whatever the reason (SPEC 6.7.7). -->
    <view v-else-if="!event" class="ed-state" data-test="event-gone">
      <text class="ed-state-t" role="heading" aria-level="1">{{ t('events.status.gone') }}</text>
      <view class="ed-btn" role="button" tabindex="0" @click="goList" @keydown.enter.prevent="goList" @keydown.space.prevent="goList">{{ t('events.backToList') }}</view>
    </view>

    <view v-else class="ed" :data-event-id="event.id" :data-source="event.source_type" :data-state="state">
      <text :class="['ed-title', { 'ed-off': state === 'cancelled' }]" role="heading" aria-level="1">{{ title }}</text>
      <view class="ed-source">
        <text class="ed-tag" data-test="event-source">{{ sourceLabel }}</text>
        <text class="ed-source-t">{{ sourceLine }}</text>
      </view>
      <view v-if="banner" class="ed-banner" role="status" data-test="event-banner">
        <text class="ed-banner-t">{{ banner }}</text>
        <text v-if="state === 'cancelled' && event.status_note" class="ed-banner-note">{{ event.status_note }}</text>
      </view>

      <view class="ed-facts">
        <text class="ed-fact" data-test="event-time">{{ formatEventDetailTime(event, language) }}</text>
        <text v-if="deviceTime" class="ed-fact ed-quiet" data-test="event-device-time">{{ deviceTime }}</text>
        <text v-if="place" class="ed-fact" data-test="event-place">{{ place }}</text>
      </view>
      <text v-if="summary" class="ed-summary">{{ summary }}</text>
      <view v-if="event.source_type === 'member'" class="ed-author">
        <UAvatar class="ed-author-avatar" :src="event.organizer_avatar_url" :owner="event.organizer_user_id"
          :fallback="isDark ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'" aria-hidden="true" />
        <view class="ed-author-copy">
          <text class="ed-author-name">{{ event.organizer_nickname || t('app.user') }}</text>
          <UBadge v-if="event.organizer_is_illini_verified" class="ed-verified" variant="illini" :label="t('profile.illiniVerified')" />
        </view>
        <UButton v-if="canContact" variant="ghost" :loading="contacting" @click="contact">{{ t('seller.message') }}</UButton>
      </view>

      <!-- SPEC 6.7.9: registration is with the organizer; a link off the allowlist has no button. -->
      <view v-if="actions.length" class="ed-actions">
        <template v-for="action in actions" :key="action.kind">
          <view :class="['ed-act', { 'ed-act-main': action.primary, 'ed-act-off': action.disabled }]" role="button"
            :tabindex="action.disabled ? -1 : 0" :aria-disabled="action.disabled ? 'true' : undefined" :data-action="action.kind"
            @click="run(action)" @keydown.enter.prevent="run(action)" @keydown.space.prevent="run(action)">
            <text class="ed-act-t">{{ actionLabel(action) }}</text>
          </view>
          <text v-if="action.kind === 'caaciRegister'" class="ed-note">{{ t('events.cta.caaciNote') }}</text>
          <text v-if="action.kind === 'partnerRegister'" class="ed-note">{{ t('events.cta.partnerNote', { org: partnerName }) }}</text>
        </template>
      </view>
      <UButton v-if="canContact" variant="ghost" :loading="contacting" @click="contact">{{ t('events.cta.dmOrganizer') }}</UButton>

      <text v-if="event.source_type === 'member'" class="ed-safety">{{ t('events.memberSafety') }}</text>
      <text v-if="event.source_type === 'caaci' && lastSuccess" class="ed-checked" data-test="event-checked">{{ t('events.checkedAt', { when: formatEventCheckedAt(lastSuccess, language, now) }) }}</text>
      <text class="ed-wrong" role="button" tabindex="0" data-test="event-wrong-info"
        @click="reportWrongInfo" @keydown.enter.prevent="reportWrongInfo">{{ t('events.wrongInfo') }}</text>
    </view>
    </view>
  </view>
</template>

<script setup lang="ts">
/*
 * P4.8 (SPEC 6.7.6): one event. The row comes from the list the reader just
 * saw, or from list_community_events when the page is opened directly. No
 * event poster is rendered and no web view is opened.
 */
// #ifdef H5
import AppSidebar from '../../../components/AppSidebar.vue'
import CommunityHeader from '../../../components/CommunityHeader.vue'
import { useEventHeader } from '../../../composables/useEventHeader'
const { desktop, search: headerSearch, isLoggedIn: headerLoggedIn, home: headerHome,
  all: headerAll, submit: headerSubmit, board: headerBoard, login: headerLogin } = useEventHeader()
// #endif
import { mpChromeVars, mpThemeClass } from '../../../composables/useMpChrome'
const mpChrome = mpChromeVars()
// #ifndef H5
import AppToast from '../../../components/AppToast.vue'
// #endif
import { computed, ref, onUnmounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import UIcon from '../../../components/UIcon.vue'
import UAvatar from '../../../components/UAvatar.vue'
import UBadge from '../../../components/UBadge.vue'
import UButton from '../../../components/UButton.vue'
import EventMenu from '../EventMenu.vue'
import { useOrganizerContact } from '../useOrganizerContact'
import { useTheme } from '../../../composables/useTheme'
import { useCommunityEvents } from '../../../composables/useCommunityEvents'
import { useI18n } from '../../../composables/useI18n'
import { SUPPORT_EMAIL } from '../../../config/runtime'
import { navigateBackOr } from '../../../utils'
import {
  eventActions, eventSourceLabel, eventState, eventTitle, type CommunityEvent, type EventAction,
} from '../../../utils/communityEvents'
import { openExternalLink } from '../../../utils/eventLinks'
import { formatEventCheckedAt, formatEventDetailTime, formatEventDeviceTime, formatEventPreviousTime } from '../../../utils/eventTime'

const { t, tc, lang } = useI18n()
const { findEvent, caaciLastSuccess } = useCommunityEvents()
const language = computed(() => (lang.value === 'zh' ? 'zh' : 'en'))

const eventId = ref('')
const event = ref<CommunityEvent | null>(null)
const { canContact, busy: contacting, contact } = useOrganizerContact(event)
const { isDark } = useTheme()
const loading = ref(true)
const loadError = ref(false)
const now = ref(Date.now())
const lastSuccess = ref<string | null>(null)
let epoch = 0

async function load() {
  const mine = ++epoch
  loading.value = true
  loadError.value = false
  lastSuccess.value = null
  try {
    const row = eventId.value ? await findEvent(eventId.value) : null
    if (mine !== epoch) return
    now.value = Date.now()
    event.value = row
    if (row?.source_type === 'caaci') void caaciLastSuccess().then(value => { if (mine === epoch) lastSuccess.value = value })
  } catch {
    if (mine !== epoch) return
    loadError.value = true
  } finally {
    if (mine === epoch) loading.value = false
  }
}
onLoad((query) => {
  eventId.value = String((query as Record<string, string> | undefined)?.id || '')
  void load()
})
onUnmounted(() => { epoch += 1 })

const state = computed(() => (event.value ? eventState(event.value, now.value) : 'normal'))
const title = computed(() => (event.value ? eventTitle(event.value, language.value) : ''))
const partnerName = computed(() => {
  const row = event.value
  if (!row) return ''
  return (language.value === 'zh' ? row.partner_name_zh || row.partner_name_en : row.partner_name_en || row.partner_name_zh) || ''
})
const sourceLabel = computed(() => {
  if (!event.value) return ''
  const message = eventSourceLabel(event.value, language.value)
  return t(message.key, message.params)
})
// SPEC 6.7.3: one sentence that says who is responsible for the event.
const sourceLine = computed(() => {
  const row = event.value
  if (!row) return ''
  return t(`events.about.${row.source_type}`, { org: partnerName.value, organizer: row.organizer_name || '' })
})
const banner = computed(() => {
  const row = event.value
  if (!row) return ''
  // SPEC 6.7.7: what is on now has a banner in English only; in Chinese the list says 进行中 and the page says nothing.
  if (state.value === 'live') return language.value === 'en' ? t('events.status.live') : ''
  if (state.value === 'ended') return t('events.status.ended')
  if (state.value === 'cancelled') return t('events.status.cancelled')
  if (state.value === 'rescheduled' && row.previous_starts_at) {
    return t('events.status.rescheduledFrom', { when: formatEventPreviousTime(row.previous_starts_at, language.value) })
  }
  return ''
})
// An event's place is free text its organizer wrote, not one of the stored profile locations that get translated.
const place = computed(() => event.value?.location || '')
const deviceTime = computed(() => (event.value ? formatEventDeviceTime(event.value, language.value) : null))
const summary = computed(() => {
  const row = event.value
  if (!row) return ''
  return (language.value === 'zh' ? row.summary || row.summary_en : row.summary_en || row.summary) || ''
})
const actions = computed(() => (event.value ? eventActions(event.value, state.value) : []))

function actionLabel(action: EventAction) {
  if (action.kind === 'discuss') {
    const count = event.value?.discussion_count || 0
    return count ? tc('events.cta.discussCount', count, { n: count }) : t('events.cta.discuss')
  }
  if (action.kind === 'caaciClosed') return t('events.cta.caaciClosed')
  // SPEC 6.7.9: the mini program opens no web page, so its buttons say what they do, which is copy.
  // #ifndef H5
  return t(action.kind === 'caaciRegister' || action.kind === 'partnerRegister' ? 'events.cta.copyRegister' : 'events.cta.copyLink')
  // #endif
  // #ifdef H5
  return t(`events.cta.${action.kind}`, { host: action.host || '' })
  // #endif
}
function run(action: EventAction) {
  const row = event.value
  if (!row || action.disabled) return
  if (action.kind === 'discuss') {
    uni.navigateTo({ url: `/pages/post/index?id=${encodeURIComponent(row.discussion_post_id || '')}` })
  } else if (action.url) {
    openExternalLink(action.url, row.allowed_link_hosts || [], language.value, t('events.linkCopied'))
  }
}
function reportWrongInfo() {
  // #ifdef H5
  window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(title.value)}`
  // #endif
  // #ifndef H5
  uni.setClipboardData({ data: SUPPORT_EMAIL, success: () => uni.showToast({ title: t('legal.emailCopied'), icon: 'success' }) })
  // #endif
}
function goList() { navigateBackOr(() => uni.redirectTo({ url: '/pages/events/index' })) }
function onCancelled(result: { readonly id: string; readonly cancelled_at: string }) {
  if (event.value?.id === result.id) event.value = { ...event.value, cancelled_at: result.cancelled_at }
}
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
.ed { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-5) var(--space-4) var(--space-8); background: var(--surface); }
.ed-title { font-size: 22px; line-height: 30px; font-weight: 600; color: var(--ink); }
.ed-off { text-decoration: line-through; color: var(--ink-quiet); }
.ed-source { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); }
.ed-tag {
  font-size: 12px; line-height: 18px; padding: 0 var(--space-2); border-radius: var(--radius-xs);
  color: var(--ink-soft); box-shadow: inset 0 0 0 1px var(--line-soft);
}
.ed-source-t { font-size: 13px; line-height: 20px; color: var(--ink-soft); }
.ed-banner { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-3); border-radius: var(--radius-sm); background: var(--surface-alt); }
.ed-banner-t { font-size: 14px; line-height: 20px; font-weight: 600; color: var(--ink); }
.ed-banner-note { font-size: 13px; line-height: 20px; color: var(--ink-soft); }
.ed-facts { display: flex; flex-direction: column; gap: var(--space-2); }
.ed-fact { font-size: 15px; line-height: 22px; color: var(--ink); }
.ed-quiet { font-size: 13px; line-height: 20px; color: var(--ink-quiet); }
.ed-checked { font-size: var(--t-caption); line-height: var(--lh-caption); color: var(--ink-quiet); }
.ed-summary { font-size: 15px; line-height: 24px; color: var(--ink); white-space: pre-wrap; }
.ed-author { display: flex; align-items: center; gap: var(--space-3); }
.ed-author-avatar { width: var(--space-7); height: var(--space-7); border-radius: 50%; flex: none; }
.ed-author-copy { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; flex: 1; }
.ed-author-name { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ed-author .ed-verified { align-self: flex-start; font-size: 12px; }
.ed-actions { display: flex; flex-direction: column; gap: var(--space-2); }
.ed-act {
  min-height: 44px; display: flex; align-items: center; justify-content: center; padding: 0 var(--space-4);
  border-radius: var(--radius-sm); box-shadow: inset 0 0 0 1px var(--line-bold); cursor: pointer;
}
.ed-act-t { font-size: 15px; font-weight: 600; color: var(--ink); text-align: center; }
.ed-act-main { background: var(--ink); box-shadow: none; }
.ed-act-main .ed-act-t { color: var(--surface); }
.ed-act-off { box-shadow: inset 0 0 0 1px var(--line-soft); cursor: default; }
.ed-act-off .ed-act-t { color: var(--ink-quiet); font-weight: 400; }
.ed-note { font-size: 12px; line-height: 18px; color: var(--ink-quiet); text-align: center; }
.ed-safety { font-size: 13px; line-height: 20px; color: var(--ink-soft); padding: var(--space-3); border-radius: var(--radius-sm); background: var(--surface-alt); }
.ed-wrong { align-self: flex-start; min-height: 44px; display: flex; align-items: center; font-size: 13px; color: var(--ink-soft); cursor: pointer; }
.ed-state { display: flex; flex-direction: column; align-items: center; gap: var(--space-3); padding: var(--space-8) var(--space-4); }
.ed-state-t { font-size: 15px; line-height: 22px; color: var(--ink-soft); text-align: center; }
.ed-btn {
  min-height: 44px; padding: 0 var(--space-5); border-radius: var(--radius-pill); display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 600; color: var(--ink); box-shadow: inset 0 0 0 1px var(--line-bold); cursor: pointer;
}
/* #ifdef H5 */
@media (min-width: 1024px) {
  .page.secondary-page.has-sidebar { padding-left: 0; }
  .page :deep(.app-sidebar) { display: none; }
  .ev-desktop-header { position: sticky; top: 0; z-index: 30; }
}
/* #endif */
</style>
