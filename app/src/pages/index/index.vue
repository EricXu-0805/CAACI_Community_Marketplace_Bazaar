<template>
  <view class="page">
    <view class="search-bar">
      <view class="search-input">
        <text class="search-icon">🔍</text>
        <input
          v-model="searchText"
          placeholder="搜索二手好物..."
          confirm-type="search"
          @confirm="onSearch"
        />
      </view>
    </view>

    <scroll-view class="category-bar" scroll-x enable-flex>
      <view
        v-for="cat in categories"
        :key="cat.value"
        :class="['category-tag', { active: selectedCategory === cat.value }]"
        @click="selectCategory(cat.value)"
      >
        {{ cat.label }}
      </view>
    </scroll-view>

    <scroll-view
      class="item-list"
      scroll-y
      @scrolltolower="loadMore"
      refresher-enabled
      :refresher-triggered="isRefreshing"
      @refresherrefresh="onRefresh"
    >
      <view class="item-grid">
        <view
          v-for="item in items"
          :key="item.id"
          class="item-card"
          @click="goToDetail(item.id)"
        >
          <image
            :src="item.images[0] || '/static/placeholder.png'"
            mode="aspectFill"
            class="item-image"
          />
          <view class="item-info">
            <text class="item-title">{{ item.title }}</text>
            <view class="item-meta">
              <text class="item-price">${{ item.price }}</text>
              <text class="item-location">📍{{ item.location }}</text>
            </view>
          </view>
        </view>
      </view>

      <view v-if="loading" class="loading-tip">加载中...</view>
      <view v-if="!hasMore && items.length > 0" class="loading-tip">没有更多了</view>
      <view v-if="!loading && items.length === 0" class="empty-tip">
        <text>暂无商品</text>
        <text class="empty-sub">快来发布第一件二手好物吧！</text>
      </view>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { onPullDownRefresh } from '@dcloudio/uni-app'
import { useItems } from '../../composables/useItems'
import { CATEGORY_LABELS, type ItemCategory } from '../../types'

const { items, loading, hasMore, fetchItems } = useItems()

const searchText = ref('')
const selectedCategory = ref<ItemCategory | null>(null)
const currentPage = ref(0)
const isRefreshing = ref(false)

const categories = [
  { value: null, label: '全部' },
  ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
]

onMounted(() => {
  fetchItems({ reset: true })
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
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #f5f5f5;
}

.search-bar {
  padding: 24rpx;
  background: #fff;
  position: sticky;
  top: 0;
  z-index: 10;
}

.search-input {
  display: flex;
  align-items: center;
  background: #f5f5f5;
  border-radius: 36rpx;
  padding: 16rpx 24rpx;
  gap: 16rpx;

  input {
    flex: 1;
    font-size: 28rpx;
  }

  .search-icon {
    font-size: 28rpx;
  }
}

.category-bar {
  background: #fff;
  padding: 0 24rpx 24rpx;
  white-space: nowrap;
}

.category-tag {
  display: inline-block;
  padding: 8rpx 24rpx;
  margin-right: 16rpx;
  border-radius: 32rpx;
  font-size: 24rpx;
  color: #666;
  background: #f5f5f5;

  &.active {
    color: #fff;
    background: #FF6B35;
  }
}

.item-list {
  height: calc(100vh - 200rpx);
}

.item-grid {
  display: flex;
  flex-wrap: wrap;
  padding: 16rpx;
  gap: 16rpx;
}

.item-card {
  width: calc(50% - 8rpx);
  background: #fff;
  border-radius: 16rpx;
  overflow: hidden;
}

.item-image {
  width: 100%;
  height: 340rpx;
}

.item-info {
  padding: 16rpx;
}

.item-title {
  font-size: 26rpx;
  color: #333;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
}

.item-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8rpx;
}

.item-price {
  font-size: 30rpx;
  font-weight: bold;
  color: #FF6B35;
}

.item-location {
  font-size: 20rpx;
  color: #999;
}

.loading-tip, .empty-tip {
  text-align: center;
  padding: 48rpx;
  color: #999;
  font-size: 24rpx;
}

.empty-tip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
  padding-top: 200rpx;

  .empty-sub {
    font-size: 22rpx;
  }
}
</style>
