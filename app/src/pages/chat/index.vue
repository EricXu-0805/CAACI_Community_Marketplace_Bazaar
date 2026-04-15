<template>
  <view class="page">
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
    </view>

    <!-- Item Context Card -->
    <view class="item-card" v-if="itemInfo" @click="goToItem">
      <image
        :src="itemInfo.images?.[0] || '/static/placeholder.png'"
        class="ic-img"
        mode="aspectFill"
      />
      <view class="ic-info">
        <text class="ic-title">{{ itemInfo.title }}</text>
        <text class="ic-price">${{ itemInfo.price }}</text>
      </view>
      <view class="ic-arrow"></view>
    </view>

    <scroll-view
      class="message-list"
      scroll-y
      :scroll-into-view="scrollTarget"
      scroll-with-animation
    >
      <view
        v-for="msg in messages"
        :key="msg.id"
        :id="`msg-${msg.id}`"
        :class="['msg-row', { mine: msg.sender_id === currentUser?.id }]"
      >
        <image
          v-if="msg.sender_id !== currentUser?.id"
          :src="msg.sender?.avatar_url || '/static/default-avatar.png'"
          class="msg-avatar"
        />
        <view class="msg-bubble">
          <text>{{ msg.content }}</text>
        </view>
        <image
          v-if="msg.sender_id === currentUser?.id"
          :src="currentUser?.avatar_url || '/static/default-avatar.png'"
          class="msg-avatar"
        />
      </view>

      <view v-if="messages.length === 0" class="empty-chat">
        <view class="ec-icon">
          <view class="ec-wave"></view>
        </view>
        <text>{{ t('chat.empty') }}</text>
      </view>
    </scroll-view>

    <view class="input-bar">
      <input
        v-model="inputText"
        :placeholder="t('chat.placeholder')"
        confirm-type="send"
        @confirm="onSend"
        class="msg-input"
      />
      <view :class="['send-btn', { disabled: !inputText.trim() }]" @click="onSend">
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
import { useI18n } from '../../composables/useI18n'
import type { Item } from '../../types'

const { t } = useI18n()

const { currentUser, requireAuth } = useAuth()
const { messages, fetchMessages, sendMessage, subscribeToMessages, markAsRead, fetchConversationDetail } = useMessages()
const { fetchItem } = useItems()

const inputText = ref('')
const scrollTarget = ref('')
const conversationId = ref('')
const itemInfo = ref<Item | null>(null)
const otherUserName = ref('')
let unsubscribe: (() => void) | null = null

onLoad(async (options) => {
  if (!requireAuth()) return

  if (options?.id) {
    conversationId.value = options.id
    await fetchMessages(options.id)
    scrollToBottom()

    if (currentUser.value) {
      markAsRead(options.id, currentUser.value.id)
    }

    // Load conversation detail for item context
    try {
      const detail = await fetchConversationDetail(options.id)
      if (detail) {
        if (detail.item) {
          itemInfo.value = detail.item
        }
        if (currentUser.value) {
          const other = detail.buyer_id === currentUser.value.id ? detail.seller : detail.buyer
          otherUserName.value = other?.nickname || t('app.user')
        }
      }
    } catch {}

    unsubscribe = subscribeToMessages(options.id, (newMsg) => {
      messages.value.push(newMsg)
      nextTick(() => scrollToBottom())
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

async function onSend() {
  const text = inputText.value.trim()
  if (!text || !currentUser.value || !conversationId.value) return

  inputText.value = ''

  try {
    await sendMessage(conversationId.value, currentUser.value.id, text)
    nextTick(() => scrollToBottom())
  } catch (error) {
    uni.showToast({ title: t('chat.fail'), icon: 'none' })
    inputText.value = text
  }
}

function scrollToBottom() {
  if (messages.value.length > 0) {
    scrollTarget.value = `msg-${messages.value[messages.value.length - 1].id}`
  }
}
</script>

<style lang="scss" scoped>
.page {
  height: 100vh; display: flex; flex-direction: column;
  background: #f2f2f7; max-width: 480px; margin: 0 auto;
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

/* ========== Item Context Card ========== */
.item-card {
  display: flex; align-items: center; gap: 10px;
  margin: 9px 12px 0; padding: 9px 12px;
  background: #fff; border-radius: 10px;
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
.ic-price { font-size: 14px; font-weight: 700; color: #1a1a1a; margin-top: 2px; }
.ic-arrow {
  width: 7px; height: 7px;
  border-top: 1.5px solid #c7c7cc; border-right: 1.5px solid #c7c7cc;
  transform: rotate(45deg); flex-shrink: 0;
}

/* ========== Messages ========== */
.message-list { flex: 1; padding: 12px 16px; }
.msg-row {
  display: flex; align-items: flex-end; margin-bottom: 9px; gap: 8px;
  &.mine {
    flex-direction: row-reverse;
    .msg-bubble {
      background: #1a1a1a; color: #fff;
      border-radius: 18px 4px 18px 18px;
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
