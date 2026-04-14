<template>
  <view class="page">
    <DesktopNav current="messages" />
    <view v-if="!isLoggedIn" class="login-prompt">
      <text>登录后查看消息</text>
      <button class="login-btn" @click="goLogin">去登录</button>
    </view>

    <view v-else-if="conversations.length === 0 && !loading" class="empty">
      <text>暂无消息</text>
      <text class="empty-sub">浏览商品，联系卖家开始聊天吧</text>
    </view>

    <view v-else class="conversation-list">
      <view
        v-for="conv in conversations"
        :key="conv.id"
        class="conversation-item"
        @click="goChat(conv.id)"
      >
        <image
          :src="getOtherUser(conv)?.avatar_url || '/static/default-avatar.png'"
          class="avatar"
        />
        <view class="conv-info">
          <view class="conv-header">
            <text class="conv-name">{{ getOtherUser(conv)?.nickname || '未知用户' }}</text>
            <text class="conv-time">{{ formatTime(conv.last_message_at) }}</text>
          </view>
          <text class="conv-item-title" v-if="conv.item">
            {{ conv.item.title }}
          </text>
        </view>
        <image
          v-if="conv.item?.images?.[0]"
          :src="conv.item.images[0]"
          class="conv-item-image"
          mode="aspectFill"
        />
      </view>
    </view>

    <view v-if="loading" class="loading-tip">加载中...</view>
  </view>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import DesktopNav from '../../components/DesktopNav.vue'
import { useMessages } from '../../composables/useMessages'
import type { Conversation, Profile } from '../../types'

const { currentUser, isLoggedIn } = useAuth()
const { conversations, loading, fetchConversations } = useMessages()

onShow(() => {
  if (currentUser.value) {
    fetchConversations(currentUser.value.id)
  }
})

function getOtherUser(conv: Conversation): Profile | undefined {
  if (!currentUser.value) return undefined
  return conv.buyer_id === currentUser.value.id ? conv.seller : conv.buyer
}

function goChat(conversationId: string) {
  uni.navigateTo({ url: `/pages/chat/index?id=${conversationId}` })
}

function goLogin() {
  uni.navigateTo({ url: '/pages/login/index' })
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  return date.toLocaleDateString()
}
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: #fff; max-width: 480px; margin: 0 auto; }
.login-prompt, .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding-top: 160px; gap: 12px; color: #aeaeb2; font-size: 15px; }
.login-btn { margin-top: 16px; padding: 10px 32px; background: #FF6B35; color: #fff; border-radius: 22px; border: none; font-size: 15px; font-weight: 600; }
.empty-sub { font-size: 13px; }
.conversation-item { display: flex; align-items: center; padding: 14px 16px; border-bottom: 1px solid #f0f0f0; gap: 12px; }
.avatar { width: 50px; height: 50px; border-radius: 50%; background: #f0f0f0; flex-shrink: 0; }
.conv-info { flex: 1; min-width: 0; }
.conv-header { display: flex; justify-content: space-between; align-items: center; }
.conv-name { font-size: 15px; font-weight: 600; color: #1d1d1f; }
.conv-time { font-size: 12px; color: #aeaeb2; }
.conv-item-title { font-size: 13px; color: #86868b; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
.conv-item-image { width: 44px; height: 44px; border-radius: 8px; flex-shrink: 0; }
.loading-tip { text-align: center; padding: 32px; color: #aeaeb2; font-size: 13px; }
</style>
