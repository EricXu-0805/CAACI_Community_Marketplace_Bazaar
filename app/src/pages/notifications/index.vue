<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack"><view class="back-arrow"></view></view>
      <text class="header-title">{{ t('notif.title') }}</text>
      <text v-if="notifications.length > 0" class="mark-all" @click="onMarkAll">{{ t('notif.markAll') }}</text>
    </view>

    <view v-if="notifications.length === 0" class="empty">
      <view class="empty-bell"></view>
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
        <view :class="['notif-icon', 'ni-' + n.type]">
          <text>{{ n.type === 'price_drop' ? '↓' : n.type === 'sold' ? '✓' : n.type === 'offer' ? '$' : n.type === 'meetup' ? '📍' : '!' }}</text>
        </view>
        <view class="notif-content">
          <text class="notif-type">{{ n.type === 'price_drop' ? t('notif.priceDrop') : n.type === 'sold' ? t('notif.itemSold') : n.type === 'offer' ? t('notif.offer') : n.type === 'meetup' ? t('notif.meetup') : t('notif.system') }}</text>
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
import { formatTime, friendlyErrorMessage } from '../../utils'

const { t, lang } = useI18n()
const { notifications, fetchNotifications, markAllRead, markRead, deleteNotification } = useNotifications()

onShow(async () => {
  try {
    await fetchNotifications()
  } catch (err: any) {
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none', duration: 2500 })
  }
  /*
   * uni-app preserves uni-page-body scroll position between navigations,
   * so re-entering this page would drop the user halfway down the list.
   * Force the document back to top so the latest notifications are visible.
   */
  // #ifdef H5
  try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }) } catch {}
  // #endif
  try { uni.pageScrollTo({ scrollTop: 0, duration: 0 }) } catch {}
})

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
.page { min-height: 100vh; background: var(--bg-subtle); max-width: 480px; margin: 0 auto; }

.header {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  padding-top: calc(12px + var(--status-bar-height, env(safe-area-inset-top, 0px)));
  background: var(--bg-elev-1); border-bottom: 0.5px solid var(--line-hair);
}
.back-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.back-arrow { width: 9px; height: 9px; border-left: 2px solid var(--accent-primary); border-bottom: 2px solid var(--accent-primary); transform: rotate(45deg); margin-left: 4px; }
.header-title { font-size: 17px; font-weight: 600; color: var(--text-primary); flex: 1; }
.mark-all { font-size: 13px; color: var(--brand); cursor: pointer; }

.empty {
  display: flex; flex-direction: column; align-items: center; padding-top: 120px; gap: 12px;
}
.empty-bell {
  width: 44px; height: 44px; border: 2.5px solid var(--border-strong); border-radius: 50%;
  position: relative;
  &::before {
    content: ''; position: absolute; top: 9px; left: 50%; transform: translateX(-50%);
    width: 18px; height: 13px; border: 2px solid var(--border-strong);
    border-radius: 10px 10px 0 0; border-bottom: none;
  }
  &::after {
    content: ''; position: absolute; bottom: 7px; left: 50%; transform: translateX(-50%);
    width: 6px; height: 3px; border-radius: 0 0 3px 3px; background: var(--border-strong);
  }
}
.empty-text { font-size: 14px; color: var(--text-faint); }

/*
 * Notification icon tints — refitted from Material Design
 * primaries (orange/green/purple) onto the UIUC Fusion palette
 * so colors read "warm + scholarly" instead of Android app.
 *   · price_drop → brand-soft (Illini orange wash) + brand-deep
 *   · sold       → success-soft (sage wash) + success
 *   · system     → campus-blue-soft (UIUC navy wash) + campus-blue
 * Unread row + unread dot also shift to the palette.
 */
.notif-item {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 14px 16px; background: var(--bg-elev-1);
  border-bottom: 0.5px solid var(--line-hair);
  cursor: pointer; transition: background 0.1s;
  &:active { background: var(--bg-elev-2); }
  &.unread { background: var(--campus-blue-soft); }
}
.notif-icon {
  width: 32px; height: 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; font-size: 14px; font-weight: 700;
}
.ni-price_drop { background: var(--brand-soft);     color: var(--brand-deep); }
.ni-sold       { background: var(--success-soft);   color: var(--success); }
.ni-system     { background: var(--campus-blue-soft); color: var(--campus-blue); }
.ni-offer      { background: var(--warning-soft);   color: var(--warning); }
.ni-meetup     { background: var(--campus-blue-soft); color: var(--campus-blue); }
.notif-content { flex: 1; min-width: 0; }
.notif-type {
  font-size: 11px; font-weight: 600; color: var(--text-muted); display: block;
  text-transform: uppercase; letter-spacing: 0.3px;
}
.notif-title { font-size: 14px; font-weight: 600; color: var(--text-primary); display: block; margin-top: 2px; }
.notif-body {
  font-size: 13px; color: var(--text-secondary); margin-top: 3px; display: block;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.notif-time { font-size: 11px; color: var(--text-faint); margin-top: 4px; display: block; }
.notif-dot {
  width: 8px; height: 8px; border-radius: 50%; background: var(--brand);
  flex-shrink: 0; margin-top: 6px;
}
</style>
