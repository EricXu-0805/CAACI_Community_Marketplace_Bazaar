<template>
  <view class="page">
    <view v-if="!isLoggedIn" class="login-section">
      <view class="avatar-placeholder">👤</view>
      <text class="login-hint">登录后体验完整功能</text>
      <button class="login-btn" @click="goLogin">登录 / 注册</button>
    </view>

    <view v-else class="profile-section">
      <view class="user-header">
        <image :src="currentUser?.avatar_url || '/static/default-avatar.png'" class="avatar" />
        <view class="user-info">
          <text class="nickname">{{ currentUser?.nickname }}</text>
          <text class="location">📍 {{ currentUser?.location || 'UIUC' }}</text>
        </view>
      </view>

      <view class="stats-row">
        <view class="stat-item">
          <text class="stat-num">{{ myItems.length }}</text>
          <text class="stat-label">发布</text>
        </view>
        <view class="stat-item">
          <text class="stat-num">0</text>
          <text class="stat-label">收藏</text>
        </view>
        <view class="stat-item">
          <text class="stat-num">0</text>
          <text class="stat-label">已售</text>
        </view>
      </view>
    </view>

    <view v-if="isLoggedIn" class="section">
      <view class="section-header">
        <text class="section-title">我的发布</text>
      </view>

      <view v-if="myItems.length === 0" class="empty-items">
        <text>还没有发布商品</text>
      </view>

      <view v-else class="my-items">
        <view v-for="item in myItems" :key="item.id" class="my-item" @click="goDetail(item.id)">
          <image :src="item.images[0] || '/static/placeholder.png'" class="item-img" mode="aspectFill" />
          <view class="item-info">
            <text class="item-title">{{ item.title }}</text>
            <text class="item-price">¥{{ item.price }}</text>
            <text :class="['item-status', item.status]">{{ statusLabels[item.status] }}</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="isLoggedIn" class="menu-section">
      <view class="menu-item" @click="signOut">
        <text class="menu-text danger">退出登录</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useItems } from '../../composables/useItems'
import { STATUS_LABELS, type Item } from '../../types'

const { currentUser, isLoggedIn, signOut } = useAuth()
const { fetchMyItems } = useItems()

const statusLabels = STATUS_LABELS
const myItems = ref<Item[]>([])

onShow(async () => {
  if (currentUser.value) {
    myItems.value = await fetchMyItems(currentUser.value.id)
  }
})

function goLogin() {
  uni.navigateTo({ url: '/pages/login/index' })
}

function goDetail(id: string) {
  uni.navigateTo({ url: `/pages/detail/index?id=${id}` })
}
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: #f5f5f7; max-width: 480px; margin: 0 auto; }
.login-section { background: #fff; display: flex; flex-direction: column; align-items: center; padding: 64px 16px; gap: 12px; }
.avatar-placeholder { font-size: 44px; width: 80px; height: 80px; background: #f5f5f7; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.login-hint { color: #aeaeb2; font-size: 14px; }
.login-btn { padding: 10px 32px; background: #FF6B35; color: #fff; border-radius: 22px; border: none; font-size: 15px; font-weight: 600; }
.profile-section { background: #fff; padding: 24px 16px; }
.user-header { display: flex; align-items: center; gap: 16px; }
.avatar { width: 64px; height: 64px; border-radius: 50%; background: #f0f0f0; }
.user-info { flex: 1; }
.nickname { font-size: 20px; font-weight: 700; color: #1d1d1f; display: block; }
.location { font-size: 13px; color: #aeaeb2; margin-top: 4px; }
.stats-row { display: flex; margin-top: 20px; padding-top: 20px; border-top: 1px solid #f0f0f0; }
.stat-item { flex: 1; text-align: center; }
.stat-num { font-size: 20px; font-weight: 700; color: #1d1d1f; display: block; }
.stat-label { font-size: 12px; color: #aeaeb2; margin-top: 4px; }
.section { background: #fff; margin-top: 8px; }
.section-header { padding: 14px 16px; border-bottom: 1px solid #f0f0f0; }
.section-title { font-size: 15px; font-weight: 600; color: #1d1d1f; }
.empty-items { padding: 32px; text-align: center; color: #aeaeb2; font-size: 14px; }
.my-item { display: flex; padding: 14px 16px; border-bottom: 1px solid #f0f0f0; gap: 12px; }
.item-img { width: 80px; height: 80px; border-radius: 8px; flex-shrink: 0; object-fit: cover; }
.item-info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.item-title { font-size: 14px; color: #1d1d1f; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4; }
.item-price { font-size: 17px; font-weight: 700; color: #FF6B35; }
.item-status { font-size: 11px; align-self: flex-start; padding: 2px 8px; border-radius: 4px;
  &.active { color: #52C41A; background: rgba(82,196,26,0.1); }
  &.reserved { color: #FAAD14; background: rgba(250,173,20,0.1); }
  &.sold { color: #aeaeb2; background: #f5f5f7; }
}
.menu-section { margin-top: 8px; background: #fff; }
.menu-item { padding: 16px; text-align: center; }
.menu-text { font-size: 15px; &.danger { color: #FF4D4F; } }
</style>
