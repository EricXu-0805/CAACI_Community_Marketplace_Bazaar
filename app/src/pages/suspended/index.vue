<template>
  <view class="page">
    <view class="hero">
      <view :class="['hero-icon', levelClass]"><view class="hero-icon-inner"></view></view>
      <text class="hero-badge">{{ t('suspended.badge') }} · L{{ level }}</text>
      <text class="hero-title">{{ titleText }}</text>
      <text class="hero-sub">{{ subText }}</text>
    </view>

    <view class="card" v-if="activeSuspension">
      <view class="row">
        <text class="row-label">{{ t('suspended.level') }}</text>
        <text class="row-value">L{{ activeSuspension.level }} — {{ levelName }}</text>
      </view>
      <view class="row" v-if="activeSuspension.reason">
        <text class="row-label">{{ t('suspended.reason') }}</text>
        <text class="row-value">{{ activeSuspension.reason }}</text>
      </view>
      <view class="row" v-if="endsText">
        <text class="row-label">{{ t('suspended.endsAt') }}</text>
        <text class="row-value">{{ endsText }}</text>
      </view>
      <view class="row" v-if="activeSuspension.category">
        <text class="row-label">{{ t('suspended.category') }}</text>
        <text class="row-value">{{ activeSuspension.category }}</text>
      </view>
    </view>

    <view class="card">
      <text class="card-title">{{ t('suspended.whatHappens') }}</text>
      <text class="card-body">{{ t('suspended.whatHappensBody') }}</text>
    </view>

    <view class="card" v-if="!appealSubmitted">
      <text class="card-title">{{ t('suspended.appealTitle') }}</text>
      <text class="card-body">{{ t('suspended.appealHint') }}</text>
      <textarea
        v-model="appealText"
        class="appeal-input"
        :placeholder="t('suspended.appealPlaceholder')"
        :maxlength="2000"
      />
      <view class="appeal-meta">
        <text>{{ appealText.length }}/2000</text>
      </view>
      <view
        :class="['btn-primary', { disabled: submittingAppeal || appealText.trim().length < 10 }]"
        role="button" :aria-label="t('suspended.submitAppeal')"
        @click="onSubmitAppeal"
      >
        <text>{{ submittingAppeal ? t('suspended.submitting') : t('suspended.submitAppeal') }}</text>
      </view>
    </view>
    <view class="card notice" v-else>
      <text class="card-title">{{ t('suspended.appealSent') }}</text>
      <text class="card-body">{{ t('suspended.appealSentBody') }}</text>
    </view>

    <view class="footer">
      <view class="btn-ghost" role="button" :aria-label="t('suspended.viewTerms')" @click="goLegal">
        <text>{{ t('suspended.viewTerms') }}</text>
      </view>
      <view class="btn-ghost" role="button" :aria-label="t('profile.signOut')" @click="onSignOut">
        <text>{{ t('profile.signOut') }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../composables/useAuth'
import { useSupabase } from '../../composables/useSupabase'
import { DIALOG_DANGER } from '../../utils/dialogColors'
import { captureException } from '../../utils/sentry'

const { t, lang } = useI18n()
const { currentUser, signOut } = useAuth()
const { supabase } = useSupabase()

interface SuspensionRow {
  id: string
  level: number
  reason: string
  category: string
  started_at: string
  ends_at: string | null
  appeal_note: string | null
}

const activeSuspension = ref<SuspensionRow | null>(null)
const appealText = ref('')
const submittingAppeal = ref(false)
const appealSubmitted = ref(false)

const level = computed(() => currentUser.value?.suspension_level || 0)
const levelClass = computed(() => `level-${Math.min(5, level.value)}`)

const levelName = computed(() => {
  const n = activeSuspension.value?.level ?? level.value
  return t(`suspended.l${n}Name`)
})

const titleText = computed(() => {
  const n = activeSuspension.value?.level ?? level.value
  if (n >= 5) return t('suspended.titlePerma')
  if (n >= 4) return t('suspended.titleLong')
  if (n >= 3) return t('suspended.titleMid')
  return t('suspended.titleShort')
})

const subText = computed(() => {
  if (level.value >= 5) return t('suspended.subPerma')
  return t('suspended.sub')
})

const endsText = computed(() => {
  const ends = activeSuspension.value?.ends_at
  if (!ends) return ''
  const d = new Date(ends)
  if (Number.isNaN(d.getTime())) return ''
  if (d.getTime() > 8640000000000000 / 2) return t('suspended.endsPerma')
  try {
    return d.toLocaleString(lang.value === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return d.toISOString()
  }
})

onMounted(async () => {
  await loadActiveSuspension()
})

async function loadActiveSuspension() {
  if (!currentUser.value) return
  const { data, error } = await supabase
    .from('suspensions')
    .select('id, level, reason, category, started_at, ends_at, appeal_note')
    .eq('profile_id', currentUser.value.id)
    .is('lifted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    captureException(error, { tags: { source: 'suspended.loadActiveSuspension' }, level: 'warning' })
    uni.showToast({ title: t('error.loadFailed'), icon: 'none', duration: 2500 })
    return
  }
  if (data) {
    activeSuspension.value = data as SuspensionRow
    if (data.appeal_note) appealSubmitted.value = true
  }
}

async function onSubmitAppeal() {
  if (submittingAppeal.value) return
  const text = appealText.value.trim()
  if (text.length < 10) {
    uni.showToast({ title: t('suspended.tooShort'), icon: 'none' })
    return
  }
  submittingAppeal.value = true
  try {
    const { error } = await supabase.rpc('submit_appeal', { note_in: text })
    if (error) throw error
    appealSubmitted.value = true
    uni.showToast({ title: t('suspended.appealSent'), icon: 'success' })
  } catch (e: any) {
    uni.showToast({ title: e?.message || t('suspended.appealFail'), icon: 'none', duration: 2500 })
  } finally {
    submittingAppeal.value = false
  }
}

function goLegal() {
  uni.navigateTo({ url: '/pages/legal/index?type=terms' })
}

function onSignOut() {
  uni.showModal({
    title: t('profile.signOut'),
    content: t('suspended.signOutHint'),
    confirmText: t('profile.signOut'),
    cancelText: t('reconsent.goBack'),
    confirmColor: DIALOG_DANGER,
    success: (r) => { if (r.confirm) signOut() },
  })
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh; height: 100dvh;
  display: flex; flex-direction: column;
  background: var(--bg-page);
  padding: 0 20px;
  padding-top: calc(28px + var(--status-bar-height, env(safe-area-inset-top, 0px)));
  padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  max-width: 480px; margin: 0 auto;
  overflow-y: auto;
}

.hero { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px 0 20px; }
.hero-icon {
  width: 72px; height: 72px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 4px;
  background: var(--warning-soft);
}
.hero-icon.level-3 { background: var(--brand-soft); }
.hero-icon.level-4 { background: var(--danger-soft); }
.hero-icon.level-5 { background: var(--danger-soft); }
.hero-icon-inner {
  width: 4px; height: 28px; border-radius: 2px; background: var(--accent-warn);
  position: relative;
}
.hero-icon-inner::after {
  content: ''; position: absolute; bottom: -10px; left: -2px;
  width: 8px; height: 8px; border-radius: 50%; background: var(--accent-warn);
}
.level-3 .hero-icon-inner, .level-3 .hero-icon-inner::after { background: var(--accent-action); }
.level-4 .hero-icon-inner, .level-4 .hero-icon-inner::after { background: var(--danger); }
.level-5 .hero-icon-inner, .level-5 .hero-icon-inner::after { background: var(--danger); }

.hero-badge {
  font-size: 11px; color: var(--accent-action); font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  padding: 3px 10px; border-radius: var(--radius-pill);
  background: var(--brand-ghost);
}
.hero-title {
  font-family: var(--font-serif); font-size: 22px; font-weight: 600;
  color: var(--text-primary); letter-spacing: -0.02em; text-align: center;
}
.hero-sub { font-size: 14px; color: var(--text-secondary); line-height: 1.5; text-align: center; padding: 0 8px; }

.card {
  background: var(--bg-elev-1); border-radius: 12px;
  padding: 16px; margin-bottom: 12px;
  border: 0.5px solid var(--line-hair);
}
.card.notice { background: var(--success-soft); }
.card-title { display: block; font-size: 14px; font-weight: 700; color: var(--text-primary); margin-bottom: 8px; }
.card-body { display: block; font-size: 13px; color: var(--text-secondary); line-height: 1.55; white-space: pre-wrap; }

.row { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; }
.row-label { font-size: 12px; color: var(--text-muted); font-weight: 500; flex-shrink: 0; }
.row-value { font-size: 13px; color: var(--text-primary); text-align: right; font-weight: 500; }

.appeal-input {
  width: 100%; min-height: 110px;
  border: 1px solid var(--line-soft); border-radius: 10px;
  padding: 12px; font-size: 14px; color: var(--text-primary);
  background: var(--bg-page); margin-top: 10px;
  line-height: 1.5;
  box-sizing: border-box;
}
.appeal-meta { text-align: right; font-size: 11px; color: var(--text-faint); margin-top: 4px; }

.btn-primary, .btn-ghost {
  text-align: center; padding: 12px;
  border-radius: 22px; font-size: 14px; font-weight: 600;
  cursor: pointer;
}
.btn-primary {
  background: var(--accent-primary); color: #fff;
  margin-top: 10px;
  box-shadow: var(--shadow-cta);
  &.disabled { opacity: 0.3; pointer-events: none; }
}
.btn-ghost {
  flex: 1;
  background: var(--bg-subtle); color: var(--text-secondary);
  &:active { background: var(--bg-inset); }
}

.footer { display: flex; gap: 8px; margin-top: 8px; }
</style>
