<template>
  <view class="page">
    <view class="header">
      <view class="logo-mark"><view class="logo-letter">I</view></view>
      <text class="app-name">{{ t('resetPw.title') }}</text>
      <text class="app-desc">{{ t('resetPw.hint') }}</text>
    </view>

    <view v-if="!ready" class="loading">
      <view class="spinner"></view>
      <text>{{ t('resetPw.verifying') }}</text>
    </view>

    <view v-else-if="ready && !errorMsg" class="form">
      <view class="form-group">
        <text class="form-label">{{ t('resetPw.newPassword') }}</text>
        <input v-model="newPassword" :placeholder="t('resetPw.newPassword')" password class="form-input" />
      </view>
      <view class="form-group">
        <text class="form-label">{{ t('resetPw.confirm') }}</text>
        <input v-model="confirmPw" :placeholder="t('resetPw.confirm')" password class="form-input" />
      </view>

      <button class="submit-btn" :disabled="saving" @click="onSave">
        {{ saving ? t('login.wait') : t('resetPw.save') }}
      </button>
    </view>

    <view v-else class="error">
      <text class="error-text">{{ errorMsg }}</text>
      <view class="back-btn" @click="goLogin">{{ t('resetPw.backLogin') }}</view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSupabase } from '../../composables/useSupabase'
import { useI18n } from '../../composables/useI18n'

const { t } = useI18n()
const { supabase } = useSupabase()

const ready = ref(false)
const errorMsg = ref('')
const newPassword = ref('')
const confirmPw = ref('')
const saving = ref(false)

onMounted(async () => {
  try {
    // #ifdef H5
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    if (hash.includes('error=')) {
      const params = new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
      errorMsg.value = params.get('error_description') || params.get('error') || t('resetPw.linkInvalid')
      ready.value = true
      return
    }
    // #endif
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session) {
      errorMsg.value = t('resetPw.linkInvalid')
    }
    ready.value = true
  } catch (err: any) {
    errorMsg.value = err?.message || t('resetPw.linkInvalid')
    ready.value = true
  }
})

async function onSave() {
  if (newPassword.value.length < 8) {
    uni.showToast({ title: t('login.needPassword'), icon: 'none' })
    return
  }
  if (newPassword.value !== confirmPw.value) {
    uni.showToast({ title: t('resetPw.mismatch'), icon: 'none' })
    return
  }
  saving.value = true
  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword.value })
    if (error) throw error
    uni.showToast({ title: t('resetPw.success'), icon: 'success', duration: 2000 })
    setTimeout(() => uni.reLaunch({ url: '/pages/index/index' }), 1500)
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('resetPw.fail'), icon: 'none', duration: 3000 })
  } finally {
    saving.value = false
  }
}

function goLogin() {
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
  padding: 72px 0 40px;
  padding-top: calc(72px + env(safe-area-inset-top, 0px));
}
.logo-mark {
  width: 56px; height: 56px; border-radius: 14px;
  background: var(--accent-primary);
  display: flex; align-items: center; justify-content: center;
}
.logo-letter { font-size: 28px; font-weight: 800; color: #fff; letter-spacing: -1px; }
.app-name { font-size: 22px; font-weight: 700; color: var(--text-primary); margin-top: 16px; }
.app-desc { font-size: 13px; color: var(--text-faint); margin-top: 5px; text-align: center; line-height: 1.5; padding: 0 20px; }

.loading {
  display: flex; flex-direction: column; align-items: center;
  gap: 14px; padding: 60px 0;
  text { font-size: 13px; color: var(--text-muted); }
}
.spinner {
  width: 24px; height: 24px;
  border: 2.5px solid var(--bg-inset); border-top-color: var(--text-primary);
  border-radius: 50%; animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.form { flex: 1; }
.form-group { margin-bottom: 18px; }
.form-label { display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 7px; font-weight: 500; }
.form-input {
  width: 100%; height: 48px;
  background: var(--bg-elev-2); border-radius: 12px;
  padding: 0 16px; font-size: 15px; color: var(--text-primary);
  border: 1px solid transparent;
  &:focus { border-color: rgba(0,0,0,0.12); background: var(--bg-elev-1); }
}
.submit-btn {
  width: 100%; height: 48px;
  background: var(--accent-primary); color: #fff;
  border-radius: 24px; font-size: 15px; font-weight: 600;
  margin-top: 24px; border: none;
  &[disabled] { opacity: 0.35; }
  &:active { opacity: 0.8; }
}

.error {
  display: flex; flex-direction: column; align-items: center;
  padding: 40px 0; gap: 20px;
}
.error-text { font-size: 14px; color: var(--accent-danger); text-align: center; line-height: 1.5; }
.back-btn {
  padding: 12px 28px; background: var(--accent-primary); color: #fff;
  border-radius: 22px; font-size: 14px; font-weight: 600; cursor: pointer;
  &:active { opacity: 0.8; }
}
</style>
