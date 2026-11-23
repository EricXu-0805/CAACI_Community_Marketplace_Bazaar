<template>
  <view class="page secondary-page secondary-page--reading has-sidebar" :class="mpThemeClass" :style="mpChrome">
    <!-- #ifdef H5 -->
    <AppSidebar current="plaza" />
    <!-- #endif -->
    <view class="secondary-content">
      <!-- #ifndef H5 -->
      <AppToast />
      <!-- #endif -->
      <view class="me-header">
        <UButton variant="ghost" :aria-label="t('a11y.back')" @click="goBack">
          <UIcon name="chevron-left" size="xs" color="accent-primary" />
        </UButton>
        <text class="me-title" role="heading" aria-level="1">{{ t('events.create') }}</text>
      </view>
      <view v-if="loading" class="me-state" aria-busy="true">{{ t('home.loading') }}</view>
      <view v-else-if="!creationOpen" class="me-state">
        <text role="status">{{ t('events.err.closed') }}</text>
        <UButton variant="ghost" @click="goBack">{{ t('events.backToList') }}</UButton>
      </view>
      <view v-else-if="currentUser && !currentUser.is_illini_verified" class="me-state">
        <text>{{ t('events.needVerify') }}</text>
        <UButton @click="verify">{{ t('events.goVerify') }}</UButton>
      </view>
      <view v-else-if="currentUser" class="me-form" role="form" :aria-label="t('events.create')">
        <view v-for="field in fields" :key="field" class="me-field" :data-field="field">
          <label :for="`me-${field}`" class="me-label">{{ t(`events.form.${field}`) }}</label>
          <view v-if="field === 'startsAt' || field === 'endsAt'" class="me-date-row">
            <template v-for="part in parts" :key="part">
              <!-- #ifdef H5 -->
              <view class="me-date-input">
                <component :is="'input'" :id="part === 'date' ? `me-${field}` : `me-${field}-time`"
                  :class="['me-control', { 'me-empty': !draft[timeFields[field][part]] }]"
                  :type="part" :value="draft[timeFields[field][part]]" :disabled="submitting"
                  :aria-label="`${t(`events.form.${field}`)} ${t(`events.form.${part}`)}`"
                  :aria-describedby="errors[field] ? `me-${field}-error` : undefined"
                  @input="nativeInput(timeFields[field][part], $event)" />
                <text v-if="!draft[timeFields[field][part]]" class="me-date-placeholder" aria-hidden="true">{{ t(`events.form.${part}`) }}</text>
              </view>
              <!-- #endif -->
              <!-- #ifndef H5 -->
              <picker class="me-date-picker" :mode="part" :value="draft[timeFields[field][part]]" :disabled="submitting"
                :aria-label="`${t(`events.form.${field}`)} ${t(`events.form.${part}`)}`"
                @change="draft[timeFields[field][part]] = $event.detail.value">
                <view class="me-control" role="button">{{ draft[timeFields[field][part]] || t(`events.form.${part}`) }}</view>
              </picker>
              <!-- #endif -->
            </template>
          </view>
          <template v-else>
            <!-- #ifdef H5 -->
            <component :is="field === 'content' ? 'textarea' : 'input'" :id="`me-${field}`"
              :class="['me-control', { 'me-content': field === 'content' }]" :value="draft[field]" :disabled="submitting"
              :aria-label="t(`events.form.${field}`)" :placeholder="t(`events.form.${field}Placeholder`)"
              :aria-describedby="errors[field] ? `me-${field}-error` : field === 'location' ? 'me-location-hint' : undefined"
              @input="nativeInput(field, $event)" />
            <!-- #endif -->
            <!-- #ifndef H5 -->
            <textarea v-if="field === 'content'" :id="`me-${field}`" v-model="draft.content"
              class="me-control me-content" :maxlength="-1" :disabled="submitting" :aria-label="t('events.form.content')" :placeholder="t('events.form.contentPlaceholder')" />
            <input v-else :id="`me-${field}`" v-model="draft[field]" class="me-control" :maxlength="-1"
              :disabled="submitting" :aria-label="t(`events.form.${field}`)" :placeholder="t(`events.form.${field}Placeholder`)" />
            <!-- #endif -->
          </template>
          <text v-if="field === 'location'" id="me-location-hint" class="me-hint">{{ t('events.form.locationHint') }}</text>
          <text v-if="errors[field]" :id="`me-${field}-error`" class="me-error" role="alert">{{ errors[field] }}</text>
        </view>
        <text v-if="draftSaveFailed" class="me-error" role="status">{{ t('publish.draftSaveFailed') }}</text>
        <text v-if="formError" class="me-error" role="alert">{{ formError }}</text>
        <UButton :loading="submitting" block class="me-submit" @click="submit"
          @keydown.enter.prevent="submit" @keydown.space.prevent="submit">{{ t('events.create') }}</UButton>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
// #ifdef H5
import AppSidebar from '../../../components/AppSidebar.vue'
// #endif
// #ifndef H5
import AppToast from '../../../components/AppToast.vue'
// #endif
import { onUnmounted, ref } from 'vue'
import { onHide, onShow } from '@dcloudio/uni-app'
import UButton from '../../../components/UButton.vue'
import UIcon from '../../../components/UIcon.vue'
import { useAuth } from '../../../composables/useAuth'
import { useI18n } from '../../../composables/useI18n'
import { useCommunityEvents } from '../../../composables/useCommunityEvents'
import { captureActiveAccountRequest, isAccountRequestCurrent, onAccountTransition } from '../../../composables/accountScope'
import { MemberEventError, memberEventErrorKey, useMemberEventWrites, type MemberEventField } from '../useMemberEventWrites'
import { mpChromeVars, mpThemeClass } from '../../../composables/useMpChrome'
import { friendlyErrorMessage, navigateBackOr } from '../../../utils'
import { campusDateStringNoIntl, campusPartsNoIntl, campusWallClockToInstant } from '../../../utils/campusTime'
import { mutationCommitState } from '../../../api/mutationCommit'
import { useMemberEventDraft } from './useMemberEventDraft'

const mpChrome = mpChromeVars()
const { t, lang } = useI18n()
const { awaitAuthReady, currentUser, requireAuth } = useAuth()
const { memberEventsOpen } = useCommunityEvents()
const { createMemberEvent } = useMemberEventWrites()
const stored = useMemberEventDraft()
const { draft } = stored
const fields = ['title', 'startsAt', 'endsAt', 'location', 'content'] as const
const parts = ['date', 'time'] as const
const timeFields = { startsAt: { date: 'startDate', time: 'startTime' }, endsAt: { date: 'endDate', time: 'endTime' } } as const
const loading = ref(true), creationOpen = ref(false), submitting = ref(false)
const errors = ref<Partial<Record<MemberEventField, string>>>({})
const formError = ref('')
const draftSaveFailed = ref(false)
let epoch = 0
let visible = false

async function initialize() {
  const mine = ++epoch
  loading.value = true
  try {
    await awaitAuthReady()
    if (mine !== epoch || !visible) return
    const open = await memberEventsOpen()
    if (mine !== epoch) return
    creationOpen.value = open
    if (!open || !requireAuth('/pages/event/create/index', 'redirectTo')) return
    if (currentUser.value?.is_illini_verified) stored.restore()
  } finally {
    if (mine === epoch) loading.value = false
  }
}
onShow(() => { visible = true; void initialize() })
onHide(() => { visible = false; epoch += 1; submitting.value = false })
const unsubscribe = onAccountTransition(() => {
  submitting.value = false
  errors.value = {}
  formError.value = ''
  draftSaveFailed.value = false
  if (visible) void initialize()
})
onUnmounted(() => { visible = false; epoch += 1; unsubscribe() })
function goBack() { navigateBackOr(() => uni.redirectTo({ url: '/pages/events/index' })) }
function verify() { uni.navigateTo({ url: '/pages/illini-verify/index' }) }

// #ifdef H5
function nativeInput(field: Exclude<keyof typeof draft.value, 'postId' | 'outcomeUncertain'>, event: Event) {
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) draft.value[field] = target.value
}
// #endif
function campusIso(date: string, time: string): string {
  const instant = campusWallClockToInstant(date, time)
  if (!instant) return ''
  const { hour, minute } = campusPartsNoIntl(instant)
  const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  return campusDateStringNoIntl(instant) === date && clock === time ? instant.toISOString() : ''
}
async function submit() {
  const token = captureActiveAccountRequest()
  if (!token || submitting.value || !stored.isCurrent()) return
  const mine = epoch
  const current = () => mine === epoch && isAccountRequestCurrent(token)
  errors.value = {}
  formError.value = ''
  draftSaveFailed.value = !stored.persist()
  submitting.value = true
  try {
    const result = await createMemberEvent({
      postId: draft.value.postId, title: draft.value.title, content: draft.value.content, location: draft.value.location,
      startsAt: campusIso(draft.value.startDate, draft.value.startTime),
      endsAt: draft.value.endDate || draft.value.endTime ? campusIso(draft.value.endDate, draft.value.endTime) : null,
    })
    if (!current()) return
    stored.clear()
    uni.redirectTo({ url: `/pages/event/detail/index?id=${encodeURIComponent(result.event_id)}` })
  } catch (error) {
    if (!(error instanceof Error)) throw error
    if (!current()) return
    const key = memberEventErrorKey(error)
    const message = key ? t(key) : friendlyErrorMessage(error, lang.value === 'zh' ? 'zh' : 'en') || t('error.actionFailed')
    if (error instanceof MemberEventError && error.field) errors.value[error.field] = message
    else formError.value = message
    if (mutationCommitState(error) === 'unknown') draft.value.outcomeUncertain = true
    if (!stored.persist()) draftSaveFailed.value = true
  } finally {
    if (current()) submitting.value = false
  }
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--canvas); color: var(--ink); }
.me-header { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-3) var(--space-4); padding-top: calc(var(--space-3) + var(--mp-status-bar, env(safe-area-inset-top, 0px))); background: var(--surface); }
.me-title { font-size: 22px; font-weight: 600; }
.me-form { max-width: 680px; margin: 0 auto; padding: var(--space-5) var(--space-4) calc(var(--space-8) + env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; gap: var(--space-5); box-sizing: border-box; }
.me-field { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.me-label { color: var(--ink); font-size: 15px; font-weight: 600; line-height: 24px; }
.me-control { width: 100%; min-width: 0; min-height: 44px; box-sizing: border-box; padding: var(--space-3); border: 1px solid var(--line-bold); border-radius: var(--radius-sm); color: var(--ink); background: var(--surface); font: inherit; font-size: 15px; line-height: 22px; caret-color: var(--brand); }
.me-control::placeholder { color: var(--ink-quiet); opacity: 1; }
.me-control:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.me-content { min-height: 132px; resize: vertical; }
.me-date-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
.me-date-picker { min-width: 0; }
.me-hint { font-size: 13px; line-height: 20px; color: var(--ink-soft); }
.me-error { color: var(--danger); font-size: 14px; line-height: 22px; overflow-wrap: anywhere; }
.me-state { display: flex; flex-direction: column; align-items: center; gap: var(--space-4); padding: var(--space-8) var(--space-4); text-align: center; }
.me-submit.u-btn { box-shadow: none; }
/* #ifdef H5 */
.me-control { color-scheme: light dark; }
.me-date-input { position: relative; min-width: 0; }
.me-empty:not(:focus) { color: transparent; -webkit-text-fill-color: transparent; }
.me-date-placeholder { position: absolute; inset-inline-start: var(--space-3); top: 50%; transform: translateY(-50%); color: var(--ink-quiet); font-size: 15px; pointer-events: none; }
.me-control:focus + .me-date-placeholder { display: none; }
:global(html[data-theme="dark"]) .me-control { color-scheme: dark; }
:global(html[data-theme="light"]) .me-control { color-scheme: light; }
/* #endif */
</style>
