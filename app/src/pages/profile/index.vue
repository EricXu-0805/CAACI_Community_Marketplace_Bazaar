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
          <view class="name-row">
            <text class="nickname">{{ currentUser?.nickname }}</text>
            <view v-if="currentUser?.is_illini_verified" class="illini-badge">
              <text class="illini-badge-text">✓ Illini</text>
            </view>
          </view>
          <text class="user-bio" v-if="currentUser?.bio">{{ currentUser.bio }}</text>
          <view class="location-row">
            <view class="loc-dot"></view>
            <text class="location">{{ currentUser?.location || 'UIUC' }}</text>
          </view>
          <text class="join-date" v-if="currentUser?.created_at">{{ t('profile.joined') }} {{ formatJoinDate(currentUser.created_at) }}</text>
        </view>
        <view class="edit-btn" @click="onEditProfile">
          <view class="edit-icon"></view>
        </view>
      </view>

      <!-- Tappable stats / tabs -->
      <view class="stats-row">
        <view :class="['stat-item', { active: currentTab === 'listed' }]" @click="currentTab = 'listed'">
          <text class="stat-num">{{ listedItems.length }}</text>
          <text class="stat-label">{{ t('profile.listed') }}</text>
        </view>
        <view :class="['stat-item', { active: currentTab === 'saved' }]" @click="currentTab = 'saved'">
          <text class="stat-num">{{ savedItems.length }}</text>
          <text class="stat-label">{{ t('profile.saved') }}</text>
        </view>
        <view :class="['stat-item', { active: currentTab === 'sold' }]" @click="currentTab = 'sold'">
          <text class="stat-num">{{ soldItems.length }}</text>
          <text class="stat-label">{{ t('profile.sold') }}</text>
        </view>
      </view>
    </view>

    <!-- Content list based on active tab -->
    <view v-if="isLoggedIn" class="section">
      <!-- Listed items -->
      <view v-if="currentTab === 'listed'">
        <view v-if="listedItems.length === 0" class="empty-items">
          <view class="empty-bag"></view>
          <text class="empty-text">{{ t('profile.noListings') }}</text>
        </view>
        <view v-else class="my-items">
          <view v-for="item in listedItems" :key="item.id" class="my-item" @click="goDetail(item.id)">
            <image :src="item.images?.[0] || '/static/placeholder.png'" class="item-img" mode="aspectFill" />
            <view class="item-info">
              <text class="item-title">{{ item.title }}</text>
              <text class="item-price">${{ item.price }}</text>
              <text :class="['item-status', item.status]">{{ t('status.' + item.status) }}</text>
            </view>
            <view class="item-actions">
              <view v-if="item.status === 'active'" class="action-btn" @click.stop="goEdit(item.id)">
                <text>{{ t('profile.edit') }}</text>
              </view>
              <view v-if="item.status === 'active'" class="action-btn" @click.stop="markAsSold(item.id)">
                <text>{{ t('profile.markSold') }}</text>
              </view>
              <view class="action-btn danger" @click.stop="onDeleteItem(item.id)">
                <text>{{ t('profile.delete') }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- Saved / Favorited items -->
      <view v-if="currentTab === 'saved'">
        <view v-if="savedItems.length === 0" class="empty-items">
          <view class="empty-heart"></view>
          <text class="empty-text">{{ t('profile.noSaved') }}</text>
        </view>
        <view v-else class="my-items">
          <view v-for="item in savedItems" :key="item.id" class="my-item" @click="goDetail(item.id)">
            <image :src="item.images?.[0] || '/static/placeholder.png'" class="item-img" mode="aspectFill" />
            <view class="item-info">
              <text class="item-title">{{ item.title }}</text>
              <text class="item-price">${{ item.price }}</text>
              <text v-if="item.status === 'sold'" class="item-status sold">{{ t('status.sold') }}</text>
              <text v-else-if="item.status === 'reserved'" class="item-status reserved">{{ t('status.reserved') }}</text>
              <view v-else class="item-seller" v-if="item.profile">
                <text class="seller-name">{{ item.profile.nickname }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- Sold items -->
      <view v-if="currentTab === 'sold'">
        <view v-if="soldItems.length === 0" class="empty-items">
          <view class="empty-check"></view>
          <text class="empty-text">{{ t('profile.noSold') }}</text>
        </view>
        <view v-else class="my-items">
          <view v-for="item in soldItems" :key="item.id" class="my-item" @click="goDetail(item.id)">
            <image :src="item.images?.[0] || '/static/placeholder.png'" class="item-img" mode="aspectFill" />
            <view class="item-info">
              <text class="item-title">{{ item.title }}</text>
              <text class="item-price">${{ item.price }}</text>
              <text class="item-status sold">{{ t('status.sold') }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view v-if="isLoggedIn" class="menu-section">
      <view class="menu-item" @click="goNotifications">
        <text class="menu-text">{{ t('notif.title') }}</text>
        <view v-if="unreadNotifCount > 0" class="menu-badge">{{ unreadNotifCount }}</view>
        <view class="menu-arrow"></view>
      </view>
      <view class="menu-item" @click="goHistory">
        <text class="menu-text">{{ t('profile.history') }}</text>
        <view class="menu-arrow"></view>
      </view>
      <view class="menu-item" @click="goSettings">
        <text class="menu-text">{{ t('settings.title') }}</text>
        <view class="menu-arrow"></view>
      </view>
    </view>
    <CustomTabBar current="profile" />
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import DesktopNav from '../../components/DesktopNav.vue'
import CustomTabBar from '../../components/CustomTabBar.vue'
import { useItems } from '../../composables/useItems'
import { useFavorites } from '../../composables/useFavorites'
import { useNotifications } from '../../composables/useNotifications'
import type { Item } from '../../types'

const { t } = useI18n()
const { currentUser, isLoggedIn } = useAuth()
const { items: homeItems, fetchMyItems, updateItemStatus, deleteItem } = useItems()
const { loadMyFavorites, fetchMyFavoriteItems } = useFavorites()
const { unreadNotifCount, fetchNotifications } = useNotifications()

const currentTab = ref<'listed' | 'saved' | 'sold'>('listed')
const myItems = ref<Item[]>([])
const savedItems = ref<Item[]>([])

const listedItems = computed(() => myItems.value.filter(i => i.status !== 'sold'))
const soldItems = computed(() => myItems.value.filter(i => i.status === 'sold'))

onShow(async () => {
  if (!currentUser.value) return
  const uid = currentUser.value.id
  try {
    const [items, _favs, favItems] = await Promise.all([
      fetchMyItems(uid),
      loadMyFavorites(uid),
      fetchMyFavoriteItems(uid),
    ])
    myItems.value = items
    savedItems.value = favItems
    fetchNotifications()
  } catch {
    uni.showToast({ title: t('profile.markFail'), icon: 'none' })
  }
})

onPullDownRefresh(async () => {
  if (currentUser.value) {
    const uid = currentUser.value.id
    const [items, , favItems] = await Promise.all([
      fetchMyItems(uid), loadMyFavorites(uid), fetchMyFavoriteItems(uid),
    ])
    myItems.value = items
    savedItems.value = favItems
  }
  uni.stopPullDownRefresh()
})

function formatJoinDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${d.getMonth() + 1}`
}

function goLogin() {
  uni.navigateTo({ url: '/pages/login/index' })
}

function goDetail(id: string) {
  uni.navigateTo({ url: `/pages/detail/index?id=${id}` })
}

function goEdit(id: string) {
  uni.navigateTo({ url: `/pages/publish/index?edit=${id}` })
}

function onEditProfile() { uni.navigateTo({ url: '/pages/profile/edit' }) }
function goNotifications() { uni.navigateTo({ url: '/pages/notifications/index' }) }
function goSettings() { uni.navigateTo({ url: '/pages/settings/index' }) }
function goHistory() { uni.navigateTo({ url: '/pages/history/index' }) }

function markAsSold(id: string) {
  uni.showModal({
    title: t('profile.markSoldTitle'),
    content: t('profile.markSoldHint'),
    confirmText: t('profile.markSold'),
    success: async (res) => {
      if (!res.confirm) return
      try {
        await updateItemStatus(id, 'sold')
        homeItems.value = homeItems.value.filter(i => i.id !== id)
        if (currentUser.value) {
          myItems.value = await fetchMyItems(currentUser.value.id)
        }
        uni.showToast({ title: t('profile.markedSold'), icon: 'success' })
      } catch {
        uni.showToast({ title: t('profile.markFail'), icon: 'none' })
      }
    },
  })
}

function onDeleteItem(id: string) {
  uni.showModal({
    title: t('profile.deleteTitle'),
    content: t('profile.deleteConfirm'),
    success: async (res) => {
      if (!res.confirm) return
      try {
        await deleteItem(id)
        if (currentUser.value) {
          myItems.value = await fetchMyItems(currentUser.value.id)
        }
        uni.showToast({ title: t('profile.deleted'), icon: 'success' })
      } catch {
        uni.showToast({ title: t('profile.markFail'), icon: 'none' })
      }
    },
  })
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
@media (min-width: 768px) {
  .page-header { display: none; }
  .page { padding-bottom: 0; }
}

.login-section {
  background: #fff; display: flex; flex-direction: column;
  align-items: center; padding: 64px 16px; gap: 12px;
}

.avatar-placeholder {
  width: 72px; height: 72px; border-radius: 50%;
  background: #f2f2f7; position: relative;
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

.profile-section { background: #fff; padding: 22px 16px 0; }
.user-header { display: flex; align-items: center; gap: 14px; }
.avatar {
  width: 58px; height: 58px; border-radius: 50%;
  background: #f2f2f7; flex-shrink: 0;
}
.user-info { flex: 1; }
.name-row { display: flex; align-items: center; gap: 8px; }
.nickname { font-size: 19px; font-weight: 700; color: #1a1a1a; }
.illini-badge {
  display: inline-flex; align-items: center;
  background: #13294B; color: #fff;
  padding: 2px 7px; border-radius: 4px;
  font-size: 10px; font-weight: 700;
}
.illini-badge-text { color: #fff; font-size: 10px; }
.user-bio { font-size: 13px; color: #636366; margin-top: 2px; }
.location-row {
  display: flex; align-items: center; gap: 5px; margin-top: 4px;
}
.loc-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #FF6B35; flex-shrink: 0;
}
.location { font-size: 13px; color: #aeaeb2; }
.join-date { font-size: 11px; color: #c7c7cc; margin-top: 2px; }

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
    width: 14px; height: 2px; background: #636366; border-radius: 1px;
  }
  &::after {
    content: ''; position: absolute; top: 0; right: 2px;
    width: 2px; height: 10px; background: #636366;
    border-radius: 1px; transform: rotate(-40deg);
    transform-origin: bottom center;
  }
}

/* ========== Stats / Tabs ========== */
.stats-row {
  display: flex; margin-top: 18px;
  border-top: 0.5px solid rgba(0,0,0,0.06);
}
.stat-item {
  flex: 1; text-align: center; padding: 14px 0 12px;
  cursor: pointer; position: relative;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.1s;
  &:active { background: #f7f7f8; }
  &.active::after {
    content: ''; position: absolute; bottom: 0; left: 50%;
    transform: translateX(-50%);
    width: 20px; height: 2px; background: #1a1a1a; border-radius: 1px;
  }
}
.stat-num { font-size: 20px; font-weight: 700; color: #1a1a1a; display: block; }
.stat-label { font-size: 12px; color: #aeaeb2; margin-top: 3px; display: block; }
.stat-item.active .stat-label { color: #1a1a1a; }

/* ========== Content Section ========== */
.section { background: #fff; margin-top: 7px; min-height: 200px; }

.empty-items {
  display: flex; flex-direction: column; align-items: center;
  padding: 48px 16px; gap: 10px;
}
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
.empty-heart {
  width: 24px; height: 22px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; top: 0;
    width: 12px; height: 18px; border-radius: 12px 12px 0 0;
    border: 2px solid #d1d1d6;
  }
  &::before { left: 0; transform: rotate(-45deg); transform-origin: bottom right; }
  &::after { right: 0; transform: rotate(45deg); transform-origin: bottom left; }
}
.empty-check {
  width: 24px; height: 24px; border: 2px solid #d1d1d6;
  border-radius: 50%; position: relative;
  &::after {
    content: ''; position: absolute; top: 5px; left: 4px;
    width: 12px; height: 7px;
    border-left: 2px solid #d1d1d6; border-bottom: 2px solid #d1d1d6;
    transform: rotate(-45deg);
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
.item-seller { margin-top: 2px; }
.seller-name { font-size: 12px; color: #aeaeb2; }
.item-status {
  font-size: 11px; align-self: flex-start; padding: 2px 8px; border-radius: 4px;
  &.active { color: #34C759; background: rgba(52,199,89,0.1); }
  &.reserved { color: #FF9500; background: rgba(255,149,0,0.1); }
  &.sold { color: #8e8e93; background: #f2f2f7; }
}

.item-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0; }
.action-btn {
  padding: 5px 10px; border-radius: 6px;
  background: #f2f2f7; cursor: pointer;
  text { font-size: 11px; color: #636366; font-weight: 500; }
  &:active { background: #e5e5ea; }
  &.danger text { color: #FF3B30; }
}

.menu-section { margin-top: 7px; background: #fff; }
.menu-item { padding: 15px 16px; display: flex; align-items: center; cursor: pointer; &:active { background: #f7f7f8; } }
.menu-text { font-size: 15px; color: #1a1a1a; flex: 1; }
.menu-badge {
  min-width: 18px; height: 18px; border-radius: 9px;
  background: #FF3B30; color: #fff; font-size: 10px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  padding: 0 5px; margin-right: 8px;
}
.menu-arrow {
  width: 7px; height: 7px; border-top: 1.5px solid #c7c7cc;
  border-right: 1.5px solid #c7c7cc; transform: rotate(45deg);
}
</style>
