<template>
  <view class="page" :class="mpThemeClass" :style="mpChrome">
    <!-- #ifndef H5 -->
    <AppToast />
    <!-- #endif -->
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack"><UIcon name="chevron-left" size="xs" color="accent-primary" /></view>
      <text class="header-title">{{ t('notif.title') }}</text>
      <text
        v-if="notifications.length > 0"
        :class="['mark-all', { disabled: markingAll }]"
        role="button"
        :aria-label="t('notif.markAll')"
        :aria-disabled="markingAll ? 'true' : 'false'"
        @click="onMarkAll"
      >{{ t('notif.markAll') }}</text>
    </view>

    <view v-if="loading && notifications.length === 0" class="notif-list">
      <view v-for="n in 6" :key="'ns' + n" class="notif-skel">
        <view class="ns-icon u-sk"></view>
        <view class="ns-info">
          <view class="ns-line u-sk" style="width: 30%"></view>
          <view class="ns-line u-sk" style="width: 64%"></view>
          <view class="ns-line u-sk" style="width: 84%"></view>
        </view>
      </view>
    </view>

    <view v-else-if="loadError && notifications.length === 0" class="empty" role="alert" aria-live="assertive" aria-atomic="true">
      <UIcon name="bell" size="xl" color="text-faint" />
      <text class="empty-text">{{ t('error.loadFailed') }}</text>
      <view class="retry-btn" role="button" :aria-label="t('home.retry')" @click="loadCurrentNotifications">{{ t('home.retry') }}</view>
    </view>

    <view v-else-if="notifications.length === 0" class="empty">
      <UIcon name="bell" size="xl" color="text-faint" />
      <text class="empty-text">{{ t('notif.empty') }}</text>
    </view>

    <view v-else class="notif-list u-stagger">
      <view
        v-for="n in notifications"
        :key="n.id"
        :class="['notif-item', { unread: !n.is_read }]"
        role="button"
        :aria-label="notificationAriaLabel(n)"
        aria-keyshortcuts="Shift+F10 Delete"
        @click="onTap(n)"
        @keydown="onNotificationKeydown($event, n.id)"
        @longpress="onLongPress(n.id)"
      >
        <view :class="['notif-icon', 'ni-' + n.type]">
          <UIcon :name="notificationIcon(n.type)" size="xs" color="currentColor" />
        </view>
        <view class="notif-content">
          <text class="notif-type">{{ t(notificationTypeLabelKey(n.type)) }}</text>
          <text class="notif-title">{{ n.title }}</text>
          <text class="notif-body">{{ notificationBodyText(n, t) }}</text>
          <text class="notif-time">{{ formatTime(n.created_at) }}</text>
        </view>
        <view v-if="!n.is_read" class="notif-dot"></view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
// #ifndef H5
import AppToast from '../../components/AppToast.vue'
// #endif
import { ref, onUnmounted } from 'vue'
import { onShow, onHide } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import {
  notificationBodyText,
  notificationDestination,
  notificationIcon,
  notificationTypeLabelKey,
  useNotifications,
  type Notification,
} from '../../composables/useNotifications'
import { formatTime, friendlyErrorMessage, navigateBackOr } from '../../utils'
import {
  captureActiveAccountRequest,
  isAccountRequestCurrent,
  onAccountTransition,
} from '../../composables/accountScope'
import UIcon from '../../components/UIcon.vue'

const { t, lang } = useI18n()
const { awaitAuthReady, requireAuth } = useAuth()
const { notifications, fetchNotifications, markAllRead, markRead, deleteNotification } = useNotifications()
const loading = ref(true)
const loadError = ref(false)
const markingAll = ref(false)
let pageVisible = false
let pageLoadEpoch = 0
let markAllEpoch = 0

async function loadCurrentNotifications() {
  const requestEpoch = ++pageLoadEpoch
  loadError.value = false
  loading.value = true
  try {
    const state = await awaitAuthReady()
    if (!pageVisible || requestEpoch !== pageLoadEpoch) return
    if (state === 'anonymous') {
      requireAuth()
      return
    }
    await fetchNotifications()
  } catch (err: any) {
    if (!pageVisible || requestEpoch !== pageLoadEpoch) return
    loadError.value = true
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none', duration: 2500 })
  } finally {
    if (pageVisible && requestEpoch === pageLoadEpoch) loading.value = false
  }
  if (!pageVisible || requestEpoch !== pageLoadEpoch) return
  /*
   * uni-app preserves uni-page-body scroll position between navigations,
   * so re-entering this page would drop the user halfway down the list.
   * Force the document back to top so the latest notifications are visible.
   */
  // #ifdef H5
  try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }) } catch {}
  // #endif
  try { uni.pageScrollTo({ scrollTop: 0, duration: 0 }) } catch {}
}

onShow(() => {
  pageVisible = true
  void loadCurrentNotifications()
})

onHide(() => {
  pageVisible = false
  pageLoadEpoch += 1
  markAllEpoch += 1
  loading.value = false
  loadError.value = false
  markingAll.value = false
})

const stopAccountTransitionListener = onAccountTransition(() => {
  pageLoadEpoch += 1
  markAllEpoch += 1
  loading.value = false
  loadError.value = false
  markingAll.value = false
  if (pageVisible) void Promise.resolve().then(loadCurrentNotifications)
})
onUnmounted(() => {
  pageVisible = false
  pageLoadEpoch += 1
  markAllEpoch += 1
  loading.value = false
  loadError.value = false
  markingAll.value = false
  stopAccountTransitionListener()
})

function goBack() { navigateBackOr(() => uni.switchTab({ url: '/pages/profile/index' })) }

function notificationAriaLabel(n: Notification): string {
  return [
    t(notificationTypeLabelKey(n.type)),
    n.title,
    notificationBodyText(n, t),
  ].filter(Boolean).join('. ')
}

function onNotificationKeydown(event: KeyboardEvent, id: string) {
  if (event.key !== 'Delete' && event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
  event.preventDefault()
  event.stopPropagation()
  onLongPress(id)
}

function onTap(n: Notification) {
  if (!n.is_read) markRead(n.id).catch(() => {})
  const destination = notificationDestination(n)
  if (destination.url === '/pages/notifications/index') return
  if (destination.switchTab) uni.switchTab({ url: destination.url })
  else uni.navigateTo({ url: destination.url })
}

async function onMarkAll() {
  if (markingAll.value) return
  const accountToken = captureActiveAccountRequest()
  if (!accountToken || !isAccountRequestCurrent(accountToken)) return
  const operationEpoch = ++markAllEpoch
  markingAll.value = true
  try {
    await markAllRead()
  } catch (err: any) {
    if (operationEpoch !== markAllEpoch || !isAccountRequestCurrent(accountToken)) return
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none' })
  } finally {
    if (operationEpoch === markAllEpoch && isAccountRequestCurrent(accountToken)) markingAll.value = false
  }
}

function onLongPress(id: string) {
  const accountToken = captureActiveAccountRequest()
  if (!accountToken || !isAccountRequestCurrent(accountToken)) return
  const actionEpoch = pageLoadEpoch
  uni.showActionSheet({
    itemList: [t('notif.delete')],
    success: (res) => {
      if (
        res.tapIndex === 0
        && pageVisible
        && actionEpoch === pageLoadEpoch
        && isAccountRequestCurrent(accountToken)
      ) {
        deleteNotification(id).catch((err: any) => {
          if (!pageVisible || actionEpoch !== pageLoadEpoch || !isAccountRequestCurrent(accountToken)) return
          uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none' })
        })
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
.header-title { font-size: 17px; font-weight: 600; color: var(--text-primary); flex: 1; }
.mark-all { font-size: 13px; color: var(--brand); cursor: pointer; }

.empty {
  display: flex; flex-direction: column; align-items: center; padding-top: 120px; gap: 12px;
}
.empty-text { font-size: 14px; color: var(--text-subtle); }
.retry-btn {
  min-height: 44px; padding: 0 20px; border-radius: var(--radius-pill);
  display: flex; align-items: center; justify-content: center;
  background: var(--accent-primary); color: #fff; font-size: 14px; font-weight: 600;
}

/*
 * Notification icon tints — refitted from Material Design
 * primaries (orange/green/purple) onto the UIUC Fusion palette
 * so colors read "warm + scholarly" instead of Android app.
 *   · price_drop → brand-soft (Illini orange wash) + brand-deep
 *   · sold       → success-soft (sage wash) + success
 *   · system     → campus-blue-soft (UIUC navy wash) + campus-blue
 * Unread row + unread dot also shift to the palette.
 */
.notif-skel {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 14px 16px; background: var(--bg-elev-1);
  border-bottom: 0.5px solid var(--line-hair);
}
.ns-icon { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; }
.ns-info { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.ns-line { height: 11px; }

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
.ni-offer      { background: var(--warning-soft);   color: var(--warning-text); }
.ni-meetup     { background: var(--campus-blue-soft); color: var(--campus-blue); }
.ni-unread_message { background: var(--campus-blue-soft); color: var(--campus-blue); }
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
.notif-time { font-size: 11px; color: var(--text-subtle); margin-top: 4px; display: block; }
.notif-dot {
  width: 8px; height: 8px; border-radius: 50%; background: var(--brand);
  flex-shrink: 0; margin-top: 6px;
}
</style>
