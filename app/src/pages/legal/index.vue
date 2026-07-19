<template>
  <view class="page" :class="mpThemeClass" :style="mpChrome">
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack"><UIcon name="chevron-left" size="xs" color="accent-primary" /></view>
      <text class="header-title">{{ title }}</text>
    </view>
    <view class="tabs" role="tablist" :aria-label="t('legal.terms')">
      <view
        v-for="tab in tabs"
        :key="tab.type"
        :class="['tab', { active: docType === tab.type }]"
        role="tab"
        :tabindex="docType === tab.type ? 0 : -1"
        :aria-selected="docType === tab.type ? 'true' : 'false'"
        aria-controls="legal-document-panel"
        @click="docType = tab.type"
        @keydown="onLegalTabKeydown($event, tab.type)"
      >
        <text>{{ tab.label }}</text>
      </view>
    </view>
    <scroll-view id="legal-document-panel" class="content" scroll-y :show-scrollbar="false" role="tabpanel">
      <view class="disclaimer">
        <text class="disclaimer-text">{{ disclaimer }}</text>
      </view>
      <text class="body">{{ body }}</text>
      <view class="contact-row" role="button" :aria-label="t('legal.contactLabel') + ': ' + contactEmail" @click="onContactEmail">
        <text class="contact-label">{{ t('legal.contactLabel') }}</text>
        <text class="contact-email">{{ contactEmail }}</text>
        <text class="contact-hint">{{ t('legal.contactHint') }}</text>
      </view>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
import { ref, computed, nextTick } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useI18n } from '../../composables/useI18n'
import {
  TERMS_EN, TERMS_ZH,
  PRIVACY_EN, PRIVACY_ZH,
  GUIDELINES_EN, GUIDELINES_ZH,
  type LegalDocType,
} from '../../legal'
import { SUPPORT_EMAIL } from '../../config/runtime'
import { navigateBackOr } from '../../utils'
import UIcon from '../../components/UIcon.vue'

const { t, lang } = useI18n()
const docType = ref<LegalDocType>('terms')
const contactEmail = SUPPORT_EMAIL

const tabs = computed(() => [
  { type: 'terms' as LegalDocType,      label: t('legal.terms') },
  { type: 'privacy' as LegalDocType,    label: t('legal.privacy') },
  { type: 'guidelines' as LegalDocType, label: t('legal.guidelines') },
])

function onLegalTabKeydown(event: KeyboardEvent, current: LegalDocType) {
  const order: LegalDocType[] = ['terms', 'privacy', 'guidelines']
  let nextIndex = order.indexOf(current)
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (nextIndex + 1) % order.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (nextIndex - 1 + order.length) % order.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = order.length - 1
  else return
  event.preventDefault()
  const tabList = (event.currentTarget as HTMLElement | null)?.parentElement
  docType.value = order[nextIndex]
  nextTick(() => tabList?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus())
}

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

// Short, redundant summary shown above every tab. The material operator and
// liability language also lives in the versioned Terms, so it is covered by
// the consent bundle rather than relying on unversioned page chrome.
const disclaimer = computed(() => lang.value === 'zh'
  ? '香槟集市是 Guoyi (Eric) Xu 运营的社区项目，面向 UIUC 社区的点对点二手集市。平台不持有、不寄送、不担保任何商品，也不保证卖家或商品的真实性、品质与安全；交易与线下面交的风险由买卖双方自行承担。'
  : 'Illini Market is a community project operated by Guoyi (Eric) Xu — a peer-to-peer marketplace for the UIUC community. We do not hold, ship, or guarantee any item, and make no warranty as to the authenticity, quality, or safety of any listing or seller. You transact and meet in person at your own risk.')

onLoad((options) => {
  const t = options?.type
  if (t === 'privacy' || t === 'guidelines' || t === 'terms') {
    docType.value = t as LegalDocType
  }
})

function goBack() { navigateBackOr(() => uni.switchTab({ url: '/pages/index/index' })) }

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
  padding-top: calc(12px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
  border-bottom: 0.5px solid var(--line-hair);
  flex-shrink: 0;
}
.back-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
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
  /* Hard horizontal containment: long URLs / CJK without separators would
     otherwise push the scroll-view past the right edge (H5 <text> elements
     don't shrink to parent like <div>). The inner text still wraps below. */
  box-sizing: border-box;
  width: 100%;
  overflow-x: hidden;
}
.body {
  display: block;
  width: 100%;
  max-width: 100%;
  font-size: 14px; color: var(--text-secondary); line-height: 1.8;
  white-space: pre-wrap;
  /* break-word handles Western long URLs; anywhere handles long CJK runs */
  word-break: break-word;
  overflow-wrap: anywhere;
  -webkit-hyphens: auto;
  hyphens: auto;
}
.disclaimer {
  margin-bottom: 18px; padding: 12px 14px; border-radius: 10px;
  background: var(--bg-elev-2); border-left: 3px solid var(--accent-primary);
}
.disclaimer-text { display: block; font-size: 12.5px; color: var(--text-secondary); line-height: 1.65; }
.contact-row {
  margin-top: 20px; padding: 16px; border-radius: 12px;
  background: var(--bg-elev-2); cursor: pointer;
  &:active { background: var(--bg-inset); }
}
.contact-label { display: block; font-size: 12px; color: var(--text-muted); font-weight: 600; }
.contact-email { display: block; font-size: 15px; color: var(--text-primary); font-weight: 600; margin-top: 4px; text-decoration: underline; }
.contact-hint { display: block; font-size: 11px; color: var(--text-subtle); margin-top: 6px; line-height: 1.5; }
</style>
