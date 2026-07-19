<template>
  <view class="page" :class="mpThemeClass" :style="mpChrome">
    <view class="card">
      <view class="status-copy" role="status" aria-live="polite">
        <view class="shield" aria-hidden="true"><UIcon name="shield" size="xl" color="brand" /></view>
        <text class="badge">{{ t('auth.profileUnavailableBadge') }}</text>
        <text class="title">{{ t('auth.profileUnavailableTitle') }}</text>
        <text class="body">{{ t('auth.profileUnavailableBody') }}</text>
      </view>

      <view
        :class="['primary', { disabled: retrying || deleting }]"
        role="button"
        :tabindex="retrying || deleting ? -1 : 0"
        :aria-disabled="retrying || deleting ? 'true' : 'false'"
        :aria-label="t('auth.profileRetry')"
        @click="retry"
        @keydown.enter.prevent="retry"
        @keydown.space.prevent="retry"
      >
        <text>{{ retrying ? t('auth.profileRetrying') : t('auth.profileRetry') }}</text>
      </view>
      <view
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
      <text class="privacy-option">{{ t('auth.profileDeleteAvailable') }}</text>
      <view
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
import { ref, onMounted, onUnmounted } from 'vue'
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
let mounted = true
let pageEpoch = 0
let deletionLoadingOwned = false
let completionTimer: ReturnType<typeof setTimeout> | null = null

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
  retrying.value = false
  deleting.value = false
  stopDeletionLoading()
})

async function retry() {
  if (retrying.value || deleting.value) return
  const accountToken = pageAccountToken
  if (!accountToken || !isAccountRequestCurrent(accountToken)) return
  retrying.value = true
  try {
    const ready = await ensureProfileReady({ force: true })
    if (!mounted || !isAccountRequestCurrent(accountToken)) return
    if (
      ready
      && profileLoadState.value === 'ready'
      && currentUser.value?.id === accountToken.userId
    ) {
      // App.vue's navigation interceptor applies suspension/re-consent next.
      uni.reLaunch({ url: '/pages/index/index' })
      return
    }
    uni.showToast({ title: t('auth.profileRetryFailed'), icon: 'none', duration: 2600 })
  } catch (error) {
    if (!mounted || !isAccountRequestCurrent(accountToken)) return
    captureException(error, { tags: { source: 'profile-recovery-retry' }, level: 'warning' })
    uni.showToast({ title: t('auth.profileRetryFailed'), icon: 'none', duration: 2600 })
  } finally {
    if (mounted && isAccountRequestCurrent(accountToken)) retrying.value = false
  }
}

async function leave() {
  if (deleting.value) return
  const accountToken = pageAccountToken
  if (!accountToken || !isAccountRequestCurrent(accountToken)) return
  const ownsAnonymousContinuation = await signOut({ redirect: false })
  if (!ownsAnonymousContinuation || !mounted) return
  uni.reLaunch({ url: '/pages/welcome/index' })
}

function deleteAccount() {
  if (deleting.value || retrying.value) return
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

        const ownsAnonymousContinuation = await signOut({ redirect: false })
        if (!ownsAnonymousContinuation || !mounted) return
        const resultUiEpoch = pageEpoch
        stopDeletionLoading()
        if (deletion.status === 'pending') {
          uni.showModal({
            title: t('settings.deleteAccountPendingTitle'),
            content: t('settings.deleteAccountPending'),
            showCancel: false,
            success: () => {
              if (mounted && resultUiEpoch === pageEpoch) {
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
          if (mounted && resultUiEpoch === pageEpoch) {
            uni.reLaunch({ url: '/pages/welcome/index' })
          }
        }, 1500)
      } catch (error: any) {
        if (!flowStillCurrent()) return
        captureException(error, { tags: { source: 'profile-recovery-delete-account' } })
        if (accountDeletionOutcomeUnknown(error)) {
          const ownsAnonymousContinuation = await signOut({ redirect: false })
          if (!ownsAnonymousContinuation || !mounted) return
          const resultUiEpoch = pageEpoch
          stopDeletionLoading()
          uni.showModal({
            title: t('settings.deleteAccountUnknownTitle'),
            content: t('settings.deleteAccountUnknown'),
            showCancel: false,
            success: () => {
              if (mounted && resultUiEpoch === pageEpoch) {
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
  const state = await awaitAuthReady()
  if (!mounted) return
  if (state === 'anonymous') {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  pageAccountToken = captureActiveAccountRequest()
  if (profileLoadState.value === 'ready' && currentUser.value) {
    uni.reLaunch({ url: '/pages/index/index' })
  }
})

onUnmounted(() => {
  mounted = false
  if (completionTimer) clearTimeout(completionTimer)
  completionTimer = null
  stopDeletionLoading()
  pageAccountToken = null
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
.primary { color: #fff; background: var(--brand); }
.primary.disabled, .secondary.disabled, .danger-action.disabled { opacity: .55; cursor: default; }
.secondary { margin-top: 10px; color: var(--text-muted); background: var(--paper-2); }
.privacy-option { display: block; margin-top: 22px; color: var(--text-muted); font-size: 12px; line-height: 1.55; }
.danger-action { margin-top: 10px; color: var(--danger); background: var(--danger-soft); }
</style>
