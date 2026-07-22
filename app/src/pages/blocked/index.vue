<template>
  <view class="page" :class="mpThemeClass" :style="mpChrome">
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack"><UIcon name="chevron-left" size="xs" color="accent-primary" /></view>
      <text class="header-title">{{ t('settings.blockedUsers') }}</text>
    </view>

    <view v-if="loading && blockedProfiles.length === 0" class="list">
      <view v-for="n in 6" :key="'bs' + n" class="blk-skel">
        <view class="bs-avatar u-sk"></view>
        <view class="bs-info">
          <view class="bs-line u-sk" style="width: 35%"></view>
          <view class="bs-line u-sk" style="width: 62%"></view>
        </view>
        <view class="bs-pill u-sk"></view>
      </view>
    </view>

    <view v-else-if="loadError && !loading" class="empty" role="alert" aria-live="assertive" aria-atomic="true">
      <view class="empty-shield"></view>
      <text class="empty-text">{{ t('error.loadFailed') }}</text>
      <view class="unblock-btn" role="button" :aria-label="t('home.retry')" @click="fetchProfiles">
        <text class="unblock-btn-label">{{ t('home.retry') }}</text>
      </view>
    </view>

    <view v-else-if="blockedProfiles.length === 0 && !loading" class="empty">
      <view class="empty-shield"></view>
      <text class="empty-text">{{ t('blocked.empty') }}</text>
      <text class="empty-sub">{{ t('blocked.emptyHint') }}</text>
    </view>

    <view v-else class="list u-stagger">
      <view v-for="p in blockedProfiles" :key="p.id" class="row">
        <UAvatar :src="p.avatar_url" :owner="p.id" :fallback="defaultAvatarSrc" :alt="p.nickname || 'avatar'" class="avatar" lazy />
        <view class="info">
          <text class="nickname">{{ p.nickname }}</text>
          <text v-if="p.bio" class="bio">{{ p.bio }}</text>
        </view>
        <view
          class="unblock-btn"
          role="button"
          :aria-label="t('blocked.unblock') + ': ' + p.nickname"
          @click="onUnblock(p.id, p.nickname)"
        >
          <text class="unblock-btn-label">{{ t('blocked.unblock') }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
import { ref, computed, watch } from 'vue'
import { onShow, onUnload } from '@dcloudio/uni-app'
import { useSupabase } from '../../composables/useSupabase'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import { useModeration } from '../../composables/useModeration'
import { useTheme } from '../../composables/useTheme'
import { createAccountPageScope } from '../../composables/accountPageScope'
import { navigateBackOr } from '../../utils'
import UAvatar from '../../components/UAvatar.vue'
import UIcon from '../../components/UIcon.vue'

interface BlockedProfile {
  id: string
  nickname: string
  avatar_url: string
  bio: string
}

const { t } = useI18n()
const { isDark } = useTheme()
const defaultAvatarSrc = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)
const { supabase } = useSupabase()
const { currentUser, awaitAuthReady, requireAuth } = useAuth()
const { blockedIds, loadBlockedIds, unblockUser } = useModeration()

const blockedProfiles = ref<BlockedProfile[]>([])
const loading = ref(true)
const loadError = ref(false)
let blockedPageAlive = true

function clearBlockedPageState() {
  blockedProfiles.value = []
  loading.value = false
  loadError.value = false
}

const blockedPageScope = createAccountPageScope(() => {
  clearBlockedPageState()
})
// Modal mutations are concurrent with list refreshes; keep their epoch separate
// so opening an action sheet cannot strand the list's loading finalizer.
const blockedActionScope = createAccountPageScope(() => {})

async function fetchProfilesForUser(userId: string): Promise<boolean> {
  const request = blockedPageScope.begin(userId)
  if (!request) return false
  loading.value = true
  loadError.value = false
  try {
    const result = await loadBlockedIds()
    if (!blockedPageScope.isCurrent(request)) return false
    if (!result.ok) throw result.error || new Error(result.reason)
    if (result.userId !== userId) return false
    const ids = Array.from(blockedIds.value)
    if (ids.length === 0) {
      blockedProfiles.value = []
      return true
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, nickname, avatar_url, bio')
      .in('id', ids)
    if (error) throw error
    if (!blockedPageScope.isCurrent(request)) return false
    blockedProfiles.value = (data || []) as BlockedProfile[]
    return true
  } catch {
    if (!blockedPageScope.isCurrent(request)) return false
    blockedProfiles.value = []
    loadError.value = true
    uni.showToast({ title: t('error.loadFailed'), icon: 'none', duration: 2500 })
    return false
  } finally {
    if (blockedPageScope.isCurrent(request)) loading.value = false
  }
}

function fetchProfiles(): Promise<boolean> {
  const userId = currentUser.value?.id
  return userId ? fetchProfilesForUser(userId) : Promise.resolve(false)
}

onShow(async () => {
  const state = await awaitAuthReady()
  if (!blockedPageAlive) return
  if (state === 'anonymous') {
    blockedPageScope.invalidate()
    clearBlockedPageState()
    requireAuth()
    return
  }
  const uid = currentUser.value?.id
  if (!uid) {
    blockedPageScope.invalidate()
    clearBlockedPageState()
    return
  }
  await fetchProfilesForUser(uid)
})

watch(() => currentUser.value?.id || null, (uid, previousUid) => {
  if (uid === previousUid) return
  blockedPageScope.invalidate()
  clearBlockedPageState()
  if (uid) void fetchProfilesForUser(uid)
})

onUnload(() => {
  blockedPageAlive = false
  clearBlockedPageState()
  blockedPageScope.dispose()
  blockedActionScope.dispose()
})

function goBack() { navigateBackOr(() => uni.switchTab({ url: '/pages/profile/index' })) }

function onUnblock(id: string, name: string) {
  const ownerId = currentUser.value?.id
  if (!ownerId) return
  const request = blockedActionScope.begin(ownerId)
  if (!request) return
  uni.showModal({
    title: t('blocked.unblockConfirm'),
    content: t('blocked.unblockHint', { name }),
    success: async (res) => {
      if (!res.confirm || !blockedActionScope.isCurrent(request)) return
      try {
        await unblockUser(id)
        if (!blockedActionScope.isCurrent(request)) return
        blockedProfiles.value = blockedProfiles.value.filter(p => p.id !== id)
        uni.showToast({ title: t('blocked.unblocked'), icon: 'success' })
      } catch {
        if (blockedActionScope.isCurrent(request)) {
          uni.showToast({ title: t('blocked.unblockFailed'), icon: 'none' })
        }
      }
    },
  })
}
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: var(--bg-subtle); max-width: 480px; margin: 0 auto; }

.header {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  padding-top: calc(12px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
  background: var(--bg-elev-1); border-bottom: 0.5px solid var(--line-hair);
}
.back-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.header-title { font-size: 17px; font-weight: 600; color: var(--text-primary); }

.empty {
  display: flex; flex-direction: column; align-items: center;
  padding-top: 100px; gap: 10px; text-align: center;
}
.empty-shield {
  width: 44px; height: 50px; position: relative;
  border: 2.5px solid var(--border-strong);
  border-radius: 22px 22px 12px 12px;
  margin-bottom: 6px;
}
.empty-text { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.empty-sub { font-size: 13px; color: var(--text-muted); max-width: 260px; line-height: 1.5; }

.list { background: var(--bg-elev-1); margin-top: 7px; }
.blk-skel {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; border-bottom: 0.5px solid var(--line-hair);
  &:last-child { border-bottom: none; }
}
.bs-avatar { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; }
.bs-info { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.bs-line { height: 11px; }
.bs-pill { width: 58px; height: 27px; border-radius: 14px; flex-shrink: 0; }
.row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; border-bottom: 0.5px solid var(--line-hair);
  &:last-child { border-bottom: none; }
}
.avatar { width: 40px; height: 40px; border-radius: 50%; background: var(--bg-subtle); flex-shrink: 0; }
.info { flex: 1; min-width: 0; }
.nickname { font-size: 15px; font-weight: 600; color: var(--text-primary); display: block; }
.bio {
  font-size: 12px; color: var(--text-muted); margin-top: 2px; display: block;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.unblock-btn {
  padding: 6px 14px; border-radius: 14px;
  background: var(--bg-subtle); cursor: pointer;
  .unblock-btn-label { font-size: 13px; font-weight: 500; color: var(--text-primary); }
  &:active { background: var(--bg-inset); }
}
</style>
