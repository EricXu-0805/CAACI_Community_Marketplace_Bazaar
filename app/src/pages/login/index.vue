<template>
  <view class="page" :class="mpThemeClass" :style="mpChrome">
    <view :class="['nav-back', { disabled: formBusy || verifying || confirmResending }]" role="button" :aria-label="t('a11y.back')" @click="goBack">
      <UIcon name="chevron-left" size="xs" color="accent-primary" />
    </view>
    <view class="header u-rise">
      <image class="logo-mark-img" :src="logoSrc" :alt="t('app.name')" mode="aspectFit" />
      <text class="app-name" role="heading" aria-level="1">{{ t('app.name') }}</text>
      <text class="app-desc">{{ t('app.desc') }}</text>
    </view>

    <view v-if="!awaitingConfirm" class="form u-rise">
      <!-- These two swap the whole form, which is a tab pattern, not two
           buttons. As plain buttons the selected mode was carried only by a
           class, so nothing announced which one was active. -->
      <view class="tab-bar" role="tablist" :aria-label="t('app.name')">
        <view
          :class="['tab', { active: mode === 'login', disabled: formBusy }]"
          role="tab"
          :tabindex="mode === 'login' ? 0 : -1"
          :aria-selected="mode === 'login' ? 'true' : 'false'"
          :aria-label="t('login.signIn')"
          @click="setMode('login')"
          @keydown="onModeTabKeydown($event, 'login')"
        >
          <text class="tab-label">{{ t('login.signIn') }}</text>
          <view v-if="mode === 'login'" class="tab-line"></view>
        </view>
        <view
          :class="['tab', { active: mode === 'signup', disabled: formBusy }]"
          role="tab"
          :tabindex="mode === 'signup' ? 0 : -1"
          :aria-selected="mode === 'signup' ? 'true' : 'false'"
          :aria-label="t('login.signUp')"
          @click="setMode('signup')"
          @keydown="onModeTabKeydown($event, 'signup')"
        >
          <text class="tab-label">{{ t('login.signUp') }}</text>
          <view v-if="mode === 'signup'" class="tab-line"></view>
        </view>
      </view>

      <!--
        Field errors live next to their field and stay there. A toast was the
        old feedback for every validation and sign-in failure: it floats away
        from the input it describes, disappears on a timer, and a screen
        reader never ties it to anything. Each message below is bound through
        aria-describedby + aria-invalid, announced via role="alert", and
        cleared the moment the user edits that field.
      -->
      <view v-if="mode === 'signup'" class="form-group">
        <text class="form-label">{{ t('login.nickname') }}</text>
        <input
          v-model="nickname"
          :placeholder="t('login.nickname')"
          :aria-label="t('login.nickname')"
          :disabled="formBusy"
          :class="['form-input', { 'form-input--invalid': nicknameError }]"
          autocomplete="nickname"
          maxlength="40"
          :aria-invalid="nicknameError ? 'true' : 'false'"
          :aria-describedby="nicknameError ? 'login-nickname-error' : undefined"
          @input="nicknameError = ''"
        />
        <text v-if="nicknameError" id="login-nickname-error" class="field-error" role="alert">{{ nicknameError }}</text>
      </view>

      <view class="form-group">
        <text class="form-label">{{ t('login.email') }}</text>
        <input
          v-model="email"
          :placeholder="t('login.email')"
          :aria-label="t('login.email')"
          type="email"
          inputmode="email"
          autocomplete="email"
          spellcheck="false"
          :disabled="formBusy"
          :class="['form-input', { 'form-input--invalid': emailError }]"
          :aria-invalid="emailError ? 'true' : 'false'"
          :aria-describedby="emailError ? 'login-email-error' : undefined"
          @input="emailError = ''"
        />
        <text v-if="emailError" id="login-email-error" class="field-error" role="alert">{{ emailError }}</text>
        <view v-if="isIlliniEmail" class="illini-hint">
          <UIcon name="check" size="xs" color="success" />
          <text class="ih-text">{{ t('login.illiniEmail') }}</text>
        </view>
      </view>

      <view class="form-group">
        <text class="form-label">{{ t('login.password') }}</text>
        <view class="pw-wrap">
          <input
            v-model="password"
            :placeholder="t('login.password')"
            :aria-label="t('login.password')"
            :password="!showPw"
            :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'"
            :disabled="formBusy"
            :class="['form-input pw-input', { 'form-input--invalid': passwordError }]"
            maxlength="72"
            :aria-invalid="passwordError ? 'true' : 'false'"
            :aria-describedby="passwordError ? 'login-password-error' : undefined"
            @input="passwordError = ''"
          />
          <view class="pw-toggle" role="button" :aria-label="t('a11y.passwordToggle')" @click="showPw = !showPw">
            <image :src="showPw ? '/static/eye-off.svg' : '/static/eye.svg'" alt="" class="pw-toggle-icon" mode="aspectFit" />
          </view>
        </view>
        <text v-if="passwordError" id="login-password-error" class="field-error" role="alert">{{ passwordError }}</text>
        <view v-if="mode === 'signup'" class="pw-rules">
          <view v-for="r in pwRules" :key="r.key" :class="['pw-rule', { ok: r.ok }]">
            <UIcon class="pw-rule-mark" :name="r.ok ? 'check' : 'close'" size="xs" :color="r.ok ? 'success' : 'text-faint'" aria-hidden="true" />
            <text class="pw-rule-label">{{ t('login.pwRule.' + r.key) }}</text>
          </view>
        </view>
      </view>

      <text v-if="mode === 'login'" :class="['forgot-link', { disabled: formBusy }]" role="button" :aria-label="t('login.forgot')" @click="onForgotPassword">{{ t('login.forgot') }}</text>

      <view v-if="mode === 'signup'" class="agreement-row">
        <view
          class="agreement-toggle"
          role="checkbox"
          tabindex="0"
          :aria-label="agreementAriaLabel"
          :aria-checked="agreed ? 'true' : 'false'"
          @click="toggleAgreement"
          @keydown="onAgreementKeydown"
        >
          <view :class="['agree-check', { on: agreed }]">
            <view v-if="agreed" class="check-mark"></view>
          </view>
        </view>
        <view class="agree-text">
          <text class="agree-part">{{ t('login.agreePrefix') }}</text>
          <text class="agree-part link" role="link" tabindex="0" :aria-label="t('legal.terms')" @click="goLegal('terms')" @keydown="onLegalKeydown($event, 'terms')">{{ t('legal.terms') }},</text>
          <text class="agree-part link" role="link" tabindex="0" :aria-label="t('legal.privacy')" @click="goLegal('privacy')" @keydown="onLegalKeydown($event, 'privacy')">{{ t('legal.privacy') }},</text>
          <text class="agree-part">{{ t('login.agreeAnd') }}</text>
          <text class="agree-part link" role="link" tabindex="0" :aria-label="t('legal.guidelines')" @click="goLegal('guidelines')" @keydown="onLegalKeydown($event, 'guidelines')">{{ t('legal.guidelines') }}</text>
        </view>
      </view>

      <!-- Whatever cannot be attributed to one field (provider outage, agreement
           not ticked, an unmapped gotrue code) still needs a stable home above
           the button rather than a toast that vanishes. -->
      <text v-if="formError" class="form-error" role="alert">{{ formError }}</text>

      <button :class="['submit-btn', { disabled: formBusy }]" :disabled="formBusy" @click="onSubmit">
        {{ loading ? t('login.wait') : (mode === 'login' ? t('login.submitLogin') : t('login.submitSignup')) }}
      </button>

      <!-- #ifdef H5 -->
      <!--
        Google OAuth — H5-only secondary auth path. Placed BELOW the
        email form (per spec) with an 'or' divider so the email/password
        path stays primary. Same button works for both 'login' and
        'signup' tab modes — Supabase signInWithOAuth creates a profile
        on first sign-in, so the user doesn't need to think about which
        tab they're on. The mini-program deliberately stays on
        email/password for the first release. Google OAuth has no reliable
        native mini-program flow, and the dormant WeChat compatibility path
        is intentionally not exposed.

        Until the dashboard configuration in the commit message is done,
        clicking this button surfaces a 'provider is not enabled' error
        from Supabase — that's the expected pre-config state.
      -->
      <view class="or-divider google-divider">
        <view class="or-line"></view>
        <text class="or-text">{{ t('login.orContinue') }}</text>
        <view class="or-line"></view>
      </view>
      <button :class="['google-btn', { disabled: formBusy }]" :disabled="formBusy" @click="onSignInWithGoogle">
        <view class="g-icon-circle">
          <text class="g-icon-letter">G</text>
        </view>
        <text>{{ googleLoading ? t('login.connectingGoogle') : t('login.googleSignIn') }}</text>
      </button>
      <!-- #endif -->
    </view>

    <!-- Email-confirmation OTP panel — shown after sign-up. Supabase emails a
         {{ .Token }} 6-digit code (no magic link); the user types it here and
         verifyOtp({type:'signup'}) confirms the email + signs them in. Replaces
         the old "check your email / click the link" modal. -->
    <view v-else class="form u-rise">
      <view class="confirm-head">
        <text class="confirm-title">{{ t('login.confirmCodeTitle') }}</text>
        <text class="confirm-sub">{{ t('login.confirmCodeHint', { email: pendingEmail }) }}</text>
      </view>
      <view class="form-group">
        <text class="form-label">{{ t('resetPw.code') }}</text>
        <UCodeInput v-model="confirmCode" :placeholder="t('resetPw.codePlaceholder')" :aria-label="t('resetPw.code')" :autofocus="true" :disabled="verifying || confirmResending" />
        <view class="code-row">
          <text :class="['resend', { disabled: confirmCooldown > 0 || verifying || confirmResending }]" role="button" @click="onResendSignup">
            {{ confirmCooldown > 0 ? t('resetPw.resendIn', { n: confirmCooldown }) : t('resetPw.resend') }}
          </text>
        </view>
      </view>
      <button :class="['submit-btn', { disabled: verifying || confirmResending }]" :disabled="verifying || confirmResending" @click="onVerifySignup">
        {{ verifying ? t('login.wait') : t('login.confirmVerify') }}
      </button>
      <view :class="['back-link', { disabled: verifying || confirmResending }]" role="button" @click="leaveSignupConfirmation">{{ t('login.backToSignup') }}</view>
    </view>

    <view class="footer">
      <text class="footer-text">{{ t('app.name') }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
import { ref, computed, nextTick, onUnmounted, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useSupabase, prepareSupabaseAuthPersistence } from '../../composables/useSupabase'
import { useI18n } from '../../composables/useI18n'
import { useTheme } from '../../composables/useTheme'
import { passwordRules, passwordValid, friendlyErrorMessage, navigateBackOr } from '../../utils'
import { captureAuthFailure } from '../../utils/sentry'
import UIcon from '../../components/UIcon.vue'
import UCodeInput from '../../components/UCodeInput.vue'
import {
  authorizeLoginReturnIntent,
  buildLoginRoute,
  peekAuthorizedLoginReturnIntent,
  readLoginIntentNonce,
} from '../../api/navigationIntent'
import {
  captureAccountIdentityGeneration,
  getActiveAccountId,
} from '../../composables/accountScope'

const { t, lang } = useI18n()
const {
  signIn,
  signUp,
  loading,
  currentUser,
} = useAuth()
const { isDark } = useTheme()

function localizedPasswordPolicyError(error: unknown) {
  const policyError = error as { message?: unknown; reasons?: unknown }
  const reasons = Array.isArray(policyError?.reasons) ? policyError.reasons : []
  const detail = [...reasons, policyError?.message]
    .map((reason) => String(reason || '').toLowerCase())
    .join(' ')
  return /pwned|leak|breach|compromis/.test(detail)
    ? t('login.leakedPasswordRejected')
    : t('login.weakPassword')
}

// v5: theme-flipping 集 brand mark + an Illini-email hint on the signup form.
const logoSrc = computed(() => (isDark.value ? '/static/logo-mark-dark.svg' : '/static/logo-mark.svg'))
const isIlliniEmail = computed(() => /@illinois\.edu\s*$/i.test(email.value.trim()))
const agreementAriaLabel = computed(() => [
  t('login.agreePrefix'),
  t('legal.terms'),
  t('legal.privacy'),
  t('login.agreeAnd'),
  t('legal.guidelines'),
].join(' '))
// #1: live password-policy checklist on the signup tab so the user sees which
// rule fails, instead of a raw English gotrue "weak_password" error.
const pwRules = computed(() => passwordRules(password.value))

const mode = ref<'login' | 'signup'>('login')
const email = ref('')
const password = ref('')
const nickname = ref('')
const showPw = ref(false)
const agreed = ref(false)
/*
 * Field-level errors. These replace the toasts that used to carry every
 * validation and auth failure: a toast is not adjacent to the field it
 * describes, is gone before a slower reader finishes it, and is invisible to
 * assistive tech. Server errors are attributed to a field whenever the code
 * identifies one (email already registered → email; bad credentials or weak
 * password → password) and fall back to formError otherwise.
 */
const emailError = ref('')
const passwordError = ref('')
const nicknameError = ref('')
const formError = ref('')

function clearFormErrors() {
  emailError.value = ''
  passwordError.value = ''
  nicknameError.value = ''
  formError.value = ''
}

// H5 can move focus to the offending input; mp-weixin has no DOM handle, so
// the visible + announced message is the whole affordance there.
function focusField(id: 'login-email-error' | 'login-password-error' | 'login-nickname-error') {
  // #ifdef H5
  if (typeof document === 'undefined') return
  nextTick(() => {
    const described = document.querySelector<HTMLElement>(`[aria-describedby="${id}"]`)
    described?.focus?.()
  })
  // #endif
}
const googleLoading = ref(false)
const forgotLoading = ref(false)
const authRedirecting = ref(false)
let authRedirectTimer: ReturnType<typeof setTimeout> | null = null
let mounted = true
const formBusy = computed(() => loading.value || googleLoading.value || forgotLoading.value || authRedirecting.value)
let loginIntentNonce: string | null = null
let oauthReturnExpected = false

function navigationIntentOwner() {
  return {
    userId: getActiveAccountId(),
    identityGeneration: captureAccountIdentityGeneration(),
  }
}

function authorizeCurrentLoginReturn(expectedUserId?: string): boolean {
  const owner = navigationIntentOwner()
  if (expectedUserId && owner.userId !== expectedUserId) return false
  return !!loginIntentNonce
    && authorizeLoginReturnIntent(loginIntentNonce, owner)
}

function scheduleHomeRedirect(delay: number, expectedUserId?: string) {
  // Bind the nonce to the identity that completed authentication now. The
  // delayed callback revalidates that same identity generation, so an A -> B
  // switch during the success toast cannot carry A's target into B.
  authorizeCurrentLoginReturn(expectedUserId)
  authRedirecting.value = true
  if (authRedirectTimer) clearTimeout(authRedirectTimer)
  authRedirectTimer = setTimeout(() => {
    authRedirectTimer = null
    if (!mounted) return
    if (expectedUserId) authorizeCurrentLoginReturn(expectedUserId)
    const destination = loginIntentNonce
      ? peekAuthorizedLoginReturnIntent(loginIntentNonce, navigationIntentOwner())
      : null
    uni.reLaunch({ url: destination || '/pages/index/index' })
  }, delay)
}

onLoad((options) => {
  loginIntentNonce = readLoginIntentNonce(options?.intent)
  // #ifdef H5
  try {
    oauthReturnExpected = !!loginIntentNonce
      && typeof window !== 'undefined'
      && !!(window as any).__oauthInFlight
  } catch {
    oauthReturnExpected = false
  }
  // #endif
  if (oauthReturnExpected && currentUser.value) scheduleHomeRedirect(0, currentUser.value.id)
  // Reopen the code panel the user left. An already-signed-in visitor has
  // nothing left to confirm, so drop the record rather than restore it.
  if (currentUser.value) clearPendingConfirm()
  else restoreSignupConfirmation()
})

watch(currentUser, (user) => {
  if (!user || !oauthReturnExpected || authRedirecting.value) return
  scheduleHomeRedirect(0, user.id)
})

/* Roving-tabindex arrow navigation, matching the filter tablist in
   pages/messages/index.vue. */
function onModeTabKeydown(event: KeyboardEvent, current: 'login' | 'signup') {
  const keys: Array<'login' | 'signup'> = ['login', 'signup']
  const index = keys.indexOf(current)
  let nextIndex = index
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % keys.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + keys.length) % keys.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = keys.length - 1
  else if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault()
    setMode(current)
    return
  } else return

  event.preventDefault()
  setMode(keys[nextIndex])
  const tabList = (event.currentTarget as HTMLElement | null)?.parentElement
  nextTick(() => tabList?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus())
}

function setMode(nextMode: 'login' | 'signup') {
  if (mode.value === nextMode || formBusy.value) return
  uni.hideToast()
  // A sign-in failure must not follow the user into the sign-up form.
  clearFormErrors()
  mode.value = nextMode
  // Passwords, visibility, and signup consent are credentials for one flow,
  // not shared defaults for a different sign-in/signup operation.
  password.value = ''
  showPw.value = false
  if (nextMode === 'login') {
    nickname.value = ''
    agreed.value = false
  }
}

function toggleAgreement() {
  if (formBusy.value) return
  agreed.value = !agreed.value
}

function onAgreementKeydown(event: any) {
  if (event?.key !== 'Enter' && event?.key !== ' ') return
  event.preventDefault?.()
  toggleAgreement()
}

function onLegalKeydown(event: any, type: string) {
  if (event?.key !== 'Enter' && event?.key !== ' ') return
  event.preventDefault?.()
  goLegal(type)
}

// Signup email-confirmation OTP panel (shown after a successful sign-up that
// requires email confirmation). The user types the {{ .Token }} code Supabase
// emailed; verifyOtp({type:'signup'}) confirms + signs them in.
const awaitingConfirm = ref(false)
const pendingEmail = ref('')
const confirmCode = ref('')
const verifying = ref(false)
const confirmResending = ref(false)
const confirmCooldown = ref(0)
let confirmTimer: ReturnType<typeof setInterval> | null = null

/*
 * The pending-confirmation panel used to live only in page memory, so a
 * refresh — or following the "check your inbox" instruction on a phone and
 * coming back — dropped the user on the signup form holding a code with
 * nowhere to type it, and the resend cooldown restarted from zero.
 *
 * Only the address and the two deadlines are persisted. The code itself is
 * never written down: it is the credential, and this is shared-device
 * storage. Deadlines are absolute so a reload cannot shorten the cooldown.
 */
const PENDING_CONFIRM_KEY = 'signup-pending-confirm'
const PENDING_CONFIRM_TTL_MS = 60 * 60 * 1000

type PendingConfirm = { email: string; expiresAt: number; cooldownUntil: number }

function readPendingConfirm(): PendingConfirm | null {
  try {
    const raw = uni.getStorageSync(PENDING_CONFIRM_KEY)
    if (!raw) return null
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<PendingConfirm>
    if (typeof parsed?.email !== 'string' || !parsed.email) return null
    if (typeof parsed.expiresAt !== 'number' || Date.now() >= parsed.expiresAt) return null
    return {
      email: parsed.email,
      expiresAt: parsed.expiresAt,
      cooldownUntil: typeof parsed.cooldownUntil === 'number' ? parsed.cooldownUntil : 0,
    }
  } catch {
    return null
  }
}

function writePendingConfirm(next: PendingConfirm) {
  try { uni.setStorageSync(PENDING_CONFIRM_KEY, JSON.stringify(next)) } catch {}
}

function clearPendingConfirm() {
  try { uni.removeStorageSync(PENDING_CONFIRM_KEY) } catch {}
}

function patchPendingCooldown(cooldownUntil: number) {
  const current = readPendingConfirm()
  if (current) writePendingConfirm({ ...current, cooldownUntil })
}

function clearConfirmCooldown() {
  if (confirmTimer) clearInterval(confirmTimer)
  confirmTimer = null
  confirmCooldown.value = 0
}
/*
 * Counts down from the deadline, not from the number of ticks that have
 * fired. This screen's whole job is to make someone leave for their mail app,
 * and a backgrounded page has its intervals throttled or suspended — so a
 * counter that decrements per tick comes back reading whatever it reached
 * before the app went away, and Resend stays disabled long after the minute
 * is up. cooldownUntil was already being stored for exactly this reason; it
 * was only ever consulted on a fresh page load.
 */
function runConfirmCooldown(cooldownUntil: number) {
  clearConfirmCooldown()
  const remaining = () => Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
  if (remaining() <= 0) return
  const tick = () => {
    confirmCooldown.value = remaining()
    if (confirmCooldown.value <= 0 && confirmTimer) { clearInterval(confirmTimer); confirmTimer = null }
  }
  tick()
  confirmTimer = setInterval(tick, 1000)
}
function startConfirmCooldown() {
  const cooldownUntil = Date.now() + 60_000
  patchPendingCooldown(cooldownUntil)
  runConfirmCooldown(cooldownUntil)
}
function startSignupConfirmation(submittedEmail: string) {
  pendingEmail.value = submittedEmail
  confirmCode.value = ''
  verifying.value = false
  confirmResending.value = false
  awaitingConfirm.value = true
  writePendingConfirm({
    email: submittedEmail,
    expiresAt: Date.now() + PENDING_CONFIRM_TTL_MS,
    cooldownUntil: 0,
  })
  startConfirmCooldown()
}
function restoreSignupConfirmation() {
  const pending = readPendingConfirm()
  if (!pending) {
    // Also sweeps an entry that sat past its TTL.
    clearPendingConfirm()
    return
  }
  pendingEmail.value = pending.email
  confirmCode.value = ''
  awaitingConfirm.value = true
  runConfirmCooldown(pending.cooldownUntil)
}
function leaveSignupConfirmation() {
  if (verifying.value || confirmResending.value) return
  uni.hideToast()
  awaitingConfirm.value = false
  pendingEmail.value = ''
  confirmCode.value = ''
  clearPendingConfirm()
  clearConfirmCooldown()
}
onUnmounted(() => {
  mounted = false
  clearConfirmCooldown()
  if (authRedirectTimer) clearTimeout(authRedirectTimer)
})

const { supabase } = useSupabase()

async function onVerifySignup() {
  if (verifying.value || confirmResending.value) return
  const submittedEmail = pendingEmail.value.trim().toLowerCase()
  const submittedCode = confirmCode.value.trim()
  if (submittedCode.length !== 6) { uni.showToast({ title: t('resetPw.needCode'), icon: 'none' }); return }
  verifying.value = true
  try {
    await prepareSupabaseAuthPersistence()
    const { data, error } = await supabase.auth.verifyOtp({ email: submittedEmail, token: submittedCode, type: 'signup' })
    if (error) {
      captureAuthFailure(error, 'login-verify-otp')
      const expired = (error as any)?.code === 'otp_expired' || /expired|invalid|token/i.test(error.message || '')
      if (mounted) uni.showToast({ title: expired ? t('resetPw.codeInvalid') : friendlyErrorMessage(error, lang.value as 'en' | 'zh'), icon: 'none', duration: 3000 })
      verifying.value = false
      return
    }
    // verifyOtp('signup') confirms the email AND returns a session, so the
    // useAuth onAuthStateChange listener sets currentUser — just go home.
    // Confirmed: the pending record has served its purpose and must not
    // reopen the panel on the next visit.
    clearPendingConfirm()
    clearConfirmCooldown()
    if (!mounted) return
    uni.showToast({ title: t('login.signupOk'), icon: 'success' })
    scheduleHomeRedirect(800, data?.session?.user?.id)
  } catch (err: any) {
    captureAuthFailure(err, 'login-verify-otp')
    if (mounted) uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('login.signupFail'), icon: 'none', duration: 3000 })
    verifying.value = false
  }
}

async function onResendSignup() {
  if (confirmCooldown.value > 0 || verifying.value || confirmResending.value) return
  const submittedEmail = pendingEmail.value.trim().toLowerCase()
  confirmResending.value = true
  try {
    const { error } = await supabase.auth.resend({ type: 'signup', email: submittedEmail })
    if (error) throw error
    if (!mounted) return
    uni.showToast({ title: t('resetPw.resent'), icon: 'none' })
    startConfirmCooldown()
  } catch (err: any) {
    captureAuthFailure(err, 'login-resend-otp')
    if (mounted) uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('login.signupFail'), icon: 'none', duration: 3000 })
  } finally {
    confirmResending.value = false
  }
}

async function onForgotPassword() {
  if (formBusy.value) return
  const trimmedEmail = email.value.trim().toLowerCase()
  if (!trimmedEmail) {
    uni.showToast({ title: t('login.needEmail'), icon: 'none' })
    return
  }
  /*
   * Basic shape check before hitting the API. Supabase's own validation
   * is fine, but a syntactically broken email returns a generic 400
   * with no localized message — easier to catch here.
   */
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    uni.showToast({ title: t('login.needEmail'), icon: 'none' })
    return
  }
  /*
   * QA6 #1: reset now emails a 6-digit code (the PKCE magic link was
   * pre-fetched by mail scanners and showed "expired" even on an instant
   * click). Trigger the recovery email, then go to the reset page carrying
   * the email so the user types the code + new password there. No redirectTo
   * needed — with the "Reset Password" template switched to {{ .Token }} the
   * email contains the code, not a link.
   */
  forgotLoading.value = true
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail)
    if (error) throw error
    if (mounted) uni.navigateTo({ url: `/pages/reset-password/index?email=${encodeURIComponent(trimmedEmail)}` })
  } catch (error) {
    captureAuthFailure(error, 'login-reset-request')
    if (mounted) {
      uni.showModal({
        title: t('login.resetFailTitle'),
        content: friendlyErrorMessage(error, lang.value as 'en' | 'zh') || t('error.actionFailed'),
        showCancel: false,
      })
    }
  } finally {
    forgotLoading.value = false
  }
}

function goLegal(type: string) {
  if (formBusy.value) return
  uni.navigateTo({ url: `/pages/legal/index?type=${type}` })
}

function goBack() {
  if (formBusy.value || verifying.value || confirmResending.value) return
  navigateBackOr(() => uni.switchTab({ url: '/pages/index/index' }))
}

/*
 * Google OAuth — H5-only entry point.
 *
 * Calls supabase.auth.signInWithOAuth with provider=google. Supabase
 * generates the Google authorize URL (with PKCE state + code_challenge
 * baked in) and the H5 supabase-js implementation calls
 * window.location.assign(...) to navigate the page there. The user
 * authenticates with Google, Google bounces back to Supabase's
 * /auth/v1/callback (the URL configured in Google Cloud Console),
 * Supabase verifies and bounces to our redirectTo with `?code=<pkce>`
 * appended.
 *
 * On return the app boots fresh:
 *   1. App.vue's extractAuthCodeFromUrl runs synchronously, sees the
 *      ?code= but ALSO sees the hash route is NOT /pages/reset-password
 *      → leaves the URL alone (post r3a-Fix6 update to the entry hook).
 *   2. setTimeout(0) fires init() which creates the supabase client
 *      with detectSessionInUrl: true.
 *   3. supabase-js detectSessionInUrl pipeline finds the search-side
 *      ?code=, exchanges it via exchangeCodeForSession, fires SIGNED_IN.
 *   4. useAuth's auth subscriber catches SIGNED_IN, sets currentUser,
 *      and the consent gate watcher (also in App.vue) decides whether
 *      to send the user to onboarding (first-time) or just let them
 *      enter the home page.
 *
 * No code path in this file owns the post-redirect handling — that's
 * all delegated to the existing init() + auth subscriber chain. Means
 * Google OAuth is wired in by adding ONLY this handler + the button
 * + the entry-hook discrimination, no chat with the home page or
 * the index lifecycle.
 *
 * IMPORTANT — dashboard config required before this works end-to-end.
 * See the commit message for the full Google Cloud Console + Supabase
 * Dashboard steps. Without that config, signInWithOAuth returns an
 * error like 'Unsupported provider: provider is not enabled', which
 * is what the catch+toast below surfaces.
 *
 * Mp-weixin / other mp targets fall through to a single toast and
 * exit — there's no Google in those environments.
 */
async function onSignInWithGoogle() {
  if (formBusy.value) return
  // #ifdef H5
  if (typeof window === 'undefined') return
  googleLoading.value = true
  const redirectTo = loginIntentNonce
    ? `${window.location.origin}/#${buildLoginRoute(loginIntentNonce)}`
    : `${window.location.origin}/`
  try {
    await prepareSupabaseAuthPersistence()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (error) {
      // The raw gotrue string here is English implementation detail
      // ("Unsupported provider: provider is not enabled"). Log it, show the
      // user a stable sentence, and keep it in the form-level slot so it does
      // not evaporate before it is read.
      console.warn('[auth] Google sign-in request failed')
      captureAuthFailure(error, 'login-oauth-google')
      googleLoading.value = false
      formError.value = friendlyErrorMessage(error, lang.value as 'en' | 'zh') || t('login.googleFail')
      return
    }
    /*
     * Success path is silent: signInWithOAuth has already issued the
     * window.location.assign() to Google. Any code after this would
     * be racing with the page navigation. The success "toast" is the
     * Google sign-in screen the user is about to see.
     *
     * googleLoading.value stays true on success — the page navigates
     * away to Google before any reset matters; on return the page
     * re-mounts fresh with googleLoading reset to its initial false.
     */
  } catch (err: any) {
    console.warn('[auth] Google sign-in request failed')
    captureAuthFailure(err, 'login-oauth-google')
    googleLoading.value = false
    uni.showToast({
      title: err?.message ? `${t('login.googleFail')}: ${err.message}` : t('login.googleFail'),
      icon: 'none',
      duration: 3000,
    })
  }
  // #endif
  // #ifndef H5
  uni.showToast({ title: t('login.oauthUnsupported'), icon: 'none', duration: 2500 })
  // #endif
}

async function onSubmit() {
  if (formBusy.value) return
  const submittedMode = mode.value
  const submittedEmail = email.value.trim().toLowerCase()
  const submittedPassword = password.value
  const submittedNickname = nickname.value.trim()
  clearFormErrors()
  if (!submittedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submittedEmail)) {
    emailError.value = t('login.needEmail')
    focusField('login-email-error')
    return
  }
  if (!submittedPassword) {
    // An empty box is not a policy violation. Telling a returning user to
    // "use 8+ characters with upper & lower case and a number" when they
    // simply have not typed yet is wrong advice — the policy line belongs
    // only to sign-up, where it is actionable.
    passwordError.value = t('login.enterPassword')
    focusField('login-password-error')
    return
  }
  if (submittedMode === 'signup' && !passwordValid(submittedPassword)) {
    passwordError.value = t('login.needPassword')
    focusField('login-password-error')
    return
  }

  if (submittedMode === 'signup') {
    if (!submittedNickname) {
      nicknameError.value = t('login.needNickname')
      focusField('login-nickname-error')
      return
    }
    if (!agreed.value) {
      formError.value = t('login.agreeRequired')
      return
    }
    const { data, error } = await signUp(submittedEmail, submittedPassword, submittedNickname)
    if (!mounted) return
    if (error) {
      // gotrue weak_password (dashboard policy stricter than the client) used
      // to surface raw English. Map it to the localized policy line.
      const weak = (error as any).code === 'weak_password' || Array.isArray((error as any).reasons)
      if (weak) {
        passwordError.value = localizedPasswordPolicyError(error)
        focusField('login-password-error')
      } else {
        formError.value = friendlyErrorMessage(error, lang.value as 'en' | 'zh') || t('login.signupFail')
      }
    } else if (data?.user?.identities?.length === 0) {
      emailError.value = t('login.emailExists')
      focusField('login-email-error')
    } else if (data?.user && !data.session) {
      // Email confirmation required → switch to the in-app OTP code panel.
      // Supabase has just emailed the {{ .Token }} code; start the resend
      // cooldown so the resend link is disabled for the first 60s.
      startSignupConfirmation(submittedEmail)
    } else {
      uni.showToast({ title: t('login.signupOk'), icon: 'success' })
      /*
       * O1 (2026-05-20): onboarding flow removed. New users with default
       * tos_version='0' will hit the App.vue gate's reconsent branch on
       * first profile load and get redirected to /pages/reconsent/index
       * (the canonical consent surface). The legal acceptance step is
       * preserved; the wizard's nickname/campus/avatar collection is
       * gone (redundant / dead-data / editable post-signup). See
       * docs/memory/o1_onboarding_removed.md.
       */
      scheduleHomeRedirect(1200, data?.session?.user?.id)
    }
  } else {
    const { data, error } = await signIn(submittedEmail, submittedPassword)
    if (!mounted) return
    if (error) {
      // Map the two common gotrue sign-in errors to localized copy (zh is the
      // primary audience) — the raw strings are English. HIBP leaked-password
      // Some provider/config variants can also return a password-policy error
      // here, so keep that response on the same localized path as signup/reset.
      const m = (error.message || '').toLowerCase()
      const weak = (error as any).code === 'weak_password' || Array.isArray((error as any).reasons)
      if (weak) {
        passwordError.value = localizedPasswordPolicyError(error)
        focusField('login-password-error')
      } else if (m.includes('invalid login credentials') || m.includes('invalid_credentials')) {
        // gotrue deliberately will not say which half was wrong, so the message
        // belongs on the field the user can act on without leaking whether the
        // address exists.
        passwordError.value = t('login.invalidCredentials')
        focusField('login-password-error')
      } else if (m.includes('email not confirmed') || m.includes('email_not_confirmed')) {
        emailError.value = t('login.emailNotConfirmed')
        focusField('login-email-error')
      } else {
        formError.value = friendlyErrorMessage(error, lang.value as 'en' | 'zh') || t('login.loginFail')
      }
    } else if (data?.weakPassword) {
      // Supabase intentionally permits an existing account to sign in with a
      // now-known leaked password, but returns this structured warning. Keep
      // the session usable while making the next safe action unmistakable.
      uni.showModal({
        title: t('login.weakPasswordWarningTitle'),
        content: t('login.weakPasswordWarningHint'),
        showCancel: false,
        success: () => {
          if (mounted) scheduleHomeRedirect(0, data?.session?.user?.id)
        },
        fail: () => {
          if (!mounted) return
          uni.showToast({ title: localizedPasswordPolicyError(data.weakPassword), icon: 'none', duration: 2500 })
          scheduleHomeRedirect(2500, data?.session?.user?.id)
        },
      })
    } else {
      uni.showToast({ title: t('login.loginOk'), icon: 'success' })
      /*
       * Replaced implicit back navigation with reLaunch to /pages/index/index.
       *
       * Why navigateBack failed: when users land on the login page from
       * /pages/welcome/index.vue (the very first launch path) OR from a
       * direct deep-link (recovery email, OAuth callback, share URL),
       * the navigation stack is just [login] — there is nothing to go
       * back to. uni.navigateBack silently no-ops in that case (no
       * fail callback to fall through), so the user sees the success
       * toast and stays parked on the login page. They had to manually
       * refresh / re-tap a tab to actually enter the app.
       *
       * reLaunch is the right primitive here because:
       *   1. After login, "go back" is semantically wrong — the user
       *      is now authenticated, the back stack should be flushed
       *      (no hitting Back to return to a logged-out page).
       *   2. /pages/index/index is a tabBar page, so we can't use
       *      navigateTo (uni-app rejects tabBar destinations from
       *      navigateTo). reLaunch handles tabBar pages cleanly.
       *   3. WeChat-login success above (line ~205) already does
       *      reLaunch to the same destination — bringing email-login
       *      in line keeps both auth paths consistent.
       *
       * 800ms (matched to the WeChat-login path) lets the success
       * toast register visually before the page swap.
      */
      scheduleHomeRedirect(800, data?.session?.user?.id)
    }
  }
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh; background: var(--bg-page);
  padding: 0 24px;
  max-width: 400px; margin: 0 auto;
  display: flex; flex-direction: column;
}

.nav-back {
  position: absolute; top: calc(14px + var(--mp-status-bar, env(safe-area-inset-top, 0px))); left: 16px;
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; z-index: 10;
  &.disabled { opacity: 0.35; pointer-events: none; }
  &:active { background: var(--bg-subtle); }
}
.header {
  display: flex; flex-direction: column; align-items: center;
  padding: 72px 0 40px;
  padding-top: calc(72px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
}
.logo-mark-img {
  width: 56px; height: 56px; border-radius: 14px;
  box-shadow: var(--shadow-soft);
}
.app-name {
  font-family: var(--font-serif);
  font-size: 24px; font-weight: 600; color: var(--ink);
  margin-top: 16px; letter-spacing: -0.02em;
}
.app-desc {
  font-size: 13px; color: var(--text-subtle); margin-top: 5px;
  letter-spacing: 0.01em;
}

.form { flex: 1; }

.tab-bar {
  display: flex; gap: 28px; margin-bottom: 28px;
  border-bottom: 1px solid var(--line-hair);
}
.tab {
  position: relative; padding-bottom: 12px; cursor: pointer;
  .tab-label { font-size: 16px; color: var(--text-subtle); font-weight: 500; }
  &.active .tab-label { color: var(--text-primary); font-weight: 600; }
  &.disabled { opacity: 0.45; pointer-events: none; }
}
.tab-line {
  position: absolute; bottom: -1px; left: 0; right: 0;
  height: 2px; background: var(--accent-primary); border-radius: 1px;
}

.form-group { margin-bottom: 18px; }
/* Illini-email affordance — sage pill that appears once the address ends
   in @illinois.edu, hinting at the verified-badge path. */
.illini-hint {
  display: inline-flex; align-items: center; gap: 5px;
  margin-top: 8px; padding: 3px 10px;
  border-radius: var(--radius-pill);
  background: var(--success-soft);
}
.ih-text { font-size: 11px; font-weight: 500; color: var(--success); line-height: 1; }
.form-label {
  display: block; font-size: 13px; color: var(--text-muted);
  margin-bottom: 7px; font-weight: 500;
}
.form-input {
  width: 100%; height: 48px;
  background: var(--bg-elev-2); border-radius: 12px;
  padding: 0 16px; font-size: 15px; color: var(--text-primary);
  border: 1px solid transparent;
  transition: border-color 0.15s, background 0.15s;
  &:focus {
    border-color: var(--line-soft);
    background: var(--bg-elev-1);
  }
}
/* The border is the only non-textual cue, so it never carries the message
   alone — every invalid field also renders its own .field-error line. A class
   rather than [aria-invalid=true]: WXSS rejects attribute selectors, and this
   component compiles for mp-weixin too. */
.form-input--invalid {
  border-color: var(--danger, var(--accent-danger));
}
.field-error {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--danger, var(--accent-danger));
}
.form-error {
  display: block;
  margin: 4px 0 10px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--danger, var(--accent-danger));
}
.pw-wrap { position: relative; }
.pw-input { padding-right: 44px; }
.pw-toggle {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  cursor: pointer; font-size: 18px; color: var(--text-muted);
  padding: 4px;
}
.pw-toggle-icon {
  width: 18px;
  height: 18px;
  display: block;
}
.pw-rules {
  display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 8px;
}
.pw-rule { display: flex; align-items: center; gap: 4px; }
.pw-rule-mark { width: 11px !important; height: 11px !important; }
.pw-rule-label { font-size: 11px; color: var(--text-muted); }
.pw-rule.ok .pw-rule-label { color: var(--success); }

.forgot-link {
  display: block; text-align: right; font-size: 13px;
  color: var(--text-muted); margin-top: 8px; cursor: pointer;
  &.disabled { color: var(--text-faint); pointer-events: none; }
  &:active { color: var(--text-primary); }
}
.submit-btn {
  width: 100%; height: 48px;
  background: var(--accent-primary); color: var(--ink-inverse);
  border-radius: 24px; font-size: 15px; font-weight: 600;
  margin-top: 24px; border: none;
  display: flex; align-items: center; justify-content: center;
  letter-spacing: 0.01em;
  box-shadow: var(--shadow-cta);
  &.disabled { opacity: 0.35; }
  &:active { background: var(--accent-primary-deep); box-shadow: var(--shadow-soft); }
}

/*
 * Google OAuth button — white surface + warm-charcoal text, secondary
 * to the brand-colored email submit button above. Uses a stylized 'G'
 * monogram in a brand-soft circle instead of Google's official 'G'
 * mark — Google's brand guidelines (https://about.google/brand-resource-center/)
 * forbid placing the official mark on a button without their approval
 * pipeline, and an unbranded 'G' is industry-standard for "OAuth via
 * Google" affordances. The circle background uses --bg-subtle so the
 * button visually pairs with --bg-elev-2 form inputs above.
 */
.google-divider { margin-top: 18px; margin-bottom: 12px; }
.google-btn {
  width: 100%; height: 48px;
  background: var(--surface); color: var(--ink);
  border: 0.5px solid var(--border-strong);
  border-radius: 24px; font-size: 15px; font-weight: 500;
  display: flex; align-items: center; justify-content: center;
  gap: 10px; letter-spacing: 0.01em;
  padding: 0 16px;
  &.disabled { opacity: 0.45; }
  &:active { background: var(--bg-subtle); transform: translateY(1px); }
}
.g-icon-circle {
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--bg-subtle);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.g-icon-letter {
  font-family: var(--font-serif);
  font-size: 14px; font-weight: 700;
  color: var(--ink);
  line-height: 1;
}

.or-divider {
  display: flex; align-items: center; gap: 12px;
  margin: 22px 0 6px;
}
.or-line {
  flex: 1; height: 1px; background: var(--border);
}
.or-text {
  font-size: 12px; color: var(--ink-quiet);
  letter-spacing: 0.04em;
}

.agreement-row {
  display: flex; align-items: flex-start; gap: 9px;
  margin-top: 18px; padding: 4px 2px;
  -webkit-tap-highlight-color: transparent;
}
.agreement-toggle {
  width: 32px; height: 32px; margin: -6px -7px -6px -7px;
  flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  border-radius: 8px; cursor: pointer;
  &:focus { outline: 2px solid var(--accent-primary); outline-offset: 1px; }
}
.agree-check {
  width: 18px; height: 18px; border: 1.5px solid var(--text-faint);
  border-radius: 4px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
  &.on { background: var(--accent-primary); border-color: var(--accent-primary); }
}
.check-mark {
  width: 10px; height: 6px;
  border-left: 1.5px solid #fff; border-bottom: 1.5px solid #fff;
  transform: rotate(-45deg); margin-top: -2px;
}
.agree-text {
  display: flex; flex-wrap: wrap; align-items: baseline;
  column-gap: 4px; row-gap: 1px; flex: 1;
  font-size: 12px; color: var(--text-secondary); line-height: 1.5;
  .link {
    color: var(--text-primary); text-decoration: underline; cursor: pointer;
    &:focus { outline: 2px solid var(--accent-primary); outline-offset: 1px; border-radius: 2px; }
  }
}
.agree-part { white-space: nowrap; }

/* Email-confirmation OTP panel (post-signup) */
.confirm-head { margin-bottom: 22px; }
.confirm-title {
  display: block; font-family: var(--font-serif);
  font-size: 20px; font-weight: 600; color: var(--ink); letter-spacing: -0.01em;
}
.confirm-sub {
  display: block; margin-top: 8px;
  font-size: 13px; color: var(--text-subtle); line-height: 1.6;
}
.code-row {
  display: flex; align-items: center; justify-content: flex-end;
  margin-top: 8px;
}
.resend {
  font-size: 12px; color: var(--accent-primary); font-weight: 600; cursor: pointer;
  &.disabled { color: var(--text-faint); pointer-events: none; }
  &:active { opacity: 0.7; }
}
.back-link {
  margin-top: 18px; text-align: center;
  font-size: 13px; color: var(--text-muted); font-weight: 500; cursor: pointer;
  &.disabled { color: var(--text-faint); pointer-events: none; }
  &:active { opacity: 0.7; }
}

.footer {
  padding: 24px 0; text-align: center;
}
.footer-text {
  font-size: 11px; color: var(--text-subtle);
  letter-spacing: 0.05em; font-weight: 500;
}
</style>
