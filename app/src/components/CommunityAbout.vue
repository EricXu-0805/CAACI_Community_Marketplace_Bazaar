<template>
  <!-- SPEC 5.2 S4: who runs the site and where its rules are. In the home's sidebar, and beside the lists on desktop. -->
  <view class="ca">
    <text class="ca-h" role="heading" aria-level="2">{{ t('home.about') }}</text>
    <text class="ca-body">{{ t('home.aboutBody') }}</text>
    <view class="ca-links">
      <text class="ca-link" role="button" @click="openLegal('guidelines')">{{ t('legal.guidelines') }}</text>
      <text class="ca-link" role="button" @click="openLegal('terms')">{{ t('legal.terms') }}</text>
      <text class="ca-link" role="button" @click="openLegal('privacy')">{{ t('legal.privacy') }}</text>
      <text class="ca-link" role="button" @click="sendFeedback">{{ t('home.feedback') }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { useI18n } from '../composables/useI18n'
import { SUPPORT_EMAIL } from '../config/runtime'

const { t } = useI18n()
function openLegal(type: 'guidelines' | 'terms' | 'privacy') { uni.navigateTo({ url: `/pages/legal/index?type=${type}` }) }
function sendFeedback() { window.location.href = `mailto:${SUPPORT_EMAIL}` }
</script>

<style lang="scss" scoped>
/* #ifdef H5 */
.ca { background: var(--surface); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); padding: var(--space-4) var(--space-5); }
.ca-h { display: block; margin-bottom: var(--space-1); font-size: var(--t-body); line-height: var(--space-7); font-weight: 600; color: var(--ink); }
.ca-body { display: block; font-size: var(--t-caption); line-height: var(--lh-body); color: var(--ink-soft); }
.ca-links { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); margin-top: var(--space-2); }
.ca-link { font-size: var(--t-caption); line-height: var(--space-5); color: var(--ink-soft); cursor: pointer; }
/* #endif */
</style>
