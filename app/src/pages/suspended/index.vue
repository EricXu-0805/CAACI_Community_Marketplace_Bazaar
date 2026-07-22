<template>
  <view class="page" :class="mpThemeClass" :style="mpChrome">
    <view class="hero">
      <view :class="['hero-icon', levelClass]"><UIcon name="shield" size="xl" color="currentColor" /></view>
      <text class="hero-badge">{{ t('suspended.badge') }} · L{{ level }}</text>
      <text class="hero-title">{{ titleText }}</text>
      <text class="hero-sub">{{ subText }}</text>
    </view>

    <view class="card" v-if="activeSuspension">
      <view class="row">
        <text class="row-label">{{ t('suspended.level') }}</text>
        <text class="row-value">L{{ activeSuspension.level }} — {{ levelName }}</text>
      </view>
      <view class="row" v-if="activeSuspension.reason">
        <text class="row-label">{{ t('suspended.reason') }}</text>
        <text class="row-value">{{ activeSuspension.reason }}</text>
      </view>
      <view class="row" v-if="endsText">
        <text class="row-label">{{ t('suspended.endsAt') }}</text>
        <text class="row-value">{{ endsText }}</text>
      </view>
      <view class="row" v-if="activeSuspension.category">
        <text class="row-label">{{ t('suspended.category') }}</text>
        <text class="row-value">{{ activeSuspension.category }}</text>
      </view>
    </view>

    <view class="card">
      <text class="card-title">{{ t('suspended.whatHappens') }}</text>
      <text class="card-body">{{ t('suspended.whatHappensBody') }}</text>
    </view>

    <view class="card" v-if="activeSuspension && !appealSubmitted">
      <text class="card-title">{{ t('suspended.appealTitle') }}</text>
      <text class="card-body">{{ t('suspended.appealHint') }}</text>
      <textarea
        v-model="appealText"
        class="appeal-input"
        :placeholder="t('suspended.appealPlaceholder')"
        :aria-label="t('suspended.appealTitle')"
        :maxlength="2000"
      />
      <view class="appeal-meta">
        <text>{{ appealText.length }}/2000</text>
      </view>
      <view
        :class="['btn-primary', { disabled: submittingAppeal || appealText.trim().length < 10 }]"
        role="button" :aria-label="t('suspended.submitAppeal')"
        @click="onSubmitAppeal"
      >
        <text>{{ submittingAppeal ? t('suspended.submitting') : t('suspended.submitAppeal') }}</text>
      </view>
    </view>
    <view class="card notice" v-else-if="activeSuspension && appealSubmitted">
      <text class="card-title">{{ t('suspended.appealSent') }}</text>
      <text class="card-body">{{ t('suspended.appealSentBody') }}</text>
    </view>

    <view class="footer">
      <view class="btn-ghost" role="button" :aria-label="t('suspended.viewTerms')" @click="goLegal">
        <text>{{ t('suspended.viewTerms') }}</text>
      </view>
      <view class="btn-ghost" role="button" :aria-label="t('profile.signOut')" @click="onSignOut">
        <text>{{ t('profile.signOut') }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { onHide, onShow } from '@dcloudio/uni-app'
import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../composables/useAuth'
import { useSupabase } from '../../composables/useSupabase'
import {
  captureActiveAccountRequest,
  captureAccountRequest,
  isAccountRequestCurrent,
  type AccountRequestToken,
} from '../../composables/accountScope'
import { DIALOG_DANGER } from '../../utils/dialogColors'
import { friendlyErrorMessage } from '../../utils'
import { captureException } from '../../utils/sentry'
import {
  SUSPENSION_REFRESH_INTERVAL_MS,
  finiteSuspensionEndMs,
  isSuspensionActive,
  nextSuspensionExpiryDelayMs,
} from '../../utils/suspension'
import UIcon from '../../components/UIcon.vue'

const { t, lang } = useI18n()
const {
  currentUser,
  signOut,
  awaitAuthReady,
  requireAuth,
  ensureProfileReady,
} = useAuth()
const { supabase } = useSupabase()

interface SuspensionRow {
  id: string
  level: number
  reason: string
  category: string
  started_at: string
  ends_at: string | null
  appeal_note: string | null
}

const activeSuspension = ref<SuspensionRow | null>(null)
const appealText = ref('')
const submittingAppeal = ref(false)
const appealSubmitted = ref(false)
let pageMounted = false
let pageVisible = false
let suspensionLoadEpoch = 0
let appealSubmitEpoch = 0
let gateRefreshEpoch = 0
let expiryTimer: ReturnType<typeof setTimeout> | null = null
let periodicRefreshTimer: ReturnType<typeof setTimeout> | null = null

const level = computed(() => currentUser.value?.suspension_level || 0)
const levelClass = computed(() => `level-${Math.min(5, level.value)}`)

const levelName = computed(() => {
  const n = activeSuspension.value?.level ?? level.value
  return t(`suspended.l${n}Name`)
})

const titleText = computed(() => {
  const n = activeSuspension.value?.level ?? level.value
  if (n >= 5) return t('suspended.titlePerma')
  if (n >= 4) return t('suspended.titleLong')
  if (n >= 3) return t('suspended.titleMid')
  return t('suspended.titleShort')
})

const subText = computed(() => {
  if (level.value >= 5) return t('suspended.subPerma')
  return t('suspended.sub')
})

const endsText = computed(() => {
  const ends = activeSuspension.value?.ends_at
  if (!ends || /^infinity$/i.test(ends)) return t('suspended.endsPerma')
  const d = new Date(ends)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return d.toLocaleString(lang.value === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return d.toISOString()
  }
})

onMounted(async () => {
  pageMounted = true
  pageVisible = true
  const state = await awaitAuthReady()
  if (!pageMounted || !pageVisible) return
  if (state === 'anonymous') {
    requireAuth()
    return
  }
  await reconcileSuspensionGate('mounted')
})

onUnmounted(() => {
  pageMounted = false
  pageVisible = false
  suspensionLoadEpoch += 1
  appealSubmitEpoch += 1
  gateRefreshEpoch += 1
  clearRecoveryTimers()
})

onShow(() => {
  pageVisible = true
  if (pageMounted) void reconcileSuspensionGate('show')
})

onHide(() => {
  pageVisible = false
  suspensionLoadEpoch += 1
  gateRefreshEpoch += 1
  clearRecoveryTimers()
})

watch(() => currentUser.value?.id || null, (nextUserId, previousUserId) => {
  if (!pageMounted || nextUserId === previousUserId) return
  // Auth can transition A -> null -> B while this route remains mounted in a
  // second H5 tab. Invalidate both reads and submissions before clearing A's
  // suspension/note from the surface. The non-null B transition loads only B.
  suspensionLoadEpoch += 1
  appealSubmitEpoch += 1
  gateRefreshEpoch += 1
  clearRecoveryTimers()
  activeSuspension.value = null
  appealSubmitted.value = false
  appealText.value = ''
  submittingAppeal.value = false
  if (nextUserId && pageVisible) void reconcileSuspensionGate('account-change')
})

function clearRecoveryTimers() {
  if (expiryTimer) clearTimeout(expiryTimer)
  if (periodicRefreshTimer) clearTimeout(periodicRefreshTimer)
  expiryTimer = null
  periodicRefreshTimer = null
}

function schedulePeriodicRefresh() {
  if (!pageMounted || !pageVisible) return
  if (periodicRefreshTimer) clearTimeout(periodicRefreshTimer)
  periodicRefreshTimer = setTimeout(() => {
    periodicRefreshTimer = null
    void reconcileSuspensionGate('periodic')
  }, SUSPENSION_REFRESH_INTERVAL_MS)
}

function scheduleExpiryRefresh(endsAt: string | null) {
  if (expiryTimer) clearTimeout(expiryTimer)
  expiryTimer = null
  if (!pageMounted || !pageVisible) return
  const delay = nextSuspensionExpiryDelayMs(endsAt)
  // NULL, PostgreSQL infinity, and malformed values are never handed to
  // setTimeout. The minute refresh remains the recovery path for an early lift.
  if (delay === null) return
  if (delay === 0) {
    void reconcileSuspensionGate('expiry')
    return
  }
  expiryTimer = setTimeout(() => {
    expiryTimer = null
    if (!pageMounted || !pageVisible) return
    const nextDelay = nextSuspensionExpiryDelayMs(endsAt)
    if (nextDelay === 0) {
      void reconcileSuspensionGate('expiry')
    } else {
      // Long restrictions exceed the runtime's signed 32-bit timeout. The
      // utility returns a bounded chunk, so schedule the remaining chunk now.
      scheduleExpiryRefresh(endsAt)
    }
  }, delay)
}

function scheduleRecoveryChecks() {
  schedulePeriodicRefresh()
  scheduleExpiryRefresh(activeSuspension.value?.ends_at || null)
}

function isGateRefreshCurrent(
  accountToken: AccountRequestToken,
  requestEpoch: number,
): boolean {
  return pageMounted
    && pageVisible
    && requestEpoch === gateRefreshEpoch
    && isAccountRequestCurrent(accountToken)
    && currentUser.value?.id === accountToken.userId
}

async function reconcileSuspensionGate(source: string): Promise<void> {
  const userId = currentUser.value?.id
  if (!userId || !pageMounted || !pageVisible) return
  const accountToken = captureAccountRequest(userId)
  const requestEpoch = ++gateRefreshEpoch

  try {
    const ready = await ensureProfileReady({
      force: true,
      preserveCurrent: true,
    })
    if (!isGateRefreshCurrent(accountToken, requestEpoch)) return
    if (!ready || !currentUser.value) {
      schedulePeriodicRefresh()
      return
    }

    // get_my_profile is authoritative and computes the currently active state
    // from suspensions. Once it reports no action, leave this gate immediately;
    // App.vue's interceptor will still route re-consent if that is also due.
    if (!isSuspensionActive(currentUser.value)) {
      activeSuspension.value = null
      appealSubmitted.value = false
      clearRecoveryTimers()
      gateRefreshEpoch += 1
      uni.reLaunch({ url: '/pages/index/index' })
      return
    }

    const loaded = await loadActiveSuspension()
    if (!isGateRefreshCurrent(accountToken, requestEpoch)) return
    if (!loaded) {
      schedulePeriodicRefresh()
      return
    }
    scheduleRecoveryChecks()
  } catch (error) {
    if (!isGateRefreshCurrent(accountToken, requestEpoch)) return
    captureException(error, {
      tags: { source: `suspended.reconcile.${source}` },
      level: 'warning',
    })
    schedulePeriodicRefresh()
  }
}

function isSuspensionRequestCurrent(
  accountToken: AccountRequestToken,
  requestEpoch: number,
): boolean {
  return pageMounted
    && pageVisible
    && requestEpoch === suspensionLoadEpoch
    && isAccountRequestCurrent(accountToken)
    && currentUser.value?.id === accountToken.userId
}

async function loadActiveSuspension(): Promise<boolean> {
  const userId = currentUser.value?.id
  if (!userId) return false
  const accountToken = captureAccountRequest(userId)
  const requestEpoch = ++suspensionLoadEpoch
  const queryNow = new Date().toISOString()
  const { data, error } = await supabase
    .from('suspensions')
    .select('id, level, reason, category, started_at, ends_at, appeal_note')
    .eq('profile_id', userId)
    .gte('level', 2)
    .lte('started_at', queryNow)
    .is('lifted_at', null)
    .or(`ends_at.is.null,ends_at.gt.${queryNow}`)
    .order('level', { ascending: false })
    .order('ends_at', { ascending: false, nullsFirst: true })
    .order('started_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!isSuspensionRequestCurrent(accountToken, requestEpoch)) return false
  if (error) {
    captureException(error, { tags: { source: 'suspended.loadActiveSuspension' }, level: 'warning' })
    uni.showToast({ title: t('error.loadFailed'), icon: 'none', duration: 2500 })
    return false
  }
  activeSuspension.value = data ? data as SuspensionRow : null
  appealSubmitted.value = !!data?.appeal_note
  // A row can expire between the PostgREST snapshot and this callback. Do not
  // retain it as active; the authoritative profile refresh will release the
  // route on the next expiry/periodic check.
  const endMs = finiteSuspensionEndMs(activeSuspension.value?.ends_at)
  if (endMs !== null && endMs <= Date.now()) {
    activeSuspension.value = null
    appealSubmitted.value = false
  }
  return true
}

async function reconcileAppealAfterUnknownOutcome(
  accountToken: AccountRequestToken,
  suspensionId: string,
  submitEpoch: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('suspensions')
    .select('id, level, reason, category, started_at, ends_at, appeal_note')
    .eq('id', suspensionId)
    .eq('profile_id', accountToken.userId)
    .maybeSingle()

  if (
    !pageMounted
    || submitEpoch !== appealSubmitEpoch
    || !isAccountRequestCurrent(accountToken)
    || currentUser.value?.id !== accountToken.userId
    || activeSuspension.value?.id !== suspensionId
  ) return false

  if (error) {
    captureException(error, {
      tags: { source: 'suspended.reconcileAppealAfterUnknownOutcome' },
      level: 'warning',
    })
    return false
  }
  if (!data?.appeal_note) return false

  // The RPC is first-write-wins. Any authoritative non-null note means retry
  // must stop, even if the response to our original write was lost or another
  // same-account tab won the race.
  activeSuspension.value = data as SuspensionRow
  appealSubmitted.value = true
  return true
}

async function onSubmitAppeal() {
  if (submittingAppeal.value) return
  const state = await awaitAuthReady()
  if (submittingAppeal.value) return
  if (state === 'anonymous') {
    requireAuth()
    return
  }
  const text = appealText.value.trim()
  if (text.length < 10) {
    uni.showToast({ title: t('suspended.tooShort'), icon: 'none' })
    return
  }
  const userId = currentUser.value?.id
  const suspensionId = activeSuspension.value?.id
  if (!userId || !suspensionId) {
    uni.showToast({ title: t('suspended.appealFail'), icon: 'none' })
    return
  }
  const accountToken = captureAccountRequest(userId)
  if (!isAccountRequestCurrent(accountToken)) {
    uni.showToast({ title: t('suspended.appealFail'), icon: 'none' })
    return
  }
  const submitEpoch = ++appealSubmitEpoch
  submittingAppeal.value = true
  try {
    const { error } = await supabase.rpc('submit_appeal', {
      note_in: text,
      expected_user_id_in: accountToken.userId,
      expected_suspension_id_in: suspensionId,
    })
    if (error) throw error
    if (
      !isAccountRequestCurrent(accountToken)
      || submitEpoch !== appealSubmitEpoch
      || !pageMounted
      || activeSuspension.value?.id !== suspensionId
    ) return
    activeSuspension.value = {
      ...activeSuspension.value,
      appeal_note: text,
    }
    appealSubmitted.value = true
    uni.showToast({ title: t('suspended.appealSent'), icon: 'success' })
  } catch (e: any) {
    if (
      !pageMounted
      || submitEpoch !== appealSubmitEpoch
      || !isAccountRequestCurrent(accountToken)
      || currentUser.value?.id !== accountToken.userId
      || activeSuspension.value?.id !== suspensionId
    ) return

    const committed = await reconcileAppealAfterUnknownOutcome(
      accountToken,
      suspensionId,
      submitEpoch,
    )
    if (committed) {
      uni.showToast({ title: t('suspended.appealSent'), icon: 'success' })
      return
    }
    captureException(e, { tags: { source: 'suspended.onSubmitAppeal' } })
    uni.showToast({ title: friendlyErrorMessage(e, lang.value as 'en' | 'zh') || t('suspended.appealFail'), icon: 'none', duration: 2500 })
  } finally {
    if (pageMounted && submitEpoch === appealSubmitEpoch) {
      submittingAppeal.value = false
    }
  }
}

function goLegal() {
  uni.navigateTo({ url: '/pages/legal/index?type=terms' })
}

function onSignOut() {
  const accountToken = captureActiveAccountRequest()
  if (!accountToken || !isAccountRequestCurrent(accountToken)) return
  uni.showModal({
    title: t('profile.signOut'),
    content: t('suspended.signOutHint'),
    confirmText: t('profile.signOutConfirm'),
    cancelText: t('reconsent.goBack'),
    confirmColor: DIALOG_DANGER,
    success: (r) => {
      // A native dialog can resolve after another tab has switched the shared
      // Supabase session. Bind the confirmation to the account that opened it.
      if (r.confirm && isAccountRequestCurrent(accountToken)) void signOut()
    },
  })
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh; height: 100dvh;
  display: flex; flex-direction: column;
  background: var(--bg-page);
  padding: 0 20px;
  padding-top: calc(28px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
  padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  max-width: 480px; margin: 0 auto;
  overflow-y: auto;
}

.hero { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px 0 20px; }
.hero-icon {
  width: 72px; height: 72px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 4px;
  background: var(--warning-soft); color: var(--warning-text);
}
.hero-icon.level-3 { background: var(--brand-soft); color: var(--accent-action); }
.hero-icon.level-4, .hero-icon.level-5 { background: var(--danger-soft); color: var(--danger); }

.hero-badge {
  font-size: 11px; color: var(--accent-action); font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  padding: 3px 10px; border-radius: var(--radius-pill);
  background: var(--brand-ghost);
}
.hero-title {
  font-family: var(--font-serif); font-size: 22px; font-weight: 600;
  color: var(--text-primary); letter-spacing: -0.02em; text-align: center;
}
.hero-sub { font-size: 14px; color: var(--text-secondary); line-height: 1.5; text-align: center; padding: 0 8px; }

.card {
  background: var(--bg-elev-1); border-radius: 12px;
  padding: 16px; margin-bottom: 12px;
  border: 0.5px solid var(--line-hair);
}
.card.notice { background: var(--success-soft); }
.card-title { display: block; font-size: 14px; font-weight: 700; color: var(--text-primary); margin-bottom: 8px; }
.card-body { display: block; font-size: 13px; color: var(--text-secondary); line-height: 1.55; white-space: pre-wrap; }

.row { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; }
.row-label { font-size: 12px; color: var(--text-muted); font-weight: 500; flex-shrink: 0; }
.row-value { font-size: 13px; color: var(--text-primary); text-align: right; font-weight: 500; }

.appeal-input {
  width: 100%; min-height: 110px;
  border: 1px solid var(--line-soft); border-radius: 10px;
  padding: 12px; font-size: 14px; color: var(--text-primary);
  background: var(--bg-page); margin-top: 10px;
  line-height: 1.5;
  box-sizing: border-box;
}
.appeal-meta { text-align: right; font-size: 11px; color: var(--text-subtle); margin-top: 4px; }

.btn-primary, .btn-ghost {
  text-align: center; padding: 12px;
  border-radius: 22px; font-size: 14px; font-weight: 600;
  cursor: pointer;
}
.btn-primary {
  background: var(--accent-primary); color: #fff;
  margin-top: 10px;
  box-shadow: var(--shadow-cta);
  &.disabled { opacity: 0.3; pointer-events: none; }
}
.btn-ghost {
  flex: 1;
  background: var(--bg-subtle); color: var(--text-secondary);
  &:active { background: var(--bg-inset); }
}

.footer { display: flex; gap: 8px; margin-top: 8px; }
</style>
