<template>
  <view class="page">
    <DesktopNav current="messages" />

    <view class="page-header">
      <text class="page-title">{{ t('nav.messages') }}</text>
    </view>

    <view v-if="!isLoggedIn" class="login-prompt">
      <view class="prompt-icon">
        <view class="pi-bubble"></view>
      </view>
      <text class="prompt-text">{{ t('msg.signIn') }}</text>
      <view class="login-btn" @click="goLogin">{{ t('profile.signIn') }}</view>
    </view>

    <view v-else-if="conversations.length === 0 && !loading" class="empty">
      <view class="empty-icon">
        <view class="ei-bubble"></view>
      </view>
      <text class="empty-title">{{ t('msg.empty') }}</text>
      <text class="empty-sub">{{ t('msg.emptySub') }}</text>
    </view>

    <view v-else class="conv-list">
      <view
        v-for="conv in conversations"
        :key="conv.id"
        class="conv-row"
        @touchstart="onTouchStart($event, conv.id)"
        @touchmove="onTouchMove($event, conv.id)"
        @touchend="onTouchEnd(conv.id)"
      >
        <view
          class="conv-item"
          :style="{ transform: `translateX(${swipeOffsets[conv.id] || 0}px)` }"
          @click="onItemTap(conv)"
          @longpress="onMoreMenu(conv)"
        >
          <image
            :src="getOtherUser(conv)?.avatar_url || '/static/default-avatar.svg'"
            class="conv-avatar"
          />
          <view class="conv-info">
            <view class="conv-top">
              <view class="conv-name-wrap">
                <view v-if="isPinned(conv)" class="pin-badge"></view>
                <text :class="['conv-name', { unread: unreadConvIds.has(conv.id) && !isMuted(conv) }]">{{ getOtherUser(conv)?.nickname || t('app.user') }}</text>
                <view v-if="isMuted(conv)" class="mute-badge"></view>
              </view>
              <text class="conv-time">{{ formatTime(conv.last_message_at) }}</text>
            </view>
            <text :class="['conv-preview', { unread: unreadConvIds.has(conv.id) && !isMuted(conv) }]">
              {{ (conv as any).last_message_type === 'image' ? '[' + t('chat.photo') + ']' : ((conv as any).last_message_preview || conv.item?.title || '') }}
            </text>
          </view>
          <view v-if="unreadConvIds.has(conv.id) && !isMuted(conv)" class="unread-dot"></view>
          <view v-else-if="unreadConvIds.has(conv.id) && isMuted(conv)" class="muted-dot"></view>
          <view class="conv-thumb-wrap" v-if="conv.item?.images?.[0]">
            <image :src="conv.item.images[0]" class="conv-thumb" mode="aspectFill" />
            <text v-if="conv.item?.status === 'sold'" class="thumb-badge sold">{{ t('status.sold') }}</text>
            <text v-else-if="conv.item?.status === 'reserved'" class="thumb-badge reserved">{{ t('status.reserved') }}</text>
          </view>
        </view>

        <!-- Left swipe actions (revealed from right) -->
        <view class="swipe-actions right">
          <view class="swipe-act act-read" @click="toggleRead(conv)">
            <text>{{ unreadConvIds.has(conv.id) ? t('msg.markRead') : t('msg.markUnread') }}</text>
          </view>
          <view class="swipe-act act-delete" @click="onDelete(conv)">
            <text>{{ t('profile.delete') }}</text>
          </view>
        </view>
        <!-- Right swipe actions (revealed from left) -->
        <view class="swipe-actions left">
          <view class="swipe-act act-pin" @click="togglePin(conv)">
            <text>{{ isPinned(conv) ? t('msg.unpin') : t('msg.pin') }}</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="loading" class="loading-tip">
      <view class="loading-dot"></view>
      <text>{{ t('msg.loading') }}</text>
    </view>
    <CustomTabBar current="messages" />
  </view>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import { useMessages } from '../../composables/useMessages'
import { useUnread } from '../../composables/useUnread'
import { formatTime } from '../../utils'
import type { Conversation, Profile } from '../../types'
import DesktopNav from '../../components/DesktopNav.vue'
import CustomTabBar from '../../components/CustomTabBar.vue'

const { t } = useI18n()

const { currentUser, isLoggedIn } = useAuth()
const {
  conversations,
  loading,
  fetchConversations,
  deleteConversation,
  setConversationPinned,
  setConversationMuted,
  markAsRead,
  markConversationUnread,
} = useMessages()
const { unreadConvIds, refreshUnreadCount } = useUnread()

const swipeOffsets = reactive<Record<string, number>>({})
const touchState = reactive({ startX: 0, startY: 0, id: '' as string, locked: false, dir: '' as 'x' | 'y' | '' })

onShow(() => {
  if (currentUser.value) {
    fetchConversations(currentUser.value.id)
    refreshUnreadCount()
  }
})

onPullDownRefresh(async () => {
  if (currentUser.value) {
    await fetchConversations(currentUser.value.id)
    await refreshUnreadCount()
  }
  uni.stopPullDownRefresh()
})

function getOtherUser(conv: Conversation): Profile | undefined {
  if (!currentUser.value) return undefined
  return conv.buyer_id === currentUser.value.id ? conv.seller : conv.buyer
}

function isPinned(conv: Conversation): boolean {
  if (!currentUser.value) return false
  return conv.buyer_id === currentUser.value.id ? !!conv.is_pinned_buyer : !!conv.is_pinned_seller
}

function isMuted(conv: Conversation): boolean {
  if (!currentUser.value) return false
  return conv.buyer_id === currentUser.value.id ? !!conv.is_muted_buyer : !!conv.is_muted_seller
}

function goChat(conversationId: string) {
  uni.navigateTo({ url: `/pages/chat/index?id=${conversationId}` })
}

function onItemTap(conv: Conversation) {
  const offset = swipeOffsets[conv.id] || 0
  if (Math.abs(offset) > 5) {
    closeSwipe(conv.id)
    return
  }
  goChat(conv.id)
}

function closeSwipe(id: string) {
  swipeOffsets[id] = 0
}

function closeAllSwipes(except?: string) {
  for (const id of Object.keys(swipeOffsets)) {
    if (id !== except) swipeOffsets[id] = 0
  }
}

function onTouchStart(e: any, id: string) {
  const touch = e.touches?.[0] || e.changedTouches?.[0]
  if (!touch) return
  touchState.startX = touch.clientX
  touchState.startY = touch.clientY
  touchState.id = id
  touchState.locked = false
  touchState.dir = ''
  closeAllSwipes(id)
}

function onTouchMove(e: any, id: string) {
  if (touchState.id !== id) return
  const touch = e.touches?.[0] || e.changedTouches?.[0]
  if (!touch) return
  const dx = touch.clientX - touchState.startX
  const dy = touch.clientY - touchState.startY

  if (!touchState.locked) {
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      touchState.dir = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      touchState.locked = true
    }
  }

  if (touchState.dir === 'x') {
    const clamped = Math.max(-160, Math.min(80, dx))
    swipeOffsets[id] = clamped
  }
}

function onTouchEnd(id: string) {
  if (touchState.id !== id) return
  const offset = swipeOffsets[id] || 0
  if (offset < -60) {
    swipeOffsets[id] = -140
  } else if (offset > 40) {
    swipeOffsets[id] = 70
  } else {
    swipeOffsets[id] = 0
  }
  touchState.id = ''
}

async function togglePin(conv: Conversation) {
  if (!currentUser.value) return
  closeSwipe(conv.id)
  try {
    await setConversationPinned(conv, currentUser.value.id, !isPinned(conv))
    await fetchConversations(currentUser.value.id)
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('msg.actionFailed'), icon: 'none' })
  }
}

async function toggleMute(conv: Conversation) {
  if (!currentUser.value) return
  try {
    await setConversationMuted(conv, currentUser.value.id, !isMuted(conv))
    await refreshUnreadCount()
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('msg.actionFailed'), icon: 'none' })
  }
}

async function toggleRead(conv: Conversation) {
  if (!currentUser.value) return
  closeSwipe(conv.id)
  try {
    if (unreadConvIds.value.has(conv.id)) {
      await markAsRead(conv.id, currentUser.value.id)
    } else {
      await markConversationUnread(conv.id, currentUser.value.id)
    }
    await refreshUnreadCount()
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('msg.actionFailed'), icon: 'none' })
  }
}

function onDelete(conv: Conversation) {
  closeSwipe(conv.id)
  uni.showModal({
    title: t('msg.deleteTitle'),
    content: t('msg.deleteHint'),
    confirmColor: '#FF3B30',
    success: async (r) => {
      if (!r.confirm) return
      try {
        await deleteConversation(conv.id)
        uni.showToast({ title: t('msg.deleted'), icon: 'success' })
      } catch (err: any) {
        uni.showToast({
          title: err?.message || t('msg.deleteFailed'),
          icon: 'none',
          duration: 2500,
        })
      }
    },
  })
}

function onMoreMenu(conv: Conversation) {
  const items = [
    isPinned(conv) ? t('msg.unpin') : t('msg.pin'),
    isMuted(conv) ? t('msg.unmute') : t('msg.mute'),
    unreadConvIds.value.has(conv.id) ? t('msg.markRead') : t('msg.markUnread'),
    t('msg.deleteConv'),
  ]
  uni.showActionSheet({
    itemList: items,
    success: (res) => {
      if (res.tapIndex === 0) togglePin(conv)
      else if (res.tapIndex === 1) toggleMute(conv)
      else if (res.tapIndex === 2) toggleRead(conv)
      else if (res.tapIndex === 3) onDelete(conv)
    },
  })
}

function goLogin() {
  uni.navigateTo({ url: '/pages/login/index' })
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh; background: #fff;
  max-width: 480px; margin: 0 auto; padding-bottom: 70px;
}

.page-header {
  padding: 11px 16px;
  padding-top: calc(11px + env(safe-area-inset-top, 0px));
  background: rgba(255,255,255,0.92);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  position: sticky; top: 0; z-index: 50;
}
.page-title {
  font-size: 17px; font-weight: 700; color: #1a1a1a;
}

.login-prompt, .empty {
  display: flex; flex-direction: column; align-items: center;
  padding-top: 120px; gap: 10px;
}

.prompt-icon, .empty-icon {
  width: 52px; height: 52px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 4px;
}
.pi-bubble, .ei-bubble {
  width: 36px; height: 28px; border: 2.5px solid #d1d1d6;
  border-radius: 16px 16px 16px 4px; position: relative;
  &::before {
    content: ''; position: absolute; top: 8px; left: 7px;
    width: 4px; height: 4px; border-radius: 50%; background: #d1d1d6;
  }
  &::after {
    content: ''; position: absolute; top: 8px; left: 15px;
    width: 4px; height: 4px; border-radius: 50%; background: #d1d1d6;
  }
}
.prompt-text { font-size: 14px; color: #aeaeb2; }
.empty-title { font-size: 16px; color: #1a1a1a; font-weight: 600; }
.empty-sub { font-size: 13px; color: #aeaeb2; }
.login-btn {
  margin-top: 12px; padding: 10px 36px;
  background: #1a1a1a; color: #fff; border-radius: 22px;
  font-size: 14px; font-weight: 600; cursor: pointer;
  &:active { opacity: 0.8; }
}

.conv-row {
  position: relative; overflow: hidden;
  border-bottom: 0.5px solid rgba(0,0,0,0.06);
}

.conv-item {
  display: flex; align-items: center; padding: 13px 16px;
  gap: 12px; cursor: pointer;
  background: #fff;
  transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
  position: relative; z-index: 2;
  &:active { background: #f7f7f8; }
}
.conv-avatar {
  width: 48px; height: 48px; border-radius: 50%;
  background: #f2f2f7; flex-shrink: 0;
}
.conv-info { flex: 1; min-width: 0; }
.conv-top { display: flex; justify-content: space-between; align-items: center; }
.conv-name-wrap { display: flex; align-items: center; gap: 6px; min-width: 0; }
.conv-name {
  font-size: 15px; font-weight: 600; color: #1a1a1a;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  &.unread { font-weight: 700; }
}
.pin-badge {
  width: 10px; height: 10px; position: relative; flex-shrink: 0;
  &::before {
    content: ''; position: absolute; top: 0; left: 3px;
    width: 4px; height: 6px; background: #FF9500; border-radius: 1px;
  }
  &::after {
    content: ''; position: absolute; bottom: 0; left: 0;
    width: 10px; height: 2px; background: #FF9500; border-radius: 1px;
  }
}
.mute-badge {
  width: 13px; height: 11px; position: relative; flex-shrink: 0;
  &::before {
    content: ''; position: absolute; top: 1px; left: 0;
    width: 9px; height: 9px;
    border: 1.5px solid #aeaeb2;
    border-radius: 50% 50% 0 0 / 60% 60% 0 0;
  }
  &::after {
    content: ''; position: absolute; top: 0; right: 0;
    width: 11px; height: 1.5px; background: #aeaeb2;
    transform: rotate(-35deg); transform-origin: center;
  }
}
.unread-dot {
  width: 9px; height: 9px; border-radius: 50%; background: #007AFF;
  flex-shrink: 0; margin-left: 4px;
}
.muted-dot {
  width: 7px; height: 7px; border-radius: 50%; background: #c7c7cc;
  flex-shrink: 0; margin-left: 4px;
}
.conv-time { font-size: 12px; color: #c7c7cc; flex-shrink: 0; margin-left: 6px; }
.conv-preview {
  font-size: 13px; color: #aeaeb2; margin-top: 4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;
  &.unread { color: #1a1a1a; font-weight: 600; }
}
.conv-thumb-wrap { position: relative; flex-shrink: 0; }
.conv-thumb {
  width: 42px; height: 42px; border-radius: 7px;
  background: #f2f2f7;
}
.thumb-badge {
  position: absolute; bottom: -2px; right: -2px;
  font-size: 8px; font-weight: 700; padding: 1px 4px;
  border-radius: 3px; color: #fff;
  &.sold { background: #FF3B30; }
  &.reserved { background: #FF9500; }
}

.swipe-actions {
  position: absolute; top: 0; bottom: 0;
  display: flex; z-index: 1;
}
.swipe-actions.right { right: 0; }
.swipe-actions.left { left: 0; }
.swipe-act {
  display: flex; align-items: center; justify-content: center;
  width: 70px; padding: 0 10px; cursor: pointer;
  text { font-size: 13px; color: #fff; font-weight: 600; text-align: center; }
}
.act-read { background: #007AFF; }
.act-delete { background: #FF3B30; }
.act-pin { background: #FF9500; }

.loading-tip {
  display: flex; align-items: center; justify-content: center;
  padding: 32px; gap: 8px; color: #c7c7cc; font-size: 13px;
}
.loading-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #c7c7cc; animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }

@media (min-width: 768px) {
  .page-header { display: none; }
  .page { padding-bottom: 0; }
  .conv-item {
    border-radius: 8px; margin: 2px 8px;
    &:hover { background: #f7f7f8; }
  }
}
</style>
