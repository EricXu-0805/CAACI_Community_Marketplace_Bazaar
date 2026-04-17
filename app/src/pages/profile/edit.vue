<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" @click="goBack">
        <view class="back-arrow"></view>
      </view>
      <text class="header-title">{{ t('editProfile.title') }}</text>
      <view class="save-btn" @click="onSave">
        <text :class="{ disabled: saving }">{{ saving ? t('login.wait') : t('editProfile.save') }}</text>
      </view>
    </view>

    <view class="form">
      <view class="avatar-section" @click="onChangeAvatar">
        <image :src="avatarUrl || '/static/default-avatar.svg'" class="avatar-preview" />
        <text class="avatar-hint">{{ t('editProfile.changeAvatar') }}</text>
      </view>

      <view class="form-group">
        <text class="label">{{ t('login.nickname') }}</text>
        <input v-model="nickname" :placeholder="t('login.nickname')" class="form-input" maxlength="30" />
      </view>

      <view class="form-group">
        <text class="label">{{ t('editProfile.bio') }}</text>
        <textarea v-model="bio" :placeholder="t('editProfile.bioPlaceholder')" class="form-textarea" maxlength="200" />
      </view>

      <view class="form-group">
        <text class="label">{{ t('publish.location') }}</text>
        <input v-model="location" placeholder="UIUC" class="form-input" maxlength="50" />
        <scroll-view scroll-x class="spot-row">
          <view
            v-for="spot in CAMPUS_SPOTS"
            :key="spot.id"
            class="spot-chip"
            :class="{ active: location === spotLabel(spot) }"
            @click="location = spotLabel(spot)"
          >
            {{ spotLabel(spot) }}
          </view>
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import { useItems } from '../../composables/useItems'
import { useCampusSpots, type CampusSpot } from '../../composables/useCampusSpots'

const { t, lang } = useI18n()
const { currentUser, updateProfile } = useAuth()
const { uploadImages } = useItems()
const { CAMPUS_SPOTS } = useCampusSpots()

function spotLabel(spot: CampusSpot) {
  return lang.value === 'zh' ? spot.zh : spot.en
}

const nickname = ref(currentUser.value?.nickname || '')
const bio = ref(currentUser.value?.bio || '')
const location = ref(currentUser.value?.location || 'UIUC')
const avatarUrl = ref(currentUser.value?.avatar_url || '')
const saving = ref(false)

function goBack() { uni.navigateBack() }

function onChangeAvatar() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: async (res) => {
      const tempPath = res.tempFilePaths[0]
      avatarUrl.value = tempPath
    },
  })
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    p.then(v => { clearTimeout(timer); resolve(v) }, e => { clearTimeout(timer); reject(e) })
  })
}

async function onSave() {
  if (!nickname.value.trim()) {
    uni.showToast({ title: t('login.needNickname'), icon: 'none' })
    return
  }
  if (saving.value) return

  saving.value = true
  const failsafe = setTimeout(() => { saving.value = false }, 20000)

  try {
    let finalAvatar = avatarUrl.value
    if (finalAvatar && !finalAvatar.startsWith('http')) {
      try {
        const urls = await withTimeout(uploadImages([finalAvatar]), 15000, 'avatar upload')
        if (urls.length > 0) {
          finalAvatar = urls[0]
        } else {
          uni.showToast({ title: t('editProfile.avatarFailed'), icon: 'none', duration: 3000 })
          finalAvatar = currentUser.value?.avatar_url || ''
        }
      } catch (uploadErr: any) {
        console.error('Avatar upload error:', uploadErr)
        uni.showToast({ title: uploadErr?.message || t('editProfile.avatarFailed'), icon: 'none', duration: 3000 })
        finalAvatar = currentUser.value?.avatar_url || ''
      }
    }

    const result = await withTimeout(updateProfile({
      nickname: nickname.value.trim(),
      bio: bio.value.trim(),
      location: location.value.trim() || 'UIUC',
      avatar_url: finalAvatar,
    }), 10000, 'profile update')

    if (result?.error) {
      console.error('Profile update error:', result.error)
      uni.showToast({ title: result.error.message || t('profile.markFail'), icon: 'none', duration: 3000 })
      return
    }

    uni.showToast({ title: t('editProfile.saved'), icon: 'success' })
    setTimeout(() => uni.navigateBack(), 1000)
  } catch (err: any) {
    console.error('onSave error:', err)
    uni.showToast({ title: err?.message || t('profile.markFail'), icon: 'none', duration: 3000 })
  } finally {
    clearTimeout(failsafe)
    saving.value = false
  }
}
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: #f2f2f7; max-width: 480px; margin: 0 auto; }

.header {
  display: flex; align-items: center; padding: 12px 16px;
  padding-top: calc(12px + env(safe-area-inset-top, 0px));
  background: #fff; border-bottom: 0.5px solid rgba(0,0,0,0.06);
}
.back-btn {
  width: 32px; height: 32px; display: flex;
  align-items: center; justify-content: center; cursor: pointer;
}
.back-arrow {
  width: 9px; height: 9px;
  border-left: 2px solid #1a1a1a; border-bottom: 2px solid #1a1a1a;
  transform: rotate(45deg); margin-left: 4px;
}
.header-title { flex: 1; text-align: center; font-size: 17px; font-weight: 600; color: #1a1a1a; }
.save-btn {
  cursor: pointer;
  text { font-size: 15px; font-weight: 600; color: #1a1a1a; }
  .disabled { opacity: 0.3; }
}

.form { background: #fff; margin-top: 7px; }
.avatar-section {
  display: flex; flex-direction: column; align-items: center;
  padding: 24px 16px; gap: 8px; cursor: pointer;
}
.avatar-preview {
  width: 72px; height: 72px; border-radius: 50%; background: #f2f2f7;
}
.avatar-hint { font-size: 13px; color: #007AFF; }

.form-group {
  padding: 13px 16px; border-top: 0.5px solid rgba(0,0,0,0.06);
}
.label { font-size: 13px; color: #8e8e93; margin-bottom: 7px; display: block; font-weight: 500; }
.form-input {
  width: 100%; height: 44px; background: #f7f7f8; border-radius: 10px;
  padding: 0 14px; font-size: 15px; color: #1a1a1a;
}
.form-textarea {
  width: 100%; height: 90px; background: #f7f7f8; border-radius: 10px;
  padding: 10px 14px; font-size: 15px; color: #1a1a1a; line-height: 1.5;
}
.spot-row { white-space: nowrap; margin-top: 8px; }
.spot-chip {
  display: inline-block; padding: 6px 12px; margin-right: 8px;
  background: #f2f2f7; color: #1a1a1a; font-size: 13px;
  border-radius: 14px; cursor: pointer;
  &:active { background: #e5e5ea; }
  &.active { background: #1a1a1a; color: #fff; }
}
</style>
