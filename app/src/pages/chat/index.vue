<template>
  <view class="page page-lock">
    <!-- Header with item context -->
    <view class="chat-header">
      <view class="ch-back" @click="goBack">
        <view class="ch-arrow"></view>
      </view>
      <view class="ch-info" v-if="itemInfo">
        <text class="ch-name">{{ otherUserName }}</text>
        <text class="ch-item-title">{{ itemInfo.title }}</text>
      </view>
      <text v-else class="ch-name-only">{{ otherUserName || t('nav.messages') }}</text>
      <view class="ch-more" @click="onMoreActions">
        <view class="more-dot"></view><view class="more-dot"></view><view class="more-dot"></view>
      </view>
    </view>

    <!-- Item Context Card -->
    <view class="item-card" v-if="itemInfo" @click="goToItem">
      <image
        :src="itemInfo.images?.[0] || '/static/placeholder.svg'"
        class="ic-img"
        mode="aspectFill"
      />
      <view class="ic-info">
        <text class="ic-title">{{ itemInfo.title }}</text>
        <view class="ic-bottom">
          <text class="ic-price">{{ formatPrice(itemInfo.price, t("home.free")) }}</text>
          <text v-if="itemInfo.status === 'sold'" class="ic-sold">{{ t('status.sold') }}</text>
          <text v-else-if="itemInfo.status === 'reserved'" class="ic-reserved">{{ t('status.reserved') }}</text>
        </view>
      </view>
      <view class="ic-arrow"></view>
    </view>

    <view v-if="itemInfo?.category === 'currency_exchange'" class="chat-scam">
      <view class="cs-icon"><view class="cs-excl"></view></view>
      <text class="cs-text">{{ t('scam.chatWarn') }}</text>
    </view>

    <view
      v-if="itemInfo && itemInfo.negotiable && itemInfo.status === 'active' && currentUser?.id !== itemInfo.user_id"
      class="offer-bar"
    >
      <view class="offer-btn" @click="onMakeOffer">
        <text>{{ t('chat.makeOffer') }}</text>
      </view>
    </view>

    <scroll-view
      v-if="messages.length === 0 && itemInfo && itemInfo.status === 'active' && currentUser?.id !== itemInfo.user_id"
      scroll-x
      class="quick-replies"
    >
      <view class="qr-chip" @click="sendQuickReply(t('chat.qrStillAvailable'))">{{ t('chat.qrStillAvailable') }}</view>
      <view class="qr-chip" @click="sendQuickReply(t('chat.qrLowerPrice'))">{{ t('chat.qrLowerPrice') }}</view>
      <view class="qr-chip" @click="sendQuickReply(t('chat.qrWhenMeet'))">{{ t('chat.qrWhenMeet') }}</view>
      <view class="qr-chip" @click="sendQuickReply(t('chat.qrMoreDetails'))">{{ t('chat.qrMoreDetails') }}</view>
    </scroll-view>

    <scroll-view
      class="message-list"
      scroll-y
      :scroll-into-view="scrollTarget"
      scroll-with-animation
    >
      <template v-for="(msg, idx) in messages" :key="msg.id">
        <view v-if="shouldShowTime(idx)" class="time-divider">
          <text>{{ formatChatTime(msg.created_at) }}</text>
        </view>
        <view
          :id="`msg-${msg.id}`"
          :class="['msg-row', { mine: msg.sender_id === currentUser?.id }]"
        >
        <image
          v-if="msg.sender_id !== currentUser?.id"
          :src="msg.sender?.avatar_url || '/static/default-avatar.svg'"
          class="msg-avatar"
        />
        <view class="msg-bubble" v-if="msg.message_type !== 'image'" @longpress="onMsgLongPress(msg)">
          <text>{{ msg.content }}</text>
        </view>
        <image v-else :src="msg.content" class="msg-image" mode="widthFix" @click="previewImg(msg.content)" @longpress="onMsgLongPress(msg)" />
        <image
          v-if="msg.sender_id === currentUser?.id"
          :src="currentUser?.avatar_url || '/static/default-avatar.svg'"
          class="msg-avatar"
        />
      </view>
      <view v-if="msg.sender_id === currentUser?.id && (msg as any)._pending" class="msg-status pending">
        <text>{{ t('chat.sending') }}</text>
      </view>
      <view v-else-if="msg.sender_id === currentUser?.id && (msg as any)._failed" class="msg-status failed" @click="retrySend(msg)">
        <text>{{ t('chat.sendFailed') }}</text>
      </view>
      </template>

      <view v-if="messages.length === 0" class="empty-chat">
        <view class="ec-icon">
          <view class="ec-wave"></view>
        </view>
        <text>{{ t('chat.empty') }}</text>
      </view>
    </scroll-view>

    <view v-if="replyToMsg" class="reply-ctx">
      <view class="rc-bar"></view>
      <view class="rc-body">
        <text class="rc-label">{{ t('chat.replyingTo') }}</text>
        <text class="rc-text">{{ (replyToMsg.message_type === 'image' ? '[' + t('chat.photo') + ']' : replyToMsg.content).slice(0, 80) }}</text>
      </view>
      <view class="rc-x" @click="replyToMsg = null">
        <view class="rc-x-inner"></view>
      </view>
    </view>

    <view class="input-bar">
      <view class="img-btn" @click="onSendImage">
        <view class="img-icon"></view>
      </view>
      <input
        v-model="inputText"
        :placeholder="replyToMsg ? t('chat.replyingHint') : t('chat.placeholder')"
        confirm-type="send"
        @confirm="onSend"
        class="msg-input"
      />
      <view :class="['send-btn', { disabled: !inputText.trim() || sending }]" @click="onSend">
        <view class="send-arrow"></view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onUnmounted, nextTick } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useMessages } from '../../composables/useMessages'
import { useItems } from '../../composables/useItems'
import { useUnread } from '../../composables/useUnread'
import { useI18n } from '../../composables/useI18n'
import { useModeration } from '../../composables/useModeration'
import { compressImage, formatPrice, friendlyErrorMessage } from '../../utils'
import type { Item } from '../../types'

const { t, lang } = useI18n()

const { currentUser, requireAuth } = useAuth()
const { messages, fetchMessages, sendMessage, subscribeToMessages, markAsRead, deleteMessage, fetchConversationDetail, setConversationPinned, setConversationMuted } = useMessages()
const { uploadImages } = useItems()
const { refreshUnreadCount } = useUnread()
const { reportTarget, blockUser } = useModeration()

const inputText = ref('')
const replyToMsg = ref<any>(null)
const scrollTarget = ref('')
const conversationId = ref('')
const itemInfo = ref<Item | null>(null)
const otherUserName = ref('')
const otherUserId = ref('')
const conversationDetail = ref<any>(null)
const convPinned = ref(false)
const convMuted = ref(false)
let unsubscribe: (() => void) | null = null

onLoad(async (options) => {
  if (!requireAuth()) return

  if (options?.id) {
    conversationId.value = options.id
    await fetchMessages(options.id)
    scrollToBottom()

    if (currentUser.value) {
      await markAsRead(options.id, currentUser.value.id)
      refreshUnreadCount()
    }

    if (options.prefill && messages.value.length === 0) {
      try { inputText.value = decodeURIComponent(options.prefill as string) } catch {}
    }

    try {
      const detail = await fetchConversationDetail(options.id)
      if (detail) {
        conversationDetail.value = detail
        if (detail.item) {
          itemInfo.value = detail.item
        }
        if (currentUser.value) {
          const other = detail.buyer_id === currentUser.value.id ? detail.seller : detail.buyer
          otherUserName.value = other?.nickname || t('app.user')
          otherUserId.value = other?.id || ''
          const isBuyer = detail.buyer_id === currentUser.value.id
          convPinned.value = isBuyer ? !!detail.is_pinned_buyer : !!detail.is_pinned_seller
          convMuted.value = isBuyer ? !!detail.is_muted_buyer : !!detail.is_muted_seller
        }
      }
    } catch {
      uni.showToast({ title: t('chat.fail'), icon: 'none' })
    }

    unsubscribe = subscribeToMessages(options.id, (newMsg) => {
      messages.value.push(newMsg)
      nextTick(() => scrollToBottom())
      if (currentUser.value && newMsg.sender_id !== currentUser.value.id) {
        markAsRead(options.id, currentUser.value.id)
        refreshUnreadCount()
      }
    })
  }
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})

function goBack() {
  uni.navigateBack()
}

function goToItem() {
  if (itemInfo.value) {
    uni.navigateTo({ url: `/pages/detail/index?id=${itemInfo.value.id}` })
  }
}

async function sendQuickReply(text: string) {
  if (!currentUser.value || !conversationId.value) return
  try {
    await sendMessage(conversationId.value, currentUser.value.id, text)
    markAsRead(conversationId.value, currentUser.value.id)
    refreshUnreadCount()
    nextTick(() => scrollToBottom())
  } catch {
    uni.showToast({ title: t('chat.fail'), icon: 'none' })
  }
}

const sending = ref(false)

async function onSend() {
  const text = inputText.value.trim()
  if (!text || !currentUser.value || !conversationId.value) return
  if (sending.value) return

  let finalText = text
  if (replyToMsg.value) {
    const quoted = replyToMsg.value.message_type === 'image'
      ? `[${t('chat.photo')}]`
      : (replyToMsg.value.content || '').slice(0, 80)
    finalText = `> ${quoted}\n${text}`
  }

  inputText.value = ''
  const wasReplying = replyToMsg.value
  replyToMsg.value = null
  sending.value = true
  const failsafe = setTimeout(() => { sending.value = false }, 15000)

  try {
    await sendMessage(conversationId.value, currentUser.value.id, finalText)
    markAsRead(conversationId.value, currentUser.value.id)
    refreshUnreadCount()
    nextTick(() => scrollToBottom())
  } catch (error: any) {
    uni.showToast({
      title: friendlyErrorMessage(error, lang.value as 'en' | 'zh'),
      icon: 'none',
      duration: 2500,
    })
    inputText.value = text
    replyToMsg.value = wasReplying
  } finally {
    clearTimeout(failsafe)
    sending.value = false
  }
}

function onMakeOffer() {
  if (!itemInfo.value) return
  const price = itemInfo.value.price
  const suggested = Math.floor(price * 0.85)
  inputText.value = `${t('chat.offerMsg')} $${suggested}`
}

function onMoreActions() {
  uni.showActionSheet({
    itemList: [
      convMuted.value ? t('chat.unmute') : t('chat.mute'),
      convPinned.value ? t('msg.unpin') : t('msg.pin'),
      t('chat.blockUser'),
      t('detail.report'),
    ],
    success: (res) => {
      if (res.tapIndex === 0) toggleMute()
      else if (res.tapIndex === 1) togglePin()
      else if (res.tapIndex === 2) doBlock()
      else if (res.tapIndex === 3) doReport()
    },
  })
}

async function togglePin() {
  if (!conversationDetail.value || !currentUser.value) return
  try {
    await setConversationPinned(conversationDetail.value, currentUser.value.id, !convPinned.value)
    convPinned.value = !convPinned.value
    uni.showToast({ title: convPinned.value ? t('msg.pinned') : t('msg.unpin'), icon: 'success' })
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('msg.actionFailed'), icon: 'none' })
  }
}

async function toggleMute() {
  if (!conversationDetail.value || !currentUser.value) return
  try {
    await setConversationMuted(conversationDetail.value, currentUser.value.id, !convMuted.value)
    convMuted.value = !convMuted.value
    uni.showToast({ title: convMuted.value ? t('msg.muted') : t('chat.unmute'), icon: 'success' })
    refreshUnreadCount()
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('msg.actionFailed'), icon: 'none' })
  }
}

function doBlock() {
  if (!otherUserId.value) return
  uni.showModal({
    title: t('block.confirm'),
    content: t('block.hint'),
    confirmColor: '#FF3B30',
    success: async (r) => {
      if (!r.confirm) return
      try {
        await blockUser(otherUserId.value)
        uni.showToast({ title: t('block.success'), icon: 'success' })
        setTimeout(() => uni.navigateBack(), 800)
      } catch (err: any) {
        uni.showToast({ title: err?.message || t('block.failed'), icon: 'none' })
      }
    },
  })
}

function doReport() {
  if (!otherUserId.value) return
  const reasons = [
    t('report.reasonSpam'),
    t('report.reasonAbuse'),
    t('report.reasonMisleading'),
    t('report.reasonOther'),
  ]
  uni.showActionSheet({
    itemList: reasons,
    success: async (res) => {
      const reason = reasons[res.tapIndex]
      try {
        await reportTarget('user', otherUserId.value, reason)
        uni.showToast({ title: t('report.thanks'), icon: 'success' })
      } catch (err: any) {
        uni.showToast({ title: err?.message || t('report.failed'), icon: 'none' })
      }
    },
  })
}

function shouldShowTime(idx: number): boolean {
  if (idx === 0) return true
  const curr = new Date(messages.value[idx].created_at).getTime()
  const prev = new Date(messages.value[idx - 1].created_at).getTime()
  return curr - prev > 5 * 60 * 1000
}

function formatChatTime(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (msgDay.getTime() === today.getTime()) return time
  if (msgDay.getTime() === yesterday.getTime()) return `${t('chat.yesterday')} ${time}`
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}

function onMsgLongPress(msg: any) {
  const isMine = msg.sender_id === currentUser.value?.id
  const isText = msg.message_type !== 'image'

  const actions: string[] = []
  if (!isMine) actions.push(t('chat.reply'))
  if (isText) actions.push(t('chat.copy'))
  if (isMine) actions.push(t('chat.deleteMsg'))
  if (actions.length === 0) return

  uni.showActionSheet({
    itemList: actions,
    success: (res) => {
      const action = actions[res.tapIndex]
      if (action === t('chat.reply')) {
        replyToMsg.value = msg
        nextTick(() => { /* keyboard opens via input focus naturally */ })
      } else if (action === t('chat.copy')) {
        uni.setClipboardData({ data: msg.content })
        uni.showToast({ title: t('chat.copied'), icon: 'success' })
      } else if (action === t('chat.deleteMsg')) {
        uni.showModal({
          title: t('chat.deleteMsgTitle'),
          content: t('chat.deleteMsgHint'),
          confirmColor: '#FF3B30',
          success: async (r) => {
            if (!r.confirm) return
            try {
              await deleteMessage(msg.id)
              uni.showToast({ title: t('chat.deleted'), icon: 'success' })
            } catch {
              uni.showToast({ title: t('chat.fail'), icon: 'none' })
            }
          },
        })
      }
    },
  })
}

function previewImg(url: string) {
  uni.previewImage({ urls: [url], current: url })
}

async function onSendImage() {
  if (!currentUser.value || !conversationId.value) return
  if (sending.value) return
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: async (res) => {
      sending.value = true
      const failsafe = setTimeout(() => { sending.value = false }, 30000)
      try {
        const compressed = await compressImage(res.tempFilePaths[0])
        const urls = await uploadImages([compressed])
        if (urls.length > 0) {
          await sendMessage(conversationId.value, currentUser.value!.id, urls[0], 'image')
          nextTick(() => scrollToBottom())
        }
      } catch (err: any) {
        uni.showToast({
          title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'),
          icon: 'none',
          duration: 2500,
        })
      } finally {
        clearTimeout(failsafe)
        sending.value = false
      }
    },
  })
}

function scrollToBottom() {
  if (messages.value.length > 0) {
    scrollTarget.value = `msg-${messages.value[messages.value.length - 1].id}`
  }
}
</script>

<style lang="scss" scoped>
.page {
  height: 100vh; height: 100dvh;
  display: flex; flex-direction: column;
  background: #f2f2f7; max-width: 480px; margin: 0 auto;
  overflow: hidden;
}

/* ========== Chat Header ========== */
.chat-header {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px;
  padding-top: calc(12px + env(safe-area-inset-top, 0px));
  background: rgba(255,255,255,0.92);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 0.5px solid rgba(0,0,0,0.06);
  z-index: 10;
}
.ch-back {
  width: 32px; height: 32px; display: flex;
  align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
  &:active { opacity: 0.5; }
}
.ch-arrow {
  width: 9px; height: 9px;
  border-left: 2px solid #1a1a1a; border-bottom: 2px solid #1a1a1a;
  transform: rotate(45deg); margin-left: 4px;
}
.ch-info { flex: 1; min-width: 0; }
.ch-name {
  font-size: 16px; font-weight: 600; color: #1a1a1a; display: block;
}
.ch-item-title {
  font-size: 12px; color: #aeaeb2; margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;
}
.ch-name-only {
  font-size: 16px; font-weight: 600; color: #1a1a1a; flex: 1;
}
.ch-more {
  display: flex; gap: 3px; padding: 8px; cursor: pointer; flex-shrink: 0;
  &:active { opacity: 0.5; }
}
.more-dot {
  width: 4px; height: 4px; border-radius: 50%; background: #8e8e93;
}

/* ========== Item Context Card ========== */
.chat-scam {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px;
  background: #FFF4E6;
  border-bottom: 0.5px solid rgba(255,149,0,0.2);
}
.cs-icon {
  width: 16px; height: 16px; border-radius: 50%; background: #FF9500;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.cs-excl {
  width: 1.5px; height: 7px; background: #fff; border-radius: 1px; position: relative;
}
.cs-excl::after {
  content: ''; position: absolute; bottom: -4px; left: -0.75px;
  width: 3px; height: 2.5px; background: #fff; border-radius: 2px;
}
.cs-text { font-size: 11px; color: #8B5000; line-height: 1.4; flex: 1; font-weight: 500; }

.item-card {
  display: flex; align-items: center; gap: 10px;
  margin: 9px 12px 0; padding: 9px 12px;
  background: #fff; border-radius: 10px;
  cursor: pointer;
  &:active { background: #f7f7f8; }
}
.offer-bar {
  padding: 6px 12px 2px;
}
.offer-btn {
  display: flex; align-items: center; justify-content: center;
  background: #FFF8E1; border: 1px solid #FFD54F;
  border-radius: 8px; padding: 8px; cursor: pointer;
  text { font-size: 13px; font-weight: 600; color: #F57F17; }
  &:active { background: #FFF3C4; }
}
.quick-replies {
  white-space: nowrap; padding: 8px 12px 4px;
}
.qr-chip {
  display: inline-block; padding: 7px 14px; margin-right: 8px;
  background: #fff; border: 1px solid rgba(0,0,0,0.08);
  border-radius: 16px; font-size: 13px; color: #1a1a1a;
  cursor: pointer;
  &:active { background: #f7f7f8; }
}
.ic-img {
  width: 40px; height: 40px; border-radius: 6px;
  flex-shrink: 0; background: #f2f2f7;
}
.ic-info { flex: 1; min-width: 0; }
.ic-title {
  font-size: 13px; color: #1a1a1a; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;
}
.ic-bottom { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
.ic-price { font-size: 14px; font-weight: 700; color: #1a1a1a; }
.ic-sold { font-size: 11px; color: #FF3B30; font-weight: 600; }
.ic-reserved { font-size: 11px; color: #FF9500; font-weight: 600; }
.ic-arrow {
  width: 7px; height: 7px;
  border-top: 1.5px solid #c7c7cc; border-right: 1.5px solid #c7c7cc;
  transform: rotate(45deg); flex-shrink: 0;
}

/* ========== Messages ========== */
.message-list {
  flex: 1; min-height: 0;
  padding: 12px 16px;
}
.msg-row {
  display: flex; align-items: flex-end; margin-bottom: 9px; gap: 8px;
  &.mine {
    justify-content: flex-end;
.time-divider {
  text-align: center; padding: 12px 0 6px;
  text { font-size: 11px; color: #c7c7cc; background: #f2f2f7; padding: 2px 10px; border-radius: 8px; }
}
.msg-bubble {
      background: #1a1a1a; color: #fff;
      border-radius: 18px 18px 4px 18px;
    }
  }
}
.msg-avatar {
  width: 32px; height: 32px; border-radius: 50%;
  flex-shrink: 0; background: #e8e8ed;
}
.msg-bubble {
  max-width: 68%; padding: 10px 14px;
  background: #fff; border-radius: 4px 18px 18px 18px;
  font-size: 15px; line-height: 1.5; word-break: break-all;
}
.msg-image {
  max-width: 200px; border-radius: 12px; background: #e8e8ed;
}
.img-btn {
  width: 38px; height: 38px; display: flex;
  align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0;
  background: #f2f2f7; border-radius: 50%;
  &:active { background: #e5e5ea; }
}
.img-icon {
  width: 20px; height: 16px; border: 1.8px solid #636366; border-radius: 3px; position: relative;
  &::before {
    content: ''; position: absolute; top: 2px; left: 3px;
    width: 4px; height: 4px; border-radius: 50%; border: 1.2px solid #636366;
  }
}

.empty-chat {
  display: flex; flex-direction: column; align-items: center;
  padding-top: 80px; gap: 10px; color: #c7c7cc; font-size: 14px;
}
/* CSS Wave Icon */
.ec-icon { margin-bottom: 4px; }
.ec-wave {
  width: 32px; height: 24px; position: relative;
  &::before {
    content: ''; position: absolute; top: 2px; left: 0;
    width: 28px; height: 20px; border: 2px solid #d1d1d6;
    border-radius: 14px 14px 14px 4px;
  }
  &::after {
    content: ''; position: absolute; top: 9px; left: 7px;
    width: 12px; height: 3px; border-radius: 2px;
    background: #d1d1d6;
  }
}

/* ========== Input Bar ========== */
.reply-ctx {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px;
  background: rgba(255,107,53,0.08);
  border-top: 0.5px solid rgba(255,107,53,0.15);
  max-width: 480px; margin: 0 auto;
  width: 100%; box-sizing: border-box;
}
.rc-bar { width: 3px; align-self: stretch; background: #FF6B35; border-radius: 2px; }
.rc-body { flex: 1; min-width: 0; }
.rc-label { display: block; font-size: 11px; color: #FF6B35; font-weight: 600; }
.rc-text {
  display: block; font-size: 13px; color: #636366;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  margin-top: 2px;
}
.rc-x {
  width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
  &:active { background: rgba(255,107,53,0.15); }
}
.rc-x-inner {
  width: 11px; height: 11px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; top: 50%; left: 0;
    width: 11px; height: 1.5px; background: #FF6B35;
  }
  &::before { transform: rotate(45deg); }
  &::after { transform: rotate(-45deg); }
}

.input-bar {
  display: flex; align-items: center; padding: 9px 14px;
  background: #fff; border-top: 0.5px solid rgba(0,0,0,0.06); gap: 8px;
  padding-bottom: calc(9px + env(safe-area-inset-bottom));
}
.msg-input {
  flex: 1; height: 40px; background: #f2f2f7; border-radius: 20px;
  padding: 0 16px; font-size: 15px; color: #1a1a1a;
}
.send-btn {
  width: 40px; height: 40px; background: #1a1a1a;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
  &.disabled { opacity: 0.25; pointer-events: none; }
  &:active { opacity: 0.7; }
}
.send-arrow {
  width: 10px; height: 10px;
  border-top: 2px solid #fff; border-right: 2px solid #fff;
  transform: rotate(-45deg); margin-left: -2px;
}
</style>
