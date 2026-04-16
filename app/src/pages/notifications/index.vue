<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" @click="goBack"><view class="back-arrow"></view></view>
      <text class="header-title">{{ t('notif.title') }}</text>
      <text v-if="notifications.length > 0" class="mark-all" @click="onMarkAll">{{ t('notif.markAll') }}</text>
    </view>

    <view v-if="notifications.length === 0" class="empty">
      <text class="empty-icon">🔔</text>
      <text class="empty-text">{{ t('notif.empty') }}</text>
    </view>

    <view v-else class="notif-list">
      <view
        v-for="n in notifications"
        :key="n.id"
        :class="['notif-item', { unread: !n.is_read }]"
        @click="onTap(n)"
        @longpress="onLongPress(n.id)"
      >
        <view class="notif-icon">
          <text>{{ n.type === 'price_drop' ? '💰' : n.type === 'sold' ? '🎉' : '📢' }}</text>
        </view>
        <view class="notif-content">
          <text class="notif-title">{{ n.title }}</text>
          <text class="notif-body">{{ n.body }}</text>
          <text class="notif-time">{{ formatTime(n.created_at) }}</text>
        </view>
        <view v-if="!n.is_read" class="notif-dot"></view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { useI18n } from '../../composables/useI18n'
import { useNotifications, type Notification } from '../../composables/useNotifications'
import { formatTime } from '../../utils'

const { t } = useI18n()
const { notifications, fetchNotifications, markAllRead, markRead, deleteNotification } = useNotifications()

onShow(() => { fetchNotifications() })

function goBack() { uni.navigateBack() }

function onTap(n: Notification) {
  if (!n.is_read) markRead(n.id)
  if (n.item_id) {
    uni.navigateTo({ url: `/pages/detail/index?id=${n.item_id}` })
  }
}

function onMarkAll() { markAllRead() }

function onLongPress(id: string) {
  uni.showActionSheet({
    itemList: [t('notif.delete')],
    success: (res) => {
      if (res.tapIndex === 0) deleteNotification(id)
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
.header-title { font-size: 17px; font-weight: 600; color: #1a1a1a; flex: 1; }
.mark-all { font-size: 13px; color: #007AFF; cursor: pointer; }

.empty {
  display: flex; flex-direction: column; align-items: center; padding-top: 120px; gap: 12px;
}
.empty-icon { font-size: 40px; }
.empty-text { font-size: 14px; color: #aeaeb2; }

.notif-item {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 14px 16px; background: #fff;
  border-bottom: 0.5px solid rgba(0,0,0,0.06);
  cursor: pointer; transition: background 0.1s;
  &:active { background: #f7f7f8; }
  &.unread { background: #F0F7FF; }
}
.notif-icon { font-size: 22px; flex-shrink: 0; margin-top: 2px; }
.notif-content { flex: 1; min-width: 0; }
.notif-title { font-size: 14px; font-weight: 600; color: #1a1a1a; display: block; }
.notif-body {
  font-size: 13px; color: #636366; margin-top: 3px; display: block;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.notif-time { font-size: 11px; color: #aeaeb2; margin-top: 4px; display: block; }
.notif-dot {
  width: 8px; height: 8px; border-radius: 50%; background: #007AFF;
  flex-shrink: 0; margin-top: 6px;
}
</style>
