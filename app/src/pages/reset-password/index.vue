<template>
  <view class="page" :class="mpThemeClass" :style="mpChrome">
    <view class="header">
      <image class="logo-mark-img" :src="logoSrc" :alt="t('app.name')" mode="aspectFit" />
      <text class="app-name">{{ t('resetPw.title') }}</text>
      <text class="app-desc">{{ t('resetPw.hint') }}</text>
    </view>

    <view class="form">
      <view class="form-group">
        <text class="form-label">{{ t('resetPw.email') }}</text>
        <input v-model="email" :placeholder="t('login.email')" :aria-label="t('resetPw.email')" :disabled="saving || resending" type="text" autocomplete="email" class="form-input" />
      </view>

      <view class="form-group">
        <text class="form-label">{{ t('resetPw.code') }}</text>
        <UCodeInput v-model="code" :placeholder="t('resetPw.codePlaceholder')" :aria-label="t('resetPw.code')" :disabled="saving || resending" />
        <view class="code-row">
          <text class="code-hint">{{ email ? t('resetPw.codeHint', { email }) : t('resetPw.codeHintNoEmail') }}</text>
          <text :class="['resend', { disabled: resendCooldown > 0 || saving || resending }]" role="button" @click="onResend">
            {{ resendCooldown > 0 ? t('resetPw.resendIn', { n: resendCooldown }) : t('resetPw.resend') }}
          </text>
        </view>
      </view>

      <view class="form-group">
        <text class="form-label">{{ t('resetPw.newPassword') }}</text>
        <view class="pw-wrap">
          <input v-model="newPassword" :placeholder="t('resetPw.newPassword')" :aria-label="t('resetPw.newPassword')" :password="!showNewPw" :disabled="saving || resending" autocomplete="new-password" class="form-input pw-input" />
          <view class="pw-toggle" role="button" :aria-label="t('a11y.passwordToggle')" @click="showNewPw = !showNewPw">
            <image :src="showNewPw ? '/static/eye-off.svg' : '/static/eye.svg'" alt="" class="pw-toggle-icon" mode="aspectFit" />
          </view>
        </view>
        <!-- Live password-policy checklist — same component as the signup tab
             so the reset flow shows which rule fails before submit. -->
        <view class="pw-rules">
          <view v-for="r in pwRules" :key="r.key" :class="['pw-rule', { ok: r.ok }]">
            <UIcon class="pw-rule-mark" :name="r.ok ? 'check' : 'close'" size="xs" :color="r.ok ? 'success' : 'text-faint'" aria-hidden="true" />
            <text class="pw-rule-label">{{ t('login.pwRule.' + r.key) }}</text>
          </view>
        </view>
      </view>
      <view class="form-group">
        <text class="form-label">{{ t('resetPw.confirm') }}</text>
        <view class="pw-wrap">
          <input v-model="confirmPw" :placeholder="t('resetPw.confirm')" :aria-label="t('resetPw.confirm')" :password="!showConfirmPw" :disabled="saving || resending" autocomplete="new-password" class="form-input pw-input" />
          <view class="pw-toggle" role="button" :aria-label="t('a11y.passwordToggle')" @click="showConfirmPw = !showConfirmPw">
            <image :src="showConfirmPw ? '/static/eye-off.svg' : '/static/eye.svg'" alt="" class="pw-toggle-icon" mode="aspectFit" />
          </view>
        </view>
      </view>

      <button class="submit-btn" :disabled="saving || resending" @click="onSave">
        {{ saving ? t('login.wait') : t('resetPw.save') }}
      </button>
      <view :class="['back-link', { disabled: saving || resending }]" role="button" @click="goLogin">{{ t('resetPw.backLogin') }}</view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
/*
 * Password reset via typed 6-digit OTP code (QA6 #1).
 *
 * The old PKCE magic-link flow failed: mail scanners pre-fetched the
 * single-use link, so it showed "expired" even when clicked immediately.
 * Now the recovery email carries a {{ .Token }} 6-digit code (Supabase
 * dashboard template change — operator action), the user types it here,
 * and an isolated verifyOtp({ type:'recovery' }) establishes the one-operation
 * session used for updateUser({password}). It never replaces the app's shared
 * login session. No link, no PKCE exchange, no fragile recovery inference.
 */
import { ref, computed, onUnmounted, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import {
  createEphemeralSupabaseClient,
  useSupabase,
} from '../../composables/useSupabase'
import {
  RECOVERY_IDENTITY_MISMATCH,
  updateRecoveryPasswordWithBoundSession,
} from '../../api/recoveryPassword'
import { useI18n } from '../../composables/useI18n'
import { useTheme } from '../../composables/useTheme'
import { passwordRules, passwordValid, friendlyErrorMessage } from '../../utils'
import UCodeInput from '../../components/UCodeInput.vue'
import UIcon from '../../components/UIcon.vue'

const { t, lang } = useI18n()
const { supabase } = useSupabase()
const { isDark } = useTheme()
// Match login's theme-flipping 集 brand mark instead of the old plain "I" box.
const logoSrc = computed(() => (isDark.value ? '/static/logo-mark-dark.svg' : '/static/logo-mark.svg'))

const email = ref('')
const code = ref('')
const newPassword = ref('')
const confirmPw = ref('')
const showNewPw = ref(false)
const showConfirmPw = ref(false)
const saving = ref(false)
const resending = ref(false)
const pwRules = computed(() => passwordRules(newPassword.value))

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Prefilled when arriving from login "forgot password" / settings "change
// password"; editable so a cold visit (or a typo) still works.
onLoad((options) => {
  const e = (options as any)?.email
  if (e) { try { email.value = decodeURIComponent(e) } catch { email.value = String(e) } }
})

const resendCooldown = ref(0)
let cooldownTimer: ReturnType<typeof setInterval> | null = null
let redirectTimer: ReturnType<typeof setTimeout> | null = null
let mounted = true
function clearCooldown() {
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = null
  resendCooldown.value = 0
}
function startCooldown() {
  resendCooldown.value = 60
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    resendCooldown.value -= 1
    if (resendCooldown.value <= 0 && cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null }
  }, 1000)
}
onUnmounted(() => {
  mounted = false
  clearCooldown()
  if (redirectTimer) clearTimeout(redirectTimer)
})

// A code and password pair belongs to one normalized email only. Editing the
// address starts a new recovery flow and must not carry credentials or the
// previous account's resend countdown into it.
watch(
  () => email.value.trim().toLowerCase(),
  (next, previous) => {
    if (!previous || next === previous) return
    uni.hideToast()
    code.value = ''
    newPassword.value = ''
    confirmPw.value = ''
    showNewPw.value = false
    showConfirmPw.value = false
    clearCooldown()
  },
)

async function onResend() {
  if (resendCooldown.value > 0 || saving.value || resending.value) return
  const e = email.value.trim().toLowerCase()
  if (!EMAIL_RE.test(e)) { uni.showToast({ title: t('login.needEmail'), icon: 'none' }); return }
  resending.value = true
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(e)
    if (error) throw error
    if (!mounted) return
    uni.showToast({ title: t('resetPw.resent'), icon: 'none' })
    startCooldown()
  } catch (err: any) {
    if (mounted) uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none', duration: 3000 })
  } finally {
    resending.value = false
  }
}

async function onSave() {
  if (saving.value || resending.value) return
  const e = email.value.trim().toLowerCase()
  const submittedCode = code.value.trim()
  const submittedPassword = newPassword.value
  if (!EMAIL_RE.test(e)) { uni.showToast({ title: t('login.needEmail'), icon: 'none' }); return }
  if (submittedCode.length !== 6) { uni.showToast({ title: t('resetPw.needCode'), icon: 'none' }); return }
  if (!passwordValid(submittedPassword)) { uni.showToast({ title: t('login.needPassword'), icon: 'none', duration: 2500 }); return }
  if (submittedPassword !== confirmPw.value) { uni.showToast({ title: t('resetPw.mismatch'), icon: 'none' }); return }
  saving.value = true
  try {
    // Recovery authentication itself must also stay off the shared app
    // client: auth-js verifyOtp saves and broadcasts its returned session.
    // Using one fresh, non-persisted client for verify + update ensures an A
    // recovery never clears or replaces an ambient B session in this/other tabs.
    const recoveryClient = createEphemeralSupabaseClient()
    const { data: verification, error: vErr } = await recoveryClient.auth.verifyOtp({ email: e, token: submittedCode, type: 'recovery' })
    if (vErr) {
      const expired = (vErr as any)?.code === 'otp_expired' || /expired|invalid|token/i.test(vErr.message || '')
      if (mounted) uni.showToast({ title: expired ? t('resetPw.codeInvalid') : friendlyErrorMessage(vErr, lang.value as 'en' | 'zh'), icon: 'none', duration: 3000 })
      saving.value = false
      return
    }
    // Never call updateUser on the shared client here. auth-js reloads that
    // client's ambient session inside updateUser, so a later login in another
    // tab could otherwise replace recovery account A with account B between
    // these two awaits. Bind a fresh non-persisted client to the exact tokens
    // and identity returned by this verifyOtp call instead.
    const { error: uErr } = await updateRecoveryPasswordWithBoundSession(
      recoveryClient,
      verification,
      e,
      submittedPassword,
    )
    if (uErr) {
      const weak = (uErr as any)?.code === 'weak_password' || Array.isArray((uErr as any)?.reasons)
      const identityChanged = (uErr as any)?.code === RECOVERY_IDENTITY_MISMATCH
      if (mounted) uni.showToast({
        title: weak
          ? t('login.weakPassword')
          : (identityChanged
              ? t('resetPw.fail')
              : (friendlyErrorMessage(uErr, lang.value as 'en' | 'zh') || t('resetPw.fail'))),
        icon: 'none',
        duration: 3000,
      })
      saving.value = false
      return
    }
    if (!mounted) return
    uni.showToast({ title: t('resetPw.success'), icon: 'success', duration: 2000 })
    // The isolated recovery client intentionally does not sign the app in.
    // Return to login instead of entering home under an unrelated ambient
    // account (or falsely assuming the recovered account is persisted).
    redirectTimer = setTimeout(() => {
      redirectTimer = null
      if (mounted) uni.reLaunch({ url: '/pages/login/index' })
    }, 1500)
  } catch (err: any) {
    if (mounted) uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('resetPw.fail'), icon: 'none', duration: 3000 })
    saving.value = false
  }
}

function goLogin() {
  if (saving.value || resending.value) return
  uni.hideToast()
  uni.reLaunch({ url: '/pages/login/index' })
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh; background: var(--bg-elev-1);
  padding: 0 24px; max-width: 400px; margin: 0 auto;
  display: flex; flex-direction: column;
}

.header {
  display: flex; flex-direction: column; align-items: center;
  padding: 64px 0 32px;
  padding-top: calc(64px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
}
.logo-mark-img {
  width: 56px; height: 56px; border-radius: 14px;
  box-shadow: var(--shadow-soft);
}
.app-name {
  font-family: var(--font-serif);
  font-size: 22px; font-weight: 600; color: var(--text-primary);
  margin-top: 16px; letter-spacing: -0.02em;
}
.app-desc { font-size: 13px; color: var(--text-subtle); margin-top: 5px; text-align: center; line-height: 1.5; padding: 0 20px; }

.form { flex: 1; padding-bottom: 40px; }
.form-group { margin-bottom: 18px; }
.form-label { display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 7px; font-weight: 500; }
.form-input {
  width: 100%; height: 48px;
  background: var(--bg-elev-2); border-radius: 12px;
  padding: 0 16px; font-size: 15px; color: var(--text-primary);
  border: 1px solid transparent;
  &:focus { border-color: var(--line-soft); background: var(--bg-elev-1); }
}
.pw-wrap { position: relative; }
.pw-input { padding-right: 44px; }
.pw-toggle {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  cursor: pointer; padding: 4px; color: var(--text-muted);
}
.pw-toggle-icon { width: 18px; height: 18px; display: block; }

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

.pw-rules { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.pw-rule { display: flex; align-items: center; gap: 4px; }
.pw-rule-mark { width: 11px !important; height: 11px !important; }
.pw-rule-label { font-size: 11px; color: var(--text-muted); }
.pw-rule.ok .pw-rule-label { color: var(--success); }

.submit-btn {
  width: 100%; height: 48px;
  background: var(--accent-primary); color: #fff;
  border-radius: 24px; font-size: 15px; font-weight: 600;
  margin-top: 24px; border: none;
  &[disabled] { opacity: 0.35; }
  &:active { opacity: 0.8; }
}
.back-link {
  margin-top: 18px; text-align: center;
  font-size: 13px; color: var(--text-muted); font-weight: 500;
  cursor: pointer;
  &.disabled { color: var(--text-faint); pointer-events: none; }
  &:active { opacity: 0.7; }
}
</style>
