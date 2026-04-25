<template>
  <view class="page">
    <view class="header">
      <text class="badge">{{ t('reconsent.badge') }}</text>
      <text class="title">{{ t('reconsent.title') }}</text>
      <text class="sub">{{ t('reconsent.sub') }}</text>
    </view>

    <scroll-view class="body-scroll" scroll-y :show-scrollbar="false">
      <view class="doc-card" @click="openDoc('terms')">
        <view class="doc-icon doc-terms"></view>
        <view class="doc-info">
          <text class="doc-name">{{ t('legal.terms') }}</text>
          <text class="doc-meta">{{ t('reconsent.version') }} {{ termsVersion }}</text>
        </view>
        <view class="doc-chevron"></view>
      </view>
      <view class="doc-card" @click="openDoc('privacy')">
        <view class="doc-icon doc-privacy"></view>
        <view class="doc-info">
          <text class="doc-name">{{ t('legal.privacy') }}</text>
          <text class="doc-meta">{{ t('reconsent.version') }} {{ privacyVersion }}</text>
        </view>
        <view class="doc-chevron"></view>
      </view>
      <view class="doc-card" @click="openDoc('guidelines')">
        <view class="doc-icon doc-guidelines"></view>
        <view class="doc-info">
          <text class="doc-name">{{ t('legal.guidelines') }}</text>
          <text class="doc-meta">{{ t('reconsent.version') }} {{ guidelinesVersion }}</text>
        </view>
        <view class="doc-chevron"></view>
      </view>

      <text class="summary">{{ t('reconsent.summary') }}</text>
    </scroll-view>

    <view class="footer">
      <view class="btn-ghost" @click="onDecline">
        <text>{{ t('reconsent.decline') }}</text>
      </view>
      <view :class="['btn-primary', { disabled: submitting }]" @click="onAccept">
        <text>{{ submitting ? t('reconsent.saving') : t('reconsent.accept') }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { useSupabase } from '../../composables/useSupabase'
import { useAuth } from '../../composables/useAuth'
import {
  TERMS_VERSION,
  PRIVACY_VERSION,
  GUIDELINES_VERSION,
  CURRENT_CONSENT_VERSION,
} from '../../legal'

const { t } = useI18n()
const { supabase } = useSupabase()
const { signOut } = useAuth()

const termsVersion = TERMS_VERSION
const privacyVersion = PRIVACY_VERSION
const guidelinesVersion = GUIDELINES_VERSION
const submitting = ref(false)

function openDoc(type: string) {
  uni.navigateTo({ url: `/pages/legal/index?type=${type}` })
}

async function onAccept() {
  if (submitting.value) return
  submitting.value = true
  try {
    const { error } = await supabase.rpc('record_consent', {
      version_in: CURRENT_CONSENT_VERSION,
    })
    if (error) throw error
    uni.showToast({ title: t('reconsent.saved'), icon: 'success' })
    setTimeout(() => uni.switchTab({ url: '/pages/index/index' }), 800)
  } catch (e: any) {
    uni.showToast({ title: e?.message || t('reconsent.fail'), icon: 'none', duration: 2500 })
  } finally {
    submitting.value = false
  }
}

function onDecline() {
  uni.showModal({
    title: t('reconsent.declineTitle'),
    content: t('reconsent.declineHint'),
    confirmText: t('reconsent.signOut'),
    cancelText: t('reconsent.goBack'),
    confirmColor: 'var(--accent-danger)',
    success: (r) => {
      if (r.confirm) signOut()
    },
  })
}
</script>

<style lang="scss" scoped>
.page {
  height: 100vh; height: 100dvh;
  display: flex; flex-direction: column;
  background: var(--bg-elev-1); max-width: 480px; margin: 0 auto;
}
.header {
  padding: 28px 24px 16px;
  padding-top: calc(28px + var(--status-bar-height, env(safe-area-inset-top, 0px)));
  display: flex; flex-direction: column; gap: 6px;
}
.badge {
  align-self: flex-start;
  padding: 3px 10px; border-radius: 10px;
  background: rgba(199,74,47,0.08);
  font-size: 11px; color: var(--accent-action); font-weight: 700;
  letter-spacing: 0.04em; text-transform: uppercase;
  margin-bottom: 8px;
}
.title { font-size: 22px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.02em; }
.sub { font-size: 14px; color: var(--text-muted); line-height: 1.5; }

.body-scroll { flex: 1; min-height: 0; padding: 16px 20px; }
.doc-card {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 16px; border-radius: 12px;
  background: var(--bg-elev-2); margin-bottom: 10px;
  cursor: pointer;
  &:active { background: #eeeeef; }
}
.doc-icon {
  width: 36px; height: 36px; border-radius: 10px;
  flex-shrink: 0; position: relative;
  background: var(--bg-elev-1);
}
.doc-terms { background: rgba(59,130,246,0.1); }
.doc-terms::before {
  content: ''; position: absolute; top: 9px; left: 11px;
  width: 14px; height: 18px; border: 2px solid #3b82f6;
  border-radius: 2px;
}
.doc-privacy { background: rgba(93, 124, 74, 0.10); }
.doc-privacy::before {
  content: ''; position: absolute; top: 9px; left: 10px;
  width: 16px; height: 14px; border: 2px solid var(--accent-good);
  border-radius: 2px 2px 6px 6px;
}
.doc-privacy::after {
  content: ''; position: absolute; top: 5px; left: 13px;
  width: 10px; height: 10px; border: 2px solid var(--accent-good);
  border-bottom: none; border-radius: 5px 5px 0 0;
}
.doc-guidelines { background: rgba(199,74,47,0.1); }
.doc-guidelines::before {
  content: ''; position: absolute; top: 10px; left: 11px;
  width: 14px; height: 16px; border: 2px solid var(--accent-action);
  border-radius: 2px;
}
.doc-guidelines::after {
  content: ''; position: absolute; top: 14px; left: 14px;
  width: 8px; height: 2px; background: var(--accent-action);
  box-shadow: 0 4px 0 var(--accent-action);
}
.doc-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.doc-name { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.doc-meta { font-size: 12px; color: var(--text-muted); }
.doc-chevron {
  width: 8px; height: 8px;
  border-top: 1.5px solid var(--text-faint); border-right: 1.5px solid var(--text-faint);
  transform: rotate(45deg);
}

.summary {
  display: block; margin-top: 12px; padding: 14px;
  background: var(--warning-soft); border-left: 3px solid var(--accent-warn);
  border-radius: 8px;
  font-size: 13px; color: #8B5000; line-height: 1.55;
}

.footer {
  display: flex; gap: 10px;
  padding: 14px 20px calc(14px + env(safe-area-inset-bottom, 0px));
  border-top: 0.5px solid var(--line-hair);
}
.btn-primary, .btn-ghost {
  flex: 1; text-align: center; padding: 14px;
  border-radius: 22px; font-size: 15px; font-weight: 600;
  cursor: pointer;
}
.btn-primary {
  background: var(--accent-primary); color: #fff;
  &.disabled { opacity: 0.4; pointer-events: none; }
  &:active { opacity: 0.85; }
}
.btn-ghost {
  background: var(--bg-subtle); color: var(--text-secondary);
  &:active { background: var(--bg-inset); }
}
</style>
