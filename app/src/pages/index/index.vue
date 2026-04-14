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
  background: #f5f5f7;
  max-width: 480px;
  margin: 0 auto;
}

@media (min-width: 768px) {
  .page { box-shadow: 0 0 40px rgba(0,0,0,0.06); }
}

.header {
  background: linear-gradient(135deg, #FF6B35 0%, #FF8F65 100%);
  padding: 14px 16px 16px;
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.brand-name {
  font-size: 20px;
  font-weight: 800;
  color: #fff;
  letter-spacing: 1px;
}

.header-location {
  font-size: 13px;
  color: rgba(255,255,255,0.95);
  background: rgba(255,255,255,0.2);
  padding: 4px 12px;
  border-radius: 14px;
  backdrop-filter: blur(4px);
}

.search-input {
  display: flex;
  align-items: center;
  background: #fff;
  border-radius: 22px;
  padding: 10px 16px;
  gap: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);

  input { flex: 1; font-size: 15px; color: #1d1d1f; }
  .search-icon { font-size: 15px; }
  .search-clear {
    width: 20px; height: 20px; border-radius: 50%;
    background: #c7c7cc; color: #fff; font-size: 11px;
    display: flex; align-items: center; justify-content: center;
  }
}

.category-bar {
  background: #fff;
  padding: 12px 8px 10px;
  white-space: nowrap;
  border-bottom: 1px solid #f0f0f0;
}

.cat-item {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 14px;
  margin: 0 2px;
  border-radius: 12px;
  gap: 2px;
  transition: all 0.2s;

  &.active {
    background: #FFF0E8;
    .cat-label { color: #FF6B35; font-weight: 600; }
  }
}

.cat-icon { font-size: 22px; }
.cat-label { font-size: 11px; color: #86868b; }

.feed {
  height: calc(100vh - 160px);
}

.waterfall {
  display: flex;
  padding: 8px;
  gap: 8px;
}

.waterfall-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  transition: transform 0.15s ease, box-shadow 0.15s ease;

  &:active {
    transform: scale(0.97);
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }
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
  top: 8px;
  left: 8px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  backdrop-filter: blur(4px);

  &.new { background: rgba(255,107,53,0.9); color: #fff; }
  &.like-new { background: rgba(82,196,26,0.9); color: #fff; }
}

.card-body {
  padding: 10px 12px 12px;
}

.card-title {
  font-size: 14px;
  color: #1d1d1f;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-weight: 500;
}

.card-price-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 8px;
}

.card-price {
  font-size: 18px;
  font-weight: 800;
  color: #FF6B35;
  letter-spacing: -0.5px;
}

.card-condition {
  font-size: 11px;
  color: #86868b;
  background: #f5f5f7;
  padding: 2px 6px;
  border-radius: 4px;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid #f5f5f7;
}

.card-seller {
  display: flex;
  align-items: center;
  gap: 5px;
}

.seller-avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #f0f0f0;
}

.seller-name {
  font-size: 11px;
  color: #86868b;
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-location {
  font-size: 10px;
  color: #aeaeb2;
}

.loading-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  gap: 8px;
  color: #aeaeb2;
  font-size: 13px;
}

.loading-dots {
  display: flex;
  gap: 2px;
  text {
    animation: blink 1.4s infinite both;
    font-size: 20px;
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
  width: 32px;
  height: 1px;
  background: #d1d1d6;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 120px;
  gap: 8px;
}

.empty-icon { font-size: 56px; }
.empty-title { font-size: 17px; color: #1d1d1f; font-weight: 600; }
.empty-sub { font-size: 14px; color: #86868b; }
.empty-btn {
  margin-top: 16px;
  padding: 12px 40px;
  background: #FF6B35;
  color: #fff;
  border-radius: 22px;
  font-size: 15px;
  font-weight: 600;
}
</style>
