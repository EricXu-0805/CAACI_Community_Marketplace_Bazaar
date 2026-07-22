<template>
  <view class="page" :class="mpThemeClass" :style="mpChrome">
    <view class="header">
      <view class="back" role="button" :aria-label="t('a11y.back')" @click="goBack"><view class="back-arrow"></view></view>
      <view class="hero-badge"><UIcon name="check" size="xs" color="#FFFFFF" aria-hidden="true" /><text class="hero-illini">Illini</text></view>
      <text class="app-name">{{ t('illini.title') }}</text>
      <text class="app-desc">{{ t('illini.intro') }}</text>
    </view>

    <view class="form">
      <!-- Step 1: campus email -->
      <template v-if="step === 'email'">
        <view class="form-group">
          <text class="form-label">{{ t('illini.emailLabel') }}</text>
          <input
            v-model="email"
            :placeholder="t('illini.emailPlaceholder')"
            :aria-label="t('illini.emailLabel')"
            type="text"
            autocomplete="email"
            class="form-input"
            confirm-type="send"
            @confirm="onSendCode"
          />
          <text class="field-hint">{{ t('illini.emailHint') }}</text>
        </view>
        <button :class="['submit-btn', { disabled: sending }]" :disabled="sending" @click="onSendCode">
          {{ sending ? t('login.wait') : t('illini.sendCode') }}
        </button>
      </template>

      <!-- Step 2: 6-digit code -->
      <template v-else>
        <view class="form-group">
          <text class="form-label">{{ t('illini.codeLabel') }}</text>
          <UCodeInput v-model="code" :placeholder="t('resetPw.codePlaceholder')" :aria-label="t('illini.codeLabel')" :autofocus="true" />
          <view class="code-row">
            <text class="code-hint">{{ t('illini.codeHint', { email }) }}</text>
            <text :class="['resend', { disabled: resendCooldown > 0 || sending }]" role="button" @click="onResend">
              {{ resendCooldown > 0 ? t('resetPw.resendIn', { n: resendCooldown }) : t('resetPw.resend') }}
            </text>
          </view>
        </view>
        <button :class="['submit-btn', { disabled: verifying }]" :disabled="verifying" @click="onVerify">
          {{ verifying ? t('login.wait') : t('illini.verify') }}
        </button>
        <view class="back-link" role="button" @click="step = 'email'">{{ t('illini.changeEmail') }}</view>
      </template>
    </view>
  </view>
</template>

<script setup lang="ts">
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
/*
 * Illini one-tap verification (for accounts created with a non-@illinois.edu
 * email). Two steps: enter a campus email → enter the 6-digit code we email to
 * it. The badge (is_illini_verified) is granted server-side by the
 * verify-illini-code edge function; this page never writes it. The account's
 * login email is unchanged. @illinois.edu signups are auto-verified and never
 * see this page (the profile prompt is hidden when already verified).
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { useSupabase, platformFetch } from '../../composables/useSupabase'
import { readBoundedJson } from '../../api/responseBody'
import { useAuth } from '../../composables/useAuth'
import { BASE_URL } from '../../config/runtime'
import { navigateBackOr } from '../../utils'
import UCodeInput from '../../components/UCodeInput.vue'
import UIcon from '../../components/UIcon.vue'
import {
  captureAccountRequest,
  isAccountRequestCurrent,
  onAccountTransition,
  type AccountRequestToken,
} from '../../composables/accountScope'

const { t, lang } = useI18n()
const { supabase } = useSupabase()
const { currentUser, awaitAuthReady, requireAuth } = useAuth()
let pageMounted = true

onMounted(async () => {
  const state = await awaitAuthReady()
  if (!pageMounted) return
  if (state === 'anonymous') requireAuth()
})

const ILLINI_RE = /^[^@\s]+@illinois\.edu$/
const MAX_ILLINI_RESPONSE_BYTES = 64 * 1024

let sendEndpoint = '/api/auth/send-illini-code'
let verifyEndpoint = '/api/auth/verify-illini-code'
// #ifdef H5
try {
  if (typeof window !== 'undefined' && window.location?.origin) {
    sendEndpoint = window.location.origin + '/api/auth/send-illini-code'
    verifyEndpoint = window.location.origin + '/api/auth/verify-illini-code'
  }
} catch {}
// #endif
// #ifndef H5
sendEndpoint = `${BASE_URL}/api/auth/send-illini-code`
verifyEndpoint = `${BASE_URL}/api/auth/verify-illini-code`
// #endif

const step = ref<'email' | 'code'>('email')
const email = ref('')
const code = ref('')
const sending = ref(false)
const verifying = ref(false)

const resendCooldown = ref(0)
let cooldownTimer: ReturnType<typeof setInterval> | null = null
let pageEpoch = 0
function stopCooldown() {
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = null
  resendCooldown.value = 0
}
function resetVerificationPrivateState() {
  pageEpoch += 1
  step.value = 'email'
  email.value = ''
  code.value = ''
  sending.value = false
  verifying.value = false
  stopCooldown()
}
const stopAccountTransitionListener = onAccountTransition(resetVerificationPrivateState)

function startCooldown() {
  resendCooldown.value = 60
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    resendCooldown.value -= 1
    if (resendCooldown.value <= 0 && cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null }
  }, 1000)
}
onUnmounted(() => {
  pageMounted = false
  pageEpoch += 1
  sending.value = false
  verifying.value = false
  stopCooldown()
  stopAccountTransitionListener()
})

function errToast(errCode: string) {
  const key = `illini.err.${errCode}`
  const msg = t(key)
  // Fall back to a generic message if the code has no dedicated string.
  uni.showToast({ title: msg === key ? t('illini.err.generic') : msg, icon: 'none', duration: 2800 })
}

function flowIsCurrent(accountToken: AccountRequestToken, requestEpoch: number): boolean {
  return pageMounted
    && requestEpoch === pageEpoch
    && isAccountRequestCurrent(accountToken)
    && currentUser.value?.id === accountToken.userId
}

async function authHeader(accountToken: AccountRequestToken): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession()
  if (!isAccountRequestCurrent(accountToken) || data.session?.user.id !== accountToken.userId) return null
  const jwt = data.session?.access_token
  if (!jwt) return null
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` }
}

async function sendCode(
  accountToken: AccountRequestToken,
  requestEpoch: number,
  rawEmail: string,
): Promise<boolean> {
  const e = rawEmail.trim().toLowerCase()
  if (!ILLINI_RE.test(e)) { errToast('invalid_email'); return false }
  let headers: Record<string, string> | null
  try {
    headers = await authHeader(accountToken)
  } catch {
    if (flowIsCurrent(accountToken, requestEpoch)) errToast('network')
    return false
  }
  if (!flowIsCurrent(accountToken, requestEpoch)) return false
  if (!headers) { errToast('auth_required'); return false }
  try {
    const r = await platformFetch(sendEndpoint, { method: 'POST', headers, body: JSON.stringify({ email: e }) })
    const j = await readBoundedJson<any>(r, {
      maxBytes: MAX_ILLINI_RESPONSE_BYTES,
      timeoutMs: 10_000,
    }).catch(() => ({}))
    if (!flowIsCurrent(accountToken, requestEpoch)) return false
    if (!r.ok || !j?.ok) { errToast(j?.error || 'generic'); return false }
    return true
  } catch {
    if (flowIsCurrent(accountToken, requestEpoch)) errToast('network')
    return false
  }
}

async function onSendCode() {
  if (sending.value) return
  const entryEpoch = pageEpoch
  sending.value = true
  try {
    await awaitAuthReady()
    if (entryEpoch !== pageEpoch || !requireAuth() || !currentUser.value) return
    const accountToken = captureAccountRequest(currentUser.value.id)
    const requestEpoch = entryEpoch
    const emailSnapshot = email.value
    if (!flowIsCurrent(accountToken, requestEpoch)) return
    if (await sendCode(accountToken, requestEpoch, emailSnapshot)) {
      if (!flowIsCurrent(accountToken, requestEpoch)) return
      step.value = 'code'
      startCooldown()
      uni.showToast({ title: t('illini.codeSent'), icon: 'none' })
    }
  } finally {
    if (entryEpoch === pageEpoch) sending.value = false
  }
}

async function onResend() {
  if (resendCooldown.value > 0 || sending.value) return
  const entryEpoch = pageEpoch
  sending.value = true
  try {
    await awaitAuthReady()
    if (entryEpoch !== pageEpoch || !requireAuth() || !currentUser.value) return
    const accountToken = captureAccountRequest(currentUser.value.id)
    const requestEpoch = entryEpoch
    const emailSnapshot = email.value
    if (await sendCode(accountToken, requestEpoch, emailSnapshot)) {
      if (!flowIsCurrent(accountToken, requestEpoch)) return
      startCooldown()
      uni.showToast({ title: t('resetPw.resent'), icon: 'none' })
    }
  } finally {
    if (entryEpoch === pageEpoch) sending.value = false
  }
}

async function onVerify() {
  if (verifying.value) return
  if (code.value.trim().length !== 6) { uni.showToast({ title: t('resetPw.needCode'), icon: 'none' }); return }
  const entryEpoch = pageEpoch
  verifying.value = true
  try {
    await awaitAuthReady()
    if (entryEpoch !== pageEpoch || !requireAuth() || !currentUser.value) return
    const accountToken = captureAccountRequest(currentUser.value.id)
    const requestEpoch = entryEpoch
    const codeSnapshot = code.value.trim()
    const headers = await authHeader(accountToken)
    if (!flowIsCurrent(accountToken, requestEpoch)) return
    if (!headers) { errToast('auth_required'); return }
    const r = await platformFetch(verifyEndpoint, { method: 'POST', headers, body: JSON.stringify({ code: codeSnapshot }) })
    const j = await readBoundedJson<any>(r, {
      maxBytes: MAX_ILLINI_RESPONSE_BYTES,
      timeoutMs: 10_000,
    }).catch(() => ({}))
    if (!flowIsCurrent(accountToken, requestEpoch)) return
    if (!r.ok || !j?.verified) { errToast(j?.error || 'generic'); return }
    // Server already flipped the badge; reflect it locally so the profile
    // updates without a refetch (currentUser is reactive).
    if (currentUser.value?.id === accountToken.userId) currentUser.value.is_illini_verified = true
    uni.showToast({ title: t('illini.success'), icon: 'success', duration: 1800 })
    setTimeout(() => {
      if (flowIsCurrent(accountToken, requestEpoch)) goBack()
    }, 1500)
  } catch {
    if (entryEpoch === pageEpoch) errToast('network')
  } finally {
    if (entryEpoch === pageEpoch) verifying.value = false
  }
}

function goBack() { navigateBackOr(() => uni.switchTab({ url: '/pages/profile/index' })) }
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh; background: var(--bg-elev-1);
  padding: 0 24px; max-width: 400px; margin: 0 auto;
  display: flex; flex-direction: column; justify-content: center;
  position: relative;
}
.header {
  display: flex; flex-direction: column; align-items: center;
  padding: 0 0 32px;
}
.back {
  position: absolute; left: 0;
  top: calc(16px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
  width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.back-arrow {
  width: 11px; height: 11px; border-left: 2px solid var(--text-secondary);
  border-bottom: 2px solid var(--text-secondary); transform: rotate(45deg);
}
.hero-badge {
  display: inline-flex; align-items: center; padding: 6px 16px;
  background: var(--campus-blue, #13294b); border-radius: var(--radius-pill, 999px);
}
.hero-badge :deep(.u-icon) { width: 13px !important; height: 13px !important; margin-right: 5px; }
.hero-illini { font-size: 16px; font-weight: 800; color: #fff; letter-spacing: 0.02em; }
.app-name {
  font-family: var(--font-serif);
  font-size: 22px; font-weight: 600; color: var(--text-primary);
  margin-top: 16px; letter-spacing: -0.02em;
}
.app-desc { font-size: 13px; color: var(--text-subtle); margin-top: 6px; text-align: center; line-height: 1.5; padding: 0 12px; }

/* The header + form are centered together as one block (.page
   justify-content:center) so this sparse one-field form reads as a balanced
   auth screen, not floating with a gap above it (QA7 r2). Back button is
   absolute → stays pinned top-left regardless of the centering. */
.form { width: 100%; }
.form-group { margin-bottom: 18px; }
.form-label { display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 7px; font-weight: 500; }
.form-input {
  width: 100%; height: 48px;
  background: var(--bg-elev-2); border-radius: 12px;
  padding: 0 16px; font-size: 16px; color: var(--text-primary);
  border: 1px solid var(--line-soft);
  &:focus { border-color: var(--accent-primary); background: var(--bg-elev-1); }
}
.field-hint { display: block; font-size: 11px; color: var(--text-subtle); margin-top: 7px; line-height: 1.4; }

.code-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-top: 8px;
}
.code-hint { font-size: 11px; color: var(--text-subtle); line-height: 1.4; flex: 1; }
.resend {
  font-size: 12px; color: var(--accent-primary); font-weight: 600;
  cursor: pointer; flex-shrink: 0;
  &.disabled { color: var(--text-faint); pointer-events: none; }
  &:active { opacity: 0.7; }
}

.submit-btn {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 48px; line-height: 1;
  background: var(--accent-primary); color: #fff;
  border-radius: 24px; font-size: 15px; font-weight: 600;
  margin-top: 24px; border: none;
  &.disabled { opacity: 0.35; }
  &:active { opacity: 0.8; }
}
.back-link {
  margin-top: 18px; text-align: center;
  font-size: 13px; color: var(--text-muted); font-weight: 500;
  cursor: pointer;
  &:active { opacity: 0.7; }
}
</style>
