<template>
  <view class="page" :class="mpThemeClass" :style="mpChrome">
    <view
      class="progress"
      role="progressbar"
      aria-valuemin="1"
      :aria-valuemax="totalSteps"
      :aria-valuenow="step"
    >
      <view
        v-for="n in totalSteps"
        :key="n"
        :class="['pdot', { done: step >= n, active: step === n }]"
      ></view>
    </view>

    <view v-if="step === 1" class="step">
      <text class="title">{{ t('onboarding.s1Title') }}</text>
      <text class="sub">{{ t('onboarding.s1Sub') }}</text>
      <view class="field">
        <text class="label">{{ t('login.nickname') }}</text>
        <input
          v-model="nickname"
          :placeholder="t('login.nickname')"
          :aria-label="t('login.nickname')"
          class="input"
          maxlength="40"
          autocomplete="nickname"
        />
        <text v-if="nickname.length >= 35" class="count">{{ nickname.length }}/40</text>
      </view>
    </view>

    <view v-else-if="step === 2" class="step">
      <text class="title">{{ t('onboarding.s2Title') }}</text>
      <text class="sub">{{ t('onboarding.s2Sub') }}</text>
      <view class="chips" role="radiogroup" :aria-label="t('onboarding.s2Title')">
        <view
          v-for="(opt, index) in campusOptions"
          :key="opt"
          :class="['chip', { on: campus === opt }]"
          role="radio"
          :tabindex="campus === opt || (!campus && index === 0) ? 0 : -1"
          :aria-checked="campus === opt ? 'true' : 'false'"
          @click="campus = opt"
          @keydown="onCampusKeydown($event, index)"
        >
          <text class="chip-label">{{ opt }}</text>
        </view>
      </view>
    </view>

    <view v-else-if="step === 3" class="step">
      <text class="title">{{ t('onboarding.s3Title') }}</text>
      <text class="sub">{{ t('onboarding.s3Sub') }}</text>
      <view class="avatar-row">
        <image
          class="avatar-preview"
          :src="avatarUrl || defaultAvatarSrc"
          :alt="nickname || t('app.user')"
          mode="aspectFill"
        />
        <view class="avatar-actions">
          <view class="btn-ghost" role="button" :aria-label="avatarUrl ? t('onboarding.changePhoto') : t('onboarding.addPhoto')" @click="pickAvatar">
            <text>{{ avatarUrl ? t('onboarding.changePhoto') : t('onboarding.addPhoto') }}</text>
          </view>
          <text v-if="avatarUrl" class="skip-hint" role="button" @click="avatarUrl = ''">{{ t('onboarding.noAvatar') }}</text>
        </view>
      </view>
    </view>

    <view class="bottom">
      <view v-if="step > 1" class="btn-ghost half" role="button" :aria-label="t('onboarding.back')" @click="prev">
        <text>{{ t('onboarding.back') }}</text>
      </view>
      <view
        :class="['btn-primary', { half: step > 1, disabled: !canContinue || submitting }]"
        role="button"
        :aria-label="step === totalSteps ? t('onboarding.finish') : t('onboarding.next')"
        :aria-disabled="!canContinue || submitting ? 'true' : 'false'"
        @click="next"
      >
        <text>{{ step === totalSteps ? t('onboarding.finish') : t('onboarding.next') }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../composables/useAuth'
import { useTheme } from '../../composables/useTheme'
import { useSupabase } from '../../composables/useSupabase'
import { useItems, type UploadAccountToken } from '../../composables/useItems'
import { compressImage, friendlyErrorMessage } from '../../utils'
import { CURRENT_CONSENT_VERSION } from '../../legal'
import { captureException } from '../../utils/sentry'
import {
  isDefinitiveMutationRejection,
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

const { t, lang } = useI18n()
const { isDark } = useTheme()
const defaultAvatarSrc = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)
const { currentUser, awaitAuthReady, requireAuth } = useAuth()
const { supabase } = useSupabase()
const { uploadImages, removeOwnedItemImages } = useItems()

const totalSteps = 3
const step = ref(1)
const nickname = ref('')
const campus = ref('')
const avatarUrl = ref('')
const submitting = ref(false)
let pageAccountToken: AccountRequestToken | null = null
let pageEpoch = 0
let pageMounted = true

function resetOnboardingPrivateState() {
  pageEpoch += 1
  pageAccountToken = null
  step.value = 1
  nickname.value = ''
  campus.value = ''
  avatarUrl.value = ''
  submitting.value = false
}

function hydrateOnboardingForUser() {
  const u = currentUser.value
  if (!u) return
  pageAccountToken = captureAccountRequest(u.id)
  nickname.value = u.nickname || ''
  avatarUrl.value = u.avatar_url || ''
  campus.value = u.campus_area || u.location || ''
}

const stopAccountTransitionListener = onAccountTransition(resetOnboardingPrivateState)
onUnmounted(() => {
  pageMounted = false
  resetOnboardingPrivateState()
  stopAccountTransitionListener()
})

const campusOptions = ['UIUC', 'Urbana', 'Champaign', 'Off-campus']

function onCampusKeydown(event: KeyboardEvent, currentIndex: number) {
  let nextIndex = currentIndex
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % campusOptions.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + campusOptions.length) % campusOptions.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = campusOptions.length - 1
  else return
  event.preventDefault()
  const radioGroup = (event.currentTarget as HTMLElement | null)?.parentElement
  campus.value = campusOptions[nextIndex]
  nextTick(() => radioGroup?.querySelectorAll<HTMLElement>('[role="radio"]')[nextIndex]?.focus())
}

onMounted(async () => {
  await awaitAuthReady()
  if (!pageMounted) return
  if (!requireAuth()) return
  hydrateOnboardingForUser()
})

watch(() => currentUser.value?.id ?? null, (userId, previousUserId) => {
  if (userId === previousUserId) return
  if (userId) hydrateOnboardingForUser()
  else resetOnboardingPrivateState()
})

const canContinue = computed(() => {
  if (step.value === 1) return nickname.value.trim().length >= 1
  if (step.value === 2) return campus.value.length > 0
  return true
})

function prev() {
  if (step.value > 1) step.value--
}

async function next() {
  if (!canContinue.value || submitting.value) return
  if (step.value < totalSteps) {
    step.value++
    return
  }
  await finish()
}

async function pickAvatar() {
  await awaitAuthReady()
  if (!requireAuth() || !currentUser.value) return
  const accountToken = captureAccountRequest(currentUser.value.id)
  const pickerEpoch = pageEpoch
  const pickerIsCurrent = () => pickerEpoch === pageEpoch && isAccountRequestCurrent(accountToken)
  try {
    const res = await new Promise<any>((resolve, reject) => {
      uni.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: resolve,
        fail: reject,
      })
    })
    if (!pickerIsCurrent() || !res?.tempFilePaths?.[0]) return
    const compressed = await compressImage(res.tempFilePaths[0], { entryPoint: 'onboarding' })
    if (!pickerIsCurrent()) return
    // Keep a local preview and upload only when Finish is pressed. Uploading
    // here leaked an unreferenced object when the user changed photos, backed
    // out of onboarding, or switched accounts before the last step.
    avatarUrl.value = compressed
  } catch (e: any) {
    if (!pickerIsCurrent()) return
    if (e?.errMsg && /cancel/i.test(e.errMsg)) return
    const title = e?.heic === true ? t('heic.unsupported') : t('onboarding.photoFail')
    uni.showToast({ title, icon: 'none' })
  }
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
        telemetrySource: 'onboarding.mark_compensation',
      })
    } catch (cleanupError) {
      captureException(cleanupError, {
        tags: { source: 'onboarding.mark_compensation', orphan_risk: 'true' },
        level: 'warning',
      })
    }
  } else if (mutationCommitState(error) === 'unknown') {
    // mark_onboarded may already reference the URL. Preserve the object and
    // report the ambiguity instead of creating a broken avatar.
    captureException(error, {
      tags: { source: 'onboarding.mark_commit_unknown', orphan_risk: 'true' },
      extra: { objectCount: 1 },
      level: 'warning',
    })
  }
}

async function finish() {
  if (submitting.value) return
  await awaitAuthReady()
  if (submitting.value) return
  if (!requireAuth() || !currentUser.value) return
  if (!pageAccountToken || !isAccountRequestCurrent(pageAccountToken)) {
    uni.showToast({ title: t('onboarding.saveFail'), icon: 'none', duration: 2500 })
    return
  }
  const submitAccountToken = pageAccountToken
  const submitEpoch = pageEpoch
  submitting.value = true
  const userId = submitAccountToken.userId
  let uploadedAvatarUrl = ''
  let uploadAccountToken: UploadAccountToken | null = null
  let markStarted = false
  let markCommitted = false
  try {
    let finalAvatar = avatarUrl.value
    if (finalAvatar && !finalAvatar.startsWith('http')) {
      const uploaded = await uploadImages([finalAvatar], {
        entryPoint: 'onboarding',
        accountToken: submitAccountToken,
      })
      uploadAccountToken = uploaded.accountToken
      if (!uploaded.urls[0]) throw new Error('Avatar upload failed')
      uploadedAvatarUrl = uploaded.urls[0]
      if (
        uploaded.accountToken.userId !== submitAccountToken.userId
        || uploaded.accountToken.generation !== submitAccountToken.generation
        || submitEpoch !== pageEpoch
        || !isAccountRequestCurrent(submitAccountToken)
      ) {
        throw mutationOutcomeError(new Error('Account changed during onboarding upload'), 'not_committed')
      }
      finalAvatar = uploadedAvatarUrl
    }

    const accountToken = submitAccountToken
    if (accountToken.userId !== userId || submitEpoch !== pageEpoch || !isAccountRequestCurrent(accountToken)) {
      throw mutationOutcomeError(new Error('Account changed before onboarding save'), 'not_committed')
    }

    markStarted = true
    let obErr: any
    try {
      const response = await supabase.rpc('mark_onboarded', {
        nickname_in: nickname.value.trim(),
        campus_in: campus.value,
        avatar_in: finalAvatar || null,
        expected_user_id_in: accountToken.userId,
      })
      obErr = response.error
    } catch (writeError) {
      throw mutationOutcomeError(writeError, 'unknown')
    }
    if (obErr) {
      throw mutationOutcomeError(
        obErr,
        isDefinitiveMutationRejection(obErr) ? 'not_committed' : 'unknown',
      )
    }
    markCommitted = true

    if (submitEpoch !== pageEpoch || !isAccountRequestCurrent(accountToken)) {
      throw mutationOutcomeError(new Error('Account changed after onboarding save'), 'committed')
    }

    let consentErr: any
    try {
      const response = await supabase.rpc('record_consent', {
        version_in: CURRENT_CONSENT_VERSION,
        expected_user_id_in: accountToken.userId,
      })
      consentErr = response.error
    } catch (consentError) {
      throw mutationOutcomeError(consentError, 'committed')
    }
    if (consentErr) throw mutationOutcomeError(consentErr, 'committed')
    if (submitEpoch !== pageEpoch || !isAccountRequestCurrent(accountToken)) {
      throw mutationOutcomeError(new Error('Account changed after consent save'), 'committed')
    }

    uni.showToast({ title: t('onboarding.welcome'), icon: 'success' })
    setTimeout(() => {
      if (submitEpoch === pageEpoch && isAccountRequestCurrent(accountToken)) {
        uni.switchTab({ url: '/pages/index/index' })
      }
    }, 900)
  } catch (e: any) {
    const outcome = mutationCommitState(e)
      ? e
      : mutationOutcomeError(
        e,
        markCommitted ? 'committed' : markStarted ? 'unknown' : 'not_committed',
      )
    await handleUploadedAvatarFailure(outcome, uploadedAvatarUrl, uploadAccountToken)
    if (submitEpoch !== pageEpoch || !isAccountRequestCurrent(submitAccountToken)) return
    uni.showToast({
      title: friendlyErrorMessage(outcome, lang.value as 'en' | 'zh') || t('onboarding.saveFail'),
      icon: 'none',
      duration: 2500,
    })
  } finally {
    if (submitEpoch === pageEpoch && isAccountRequestCurrent(submitAccountToken)) submitting.value = false
  }
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh; background: var(--bg-page);
  display: flex; flex-direction: column;
  padding: 0 24px 24px;
  padding-top: calc(20px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
  padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  max-width: 480px; margin: 0 auto;
}
.progress {
  display: flex; gap: 8px; justify-content: center;
  padding: 8px 0 24px;
}
.pdot {
  width: 24px; height: 4px; border-radius: 2px;
  background: var(--bg-inset);
  transition: background 0.2s, width 0.2s;
  &.done { background: var(--accent-primary); }
  &.active { background: var(--accent-primary); width: 36px; }
}
.step { flex: 1; display: flex; flex-direction: column; gap: 10px; padding-top: 12px; }
.title {
  font-family: var(--font-serif); font-size: 22px; font-weight: 600;
  color: var(--text-primary); letter-spacing: -0.02em;
}
.sub { font-size: 14px; color: var(--text-muted); line-height: 1.5; margin-bottom: 16px; }
.field { display: flex; flex-direction: column; gap: 8px; position: relative; }
.label { font-size: 12px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.input {
  border: 0; border-bottom: 1.5px solid var(--line-soft);
  padding: 10px 0; font-size: 17px; color: var(--text-primary);
  background: transparent; width: 100%;
  /* mp <input> ignores padding-based sizing and clipped the glyphs at the
     underline; explicit box + line height renders identically on H5 */
  height: 44px; line-height: 24px; box-sizing: border-box;
}
.count { font-size: 11px; color: var(--text-subtle); align-self: flex-end; }

.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.chip {
  padding: 10px 16px; border-radius: 18px;
  background: var(--bg-subtle); border: 1px solid transparent;
  cursor: pointer;
  .chip-label { font-size: 14px; color: var(--text-secondary); font-weight: 500; }
  &.on {
    background: var(--ink); border-color: var(--ink);
    .chip-label { color: var(--ink-inverse); }
  }
  &:active { transform: scale(0.96); }
}

.avatar-row { display: flex; align-items: center; gap: 16px; padding: 8px 0; }
.avatar-preview {
  width: 80px; height: 80px; border-radius: 50%;
  background: var(--bg-subtle); flex-shrink: 0;
}
.avatar-actions { display: flex; flex-direction: column; gap: 8px; }
.skip-hint { font-size: 12px; color: var(--text-muted); cursor: pointer; padding: 4px 0; }

.bottom { display: flex; gap: 10px; padding-top: 16px; }
.btn-primary, .btn-ghost {
  flex: 1; text-align: center; padding: 14px;
  border-radius: 22px; font-size: 15px; font-weight: 600;
  cursor: pointer;
}
.btn-primary {
  background: var(--accent-primary); color: #fff;
  box-shadow: var(--shadow-cta);
  &.disabled { opacity: 0.3; pointer-events: none; }
}
.btn-ghost {
  background: var(--bg-subtle); color: var(--text-primary);
  &:active { background: var(--bg-inset); }
}
.btn-primary.half, .btn-ghost.half { flex: 1; }
</style>
