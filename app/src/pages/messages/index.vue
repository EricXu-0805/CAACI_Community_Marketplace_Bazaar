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
        class="conv-item"
        @click="goChat(conv.id)"
      >
        <image
          :src="getOtherUser(conv)?.avatar_url || '/static/default-avatar.png'"
          class="conv-avatar"
        />
        <view class="conv-info">
          <view class="conv-top">
            <text class="conv-name">{{ getOtherUser(conv)?.nickname || t('app.user') }}</text>
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

    <view v-if="loading" class="loading-tip">
      <view class="loading-dot"></view>
      <text>{{ t('msg.loading') }}</text>
    </view>
    <CustomTabBar current="messages" />
  </view>
</template>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
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
const { conversations, loading, fetchConversations } = useMessages()
const { refreshUnreadCount } = useUnread()

onShow(() => {
  if (currentUser.value) {
    fetchConversations(currentUser.value.id)
    refreshUnreadCount()
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

/* CSS Speech Bubble Icon */
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

.conv-item {
  display: flex; align-items: center; padding: 13px 16px;
  border-bottom: 0.5px solid rgba(0,0,0,0.06); gap: 12px; cursor: pointer;
  transition: background 0.1s;
  &:active { background: #f7f7f8; }
}
.conv-avatar {
  width: 48px; height: 48px; border-radius: 50%;
  background: #f2f2f7; flex-shrink: 0;
}
.conv-info { flex: 1; min-width: 0; }
.conv-top { display: flex; justify-content: space-between; align-items: center; }
.conv-name { font-size: 15px; font-weight: 600; color: #1a1a1a; }
.conv-time { font-size: 12px; color: #c7c7cc; }
.conv-preview {
  font-size: 13px; color: #aeaeb2; margin-top: 4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;
}
.conv-thumb {
  width: 42px; height: 42px; border-radius: 7px;
  flex-shrink: 0; background: #f2f2f7;
}

.loading-tip {
  display: flex; align-items: center; justify-content: center;
  padding: 32px; gap: 8px; color: #c7c7cc; font-size: 13px;
}
.loading-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #c7c7cc; animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
</style>
