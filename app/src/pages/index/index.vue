<template>
  <view class="page">
    <DesktopNav current="index" />

    <!-- Mobile: Brand row (hidden on desktop) -->
    <view class="mobile-brand">
      <text class="brand-text">CAACI 集市</text>
      <text class="brand-loc" @click="switchLocation">📍 UIUC ▾</text>
    </view>

    <!-- Search + Filter -->
    <view class="search-wrap">
      <view class="search-bar">
        <text class="s-icon">🔍</text>
        <input
          v-model="searchText"
          placeholder="Search items near UIUC..."
          confirm-type="search"
          @confirm="onSearch"
        />
        <view v-if="searchText" class="s-clear" @click.stop="searchText = ''; onSearch()">✕</view>
      </view>
      <view class="filter-btn" @click="showFilter = !showFilter">
        <text class="filter-icon">⚙</text>
        <view v-if="activeFilterCount > 0" class="filter-dot">{{ activeFilterCount }}</view>
      </view>
    </view>

    <!-- Desktop only: Category Pills at top -->
    <scroll-view class="cat-bar desktop-cats" scroll-x enable-flex>
      <view
        v-for="cat in categories"
        :key="'d'+cat.value"
        :class="['pill', { active: selectedCategory === cat.value }]"
        @click="selectCategory(cat.value)"
      >
        <text>{{ cat.label }}</text>
      </view>
    </scroll-view>

    <!-- Filter Bottom Sheet -->
    <view v-if="showFilter" class="filter-mask" @click="showFilter = false"></view>
    <view :class="['filter-sheet', { open: showFilter }]">
      <view class="fs-header">
        <text class="fs-title">Filters</text>
        <text class="fs-reset" @click="resetFilters">Reset</text>
      </view>

      <view class="fs-section">
        <text class="fs-label">Price Range</text>
        <view class="fs-price-row">
          <view class="fs-price-input">
            <text class="fs-dollar">$</text>
            <input v-model="filterPriceMin" type="digit" placeholder="Min" />
          </view>
          <text class="fs-dash">—</text>
          <view class="fs-price-input">
            <text class="fs-dollar">$</text>
            <input v-model="filterPriceMax" type="digit" placeholder="Max" />
          </view>
        </view>
      </view>

      <view class="fs-section">
        <text class="fs-label">Condition</text>
        <view class="fs-pills">
          <view
            v-for="(label, key) in conditionOpts"
            :key="key"
            :class="['fpill', { active: filterCondition === key }]"
            @click="filterCondition = filterCondition === key ? '' : key"
          >
            <text>{{ label }}</text>
          </view>
        </view>
      </view>

      <view class="fs-section">
        <text class="fs-label">Location</text>
        <view class="fs-pills">
          <view
            v-for="loc in locationOpts"
            :key="loc"
            :class="['fpill', { active: filterLocation === loc }]"
            @click="filterLocation = filterLocation === loc ? '' : loc"
          >
            <text>{{ loc }}</text>
          </view>
        </view>
      </view>

      <view class="fs-section">
        <text class="fs-label">Sort</text>
        <view class="fs-pills">
          <view
            v-for="s in sortOpts"
            :key="s.value"
            :class="['fpill', { active: sortBy === s.value }]"
            @click="sortBy = s.value"
          >
            <text>{{ s.label }}</text>
          </view>
        </view>
      </view>

      <view class="fs-footer">
        <view class="fs-apply" @click="showFilter = false">
          <text>Apply</text>
        </view>
      </view>
    </view>

    <!-- Waterfall Feed -->
    <scroll-view
      class="feed"
      scroll-y
      @scrolltolower="loadMore"
      refresher-enabled
      :refresher-triggered="isRefreshing"
      @refresherrefresh="onRefresh"
    >
      <!-- Skeleton Loading -->
      <view v-if="initialLoading" class="waterfall">
        <view v-for="ci in columnCount" :key="'sk'+ci" class="wf-col">
          <view v-for="n in 3" :key="'sk'+ci+'-'+n" class="card skeleton-card">
            <view class="sk-img" :style="{ height: (130 + n * 40) + 'px' }"></view>
            <view class="sk-body">
              <view class="sk-line"></view>
              <view class="sk-line w60"></view>
              <view class="sk-row">
                <view class="sk-circle"></view>
                <view class="sk-line w40"></view>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- Real Content -->
      <view v-else class="waterfall">
        <view v-for="(col, ci) in columns" :key="ci" class="wf-col">
          <view
            v-for="item in col"
            :key="item.id"
            class="card"
            @click="goToDetail(item.id)"
          >
            <view class="card-img-box">
              <image
                :src="item.images?.[0] || '/static/placeholder.png'"
                mode="widthFix"
                class="card-img"
              />
              <text v-if="item.condition === 'new'" class="badge badge-new">全新</text>
              <text v-else-if="item.condition === 'like_new'" class="badge badge-mint">几乎全新</text>
            </view>
            <view class="card-info">
              <text class="card-title">{{ item.title }}</text>
              <view class="card-price-row">
                <text class="card-price">${{ item.price }}</text>
                <text v-if="item.negotiable" class="obo-tag">OBO</text>
              </view>
              <view class="card-bottom">
                <view class="card-seller">
                  <image
                    :src="item.profile?.avatar_url || '/static/default-avatar.png'"
                    class="seller-pic"
                  />
                  <text class="seller-nick">{{ item.profile?.nickname || 'User' }}</text>
                </view>
                <view class="card-fav">
                  <text class="fav-heart">♥</text>
                  <text class="fav-num">{{ item.favorite_count || 0 }}</text>
                </view>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- Loading more -->
      <view v-if="loading && !initialLoading" class="tip">
        <view class="dots"><text>·</text><text>·</text><text>·</text></view>
        <text>Loading</text>
      </view>
      <!-- End of list -->
      <view v-if="!hasMore && filteredItems.length > 0" class="tip">
        <text class="divider"></text>
        <text>No more items</text>
        <text class="divider"></text>
      </view>
      <!-- Empty -->
      <view v-if="!loading && !initialLoading && filteredItems.length === 0" class="empty">
        <text class="empty-icon">🛒</text>
        <text class="empty-title">No items found</text>
        <text class="empty-sub">Try adjusting your filters or be the first to post!</text>
        <view class="empty-btn" @click="goPublish">Post Item</view>
      </view>
    </scroll-view>

    <CustomTabBar current="index" />

    <!-- Mobile: Category Pills at bottom (above tabBar) -->
    <scroll-view class="cat-bar mobile-cats" scroll-x enable-flex>
      <view
        v-for="cat in categories"
        :key="'m'+cat.value"
        :class="['pill', { active: selectedCategory === cat.value }]"
        @click="selectCategory(cat.value)"
      >
        <text>{{ cat.label }}</text>
      </view>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onPullDownRefresh } from '@dcloudio/uni-app'
import { useItems } from '../../composables/useItems'
import { CONDITION_LABELS, type ItemCategory, type ItemCondition, type Item } from '../../types'
import { MOCK_ITEMS } from '../../composables/useMockData'
import DesktopNav from '../../components/DesktopNav.vue'
import CustomTabBar from '../../components/CustomTabBar.vue'

const { items, loading, hasMore, fetchItems } = useItems()
const useMock = ref(false)
const initialLoading = ref(true)

const searchText = ref('')
const selectedCategory = ref<ItemCategory | null>(null)
const currentPage = ref(0)
const isRefreshing = ref(false)
const columnCount = ref(2)

// Filter state
const showFilter = ref(false)
const filterPriceMin = ref('')
const filterPriceMax = ref('')
const filterCondition = ref('')
const filterLocation = ref('')
const sortBy = ref('latest')

const categories = [
  { value: null, label: 'All' },
  { value: 'furniture', label: 'Furniture' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'clothing', label: 'Fashion' },
  { value: 'books', label: 'Books' },
  { value: 'housing', label: 'Housing' },
  { value: 'vehicles', label: 'Transit' },
  { value: 'daily', label: 'Daily' },
  { value: 'food', label: 'Food' },
  { value: 'other', label: 'Other' },
]

const conditionOpts: Record<string, string> = {
  new: 'Brand New',
  like_new: 'Like New',
  good: 'Good',
  fair: 'Fair',
}

const locationOpts = ['Champaign', 'Urbana', 'UIUC']

const sortOpts = [
  { value: 'latest', label: 'Latest' },
  { value: 'price_asc', label: 'Price ↑' },
  { value: 'price_desc', label: 'Price ↓' },
  { value: 'popular', label: 'Popular' },
]

const activeFilterCount = computed(() => {
  let c = 0
  if (filterPriceMin.value) c++
  if (filterPriceMax.value) c++
  if (filterCondition.value) c++
  if (filterLocation.value) c++
  if (sortBy.value !== 'latest') c++
  return c
})

const displayItems = computed(() => useMock.value ? MOCK_ITEMS : items.value)

// Client-side filtering + sorting
const filteredItems = computed(() => {
  let result = [...displayItems.value]

  if (filterPriceMin.value) {
    const min = Number(filterPriceMin.value)
    if (!isNaN(min)) result = result.filter(item => item.price >= min)
  }
  if (filterPriceMax.value) {
    const max = Number(filterPriceMax.value)
    if (!isNaN(max)) result = result.filter(item => item.price <= max)
  }
  if (filterCondition.value) {
    result = result.filter(item => item.condition === filterCondition.value)
  }
  if (filterLocation.value) {
    const loc = filterLocation.value.toLowerCase()
    result = result.filter(item => item.location.toLowerCase().includes(loc))
  }

  if (sortBy.value === 'price_asc') {
    result.sort((a, b) => a.price - b.price)
  } else if (sortBy.value === 'price_desc') {
    result.sort((a, b) => b.price - a.price)
  } else if (sortBy.value === 'popular') {
    result.sort((a, b) => (b.favorite_count || 0) - (a.favorite_count || 0))
  }

  return result
})

const columns = computed(() => {
  const cols: Item[][] = Array.from({ length: columnCount.value }, () => [])
  filteredItems.value.forEach((item: Item, i: number) => {
    cols[i % columnCount.value].push(item)
  })
  return cols
})

function resetFilters() {
  filterPriceMin.value = ''
  filterPriceMax.value = ''
  filterCondition.value = ''
  filterLocation.value = ''
  sortBy.value = 'latest'
}

onMounted(async () => {
  try {
    const info = uni.getSystemInfoSync()
    columnCount.value = info.windowWidth >= 768 ? 3 : 2
  } catch {}

  try {
    // @ts-ignore
    uni.onWindowResize?.((res: { size: { windowWidth: number } }) => {
      columnCount.value = res.size.windowWidth >= 768 ? 3 : 2
    })
  } catch {}

  await fetchItems({ reset: true })
  if (items.value.length === 0) {
    useMock.value = true
  }
  initialLoading.value = false
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
/* ============================================
   CAACI Marketplace Homepage
   XHS UI + Xianyu features
   ============================================ */

.page {
  min-height: 100vh;
  background: #f2f2f7;
}

/* ========== Mobile Brand ========== */
.mobile-brand {
  background: #fff;
  padding: 12px 16px 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.brand-text { font-size: 19px; font-weight: 800; color: #FF6B35; letter-spacing: 0.5px; }
.brand-loc { font-size: 13px; color: #999; padding: 3px 10px; background: #f5f5f5; border-radius: 12px; }

/* ========== Search + Filter ========== */
.search-wrap {
  background: #fff;
  padding: 10px 16px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.search-bar {
  flex: 1;
  display: flex;
  align-items: center;
  background: #f5f5f5;
  border-radius: 20px;
  padding: 9px 14px;
  gap: 8px;
  input { flex: 1; font-size: 14px; color: #333; background: transparent; }
}
.s-icon { font-size: 14px; color: #bbb; }
.s-clear {
  width: 18px; height: 18px; border-radius: 50%; background: #ccc;
  color: #fff; font-size: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.filter-btn {
  position: relative;
  width: 38px; height: 38px; border-radius: 50%;
  background: #f5f5f5; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; cursor: pointer;
  transition: background 0.15s;
  &:active { background: #e8e8e8; }
}
.filter-icon { font-size: 16px; color: #666; }
.filter-dot {
  position: absolute; top: 2px; right: 2px;
  width: 16px; height: 16px; border-radius: 50%;
  background: #FF6B35; color: #fff; font-size: 10px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
}

/* ========== Category Pills ========== */
.cat-bar {
  white-space: nowrap;
  padding: 8px 10px 10px;
}
.pill {
  display: inline-flex; align-items: center;
  padding: 6px 16px; margin: 0 3px; border-radius: 16px;
  font-size: 13px; color: #666; background: #f5f5f5;
  transition: all 0.2s; cursor: pointer;
  &.active { background: #FFF0E8; color: #FF6B35; font-weight: 600; }
  &:hover { background: #ebebeb; }
  &.active:hover { background: #FFF0E8; }
}

/* Mobile: categories fixed at bottom above tabBar */
.mobile-cats {
  display: block;
  position: fixed;
  bottom: calc(56px + env(safe-area-inset-bottom, 0px));
  left: 0; right: 0; z-index: 90;
  background: rgba(255,255,255,0.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-top: 1px solid rgba(0,0,0,0.04);
  padding: 6px 10px 8px;
}
/* Desktop: hide mobile cats, show desktop cats */
.desktop-cats {
  display: none;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
}

/* ========== Filter Bottom Sheet ========== */
.filter-mask {
  position: fixed; inset: 0; z-index: 500;
  background: rgba(0,0,0,0.35);
}
.filter-sheet {
  position: fixed;
  bottom: 0; left: 0; right: 0; z-index: 501;
  background: #fff;
  border-radius: 16px 16px 0 0;
  padding: 0 20px 20px;
  transform: translateY(100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  max-height: 70vh;
  overflow-y: auto;
  &.open { transform: translateY(0); }
}
.fs-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 0 14px;
  position: sticky; top: 0; background: #fff; z-index: 1;
}
.fs-title { font-size: 17px; font-weight: 700; color: #1d1d1f; }
.fs-reset { font-size: 14px; color: #FF6B35; cursor: pointer; }
.fs-section { margin-bottom: 18px; }
.fs-label { font-size: 13px; color: #999; margin-bottom: 10px; display: block; }
.fs-price-row { display: flex; align-items: center; gap: 10px; }
.fs-price-input {
  flex: 1; display: flex; align-items: center;
  background: #f5f5f5; border-radius: 10px; padding: 10px 12px; gap: 4px;
  input { flex: 1; font-size: 15px; color: #333; background: transparent; }
}
.fs-dollar { font-size: 15px; color: #999; font-weight: 600; }
.fs-dash { color: #ccc; font-size: 16px; }
.fs-pills { display: flex; flex-wrap: wrap; gap: 8px; }
.fpill {
  padding: 7px 16px; border-radius: 18px;
  font-size: 13px; color: #666; background: #f5f5f5;
  cursor: pointer; transition: all 0.15s;
  &.active { background: #FFF0E8; color: #FF6B35; font-weight: 600; }
}
.fs-footer { padding-top: 10px; padding-bottom: env(safe-area-inset-bottom, 0px); }
.fs-apply {
  width: 100%; padding: 14px; border-radius: 24px;
  background: #FF6B35; color: #fff; font-size: 15px; font-weight: 600;
  text-align: center; cursor: pointer;
  &:active { opacity: 0.85; }
}

/* ========== Feed ========== */
.feed { height: calc(100vh - 125px); }

/* ========== Waterfall ========== */
.waterfall { display: flex; padding: 6px; gap: 6px; padding-bottom: 56px; }
.wf-col { flex: 1; display: flex; flex-direction: column; gap: 6px; }

/* ========== Card ========== */
.card {
  background: #fff; border-radius: 10px; overflow: hidden; cursor: pointer;
  transition: transform 0.12s;
  &:active { transform: scale(0.97); }
}
.card-img-box { position: relative; width: 100%; }
.card-img { width: 100%; display: block; }
.badge {
  position: absolute; top: 8px; left: 8px;
  padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; letter-spacing: 0.3px;
}
.badge-new { background: rgba(255,107,53,0.9); color: #fff; }
.badge-mint { background: rgba(82,196,26,0.9); color: #fff; }

.card-info { padding: 8px 10px 10px; }
.card-title {
  font-size: 13px; color: #333; line-height: 1.4; font-weight: 500;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; word-break: break-all;
}
.card-price-row { display: flex; align-items: baseline; gap: 5px; margin-top: 6px; }
.card-price { font-size: 15px; font-weight: 700; color: #FF6B35; letter-spacing: -0.3px; }
.obo-tag {
  font-size: 9px; font-weight: 700; color: #FF6B35;
  border: 1px solid #FF6B35; padding: 1px 4px; border-radius: 3px;
  letter-spacing: 0.3px;
}

.card-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
.card-seller { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; }
.seller-pic { width: 18px; height: 18px; border-radius: 50%; background: #f0f0f0; flex-shrink: 0; }
.seller-nick { font-size: 11px; color: #999; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-fav { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.fav-heart { font-size: 12px; color: #ddd; }
.fav-num { font-size: 11px; color: #999; }

/* ========== Skeleton ========== */
.skeleton-card { pointer-events: none; }
.sk-img { background: #e8e8ed; }
.sk-body { padding: 10px; }
.sk-line {
  height: 10px; background: #e8e8ed; border-radius: 5px; margin-bottom: 8px;
  animation: shimmer 1.5s ease-in-out infinite;
}
.sk-line.w60 { width: 60%; }
.sk-line.w40 { width: 40%; flex: 1; }
.sk-row { display: flex; gap: 6px; align-items: center; margin-top: 4px; }
.sk-circle {
  width: 18px; height: 18px; border-radius: 50%; background: #e8e8ed; flex-shrink: 0;
  animation: shimmer 1.5s ease-in-out infinite;
}
@keyframes shimmer {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

/* ========== States ========== */
.tip {
  display: flex; align-items: center; justify-content: center;
  padding: 20px; gap: 8px; color: #bbb; font-size: 12px;
}
.dots {
  display: flex; gap: 2px;
  text {
    animation: blink 1.4s infinite both; font-size: 20px; color: #FF6B35;
    &:nth-child(2) { animation-delay: 0.2s; }
    &:nth-child(3) { animation-delay: 0.4s; }
  }
}
@keyframes blink { 0%, 80%, 100% { opacity: 0.2; } 40% { opacity: 1; } }
.divider { width: 28px; height: 1px; background: #ddd; }

.empty {
  display: flex; flex-direction: column; align-items: center; padding-top: 80px; gap: 8px;
}
.empty-icon { font-size: 48px; }
.empty-title { font-size: 16px; color: #333; font-weight: 600; }
.empty-sub { font-size: 13px; color: #999; text-align: center; padding: 0 32px; }
.empty-btn {
  margin-top: 16px; padding: 10px 36px;
  background: #FF6B35; color: #fff; border-radius: 20px;
  font-size: 14px; font-weight: 600; cursor: pointer;
}

/* ============================================
   DESKTOP >= 768px
   ============================================ */
@media (min-width: 768px) {
  .page { max-width: 1120px; margin: 0 auto; }
  .mobile-brand { display: none; }
  .mobile-cats { display: none; }
  .desktop-cats { display: block; }

  .search-wrap { padding: 14px 24px; }
  .search-bar { max-width: 560px; }
  .desktop-cats { padding: 10px 24px 12px; }
  .pill { padding: 7px 20px; font-size: 14px; }

  .feed { height: calc(100vh - 165px); }
  .waterfall { padding: 10px 24px; gap: 10px; padding-bottom: 10px; }
  .wf-col { gap: 10px; }

  .card {
    transition: transform 0.15s, box-shadow 0.15s;
    &:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.08); }
    &:active { transform: scale(0.99); }
  }
  .card-info { padding: 10px 12px 12px; }
  .card-title { font-size: 14px; }
  .card-price { font-size: 16px; }
  .seller-pic { width: 20px; height: 20px; }
  .seller-nick { font-size: 12px; }
  .fav-num { font-size: 12px; }

  .filter-sheet { max-width: 480px; left: 50%; transform: translate(-50%, 100%);
    &.open { transform: translate(-50%, 0); }
  }
}
</style>
