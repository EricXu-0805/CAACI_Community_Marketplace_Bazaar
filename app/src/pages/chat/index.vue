<template>
  <view class="page">
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
        <text class="empty-icon">👋</text>
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
        <text>{{ t('chat.send') }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onUnmounted, nextTick } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useMessages } from '../../composables/useMessages'
import { useI18n } from '../../composables/useI18n'

const { t } = useI18n()

const { currentUser } = useAuth()
const { messages, fetchMessages, sendMessage, subscribeToMessages, markAsRead } = useMessages()

const inputText = ref('')
const scrollTarget = ref('')
const conversationId = ref('')
let unsubscribe: (() => void) | null = null

onLoad(async (options) => {
  if (options?.id) {
    conversationId.value = options.id
    await fetchMessages(options.id)
    scrollToBottom()

    if (currentUser.value) {
      markAsRead(options.id, currentUser.value.id)
    }

    unsubscribe = subscribeToMessages(options.id, (newMsg) => {
      messages.value.push(newMsg)
      nextTick(() => scrollToBottom())
    })
  }
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})

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
.message-list { flex: 1; padding: 16px; }
.msg-row {
  display: flex; align-items: flex-end; margin-bottom: 10px; gap: 8px;
  &.mine {
    flex-direction: row-reverse;
    .msg-bubble { background: #FF6B35; color: #fff; border-radius: 18px 4px 18px 18px; }
  }
}
.msg-avatar { width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0; background: #e8e8ed; }
.msg-bubble {
  max-width: 68%; padding: 10px 14px;
  background: #fff; border-radius: 4px 18px 18px 18px;
  font-size: 15px; line-height: 1.5; word-break: break-all;
}
.empty-chat {
  display: flex; flex-direction: column; align-items: center;
  padding-top: 100px; gap: 8px; color: #bbb; font-size: 15px;
}
.empty-icon { font-size: 40px; }
.input-bar {
  display: flex; align-items: center; padding: 10px 14px;
  background: #fff; border-top: 1px solid #f0f0f0; gap: 8px;
  padding-bottom: calc(10px + env(safe-area-inset-bottom));
}
.msg-input {
  flex: 1; height: 40px; background: #f5f5f5; border-radius: 20px;
  padding: 0 16px; font-size: 15px;
}
.send-btn {
  height: 40px; padding: 0 20px; background: #FF6B35; color: #fff;
  border-radius: 20px; font-size: 15px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  &.disabled { opacity: 0.4; pointer-events: none; }
  &:active { opacity: 0.85; }
}
</style>
