<template>
  <view class="page" :class="mpThemeClass" :style="mpChrome">
    <view class="card">
      <view class="status-copy" role="status" aria-live="polite">
        <view class="shield" aria-hidden="true"><UIcon name="shield" size="xl" color="brand" /></view>
        <text class="badge">{{ t('auth.profileUnavailableBadge') }}</text>
        <text class="title" role="heading" aria-level="1">{{ t(sessionRecovery ? 'auth.sessionUnavailableTitle' : 'auth.profileUnavailableTitle') }}</text>
        <text class="body">{{ t(sessionRecovery ? 'auth.sessionUnavailableBody' : 'auth.profileUnavailableBody') }}</text>
      </view>

      <view
        :class="['primary', { disabled: retryDisabled }]"
        role="button"
        :tabindex="retryDisabled ? -1 : 0"
        :aria-disabled="retryDisabled ? 'true' : 'false'"
        :aria-label="t(sessionRecovery ? 'home.retry' : 'auth.profileRetry')"
        @click="retry"
        @keydown.enter.prevent="retry"
        @keydown.space.prevent="retry"
      >
        <text>{{ retrying || authState === 'initializing' ? t('auth.profileRetrying') : t(sessionRecovery ? 'home.retry' : 'auth.profileRetry') }}</text>
      </view>
      <view
        v-if="accountControlsAvailable"
        :class="['secondary', { disabled: deleting }]"
        role="button"
        :tabindex="deleting ? -1 : 0"
        :aria-disabled="deleting ? 'true' : 'false'"
        :aria-label="t('profile.signOut')"
        @click="leave"
        @keydown.enter.prevent="leave"
        @keydown.space.prevent="leave"
      >
        <text>{{ t('profile.signOut') }}</text>
      </view>
      <text v-if="accountControlsAvailable" class="privacy-option">{{ t('auth.profileDeleteAvailable') }}</text>
      <view
        v-if="accountControlsAvailable"
        :class="['danger-action', { disabled: deleting || retrying }]"
        role="button"
        :tabindex="deleting || retrying ? -1 : 0"
        :aria-disabled="deleting || retrying ? 'true' : 'false'"
        :aria-label="t('settings.deleteAccount')"
        @click="deleteAccount"
        @keydown.enter.prevent="deleteAccount"
        @keydown.space.prevent="deleteAccount"
      >
        <text>{{ t('settings.deleteAccount') }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { onShow, onHide } from '@dcloudio/uni-app'
import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../composables/useAuth'
import { useSupabase, platformFetch } from '../../composables/useSupabase'
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
import { captureException } from '../../utils/sentry'
import { DIALOG_DANGER } from '../../utils/dialogColors'
import { BASE_URL } from '../../config/runtime'
import {
  accountDeletionOutcomeUnknown,
  requestAccountDeletion,
} from '../../api/accountDeletion'
import {
  captureActiveAccountRequest,
  isAccountRequestCurrent,
  onAccountTransition,
  type AccountRequestToken,
} from '../../composables/accountScope'
import UIcon from '../../components/UIcon.vue'

const { t } = useI18n()
const {
  currentUser,
  authState,
  init,
  profileLoadState,
  awaitAuthReady,
  ensureProfileReady,
  signOut,
} = useAuth()
const { supabase } = useSupabase()
const mpChrome = mpChromeVars()
const retrying = ref(false)
const deleting = ref(false)
let pageAccountToken: AccountRequestToken | null = null
// Unknown-session retries must stay in that mode while init is pending. The
// first discovered identity may bind this page; a later replacement never can.
const sessionRecovery = ref(authState.value !== 'authenticated')
const accountControlsAvailable = ref(false)
let pendingAccountToken = captureActiveAccountRequest()
let mayDiscoverInitialAccount = !pendingAccountToken
let mounted = true
let pageVisible = true
let pageEpoch = 0
let recoveryNavigationStarted = false
let ownsSignOutNavigation = false
let deletionLoadingOwned = false
let completionTimer: ReturnType<typeof setTimeout> | null = null
const retryDisabled = computed(() => (
  retrying.value || deleting.value || authState.value === 'initializing'
  || (!sessionRecovery.value && !accountControlsAvailable.value)
))

function recoveryPageIsCurrent(): boolean {
  if (!mounted || !pageVisible) return false
  try {
    const pages = getCurrentPages() as Array<{ route?: string }>
    return pages[pages.length - 1]?.route === 'pages/profile-recovery/index'
  } catch {
    return false
  }
}

function stopDeletionLoading() {
  if (!deletionLoadingOwned) return
  try { uni.hideLoading() } catch {}
  deletionLoadingOwned = false
}

// The recovery route can remain mounted while another tab signs in. Invalidate
// its controls synchronously so an old retry/sign-out gesture cannot act on the
// replacement account before App.vue's route gate catches up.
const stopAccountTransitionListener = onAccountTransition(() => {
  pageEpoch += 1
  pageAccountToken = null
  accountControlsAvailable.value = false
  pendingAccountToken = mayDiscoverInitialAccount ? captureActiveAccountRequest() : null
  mayDiscoverInitialAccount = false
  retrying.value = false
  deleting.value = false
  stopDeletionLoading()
})

function reconcileRecoveryState() {
  if (!mounted) return
  if (authState.value !== 'authenticated') accountControlsAvailable.value = false
  if (authState.value === 'authenticated') {
    if (pendingAccountToken && isAccountRequestCurrent(pendingAccountToken)) {
      pageAccountToken = pendingAccountToken
      sessionRecovery.value = false
      accountControlsAvailable.value = true
    } else if (
      profileLoadState.value !== 'ready'
      && recoveryPageIsCurrent()
      && !recoveryNavigationStarted
    ) {
      // A replacement account needs a new page. Old modal and click handlers
      // retain their invalidated token instead of acquiring the new account.
      recoveryNavigationStarted = true
      uni.reLaunch({ url: '/pages/profile-recovery/index' })
    }
  } else if (
    authState.value === 'anonymous'
    && !ownsSignOutNavigation
    && recoveryPageIsCurrent()
    && !recoveryNavigationStarted
  ) {
    recoveryNavigationStarted = true
    uni.reLaunch({ url: '/pages/login/index' })
  }
}

function releaseStaleSignOutNavigation(owned: boolean) {
  if (owned) return
  ownsSignOutNavigation = false
  reconcileRecoveryState()
}

function canContinueSignOutNavigation(): boolean {
  if (ownsSignOutNavigation && recoveryPageIsCurrent()) return true
  ownsSignOutNavigation = false
  reconcileRecoveryState()
  return false
}

watch(authState, reconcileRecoveryState, { flush: 'sync' })
onShow(() => {
  pageVisible = true
  reconcileRecoveryState()
})
onHide(() => {
  pageVisible = false
  ownsSignOutNavigation = false
})

async function retry() {
  if (retryDisabled.value || !recoveryPageIsCurrent()) return
  if (sessionRecovery.value) {
    if (authState.value !== 'unavailable') return
    const retryEpoch = pageEpoch
    retrying.value = true
    try {
      await init()
      if (recoveryPageIsCurrent() && retryEpoch === pageEpoch && authState.value === 'unavailable') {
        uni.showToast({ title: t('auth.profileRetryFailed'), icon: 'none', duration: 2600 })
      }
    } finally {
      if (mounted && retryEpoch === pageEpoch) retrying.value = false
    }
    return
  }
  const accountToken = pageAccountToken
  if (!accountToken || !isAccountRequestCurrent(accountToken)) return
  retrying.value = true
  try {
    const ready = await ensureProfileReady({ force: true })
    if (!mounted || !isAccountRequestCurrent(accountToken)) return
    if (!recoveryPageIsCurrent()) return
    if (
      ready
      && profileLoadState.value === 'ready'
      && currentUser.value?.id === accountToken.userId
    ) {
      // App.vue resumes the authorized return or home after applying gates.
      return
    }
    uni.showToast({ title: t('auth.profileRetryFailed'), icon: 'none', duration: 2600 })
  } catch (error) {
    if (!mounted || !isAccountRequestCurrent(accountToken)) return
    if (!recoveryPageIsCurrent()) return
    captureException(error, { tags: { source: 'profile-recovery-retry' }, level: 'warning' })
    uni.showToast({ title: t('auth.profileRetryFailed'), icon: 'none', duration: 2600 })
  } finally {
    if (mounted && isAccountRequestCurrent(accountToken)) retrying.value = false
  }
}

async function leave() {
  if (deleting.value || !accountControlsAvailable.value || !recoveryPageIsCurrent()) return
  const accountToken = pageAccountToken
  if (!accountToken || !isAccountRequestCurrent(accountToken)) return
  ownsSignOutNavigation = true
  const ownsAnonymousContinuation = await signOut({ redirect: false })
  releaseStaleSignOutNavigation(ownsAnonymousContinuation)
  if (!ownsAnonymousContinuation || !mounted) return
  if (!canContinueSignOutNavigation()) return
  uni.reLaunch({ url: '/pages/welcome/index' })
}

function deleteAccount() {
  if (deleting.value || retrying.value || !accountControlsAvailable.value || !recoveryPageIsCurrent()) return
  const accountToken = pageAccountToken
  if (!accountToken || !isAccountRequestCurrent(accountToken)) return
  const dialogEpoch = pageEpoch
  const release = () => {
    if (mounted && pageEpoch === dialogEpoch) deleting.value = false
  }
  deleting.value = true
  uni.showModal({
    title: t('settings.deleteAccountConfirm'),
    content: t('settings.deleteAccountHint'),
    confirmColor: DIALOG_DANGER,
    success: async (res) => {
      if (!res.confirm || !mounted || !isAccountRequestCurrent(accountToken)) {
        release()
        return
      }
      const flowEpoch = pageEpoch
      const flowStillCurrent = () => (
        mounted
        && pageEpoch === flowEpoch
        && isAccountRequestCurrent(accountToken)
      )
      deletionLoadingOwned = true
      uni.showLoading({ title: '...' })
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (
          !session?.access_token
          || session.user.id !== accountToken.userId
          || !flowStillCurrent()
        ) throw new Error('account_changed')

        let endpoint = '/api/auth/delete-account'
        // #ifdef H5
        if (typeof window !== 'undefined' && window.location?.origin) {
          endpoint = window.location.origin + '/api/auth/delete-account'
        }
        // #endif
        // #ifndef H5
        endpoint = `${BASE_URL}/api/auth/delete-account`
        // #endif
        const deletion = await requestAccountDeletion(
          endpoint,
          session.access_token,
          platformFetch,
        )
        if (!flowStillCurrent()) return

        ownsSignOutNavigation = true
        const ownsAnonymousContinuation = await signOut({ redirect: false })
        releaseStaleSignOutNavigation(ownsAnonymousContinuation)
        if (!ownsAnonymousContinuation || !mounted) return
        if (!canContinueSignOutNavigation()) return
        const resultUiEpoch = pageEpoch
        stopDeletionLoading()
        if (deletion.status === 'pending') {
          uni.showModal({
            title: t('settings.deleteAccountPendingTitle'),
            content: t('settings.deleteAccountPending'),
            showCancel: false,
            success: () => {
              if (mounted && resultUiEpoch === pageEpoch && ownsSignOutNavigation && recoveryPageIsCurrent()) {
                uni.reLaunch({ url: '/pages/welcome/index' })
              }
            },
          })
          return
        }

        uni.showToast({
          title: t('settings.deleteAccountDone'),
          icon: 'success',
          duration: 2000,
        })
        completionTimer = setTimeout(() => {
          if (mounted && resultUiEpoch === pageEpoch && ownsSignOutNavigation && recoveryPageIsCurrent()) {
            uni.reLaunch({ url: '/pages/welcome/index' })
          }
        }, 1500)
      } catch (error: any) {
        if (!flowStillCurrent()) return
        captureException(error, { tags: { source: 'profile-recovery-delete-account' } })
        if (accountDeletionOutcomeUnknown(error)) {
          ownsSignOutNavigation = true
          const ownsAnonymousContinuation = await signOut({ redirect: false })
          releaseStaleSignOutNavigation(ownsAnonymousContinuation)
          if (!ownsAnonymousContinuation || !mounted) return
          if (!canContinueSignOutNavigation()) return
          const resultUiEpoch = pageEpoch
          stopDeletionLoading()
          uni.showModal({
            title: t('settings.deleteAccountUnknownTitle'),
            content: t('settings.deleteAccountUnknown'),
            showCancel: false,
            success: () => {
              if (mounted && resultUiEpoch === pageEpoch && ownsSignOutNavigation && recoveryPageIsCurrent()) {
                uni.reLaunch({ url: '/pages/welcome/index' })
              }
            },
          })
          return
        }
        stopDeletionLoading()
        uni.showToast({
          title: error?.message === 'admin_recovery_transfer_required'
            ? t('settings.deleteAccountAdminRecoveryRequired')
            : t('settings.deleteAccountFailed'),
          icon: 'none',
          duration: 3000,
        })
        release()
      }
    },
    fail: release,
  })
}

onMounted(async () => {
  const entryEpoch = pageEpoch
  await awaitAuthReady()
  if (!mounted) return
  reconcileRecoveryState()
  if (
    entryEpoch === pageEpoch
    && recoveryPageIsCurrent()
    && authState.value === 'authenticated'
    && profileLoadState.value === 'ready'
    && isAccountRequestCurrent(pageAccountToken)
    && currentUser.value?.id === pageAccountToken?.userId
  ) {
    uni.$emit('auth:resume-profile-recovery')
  }
})

onUnmounted(() => {
  mounted = false
  if (completionTimer) clearTimeout(completionTimer)
  completionTimer = null
  stopDeletionLoading()
  pageAccountToken = null
  accountControlsAvailable.value = false
  stopAccountTransitionListener()
})
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: calc(28px + var(--mp-status-bar, env(safe-area-inset-top, 0px))) 20px 28px;
  background: var(--paper);
}
.card {
  width: min(100%, 430px);
  box-sizing: border-box;
  padding: 30px 24px 22px;
  border: 1px solid var(--line-hair);
  border-radius: 24px;
  background: var(--bg-elev-1);
  box-shadow: var(--shadow-float);
  text-align: center;
}
.status-copy { display: block; }
.shield {
  width: 62px;
  height: 68px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 22px 22px 28px 28px;
  background: var(--brand-soft);
  border: 1px solid var(--brand-ghost);
}
.badge { display: block; color: var(--brand-deep); font-size: 12px; font-weight: 700; letter-spacing: .04em; }
.title { display: block; margin-top: 10px; color: var(--text-primary); font-size: 24px; font-weight: 750; line-height: 1.25; }
.body { display: block; margin-top: 12px; color: var(--text-muted); font-size: 14px; line-height: 1.65; }
.primary, .secondary, .danger-action {
  min-height: 48px;
  margin-top: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  cursor: pointer;
  font-size: 15px;
  font-weight: 700;
}
.primary { color: var(--ink-inverse); background: var(--brand); }
.primary.disabled, .secondary.disabled, .danger-action.disabled { opacity: .55; cursor: default; }
.secondary { margin-top: 10px; color: var(--text-muted); background: var(--paper-2); }
.privacy-option { display: block; margin-top: 22px; color: var(--text-muted); font-size: 12px; line-height: 1.55; }
.danger-action { margin-top: 10px; color: var(--danger); background: var(--danger-soft); }
</style>
