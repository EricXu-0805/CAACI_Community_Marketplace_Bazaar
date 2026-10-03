<template>
  <view class="support" data-private="true">
    <view class="support-heading" role="button" tabindex="0" :aria-expanded="expanded ? 'true' : 'false'" aria-controls="admin-support-panel" @click="toggleOpen">
      <text class="support-title">{{ t('admin.support.title') }}</text>
      <text class="support-toggle">{{ expanded ? t('admin.support.close') : t('admin.support.open') }}</text>
    </view>
    <view v-if="expanded" id="admin-support-panel" class="support-panel">
      <text class="support-copy">{{ t('admin.support.intro') }}</text>
      <view class="support-actions">
        <view class="support-button" role="button" tabindex="0" @click="openGmail">{{ t('admin.support.gmail') }}</view>
      </view>
      <text class="support-hint">{{ t('admin.support.gmailHint') }}</text>

      <view v-if="state.requestId" class="support-result" role="status" aria-live="polite">
        <text class="support-title">{{ t('admin.support.status.' + (state.busy ? 'sending' : state.receipt?.status || 'unknown')) }}</text>
        <text>{{ t('admin.support.from') }}: {{ SUPPORT_FROM }}</text>
        <template v-if="state.receipt">
          <text class="support-wrap">{{ t('admin.support.to') }}: {{ state.receipt.to }}</text>
          <text class="support-wrap">{{ t('admin.support.subject') }}: {{ state.receipt.subject }}</text>
          <text>{{ t('admin.support.createdAt') }}: {{ state.receipt.created_at }}</text>
        </template>
        <text class="support-wrap" selectable>{{ t('admin.support.requestId') }}: {{ state.requestId }}</text>
        <text v-if="state.receipt?.provider_id" class="support-wrap" selectable>{{ t('admin.support.providerId') }}: {{ state.receipt.provider_id }}</text>
        <text>{{ t('admin.support.outcome.' + (state.receipt?.status || 'unknown')) }}</text>
        <text class="support-hint">{{ t('admin.support.recordsHint') }}</text>
        <view class="support-actions">
          <view class="support-button" :class="{ 'support-disabled': state.busy || state.checking }" role="button" :tabindex="state.busy || state.checking ? -1 : 0" :aria-disabled="state.busy || state.checking ? 'true' : 'false'" @click="controller.checkReceipt()">{{ state.checking ? t('admin.support.checkingReceipt') : t('admin.support.checkReceipt') }}</view>
          <view class="support-button" role="button" tabindex="0" @click="openRecords">{{ t('admin.support.records') }}</view>
          <view v-if="terminalReceipt" class="support-button" :class="{ 'support-disabled': state.busy || state.checking }" role="button" :tabindex="state.busy || state.checking ? -1 : 0" :aria-disabled="state.busy || state.checking ? 'true' : 'false'" @click="controller.finish()">{{ t('admin.support.finish') }}</view>
        </view>
      </view>

      <template v-else>
        <view v-if="state.availability !== 'available'" class="support-notice" role="status" aria-live="polite">
          <text>{{ state.availability === 'loading' ? t('admin.support.loading') : t('admin.support.unavailable') }}</text>
          <view class="support-button" :class="{ 'support-disabled': state.availability === 'loading' }" role="button" :tabindex="state.availability === 'loading' ? -1 : 0" :aria-disabled="state.availability === 'loading' ? 'true' : 'false'" @click="controller.refreshAvailability()">{{ t('admin.support.checkAvailability') }}</view>
        </view>
        <view v-else class="support-form">
          <text class="support-fixed">{{ t('admin.support.from') }}: {{ SUPPORT_FROM }}</text>
          <text class="support-hint">{{ t('admin.support.replyTo') }}: {{ SUPPORT_FROM }}</text>
          <text id="support-to-label" class="support-label">{{ t('admin.support.to') }}</text>
          <input :value="state.draft.to" class="support-input" type="text" inputmode="email" autocomplete="off" autocapitalize="none" autocorrect="off" :spellcheck="false" :maxlength="254" aria-labelledby="support-to-label" :aria-invalid="state.error === 'recipient' ? 'true' : 'false'" :placeholder="t('admin.support.toHint')" @input="updateField('to', $event)" />
          <text id="support-subject-label" class="support-label">{{ t('admin.support.subject') }}</text>
          <input :value="state.draft.subject" class="support-input" autocomplete="off" :maxlength="200" aria-labelledby="support-subject-label" :aria-invalid="state.error === 'subject' ? 'true' : 'false'" :placeholder="t('admin.support.subjectHint')" @input="updateField('subject', $event)" />
          <text id="support-context-label" class="support-label">{{ t('admin.support.context') }}</text>
          <textarea :value="state.draft.context" class="support-textarea support-context" :maxlength="10000" autocomplete="off" aria-labelledby="support-context-label" :placeholder="t('admin.support.contextHint')" @input="updateField('context', $event)" />
          <text class="support-hint">{{ t('admin.support.contextLocal') }}</text>
          <text id="support-text-label" class="support-label">{{ t('admin.support.text') }}</text>
          <textarea :value="state.draft.text" class="support-textarea" :maxlength="10000" autocomplete="off" aria-labelledby="support-text-label" :aria-invalid="state.error === 'text' ? 'true' : 'false'" :placeholder="t('admin.support.textHint')" @input="updateField('text', $event)" />
          <text class="support-hint">{{ t('admin.support.plaintext') }}</text>
          <view class="support-advanced-toggle" role="button" tabindex="0" :aria-expanded="advanced ? 'true' : 'false'" aria-controls="support-advanced" @click="advanced = !advanced">{{ t('admin.support.advanced') }}</view>
          <view v-if="advanced" id="support-advanced" class="support-advanced">
            <text id="support-message-id-label" class="support-label">{{ t('admin.support.messageId') }}</text>
            <input :value="state.draft.inReplyTo" class="support-input" autocomplete="off" autocapitalize="none" autocorrect="off" :spellcheck="false" :maxlength="254" aria-labelledby="support-message-id-label" :aria-invalid="state.error === 'messageId' ? 'true' : 'false'" placeholder="&lt;message-id@example.com&gt;" @input="updateField('inReplyTo', $event)" />
            <text class="support-hint">{{ t('admin.support.threadHint') }}</text>
          </view>
          <view class="support-actions">
            <view class="support-button support-primary" role="button" tabindex="0" @click="review">{{ t('admin.support.review') }}</view>
            <view class="support-button" role="button" tabindex="0" @click="clearDraft">{{ t('admin.support.clearDraft') }}</view>
          </view>

          <view v-if="state.preview" id="support-reply-preview" class="support-preview" tabindex="-1" role="region" :aria-label="t('admin.support.preview')">
            <text class="support-title">{{ t('admin.support.preview') }}</text>
            <text class="support-wrap">{{ t('admin.support.from') }}: {{ SUPPORT_FROM }}</text>
            <text class="support-wrap">{{ t('admin.support.replyTo') }}: {{ SUPPORT_FROM }}</text>
            <text class="support-wrap">{{ t('admin.support.to') }}: {{ state.preview.to }}</text>
            <text class="support-wrap">{{ t('admin.support.subject') }}: {{ state.preview.subject }}</text>
            <text v-if="state.preview.inReplyTo" class="support-wrap">{{ t('admin.support.messageId') }}: {{ state.preview.inReplyTo }}</text>
            <text class="support-body" selectable>{{ state.preview.text }}</text>
            <text class="support-hint">{{ t('admin.support.confirmHint') }}</text>
            <view class="support-button support-primary" role="button" :tabindex="state.busy ? -1 : 0" :aria-disabled="state.busy ? 'true' : 'false'" @click="controller.sendConfirmed()">{{ t('admin.support.confirmSend') }}</view>
          </view>
        </view>
      </template>
      <text v-if="state.error" class="support-error" role="alert">{{ t('admin.support.error.' + state.error) }}</text>
      <text class="support-hint">{{ t('admin.support.privacy') }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref } from 'vue'
import { useI18n } from '../composables/useI18n'
import {
  SUPPORT_FROM, createSupportReceiptStore, createSupportReplyController, createSupportReplyState,
  type SupportReplyDraft, type SupportReplyTransport,
} from '../api/adminSupportReply'

const props = defineProps<{ actorId: string; transport: SupportReplyTransport }>()
const { t } = useI18n()
const expanded = ref(false)
const advanced = ref(false)
const state = reactive(createSupportReplyState())
// Access failures (private mode, unsupported platform) fail closed before sending.
const store = createSupportReceiptStore({
  getItem: key => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: key => window.localStorage.removeItem(key),
}, props.actorId)
const controller = createSupportReplyController(state, {
  store,
  transport: props.transport,
  uuid: () => globalThis.crypto.randomUUID(),
  withLock: async operation => {
    if (typeof navigator === 'undefined' || !navigator.locks?.request) throw new Error('support_receipt_storage')
    return await navigator.locks.request(`caaci.support-reply.v1.${props.actorId}`, operation)
  },
})
controller.initialize()
const terminalReceipt = computed(() => state.receipt?.status === 'sent' || state.receipt?.status === 'failed')

function toggleOpen() {
  expanded.value = !expanded.value
  if (expanded.value) {
    if (state.requestId) void controller.checkReceipt()
    else void controller.refreshAvailability()
  }
}

function updateField(field: keyof SupportReplyDraft, event: { detail?: { value?: string }; target?: EventTarget | null }) {
  const value = event.detail?.value ?? (event.target as HTMLInputElement | null)?.value ?? ''
  controller.updateDraft(field, value)
}

function clearDraft() {
  for (const field of ['to', 'subject', 'text', 'context', 'inReplyTo'] as const) controller.updateDraft(field, '')
}

function review() {
  controller.review()
  if (state.preview) nextTick(() => {
    // #ifdef H5
    document.getElementById('support-reply-preview')?.focus()
    // #endif
  })
}

function openExternal(url: string) {
  // #ifdef H5
  window.open(url, '_blank', 'noopener,noreferrer')
  // #endif
  // #ifndef H5
  uni.setClipboardData({ data: url })
  // #endif
}

function openGmail() {
  openExternal('https://mail.google.com/mail/u/0/#search/to%3Ahelp%40illinimarket.com')
}

function openRecords() { openExternal('https://resend.com/emails') }

function clearPrivateState() {
  controller.dispose()
  expanded.value = false
  advanced.value = false
}

defineExpose({ clearPrivateState })
onBeforeUnmount(clearPrivateState)
</script>

<style scoped lang="scss">
.support { margin-bottom: 16px; border: 1px solid var(--border-subtle); border-radius: 12px; background: var(--bg-elev-1); color: var(--text-primary); overflow: hidden; }
.support-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; padding: 8px 16px; cursor: pointer; }
.support-title { font-size: 15px; font-weight: 700; }
.support-toggle { color: var(--text-secondary); font-size: 13px; flex-shrink: 0; }
.support-panel { display: flex; flex-direction: column; gap: 12px; padding: 4px 16px 16px; min-width: 0; font-size: 14px; line-height: 1.6; }
.support-copy, .support-hint, .support-label, .support-fixed, .support-body, .support-error { display: block; }
.support-hint { font-size: 12px; color: var(--text-secondary); }
.support-form, .support-advanced, .support-preview, .support-result, .support-notice { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.support-label, .support-fixed { font-weight: 600; }
.support-input, .support-textarea { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--border-subtle); border-radius: 8px; color: var(--text-primary); background: var(--bg-subtle); font-size: 14px; line-height: 1.5; padding: 10px 12px; }
.support-input { height: 44px; }
.support-textarea { height: 200px; }
.support-context { height: 96px; }
.support-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.support-button { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; align-self: flex-start; min-height: 44px; padding: 8px 14px; border: 1px solid var(--border-subtle); border-radius: 8px; font-size: 13px; font-weight: 600; background: var(--bg-subtle); color: var(--text-primary); cursor: pointer; }
.support-primary { background: var(--accent-primary); color: var(--ink-inverse); border-color: var(--accent-primary); }
.support-disabled { opacity: .55; cursor: default; }
.support-preview, .support-result { border: 1px solid var(--border-subtle); background: var(--bg-subtle); border-radius: 10px; padding: 14px; }
.support-body { white-space: pre-wrap; overflow-wrap: anywhere; padding: 14px 0; border-top: 1px solid var(--border-subtle); border-bottom: 1px solid var(--border-subtle); }
.support-wrap { overflow-wrap: anywhere; white-space: pre-wrap; }
.support-error { color: var(--accent-danger); }
.support-advanced-toggle { align-self: flex-start; display: flex; align-items: center; min-height: 44px; cursor: pointer; font-size: 13px; color: var(--text-secondary); }
/* #ifdef H5 */
.support-heading:focus-visible, .support-button:focus-visible, .support-advanced-toggle:focus-visible, .support-preview:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: -3px; }
/* #endif */
</style>
