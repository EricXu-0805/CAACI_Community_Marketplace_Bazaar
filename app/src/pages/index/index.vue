<template>
  <view class="page">
    <!-- 顶部区域：品牌 + 搜索 -->
    <view class="header">
      <view class="header-top">
        <text class="brand-name">CAACI 集市</text>
        <text class="header-location" @click="switchLocation">📍 UIUC ▾</text>
      </view>
      <view class="search-input" @click="focusSearch">
        <text class="search-icon">🔍</text>
        <input
          v-model="searchText"
          placeholder="搜索二手好物..."
          confirm-type="search"
          @confirm="onSearch"
        />
        <view v-if="searchText" class="search-clear" @click.stop="searchText = ''; onSearch()">✕</view>
      </view>
    </view>

    <!-- 分类横滑：带 emoji 图标 -->
    <scroll-view class="category-bar" scroll-x enable-flex>
      <view
        v-for="cat in categories"
        :key="cat.value"
        :class="['cat-item', { active: selectedCategory === cat.value }]"
        @click="selectCategory(cat.value)"
      >
        <text class="cat-icon">{{ cat.icon }}</text>
        <text class="cat-label">{{ cat.label }}</text>
      </view>
    </scroll-view>

    <!-- 商品瀑布流 -->
    <scroll-view
      class="feed"
      scroll-y
      @scrolltolower="loadMore"
      refresher-enabled
      :refresher-triggered="isRefreshing"
      @refresherrefresh="onRefresh"
    >
      <view class="waterfall">
        <view class="waterfall-col">
          <view
            v-for="item in leftCol"
            :key="item.id"
            class="card"
            @click="goToDetail(item.id)"
          >
            <view class="card-img-wrap">
              <image :src="item.images?.[0] || '/static/placeholder.png'" mode="widthFix" class="card-img" />
              <view v-if="item.condition === 'new'" class="card-badge new">全新</view>
              <view v-else-if="item.condition === 'like_new'" class="card-badge like-new">几乎全新</view>
            </view>
            <view class="card-body">
              <text class="card-title">{{ item.title }}</text>
              <view class="card-price-row">
                <text class="card-price">${{ item.price }}</text>
                <text class="card-condition">{{ conditionLabels[item.condition] }}</text>
              </view>
              <view class="card-footer">
                <view class="card-seller">
                  <image :src="item.profile?.avatar_url || '/static/default-avatar.png'" class="seller-avatar" />
                  <text class="seller-name">{{ item.profile?.nickname || '用户' }}</text>
                </view>
                <text class="card-location">📍{{ item.location }}</text>
              </view>
            </view>
          </view>
        </view>
        <view class="waterfall-col">
          <view
            v-for="item in rightCol"
            :key="item.id"
            class="card"
            @click="goToDetail(item.id)"
          >
            <view class="card-img-wrap">
              <image :src="item.images?.[0] || '/static/placeholder.png'" mode="widthFix" class="card-img" />
              <view v-if="item.condition === 'new'" class="card-badge new">全新</view>
              <view v-else-if="item.condition === 'like_new'" class="card-badge like-new">几乎全新</view>
            </view>
            <view class="card-body">
              <text class="card-title">{{ item.title }}</text>
              <view class="card-price-row">
                <text class="card-price">${{ item.price }}</text>
                <text class="card-condition">{{ conditionLabels[item.condition] }}</text>
              </view>
              <view class="card-footer">
                <view class="card-seller">
                  <image :src="item.profile?.avatar_url || '/static/default-avatar.png'" class="seller-avatar" />
                  <text class="seller-name">{{ item.profile?.nickname || '用户' }}</text>
                </view>
                <text class="card-location">📍{{ item.location }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <view v-if="loading" class="loading-tip">
        <view class="loading-dots"><text>·</text><text>·</text><text>·</text></view>
        <text>加载中</text>
      </view>
      <view v-if="!hasMore && displayItems.length > 0" class="loading-tip">
        <text class="divider-line"></text>
        <text>已经到底啦</text>
        <text class="divider-line"></text>
      </view>
      <view v-if="!loading && displayItems.length === 0" class="empty-state">
        <text class="empty-icon">🛒</text>
        <text class="empty-title">还没有人发布商品</text>
        <text class="empty-sub">快来发布第一件二手好物吧！</text>
        <view class="empty-btn" @click="goPublish">去发布</view>
      </view>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onPullDownRefresh } from '@dcloudio/uni-app'
import { useItems } from '../../composables/useItems'
import { CATEGORY_LABELS, CONDITION_LABELS, type ItemCategory, type Item } from '../../types'
import { MOCK_ITEMS } from '../../composables/useMockData'

const { items, loading, hasMore, fetchItems } = useItems()
const useMock = ref(false)

const searchText = ref('')
const selectedCategory = ref<ItemCategory | null>(null)
const currentPage = ref(0)
const isRefreshing = ref(false)
const conditionLabels = CONDITION_LABELS

const categories = [
  { value: null, label: '全部', icon: '🏠' },
  { value: 'furniture', label: '家具', icon: '🪑' },
  { value: 'electronics', label: '电子', icon: '💻' },
  { value: 'clothing', label: '服饰', icon: '👕' },
  { value: 'books', label: '书籍', icon: '📚' },
  { value: 'housing', label: '转租', icon: '🏠' },
  { value: 'vehicles', label: '交通', icon: '🚗' },
  { value: 'daily', label: '日用', icon: '🧴' },
  { value: 'food', label: '食品', icon: '🍜' },
  { value: 'other', label: '其他', icon: '📦' },
]

const displayItems = computed(() => useMock.value ? MOCK_ITEMS : items.value)
const leftCol = computed(() => displayItems.value.filter((_: Item, i: number) => i % 2 === 0))
const rightCol = computed(() => displayItems.value.filter((_: Item, i: number) => i % 2 === 1))

onMounted(async () => {
  await fetchItems({ reset: true })
  if (items.value.length === 0) {
    useMock.value = true
  }
})

function selectCategory(category: ItemCategory | null) {
  selectedCategory.value = category
  currentPage.value = 0
  fetchItems({ category, search: searchText.value, reset: true })
}

function onSearch() {
  currentPage.value = 0
  fetchItems({ category: selectedCategory.value, search: searchText.value, reset: true })
}

function focusSearch() {}
function switchLocation() {}

function loadMore() {
  if (loading.value || !hasMore.value) return
  currentPage.value++
  fetchItems({ page: currentPage.value, category: selectedCategory.value, search: searchText.value })
}

async function onRefresh() {
  isRefreshing.value = true
  currentPage.value = 0
  await fetchItems({ category: selectedCategory.value, search: searchText.value, reset: true })
  isRefreshing.value = false
}

onPullDownRefresh(async () => {
  await onRefresh()
  uni.stopPullDownRefresh()
})

function goToDetail(id: string) {
  uni.navigateTo({ url: `/pages/detail/index?id=${id}` })
}

function goPublish() {
  uni.switchTab({ url: '/pages/publish/index' })
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #f2f3f5;
}

/* ---- 顶部 Header ---- */
.header {
  background: linear-gradient(135deg, #FF6B35 0%, #FF8F65 100%);
  padding: 20rpx 24rpx 24rpx;
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16rpx;
}

.brand-name {
  font-size: 34rpx;
  font-weight: 800;
  color: #fff;
  letter-spacing: 2rpx;
}

.header-location {
  font-size: 24rpx;
  color: rgba(255,255,255,0.9);
  background: rgba(255,255,255,0.2);
  padding: 6rpx 16rpx;
  border-radius: 20rpx;
}

.search-input {
  display: flex;
  align-items: center;
  background: #fff;
  border-radius: 40rpx;
  padding: 14rpx 24rpx;
  gap: 12rpx;
  box-shadow: 0 4rpx 16rpx rgba(0,0,0,0.08);

  input { flex: 1; font-size: 26rpx; color: #333; }
  .search-icon { font-size: 26rpx; }
  .search-clear {
    width: 36rpx; height: 36rpx; border-radius: 50%;
    background: #e0e0e0; color: #fff; font-size: 20rpx;
    display: flex; align-items: center; justify-content: center;
  }
}

/* ---- 分类栏 ---- */
.category-bar {
  background: #fff;
  padding: 20rpx 12rpx 16rpx;
  white-space: nowrap;
  box-shadow: 0 2rpx 8rpx rgba(0,0,0,0.04);
}

.cat-item {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  padding: 8rpx 20rpx;
  margin: 0 4rpx;
  border-radius: 16rpx;
  gap: 4rpx;
  transition: all 0.2s;

  &.active {
    background: #FFF0E8;
    .cat-label { color: #FF6B35; font-weight: 600; }
  }
}

.cat-icon { font-size: 36rpx; }
.cat-label { font-size: 20rpx; color: #666; }

/* ---- 瀑布流 ---- */
.feed {
  height: calc(100vh - 280rpx);
}

.waterfall {
  display: flex;
  padding: 12rpx;
  gap: 12rpx;
}

.waterfall-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.card {
  background: #fff;
  border-radius: 20rpx;
  overflow: hidden;
  box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.06);
  transition: transform 0.2s;

  &:active { transform: scale(0.98); }
}

.card-img-wrap {
  position: relative;
  width: 100%;
}

.card-img {
  width: 100%;
  display: block;
}

.card-badge {
  position: absolute;
  top: 12rpx;
  left: 12rpx;
  padding: 4rpx 14rpx;
  border-radius: 8rpx;
  font-size: 20rpx;
  font-weight: 600;

  &.new { background: rgba(255,107,53,0.9); color: #fff; }
  &.like-new { background: rgba(82,196,26,0.9); color: #fff; }
}

.card-body {
  padding: 16rpx;
}

.card-title {
  font-size: 26rpx;
  color: #1a1a1a;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-weight: 500;
}

.card-price-row {
  display: flex;
  align-items: baseline;
  gap: 10rpx;
  margin-top: 12rpx;
}

.card-price {
  font-size: 34rpx;
  font-weight: 800;
  color: #FF6B35;
}

.card-condition {
  font-size: 20rpx;
  color: #999;
  background: #f5f5f5;
  padding: 2rpx 10rpx;
  border-radius: 6rpx;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 14rpx;
  padding-top: 14rpx;
  border-top: 1rpx solid #f5f5f5;
}

.card-seller {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.seller-avatar {
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  background: #eee;
}

.seller-name {
  font-size: 20rpx;
  color: #999;
  max-width: 120rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-location {
  font-size: 18rpx;
  color: #bbb;
}

/* ---- 底部状态 ---- */
.loading-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40rpx;
  gap: 12rpx;
  color: #bbb;
  font-size: 22rpx;
}

.loading-dots {
  display: flex;
  gap: 4rpx;
  text {
    animation: blink 1.4s infinite both;
    font-size: 36rpx;
    color: #FF6B35;
    &:nth-child(2) { animation-delay: 0.2s; }
    &:nth-child(3) { animation-delay: 0.4s; }
  }
}

@keyframes blink {
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
}

.divider-line {
  width: 60rpx;
  height: 1rpx;
  background: #ddd;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 200rpx;
  gap: 16rpx;
}

.empty-icon { font-size: 100rpx; }
.empty-title { font-size: 30rpx; color: #333; font-weight: 600; }
.empty-sub { font-size: 24rpx; color: #999; }
.empty-btn {
  margin-top: 24rpx;
  padding: 16rpx 64rpx;
  background: #FF6B35;
  color: #fff;
  border-radius: 40rpx;
  font-size: 28rpx;
  font-weight: 600;
}
</style>
