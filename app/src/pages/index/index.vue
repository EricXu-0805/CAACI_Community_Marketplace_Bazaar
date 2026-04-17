<template>
  <view class="page">
    <DesktopNav current="index" />

    <view class="mobile-header">
      <view class="mh-top">
        <text class="mh-brand">{{ t('app.name') }}</text>
        <view class="mh-right">
          <text class="mh-lang" @click="toggleLang">{{ t('lang.switch') }}</text>
        </view>
      </view>
      <view class="mh-search">
        <view class="search-field">
          <view class="sf-icon"></view>
          <input
            v-model="searchText"
            :placeholder="t('home.search')"
            confirm-type="search"
            @confirm="onSearch"
          />
          <view v-if="searchText" class="sf-clear" @click.stop="searchText = ''; onSearch()">×</view>
        </view>
        <view class="filter-btn" @click="showFilter = !showFilter">
          <view class="fb-lines"><view></view><view></view><view></view></view>
          <view v-if="activeFilterCount > 0" class="fb-badge">{{ activeFilterCount }}</view>
        </view>
      </view>
    </view>

    <!-- Search History -->
    <view v-if="searchHistory.length > 0 && !searchText" class="search-history">
      <view class="sh-header">
        <text class="sh-title">{{ t('home.recentSearch') }}</text>
        <text class="sh-clear" @click="clearHistory">{{ t('filter.reset') }}</text>
      </view>
      <view class="sh-tags">
        <view v-for="h in searchHistory" :key="h" class="sh-tag" @click="pickHistory(h)">
          <text>{{ h }}</text>
        </view>
      </view>
    </view>

    <!-- Quick action banner -->
    <view v-if="!searchText && !selectedCategory" class="banner-area">
      <swiper class="banner-swiper" autoplay circular :interval="4000">
        <swiper-item v-for="(b, i) in banners" :key="i">
          <view :class="['banner-card', b.color]" @click="b.action">
            <text class="banner-emoji">{{ b.icon }}</text>
            <view class="banner-text">
              <text class="banner-title">{{ b.title }}</text>
              <text class="banner-sub">{{ b.sub }}</text>
            </view>
          </view>
        </swiper-item>
      </swiper>
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
        <text class="fs-title">{{ t('filter.title') }}</text>
        <text class="fs-reset" @click="resetFilters">{{ t('filter.reset') }}</text>
      </view>

      <view class="fs-section">
        <text class="fs-label">{{ t('filter.price') }}</text>
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
        <text class="fs-label">{{ t('filter.condition') }}</text>
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
        <text class="fs-label">{{ t('filter.location') }}</text>
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
        <text class="fs-label">{{ t('filter.sort') }}</text>
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
        <view class="fs-apply" @click="applyFilters">
          <text>{{ t('filter.apply') }}</text>
        </view>
      </view>
    </view>

    <!-- Waterfall Feed -->
    <scroll-view
      class="feed"
      scroll-y
      :scroll-top="scrollTopVal"
      @scrolltolower="loadMore"
      @scroll="onScroll"
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
      <view v-else>
        <view v-if="searchText || selectedCategory" class="result-count">
          <text>{{ filteredItems.length }} {{ t('home.results') }}</text>
        </view>
        <view class="waterfall">
          <view v-for="(col, ci) in columns" :key="ci" class="wf-col">
          <view
            v-for="item in col"
            :key="item.id"
            class="card"
            @click="goToDetail(item.id)"
            @longpress="onCardLongPress(item)"
          >
            <view class="card-img-box">
              <image
                :src="item.images?.[0] || '/static/placeholder.png'"
                mode="widthFix"
                :class="['card-img', { 'card-img-sold': item.status === 'sold' }]"
                lazy-load
              />
              <view v-if="item.status === 'sold'" class="sold-overlay">
                <text>{{ t('status.sold') }}</text>
              </view>
              <text v-else-if="item.status === 'reserved'" class="badge badge-reserved">{{ t('status.reserved') }}</text>
              <text v-else-if="item.condition === 'new'" class="badge badge-new">{{ t('condition.new') }}</text>
              <text v-else-if="item.condition === 'like_new'" class="badge badge-mint">{{ t('condition.like_new') }}</text>
              <view v-if="item.images && item.images.length > 1" class="img-count-badge">
                <text>{{ item.images.length }}</text>
              </view>
            </view>
            <view class="card-info">
              <text class="card-title">{{ item.title }}</text>
              <view class="card-price-row">
                <text :class="['card-price', { 'card-price-free': item.price === 0 }]">{{ formatPrice(item.price, t('home.free')) }}</text>
                <text v-if="item.negotiable" class="obo-tag">OBO</text>
              </view>
              <view class="card-bottom">
                <view class="card-seller">
                  <image
                    :src="item.profile?.avatar_url || '/static/default-avatar.svg'"
                    class="seller-pic"
                  />
                  <text class="seller-nick">{{ item.profile?.nickname || t('app.user') }}</text>
                  <text class="card-time">{{ formatTime(item.created_at) }}</text>
                </view>
                <view class="card-fav">
                  <text v-if="isOldItem(item.created_at)" class="old-tag">{{ t('home.oldListing') }}</text>
                  <text
                    :class="['fav-heart', { active: isFavorited(item.id) }]"
                    @click.stop="onQuickFav(item)"
                  >♥</text>
                  <text class="fav-num">{{ item.favorite_count || 0 }}</text>
                </view>
              </view>
            </view>
          </view>
        </view>
        </view>
      </view>

      <!-- Loading more -->
      <view v-if="loading && !initialLoading" class="tip">
        <view class="dots"><text>·</text><text>·</text><text>·</text></view>
        <text>{{ t('home.loading') }}</text>
      </view>
      <!-- End of list -->
      <view v-if="!hasMore && filteredItems.length > 0" class="tip">
        <text class="divider"></text>
        <text>{{ t('home.endOf') }} · {{ filteredItems.length }} {{ t('home.results') }}</text>
        <text class="divider"></text>
      </view>
      <!-- Empty -->
      <view v-if="fetchError && !loading" class="empty">
        <view class="empty-error-icon"></view>
        <text class="empty-sub">{{ fetchError }}</text>
        <view class="empty-btn" @click="onRefresh">{{ t('home.retry') }}</view>
      </view>

      <view v-else-if="!loading && !initialLoading && filteredItems.length === 0" class="empty">
        <view class="empty-bag-icon"></view>
        <text class="empty-title">{{ searchText ? t('home.noResults') : t('home.emptyTitle') }}</text>
        <text class="empty-sub">{{ searchText ? t('home.tryOther') : t('home.emptySub') }}</text>
        <view v-if="searchText" class="empty-btn" @click="searchText = ''; onSearch()">{{ t('home.clearSearch') }}</view>
        <view v-else class="empty-btn" @click="goPublish">{{ t('home.postItem') }}</view>
      </view>
    </scroll-view>

    <!-- Back to top -->
    <view v-if="showBackTop" class="back-top" @click="scrollToTop">
      <view class="bt-arrow"></view>
    </view>

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
import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../composables/useAuth'
import { useFavorites } from '../../composables/useFavorites'
import { useModeration } from '../../composables/useModeration'
import type { ItemCategory, Item } from '../../types'

import { debounce, formatTime, formatPrice, haptic } from '../../utils'
import DesktopNav from '../../components/DesktopNav.vue'
import CustomTabBar from '../../components/CustomTabBar.vue'

const { t, toggleLang } = useI18n()

const { items, loading, hasMore, fetchError, fetchItems } = useItems()
const { currentUser } = useAuth()
const { isFavorited, toggleFavorite, loadMyFavorites } = useFavorites()
const { ensureLoaded: ensureBlockedLoaded } = useModeration()

const initialLoading = ref(true)

const searchText = ref('')
const selectedCategory = ref<ItemCategory | null>(null)
const currentPage = ref(0)
const isRefreshing = ref(false)
const columnCount = ref(2)
const banners = computed(() => [
  { icon: '📦', title: t('banner.sell'), sub: t('banner.sellSub'), color: 'bg-warm', action: () => uni.switchTab({ url: '/pages/publish/index' }) },
  { icon: '🎓', title: t('banner.grad'), sub: t('banner.gradSub'), color: 'bg-blue', action: () => selectCategory('furniture') },
  { icon: '💡', title: t('banner.tip'), sub: t('banner.tipSub'), color: 'bg-green', action: () => {} },
])
const showBackTop = ref(false)
const scrollTopVal = ref(0)

const showFilter = ref(false)
const filterPriceMin = ref('')
const filterPriceMax = ref('')
const filterCondition = ref('')
const filterLocation = ref('')
const sortBy = ref('latest')

const categoryKeys: (ItemCategory | null)[] = [null, 'furniture', 'electronics', 'clothing', 'books', 'housing', 'vehicles', 'daily', 'food', 'other']
const categories = computed(() => categoryKeys.map(k => ({
  value: k,
  label: t(k ? 'cat.' + k : 'cat.all'),
})))

const conditionKeys = ['new', 'like_new', 'good', 'fair']
const conditionOpts = computed(() => {
  const m: Record<string, string> = {}
  conditionKeys.forEach(k => { m[k] = t('condition.' + k) })
  return m
})

const locationOpts = ['Champaign', 'Urbana', 'UIUC']

const sortKeys = ['latest', 'price_asc', 'price_desc', 'popular']
const sortOpts = computed(() => sortKeys.map(k => ({ value: k, label: t('sort.' + k.replace('price_asc', 'priceAsc').replace('price_desc', 'priceDesc')) })))

const activeFilterCount = computed(() => {
  let c = 0
  if (filterPriceMin.value) c++
  if (filterPriceMax.value) c++
  if (filterCondition.value) c++
  if (filterLocation.value) c++
  if (sortBy.value !== 'latest') c++
  return c
})

const displayItems = computed(() => items.value)

function getFilterParams() {
  return {
    category: selectedCategory.value,
    search: searchText.value,
    priceMin: filterPriceMin.value ? Number(filterPriceMin.value) : undefined,
    priceMax: filterPriceMax.value ? Number(filterPriceMax.value) : undefined,
    condition: filterCondition.value || undefined,
    sort: sortBy.value,
  }
}

const filteredItems = computed(() => {
  let result = [...displayItems.value]

  if (filterLocation.value) {
    const loc = filterLocation.value.toLowerCase()
    result = result.filter(item => item.location.toLowerCase().includes(loc))
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

function applyFilters() {
  showFilter.value = false
  currentPage.value = 0
  fetchItems({ ...getFilterParams(), reset: true })
}

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
    const onResize = (uni as any).onWindowResize
    if (typeof onResize === 'function') {
      onResize((res: { size: { windowWidth: number } }) => {
        columnCount.value = res.size.windowWidth >= 768 ? 3 : 2
      })
    }
  } catch {}

  if (currentUser.value) {
    await Promise.all([
      loadMyFavorites(currentUser.value.id),
      ensureBlockedLoaded(),
    ])
  }
  await fetchItems({ ...getFilterParams(), reset: true })
  initialLoading.value = false
})

function selectCategory(category: ItemCategory | null) {
  selectedCategory.value = category
  currentPage.value = 0
  fetchItems({ ...getFilterParams(), category, reset: true })
}

const MAX_HISTORY = 8
const searchHistory = ref<string[]>([])
try { searchHistory.value = JSON.parse(uni.getStorageSync('searchHistory') || '[]') } catch {}

function saveSearch(text: string) {
  if (!text.trim()) return
  searchHistory.value = [text, ...searchHistory.value.filter(s => s !== text)].slice(0, MAX_HISTORY)
  try { uni.setStorageSync('searchHistory', JSON.stringify(searchHistory.value)) } catch {}
}

function clearHistory() {
  searchHistory.value = []
  try { uni.removeStorageSync('searchHistory') } catch {}
}

function pickHistory(text: string) {
  searchText.value = text
  onSearch()
}

const debouncedFetch = debounce(() => {
  currentPage.value = 0
  if (searchText.value.trim()) saveSearch(searchText.value.trim())
  fetchItems({ ...getFilterParams(), reset: true })
}, 300)

async function onQuickFav(item: Item) {
  if (!currentUser.value) {
    uni.navigateTo({ url: '/pages/login/index' })
    return
  }
  haptic('light')
  const nowFav = await toggleFavorite(currentUser.value.id, item.id)
  item.favorite_count = (item.favorite_count || 0) + (nowFav ? 1 : -1)
}

function onCardLongPress(item: Item) {
  const favLabel = isFavorited(item.id) ? t('home.unsave') : t('detail.save')
  uni.showActionSheet({
    itemList: [favLabel, t('home.shareItem')],
    success: async (res) => {
      if (res.tapIndex === 0) {
        await onQuickFav(item)
      } else if (res.tapIndex === 1) {
        // #ifdef H5
        const url = `${window.location.origin}/share/${item.id}`
        if (navigator.share) {
          navigator.share({ title: item.title, text: `$${item.price} - ${item.title}`, url })
        } else {
          uni.setClipboardData({ data: url })
          uni.showToast({ title: t('detail.linkCopied'), icon: 'success' })
        }
        // #endif
        // #ifndef H5
        uni.showToast({ title: t('detail.linkCopied'), icon: 'success' })
        // #endif
      }
    },
  })
}

function isOldItem(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > 30 * 86400000
}

function onSearch() {
  debouncedFetch()
}

function onScroll(e: any) {
  showBackTop.value = e.detail.scrollTop > 600
}

function scrollToTop() {
  scrollTopVal.value = 1
  setTimeout(() => { scrollTopVal.value = 0 }, 50)
}

function loadMore() {
  if (loading.value || !hasMore.value) return
  currentPage.value++
  fetchItems({ ...getFilterParams(), page: currentPage.value })
}

async function onRefresh() {
  isRefreshing.value = true
  currentPage.value = 0
  await fetchItems({ ...getFilterParams(), reset: true })
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

/* ========== Mobile Header ========== */
.mobile-header {
  background: #fff; padding: 10px 16px 11px;
  padding-top: calc(10px + env(safe-area-inset-top, 0px));
}
.mh-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.mh-brand { font-size: 18px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.02em; }
.mh-right { display: flex; align-items: center; gap: 8px; }
.mh-lang {
  font-size: 11px; color: #8e8e93; padding: 3px 9px;
  border: 1px solid #d1d1d6; border-radius: 6px; font-weight: 500;
}
.mh-search { display: flex; align-items: center; gap: 9px; }
.search-field {
  flex: 1; display: flex; align-items: center;
  background: #f2f2f7; border-radius: 10px; padding: 8px 12px; gap: 7px;
  input { flex: 1; font-size: 15px; color: #1a1a1a; background: transparent; }
}
.sf-icon {
  width: 16px; height: 16px; border: 1.8px solid #8e8e93; border-radius: 50%; position: relative; flex-shrink: 0;
}
.sf-icon::after {
  content: ''; position: absolute; bottom: -4px; right: -4px;
  width: 5px; height: 1.8px; background: #8e8e93; transform: rotate(45deg);
}
.sf-clear {
  width: 18px; height: 18px; border-radius: 50%; background: #c7c7cc;
  color: #fff; font-size: 12px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.filter-btn {
  position: relative; width: 36px; height: 36px; border-radius: 10px;
  background: #f2f2f7; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; cursor: pointer;
  &:active { background: #e5e5ea; }
}
.fb-lines {
  display: flex; flex-direction: column; gap: 3px; width: 16px;
  view { height: 1.8px; background: #636366; border-radius: 1px; }
  view:nth-child(1) { width: 16px; }
  view:nth-child(2) { width: 12px; }
  view:nth-child(3) { width: 8px; }
}
.fb-badge {
  position: absolute; top: 1px; right: 1px;
  width: 15px; height: 15px; border-radius: 50%;
  background: #FF6B35; color: #fff; font-size: 9px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
}

/* ========== Category Pills ========== */
.cat-bar { white-space: nowrap; padding: 7px 12px 9px; }
.pill {
  display: inline-flex; align-items: center;
  padding: 5px 14px; margin: 0 2px; border-radius: 8px;
  font-size: 13px; color: #636366; background: transparent;
  transition: all 0.15s; cursor: pointer; font-weight: 500;
  &.active { background: #1a1a1a; color: #fff; }
}

/* Mobile: categories fixed at bottom above tabBar */
.mobile-cats {
  display: block;
  position: fixed;
  bottom: calc(50px + env(safe-area-inset-bottom, 0px));
  left: 0; right: 0; z-index: 90;
  background: rgba(252,252,253,0.9);
  backdrop-filter: saturate(180%) blur(16px);
  -webkit-backdrop-filter: saturate(180%) blur(16px);
  border-top: 0.5px solid rgba(0,0,0,0.06);
  padding: 5px 10px 6px;
}
/* Desktop: hide mobile cats, show desktop cats */
.desktop-cats {
  display: none;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
}

/* ========== Filter Bottom Sheet ========== */
.filter-mask {
  position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 500;
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
  padding: 7px 15px; border-radius: 8px;
  font-size: 13px; color: #636366; background: #f2f2f7;
  cursor: pointer; transition: all 0.15s; font-weight: 500;
  &.active { background: #1a1a1a; color: #fff; }
}
.fs-footer { padding-top: 10px; padding-bottom: env(safe-area-inset-bottom, 0px); }
.fs-apply {
  width: 100%; padding: 14px; border-radius: 24px;
  background: #FF6B35; color: #fff; font-size: 15px; font-weight: 600;
  text-align: center; cursor: pointer;
  &:active { opacity: 0.85; }
}

/* ========== Feed ========== */
.feed { height: calc(100vh - 120px); }

/* ========== Waterfall ========== */
.waterfall { display: flex; padding: 5px; gap: 5px; padding-bottom: 54px; }
.wf-col { flex: 1; display: flex; flex-direction: column; gap: 5px; }

/* ========== Card ========== */
.card {
  background: #fff; border-radius: 12px; overflow: hidden; cursor: pointer;
  transition: transform 0.1s;
  &:active { transform: scale(0.98); }
}
.card-img-box { position: relative; width: 100%; }
.card-img {
  width: 100%; display: block;
  transition: filter 0.2s;
  &.card-img-sold { filter: grayscale(1) brightness(0.85); }
}
.sold-overlay {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  padding: 6px 14px; border-radius: 6px;
  background: rgba(0,0,0,0.6);
  text { color: #fff; font-size: 13px; font-weight: 700; letter-spacing: 1px; }
}
.img-count-badge {
  position: absolute; top: 7px; right: 7px;
  padding: 2px 7px; border-radius: 10px;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  text { color: #fff; font-size: 10px; font-weight: 600; }
}
.badge {
  position: absolute; top: 7px; left: 7px;
  padding: 2px 7px; border-radius: 5px; font-size: 10px; font-weight: 600;
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
.badge-new { background: rgba(255,107,53,0.85); color: #fff; }
.badge-mint { background: rgba(52,199,89,0.85); color: #fff; }
.badge-reserved { background: rgba(255,149,0,0.85); color: #fff; }
.card-time { font-size: 10px; color: #c7c7cc; margin-left: auto; }
.old-tag { font-size: 10px; color: #c7c7cc; margin-right: 2px; }

.card-info { padding: 9px 10px 11px; }
.card-title {
  font-size: 13px; color: #1a1a1a; line-height: 1.35; font-weight: 400;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; word-break: break-all;
}
.card-price-row { display: flex; align-items: baseline; gap: 4px; margin-top: 5px; }
.card-price { font-size: 15px; font-weight: 600; color: #1a1a1a; letter-spacing: -0.02em; }
.card-price-free { color: #34C759; }
.obo-tag {
  font-size: 9px; font-weight: 600; color: #FF6B35;
  background: rgba(255,107,53,0.08); padding: 1px 4px; border-radius: 3px;
}

.card-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 7px; }
.card-seller { display: flex; align-items: center; gap: 5px; flex: 1; min-width: 0; }
.seller-pic { width: 16px; height: 16px; border-radius: 50%; background: #f0f0f0; flex-shrink: 0; }
.seller-nick { font-size: 11px; color: #8e8e93; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-fav { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.fav-heart {
  font-size: 13px; color: #c7c7cc; cursor: pointer;
  transition: color 0.15s, transform 0.15s;
  &.active { color: #FF3B30; }
  &:active { transform: scale(1.3); }
}
.fav-num { font-size: 10px; color: #aeaeb2; }

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
.empty-error-icon {
  width: 40px; height: 40px; border: 2.5px solid #d1d1d6;
  border-radius: 50%; position: relative; margin-bottom: 6px;
  &::before {
    content: '!'; position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    font-size: 20px; font-weight: 700; color: #d1d1d6;
  }
}
.empty-bag-icon {
  width: 36px; height: 40px; border: 2.5px solid #d1d1d6;
  border-radius: 5px; position: relative; margin-bottom: 6px;
  &::before {
    content: ''; position: absolute; top: -10px; left: 5px;
    width: 22px; height: 12px;
    border: 2.5px solid #d1d1d6; border-bottom: none;
    border-radius: 11px 11px 0 0;
  }
}
.empty-title { font-size: 16px; color: #333; font-weight: 600; }
.empty-sub { font-size: 13px; color: #999; text-align: center; padding: 0 32px; }
.empty-btn {
  margin-top: 18px; padding: 11px 32px;
  background: #1a1a1a; color: #fff; border-radius: 22px;
  font-size: 14px; font-weight: 600; cursor: pointer;
  &:active { opacity: 0.8; }
}

.banner-area { padding: 0 16px 8px; }
.banner-swiper { height: 72px; }
.banner-card {
  display: flex; align-items: center; gap: 12px; padding: 14px 16px;
  border-radius: 12px; height: 68px; cursor: pointer;
  &:active { opacity: 0.9; }
}
.bg-warm { background: linear-gradient(135deg, #FFF3E0, #FFE0B2); }
.bg-blue { background: linear-gradient(135deg, #E3F2FD, #BBDEFB); }
.bg-green { background: linear-gradient(135deg, #E8F5E9, #C8E6C9); }
.banner-emoji { font-size: 28px; flex-shrink: 0; }
.banner-text { flex: 1; }
.banner-title { font-size: 14px; font-weight: 600; color: #1a1a1a; display: block; }
.banner-sub { font-size: 11px; color: #636366; margin-top: 2px; display: block; }

.back-top {
  position: fixed; right: 16px; bottom: calc(110px + env(safe-area-inset-bottom, 0px));
  width: 40px; height: 40px; border-radius: 50%;
  background: rgba(255,255,255,0.9); box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; z-index: 100;
  &:active { transform: scale(0.9); }
}
.bt-arrow {
  width: 10px; height: 10px;
  border-left: 2px solid #1a1a1a; border-top: 2px solid #1a1a1a;
  transform: rotate(45deg); margin-top: 3px;
}

.result-count {
  padding: 4px 16px 8px; font-size: 12px; color: #8e8e93;
}

.search-history { padding: 0 16px 10px; }
.sh-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.sh-title { font-size: 13px; color: #8e8e93; font-weight: 500; }
.sh-clear { font-size: 12px; color: #c7c7cc; cursor: pointer; }
.sh-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.sh-tag {
  padding: 5px 12px; background: #f2f2f7; border-radius: 14px; cursor: pointer;
  text { font-size: 13px; color: #636366; }
  &:active { background: #e5e5ea; }
}

/* ============================================
   DESKTOP >= 768px
   ============================================ */
@media (min-width: 768px) {
  .page { max-width: 1120px; margin: 0 auto; }
  .mobile-header { display: none; }
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
