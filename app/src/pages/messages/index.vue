<template>
  <view class="page">
    <DesktopNav current="messages" />

    <view v-if="!isLoggedIn" class="login-prompt">
      <text class="prompt-icon">💬</text>
      <text class="prompt-text">Sign in to view messages</text>
      <view class="login-btn" @click="goLogin">Sign In</view>
    </view>

    <view v-else-if="conversations.length === 0 && !loading" class="empty">
      <text class="empty-icon">💬</text>
      <text class="empty-title">No messages yet</text>
      <text class="empty-sub">Browse items and chat with sellers!</text>
    </view>

    <view v-else class="conv-list">
      <view
        v-for="conv in conversations"
        :key="conv.id"
        class="conv-item"
        @click="goChat(conv.id)"
      >
        <image
          :src="getOtherUser(conv)?.avatar_url || '/static/default-avatar.png'"
          class="conv-avatar"
        />
        <view class="conv-info">
          <view class="conv-top">
            <text class="conv-name">{{ getOtherUser(conv)?.nickname || 'User' }}</text>
            <text class="conv-time">{{ formatTime(conv.last_message_at) }}</text>
          </view>
          <text class="conv-preview" v-if="conv.item">
            {{ conv.item.title }}
          </text>
        </view>
        <image
          v-if="conv.item?.images?.[0]"
          :src="conv.item.images[0]"
          class="conv-thumb"
          mode="aspectFill"
        />
      </view>
    </view>

    <view v-if="loading" class="loading-tip">Loading...</view>
    <CustomTabBar current="messages" />
  </view>
</template>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import DesktopNav from '../../components/DesktopNav.vue'
import CustomTabBar from '../../components/CustomTabBar.vue'
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
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: #fff; max-width: 480px; margin: 0 auto; padding-bottom: 70px; }

.login-prompt, .empty {
  display: flex; flex-direction: column; align-items: center;
  padding-top: 140px; gap: 10px;
}
.prompt-icon, .empty-icon { font-size: 48px; }
.prompt-text { font-size: 15px; color: #999; }
.empty-title { font-size: 16px; color: #333; font-weight: 600; }
.empty-sub { font-size: 13px; color: #999; }
.login-btn {
  margin-top: 12px; padding: 10px 36px;
  background: #FF6B35; color: #fff; border-radius: 22px;
  font-size: 15px; font-weight: 600; cursor: pointer;
}

.conv-item {
  display: flex; align-items: center; padding: 14px 16px;
  border-bottom: 1px solid #f5f5f5; gap: 12px; cursor: pointer;
  transition: background 0.1s;
  &:active { background: #fafafa; }
}
.conv-avatar { width: 50px; height: 50px; border-radius: 50%; background: #f0f0f0; flex-shrink: 0; }
.conv-info { flex: 1; min-width: 0; }
.conv-top { display: flex; justify-content: space-between; align-items: center; }
.conv-name { font-size: 15px; font-weight: 600; color: #1d1d1f; }
.conv-time { font-size: 12px; color: #bbb; }
.conv-preview {
  font-size: 13px; color: #999; margin-top: 4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;
}
.conv-thumb { width: 44px; height: 44px; border-radius: 8px; flex-shrink: 0; }

.loading-tip { text-align: center; padding: 32px; color: #bbb; font-size: 13px; }
</style>
