<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" @click="goBack"><view class="back-arrow"></view></view>
      <text class="header-title">{{ isPrivacy ? t('legal.privacy') : t('legal.terms') }}</text>
    </view>
    <view class="content">
      <text class="body" v-if="!isPrivacy">{{ t('legal.termsBody') }}</text>
      <text class="body" v-else>{{ t('legal.privacyBody') }}</text>
      <view class="contact-row" @click="onContactEmail">
        <text class="contact-label">{{ t('legal.contactLabel') }}</text>
        <text class="contact-email">{{ contactEmail }}</text>
        <text class="contact-hint">{{ t('legal.contactHint') }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useI18n } from '../../composables/useI18n'

const { t } = useI18n()
const isPrivacy = ref(false)
const contactEmail = 'illini.market.help@gmail.com'

onLoad((options) => {
  if (options?.type === 'privacy') isPrivacy.value = true
})

function goBack() { uni.navigateBack() }

function onContactEmail() {
  // #ifdef H5
  if (typeof window !== 'undefined') {
    window.location.href = `mailto:${contactEmail}`
    return
  }
  // #endif
  uni.setClipboardData({
    data: contactEmail,
    success: () => uni.showToast({ title: t('legal.emailCopied'), icon: 'success' }),
  })
}
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: #fff; max-width: 640px; margin: 0 auto; }
.header {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  padding-top: calc(12px + env(safe-area-inset-top, 0px));
  border-bottom: 0.5px solid rgba(0,0,0,0.06);
}
.back-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.back-arrow { width: 9px; height: 9px; border-left: 2px solid #1a1a1a; border-bottom: 2px solid #1a1a1a; transform: rotate(45deg); margin-left: 4px; }
.header-title { font-size: 17px; font-weight: 600; color: #1a1a1a; }
.content { padding: 20px 16px 40px; }
.body { font-size: 14px; color: #636366; line-height: 1.8; white-space: pre-wrap; }
.contact-row {
  margin-top: 20px; padding: 16px; border-radius: 12px;
  background: #f7f7f8; cursor: pointer;
  &:active { background: #eeeeef; }
}
.contact-label { display: block; font-size: 12px; color: #8e8e93; font-weight: 600; }
.contact-email { display: block; font-size: 15px; color: #1a1a1a; font-weight: 600; margin-top: 4px; text-decoration: underline; }
.contact-hint { display: block; font-size: 11px; color: #aeaeb2; margin-top: 6px; line-height: 1.5; }
</style>
