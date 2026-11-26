<template>
  <view class="page secondary-page secondary-page--notifications has-sidebar" :class="mpThemeClass" :style="mpChrome">
    <!-- #ifdef H5 -->
    <AppSidebar current="profile" />
    <!-- #endif -->
    <view class="secondary-content">
    <!-- #ifndef H5 -->
    <AppToast />
    <!-- #endif -->
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack"><UIcon name="chevron-left" size="xs" color="accent-primary" /></view>
      <text class="header-title" role="heading" aria-level="1">{{ t('notif.title') }}</text>
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
      <!-- SPEC 6.8: one line per notice, except replies in a watched topic, which are one line per topic. -->
      <view
        v-for="line in lines"
        :key="line.head.id"
        :class="['notif-item', { unread: !line.head.is_read }]"
        role="button"
        :aria-label="notificationAriaLabel(line)"
        aria-keyshortcuts="Shift+F10 Delete"
        @click="onTap(line)"
        @keydown="onNotificationKeydown($event, line)"
        @longpress="onLongPress(line)"
      >
        <view :class="['notif-icon', 'ni-' + line.head.type]">
          <UIcon :name="notificationIcon(line.head.type)" size="xs" color="currentColor" />
        </view>
        <view class="notif-content">
          <text class="notif-type">{{ t(notificationTypeLabelKey(line.head.type)) }}</text>
          <text class="notif-title">{{ notificationTitleText(line.head, t) }}</text>
          <text class="notif-body">{{ lineBody(line) }}</text>
          <text class="notif-time">{{ formatTime(line.head.created_at) }}</text>
        </view>
        <view v-if="!line.head.is_read" class="notif-dot"></view>
      </view>
    </view>
    </view>
  </view>
</template>

<script setup lang="ts">
// #ifdef H5
import AppSidebar from '../../components/AppSidebar.vue'
// #endif
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
// #ifndef H5
import AppToast from '../../components/AppToast.vue'
// #endif
import { ref, shallowRef, computed, watch, onUnmounted } from 'vue'
import { onShow, onHide } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import {
  notificationBodyText,
  notificationIcon,
  notificationTitleText,
  notificationTypeLabelKey,
  useNotifications,
} from '../../composables/useNotifications'
import { notificationBodyKey } from '../../api/notifications'
import {
  loadReplyNoticeContext,
  noticeTargetGone,
  notificationLineDestination,
  notificationLines,
  replyNoticeKey,
  type NotificationLine,
  type ReplyNoticeContext,
} from '../../composables/replyNotices'
import { formatTime, friendlyErrorMessage, navigateBackOr } from '../../utils'
import {
  captureActiveAccountRequest,
  isAccountRequestCurrent,
  onAccountTransition,
} from '../../composables/accountScope'
import UIcon from '../../components/UIcon.vue'

const { t, tc, lang } = useI18n()
const { awaitAuthReady, requireAuth } = useAuth()
const { notifications, fetchNotifications, markAllRead, markRead, deleteNotification } = useNotifications()
const loading = ref(true)
const loadError = ref(false)
const markingAll = ref(false)
let pageVisible = false
let pageLoadEpoch = 0
let markAllEpoch = 0

// P3.3 (SPEC 6.8): replies in a watched topic are one line per topic.
const lines = computed(() => notificationLines(notifications.value))
// What a reply notice says beyond its own row: the topic's title and who replied.
// It is looked up again whenever the set of notices changes, a live one included.
const replyContext = shallowRef<ReplyNoticeContext | null>(null)
let replyContextEpoch = 0
watch(() => notifications.value.map(n => n.id).join(), async () => {
  const requestEpoch = ++replyContextEpoch
  const accountToken = captureActiveAccountRequest()
  // A lookup that fails is reported where it is made and answers null. The lines it could not
  // describe keep their plain wording, and each one asks about its own topic when it is tapped.
  const next = await loadReplyNoticeContext(notifications.value)
  if (!next || requestEpoch !== replyContextEpoch || !accountToken || !isAccountRequestCurrent(accountToken)) return
  replyContext.value = next
}, { immediate: true })

function lineBody(line: NotificationLine): string {
  const { key, target } = notificationBodyKey(line.head.body)
  const title = target ? replyContext.value?.titles.get(target) : undefined
  if (title && target && key === 'followed_post_reply') {
    return tc('notif.followedReply', line.rows.length, { n: line.rows.length, title })
  }
  if (title && target && key === 'comment_reply') {
    const name = replyContext.value?.names.get(replyNoticeKey(target, line.head.created_at))
    if (name) return t('notif.commentReply', { name, title })
  }
  return notificationBodyText(line.head, t, tc)
}

async function loadCurrentNotifications() {
  const requestEpoch = ++pageLoadEpoch
  loadError.value = false
  loading.value = true
  try {
    const state = await awaitAuthReady()
    if (!pageVisible || requestEpoch !== pageLoadEpoch) return
    if (state !== 'authenticated') {
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
  // Titles and names looked up for one account say nothing about the next one.
  replyContextEpoch += 1
  replyContext.value = null
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

function notificationAriaLabel(line: NotificationLine): string {
  // aria-label wins over content, so anything left out here is unreachable —
  // which is what happened to the unread state (a text-free .notif-dot) and
  // the timestamp.
  const n = line.head
  return [
    n.is_read ? '' : t('a11y.unread'),
    t(notificationTypeLabelKey(n.type)),
    notificationTitleText(n, t),
    lineBody(line),
    formatTime(n.created_at),
  ].filter(Boolean).join('. ')
}

function onNotificationKeydown(event: KeyboardEvent, line: NotificationLine) {
  if (event.key !== 'Delete' && event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
  event.preventDefault()
  event.stopPropagation()
  onLongPress(line)
}

let openingLine = false
async function onTap(line: NotificationLine) {
  if (openingLine) return
  // Decided before anything is marked read: an unread line opens at its earliest reply.
  const destination = notificationLineDestination(line)
  const accountToken = captureActiveAccountRequest()
  const tapEpoch = pageLoadEpoch
  for (const row of line.rows) {
    if (!row.is_read) markRead(row.id).catch(() => {})
  }
  // SPEC 6.8: the line stays, but a topic that was hidden or deleted is not opened. When the list
  // has no answer for this topic it is asked now; if that fails too the topic's page says what it is.
  openingLine = true
  let gone: boolean | null
  try {
    gone = await noticeTargetGone(line, replyContext.value)
  } finally {
    openingLine = false
  }
  if (!pageVisible || tapEpoch !== pageLoadEpoch || !accountToken || !isAccountRequestCurrent(accountToken)) return
  if (gone) {
    uni.showToast({ title: t('notif.targetGone'), icon: 'none' })
    return
  }
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

function onLongPress(line: NotificationLine) {
  const accountToken = captureActiveAccountRequest()
  if (!accountToken || !isAccountRequestCurrent(accountToken)) return
  const actionEpoch = pageLoadEpoch
  // Deleting a merged line deletes every notice it stands for.
  const ids = line.rows.map(row => row.id)
  uni.showActionSheet({
    itemList: [t('notif.delete')],
    success: (res) => {
      if (
        res.tapIndex === 0
        && pageVisible
        && actionEpoch === pageLoadEpoch
        && isAccountRequestCurrent(accountToken)
      ) {
        Promise.all(ids.map(id => deleteNotification(id))).catch((err: any) => {
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
  background: var(--accent-primary); color: var(--ink-inverse); font-size: 14px; font-weight: 600;
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
.ni-price_drop { background: var(--brand-soft);     color: var(--brand-on-soft); }
.ni-sold       { background: var(--success-soft);   color: var(--success); }
.ni-system     { background: var(--campus-blue-soft); color: var(--campus-blue-on-soft); }
.ni-offer      { background: var(--warning-soft);   color: var(--warning-text); }
.ni-meetup     { background: var(--campus-blue-soft); color: var(--campus-blue-on-soft); }
.ni-unread_message { background: var(--campus-blue-soft); color: var(--campus-blue-on-soft); }
.ni-rating     { background: var(--success-soft);   color: var(--success); }
.ni-follow     { background: var(--campus-blue-soft); color: var(--campus-blue-on-soft); }
.ni-post_comment { background: var(--campus-blue-soft); color: var(--campus-blue-on-soft); }
.ni-post_like  { background: var(--brand-soft);     color: var(--brand-on-soft); }
.notif-content { flex: 1; min-width: 0; }
.notif-type {
  /* --text-muted lands at 4.04:1 on the tinted unread row in dark. */
  font-size: 11px; font-weight: 600; color: var(--text-secondary); display: block;
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
