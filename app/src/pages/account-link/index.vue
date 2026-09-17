<template>
  <view class="page secondary-page secondary-page--settings has-sidebar" :class="mpThemeClass" :style="mpChrome">
    <AppSidebar current="profile" />
    <view class="secondary-content link-content">
      <view class="link-header">
        <button class="back-button" :aria-label="t('a11y.back')" :disabled="busy" @click="goBack"><UIcon name="chevron-left" size="sm" /></button>
        <text class="link-title" role="heading" aria-level="1">{{ t('wechat.title') }}</text>
      </view>
      <view class="link-layout">
        <view class="link-explanation">
          <text class="link-intro" role="heading" aria-level="2">{{ t('wechat.intro') }}</text>
          <text class="link-copy">{{ t('wechat.benefit') }}</text>
          <view class="link-steps">
            <text>{{ t('wechat.websiteStep') }}</text>
            <text>{{ t('wechat.codeStep') }}</text>
            <text>{{ t('wechat.phoneStep') }}</text>
          </view>
          <text class="link-copy">{{ t('wechat.privacyHint') }}</text>
        </view>
        <view class="link-card">
          <text v-if="checking" role="status">{{ t('wechat.checking') }}</text>
          <template v-else-if="!available">
            <text class="link-copy" role="status">{{ t(capabilitiesUnavailable ? 'wechat.connectionUnavailable' : 'wechat.disabled') }}</text>
            <button class="link-secondary" @click="refresh">{{ t('wechat.retry') }}</button>
          </template>
          <template v-else>
            <!-- #ifdef H5 -->
            <button v-if="!isLoggedIn" class="link-primary" @click="requireAuth('/pages/account-link/index')">{{ t('wechat.signin') }}</button>
            <template v-else-if="linked">
              <text class="link-intro">{{ t('wechat.linked') }}</text>
              <text class="link-copy">{{ t('wechat.linkedHint') }}</text>
            </template>
            <template v-else>
              <text class="link-label">{{ t('wechat.codeLabel') }}</text>
              <text v-if="issuedCode && seconds > 0" class="link-code" selectable>{{ formattedCode }}</text>
              <text v-if="issuedCode && seconds > 0" class="link-copy" role="status">{{ t('wechat.expires', { seconds }) }}</text>
              <text class="link-warning">{{ t('wechat.codeWarning') }}</text>
              <button class="link-primary" :class="{ disabled: busy }" :disabled="busy" @click="generateCode">{{ t(issuedCode ? 'wechat.regenerate' : 'wechat.generate') }}</button>
              <button v-if="issuedCode && seconds > 0" class="link-secondary" @click="copyCode">{{ t('wechat.copy') }}</button>
              <button v-if="errorKey === 'wechat.reauth_required'" class="link-secondary" :disabled="busy" @click="reauthenticate">{{ t('wechat.reauth') }}</button>
            </template>
            <!-- #endif -->
            <!-- #ifdef MP-WEIXIN -->
            <template v-if="isLoggedIn">
              <text class="link-copy">{{ t('wechat.signedInMp') }}</text>
              <text class="link-copy">{{ t('wechat.websiteOnly') }}</text>
            </template>
            <template v-else-if="!preview">
              <text class="link-copy">{{ t('wechat.websiteOnly') }}</text>
              <input v-model="enteredCode" class="code-input" maxlength="11" :disabled="busy" :placeholder="t('wechat.codeInput')" :aria-label="t('wechat.codeInput')" @input="errorKey = ''" />
              <text class="link-warning">{{ t('wechat.codeWarning') }}</text>
              <button class="link-primary" :class="{ disabled: busy || !enteredCode.trim() }" :disabled="busy || !enteredCode.trim()" @click="previewAccount">{{ t('wechat.preview') }}</button>
            </template>
            <template v-else>
              <text class="link-label">{{ t('wechat.target') }}</text>
              <text class="target-name">{{ preview.nickname || t('app.name') }}</text>
              <text class="link-copy">{{ preview.email_label }}</text>
              <text class="link-warning">{{ t('wechat.targetHint') }}</text>
              <button class="link-primary" :class="{ disabled: busy || seconds <= 0 }" :disabled="busy || seconds <= 0" @click="confirmAccount">{{ t('wechat.confirm') }}</button>
              <button class="link-secondary" :disabled="busy" @click="clearPrivateState">{{ t('wechat.back') }}</button>
            </template>
            <button v-if="errorKey && !isLoggedIn" class="link-secondary" :disabled="busy" @click="retryWechatLogin">{{ t('wechat.login') }}</button>
            <!-- #endif -->
          </template>
          <text v-if="errorKey" class="link-error" role="alert">{{ t(errorKey) }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { onLoad, onShow, onHide } from '@dcloudio/uni-app'
import AppSidebar from '../../components/AppSidebar.vue'
import UIcon from '../../components/UIcon.vue'
import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../composables/useAuth'
import { useSupabase } from '../../composables/useSupabase'
import { onAccountTransition, getActiveAccountId, captureAccountIdentityGeneration } from '../../composables/accountScope'
import { authorizeLoginReturnIntent, peekAuthorizedLoginReturnIntent, readLoginIntentNonce } from '../../api/navigationIntent'
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
import { navigateBackOr } from '../../utils'
import { freshWechatCode, wechatAccountRequest, wechatCapabilities, wechatErrorKey, type WechatLinkPreview } from '../../api/wechatAccountLink'

const { t } = useI18n()
const { isLoggedIn, requireAuth, signOut, signInWithWeChat } = useAuth()
const { supabase } = useSupabase()
const mpChrome = mpChromeVars()
const available = ref(false), checking = ref(true), linked = ref(false), busy = ref(false)
const capabilitiesUnavailable = ref(false)
const issuedCode = ref(''), enteredCode = ref(''), expiresAt = ref(0), now = ref(Date.now()), errorKey = ref('')
const preview = ref<WechatLinkPreview | null>(null)
const normalizedCode = computed(() => enteredCode.value.replace(/[ -]/g, '').toUpperCase())
const formattedCode = computed(() => `${issuedCode.value.slice(0, 5)} ${issuedCode.value.slice(5)}`)
const seconds = computed(() => Math.max(0, Math.ceil((expiresAt.value - now.value) / 1000)))
let epoch = 0, visible = false, clock: ReturnType<typeof setInterval> | null = null
let authAttempt = 0, loginIntentNonce: string | null = null
function clearPrivateState() {
  epoch += 1
  issuedCode.value = ''; enteredCode.value = ''; preview.value = null; expiresAt.value = 0
  errorKey.value = ''; busy.value = false
}
const stop = onAccountTransition(() => { clearPrivateState(); linked.value = false })
function isCurrent(request: number) { return visible && request === epoch }
async function websiteToken() {
  const userId = getActiveAccountId()
  let timer: ReturnType<typeof setTimeout> | undefined
  const sessionRead = supabase.auth.getSession()
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('session_unavailable')), 10_000)
  })
  const { data, error } = await Promise.race([sessionRead, deadline]).finally(() => clearTimeout(timer))
  if (error || !userId || data.session?.user.id !== userId) throw new Error('reauth_required')
  return data.session.access_token
}
async function refresh() {
  const request = ++epoch
  checking.value = true
  const capabilities = await wechatCapabilities()
  if (!isCurrent(request)) return
  available.value = capabilities.account_link
  capabilitiesUnavailable.value = capabilities.unavailable
  // #ifdef H5
  if (available.value && isLoggedIn.value) {
    try {
      const token = await websiteToken()
      if (!isCurrent(request)) return
      const state = await wechatAccountRequest('link_status', {}, token)
      if (isCurrent(request)) linked.value = state.linked === true
    } catch (error) { if (isCurrent(request)) errorKey.value = wechatErrorKey(error) }
  }
  // #endif
  if (isCurrent(request)) checking.value = false
}
async function generateCode() {
  if (busy.value) return
  clearPrivateState(); const request = epoch; busy.value = true
  try {
    const token = await websiteToken()
    if (!isCurrent(request)) return
    const result = await wechatAccountRequest('link_issue', {}, token)
    if (!isCurrent(request)) return
    if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(result.link_code) || !Number.isFinite(Date.parse(result.expires_at))) throw new Error('link_unavailable')
    issuedCode.value = result.link_code; expiresAt.value = Date.parse(result.expires_at); now.value = Date.now()
  } catch (error) { if (isCurrent(request)) errorKey.value = wechatErrorKey(error) }
  finally { if (isCurrent(request)) busy.value = false }
}
async function previewAccount() {
  if (busy.value) return
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(normalizedCode.value)) { errorKey.value = 'wechat.invalidCode'; return }
  const request = ++epoch, code = normalizedCode.value
  busy.value = true; errorKey.value = ''
  try {
    const jsCode = await freshWechatCode()
    if (!isCurrent(request)) return
    const result = await wechatAccountRequest<WechatLinkPreview>('link_preview', {js_code:jsCode,link_code:code})
    if (!isCurrent(request)) return
    if (!/^[0-9a-f]{64}$/.test(result.confirmation) || !Number.isFinite(Date.parse(result.expires_at))) throw new Error('link_unavailable')
    preview.value = result; expiresAt.value = Date.parse(result.expires_at); now.value = Date.now()
  } catch (error) { if (isCurrent(request)) errorKey.value = wechatErrorKey(error) }
  finally { if (isCurrent(request)) busy.value = false }
}
async function confirmAccount() {
  if (busy.value || !preview.value || seconds.value <= 0) return
  await finishWechatSignIn({linkCode:normalizedCode.value,confirmation:preview.value.confirmation})
}
async function retryWechatLogin() {
  if (busy.value) return
  await finishWechatSignIn()
}
async function finishWechatSignIn(fields: {linkCode?: string; confirmation?: string} = {}) {
  busy.value = true; errorKey.value = ''
  const attempt = ++authAttempt, request = epoch
  const identity = captureAccountIdentityGeneration()
  const { data, error } = await signInWithWeChat({...fields,isCurrent:()=>attempt === authAttempt && isCurrent(request)})
  // A successful sign-in clears secrets through the account transition, so
  // use a separate page-lifetime attempt plus the exact resulting identity.
  if (!visible || attempt !== authAttempt) return
  if (error) {
    if (!isCurrent(request)) return
    busy.value = false; preview.value = null; errorKey.value = wechatErrorKey(error)
    return
  }
  const userId = getActiveAccountId(), generation = captureAccountIdentityGeneration()
  if (!data?.user?.id || userId !== data.user.id || generation !== identity + 1) return
  busy.value = false
  const owner = {userId,identityGeneration:generation}
  if (loginIntentNonce) authorizeLoginReturnIntent(loginIntentNonce, owner)
  const target = loginIntentNonce ? peekAuthorizedLoginReturnIntent(loginIntentNonce, owner) : null
  uni.reLaunch({url:target || '/pages/index/index'})
}
async function reauthenticate() {
  if (busy.value) return
  busy.value = true
  const signedOut = await signOut({redirect:false})
  busy.value = false
  if (visible && signedOut) requireAuth('/pages/account-link/index')
}
function copyCode() {
  if (!issuedCode.value || seconds.value <= 0) return
  uni.setClipboardData({data:issuedCode.value,success:()=>uni.showToast({title:t('wechat.copied'),icon:'none'})})
}
function goBack() { if (!busy.value) navigateBackOr(() => uni.reLaunch({url:'/pages/settings/index'})) }
onLoad(options => { loginIntentNonce = readLoginIntentNonce(options?.intent) })
onShow(() => {
  visible = true; now.value = Date.now(); void refresh()
  if (clock) clearInterval(clock)
  clock = setInterval(() => {
    now.value = Date.now()
    if (expiresAt.value && seconds.value <= 0) { clearPrivateState(); errorKey.value = 'wechat.link_expired' }
  }, 1000)
})
onHide(() => { visible = false; authAttempt += 1; clearPrivateState(); if (clock) clearInterval(clock); clock = null })
onUnmounted(() => { visible = false; authAttempt += 1; clearPrivateState(); stop(); if (clock) clearInterval(clock) })
</script>

<style scoped>
.link-content { padding: 24px; }
.link-header { display:flex; align-items:center; gap:12px; margin-bottom:32px; }
.back-button { margin:0; padding:10px; background:var(--bg-subtle); line-height:1; border-radius:50%; }
.back-button::after { border:0; }
.link-title { font-size:22px; font-weight:600; color:var(--text-primary); }
.link-layout { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:36px; }
.link-explanation,.link-card { min-width:0; }
.link-intro { display:block; font-size:24px; line-height:1.5; font-weight:600; color:var(--text-primary); }
.link-copy { display:block; margin:14px 0; color:var(--text-secondary); font-size:15px; line-height:1.8; overflow-wrap:anywhere; }
.link-steps { display:flex; flex-direction:column; gap:20px; margin:32px 0; color:var(--text-primary); line-height:1.6; }
.link-card { padding:28px; background:var(--surface); border:1px solid var(--border); border-radius:20px; align-self:start; }
.link-label { display:block; color:var(--text-secondary); font-size:14px; }
.link-code { display:block; margin:20px 0; font:600 30px/1.5 monospace; letter-spacing:3px; color:var(--text-primary); }
.link-warning { display:block; margin:20px 0; padding:14px; border-radius:12px; background:var(--bg-subtle); color:var(--text-secondary); font-size:14px; line-height:1.7; }
.link-primary,.link-secondary { min-height:46px; margin-top:14px; font-size:15px; line-height:1.5; padding:12px 16px; border-radius:24px; }
.link-primary { background:var(--accent-primary); color:var(--ink-inverse); }
.link-secondary { background:var(--bg-subtle); color:var(--text-primary); }
.link-primary::after,.link-secondary::after { border:0; }
.link-primary.disabled { opacity:.5; }
.link-error { display:block; margin-top:18px; line-height:1.7; color:var(--danger); font-size:14px; }
.code-input { margin:20px 0; height:48px; padding:0 12px; border:1px solid var(--border); border-radius:12px; font-size:16px; color:var(--text-primary); background:var(--bg-subtle); }
.target-name { display:block; font-size:24px; font-weight:600; margin-top:16px; color:var(--text-primary); overflow-wrap:anywhere; }
@media (max-width: 959px) { .link-layout { grid-template-columns:1fr; gap:24px; } .link-content { padding:20px 16px; } .link-steps { gap:12px; margin:20px 0; } .link-card { padding:22px; } }
</style>
