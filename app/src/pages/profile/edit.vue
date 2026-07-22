<template>
  <view class="page" :class="mpThemeClass" :style="mpChrome">
    <view v-if="profileEditReady" class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack">
        <UIcon name="chevron-left" size="xs" color="accent-primary" />
      </view>
      <text class="header-title">{{ t('editProfile.title') }}</text>
      <view
        class="save-btn"
        role="button"
        :aria-label="t('editProfile.save')"
        :aria-disabled="saving ? 'true' : 'false'"
        @click="onSave"
      >
        <text :class="{ disabled: saving }">{{ saving ? t('login.wait') : t('editProfile.save') }}</text>
      </view>
    </view>

    <view v-if="!profileEditReady" class="auth-check" role="status" aria-live="polite">
      <text>{{ t('login.wait') }}</text>
    </view>

    <view v-if="profileEditReady" class="form">
      <view class="avatar-section" role="button" :aria-label="t('editProfile.changeAvatar')" @click="onChangeAvatar">
        <image :src="avatarUrl || defaultAvatarSrc" :alt="nickname || 'avatar'" class="avatar-preview" mode="aspectFill" />
        <text class="avatar-hint">{{ t('editProfile.changeAvatar') }}</text>
      </view>

      <view class="form-group">
        <text class="label">{{ t('login.nickname') }}</text>
        <input v-model="nickname" :placeholder="t('login.nickname')" :aria-label="t('login.nickname')" class="form-input" maxlength="30" />
      </view>

      <view class="form-group">
        <text class="label">{{ t('editProfile.status') }}</text>
        <view class="status-row">
          <input v-model="statusEmoji" placeholder="🎓" :aria-label="t('editProfile.status')" class="form-input status-emoji" maxlength="4" />
          <input v-model="statusText" :placeholder="t('editProfile.statusPlaceholder')" :aria-label="t('editProfile.statusPlaceholder')" class="form-input status-text" maxlength="60" />
        </view>
      </view>

      <view class="form-group">
        <text class="label">{{ t('editProfile.bio') }}</text>
        <textarea v-model="bio" :placeholder="t('editProfile.bioPlaceholder')" :aria-label="t('editProfile.bio')" class="form-textarea" maxlength="200" />
      </view>

      <view class="form-group">
        <text class="label">{{ t('publish.location') }}</text>
        <input v-model="location" placeholder="UIUC" :aria-label="t('publish.location')" class="form-input" maxlength="50" />
        <scroll-view scroll-x class="spot-row" role="radiogroup" :aria-label="t('publish.location')">
          <view
            v-for="(spot, index) in CAMPUS_SPOTS"
            :key="spot.id"
            class="spot-chip"
            :class="{ active: location === spotLabel(spot) }"
            role="radio"
            :tabindex="location === spotLabel(spot) || (!CAMPUS_SPOTS.some(option => location === spotLabel(option)) && index === 0) ? 0 : -1"
            :aria-checked="location === spotLabel(spot) ? 'true' : 'false'"
            @click="location = spotLabel(spot)"
            @keydown="onSpotKeydown($event, index)"
          >
            {{ spotLabel(spot) }}
          </view>
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
import { ref, computed, onUnmounted, nextTick } from 'vue'
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import { useTheme } from '../../composables/useTheme'
import { useItems, type UploadAccountToken } from '../../composables/useItems'
import { useCampusSpots, type CampusSpot } from '../../composables/useCampusSpots'
import { friendlyErrorMessage, navigateBackOr } from '../../utils'
import { captureException } from '../../utils/sentry'
import {
  mutationCommitState,
  mutationOutcomeError,
  shouldCompensateMutationFailure,
} from '../../api/mutationCommit'
import {
  captureAccountRequest,
  isAccountRequestCurrent,
  onAccountTransition,
  type AccountRequestToken,
} from '../../composables/accountScope'
import UIcon from '../../components/UIcon.vue'

const { t, lang } = useI18n()
const { isDark } = useTheme()
const defaultAvatarSrc = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)
const { currentUser, updateProfile, requireAuth, awaitAuthReady } = useAuth()
const { uploadImages, removeOwnedItemImages } = useItems()
const { CAMPUS_SPOTS } = useCampusSpots()

function spotLabel(spot: CampusSpot) {
  return lang.value === 'zh' ? spot.zh : spot.en
}

function onSpotKeydown(event: KeyboardEvent, currentIndex: number) {
  let nextIndex = currentIndex
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % CAMPUS_SPOTS.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + CAMPUS_SPOTS.length) % CAMPUS_SPOTS.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = CAMPUS_SPOTS.length - 1
  else return
  event.preventDefault()
  const radioGroup = (event.currentTarget as HTMLElement | null)?.parentElement
  location.value = spotLabel(CAMPUS_SPOTS[nextIndex])
  nextTick(() => radioGroup?.querySelectorAll<HTMLElement>('[role="radio"]')[nextIndex]?.focus())
}

const nickname = ref('')
const bio = ref('')
const location = ref('')
const avatarUrl = ref('')
const statusText = ref('')
const statusEmoji = ref('')
const saving = ref(false)
const profileEditReady = ref(false)
let pageAccountToken: AccountRequestToken | null = null
let profileEditMounted = true
let profileEditVisible = false
let profileEditEpoch = 0
let saveOperationEpoch = 0
let saveEntryLocked = false
let profileEditNavigationEpoch = 0
let profileEditDestroyed = false

function hydrateFormFromProfile() {
  const profile = currentUser.value
  if (!profile) return
  nickname.value = profile.nickname || ''
  bio.value = profile.bio || ''
  location.value = profile.location || 'UIUC'
  avatarUrl.value = profile.avatar_url || ''
  statusText.value = profile.status_text || ''
  statusEmoji.value = profile.status_emoji || ''
}

function resetProfilePrivateState() {
  profileEditEpoch += 1
  saveOperationEpoch += 1
  profileEditReady.value = false
  pageAccountToken = null
  saveEntryLocked = false
  saving.value = false
  nickname.value = ''
  bio.value = ''
  location.value = ''
  avatarUrl.value = ''
  statusText.value = ''
  statusEmoji.value = ''
}

async function prepareProfileEditPage() {
  const prepareEpoch = ++profileEditEpoch
  const navigationEpoch = profileEditNavigationEpoch
  profileEditReady.value = false
  // setup() runs before persisted auth/profile hydration on a hard refresh.
  // Initializing refs directly from currentUser therefore produced a blank
  // form that never repaired itself. Hydrate only after auth is authoritative.
  await awaitAuthReady()
  if (
    !profileEditMounted
    || !profileEditVisible
    || prepareEpoch !== profileEditEpoch
    || navigationEpoch !== profileEditNavigationEpoch
  ) return
  if (!requireAuth()) return
  if (!currentUser.value) return
  const accountToken = captureAccountRequest(currentUser.value.id)
  if (!isAccountRequestCurrent(accountToken)) return
  pageAccountToken = accountToken
  hydrateFormFromProfile()
  profileEditReady.value = true
}

const stopAccountTransitionListener = onAccountTransition((transition) => {
  resetProfilePrivateState()
  if (!transition.userId || !profileEditVisible) return
  void Promise.resolve().then(() => {
    if (profileEditMounted && profileEditVisible) return prepareProfileEditPage()
  })
})

function destroyProfileEditPage() {
  if (profileEditDestroyed) return
  profileEditDestroyed = true
  // onUnload is the page-stack boundary; Vue's unmount hook can run later.
  // Close the render gate and invalidate all A-owned callbacks immediately.
  profileEditMounted = false
  profileEditVisible = false
  profileEditNavigationEpoch += 1
  resetProfilePrivateState()
  stopAccountTransitionListener()
}

onShow(() => {
  if (!profileEditMounted) return
  profileEditVisible = true
  if (!profileEditReady.value) void prepareProfileEditPage()
})

onHide(() => {
  profileEditVisible = false
  profileEditNavigationEpoch += 1
})
onUnload(destroyProfileEditPage)

onUnmounted(destroyProfileEditPage)

function goBack() { navigateBackOr(() => uni.switchTab({ url: '/pages/profile/index' })) }

function onChangeAvatar() {
  const pickerAccountToken = pageAccountToken
  if (
    !profileEditReady.value
    || !pickerAccountToken
    || !isAccountRequestCurrent(pickerAccountToken)
  ) return
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: async (res) => {
      if (
        !profileEditReady.value
        || pageAccountToken !== pickerAccountToken
        || !isAccountRequestCurrent(pickerAccountToken)
      ) return
      const tempPath = res.tempFilePaths[0]
      avatarUrl.value = tempPath
    },
  })
}

async function handleUploadedAvatarFailure(
  error: unknown,
  uploadedUrl: string,
  accountToken: UploadAccountToken | null,
): Promise<void> {
  if (!uploadedUrl || !accountToken) return
  if (shouldCompensateMutationFailure(error)) {
    try {
      await removeOwnedItemImages([uploadedUrl], {
        ownerUserId: accountToken.userId,
        telemetrySource: 'profile.update_compensation',
      })
    } catch (cleanupError) {
      captureException(cleanupError, {
        tags: { source: 'profile.update_compensation', orphan_risk: 'true' },
        level: 'warning',
      })
    }
  } else if (mutationCommitState(error) === 'unknown') {
    // Deleting on a response-lost/5xx outcome could break an avatar already
    // referenced by the profile row. Retain it and surface the ambiguity.
    captureException(error, {
      tags: { source: 'profile.update_commit_unknown', orphan_risk: 'true' },
      extra: { objectCount: 1 },
      level: 'warning',
    })
  }
}

async function onSave() {
  if (saveEntryLocked) return
  saveEntryLocked = true
  const operationEpoch = ++saveOperationEpoch
  const operationNavigationEpoch = profileEditNavigationEpoch
  const entryAccountToken = pageAccountToken
  const operationStillCurrent = () => (
    operationEpoch === saveOperationEpoch
    && operationNavigationEpoch === profileEditNavigationEpoch
    && profileEditMounted
    && profileEditVisible
    && profileEditReady.value
    && entryAccountToken !== null
    && pageAccountToken === entryAccountToken
    && isAccountRequestCurrent(entryAccountToken)
  )
  try {
  await awaitAuthReady()
  if (!operationStillCurrent()) return
  if (!requireAuth()) return
  if (!nickname.value.trim()) {
    uni.showToast({ title: t('login.needNickname'), icon: 'none' })
    return
  }
  if (saving.value) return
  if (!operationStillCurrent() || !entryAccountToken) {
    uni.showToast({ title: t('profile.markFail'), icon: 'none', duration: 3000 })
    return
  }

  saving.value = true
  const submitAccountToken = entryAccountToken
  let uploadedAvatarUrl = ''
  let uploadAccountToken: UploadAccountToken | null = null
  let profileMutationStarted = false

  try {
    let finalAvatar = avatarUrl.value
    if (finalAvatar && !finalAvatar.startsWith('http')) {
      try {
        const { urls, accountToken } = await uploadImages([finalAvatar], {
          entryPoint: 'profile',
          accountToken: submitAccountToken,
        })
        uploadAccountToken = accountToken
        uploadedAvatarUrl = urls[0] || ''
        if (
          accountToken.userId !== submitAccountToken.userId
          || accountToken.generation !== submitAccountToken.generation
          || !isAccountRequestCurrent(submitAccountToken)
        ) {
          throw mutationOutcomeError(new Error('Account changed during avatar upload'), 'not_committed')
        }
        if (urls.length > 0) {
          finalAvatar = urls[0]
        } else {
          if (!operationStillCurrent()) {
            throw mutationOutcomeError(new Error('Account changed during avatar upload'), 'not_committed')
          }
          uni.showToast({ title: t('editProfile.avatarFailed'), icon: 'none', duration: 3000 })
          finalAvatar = currentUser.value?.avatar_url || ''
        }
      } catch (uploadErr: any) {
        await handleUploadedAvatarFailure(uploadErr, uploadedAvatarUrl, uploadAccountToken)
        uploadedAvatarUrl = ''
        uploadAccountToken = null
        if (!operationStillCurrent()) throw uploadErr
        console.error('[profile-edit] avatar upload failed')
        const title = uploadErr?.heic === true ? t('heic.unsupported')
          : (uploadErr?.message || t('editProfile.avatarFailed'))
        uni.showToast({ title, icon: 'none', duration: 3000 })
        finalAvatar = currentUser.value?.avatar_url || ''
      }
    }

    profileMutationStarted = true
    const result = await updateProfile(
      {
        nickname: nickname.value.trim(),
        bio: bio.value.trim(),
        location: location.value.trim() || 'UIUC',
        avatar_url: finalAvatar,
        status_text: statusText.value.trim() || null,
        status_emoji: statusEmoji.value.trim() || null,
      },
      { accountToken: submitAccountToken },
    )

    if (result?.error) {
      await handleUploadedAvatarFailure(result.error, uploadedAvatarUrl, uploadAccountToken)
      if (!operationStillCurrent()) return
      console.error('[profile-edit] update failed')
      // friendlyErrorMessage localizes the bio moderation block
      // ('moderation_block:contact_info' from mig 043) instead of leaking
      // the raw sentinel to the user.
      uni.showToast({ title: friendlyErrorMessage(result.error, lang.value as 'en' | 'zh') || t('profile.markFail'), icon: 'none', duration: 3000 })
      return
    }

    if (!operationStillCurrent()) return
    uni.showToast({ title: t('editProfile.saved'), icon: 'success' })
    setTimeout(() => {
      if (operationStillCurrent()) goBack()
    }, 1000)
  } catch (err: any) {
    const outcome = mutationCommitState(err) || !profileMutationStarted
      ? err
      : mutationOutcomeError(err, 'unknown')
    await handleUploadedAvatarFailure(outcome, uploadedAvatarUrl, uploadAccountToken)
    if (!operationStillCurrent()) return
    console.error('[profile-edit] save failed')
    uni.showToast({ title: friendlyErrorMessage(outcome, lang.value as 'en' | 'zh') || t('profile.markFail'), icon: 'none', duration: 3000 })
  } finally {
    if (operationEpoch === saveOperationEpoch) saving.value = false
  }
  } finally {
    if (operationEpoch === saveOperationEpoch) saveEntryLocked = false
  }
}
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: var(--bg-subtle); max-width: 480px; margin: 0 auto; }
.auth-check { min-height: 60vh; display: flex; align-items: center; justify-content: center; color: var(--text-subtle); }

.header {
  display: flex; align-items: center; padding: 12px 16px;
  padding-top: calc(12px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
  background: var(--bg-elev-1); border-bottom: 0.5px solid var(--line-hair);
}
.back-btn {
  width: 32px; height: 32px; display: flex;
  align-items: center; justify-content: center; cursor: pointer;
}
.header-title { flex: 1; text-align: center; font-size: 17px; font-weight: 600; color: var(--text-primary); }
.save-btn {
  cursor: pointer;
  text { font-size: 15px; font-weight: 600; color: var(--text-primary); }
  .disabled { opacity: 0.3; }
}

.form { background: var(--bg-elev-1); margin-top: 7px; }
.avatar-section {
  display: flex; flex-direction: column; align-items: center;
  padding: 24px 16px; gap: 8px; cursor: pointer;
}
.avatar-preview {
  width: 72px; height: 72px; border-radius: 50%; background: var(--bg-subtle);
}
.avatar-hint { font-size: 13px; color: var(--brand); }

.form-group {
  padding: 13px 16px; border-top: 0.5px solid var(--line-hair);
}
.label { font-size: 13px; color: var(--text-muted); margin-bottom: 7px; display: block; font-weight: 500; }
/* box-sizing: border-box keeps width: 100% honest. Without it, the
   horizontal padding adds 28px to the 100% width and the input
   overflows the .form-group container on narrow viewports. */
.form-input {
  box-sizing: border-box;
  width: 100%; height: 44px; background: var(--bg-elev-2); border-radius: 10px;
  padding: 0 14px; font-size: 15px; color: var(--text-primary);
}
.form-textarea {
  box-sizing: border-box;
  width: 100%; height: 90px; background: var(--bg-elev-2); border-radius: 10px;
  padding: 10px 14px; font-size: 15px; color: var(--text-primary); line-height: 1.5;
}
.status-row { display: flex; gap: 8px; }
.status-emoji { width: 56px; flex-shrink: 0; text-align: center; padding: 0; font-size: 20px; }
.status-text { flex: 1; }
.spot-row { white-space: nowrap; margin-top: 8px; }
.spot-chip {
  display: inline-block; padding: 6px 12px; margin-right: 8px;
  background: var(--bg-subtle); color: var(--text-primary); font-size: 13px;
  border-radius: 14px; cursor: pointer;
  &:active { background: var(--bg-inset); }
  &.active { background: var(--accent-primary); color: #fff; }
}
</style>
