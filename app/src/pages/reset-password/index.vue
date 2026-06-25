<template>
  <view class="page">
    <view class="header">
      <view class="logo-mark"><view class="logo-letter">I</view></view>
      <text class="app-name">{{ t('resetPw.title') }}</text>
      <text class="app-desc">{{ t('resetPw.hint') }}</text>
    </view>

    <view class="form">
      <view class="form-group">
        <text class="form-label">{{ t('resetPw.email') }}</text>
        <input v-model="email" :placeholder="t('login.email')" type="text" autocomplete="email" class="form-input" />
      </view>

      <view class="form-group">
        <text class="form-label">{{ t('resetPw.code') }}</text>
        <UCodeInput v-model="code" :placeholder="t('resetPw.codePlaceholder')" />
        <view class="code-row">
          <text class="code-hint">{{ email ? t('resetPw.codeHint', { email }) : t('resetPw.codeHintNoEmail') }}</text>
          <text :class="['resend', { disabled: resendCooldown > 0 }]" role="button" @click="onResend">
            {{ resendCooldown > 0 ? t('resetPw.resendIn', { n: resendCooldown }) : t('resetPw.resend') }}
          </text>
        </view>
      </view>

      <view class="form-group">
        <text class="form-label">{{ t('resetPw.newPassword') }}</text>
        <view class="pw-wrap">
          <input v-model="newPassword" :placeholder="t('resetPw.newPassword')" :password="!showNewPw" autocomplete="new-password" class="form-input pw-input" />
          <view class="pw-toggle" role="button" :aria-label="t('a11y.passwordToggle')" @click="showNewPw = !showNewPw">
            <image :src="showNewPw ? '/static/eye-off.svg' : '/static/eye.svg'" alt="" class="pw-toggle-icon" mode="aspectFit" />
          </view>
        </view>
        <!-- Live password-policy checklist — same component as the signup tab
             so the reset flow shows which rule fails before submit. -->
        <view class="pw-rules">
          <view v-for="r in pwRules" :key="r.key" :class="['pw-rule', { ok: r.ok }]">
            <text class="pw-rule-mark">{{ r.ok ? '✓' : '○' }}</text>
            <text class="pw-rule-label">{{ t('login.pwRule.' + r.key) }}</text>
          </view>
        </view>
      </view>
      <view class="form-group">
        <text class="form-label">{{ t('resetPw.confirm') }}</text>
        <view class="pw-wrap">
          <input v-model="confirmPw" :placeholder="t('resetPw.confirm')" :password="!showConfirmPw" autocomplete="new-password" class="form-input pw-input" />
          <view class="pw-toggle" role="button" :aria-label="t('a11y.passwordToggle')" @click="showConfirmPw = !showConfirmPw">
            <image :src="showConfirmPw ? '/static/eye-off.svg' : '/static/eye.svg'" alt="" class="pw-toggle-icon" mode="aspectFit" />
          </view>
        </view>
      </view>

      <button class="submit-btn" :disabled="saving" @click="onSave">
        {{ saving ? t('login.wait') : t('resetPw.save') }}
      </button>
      <view class="back-link" role="button" @click="goLogin">{{ t('resetPw.backLogin') }}</view>
    </view>
  </view>
</template>

<script setup lang="ts">
/*
 * Password reset via typed 6-digit OTP code (QA6 #1).
 *
 * The old PKCE magic-link flow failed: mail scanners pre-fetched the
 * single-use link, so it showed "expired" even when clicked immediately.
 * Now the recovery email carries a {{ .Token }} 6-digit code (Supabase
 * dashboard template change — operator action), the user types it here,
 * and verifyOtp({ type:'recovery' }) establishes a recovery-scoped session
 * that updateUser({password}) can write against. No link, no PKCE
 * exchange, no fragile recovery-context inference.
 */
import { ref, computed, onUnmounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useSupabase } from '../../composables/useSupabase'
import { useI18n } from '../../composables/useI18n'
import { passwordRules, passwordValid, friendlyErrorMessage } from '../../utils'
import UCodeInput from '../../components/UCodeInput.vue'

const { t, lang } = useI18n()
const { supabase } = useSupabase()

const email = ref('')
const code = ref('')
const newPassword = ref('')
const confirmPw = ref('')
const showNewPw = ref(false)
const showConfirmPw = ref(false)
const saving = ref(false)
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
function startCooldown() {
  resendCooldown.value = 60
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    resendCooldown.value -= 1
    if (resendCooldown.value <= 0 && cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null }
  }, 1000)
}
onUnmounted(() => { if (cooldownTimer) clearInterval(cooldownTimer) })

async function onResend() {
  if (resendCooldown.value > 0) return
  const e = email.value.trim().toLowerCase()
  if (!EMAIL_RE.test(e)) { uni.showToast({ title: t('login.needEmail'), icon: 'none' }); return }
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(e)
    if (error) throw error
    uni.showToast({ title: t('resetPw.resent'), icon: 'none' })
    startCooldown()
  } catch (err: any) {
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none', duration: 3000 })
  }
}

async function onSave() {
  const e = email.value.trim().toLowerCase()
  if (!EMAIL_RE.test(e)) { uni.showToast({ title: t('login.needEmail'), icon: 'none' }); return }
  if (code.value.trim().length !== 6) { uni.showToast({ title: t('resetPw.needCode'), icon: 'none' }); return }
  if (!passwordValid(newPassword.value)) { uni.showToast({ title: t('login.needPassword'), icon: 'none', duration: 2500 }); return }
  if (newPassword.value !== confirmPw.value) { uni.showToast({ title: t('resetPw.mismatch'), icon: 'none' }); return }
  saving.value = true
  try {
    const { error: vErr } = await supabase.auth.verifyOtp({ email: e, token: code.value.trim(), type: 'recovery' })
    if (vErr) {
      const expired = (vErr as any)?.code === 'otp_expired' || /expired|invalid|token/i.test(vErr.message || '')
      uni.showToast({ title: expired ? t('resetPw.codeInvalid') : friendlyErrorMessage(vErr, lang.value as 'en' | 'zh'), icon: 'none', duration: 3000 })
      saving.value = false
      return
    }
    // verifyOtp('recovery') just signed us in with a recovery-scoped session,
    // so updateUser({password}) writes cleanly (no "current password required").
    const { error: uErr } = await supabase.auth.updateUser({ password: newPassword.value })
    if (uErr) {
      const weak = (uErr as any)?.code === 'weak_password' || Array.isArray((uErr as any)?.reasons)
      uni.showToast({ title: weak ? t('login.weakPassword') : (uErr.message || t('resetPw.fail')), icon: 'none', duration: 3000 })
      saving.value = false
      return
    }
    uni.showToast({ title: t('resetPw.success'), icon: 'success', duration: 2000 })
    // reLaunch flushes the back-stack so Back can't return to this page.
    setTimeout(() => uni.reLaunch({ url: '/pages/index/index' }), 1500)
  } catch (err: any) {
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('resetPw.fail'), icon: 'none', duration: 3000 })
    saving.value = false
  }
}

function goLogin() { uni.reLaunch({ url: '/pages/login/index' }) }
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
  padding-top: calc(64px + var(--status-bar-height, env(safe-area-inset-top, 0px)));
}
.logo-mark {
  width: 56px; height: 56px; border-radius: 14px;
  background: var(--accent-primary);
  display: flex; align-items: center; justify-content: center;
}
.logo-letter { font-size: 28px; font-weight: 800; color: #fff; letter-spacing: -1px; }
.app-name { font-size: 22px; font-weight: 700; color: var(--text-primary); margin-top: 16px; }
.app-desc { font-size: 13px; color: var(--text-faint); margin-top: 5px; text-align: center; line-height: 1.5; padding: 0 20px; }

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
.code-hint { font-size: 11px; color: var(--text-faint); line-height: 1.4; flex: 1; }
.resend {
  font-size: 12px; color: var(--accent-primary); font-weight: 600;
  cursor: pointer; flex-shrink: 0;
  &.disabled { color: var(--text-faint); pointer-events: none; }
  &:active { opacity: 0.7; }
}

.pw-rules { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.pw-rule { display: flex; align-items: center; gap: 4px; }
.pw-rule-mark { font-size: 11px; color: var(--text-faint); line-height: 1; }
.pw-rule-label { font-size: 11px; color: var(--text-muted); }
.pw-rule.ok .pw-rule-mark { color: var(--success); }
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
  &:active { opacity: 0.7; }
}
</style>
