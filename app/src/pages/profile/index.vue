<template>
  <view class="page">
    <DesktopNav current="profile" />

    <!-- Mobile Header -->
    <view class="page-header">
      <text class="ph-title">{{ t('nav.profile') }}</text>
    </view>

    <view v-if="!isLoggedIn" class="login-section">
      <view class="avatar-placeholder">
        <view class="ap-head"></view>
        <view class="ap-body"></view>
      </view>
      <text class="login-hint">{{ t('profile.signInHint') }}</text>
      <view class="login-btn" @click="goLogin">{{ t('profile.signIn') }}</view>
    </view>

    <view v-else class="profile-section">
      <view class="user-header">
        <image :src="currentUser?.avatar_url || '/static/default-avatar.png'" class="avatar" />
        <view class="user-info">
          <text class="nickname">{{ currentUser?.nickname }}</text>
          <view class="location-row">
            <view class="loc-dot"></view>
            <text class="location">{{ currentUser?.location || 'UIUC' }}</text>
          </view>
        </view>
        <view class="edit-btn" @click="onEditProfile">
          <view class="edit-icon"></view>
        </view>
      </view>

      <view class="stats-row">
        <view class="stat-item">
          <text class="stat-num">{{ myItems.length }}</text>
          <text class="stat-label">{{ t('profile.listed') }}</text>
        </view>
        <view class="stat-item">
          <text class="stat-num">{{ favCount }}</text>
          <text class="stat-label">{{ t('profile.saved') }}</text>
        </view>
        <view class="stat-item">
          <text class="stat-num">{{ soldCount }}</text>
          <text class="stat-label">{{ t('profile.sold') }}</text>
        </view>
      </view>
    </view>

    <view v-if="isLoggedIn" class="section">
      <view class="section-header">
        <text class="section-title">{{ t('profile.myListings') }}</text>
      </view>

      <view v-if="myItems.length === 0" class="empty-items">
        <view class="empty-bag"></view>
        <text class="empty-text">{{ t('profile.noListings') }}</text>
      </view>

      <view v-else class="my-items">
        <view v-for="item in myItems" :key="item.id" class="my-item" @click="goDetail(item.id)">
          <image :src="item.images[0] || '/static/placeholder.png'" class="item-img" mode="aspectFill" />
          <view class="item-info">
            <text class="item-title">{{ item.title }}</text>
            <text class="item-price">${{ item.price }}</text>
            <text :class="['item-status', item.status]">{{ t('status.' + item.status) }}</text>
          </view>
          <view class="item-actions" v-if="item.status === 'active'">
            <view class="mark-sold-btn" @click.stop="markAsSold(item.id)">
              <text>{{ t('profile.markSold') }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view v-if="isLoggedIn" class="menu-section">
      <view class="menu-item" @click="signOut">
        <text class="menu-text danger">{{ t('profile.signOut') }}</text>
      </view>
    </view>
    <CustomTabBar current="profile" />
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import DesktopNav from '../../components/DesktopNav.vue'
import CustomTabBar from '../../components/CustomTabBar.vue'
import { useItems } from '../../composables/useItems'
import { useFavorites } from '../../composables/useFavorites'
import type { Item } from '../../types'

const { t } = useI18n()
const { currentUser, isLoggedIn, signOut } = useAuth()
const { fetchMyItems, updateItemStatus } = useItems()
const { favoriteIds, loadMyFavorites } = useFavorites()

const myItems = ref<Item[]>([])
const favCount = computed(() => favoriteIds.value.size)
const soldCount = computed(() => myItems.value.filter(i => i.status === 'sold').length)

onShow(async () => {
  if (currentUser.value) {
    myItems.value = await fetchMyItems(currentUser.value.id)
    await loadMyFavorites(currentUser.value.id)
  }
})

function goLogin() {
  uni.navigateTo({ url: '/pages/login/index' })
}

function goDetail(id: string) {
  uni.navigateTo({ url: `/pages/detail/index?id=${id}` })
}

function onEditProfile() {
  // Future: navigate to edit profile page
  uni.showToast({ title: t('profile.editSoon'), icon: 'none' })
}

async function markAsSold(id: string) {
  try {
    if (updateItemStatus) {
      await updateItemStatus(id, 'sold')
      if (currentUser.value) {
        myItems.value = await fetchMyItems(currentUser.value.id)
      }
      uni.showToast({ title: t('profile.markedSold'), icon: 'success' })
    }
  } catch {
    uni.showToast({ title: t('profile.markFail'), icon: 'none' })
  }
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh; background: #f2f2f7;
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
.ph-title { font-size: 17px; font-weight: 700; color: #1a1a1a; }
@media (min-width: 768px) { .page-header { display: none; } }

.login-section {
  background: #fff; display: flex; flex-direction: column;
  align-items: center; padding: 64px 16px; gap: 12px;
}

/* CSS Person Icon */
.avatar-placeholder {
  width: 72px; height: 72px; border-radius: 50%;
  background: #f2f2f7; position: relative;
  display: flex; align-items: center; justify-content: center;
}
.ap-head {
  position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
  width: 18px; height: 18px; border-radius: 50%;
  border: 2.5px solid #c7c7cc;
}
.ap-body {
  position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%);
  width: 30px; height: 14px; border-radius: 15px 15px 0 0;
  border: 2.5px solid #c7c7cc; border-bottom: none;
}

.login-hint { color: #aeaeb2; font-size: 14px; }
.login-btn {
  margin-top: 4px; padding: 10px 36px;
  background: #1a1a1a; color: #fff; border-radius: 22px;
  font-size: 14px; font-weight: 600; cursor: pointer;
  &:active { opacity: 0.8; }
}

.profile-section { background: #fff; padding: 22px 16px 18px; }
.user-header { display: flex; align-items: center; gap: 14px; }
.avatar {
  width: 58px; height: 58px; border-radius: 50%;
  background: #f2f2f7; flex-shrink: 0;
}
.user-info { flex: 1; }
.nickname { font-size: 19px; font-weight: 700; color: #1a1a1a; display: block; }
.location-row {
  display: flex; align-items: center; gap: 5px; margin-top: 4px;
}
.loc-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #FF6B35; flex-shrink: 0;
}
.location { font-size: 13px; color: #aeaeb2; }

/* Edit Profile Button */
.edit-btn {
  width: 36px; height: 36px; border-radius: 50%;
  background: #f2f2f7;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
  &:active { background: #e5e5ea; }
}
.edit-icon {
  width: 14px; height: 14px; position: relative;
  &::before {
    content: ''; position: absolute; bottom: 0; left: 0;
    width: 14px; height: 2px; background: #636366;
    border-radius: 1px;
  }
  &::after {
    content: ''; position: absolute; top: 0; right: 2px;
    width: 2px; height: 10px; background: #636366;
    border-radius: 1px; transform: rotate(-40deg);
    transform-origin: bottom center;
  }
}

.stats-row {
  display: flex; margin-top: 18px; padding-top: 18px;
  border-top: 0.5px solid rgba(0,0,0,0.06);
}
.stat-item { flex: 1; text-align: center; }
.stat-num { font-size: 20px; font-weight: 700; color: #1a1a1a; display: block; }
.stat-label { font-size: 12px; color: #aeaeb2; margin-top: 3px; }

.section { background: #fff; margin-top: 7px; }
.section-header { padding: 14px 16px; border-bottom: 0.5px solid rgba(0,0,0,0.06); }
.section-title { font-size: 15px; font-weight: 600; color: #1a1a1a; }

.empty-items {
  display: flex; flex-direction: column; align-items: center;
  padding: 36px 16px; gap: 10px;
}
/* CSS Bag Icon */
.empty-bag {
  width: 28px; height: 32px; border: 2px solid #d1d1d6;
  border-radius: 4px; position: relative;
  &::before {
    content: ''; position: absolute; top: -8px; left: 4px;
    width: 16px; height: 10px;
    border: 2px solid #d1d1d6; border-bottom: none;
    border-radius: 8px 8px 0 0;
  }
}
.empty-text { font-size: 14px; color: #aeaeb2; }

.my-item {
  display: flex; padding: 13px 16px;
  border-bottom: 0.5px solid rgba(0,0,0,0.06);
  gap: 12px; cursor: pointer;
  &:active { background: #f7f7f8; }
}
.item-img {
  width: 72px; height: 72px; border-radius: 9px;
  flex-shrink: 0; background: #f2f2f7; object-fit: cover;
}
.item-info { flex: 1; display: flex; flex-direction: column; gap: 4px; justify-content: center; }
.item-title {
  font-size: 14px; color: #1a1a1a;
  display: -webkit-box; -webkit-line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4;
}
.item-price { font-size: 16px; font-weight: 700; color: #1a1a1a; }
.item-status {
  font-size: 11px; align-self: flex-start; padding: 2px 8px; border-radius: 4px;
  &.active { color: #34C759; background: rgba(52,199,89,0.1); }
  &.reserved { color: #FF9500; background: rgba(255,149,0,0.1); }
  &.sold { color: #8e8e93; background: #f2f2f7; }
}

.item-actions {
  display: flex; align-items: center; flex-shrink: 0;
}
.mark-sold-btn {
  padding: 6px 12px; border-radius: 6px;
  background: #f2f2f7; cursor: pointer;
  text { font-size: 12px; color: #636366; font-weight: 500; }
  &:active { background: #e5e5ea; }
}

.menu-section { margin-top: 7px; background: #fff; }
.menu-item { padding: 15px; text-align: center; cursor: pointer; }
.menu-text {
  font-size: 15px;
  &.danger { color: #FF3B30; }
}
</style>
