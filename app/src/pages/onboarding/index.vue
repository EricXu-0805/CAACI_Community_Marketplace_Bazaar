<template>
  <view class="page">
    <view class="progress">
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
      <view class="chips">
        <view
          v-for="opt in campusOptions"
          :key="opt"
          :class="['chip', { on: campus === opt }]"
          @click="campus = opt"
        >
          <text>{{ opt }}</text>
        </view>
      </view>
    </view>

    <view v-else-if="step === 3" class="step">
      <text class="title">{{ t('onboarding.s3Title') }}</text>
      <text class="sub">{{ t('onboarding.s3Sub') }}</text>
      <view class="avatar-row">
        <image
          class="avatar-preview"
          :src="avatarUrl || '/static/default-avatar.svg'"
          mode="aspectFill"
        />
        <view class="avatar-actions">
          <view class="btn-ghost" @click="pickAvatar">
            <text>{{ avatarUrl ? t('onboarding.changePhoto') : t('onboarding.addPhoto') }}</text>
          </view>
          <text v-if="avatarUrl" class="skip-hint" @click="avatarUrl = ''">{{ t('onboarding.noAvatar') }}</text>
        </view>
      </view>
    </view>

    <view class="bottom">
      <view v-if="step > 1" class="btn-ghost half" @click="prev">
        <text>{{ t('onboarding.back') }}</text>
      </view>
      <view :class="['btn-primary', { half: step > 1, disabled: !canContinue }]" @click="next">
        <text>{{ step === totalSteps ? t('onboarding.finish') : t('onboarding.next') }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../composables/useAuth'
import { useSupabase } from '../../composables/useSupabase'
import { useItems } from '../../composables/useItems'
import { compressImage } from '../../utils'
import { CURRENT_CONSENT_VERSION } from '../../legal'

const { t } = useI18n()
const { currentUser } = useAuth()
const { supabase } = useSupabase()
const { uploadImages } = useItems()

const totalSteps = 3
const step = ref(1)
const nickname = ref('')
const campus = ref('')
const avatarUrl = ref('')
const submitting = ref(false)

const campusOptions = ['UIUC', 'Urbana', 'Champaign', 'Off-campus']

onMounted(() => {
  const u = currentUser.value
  if (u) {
    nickname.value = u.nickname || ''
    avatarUrl.value = u.avatar_url || ''
    campus.value = u.campus_area || u.location || ''
  }
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
    if (!res?.tempFilePaths?.[0]) return
    const compressed = await compressImage(res.tempFilePaths[0])
    const urls = await uploadImages([compressed])
    if (urls[0]) avatarUrl.value = urls[0]
  } catch (e: any) {
    if (e?.errMsg && /cancel/i.test(e.errMsg)) return
    uni.showToast({ title: t('onboarding.photoFail'), icon: 'none' })
  }
}

async function finish() {
  if (!currentUser.value) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  submitting.value = true
  try {
    const { error: obErr } = await supabase.rpc('mark_onboarded', {
      nickname_in: nickname.value.trim(),
      campus_in: campus.value,
      avatar_in: avatarUrl.value || null,
    })
    if (obErr) throw obErr

    const { error: consentErr } = await supabase.rpc('record_consent', {
      version_in: CURRENT_CONSENT_VERSION,
    })
    if (consentErr) throw consentErr

    uni.showToast({ title: t('onboarding.welcome'), icon: 'success' })
    setTimeout(() => {
      uni.switchTab({ url: '/pages/index/index' })
    }, 900)
  } catch (e: any) {
    uni.showToast({
      title: e?.message || t('onboarding.saveFail'),
      icon: 'none',
      duration: 2500,
    })
  } finally {
    submitting.value = false
  }
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh; background: #fff;
  display: flex; flex-direction: column;
  padding: 0 24px 24px;
  padding-top: calc(20px + env(safe-area-inset-top, 0px));
  padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  max-width: 480px; margin: 0 auto;
}
.progress {
  display: flex; gap: 8px; justify-content: center;
  padding: 8px 0 24px;
}
.pdot {
  width: 24px; height: 4px; border-radius: 2px;
  background: #e8e8ed;
  transition: background 0.2s, width 0.2s;
  &.done { background: #1a1a1a; }
  &.active { background: #1a1a1a; width: 36px; }
}
.step { flex: 1; display: flex; flex-direction: column; gap: 10px; padding-top: 12px; }
.title { font-size: 22px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.02em; }
.sub { font-size: 14px; color: #8e8e93; line-height: 1.5; margin-bottom: 16px; }
.field { display: flex; flex-direction: column; gap: 8px; position: relative; }
.label { font-size: 12px; color: #8e8e93; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.input {
  border: 0; border-bottom: 1.5px solid #e8e8ed;
  padding: 10px 0; font-size: 17px; color: #1a1a1a;
  background: transparent; width: 100%;
}
.count { font-size: 11px; color: #c7c7cc; align-self: flex-end; }

.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.chip {
  padding: 10px 16px; border-radius: 18px;
  background: #f2f2f7; border: 1px solid transparent;
  cursor: pointer;
  text { font-size: 14px; color: #636366; font-weight: 500; }
  &.on {
    background: #1a1a1a; border-color: #1a1a1a;
    text { color: #fff; }
  }
  &:active { transform: scale(0.96); }
}

.avatar-row { display: flex; align-items: center; gap: 16px; padding: 8px 0; }
.avatar-preview {
  width: 80px; height: 80px; border-radius: 50%;
  background: #f2f2f7; flex-shrink: 0;
}
.avatar-actions { display: flex; flex-direction: column; gap: 8px; }
.skip-hint { font-size: 12px; color: #8e8e93; cursor: pointer; padding: 4px 0; }

.bottom { display: flex; gap: 10px; padding-top: 16px; }
.btn-primary, .btn-ghost {
  flex: 1; text-align: center; padding: 14px;
  border-radius: 22px; font-size: 15px; font-weight: 600;
  cursor: pointer;
}
.btn-primary {
  background: #1a1a1a; color: #fff;
  &.disabled { opacity: 0.3; pointer-events: none; }
  &:active { opacity: 0.85; }
}
.btn-ghost {
  background: #f2f2f7; color: #1a1a1a;
  &:active { background: #e5e5ea; }
}
.btn-primary.half, .btn-ghost.half { flex: 1; }
</style>
