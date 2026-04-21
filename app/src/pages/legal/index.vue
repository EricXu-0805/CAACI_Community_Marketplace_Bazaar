<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" @click="goBack"><view class="back-arrow"></view></view>
      <text class="header-title">{{ title }}</text>
    </view>
    <view class="tabs">
      <view
        v-for="tab in tabs"
        :key="tab.type"
        :class="['tab', { active: docType === tab.type }]"
        @click="docType = tab.type"
      >
        <text>{{ tab.label }}</text>
      </view>
    </view>
    <scroll-view class="content" scroll-y :show-scrollbar="false">
      <text class="body">{{ body }}</text>
      <view class="contact-row" @click="onContactEmail">
        <text class="contact-label">{{ t('legal.contactLabel') }}</text>
        <text class="contact-email">{{ contactEmail }}</text>
        <text class="contact-hint">{{ t('legal.contactHint') }}</text>
      </view>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useI18n } from '../../composables/useI18n'
import {
  TERMS_EN, TERMS_ZH,
  PRIVACY_EN, PRIVACY_ZH,
  GUIDELINES_EN, GUIDELINES_ZH,
  type LegalDocType,
} from '../../legal'

const { t, lang } = useI18n()
const docType = ref<LegalDocType>('terms')
const contactEmail = 'illini.market.help@gmail.com'

const tabs = computed(() => [
  { type: 'terms' as LegalDocType,      label: t('legal.terms') },
  { type: 'privacy' as LegalDocType,    label: t('legal.privacy') },
  { type: 'guidelines' as LegalDocType, label: t('legal.guidelines') },
])

const title = computed(() => {
  const tab = tabs.value.find(x => x.type === docType.value)
  return tab ? tab.label : t('legal.terms')
})

const body = computed(() => {
  const zh = lang.value === 'zh'
  if (docType.value === 'privacy')    return zh ? PRIVACY_ZH    : PRIVACY_EN
  if (docType.value === 'guidelines') return zh ? GUIDELINES_ZH : GUIDELINES_EN
  return zh ? TERMS_ZH : TERMS_EN
})

onLoad((options) => {
  const t = options?.type
  if (t === 'privacy' || t === 'guidelines' || t === 'terms') {
    docType.value = t as LegalDocType
  }
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
.page {
  height: 100vh; height: 100dvh;
  display: flex; flex-direction: column;
  background: var(--bg-elev-1); max-width: 640px; margin: 0 auto;
}
.header {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  padding-top: calc(12px + env(safe-area-inset-top, 0px));
  border-bottom: 0.5px solid var(--line-hair);
  flex-shrink: 0;
}
.back-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.back-arrow { width: 9px; height: 9px; border-left: 2px solid var(--accent-primary); border-bottom: 2px solid var(--accent-primary); transform: rotate(45deg); margin-left: 4px; }
.header-title { font-size: 17px; font-weight: 600; color: var(--text-primary); }

.tabs {
  display: flex; gap: 4px;
  padding: 10px 12px 8px;
  border-bottom: 0.5px solid var(--line-hair);
  flex-shrink: 0;
}
.tab {
  flex: 1; text-align: center;
  padding: 8px 6px; border-radius: 8px;
  background: var(--bg-subtle); cursor: pointer;
  text { font-size: 13px; color: var(--text-secondary); font-weight: 500; }
  &:active { background: var(--bg-inset); }
  &.active {
    background: var(--accent-primary);
    text { color: #fff; }
  }
}

.content {
  flex: 1; min-height: 0;
  padding: 20px 16px calc(40px + env(safe-area-inset-bottom, 0px));
}
.body { font-size: 14px; color: var(--text-secondary); line-height: 1.8; white-space: pre-wrap; }
.contact-row {
  margin-top: 20px; padding: 16px; border-radius: 12px;
  background: var(--bg-elev-2); cursor: pointer;
  &:active { background: #eeeeef; }
}
.contact-label { display: block; font-size: 12px; color: var(--text-muted); font-weight: 600; }
.contact-email { display: block; font-size: 15px; color: var(--text-primary); font-weight: 600; margin-top: 4px; text-decoration: underline; }
.contact-hint { display: block; font-size: 11px; color: var(--text-faint); margin-top: 6px; line-height: 1.5; }
</style>
