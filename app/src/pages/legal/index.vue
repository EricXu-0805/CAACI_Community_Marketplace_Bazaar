<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" @click="goBack"><view class="back-arrow"></view></view>
      <text class="header-title">{{ isPrivacy ? t('legal.privacy') : t('legal.terms') }}</text>
    </view>
    <view class="content">
      <text class="body" v-if="!isPrivacy">{{ t('legal.termsBody') }}</text>
      <text class="body" v-else>{{ t('legal.privacyBody') }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useI18n } from '../../composables/useI18n'

const { t } = useI18n()
const isPrivacy = ref(false)

onLoad((options) => {
  if (options?.type === 'privacy') isPrivacy.value = true
})

function goBack() { uni.navigateBack() }
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
.content { padding: 20px 16px; }
.body { font-size: 14px; color: #636366; line-height: 1.8; white-space: pre-wrap; }
</style>
