<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" @click="goBack"><view class="back-arrow"></view></view>
      <text class="header-title">{{ t('settings.blockedUsers') }}</text>
    </view>

    <view v-if="blockedProfiles.length === 0 && !loading" class="empty">
      <view class="empty-shield"></view>
      <text class="empty-text">{{ t('blocked.empty') }}</text>
      <text class="empty-sub">{{ t('blocked.emptyHint') }}</text>
    </view>

    <view v-else class="list">
      <view v-for="p in blockedProfiles" :key="p.id" class="row">
        <image :src="p.avatar_url || '/static/default-avatar.svg'" class="avatar" mode="aspectFill" />
        <view class="info">
          <text class="nickname">{{ p.nickname }}</text>
          <text v-if="p.bio" class="bio">{{ p.bio }}</text>
        </view>
        <view class="unblock-btn" @click="onUnblock(p.id, p.nickname)">
          <text>{{ t('blocked.unblock') }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useSupabase } from '../../composables/useSupabase'
import { useI18n } from '../../composables/useI18n'
import { useModeration } from '../../composables/useModeration'

interface BlockedProfile {
  id: string
  nickname: string
  avatar_url: string
  bio: string
}

const { t } = useI18n()
const { supabase } = useSupabase()
const { blockedIds, loadBlockedIds, unblockUser } = useModeration()

const blockedProfiles = ref<BlockedProfile[]>([])
const loading = ref(true)

async function fetchProfiles() {
  loading.value = true
  await loadBlockedIds()
  const ids = Array.from(blockedIds.value)
  if (ids.length === 0) {
    blockedProfiles.value = []
    loading.value = false
    return
  }
  const { data } = await supabase
    .from('profiles')
    .select('id, nickname, avatar_url, bio')
    .in('id', ids)
  blockedProfiles.value = (data || []) as BlockedProfile[]
  loading.value = false
}

onShow(() => { fetchProfiles() })

function goBack() { uni.navigateBack() }

function onUnblock(id: string, name: string) {
  uni.showModal({
    title: t('blocked.unblockConfirm'),
    content: t('blocked.unblockHint', { name }),
    success: async (res) => {
      if (!res.confirm) return
      try {
        await unblockUser(id)
        blockedProfiles.value = blockedProfiles.value.filter(p => p.id !== id)
        uni.showToast({ title: t('blocked.unblocked'), icon: 'success' })
      } catch {
        uni.showToast({ title: t('blocked.unblockFailed'), icon: 'none' })
      }
    },
  })
}
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: #f2f2f7; max-width: 480px; margin: 0 auto; }

.header {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  padding-top: calc(12px + env(safe-area-inset-top, 0px));
  background: #fff; border-bottom: 0.5px solid rgba(0,0,0,0.06);
}
.back-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.back-arrow { width: 9px; height: 9px; border-left: 2px solid #1a1a1a; border-bottom: 2px solid #1a1a1a; transform: rotate(45deg); margin-left: 4px; }
.header-title { font-size: 17px; font-weight: 600; color: #1a1a1a; }

.empty {
  display: flex; flex-direction: column; align-items: center;
  padding-top: 100px; gap: 10px; text-align: center;
}
.empty-shield {
  width: 44px; height: 50px; position: relative;
  border: 2.5px solid #d1d1d6;
  border-radius: 22px 22px 12px 12px;
  margin-bottom: 6px;
}
.empty-text { font-size: 15px; font-weight: 600; color: #1a1a1a; }
.empty-sub { font-size: 13px; color: #8e8e93; max-width: 260px; line-height: 1.5; }

.list { background: #fff; margin-top: 7px; }
.row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; border-bottom: 0.5px solid rgba(0,0,0,0.06);
  &:last-child { border-bottom: none; }
}
.avatar { width: 40px; height: 40px; border-radius: 50%; background: #f2f2f7; flex-shrink: 0; }
.info { flex: 1; min-width: 0; }
.nickname { font-size: 15px; font-weight: 600; color: #1a1a1a; display: block; }
.bio {
  font-size: 12px; color: #8e8e93; margin-top: 2px; display: block;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.unblock-btn {
  padding: 6px 14px; border-radius: 14px;
  background: #f2f2f7; cursor: pointer;
  text { font-size: 13px; font-weight: 500; color: #1a1a1a; }
  &:active { background: #e5e5ea; }
}
</style>
