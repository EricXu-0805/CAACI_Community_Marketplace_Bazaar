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
.page { height: 100vh; display: flex; flex-direction: column; background: #f5f5f7; max-width: 480px; margin: 0 auto; }
.message-list { flex: 1; padding: 16px; }
.message-row { display: flex; align-items: flex-start; margin-bottom: 12px; gap: 8px;
  &.mine { flex-direction: row-reverse;
    .msg-bubble { background: #FF6B35; color: #fff; border-radius: 16px 4px 16px 16px; }
  }
}
.msg-avatar { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; background: #f0f0f0; }
.msg-bubble { max-width: 65%; padding: 10px 14px; background: #fff; border-radius: 4px 16px 16px 16px; font-size: 15px; line-height: 1.55; word-break: break-all; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
.empty-chat { text-align: center; padding-top: 120px; color: #aeaeb2; font-size: 15px; }
.input-bar { display: flex; align-items: center; padding: 10px 16px; background: #fff; border-top: 1px solid #f0f0f0; gap: 8px; padding-bottom: calc(10px + env(safe-area-inset-bottom)); }
.msg-input { flex: 1; height: 40px; background: #f5f5f7; border-radius: 20px; padding: 0 16px; font-size: 15px; }
.send-btn { height: 40px; padding: 0 20px; background: #FF6B35; color: #fff; border-radius: 20px; font-size: 15px; font-weight: 600; border: none; display: flex; align-items: center;
  &[disabled] { opacity: 0.4; }
}
</style>
