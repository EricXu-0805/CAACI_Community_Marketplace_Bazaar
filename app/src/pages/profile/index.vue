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
.page {
  min-height: 100vh;
  background: $bg-secondary;
}

.login-section {
  background: $bg-primary;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 100rpx $spacing-md;
  gap: $spacing-md;
}

.avatar-placeholder {
  font-size: 80rpx;
  width: 160rpx;
  height: 160rpx;
  background: $bg-secondary;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-hint {
  color: $text-hint;
  font-size: 26rpx;
}

.login-btn {
  padding: $spacing-sm $spacing-xl;
  background: $brand-color;
  color: white;
  border-radius: 40rpx;
  border: none;
  font-size: 28rpx;
}

.profile-section {
  background: $bg-primary;
  padding: $spacing-lg $spacing-md;
}

.user-header {
  display: flex;
  align-items: center;
  gap: $spacing-md;
}

.avatar {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  background: $border-color;
}

.user-info {
  flex: 1;
}

.nickname {
  font-size: 36rpx;
  font-weight: bold;
  color: $text-primary;
  display: block;
}

.location {
  font-size: 24rpx;
  color: $text-hint;
  margin-top: $spacing-xs;
}

.stats-row {
  display: flex;
  margin-top: $spacing-lg;
  padding-top: $spacing-lg;
  border-top: 1rpx solid $border-color;
}

.stat-item {
  flex: 1;
  text-align: center;
}

.stat-num {
  font-size: 36rpx;
  font-weight: bold;
  color: $text-primary;
  display: block;
}

.stat-label {
  font-size: 22rpx;
  color: $text-hint;
  margin-top: $spacing-xs;
}

.section {
  background: $bg-primary;
  margin-top: $spacing-sm;
}

.section-header {
  padding: $spacing-md;
  border-bottom: 1rpx solid $border-color;
}

.section-title {
  font-size: 28rpx;
  font-weight: bold;
  color: $text-primary;
}

.empty-items {
  padding: $spacing-xl;
  text-align: center;
  color: $text-hint;
  font-size: 24rpx;
}

.my-item {
  display: flex;
  padding: $spacing-md;
  border-bottom: 1rpx solid $border-color;
  gap: $spacing-md;
}

.item-img {
  width: 160rpx;
  height: 160rpx;
  border-radius: $radius-sm;
  flex-shrink: 0;
}

.item-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: $spacing-xs;
}

.item-title {
  font-size: 28rpx;
  color: $text-primary;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.item-price {
  font-size: 30rpx;
  font-weight: bold;
  color: $brand-color;
}

.item-status {
  font-size: 22rpx;
  align-self: flex-start;
  padding: 2rpx $spacing-sm;
  border-radius: $radius-sm;

  &.active { color: $success-color; background: rgba(82, 196, 26, 0.1); }
  &.reserved { color: $warning-color; background: rgba(250, 173, 20, 0.1); }
  &.sold { color: $text-hint; background: $bg-secondary; }
}

.menu-section {
  margin-top: $spacing-sm;
  background: $bg-primary;
}

.menu-item {
  padding: $spacing-md;
  text-align: center;
}

.menu-text {
  font-size: 28rpx;

  &.danger {
    color: $danger-color;
  }
}
</style>
