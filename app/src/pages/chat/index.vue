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
        :class="['message-row', { mine: msg.sender_id === currentUser?.id }]"
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
        <text>开始聊天吧！</text>
      </view>
    </scroll-view>

    <view class="input-bar">
      <input
        v-model="inputText"
        placeholder="输入消息..."
        confirm-type="send"
        @confirm="onSend"
        class="msg-input"
      />
      <button class="send-btn" :disabled="!inputText.trim()" @click="onSend">发送</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useMessages } from '../../composables/useMessages'

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
    uni.showToast({ title: '发送失败', icon: 'none' })
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
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: $bg-secondary;
}

.message-list {
  flex: 1;
  padding: $spacing-md;
}

.message-row {
  display: flex;
  align-items: flex-start;
  margin-bottom: $spacing-md;
  gap: $spacing-sm;

  &.mine {
    flex-direction: row-reverse;

    .msg-bubble {
      background: $brand-color;
      color: white;
    }
  }
}

.msg-avatar {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  flex-shrink: 0;
  background: $border-color;
}

.msg-bubble {
  max-width: 60%;
  padding: $spacing-sm $spacing-md;
  background: $bg-primary;
  border-radius: $radius-md;
  font-size: 28rpx;
  line-height: 1.5;
  word-break: break-all;
}

.empty-chat {
  text-align: center;
  padding-top: 200rpx;
  color: $text-hint;
}

.input-bar {
  display: flex;
  align-items: center;
  padding: $spacing-sm $spacing-md;
  background: $bg-primary;
  border-top: 1rpx solid $border-color;
  gap: $spacing-sm;
  padding-bottom: calc(#{$spacing-sm} + env(safe-area-inset-bottom));
}

.msg-input {
  flex: 1;
  height: 72rpx;
  background: $bg-secondary;
  border-radius: 36rpx;
  padding: 0 $spacing-md;
  font-size: 28rpx;
}

.send-btn {
  height: 72rpx;
  padding: 0 $spacing-lg;
  background: $brand-color;
  color: white;
  border-radius: 36rpx;
  font-size: 28rpx;
  border: none;
  display: flex;
  align-items: center;

  &[disabled] {
    opacity: 0.5;
  }
}
</style>
